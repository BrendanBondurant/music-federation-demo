/**
 * discography subgraph (port 4003) -- who recorded what, where.
 * Owns Album, Recording, Credit; extends Piece (via @interfaceObject) with
 * recordings and Artist with albums / recordings. This is the join service:
 * it references both other subgraphs and is referenced by neither.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startSubgraph, pushInto, addInto, entityRef, must, type EntityReference } from "../lib/subgraph.js";
import type { Album, Credit, Recording } from "../lib/seed-types.js";

const here = import.meta.dirname;
const sdl = readFileSync(join(here, "schema.graphql"), "utf8");
const seed = JSON.parse(readFileSync(join(here, "..", "..", "seed", "discography.json"), "utf8")) as {
  albums: Album[];
  recordings: Recording[];
  artistNames: Record<string, string>;
};

const albumById = new Map(seed.albums.map((a) => [a.id, a]));
const recordingById = new Map(seed.recordings.map((r) => [r.id, r]));

const recordingsByPiece = new Map<string, Recording[]>();
const recordingsByArtist = new Map<string, Recording[]>();
for (const r of seed.recordings) {
  pushInto(recordingsByPiece, r.pieceId, r);
  for (const id of r.performerIds) pushInto(recordingsByArtist, id, r);
}
// artistId -> album ids (principal artist, personnel, or recording performer), deduped
const albumsByArtist = new Map<string, Set<string>>();
const addAlbum = (artistId: string, albumId: string) => addInto(albumsByArtist, artistId, albumId);
for (const a of seed.albums) {
  for (const id of a.artistIds) addAlbum(id, a.id);
  for (const c of a.credits) addAlbum(c.artistId, a.id);
}
for (const r of seed.recordings) {
  if (r.albumId) for (const id of r.performerIds) addAlbum(id, r.albumId);
}

// The name is denormalized into this subgraph's seed so Credit.artist can
// honor @provides(fields: "name") without a hop to the artists subgraph.
const artistWithName = (id: string) => ({
  __typename: "Artist",
  id,
  name: must(seed.artistNames[id], `artist name for ${id}`),
});
const sortAlbums = (a: Album, b: Album) =>
  (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title);

startSubgraph({
  name: "discography",
  port: 4003,
  sdl,
  entityTypes: ["Artist", "Album", "Recording", "Piece"],
  resolveEntity: (ref: EntityReference) => {
    const id = String(ref.id);
    switch (ref.__typename) {
      case "Album":
        return albumById.get(id) ?? null;
      case "Recording":
        return recordingById.get(id) ?? null;
      case "Piece":
        // @interfaceObject: the ref stays a plain Piece here; this subgraph
        // never learns which concrete type implements it.
        return entityRef("Piece", id);
      case "Artist":
        return entityRef("Artist", id);
      default:
        return null;
    }
  },
  resolvers: {
    Query: {
      album: (_: unknown, args: { id: string }) => albumById.get(args.id) ?? null,
      albums: () => seed.albums,
    },
    Album: {
      credits: (a: Album) => a.credits,
      tracks: (a: Album) => a.trackIds.map((id) => must(recordingById.get(id), `Recording ${id}`)),
    },
    Credit: {
      artist: (c: Credit) => artistWithName(c.artistId),
    },
    Recording: {
      piece: (r: Recording) => entityRef("Piece", r.pieceId),
      album: (r: Recording) =>
        r.albumId ? must(albumById.get(r.albumId), `Album ${r.albumId}`) : null,
      performers: (r: Recording) => r.performerIds.map((id) => entityRef("Artist", id)),
    },
    Piece: {
      recordings: (p: { id: string }) => recordingsByPiece.get(p.id) ?? [],
    },
    Artist: {
      albums: (a: { id: string }) =>
        [...(albumsByArtist.get(a.id) ?? [])]
          .map((id) => must(albumById.get(id), `Album ${id}`))
          .sort(sortAlbums),
      recordings: (a: { id: string }, args: { piece?: string | null }) => {
        const all = recordingsByArtist.get(a.id) ?? [];
        return args.piece ? all.filter((r) => r.pieceId === args.piece) : all;
      },
    },
  },
});
