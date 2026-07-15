# Concept queries

Six queries for the federated demo. Paste into the Cosmo playground at
`http://localhost:3002` (`npm start`). The query-plan dropdown on the response
pane is the actual demo: for #1 and #2, watch one query fan out across all
three services and rejoin.

Subgraphs: **A** = artists (:4001) · **C** = catalog (:4002) · **D** = discography (:4003)

| # | File | A | C | D | What it shows |
|---|------|---|---|---|---------------|
| 1 | `01-piece-across-genres.graphql` | ✅ | ✅ | ✅ | The Aranjuez Adagio: one Piece, recordings from the premiere to Miles Davis, chained through all three services |
| 2 | `02-crossover-artist.graphql` | ✅ | ✅ | ✅ | Tomatito: identity + compositions + discography assembled onto one entity |
| 3 | `03-contrafact-walk.graphql` | ✅ | ✅ | ✅ | Contrafact self-edge on Tune, fan-out to recordings per contrafact |
| 4 | `04-album-deep-dive.graphql` | ✅ | ✅ | ✅ | Zyryab: credits out to identity, tracks back into the catalog |
| 5 | `05-ensemble-hop.graphql` | ✅ | | ✅ | Membership edges: the quintet's Oleo next to each member's own |
| 6 | `06-pieces-in-e-minor.graphql` | ✅ | ✅ | ✅ | Entity-interface search: Movement and Tune mixed, each with recordings via `@interfaceObject` |

## How to read the plan

Which subgraphs a query hits is decided by the **fields selected**, not the root.

- `recordings` on any piece is a hop to **D** via the `Piece` entity interface:
  the discography contributes the field without knowing Movement or Tune exist.
- `artist { name }` under `credits`/`performers` normally hops to **A** — but
  `Credit.artist` declares `@provides(fields: "name")`, so plans that select
  only `name` skip that hop. Add `instruments` to see the hop come back.
- Drop `composer { name }` from #3 and it becomes C+D.

## Seed ids used

| Id | Entity |
|----|--------|
| `concierto-de-aranjuez-ii-adagio` | Movement (the crossover piece) |
| `tomatito` | Artist spanning flamenco, jazz, classical |
| `i-got-rhythm` | Tune with 16 contrafacts |
| `oleo` | Tune (rhythm-changes contrafact) |
| `zyryab-album` | Album |
| `miles-davis-quintet` | Artist (ENSEMBLE, with stated members) |
| `bwv-996` | Work in E minor (its movements show in #6) |

## Data honesty notes

- `musicalKey` is set on every movement but only a handful of tunes (home keys
  added to the vault where they are settled fact), so #6 returns mostly
  movements plus Nardis. Performance keys live on recordings.
- Quintet members without their own Oleo recording return `[]` in #5 — real
  nulls and empty lists are kept, not papered over.
