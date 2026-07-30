/**
 * Vault parser / seeder for the music federation demo.
 *
 * Reads the Obsidian vault (read-only), emits seed/artists.json,
 * seed/catalog.json, seed/discography.json, and fails loudly if any
 * reference dangles or the entity counts drift from the verified numbers.
 *
 * Three trees feed three subgraphs, all flat since the 2026-07-16 vault-wide
 * schema unification (see vault/_meta/CLAUDE.md):
 *   - who plays  -> artists.json     (Artists/, ensembles flagged by
 *                                     instrument: ensemble|group, group
 *                                     Personnel sections)
 *   - what music exists -> catalog.json (Pieces/Works, Pieces/Tunes, contrafacts)
 *   - who recorded what -> discography.json (Albums/, unified Recordings)
 *
 * Usage:
 *   npm run seed -- /path/to/Personal/Music
 *   (defaults to ~/Documents/Obsidian/Personal/Music if it exists)
 */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Expected state of the vault, re-verified 2026-07-29 (previously verified
// 2026-07-20; the numbers moved for two reasons found in this reseed: real
// content growth -- see _meta/Flamenco Artists to Fix.md's 2026-07-26 pass,
// which alone added 36 artist stubs plus backlink/misspelling fixes -- and a
// vault-wide Personnel format change, bullets -> a "Musician | Instrument"
// table (see tablesUnder), which the parser silently mis-read as zero
// credits until this pass taught it the new shape. A `Pieces/Palos/` folder
// (flamenco palo reference pages) also appeared; it's out of scope for the
// seeder for now (see the comment by `metaDir`) and doesn't affect any count
// below. If the seeder reports different numbers than these, the parser is
// wrong -- not the vault. Do not edit these to make a failing run pass.
//
// Same-day follow-up (also 2026-07-29): closed out the two items
// _meta/Flamenco Artists to Fix.md had left open. Created the 5
// MISSING_PIECE_TRACKS tune files (tunes +5), and merged the duplicate
// Paseo de los Castaños album pair into the one correctly-disambiguated file
// (albums -1; personnelEdges -1, net of losing the EmArcy file's 2 credits
// and gaining 1 on the merged file; recordings +4, net of the 5 new tunes'
// own Recordings rows and collapsing La Vacilona's two parallel recordings
// -- one per duplicate album -- into the one correct recording, which now
// carries its true performers, Tomatito + George Benson, instead of the
// album-fallback's Tomatito-only guess).
//
// Cross-checks behind the numbers:
//   - works 10          = 9 BWV headings in _meta/Works – Master.md + Concierto de Aranjuez
//   - movements 22      = movement files under Pieces/Works (22)
//   - tunes 411         = 412 Pieces/Tunes files - 1 (Other tunes.md skipped)
//   - contrafactEdges 18 = as of 2026-07-30: three parents carry ## Contrafacts
//                         sections — "All The Things You Are" (3: Bird of
//                         Paradise, Ablution, Prince Albert), "How High the
//                         Moon" (2: Ornithology, Lennie-Bird), and "I Got
//                         Rhythm" (13 rhythm-changes children). Blues-form
//                         tunes remain deliberately parentless.
//   - albums 768        = 771 Albums/ files - 3 placeholders that exist as
//                         files and are skipped (YouTube, Late Night Jazz
//                         (compilation), Baroquswing Vol. II). The other 3
//                         PLACEHOLDER_ALBUMS entries (Blues in the Closet,
//                         The Jody Grind, The Thumper) are self-titled
//                         one-off sets with no backing file at all -- they
//                         never counted against this total either side of
//                         the reorg, only resolved when a recording's Album
//                         cell links to them.
//   - people 1378       = 1329 Artists/ files (independently re-slugged: no
//                         collisions) + 49 composer stubs
//   - ensembles 66      = Artists/ files with instrument: ensemble (51) or
//                         instrument: group (15)
//   - memberships 275   = independently re-summed: every "- [[...]]" bullet
//                         under ## Personnel across all ensemble/group files
//   - personnelEdges 2757 = independently re-summed against the new table
//                         format: every linked Musician cell across every
//                         non-placeholder album's ## Personnel table(s),
//                         expanding multi-name cells ("Wynton Kelly / Cedar
//                         Walton / McCoy Tyner") into one credit per name,
//                         minus bob-prince (skipped by name)
//   - recordings 1294   = tune rows + movement rows + album track rows with no
//                         matching (piece, album) recording; grew with the
//                         184 -> 411 tune count and 717 -> 768 album count.
//                         No independent hand recount -- verified via the
//                         referential-integrity gate only.
//   - warnings 1        = "Ralph Lalama & His Manhattan All Stars" (Feelin'
//                         and Dealin') has no Artists/ file of its own; the
//                         real personnel are still credited individually
const EXPECTED = {
  people: 1378,
  ensembles: 66,
  composerStubs: 49,
  memberships: 275,
  works: 10,
  movements: 22,
  tunes: 411,
  contrafactEdges: 18,
  albums: 768,
  personnelEdges: 2757,
  recordings: 1294,
  warnings: 1,
};

const SKIP_FILES = new Set(["CLAUDE.md", "Albums to fix.md", "Other tunes.md"]);
// Self-titled compilation/one-off albums with no backing Album file -- same
// treatment as the pre-reorg placeholders: recordings keep a null album and
// carry the name as source. Found as dangling self-titled links during the
// 2026-07-20 reseed (each tune is the only source for its own eponymous set).
const PLACEHOLDER_ALBUMS = new Set([
  "youtube",
  "late-night-jazz-compilation",
  "baroquswing-vol-ii",
  "blues-in-the-closet",
  "the-jody-grind",
  "the-thumper",
]);
const JUNK_ARTIST_SLUGS = new Set(["georgie-gershwin"]);
// Personnel credits for arrangers/producers who don't have artist files and
// don't need one. Their credits are dropped (Credit.artist is non-null now).
const SKIP_PERSONNEL_SLUGS = new Set(["bob-prince"]);
// Known misspellings in album frontmatter `artist:` lists that don't match
// their Artists/ file slug (found during the 2026-07-20 reseed). Vault is
// read-only, so corrected here rather than in the source file.
const ARTIST_SLUG_ALIAS: Record<string, string> = {
  "esperanca-spalding": "esperanza-spalding", // Chamber Music Society.md: "Esperança"
};

// ---------------------------------------------------------------------------
// Helpers

/** Normalize whitespace: non-breaking spaces -> spaces, trim. */
function norm(s: string): string {
  return s.replace(/ /g, " ").trim();
}

/**
 * Slug: lowercase, diacritics stripped, punctuation removed, spaces -> hyphens.
 * So "Where Would I Be?" and "Where Would I Be" collapse to one id, variant
 * spellings like Gómez/Gomez merge, and "J.J. Johnson" (jj-johnson) stays
 * distinct from "J J Johnson" (j-j-johnson) -- both exist in the vault.
 * Person slugs are the shared @key across all three subgraphs.
 */
function slug(s: string): string {
  return norm(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
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
 * links (take the last path segment) and |alias parts. Skips ![[...]] embeds.
 * Does NOT strip a "#" suffix: the vault has real filenames containing a
 * literal "#" (This Is Jazz #14) and zero legitimate heading-anchor links, so
 * treating "#" as an anchor separator would truncate a valid link target.
 */
function extractLinks(cell: string): string[] {
  const out: string[] = [];
  const re = /(!?)\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cell)) !== null) {
    if (m[1] === "!") continue; // embed (PDFs etc.)
    let target = m[2];
    target = target.split("|")[0];
    const segs = target.split("/");
    const name = norm(segs[segs.length - 1]);
    if (name) out.push(name);
  }
  return out;
}

/** Split a markdown table row into cells; pipes inside [[...]] are safe. */
function splitRow(line: string): string[] {
  const masked = line.replace(/\[\[[^\]]*\]\]/g, (s) => s.replace(/\|/g, ""));
  let cells = masked.split("|").map((c) => c.replace(//g, "|"));
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

/**
 * All markdown tables under the section whose heading starts with
 * `headingPrefix`, including tables nested under further sub-headings inside
 * that section (e.g. `### Session 1 (with Duvivier/Taylor)` grouping two
 * Personnel tables on The Roost Sessions (Bud Powell)). Stops at the next
 * heading whose level is <= the section heading's own level. Unlike
 * `tableUnder`, a sub-heading does not end the section -- it just starts a
 * new table within it.
 */
function tablesUnder(body: string, headingPrefix: string): Table[] {
  const lines = body.split("\n");
  let sectionLevel: number | null = null;
  let inSection = false;
  const tables: Table[] = [];
  let headers: string[] | null = null;
  let rows: string[][] = [];
  const flush = () => {
    if (headers) tables.push({ headers, rows });
    headers = null;
    rows = [];
  };
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s(.*)$/);
    if (h) {
      const level = h[1].length;
      if (inSection) {
        flush();
        if (level <= (sectionLevel as number)) {
          inSection = false;
          sectionLevel = null;
        }
        continue;
      }
      if (norm(h[2]).toLowerCase().startsWith(headingPrefix.toLowerCase())) {
        inSection = true;
        sectionLevel = level;
      }
      continue;
    }
    if (!inSection) continue;
    const t = line.trim();
    if (!t.startsWith("|")) {
      flush();
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
  if (inSection) flush();
  return tables;
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

/**
 * Non-empty lines under the section whose heading starts with `headingPrefix`,
 * unlike bulletsUnder these are plain lines, not "- " bullets (used for the
 * post-reorg ## Contrafacts section: "[[Child]] - Composer" per line).
 */
function linesUnder(body: string, headingPrefix: string): string[] {
  const lines = body.split("\n");
  let inSection = false;
  const out: string[] = [];
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      if (inSection) break;
      inSection = norm(line).replace(/^#+\s*/, "").toLowerCase().startsWith(headingPrefix.toLowerCase());
      continue;
    }
    if (inSection) {
      const t = norm(line);
      if (t) out.push(t);
    }
  }
  return out;
}

/**
 * First prose paragraph under the section whose heading starts with
 * `headingPrefix` (or, with prefix null, directly under the `# Title` line).
 * Skips bullets, tables, and the **Axes:** line. Returns null when empty.
 */
function proseUnder(body: string, headingPrefix: string | null): string | null {
  const lines = body.split("\n");
  let inSection = headingPrefix === null;
  const para: string[] = [];
  for (const line of lines) {
    if (/^#\s/.test(line) && headingPrefix === null) {
      inSection = true; // start after the title line
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      if (para.length) break;
      inSection =
        headingPrefix !== null &&
        norm(line).replace(/^#+\s*/, "").toLowerCase().startsWith(headingPrefix.toLowerCase());
      continue;
    }
    if (!inSection) continue;
    const t = norm(line);
    if (!t) {
      if (para.length) break;
      continue;
    }
    if (/^[-|*]/.test(t) || t.startsWith("**Axes:**")) {
      if (para.length) break;
      continue;
    }
    para.push(t);
  }
  const text = para.join(" ").trim();
  return text || null;
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

/** Leading roman numeral of a movement name ("II. Adagio" -> 2), else null. */
function romanLead(name: string): number | null {
  const m = norm(name).match(/^([IVXLC]+)[.\s]/);
  if (!m) return null;
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let total = 0;
  let prev = 0;
  for (const ch of m[1].split("").reverse()) {
    const v = map[ch];
    if (v < prev) total -= v;
    else {
      total += v;
      prev = v;
    }
  }
  return total || null;
}

// ---------------------------------------------------------------------------
// Data shapes (mirror subgraphs/lib/seed-types.ts)

type Genre = "CLASSICAL" | "JAZZ" | "FLAMENCO" | "BLUEGRASS";
interface Person {
  id: string;
  name: string;
  kind: "PERSON" | "ENSEMBLE";
  instruments: string[];
  styles: string[];
  bio: string | null;
  stub: boolean;
}
interface Membership {
  groupId: string;
  memberId: string;
  role: string | null;
}
interface Work {
  id: string;
  title: string;
  catalogNumber: string | null;
  composerId: string | null;
  genre: Genre;
}
interface Movement {
  id: string;
  workId: string;
  title: string;
  position: number | null;
  musicalKey: string | null;
  genre: Genre;
}
interface Tune {
  id: string;
  title: string;
  composerId: string | null;
  style: string | null;
  contrafactOfId: string | null;
  musicalKey: string | null;
  palo: string | null;
  genre: Genre;
}
interface Credit {
  artistId: string;
  role: string | null;
}
interface Album {
  id: string;
  title: string;
  year: number | null;
  label: string | null;
  artistIds: string[];
  credits: Credit[];
  trackIds: string[];
}
interface Recording {
  id: string;
  pieceId: string;
  albumId: string | null;
  performerIds: string[];
  performanceKey: string | null;
  palo: string | null;
  idiom: string | null;
  source: string | null;
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
const artistsDir = join(vault, "Artists");
const albumsDir = join(vault, "Albums");
const tunesDir = join(vault, "Pieces", "Tunes");
const worksDir = join(vault, "Pieces", "Works");
const metaDir = join(vault, "_meta");
// Pieces/Palos/ (flamenco palo reference pages, type: palo) arrived in the
// vault as of the 2026-07-29 reseed, linked from a Palo column in flamenco
// albums' Tunes tables and tune frontmatter/recordings. The reference pages
// themselves are still not read: they're reference data, not a piece or an
// entity any subgraph owns. As of 2026-07-30 Brendan asked for palo as a
// string field on Tune (home) and Recording (per-performance), mirroring
// musicalKey/performanceKey — so those columns and frontmatter are parsed
// below. A Genre-style Palos entity remains a deliberate future call.

// --- People: jazz, flamenco, and classical artists share ONE flat pool -------
// (there is no separate "classical subgraph" convention -- see _meta/CLAUDE.md)
const people = new Map<string, Person>();
const membershipSources: { groupId: string; file: string; body: string }[] = [];

function addArtistFile(p: string): void {
  const { fm, body } = frontmatter(readFileSync(p, "utf8"));
  const name = typeof fm.name === "string" && fm.name ? fm.name : fileTitle(p);
  const id = slug(fileTitle(p));
  const instrument = typeof fm.instrument === "string" ? fm.instrument : null;
  // Ensembles are flagged by frontmatter now, not a Groups/ folder.
  const isEnsemble = !!instrument && ["ensemble", "group"].includes(instrument.toLowerCase());
  const kind: "PERSON" | "ENSEMBLE" = isEnsemble ? "ENSEMBLE" : "PERSON";
  if (isEnsemble && bulletsUnder(body, "Personnel").length > 0) {
    membershipSources.push({ groupId: id, file: p, body });
  }
  // Variant spellings of the same person (Gomez / Gómez) slug to one id on
  // purpose: same name, same key. First file wins; no warning.
  if (people.has(id)) return;
  // "ensemble"/"group" is a kind marker, not an instrument.
  const instruments = instrument && !isEnsemble ? [instrument] : [];
  const style = typeof fm.style === "string" && fm.style ? fm.style : null;
  people.set(id, {
    id,
    name,
    kind,
    instruments,
    styles: style ? [style] : [],
    bio: proseUnder(body, "Profile") ?? proseUnder(body, null),
    stub: false,
  });
}

for (const p of mdFiles(artistsDir)) addArtistFile(p);

// Composers named in tune/work frontmatter but without a vault file become
// stub artists: real people, real names from the vault, no identity data
// beyond the name. This is what lets composer edges resolve into the shared
// person pool instead of staying display strings.
function composerRef(nameRaw: string | undefined): string | null {
  const name = typeof nameRaw === "string" ? norm(nameRaw) : "";
  if (!name) return null;
  const id = slug(name);
  if (!id) return null;
  if (!people.has(id)) {
    people.set(id, {
      id,
      name,
      kind: "PERSON",
      instruments: [],
      styles: [],
      bio: null,
      stub: true,
    });
  }
  return id;
}

// --- Memberships (group Personnel bullets) -----------------------------------
const memberships: Membership[] = [];
for (const { groupId, body } of membershipSources) {
  for (const b of bulletsUnder(body, "Personnel")) {
    const links = extractLinks(b);
    if (links.length === 0) continue;
    const after = b.slice(b.lastIndexOf("]]") + 2);
    const dm = after.match(/^\s*[-–—]\s*(.+)$/);
    memberships.push({ groupId, memberId: slug(links[0]), role: dm ? norm(dm[1]) : null });
  }
}

// --- Classical works + movements ---------------------------------------------
// Works come from the master index ("## <Composer> - <WorkRef>" headings, one
// per composer since the reorg -- previously Bach-only with a descriptive
// title in the heading). The reorg dropped the descriptive title text from
// the vault entirely, so Work.title falls back to the catalog number (or the
// work name when there isn't one, e.g. Concierto de Aranjuez) -- no invented
// musicological titles. Other composers' works are created from movement
// frontmatter on first sight, as a safety net if a work is missing from the
// master index.
const works = new Map<string, Work>();
const movementOrder = new Map<string, number>(); // "bwv-996:allemande" -> index

{
  const master = readFileSync(join(metaDir, "Works – Master.md"), "utf8");
  let currentWorkId: string | null = null;
  let expectMovements = false;
  let idx = 0;
  for (const line of master.split("\n")) {
    const h = norm(line).match(/^#{2,3}\s+(.+?)\s+-\s+(.+)$/);
    if (h) {
      const composerName = h[1];
      const workRef = h[2];
      const bwvMatch = workRef.match(/BWV\s*(\d+)/i);
      const catalogNumber = bwvMatch ? `BWV ${parseInt(bwvMatch[1], 10)}` : null;
      currentWorkId = bwvMatch ? `bwv-${parseInt(bwvMatch[1], 10)}` : slug(workRef);
      works.set(currentWorkId, {
        id: currentWorkId,
        title: catalogNumber ?? workRef,
        catalogNumber,
        composerId: composerRef(composerName),
        genre: "CLASSICAL",
      });
      idx = 0;
      expectMovements = true;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      currentWorkId = null;
      expectMovements = false;
      continue;
    }
    if (expectMovements && currentWorkId !== null) {
      const links = extractLinks(line);
      if (links.length > 0) {
        for (const link of links) {
          movementOrder.set(`${currentWorkId}:${slug(link)}`, idx++);
        }
        expectMovements = false;
      }
    }
  }
}

const movements = new Map<string, Movement>();
// Album track tables and tune-style references link movement FILES, whose
// filename slug ("147-jesu-joy-of-mans-desiring") differs from the movement id
// ("bwv-147-jesu-joy-of-mans-desiring"). This map bridges the two.
const movementByFileSlug = new Map<string, string>();
// Movement recordings are parsed later, into the unified recordings list, but
// the rows live in the movement files: stash the tables while walking them.
const movementRecordingSources: { movementId: string; file: string; body: string }[] = [];

const orderCounter = new Map<string, number>(); // file-order fallback per workId
for (const p of mdFiles(worksDir)) {
  const { fm, body } = frontmatter(readFileSync(p, "utf8"));
  const workRef = typeof fm.work === "string" ? fm.work : "";
  const composer = typeof fm.composer === "string" ? fm.composer : "";
  const title = typeof fm.movement === "string" && fm.movement ? fm.movement : fileTitle(p);

  const bwvMatch = workRef.match(/BWV\s*(\d+)/i);
  let workId: string;
  let position: number | null;
  if (bwvMatch) {
    workId = `bwv-${parseInt(bwvMatch[1], 10)}`;
    // Skip movement files for works not in the master index (e.g. _review works).
    if (!works.has(workId)) continue;
    position = movementOrder.get(`${workId}:${slug(title)}`) ?? null;
  } else {
    if (!workRef || !composer) {
      errors.push(`movement without work/composer frontmatter: ${p}`);
      continue;
    }
    workId = slug(workRef);
    if (!works.has(workId)) {
      works.set(workId, {
        id: workId,
        title: workRef,
        catalogNumber: null,
        composerId: composerRef(composer),
        genre: "CLASSICAL",
      });
    }
    // Order by the leading roman numeral (I/II/III), else file-encounter order.
    const roman = romanLead(title);
    if (roman !== null) {
      position = roman;
    } else {
      position = orderCounter.get(workId) ?? 0;
      orderCounter.set(workId, position + 1);
    }
  }
  const id = `${workId}-${slug(title)}`;
  movements.set(id, {
    id,
    workId,
    title,
    position,
    musicalKey: typeof fm.key === "string" && fm.key ? fm.key : null,
    genre: "CLASSICAL",
  });
  movementByFileSlug.set(slug(fileTitle(p)), id);
  movementRecordingSources.push({ movementId: id, file: p, body });
}

// --- Tunes (flat since the reorg; genre is derived from style frontmatter
// rather than a separate folder: flamenco -> FLAMENCO, bluegrass -> BLUEGRASS,
// everything else -> JAZZ) ----------------------------------------------------
const tunes = new Map<string, Tune>();
const tuneRecordingSources: { tuneId: string; file: string; body: string }[] = [];
const tuneBodies = new Map<string, string>(); // tuneId -> body, for the Contrafacts pass

function genreFromStyle(style: string | null): Genre {
  if (style === "flamenco") return "FLAMENCO";
  if (style === "bluegrass") return "BLUEGRASS";
  return "JAZZ";
}

function addTuneFile(p: string): void {
  const { fm, body } = frontmatter(readFileSync(p, "utf8"));
  const title = fileTitle(p);
  const id = slug(title);
  if (tunes.has(id)) {
    warn(`duplicate tune file merged: ${title}`);
  } else {
    const style = typeof fm.style === "string" && fm.style ? fm.style : null;
    const palo = typeof fm.palo === "string" ? extractLinks(fm.palo)[0] ?? null : null;
    tunes.set(id, {
      id,
      title,
      composerId: composerRef(typeof fm.composer === "string" ? fm.composer : undefined),
      style,
      contrafactOfId: null, // resolved after all tunes are known
      musicalKey: typeof fm.key === "string" && fm.key ? fm.key : null,
      palo,
      genre: genreFromStyle(style),
    });
    tuneBodies.set(id, body);
  }
  tuneRecordingSources.push({ tuneId: id, file: p, body });
}

for (const p of mdFiles(tunesDir)) addTuneFile(p);

// A parent tune's own "## Contrafacts" section lists its children, one link
// per line ("[[Child]] - Composer"), replacing the old Contrafacts/<Parent>/
// folder convention -- see the EXPECTED comment above on what this dropped.
let contrafactEdges = 0;
for (const [parentTuneId, body] of tuneBodies) {
  for (const line of linesUnder(body, "Contrafacts")) {
    const links = extractLinks(line);
    if (links.length === 0) continue;
    const childId = slug(links[0]);
    if (!tunes.has(childId)) {
      errors.push(`contrafact under ${parentTuneId}: unknown child tune "${links[0]}"`);
      continue;
    }
    tunes.get(childId)!.contrafactOfId = parentTuneId;
    contrafactEdges++;
  }
}

// Piece is an entity interface: Movement and Tune ids must never collide,
// or two pieces would share one key.
for (const id of tunes.keys()) {
  if (movements.has(id) || movementByFileSlug.has(id)) {
    errors.push(`piece id collision: "${id}" is both a Tune and a Movement`);
  }
}

// --- Albums (jazz + flamenco) --------------------------------------------------
const albums = new Map<string, Album>();
const placeholderName = new Map<string, string>(); // slug -> display title
// Track rows are resolved to recordings after the recordings pass.
const trackRows = new Map<string, { pieceId: string; key: string | null; palo: string | null }[]>();

/** A wiki-link target names a piece: a tune, or a movement file. */
function pieceRef(linkTarget: string): string | null {
  const s = slug(linkTarget);
  if (tunes.has(s)) return s;
  return movementByFileSlug.get(s) ?? null;
}

function addAlbumFile(p: string): void {
  const title = fileTitle(p);
  const id = slug(title);
  if (PLACEHOLDER_ALBUMS.has(id)) {
    placeholderName.set(id, title); // recordings keep a null album, named source
    return;
  }
  const { fm, body } = frontmatter(readFileSync(p, "utf8"));

  const fmArtists = Array.isArray(fm.artist) ? fm.artist : typeof fm.artist === "string" ? [fm.artist] : [];
  const artistIds: string[] = [];
  for (const a of fmArtists) {
    if (!a || /^various(\s+artists)?$/i.test(a.trim())) continue; // not a resolvable entity
    const aid = ARTIST_SLUG_ALIAS[slug(a)] ?? slug(a);
    if (!aid) continue;
    if (!people.has(aid)) {
      // Descriptive band credit with no artist file of its own (e.g. "Ralph
      // Lalama & His Manhattan All Stars") -- the real personnel are still
      // credited individually below. Dropped, not a hard error.
      warn(`album ${id}: artist "${a}" has no Artists/ file, dropped from artistIds`);
      continue;
    }
    artistIds.push(aid);
  }

  // Album Personnel moved from a bullet list to a "Musician | Instrument"
  // table vault-wide (found during the 2026-07-29 reseed -- see tablesUnder).
  // A Musician cell can name more than one person ("Wynton Kelly / Cedar
  // Walton / McCoy Tyner" for a role that varies by track); each linked name
  // becomes its own credit sharing that row's Instrument text.
  const credits: Credit[] = [];
  for (const t of tablesUnder(body, "Personnel")) {
    const cMusician = col(t, "musician");
    const cInstrument = col(t, "instrument");
    for (const row of t.rows) {
      const links = cMusician >= 0 ? extractLinks(row[cMusician] ?? "") : [];
      if (links.length === 0) continue; // plain-text-only credit (no artist file to link)
      const role = cInstrument >= 0 ? norm(row[cInstrument] ?? "") : "";
      for (const link of links) {
        const artistId = slug(link);
        if (SKIP_PERSONNEL_SLUGS.has(artistId)) continue;
        credits.push({ artistId, role: role || null });
      }
    }
  }

  const rows: { pieceId: string; key: string | null; palo: string | null }[] = [];
  // Classical albums use "## Movements" instead of "## Tunes" (same table
  // shape, header "Movement" instead of "Tune").
  let tt = tableUnder(body, "Tunes");
  let pieceColName = "tune";
  if (!tt) {
    tt = tableUnder(body, "Movements");
    pieceColName = "movement";
  }
  if (tt) {
    const cTune = col(tt, pieceColName);
    const cKey = col(tt, "key");
    const cPalo = col(tt, "palo");
    for (const row of tt.rows) {
      const links = cTune >= 0 ? extractLinks(row[cTune] ?? "") : [];
      if (links.length === 0) continue; // untracked track: no piece file in the vault
      const pieceId = pieceRef(links[0]);
      if (!pieceId) {
        errors.push(`album ${id}: track links to unknown piece "${links[0]}"`);
        continue;
      }
      rows.push({
        pieceId,
        key: cKey >= 0 ? normKey(row[cKey] ?? "") : null,
        palo: cPalo >= 0 ? extractLinks(row[cPalo] ?? "")[0] ?? null : null,
      });
    }
  }

  const yr = typeof fm.year === "string" && /^\d{4}$/.test(fm.year) ? parseInt(fm.year, 10) : null;

  const existing = albums.get(id);
  if (existing) {
    // Variant spelling of the same album ("Where Would I Be?" / "Where Would
    // I Be"): one album, union of the data. First file wins on metadata.
    existing.year ??= yr;
    existing.label ??= typeof fm.label === "string" && fm.label ? fm.label : null;
    if (existing.artistIds.length === 0) existing.artistIds = artistIds;
    existing.credits.push(...credits);
    const known = trackRows.get(id)!;
    for (const tr of rows) {
      if (!known.some((t) => t.pieceId === tr.pieceId)) known.push(tr);
    }
    return;
  }
  albums.set(id, {
    id,
    title,
    year: yr,
    label: typeof fm.label === "string" && fm.label ? fm.label : null,
    artistIds,
    credits,
    trackIds: [], // filled after the recordings pass
  });
  trackRows.set(id, rows);
}

for (const p of mdFiles(albumsDir)) addAlbumFile(p);

// --- Recordings: one model for jazz, flamenco, and classical -------------------
const recordings: Recording[] = [];
const recordingIds = new Set<string>();
const byPieceAlbum = new Set<string>(); // "pieceId::albumId" pairs that exist

function pushRecording(r: Omit<Recording, "id">): void {
  const albumPart = r.albumId ?? (r.source ? slug(r.source) : "no-album");
  let id = `${r.pieceId}::${albumPart}::${r.performerIds.join("+") || "unattributed"}`;
  // Two takes of one piece on one album by the same performers: number them.
  for (let n = 2; recordingIds.has(id); n++) {
    id = `${r.pieceId}::${albumPart}::${r.performerIds.join("+") || "unattributed"}::take-${n}`;
  }
  recordingIds.add(id);
  recordings.push({ id, ...r });
  if (r.albumId) byPieceAlbum.add(`${r.pieceId}::${r.albumId}`);
}

/** Parse one Recordings table into unified recordings for the given piece. */
function parseRecordingRows(pieceId: string, file: string, body: string): void {
  const t = tableUnder(body, "Recordings");
  if (!t) return;
  const cArtist = col(t, "artist");
  const cAlbum = col(t, "album");
  const cKey = col(t, "key");
  const cPalo = col(t, "palo");
  const cIdiom = col(t, "idiom");
  const cBpm = col(t, "bpm");
  let cNotes = col(t, "notes");
  if (cNotes === -1) cNotes = col(t, "melody"); // older tune files use "Melody"
  for (const row of t.rows) {
    const artistNames = cArtist >= 0 ? extractLinks(row[cArtist] ?? "") : [];
    if (artistNames.length === 0) continue; // not a recording row
    const performerIds = artistNames.map(slug);
    if (performerIds.some((a) => JUNK_ARTIST_SLUGS.has(a))) {
      warn(`junk recording row dropped: [[${artistNames.join("/")}]] in ${basename(file)}`);
      continue;
    }
    // Album cell: a wiki link is a real album (placeholders become a source
    // string); plain text is a source ("Netherlands Bach Society", a radio
    // orchestra credit, ...). Both null when the cell is empty or a dash.
    const albumCell = cAlbum >= 0 ? (row[cAlbum] ?? "") : "";
    const albumLinks = extractLinks(albumCell);
    let albumId: string | null = null;
    let source: string | null = null;
    if (albumLinks.length > 0) {
      const linked = slug(albumLinks[0]);
      if (PLACEHOLDER_ALBUMS.has(linked)) {
        source = placeholderName.get(linked) ?? albumLinks[0];
      } else {
        albumId = linked;
      }
    } else {
      const text = norm(albumCell);
      source = text && !/^[-–—]$/.test(text) ? text : null;
    }
    const notesRaw = cNotes >= 0 ? norm(row[cNotes] ?? "") : "";
    const bpmRaw = cBpm >= 0 ? norm(row[cBpm] ?? "") : "";
    const idiomRaw = cIdiom >= 0 ? norm(row[cIdiom] ?? "") : "";
    pushRecording({
      pieceId,
      albumId,
      performerIds,
      performanceKey: cKey >= 0 ? normKey(row[cKey] ?? "") : null,
      palo: cPalo >= 0 ? extractLinks(row[cPalo] ?? "")[0] ?? null : null,
      idiom: idiomRaw || null,
      source,
      notes: notesRaw || null,
      bpm: /^\d+$/.test(bpmRaw) ? parseInt(bpmRaw, 10) : null,
    });
  }
}

for (const { tuneId, file, body } of tuneRecordingSources) parseRecordingRows(tuneId, file, body);
for (const { movementId, file, body } of movementRecordingSources) parseRecordingRows(movementId, file, body);

// Album track rows without a matching recording become recordings too: the
// album file states the piece is on the record, and the principal artists are
// the performers of record. No dedupe loss: rows matching an existing
// (piece, album) pair only contribute their key / palo.
for (const [albumId, rows] of trackRows) {
  const album = albums.get(albumId)!;
  for (const tr of rows) {
    if (byPieceAlbum.has(`${tr.pieceId}::${albumId}`)) {
      if (tr.key || tr.palo) {
        for (const r of recordings) {
          if (r.pieceId === tr.pieceId && r.albumId === albumId) {
            if (tr.key && r.performanceKey === null) r.performanceKey = tr.key;
            if (tr.palo && r.palo === null) r.palo = tr.palo;
          }
        }
      }
      continue;
    }
    pushRecording({
      pieceId: tr.pieceId,
      albumId,
      performerIds: album.artistIds,
      performanceKey: tr.key,
      palo: tr.palo,
      idiom: null,
      source: null,
      notes: null,
      bpm: null,
    });
  }
}

// Album.trackIds: the album's track rows, in file order, joined to recordings.
for (const [albumId, rows] of trackRows) {
  const album = albums.get(albumId)!;
  for (const tr of rows) {
    for (const r of recordings) {
      if (r.pieceId === tr.pieceId && r.albumId === albumId && !album.trackIds.includes(r.id)) {
        album.trackIds.push(r.id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Referential-integrity gate: fail loudly on ANY dangling reference.

for (const m of memberships) {
  if (!people.has(m.groupId)) errors.push(`membership: dangling group ${m.groupId}`);
  if (!people.has(m.memberId)) errors.push(`membership ${m.groupId}: dangling member ${m.memberId}`);
}
for (const w of works.values()) {
  if (w.composerId && !people.has(w.composerId)) errors.push(`work ${w.id}: dangling composer ${w.composerId}`);
}
for (const m of movements.values()) {
  if (!works.has(m.workId)) errors.push(`movement ${m.id}: dangling work ${m.workId}`);
}
for (const t of tunes.values()) {
  if (t.composerId && !people.has(t.composerId)) errors.push(`tune ${t.id}: dangling composer ${t.composerId}`);
  if (t.contrafactOfId && !tunes.has(t.contrafactOfId)) {
    errors.push(`tune ${t.id}: dangling contrafact parent ${t.contrafactOfId}`);
  }
}
for (const al of albums.values()) {
  for (const a of al.artistIds) if (!people.has(a)) errors.push(`album ${al.id}: dangling artist ${a}`);
  for (const c of al.credits) if (!people.has(c.artistId)) errors.push(`album ${al.id}: dangling personnel ${c.artistId}`);
}
const isPiece = (id: string) => tunes.has(id) || movements.has(id);
for (const r of recordings) {
  for (const a of r.performerIds) if (!people.has(a)) errors.push(`recording ${r.id}: dangling performer ${a}`);
  if (!isPiece(r.pieceId)) errors.push(`recording ${r.id}: dangling piece ${r.pieceId}`);
  if (r.albumId && !albums.has(r.albumId)) errors.push(`recording ${r.id}: dangling album ${r.albumId}`);
}

// ---------------------------------------------------------------------------
// Count gate

const counts = {
  people: people.size,
  ensembles: [...people.values()].filter((p) => p.kind === "ENSEMBLE").length,
  composerStubs: [...people.values()].filter((p) => p.stub).length,
  memberships: memberships.length,
  works: works.size,
  movements: movements.size,
  tunes: tunes.size,
  contrafactEdges,
  albums: albums.size,
  personnelEdges: [...albums.values()].reduce((n, a) => n + a.credits.length, 0),
  recordings: recordings.length,
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

writeFileSync(
  join(outDir, "artists.json"),
  JSON.stringify(
    {
      people: byId(people),
      memberships: memberships.slice().sort((a, b) => a.groupId.localeCompare(b.groupId) || a.memberId.localeCompare(b.memberId)),
    },
    null,
    1,
  ),
);
writeFileSync(
  join(outDir, "catalog.json"),
  JSON.stringify(
    {
      works: byId(works),
      movements: [...movements.values()].sort(
        (a, b) => a.workId.localeCompare(b.workId) || (a.position ?? 99) - (b.position ?? 99) || a.id.localeCompare(b.id),
      ),
      tunes: byId(tunes),
    },
    null,
    1,
  ),
);
writeFileSync(
  join(outDir, "discography.json"),
  JSON.stringify(
    {
      albums: byId(albums),
      recordings: recordings.slice().sort((a, b) => a.id.localeCompare(b.id)),
    },
    null,
    1,
  ),
);

console.log(`\nIntegrity gate passed. Seed written to ${outDir}`);
