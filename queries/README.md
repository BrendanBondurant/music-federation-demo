# Concept queries

Nine queries for the federated demo. Paste into the Cosmo playground at
`http://localhost:3002` (`npm start`). Use the query-plan dropdown on the
response pane to see which subgraphs the router fetches.

Subgraphs: **A** = artists (:4001) · **C** = catalog (:4002) · **L** = classical (:4003)

| # | File | A | C | L | What it shows |
|---|------|---|---|---|---------------|
| 1 | `01-artists-only.graphql` | ✅ | | | Identity lookup, single fetch |
| 2 | `02-catalog-only.graphql` | | ✅ | | Tune + album tracks, no artist names |
| 3 | `03-classical-only.graphql` | | | ✅ | Work → movements → recordings (no performer names) |
| 4 | `04-artists-catalog.graphql` | ✅ | ✅ | | Headline `@key` join + album fan-out |
| 5 | `05-ensemble.graphql` | ✅ | ✅ | | Same join; root is an `ENSEMBLE` |
| 6 | `06-composed-by.graphql` | ✅ | ✅ | | Composer edge into the shared person pool |
| 7 | `07-artists-classical.graphql` | ✅ | | ✅ | Artist + `bachRecordings` |
| 8 | `08-catalog-classical.graphql` | | ✅ | ✅ | Crossover on **Tune** `@key` (no names) |
| 9 | `09-full-crossover.graphql` | ✅ | ✅ | ✅ | Aranjuez: jazz + classical edges + names |

## How to read the plan

Which subgraphs a query hits is decided by the **fields selected**, not the root.

- Add `performer { name }` to query 3 → it becomes A+L.
- Add `credits { artist { name } }` to query 2 → it becomes A+C.
- Query 8 stays C+L on purpose; query 9 is the same Tune with names, so all three.

## Seed ids used

| Id | Entity |
|----|--------|
| `jim-hall` | Artist (PERSON) |
| `modern-jazz-quartet` | Artist (ENSEMBLE) |
| `julian-bream` | Artist (classical) |
| `alone-together` | Tune |
| `jazz-guitar-jim-hall` | Album |
| `bwv-1001` | Work |
| `concierto-de-aranjuez-ii-adagio` | Tune + Movement (shared `@key`) |

There is no person in the seed with both jazz albums and Bach recordings. The
working crossover is the **Tune** join (queries 8–9), not an Artist that spans
both catalogs.
