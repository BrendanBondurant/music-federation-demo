/**
 * classical subgraph (port 4003) -- the Bach service.
 * Owns Work, Movement, MovementRecording, and contributes bachRecordings to
 * the shared Artist entity. BWV numbers are the natural work key.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startSubgraph } from "../lib/subgraph.js";
import type { Movement, MovementRecording, Work } from "../lib/seed-types.js";

const here = import.meta.dirname;
const sdl = readFileSync(join(here, "schema.graphql"), "utf8");
const seed = JSON.parse(readFileSync(join(here, "..", "..", "seed", "classical.json"), "utf8")) as {
  works: Work[];
  movements: Movement[];
  movementRecordings: MovementRecording[];
};

const workById = new Map(seed.works.map((w) => [w.id, w]));
const movementById = new Map(seed.movements.map((m) => [m.id, m]));
const movementsByWork = new Map<string, Movement[]>();
for (const m of seed.movements) {
  (movementsByWork.get(m.workId) ?? movementsByWork.set(m.workId, []).get(m.workId)!).push(m);
}
const recordingsByMovement = new Map<string, MovementRecording[]>();
const recordingsByPerformer = new Map<string, MovementRecording[]>();
for (const r of seed.movementRecordings) {
  (recordingsByMovement.get(r.movementId) ?? recordingsByMovement.set(r.movementId, []).get(r.movementId)!).push(r);
  (recordingsByPerformer.get(r.performerId) ?? recordingsByPerformer.set(r.performerId, []).get(r.performerId)!).push(r);
}

startSubgraph({
  name: "classical",
  port: 4003,
  sdl,
  entityTypes: ["Artist", "Tune", "Work"],
  resolveEntity: (ref) => {
    if (ref.__typename === "Tune") return { __typename: "Tune", id: String(ref.id) };
    if (ref.__typename === "Work") return workById.get(String(ref.id)) ?? null;
    return { __typename: "Artist", id: String(ref.id) };
  },
  resolvers: {
    Query: {
      work: (_: unknown, args: { id: string }) => workById.get(args.id) ?? null,
      works: (_: unknown, args: { composer?: string }) =>
        args.composer ? seed.works.filter((w) => w.composer === args.composer) : seed.works,
    },
    Artist: {
      bachRecordings: (a: { id: string }) => recordingsByPerformer.get(a.id) ?? [],
    },
    // Classical subgraph contributes movementRecordings to the catalog's Tune
    // entity. For crossover BWV pieces, the movement id and tune id are the
    // same slug (e.g. "bwv-147-jesu-joy-of-mans-desiring"), so the lookup
    // resolves naturally. Pure jazz tunes return [].
    Tune: {
      movementRecordings: (t: { id: string }) => recordingsByMovement.get(t.id) ?? [],
    },
    Work: {
      movements: (w: Work) =>
        (movementsByWork.get(w.id) ?? []).slice().sort((a, b) => a.order - b.order),
    },
    Movement: {
      work: (m: Movement) => workById.get(m.workId)!,
      recordings: (m: Movement) => recordingsByMovement.get(m.id) ?? [],
      // For crossover movements, returns the catalog Tune entity by the same id.
      // The router fetches actual Tune data from the catalog subgraph.
      tune: (m: Movement) => ({ __typename: "Tune", id: m.id }),
    },
    MovementRecording: {
      movement: (r: MovementRecording) => movementById.get(r.movementId)!,
      performer: (r: MovementRecording) => ({ __typename: "Artist", id: r.performerId }),
    },
  },
});
