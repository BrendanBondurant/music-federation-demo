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

## You must do this by hand

Everything else is scripted.

1. **Cosmo Cloud only:** create an account / log in at
   https://cosmo.wundergraph.com and create an API key in Studio under
   Settings -> API Keys. Scripts cannot log in for you.
2. **Only if the vault changed:** re-run the seeder (see Reseeding below).
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

`npm start` boots the three subgraphs, composes the router execution config
locally with `wgc router compose`, and starts the Cosmo Router in Docker.
Open http://localhost:3002 for the playground and run:

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

The acceptance checklist lives in `queries/`, one file per lesson:

| File | Shows |
|---|---|
| `01-key-resolution.graphql` | The headline query: identity + discography joined on `@key` |
| `02-fanout-albums-recordings-tunes.graphql` | Albums -> recordings -> tunes -> back to artists in one query |
| `03-composed-by.graphql` | Recordings of tunes Jim Hall wrote (composer edge into the person pool) |
| `04-ensemble.graphql` | An ENSEMBLE artist (Modern Jazz Quartet) resolves like any person |
| `05-classical-bwv1001.graphql` | BWV 1001 -> movements -> performers -> their other movements |
| `06-crossover.graphql` | One person's jazz albums AND Bach recordings. Returns `[]` today: the vault has zero crossover people. That is honest, not broken -- add one Chris Thile jazz album file to the vault and re-seed, and it lights up. |

## Connect to Cosmo Cloud

```bash
export COSMO_API_KEY=cosmo_...   # manual step 1 above
npm run connect-cosmo
```

The script creates the `music-demo` namespace and the `music` federated
graph, publishes all three subgraph schemas to the registry (in an order
that keeps every intermediate composition valid), and creates a router
token. Then:

```bash
GRAPH_API_TOKEN=<token from the script> npm run start:cloud
```

Same local subgraphs, but the router now pulls its config from the registry,
and the graph is visible in Studio: schema, subgraphs, checks, and analytics
once queries flow. Override names with `COSMO_NAMESPACE` / `COSMO_GRAPH`.

To test schema checks against real usage data, break something on purpose:

```bash
npx wgc subgraph check catalog --namespace music-demo --schema subgraphs/catalog/schema.graphql
```

## Reseeding from the vault

```bash
npm run seed -- /path/to/Personal/Music
```

Defaults to `~/Documents/Obsidian/Personal/Music` if it exists. The seeder
reads the vault read-only, writes `seed/*.json`, and fails loudly unless:

- zero dangling references (recording -> artist/album/tune, album ->
  artist/tune, personnel -> artist, movement recording -> performer/movement)
- entity counts match the verified numbers (1,060 people incl. 55 ensembles,
  570 albums, 144 tunes, 693 recordings, 1,949 personnel edges; Bach: 2
  works, 11 movements, 127 movement recordings)
- exactly 3 expected warnings: 2 duplicate tune files merged (I Got Rhythm,
  Ornithology) and 1 junk row dropped ([[Georgie Gershwin]])

If the vault changes (e.g. you add the crossover album), update `EXPECTED`
in `seeder/seed.ts` to the new numbers the run reports -- after checking
they moved the way you intended.

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
