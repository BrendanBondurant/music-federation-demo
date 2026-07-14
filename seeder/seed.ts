/**
 * Vault parser / seeder for the music federation demo.
 *
 * Reads the Obsidian vault (read-only), emits seed/artists.json,
 * seed/catalog.json, seed/classical.json, and fails loudly if any
 * reference dangles or the entity counts drift from the verified numbers.
 *
 * Usage:
 *   npm run seed -- /path/to/Personal/Music
 *   (defaults to ~/Documents/Obsidian/Personal/Music if it exists)
 */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Expected state of the vault, verified 2026-07-13. If the seeder reports
// different numbers, the parser is wrong -- not the vault.
//
// Counts will shift slightly once these vault data issues are resolved:
//   - Footprints recordings in Alone Together + How Insensitive link to [[Footprints]]
//     but the album is "Footprints (album).md" -- fix the links.
//   - I Got Rhythm has a recording row for [[George Gershwin]] (no artist file) -- remove it.
//   - After Hours (Dexter Gordon) credits Rolf Ericson, Lars Sjösten, Sture Nordin,
//     Pelle Hultén (no artist files); also lists I Remember You + Darn That Dream
//     as tracks (no tune files) -- add the missing files or remove the references.
//   - Desmond Blue credits Bob Prince (no artist file) -- add or remove.
//   - Let's Hang Out, Proof Positive, Well Be Together Again link to [[J J Johnson]]
//     (slug j-j-johnson) but the artist file is J.J. Johnson.md (slug jj-johnson)
//     -- fix the links to [[J.J. Johnson]] in the album files.
//   - So What (Eddie Henderson) credits Eddie Henderson, David Kikoski, Ed Howard
//     (no artist files) -- add or remove.
//   - The Champ (Sonny Stitt) lists Walkin' as a track (no tune file) -- add it.
const EXPECTED = {
  people: 1083,
  ensembles: 58,
  albums: 604,
  tunes: 153,
  recordings: 712,
  personnelEdges: 2123,
  works: 8,
  movements: 18,
  movementRecordings: 137,
  warnings: 0,
};

const SKIP_FILES = new Set(["CLAUDE.md", "Albums to fix.md", "Other tunes.md"]);
const PLACEHOLDER_ALBUMS = new Set(["youtube", "late-night-jazz-compilation", "baroquswing-vol-ii"]);
const JUNK_ARTIST_SLUGS = new Set(["georgie-gershwin"]);
// Personnel credits for arrangers/producers who don't have artist files and don't need one.
const SKIP_PERSONNEL_SLUGS = new Set(["bob-prince"]);

// ---------------------------------------------------------------------------
// Helpers

/** Normalize whitespace: non-breaking spaces -> spaces, trim. */
function norm(s: string): string {
  return s.replace(/\u00a0/g, " ").trim();
}

/**
 * Slug: lowercase, diacritics stripped, punctuation removed, spaces -> hyphens.
 * So "Where Would I Be?" and "Where Would I Be" collapse to one id, variant
 * spellings like G\u00f3mez/Gomez merge, and "J.J. Johnson" (jj-johnson) stays
 * distinct from "J J Johnson" (j-j-johnson) -- both exist in the vault.
 * Person slugs are the shared @key across all three subgraphs.
 */
function slug(s: string): string {
  return norm(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Minor keys arrive as "G-", "G–" (en dash), stray spaces. Normalize to "Gm". */
function normKey(raw: string): string | null {
  const k = norm(raw);
  if (!k) return null;
  const minor = k.match(/^([A-G][b#♭♯]?)\s*[-–—]$/);
  if (minor) return `${minor[1]}m`;
  return k;
}

/**
 * Extract wiki-link targets from a cell. Handles [[Name]], full-vault-path
 * links (take the last path segment), |alias and #heading parts. Skips
 * ![[...]] embeds.
 */
function extractLinks(cell: string): string[] {
  const out: string[] = [];
  const re = /(!?)\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cell)) !== null) {
    if (m[1] === "!") continue; // embed (PDFs etc.)
    let target = m[2];
    target = target.split("|")[0].split("#")[0];
    const segs = target.split("/");
    const name = norm(segs[segs.length - 1]);
    if (name) out.push(name);
  }
  return out;
}

/** Split a markdown table row into cells; pipes inside [[...]] are safe. */
function splitRow(line: string): string[] {
  const masked = line.replace(/\[\[[^\]]*\]\]/g, (s) => s.replace(/\|/g, "\u0001"));
  let cells = masked.split("|").map((c) => c.replace(/\u0001/g, "|"));
  // drop leading/trailing empties from the outer pipes
  if (cells.length && cells[0].trim() === "") cells = cells.slice(1);
  if (cells.length && cells[cells.length - 1].trim() === "") cells = cells.slice(0, -1);
  return cells.map((c) => norm(c));
}

interface Table {
  headers: string[]; // lowercased
  rows: string[][];
}

/** Parse the first markdown table under the section whose heading starts with `headingPrefix`. */
function tableUnder(body: string, headingPrefix: string): Table | null {
  const lines = body.split("\n");
  let inSection = false;
  let headers: string[] | null = null;
  const rows: string[][] = [];
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      if (inSection && headers) break;
      inSection = norm(line).replace(/^#+\s*/, "").toLowerCase().startsWith(headingPrefix.toLowerCase());
      continue;
    }
    if (!inSection) continue;
    const t = line.trim();
    if (!t.startsWith("|")) {
      if (headers) break; // table ended
      continue;
    }
    const cells = splitRow(t);
    if (!headers) {
      headers = cells.map((c) => c.toLowerCase());
      continue;
    }
    if (cells.every((c) => /^[:\-\s]*$/.test(c))) continue; // separator row
    rows.push(cells);
  }
  return headers ? { headers, rows } : null;
}

/** Column index whose header contains `name` (lowercase). */
function col(t: Table, name: string): number {
  return t.headers.findIndex((h) => h.includes(name));
}

/** Bullet lines under the section whose heading starts with `headingPrefix`. */
function bulletsUnder(body: string, headingPrefix: string): string[] {
  const lines = body.split("\n");
  let inSection = false;
  const out: string[] = [];
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      if (inSection) break;
      inSection = norm(line).replace(/^#+\s*/, "").toLowerCase().startsWith(headingPrefix.toLowerCase());
      continue;
    }
    if (inSection && /^\s*-\s+/.test(line)) out.push(norm(line.replace(/^\s*-\s+/, "")));
  }
  return out;
}

/** Tiny YAML-subset frontmatter parser: scalars and string lists. */
function frontmatter(text: string): { fm: Record<string, string | string[]>; body: string } {
  if (!text.startsWith("---")) return { fm: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { fm: {}, body: text };
  const raw = text.slice(4, end);
  const body = text.slice(text.indexOf("\n", end + 1) + 1);
  const fm: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of raw.split("\n")) {
    const li = line.match(/^\s+-\s*(.+)$/);
    if (li && listKey) {
      (fm[listKey] as string[]).push(norm(li[1].replace(/^["']|["']$/g, "")));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) {
      const key = kv[1];
      const val = norm(kv[2]).replace(/^["']|["']$/g, "");
      if (val === "") {
        fm[key] = [];
        listKey = key;
      } else {
        fm[key] = val;
        listKey = null;
      }
    }
  }
  return { fm, body };
}

function* mdFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      yield* mdFiles(p);
    } else if (
      entry.endsWith(".md") &&
      !entry.endsWith(" - Master.md") &&
      !SKIP_FILES.has(entry)
    ) {
      yield p;
    }
  }
}

const fileTitle = (p: string) => basename(p, ".md");

// ---------------------------------------------------------------------------
// Data shapes

interface Person {
  id: string;
  name: string;
  instrument: string | null;
  type: "PERSON" | "ENSEMBLE";
  style: string | null;
}
interface Tune {
  id: string;
  title: string;
  composer: string | null;
  composerId: string | null;
  style: string | null;
}
interface Recording {
  id: string;
  tuneId: string;
  artistIds: string[];
  albumId: string | null;
  key: string | null;
  bpm: number | null;
  melody: string | null;
}
interface Credit {
  artistId: string;
  instrument: string | null;
}
interface Album {
  id: string;
  title: string;
  year: number | null;
  recordingYear: number | null;
  label: string | null;
  artistIds: string[];
  credits: Credit[];
  tracks: { tuneId: string; key: string | null }[];
}
interface Work {
  bwv: number;
  title: string;
}
interface Movement {
  id: string;
  bwv: number;
  name: string;
  key: string | null;
  order: number;
}
interface MovementRecording {
  id: string;
  movementId: string;
  performerId: string;
  label: string | null;
  character: string | null;
  notes: string | null;
  bpm: number | null;
}

const warnings: string[] = [];
const errors: string[] = [];
const warn = (msg: string) => warnings.push(msg);

// ---------------------------------------------------------------------------
// Parse

const vaultArg = process.argv[2];
const defaultVault = join(homedir(), "Documents", "Obsidian", "Personal", "Music");
const vault = vaultArg ?? (existsSync(defaultVault) ? defaultVault : null);
if (!vault || !existsSync(vault)) {
  console.error("Vault path required: npm run seed -- /path/to/Personal/Music");
  process.exit(1);
}
const jazz = join(vault, "Jazz Tunes");
const composers = join(vault, "Composers");

// --- People: jazz artists + Bach performers share ONE pool ------------------
const people = new Map<string, Person>();

for (const p of mdFiles(join(jazz, "Artists"))) {
  const { fm } = frontmatter(readFileSync(p, "utf8"));
  const name = typeof fm.name === "string" && fm.name ? fm.name : fileTitle(p);
  const instrument = typeof fm.instrument === "string" ? fm.instrument : null;
  const id = slug(fileTitle(p));
  // Variant spellings of the same person (Gomez / Gómez) slug to one id on
  // purpose: same name, same key. First file wins; no warning.
  if (people.has(id)) continue;
  people.set(id, {
    id,
    name,
    instrument,
    type: p.includes("/Groups/") ? "ENSEMBLE" : "PERSON",
    style: typeof fm.style === "string" ? fm.style : null,
  });
}

for (const p of mdFiles(join(composers, "Performers"))) {
  const { fm } = frontmatter(readFileSync(p, "utf8"));
  const id = slug(fileTitle(p));
  if (people.has(id)) continue; // crossover person: jazz record wins, Bach data attaches by id
  people.set(id, {
    id,
    name: fileTitle(p),
    instrument: typeof fm.instrument === "string" ? fm.instrument : null,
    type: "PERSON",
    style: null,
  });
}

// --- Tunes + recordings ------------------------------------------------------
const tunes = new Map<string, Tune>();
const recordings: Recording[] = [];

for (const p of mdFiles(join(jazz, "Tunes"))) {
  const { fm, body } = frontmatter(readFileSync(p, "utf8"));
  const title = fileTitle(p);
  const id = slug(title);
  if (tunes.has(id)) {
    warn(`duplicate tune file merged: ${title}`);
  } else {
    const composer = typeof fm.composer === "string" && fm.composer ? fm.composer : null;
    const composerId = composer && people.has(slug(composer)) ? slug(composer) : null;
    tunes.set(id, {
      id,
      title,
      composer,
      composerId,
      style: typeof fm.style === "string" ? fm.style : null,
    });
  }

  const t = tableUnder(body, "Recordings");
  if (!t) continue;
  const cArtist = col(t, "artist");
  const cAlbum = col(t, "album");
  const cKey = col(t, "key");
  const cBpm = col(t, "bpm");
  const cMelody = col(t, "melody");
  for (const row of t.rows) {
    const artistNames = cArtist >= 0 ? extractLinks(row[cArtist] ?? "") : [];
    if (artistNames.length === 0) continue; // not a recording row
    let artistIds = artistNames.map(slug);
    if (artistIds.some((a) => JUNK_ARTIST_SLUGS.has(a))) {
      warn(`junk recording row dropped: [[${artistNames.join("/")}]] in ${basename(p)}`);
      continue;
    }
    const albumLinks = cAlbum >= 0 ? extractLinks(row[cAlbum] ?? "") : [];
    let albumId: string | null = albumLinks.length ? slug(albumLinks[0]) : null;
    if (albumId && PLACEHOLDER_ALBUMS.has(albumId)) albumId = null;
    const bpmRaw = cBpm >= 0 ? norm(row[cBpm] ?? "") : "";
    const melodyRaw = cMelody >= 0 ? norm(row[cMelody] ?? "") : "";
    recordings.push({
      id: `${id}::${albumId ?? "no-album"}::${artistIds.join("+")}`,
      tuneId: id,
      artistIds,
      albumId,
      key: cKey >= 0 ? normKey(row[cKey] ?? "") : null,
      bpm: /^\d+$/.test(bpmRaw) ? parseInt(bpmRaw, 10) : null,
      melody: melodyRaw || null,
    });
  }
}

// --- Albums ------------------------------------------------------------------
const albums = new Map<string, Album>();

for (const p of mdFiles(join(jazz, "Albums"))) {
  const title = fileTitle(p);
  const id = slug(title);
  if (PLACEHOLDER_ALBUMS.has(id)) continue; // placeholder files: recordings keep null album
  const { fm, body } = frontmatter(readFileSync(p, "utf8"));

  const fmArtists = Array.isArray(fm.artist) ? fm.artist : typeof fm.artist === "string" ? [fm.artist] : [];
  const artistIds = fmArtists
    .filter((a) => a && a.toLowerCase() !== "various")
    .map(slug)
    .filter((a) => a.length > 0);

  const credits: Credit[] = [];
  for (const b of bulletsUnder(body, "Personnel")) {
    const links = extractLinks(b);
    if (links.length === 0) continue;
    const after = b.slice(b.lastIndexOf("]]") + 2);
    const dm = after.match(/^\s*[-–—]\s*(.+)$/);
    credits.push({ artistId: slug(links[0]), instrument: dm ? norm(dm[1]) : null });
  }

  const tracks: { tuneId: string; key: string | null }[] = [];
  const tt = tableUnder(body, "Tunes");
  if (tt) {
    const cTune = col(tt, "tune");
    const cKey = col(tt, "key");
    for (const row of tt.rows) {
      const links = cTune >= 0 ? extractLinks(row[cTune] ?? "") : [];
      if (links.length === 0) continue;
      tracks.push({ tuneId: slug(links[0]), key: cKey >= 0 ? normKey(row[cKey] ?? "") : null });
    }
  }

  const yr = typeof fm.year === "string" && /^\d{4}$/.test(fm.year) ? parseInt(fm.year, 10) : null;
  const ry =
    typeof fm.recording_year === "string" && /^\d{4}$/.test(fm.recording_year)
      ? parseInt(fm.recording_year, 10)
      : null;

  const existing = albums.get(id);
  if (existing) {
    // Variant spelling of the same album ("Where Would I Be?" / "Where Would
    // I Be"): one album, union of the data. First file wins on metadata.
    existing.year ??= yr;
    existing.recordingYear ??= ry;
    existing.label ??= typeof fm.label === "string" && fm.label ? fm.label : null;
    if (existing.artistIds.length === 0) existing.artistIds = artistIds;
    existing.credits.push(...credits);
    for (const tr of tracks) {
      if (!existing.tracks.some((t) => t.tuneId === tr.tuneId)) existing.tracks.push(tr);
    }
    continue;
  }
  albums.set(id, {
    id,
    title,
    year: yr,
    recordingYear: ry,
    label: typeof fm.label === "string" && fm.label ? fm.label : null,
    artistIds,
    credits,
    tracks,
  });
}

// --- Bach: works, movements, movement recordings ------------------------------
const works = new Map<number, Work>();
const movementOrder = new Map<string, number>(); // "996:allemande" -> index

{
  const master = readFileSync(join(composers, "Works – Master.md"), "utf8");
  let currentBwv: number | null = null;
  let expectMovements = false;
  let idx = 0;
  for (const line of master.split("\n")) {
    // Match ## or ### headings that start a BWV work entry.
    const h = norm(line).match(/^#{2,3}\s+BWV\s+(\d+)\s+[-–—]\s+(.+)$/);
    if (h) {
      currentBwv = parseInt(h[1], 10);
      // Strip trailing " — performer info" from the title if present.
      const title = norm(h[2]).replace(/\s+[-–—].*$/, "").trim();
      works.set(currentBwv, { bwv: currentBwv, title });
      idx = 0;
      expectMovements = true;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      // Any non-BWV heading closes the open section.
      currentBwv = null;
      expectMovements = false;
      continue;
    }
    if (expectMovements && currentBwv !== null) {
      // Movement links appear as [[Name]] · [[Name]] · ... on the line after the heading.
      const links = extractLinks(line);
      if (links.length > 0) {
        for (const link of links) {
          movementOrder.set(`${currentBwv}:${slug(link)}`, idx++);
        }
        expectMovements = false;
      }
    }
  }
}

const movements = new Map<string, Movement>();
const movementRecordings: MovementRecording[] = [];

for (const p of mdFiles(join(composers, "Works", "Bach"))) {
  const { fm, body } = frontmatter(readFileSync(p, "utf8"));
  const workRef = typeof fm.work === "string" ? fm.work : "";
  const bwvMatch = workRef.match(/(\d+)/);
  if (!bwvMatch) {
    errors.push(`movement without work frontmatter: ${p}`);
    continue;
  }
  const bwv = parseInt(bwvMatch[1], 10);
  // Skip movement files for works not in the master index (e.g. _review works).
  if (!works.has(bwv)) continue;
  const name = typeof fm.movement === "string" && fm.movement ? fm.movement : fileTitle(p);
  const id = `bwv-${bwv}-${slug(name)}`;
  movements.set(id, {
    id,
    bwv,
    name,
    key: typeof fm.key === "string" && fm.key ? fm.key : null,
    order: movementOrder.get(`${bwv}:${slug(name)}`) ?? 99,
  });

  const t = tableUnder(body, "Recordings");
  if (!t) continue;
  // Table columns: | Artist | Audio | Album | Key | notes | bpm |
  // "Album" holds the label/source; "notes" has "Character · detail" merged.
  const cPerf = col(t, "artist");
  const cRec = col(t, "album");
  const cNotes = col(t, "notes");
  const cBpm = col(t, "bpm");
  for (const row of t.rows) {
    const perf = cPerf >= 0 ? extractLinks(row[cPerf] ?? "") : [];
    if (perf.length === 0) continue;
    const performerId = slug(perf[0]);
    const labelRaw = cRec >= 0 ? norm(row[cRec] ?? "") : "";
    const notesRaw = cNotes >= 0 ? norm(row[cNotes] ?? "") : "";
    const bpmRaw = cBpm >= 0 ? norm(row[cBpm] ?? "") : "";
    // "notes" column format: "Character · detail text" or just "detail text".
    const dotIdx = notesRaw.indexOf(" · ");
    const character = dotIdx >= 0 ? notesRaw.slice(0, dotIdx) : null;
    const notes = dotIdx >= 0 ? notesRaw.slice(dotIdx + 3) : notesRaw || null;
    movementRecordings.push({
      id: `${id}::${performerId}`,
      movementId: id,
      performerId,
      label: labelRaw && !/^[-–—]$/.test(labelRaw) ? labelRaw : null,
      character: character || null,
      notes: notes || null,
      bpm: /^\d+$/.test(bpmRaw) ? parseInt(bpmRaw, 10) : null,
    });
  }
}

// ---------------------------------------------------------------------------
// Referential-integrity gate: fail loudly on ANY dangling reference.

for (const r of recordings) {
  for (const a of r.artistIds) if (!people.has(a)) errors.push(`recording ${r.id}: dangling artist ${a}`);
  if (!tunes.has(r.tuneId)) errors.push(`recording ${r.id}: dangling tune ${r.tuneId}`);
  if (r.albumId && !albums.has(r.albumId)) errors.push(`recording ${r.id}: dangling album ${r.albumId}`);
}
for (const al of albums.values()) {
  for (const a of al.artistIds) if (!people.has(a)) errors.push(`album ${al.id}: dangling artist ${a}`);
  for (const c of al.credits) if (!SKIP_PERSONNEL_SLUGS.has(c.artistId) && !people.has(c.artistId)) errors.push(`album ${al.id}: dangling personnel ${c.artistId}`);
  for (const tr of al.tracks) if (!tunes.has(tr.tuneId)) errors.push(`album ${al.id}: dangling tune ${tr.tuneId}`);
}
for (const t of tunes.values()) {
  if (t.composerId && !people.has(t.composerId)) errors.push(`tune ${t.id}: dangling composer ${t.composerId}`);
}
for (const m of movements.values()) {
  if (!works.has(m.bwv)) errors.push(`movement ${m.id}: dangling work BWV ${m.bwv}`);
}
for (const mr of movementRecordings) {
  if (!people.has(mr.performerId)) errors.push(`movement recording ${mr.id}: dangling performer ${mr.performerId}`);
  if (!movements.has(mr.movementId)) errors.push(`movement recording ${mr.id}: dangling movement ${mr.movementId}`);
}

// ---------------------------------------------------------------------------
// Count gate

const counts = {
  people: people.size,
  ensembles: [...people.values()].filter((p) => p.type === "ENSEMBLE").length,
  albums: albums.size,
  tunes: tunes.size,
  recordings: recordings.length,
  personnelEdges: [...albums.values()].reduce((n, a) => n + a.credits.length, 0),
  works: works.size,
  movements: movements.size,
  movementRecordings: movementRecordings.length,
  warnings: warnings.length,
};

console.log("Parsed:", counts);
for (const w of warnings) console.log("  warning:", w);

for (const [k, v] of Object.entries(EXPECTED)) {
  if ((counts as Record<string, number>)[k] !== v) {
    errors.push(`count mismatch: ${k} = ${(counts as Record<string, number>)[k]}, expected ${v}`);
  }
}

if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors.slice(0, 50)) console.error("  " + e);
  if (errors.length > 50) console.error(`  ... and ${errors.length - 50} more`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Emit

const outDir = join(import.meta.dirname, "..", "seed");
mkdirSync(outDir, { recursive: true });

const byId = <T extends { id: string }>(m: Map<string, T>) =>
  [...m.values()].sort((a, b) => a.id.localeCompare(b.id));

writeFileSync(join(outDir, "artists.json"), JSON.stringify({ people: byId(people) }, null, 1));
writeFileSync(
  join(outDir, "catalog.json"),
  JSON.stringify(
    {
      tunes: byId(tunes),
      albums: byId(albums),
      recordings: recordings.sort((a, b) => a.id.localeCompare(b.id)),
    },
    null,
    1,
  ),
);
writeFileSync(
  join(outDir, "classical.json"),
  JSON.stringify(
    {
      works: [...works.values()].sort((a, b) => a.bwv - b.bwv),
      movements: [...movements.values()].sort((a, b) => a.bwv - b.bwv || a.order - b.order),
      movementRecordings: movementRecordings.sort((a, b) => a.id.localeCompare(b.id)),
    },
    null,
    1,
  ),
);

console.log(`\nIntegrity gate passed. Seed written to ${outDir}`);
