/**
 * catalog subgraph (port 4002) -- the jazz discography service.
 * Owns Album, Tune, Recording, and contributes albums / recordings /
 * composedTunes to the Artist entity it does not own.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startSubgraph } from "../lib/subgraph.js";
import type { Album, Recording, Tune } from "../lib/seed-types.js";

const here = import.meta.dirname;
const sdl = readFileSync(join(here, "schema.graphql"), "utf8");
const seed = JSON.parse(readFileSync(join(here, "..", "..", "seed", "catalog.json"), "utf8")) as {
  tunes: Tune[];
  albums: Album[];
  recordings: Recording[];
};

const tuneById = new Map(seed.tunes.map((t) => [t.id, t]));
const albumById = new Map(seed.albums.map((a) => [a.id, a]));

// artistId -> album ids (principal artist or personnel), deduped
const albumsByArtist = new Map<string, Set<string>>();
for (const a of seed.albums) {
  for (const id of [...a.artistIds, ...a.credits.map((c) => c.artistId)]) {
    (albumsByArtist.get(id) ?? albumsByArtist.set(id, new Set()).get(id)!).add(a.id);
  }
}
const recordingsByArtist = new Map<string, Recording[]>();
const recordingsByTune = new Map<string, Recording[]>();
const recordingsByAlbum = new Map<string, Recording[]>();
for (const r of seed.recordings) {
  for (const id of r.artistIds) {
    (recordingsByArtist.get(id) ?? recordingsByArtist.set(id, []).get(id)!).push(r);
  }
  (recordingsByTune.get(r.tuneId) ?? recordingsByTune.set(r.tuneId, []).get(r.tuneId)!).push(r);
  if (r.albumId) {
    (recordingsByAlbum.get(r.albumId) ?? recordingsByAlbum.set(r.albumId, []).get(r.albumId)!).push(r);
  }
}
const tunesByComposer = new Map<string, Tune[]>();
for (const t of seed.tunes) {
  if (t.composerId) {
    (tunesByComposer.get(t.composerId) ?? tunesByComposer.set(t.composerId, []).get(t.composerId)!).push(t);
  }
}

const artistRef = (id: string) => ({ __typename: "Artist", id });
const sortAlbums = (a: Album, b: Album) =>
  (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title);

startSubgraph({
  name: "catalog",
  port: 4002,
  sdl,
  entityTypes: ["Artist"],
  // Catalog holds no identity data, so any reference is "resolvable": the
  // contributed fields below are computed from the id.
  resolveEntity: (ref) => ({ __typename: "Artist", id: String(ref.id) }),
  resolvers: {
    Query: {
      tune: (_: unknown, args: { id: string }) => tuneById.get(args.id) ?? null,
      tunes: () => seed.tunes,
      album: (_: unknown, args: { id: string }) => albumById.get(args.id) ?? null,
      albums: () => seed.albums,
    },
    Artist: {
      albums: (a: { id: string }) =>
        [...(albumsByArtist.get(a.id) ?? [])].map((id) => albumById.get(id)!).sort(sortAlbums),
      recordings: (a: { id: string }) => recordingsByArtist.get(a.id) ?? [],
      composedTunes: (a: { id: string }) => tunesByComposer.get(a.id) ?? [],
    },
    Album: {
      artists: (a: Album) => a.artistIds.map(artistRef),
      credits: (a: Album) => a.credits,
      tracks: (a: Album) => a.tracks,
      recordings: (a: Album) => recordingsByAlbum.get(a.id) ?? [],
    },
    Credit: {
      artist: (c: { artistId: string }) => artistRef(c.artistId),
    },
    Track: {
      tune: (t: { tuneId: string }) => tuneById.get(t.tuneId)!,
    },
    Tune: {
      composedBy: (t: Tune) => (t.composerId ? artistRef(t.composerId) : null),
      recordings: (t: Tune) => recordingsByTune.get(t.id) ?? [],
    },
    Recording: {
      tune: (r: Recording) => tuneById.get(r.tuneId)!,
      artists: (r: Recording) => r.artistIds.map(artistRef),
      album: (r: Recording) => (r.albumId ? albumById.get(r.albumId)! : null),
    },
  },
});
