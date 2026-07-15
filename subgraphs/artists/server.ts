/**
 * artists subgraph (port 4001) -- the identity service.
 * Owns the Artist entity: who a person is, independent of any catalog.
 * Also owns membership edges and the interpretive-axes profiles.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startSubgraph } from "../lib/subgraph.js";
import type { Membership, Person } from "../lib/seed-types.js";

const here = import.meta.dirname;
const sdl = readFileSync(join(here, "schema.graphql"), "utf8");
const { people, memberships } = JSON.parse(
  readFileSync(join(here, "..", "..", "seed", "artists.json"), "utf8"),
) as { people: Person[]; memberships: Membership[] };

const byId = new Map(people.map((p) => [p.id, p]));
const membersByGroup = new Map<string, Membership[]>();
const groupsByMember = new Map<string, Membership[]>();
for (const m of memberships) {
  (membersByGroup.get(m.groupId) ?? membersByGroup.set(m.groupId, []).get(m.groupId)!).push(m);
  (groupsByMember.get(m.memberId) ?? groupsByMember.set(m.memberId, []).get(m.memberId)!).push(m);
}

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
        args.instrument ? people.filter((p) => p.instruments.includes(args.instrument!)) : people,
    },
    Artist: {
      members: (a: { id: string }) => membersByGroup.get(a.id) ?? [],
      memberOf: (a: { id: string }) => groupsByMember.get(a.id) ?? [],
    },
    Membership: {
      group: (m: Membership) => byId.get(m.groupId)!,
      member: (m: Membership) => byId.get(m.memberId)!,
    },
  },
});
