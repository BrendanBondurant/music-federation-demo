/**
 * Minimal federation-v2 subgraph glue, hand-rolled so the demo has zero
 * Apollo dependencies. A federation subgraph is a normal GraphQL server plus:
 *
 *   - `_service { sdl }`      -> the subgraph SDL, for introspection-based composition
 *   - `_entities(representations)` -> resolves entity references sent by the router
 *   - the federation directives (@link, @key) declared so the SDL validates
 *
 * That's all the router needs. The @link URL points at specs.apollo.dev
 * because that is the federation spec's identifier, not a dependency.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { createSchema, createYoga } from "graphql-yoga";

const FEDERATION_BOILERPLATE = /* GraphQL */ `
  directive @link(url: String!, as: String, import: [link__Import]) repeatable on SCHEMA
  scalar link__Import
  directive @key(fields: federation__FieldSet!, resolvable: Boolean = true) repeatable on OBJECT | INTERFACE
  directive @interfaceObject on OBJECT
  directive @external on FIELD_DEFINITION | OBJECT
  directive @provides(fields: federation__FieldSet!) on FIELD_DEFINITION
  directive @shareable repeatable on FIELD_DEFINITION | OBJECT
  scalar federation__FieldSet
  scalar _Any
  type _Service {
    sdl: String!
  }
`;

export interface EntityReference {
  __typename: string;
  [key: string]: unknown;
}

/** Build an entity reference stub the router can re-resolve, e.g. entityRef("Artist", id). */
export function entityRef(typename: string, id: string): EntityReference {
  return { __typename: typename, id };
}

/**
 * Assert an internal lookup that the schema promises as non-null actually
 * resolved. Today the seeder's integrity gate guarantees every reference, so
 * this never throws; it replaces a bare `!` (which TypeScript erases, leaving
 * a runtime `undefined` and GraphQL's opaque "Cannot return null for
 * non-nullable field"). When the seed becomes a database, a dangling reference
 * fails loudly here, naming what was missing, instead of somewhere upstream.
 */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`Referential integrity: ${what} not found`);
  return value;
}

/** Append `value` to the array at `key`, creating the array on first use. */
export function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

/** Add `value` to the Set at `key`, creating the Set on first use. */
export function addInto<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
}

/**
 * Read a subgraph's SDL and its seed JSON, both resolved relative to the
 * subgraph directory (pass `import.meta.dirname`). The seed lives at
 * `<dir>/../../seed/<seedFile>`, matching the repo layout.
 */
export function loadSubgraph<T>(dir: string, seedFile: string): { sdl: string; seed: T } {
  const sdl = readFileSync(join(dir, "schema.graphql"), "utf8");
  const seed = JSON.parse(readFileSync(join(dir, "..", "..", "seed", seedFile), "utf8")) as T;
  return { sdl, seed };
}

/** Index a list of id-bearing records into a Map keyed by id. */
export function indexById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((it) => [it.id, it]));
}

export interface SubgraphConfig {
  name: string;
  port: number;
  /** Raw contents of the subgraph's schema.graphql. */
  sdl: string;
  resolvers: Record<string, Record<string, unknown>>;
  /** Entity type names this subgraph can resolve references for. */
  entityTypes: string[];
  /** Turn a router-sent representation ({ __typename, id }) into an object. */
  resolveEntity: (ref: EntityReference) => unknown;
}

export function startSubgraph(cfg: SubgraphConfig): void {
  const typeDefs = [
    FEDERATION_BOILERPLATE,
    `union _Entity = ${cfg.entityTypes.join(" | ")}`,
    `extend type Query { _entities(representations: [_Any!]!): [_Entity]! _service: _Service! }`,
    cfg.sdl,
  ];

  const resolvers = {
    ...cfg.resolvers,
    _Entity: {
      __resolveType: (obj: EntityReference) => obj.__typename,
    },
    Query: {
      ...(cfg.resolvers.Query ?? {}),
      _entities: (_: unknown, args: { representations: EntityReference[] }) =>
        args.representations.map((ref) => cfg.resolveEntity(ref)),
      _service: () => ({ sdl: cfg.sdl }),
    },
  };

  const yoga = createYoga({
    schema: createSchema({ typeDefs, resolvers }),
    graphqlEndpoint: "/graphql",
    landingPage: false,
  });

  createServer(yoga).listen(cfg.port, () => {
    console.log(`[${cfg.name}] ready at http://localhost:${cfg.port}/graphql`);
  });
}
