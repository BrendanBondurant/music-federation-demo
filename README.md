# Music federation demo

Three federated GraphQL subgraphs behind a Cosmo Router, built on real data
parsed from the Obsidian music vault. The `Artist` entity and the `Piece`
entity interface are shared across independently owned services and
reassembled by the router at query time.

| Subgraph | Port | Owns | Extends |
|---|---|---|---|
| `artists` | 4001 | `Artist` identity, `Membership`, `InterpretiveProfile` | — |
| `catalog` | 4002 | `Work`, `Movement`, `Tune`, the `Piece` interface, `Genre` | `Artist` += `composedPieces`, `composedWorks` |
| `discography` | 4003 | `Album`, `Recording`, `Credit` | `Piece` += `recordings` (via `@interfaceObject`); `Artist` += `albums`, `recordings` |

`catalog` says what music exists, `artists` says who plays, `discography` says
who recorded what and where. The discography is the join service: it references
both other subgraphs, so almost every query through it produces a chained plan.
Genres (classical, jazz, flamenco) are a field, not a service boundary -- the
same person composes a rumba and records the Rodrigo concerto.

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
    name           # artists subgraph
    instruments    # artists subgraph
    albums {       # discography subgraph
      title
      year
      tracks { piece { title } }   # piece resolves in catalog
    }
  }
}
```

Use the dropdown on the right of the playground response pane to see the
query plan: the fetch fans out to all three services and joins on the shared
keys. Ctrl-C stops the router and the subgraphs.

## Concept queries

Six working queries live in `queries/` (see `queries/README.md` for the
subgraph matrix and seed ids). Start with the money shot:

| File | Shows |
|---|---|
| `01-piece-across-genres.graphql` | The Aranjuez Adagio: one `Piece`, recordings from the 1948 premiere to Miles Davis, chained through all three services |
| `02-crossover-artist.graphql` | Tomatito assembled from all three: identity, compositions, discography |
| `06-pieces-in-e-minor.graphql` | `Movement` and `Tune` mixed in one result, each with recordings via `@interfaceObject` |

The set also covers the contrafact self-edge, an album deep-dive, and the
ensemble-membership hop.


## Repo layout

```
seeder/seed.ts         vault parser + integrity gate -> seed/*.json
seed/                  committed seed data (regenerate with npm run seed)
subgraphs/lib/         federation glue + seed types (shared)
subgraphs/artists/     who plays             :4001
subgraphs/catalog/     what music exists     :4002
subgraphs/discography/ who recorded what     :4003
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
- Recordings from placeholder albums (`YouTube`, compilations) and classical
  recordings without an album carry a `source` string and a null `album`.
- Same-name traps ("Night Train" the tune vs. the two "Night Train (...)"
  albums) resolve by id pool, never by string.
- Ids are slugs: lowercase, diacritics stripped, punctuation dropped, spaces
  to hyphens. Person slugs are the shared `@key` across all three subgraphs;
  jazz, flamenco, and classical names slug into one pool.
- Composers named only in frontmatter (Gershwin, Rodrigo) become name-only
  `Artist` records, so composer edges resolve into the same pool as
  performers. There is no separate composer type.
- Crossover pieces are one piece: the Aranjuez Adagio is a `Movement`, and its
  jazz recordings attach to it. `Movement` and `Tune` ids never collide -- the
  seeder gates it, because they share the `Piece` `@key`.
- `Album.tracks` covers only pieces tracked in the vault, so most track lists
  are partial.
- The `Audio` and `played` columns in the vault are personal practice
  tracking and are intentionally out of scope until the practice subgraph,
  which will extend `Recording` on its synthetic id.
