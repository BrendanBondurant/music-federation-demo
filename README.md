# Music federation demo

Three federated GraphQL subgraphs behind a Cosmo Router, built on real data
parsed from the Obsidian music vault. One `Artist` entity is shared across
independently owned services and reassembled by the router at query time.

| Subgraph | Port | Owns | Contributes to Artist |
|---|---|---|---|
| `artists` | 4001 | `Artist` identity (`@key(fields: "id")`) | id, name, instrument, type, style |
| `catalog` | 4002 | `Album`, `Tune`, `Recording` (jazz) | `albums`, `recordings`, `composedTunes` |
| `classical` | 4003 | `Work`, `Movement`, `MovementRecording` (Bach) | `bachRecordings` |

No Apollo packages. Subgraphs are GraphQL Yoga plus a ~70-line hand-rolled
federation helper (`subgraphs/lib/subgraph.ts`) that serves `_service { sdl }`
and `_entities`. Composition is `wgc`, routing is the Cosmo Router.

1. **Only if the vault changed:** re-run the seeder (see Reseeding below).
   Seed JSON is committed, so a fresh clone boots without the vault.

## Prerequisites

- Node.js >= 22.11
- Docker Desktop, running
- macOS or Linux (scripts are bash)

## Quick start (local, no account needed)

```bash
npm install
npm start
```

### Test Query

```graphql
{
  artist(id: "jim-hall") {
    name          # artists subgraph
    instrument    # artists subgraph
    albums {      # catalog subgraph
      title
      year
      recordings { tune { title } }
    }
  }
}
```

Use the dropdown on the right of the playground response pane to see the
query plan: the fetch fans out to `artists` and `catalog` and joins on the
shared key. Ctrl-C stops the router and the subgraphs.

## Concept queries

Nine working queries live in `queries/` (see `queries/README.md` for the
subgraph matrix and seed ids). Start with the headline join:

| File | Shows |
|---|---|
| `04-artists-catalog.graphql` | Identity + discography joined on Artist `@key` |
| `08-catalog-classical.graphql` | Jazz + classical edges joined on Tune `@key` (Aranjuez) |
| `09-full-crossover.graphql` | All three subgraphs on one Tune, with performer names |

The full set covers every non-empty subgraph combination, plus ensemble and
composer-edge examples.


## Repo layout

```
seeder/seed.ts         vault parser + integrity gate -> seed/*.json
seed/                  committed seed data (regenerate with npm run seed)
subgraphs/lib/         federation glue + seed types (shared)
subgraphs/artists/     identity service      :4001
subgraphs/catalog/     jazz discography      :4002
subgraphs/classical/   Bach service          :4003
graph.yaml             wgc router compose input
queries/               concept queries (acceptance checklist)
scripts/start.sh       one-command local boot
scripts/compose.sh     recompose after schema changes
scripts/connect-cosmo.sh  publish to Cosmo Cloud (needs COSMO_API_KEY)
scripts/start-cloud.sh 	  boot with registry-fetched router config
DOC-GAPS.md            where the Cosmo docs fell short while building this
```

## Data notes

- Nulls are real: ~40 albums have no year/label on purpose. Nothing non-null
  in the seed is dropped by the schema.
- Placeholder albums (`YouTube`, `Late Night Jazz (compilation)`,
  `Baroquswing Vol. II`) are not emitted; their recordings keep a null album.
- Same-name traps ("Night Train" the tune vs. the two "Night Train (...)"
  albums) resolve by id pool, never by string.
- Ids are slugs: lowercase, diacritics stripped, punctuation dropped, spaces
  to hyphens. Person slugs are the shared `@key` across all three subgraphs,
  and jazz + Bach names slug into one pool.
- The `Audio` and `played` columns in the vault are personal practice
  tracking and are intentionally out of scope until the v2 practice subgraph.
