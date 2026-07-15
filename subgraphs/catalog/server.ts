/**
 * catalog subgraph (port 4002) -- what music exists.
 * Owns Work, Movement, Tune, and the Piece entity interface; contributes
 * composedPieces / composedWorks to the Artist entity it does not own.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startSubgraph, type EntityReference } from "../lib/subgraph.js";
import type { Movement, Tune, Work } from "../lib/seed-types.js";

const here = import.meta.dirname;
const sdl = readFileSync(join(here, "schema.graphql"), "utf8");
const seed = JSON.parse(readFileSync(join(here, "..", "..", "seed", "catalog.json"), "utf8")) as {
  works: Work[];
  movements: Movement[];
  tunes: Tune[];
};

const workById = new Map(seed.works.map((w) => [w.id, w]));
const movementById = new Map(seed.movements.map((m) => [m.id, m]));
const tuneById = new Map(seed.tunes.map((t) => [t.id, t]));

const movementsByWork = new Map<string, Movement[]>();
for (const m of seed.movements) {
  (movementsByWork.get(m.workId) ?? movementsByWork.set(m.workId, []).get(m.workId)!).push(m);
}
const tunesByComposer = new Map<string, Tune[]>();
for (const t of seed.tunes) {
  if (t.composerId) {
    (tunesByComposer.get(t.composerId) ?? tunesByComposer.set(t.composerId, []).get(t.composerId)!).push(t);
  }
}
const worksByComposer = new Map<string, Work[]>();
for (const w of seed.works) {
  if (w.composerId) {
    (worksByComposer.get(w.composerId) ?? worksByComposer.set(w.composerId, []).get(w.composerId)!).push(w);
  }
}
const contrafactsByParent = new Map<string, Tune[]>();
for (const t of seed.tunes) {
  if (t.contrafactOfId) {
    (contrafactsByParent.get(t.contrafactOfId) ?? contrafactsByParent.set(t.contrafactOfId, []).get(t.contrafactOfId)!).push(t);
  }
}

// A Piece is a Movement or a Tune; ids never collide (the seeder gates it).
const withType = (m: Movement | null | undefined, t: Tune | null | undefined) =>
  m ? { __typename: "Movement", ...m } : t ? { __typename: "Tune", ...t } : null;
const pieceById = (id: string) => withType(movementById.get(id), tuneById.get(id));
const allPieces = () => [
  ...seed.movements.map((m) => ({ __typename: "Movement", ...m })),
  ...seed.tunes.map((t) => ({ __typename: "Tune", ...t })),
];

const artistRef = (id: string | null) => (id ? { __typename: "Artist", id } : null);
const sortMovements = (a: Movement, b: Movement) =>
  (a.position ?? 99) - (b.position ?? 99) || a.id.localeCompare(b.id);

startSubgraph({
  name: "catalog",
  port: 4002,
  sdl,
  entityTypes: ["Artist", "Work", "Movement", "Tune"],
  // The router sends concrete refs (Movement, Tune, Work, Artist) and, for the
  // entity interface, Piece refs coming from the discography's @interfaceObject.
  // A Piece ref resolves to whichever concrete piece owns the id.
  resolveEntity: (ref: EntityReference) => {
    const id = String(ref.id);
    switch (ref.__typename) {
      case "Piece":
        return pieceById(id);
      case "Movement":
        return withType(movementById.get(id), null);
      case "Tune":
        return withType(null, tuneById.get(id));
      case "Work":
        return workById.get(id) ?? null;
      default:
        return { __typename: "Artist", id };
    }
  },
  resolvers: {
    Query: {
      piece: (_: unknown, args: { id: string }) => pieceById(args.id),
      pieces: (_: unknown, args: { musicalKey?: string | null }) =>
        args.musicalKey ? allPieces().filter((p) => p.musicalKey === args.musicalKey) : allPieces(),
      tune: (_: unknown, args: { id: string }) => tuneById.get(args.id) ?? null,
      tunes: () => seed.tunes,
      work: (_: unknown, args: { id: string }) => workById.get(args.id) ?? null,
      works: (_: unknown, args: { composer?: string | null }) =>
        args.composer ? (worksByComposer.get(args.composer) ?? []) : seed.works,
    },
    Piece: {
      __resolveType: (obj: { __typename: string }) => obj.__typename,
    },
    Work: {
      composer: (w: Work) => artistRef(w.composerId),
      movements: (w: Work) => (movementsByWork.get(w.id) ?? []).slice().sort(sortMovements),
    },
    Movement: {
      work: (m: Movement) => workById.get(m.workId)!,
    },
    Tune: {
      composer: (t: Tune) => artistRef(t.composerId),
      contrafactOf: (t: Tune) => (t.contrafactOfId ? tuneById.get(t.contrafactOfId)! : null),
      contrafacts: (t: Tune) => contrafactsByParent.get(t.id) ?? [],
    },
    Artist: {
      composedPieces: (a: { id: string }) => [
        ...(tunesByComposer.get(a.id) ?? []).map((t) => ({ __typename: "Tune", ...t })),
        ...(worksByComposer.get(a.id) ?? []).flatMap((w) =>
          (movementsByWork.get(w.id) ?? [])
            .slice()
            .sort(sortMovements)
            .map((m) => ({ __typename: "Movement", ...m })),
        ),
      ],
      composedWorks: (a: { id: string }) => worksByComposer.get(a.id) ?? [],
    },
  },
});
