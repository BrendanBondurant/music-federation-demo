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

const workByBwv = new Map(seed.works.map((w) => [w.bwv, w]));
const movementById = new Map(seed.movements.map((m) => [m.id, m]));
const movementsByBwv = new Map<number, Movement[]>();
for (const m of seed.movements) {
  (movementsByBwv.get(m.bwv) ?? movementsByBwv.set(m.bwv, []).get(m.bwv)!).push(m);
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
  entityTypes: ["Artist"],
  resolveEntity: (ref) => ({ __typename: "Artist", id: String(ref.id) }),
  resolvers: {
    Query: {
      work: (_: unknown, args: { bwv: number }) => workByBwv.get(args.bwv) ?? null,
      works: () => seed.works,
    },
    Artist: {
      bachRecordings: (a: { id: string }) => recordingsByPerformer.get(a.id) ?? [],
    },
    Work: {
      movements: (w: Work) =>
        (movementsByBwv.get(w.bwv) ?? []).slice().sort((a, b) => a.order - b.order),
    },
    Movement: {
      work: (m: Movement) => workByBwv.get(m.bwv)!,
      recordings: (m: Movement) => recordingsByMovement.get(m.id) ?? [],
    },
    MovementRecording: {
      movement: (r: MovementRecording) => movementById.get(r.movementId)!,
      performer: (r: MovementRecording) => ({ __typename: "Artist", id: r.performerId }),
    },
  },
});
