/**
 * artists subgraph (port 4001) -- the identity service.
 * Owns the Artist entity: who a person is, independent of any catalog.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startSubgraph } from "../lib/subgraph.js";
import type { Person } from "../lib/seed-types.js";

const here = import.meta.dirname;
const sdl = readFileSync(join(here, "schema.graphql"), "utf8");
const { people } = JSON.parse(
  readFileSync(join(here, "..", "..", "seed", "artists.json"), "utf8"),
) as { people: Person[] };

const byId = new Map(people.map((p) => [p.id, p]));

startSubgraph({
  name: "artists",
  port: 4001,
  sdl,
  entityTypes: ["Artist"],
  // The reference resolver: the router sends { __typename: "Artist", id },
  // we look the person up by the shared slug key.
  resolveEntity: (ref) => {
    const person = byId.get(String(ref.id));
    return person ? { __typename: "Artist", ...person } : null;
  },
  resolvers: {
    Query: {
      artist: (_: unknown, args: { id: string }) => byId.get(args.id) ?? null,
      artists: (_: unknown, args: { instrument?: string | null }) =>
        args.instrument ? people.filter((p) => p.instrument === args.instrument) : people,
    },
  },
});
