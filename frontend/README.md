# whoplayedit.com — frontend

Astro frontend for the music-federation demo. Server-rendered on purpose:
every page fetches live from the Cosmo Router on each request, so what you
see is exactly what the subgraphs say.

## Run it

```bash
# 1. boot the backend from the repo root (three subgraphs + router on :3002)
npm start

# 2. in a second terminal
cd frontend
npm install
npm run dev        # http://localhost:4321
```

`npm run build && npm run preview` works the same way — the build is a Node
server (`@astrojs/node`), not a static snapshot, so it also needs the backend
up.

The router endpoint defaults to `http://localhost:3002/graphql`; override
with a `GRAPHQL_ENDPOINT` env var.

## What's in here

- Plain-fetch GraphQL client (`src/lib/api.ts`). No Apollo packages, same
  rule as the rest of the repo.
- One route per entity: tune, movement, work (plus per-performer view),
  album, artist, palo, genre — and the jazz form-family facets
  (contrafacts, rhythm changes, blues heads).
- No GraphQL tooling in the UI. The frontend is presented as a production
  app: inspect query plans against the router directly (send
  `X-WG-Include-Query-Plan` with any operation in `src/lib/queries.ts`).
- Design tokens come from the personal-brand identity guide; layout is
  ported from the approved static mockup.

## Honesty rules carried over from the backend

Nulls are real. Missing years read "year unknown"; recordings without an
album show their free-text `source`; album track lists are labelled partial;
artist pages split per-take credits from album-level credits (the sideman
fix, fix-list §1); movements always display as Work — Movement. The UI states
what the data shows and skips commentary about the data.
