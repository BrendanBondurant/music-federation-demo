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
import { createServer } from "node:http";
import { createSchema, createYoga } from "graphql-yoga";

const FEDERATION_BOILERPLATE = /* GraphQL */ `
  directive @link(url: String!, as: String, import: [link__Import]) repeatable on SCHEMA
  scalar link__Import
  directive @key(fields: federation__FieldSet!, resolvable: Boolean = true) repeatable on OBJECT | INTERFACE
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
