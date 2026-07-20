# CLAUDE.md — music-federation demo

Instructions for any agent working in this repo. Read the `README.md` for how
to run it; read this for how to change it without breaking it.

## What this demo is for

Two jobs, equal weight. Hold both in mind on every change.

1. **Teach federation.** Three independently owned GraphQL subgraphs behind a
   Cosmo Router. One `Artist` entity is split across all three and rejoined at
   query time on a shared `@key`; one `Piece` entity interface gets recordings
   contributed from a subgraph that has never heard of the implementing types.
   The demo has to make that legible: clean schemas, honest data, a query-plan
   view that shows the fan-out.
2. **Critique the Cosmo docs.** The demo was built against the live Cosmo docs,
   and every place the docs fell short is logged in `DOC-GAPS.md`. That file is
   a deliverable, not a scratchpad. When you hit new friction, add to it.

If a change helps one job and hurts the other, stop and flag it.

## Architecture in one screen

| Subgraph | Port | Owns | Extends |
|---|---|---|---|
| `artists` | 4001 | `Artist` identity (`@key(fields: "id")`), `Membership`, `InterpretiveProfile` | — |
| `catalog` | 4002 | `Work`, `Movement`, `Tune`, `interface Piece @key`, `Genre` | `Artist` += `composedPieces`, `composedWorks` |
| `discography` | 4003 | `Album`, `Recording`, `Credit` | `Piece` += `recordings` (`@interfaceObject`); `Artist` += `albums`, `recordings` |

- `artists` owns identity. `catalog` and `discography` only *extend* `Artist`
  with more fields; they never own name or instruments. Composers named only
  in frontmatter exist as name-only Artist records — composer and performer
  are one pool, not two types.
- Two shared keys join the graph: `Artist` on `id` (all three subgraphs) and
  the `Piece` entity interface on `id` (catalog defines it, `Movement` and
  `Tune` implement it, discography contributes `recordings` to it via
  `@interfaceObject`). Crossover pieces are one piece: the Aranjuez Adagio is
  a `Movement` and its Miles Davis recording hangs off it. Genre is a field,
  never a service boundary.
- `Credit.artist` carries `@provides(fields: "name")`: the name is
  denormalized into the discography seed, `@shareable` in artists,
  `@external` in discography. Keep all three in sync if credits change.
- Router runs in Docker; subgraphs run on the host. `routing_url`s use
  `host.docker.internal` (see `graph.yaml`).

## Hard rules

- **No Apollo packages, ever.** Federation is a ~70-line hand-rolled helper,
  `subgraphs/lib/subgraph.ts`, serving `_service { sdl }` and `_entities`. If a
  task tempts you to add `@apollo/*`, that is the wrong task. The point is to
  show federation with nothing but GraphQL Yoga and the spec.
- **Federation v2 SDL only.** Each schema opens with the `@link` to
  `specs.apollo.dev/federation/v2.3`. That URL is a spec identifier, not a
  dependency — do not try to "install" it.
- **The seeder is the source of truth for data, and it has an integrity gate.**
  `seeder/seed.ts` parses the Obsidian vault and fails loudly if counts drift
  from the verified `EXPECTED` block or any reference dangles. If the seeder
  reports different numbers, the parser is wrong, not the vault — do not edit
  `EXPECTED` to make it pass. Seed JSON is committed, so a clone boots without
  the vault; only reseed when the vault actually changed.
- **Ids are slugs, resolved by id pool, never by string match.** lowercase,
  diacritics stripped, punctuation dropped, spaces to hyphens. Person slugs are
  the shared `@key`. Same-name traps (the tune "Night Train" vs. the albums)
  must resolve by id, never by comparing display names. `Movement` and `Tune`
  ids must never collide — they share the `Piece` key, and the seeder gates it.
- **Nulls are real.** ~40 albums legitimately have no year/label. Never coerce a
  real null to a placeholder to make output look tidy. Placeholder albums
  (`YouTube`, `Late Night Jazz (compilation)`, `Baroquswing Vol. II`) are not
  emitted; their recordings keep a null `album` and carry the placeholder name
  as `source`, like classical recordings known only from a label or ensemble.

## Conventions

- TypeScript, ESM, Node ≥ 22.11, run with `tsx`. `strict` is on; keep it green.
- Each subgraph is `server.ts` + `schema.graphql`, wired through
  `startSubgraph()`. Follow the `artists` subgraph as the reference shape:
  load seed JSON, build a `Map` by id, expose root resolvers plus a
  `resolveEntity` reference resolver.
- Seed shapes live in `subgraphs/lib/seed-types.ts`. Update them and the schema
  together — the SDL is the public contract, the seed type is the wire shape.
- **Every schema field carries a doc string**, and the existing ones are honest
  about nulls and edge cases. Match that. A new field with no description, or a
  description that oversells the data, does not ship.

## Changing schemas

After any `schema.graphql` edit: `npm run compose` (or `npm start`, which
composes on boot). Composition must stay valid at every step. Publish order for
Cosmo Cloud is `artists → catalog → discography` — `artists` is self-contained,
`catalog` adds fields to `Artist`, `discography` joins both. Composition
happens to accept `discography` before `catalog` (see `DOC-GAPS.md` #8), but
keep the order: it is the one under which every intermediate graph also means
what it says. Keep it in `scripts/connect-cosmo.sh`.

## The concept queries are an acceptance set

`queries/` holds six queries covering the graph's showpieces — the cross-genre
piece, the crossover artist, contrafacts, the album deep-dive, membership, and
the entity-interface search (`queries/README.md` has the matrix and seed ids).
Treat them as a checklist:
after any change, the relevant queries must still return and their query plans
must still show the intended fan-out. If a change makes a query obsolete, update
the query and its README row in the same commit — do not leave the set stale.

## Verifying against the docs

Local-source-of-truth first: `README.md`, `DOC-GAPS.md`, the schemas, and
`queries/README.md` before searching the web. When you do check Cosmo behavior,
verify against the *live* docs and note the date, the way `DOC-GAPS.md` entries
already do ("as of 2026-07-03"). New friction → new numbered `DOC-GAPS.md` entry
in the same format: what I needed, what the docs said, what worked.

## Out of scope

- The `Audio` and `played` columns in the vault are personal practice tracking.
  They are deliberately held back for a future v2 practice subgraph — do not
  surface them.
- A fourth subgraph is a deliberate decision, not a default. The demo earns its
  clarity by staying small, so add one only when asked and only when it teaches
  something the current three don't. The sanctioned candidates: a
  library/practice subgraph (from the `Audio`/`played` columns above) that
  extends `Recording` on its synthetic id — that id exists precisely so a later
  subgraph can hang per-recording data off it — and a media subgraph owning
  audio files and lead-sheet PDFs. A new subgraph owns its own entities and
  extends on shared keys; it never duplicates identity. Don't add auth,
  subscriptions, or a frontend unless asked.

## Before you finish

- `npm start` boots clean (three subgraphs up, composition OK, router on :3002).
- The concept queries you touched still return and plan as intended.
- Schemas compose in publish order with no new errors.
- New data claims trace back to the seeder, not to invention.
- Any doc friction is in `DOC-GAPS.md`.
