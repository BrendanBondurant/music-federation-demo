# Doc gaps

Friction found while building this demo against the Cosmo docs (the
`docs-website` repo as of 2026-07-03). Format: what I needed, what the docs
said, what actually worked.

## 1. Local composition + Docker router is not documented end to end

**Needed:** the exact wiring for the most natural local-demo setup: subgraphs
on the host, `wgc router compose` output, router in Docker.

**Docs:** two adjacent paths exist, but not this one.
`tutorial/mastering-local-development-for-graphql-federation.mdx` covers
compose + a downloaded router *binary* with a `config.yaml`. The onboarding
(`getting-started/cosmo-cloud-onboarding.mdx`) covers Docker, but only in
registry mode (`GRAPH_API_TOKEN`), never with a local execution config.

**Worked:** mount the config and point the env var at it:

```bash
docker run ... \
  -e EXECUTION_CONFIG_FILE_PATH=/config/router-config.json \
  -v "$PWD/router-config.json:/config/router-config.json:ro" \
  ghcr.io/wundergraph/cosmo/router:latest
```

plus `host.docker.internal` in the compose file's `routing_url`s (and
`--add-host=host.docker.internal:host-gateway` for Linux). Each piece exists
somewhere in the docs; the combination, which is what every "try federation
locally in 10 minutes" reader wants, has to be assembled from three pages.
A short "local demo with Docker" section on the compose page would fix it.

## 2. EXECUTION_CONFIG_FILE_PATH is only discoverable as a comment

**Needed:** how the router finds the composed config without a `config.yaml`.

**Docs:** the env var appears once, as an inline YAML comment in the
local-development tutorial (`path: "router.json" # or
EXECUTION_CONFIG_FILE_PATH`). It is not on the compose page, which is where
you land after generating the file and asking "now what".

**Worked:** `EXECUTION_CONFIG_FILE_PATH` as an env var, no `config.yaml`
needed. The compose page's Examples section should show the handoff.

## 3. Apple Silicon needs a platform flag the docs never mention

**Needed:** run `ghcr.io/wundergraph/cosmo/router:latest` on an M-series Mac.

**Docs:** `router/download-and-install.mdx` documents the Docker image and
binary matrix (including darwin-arm64 binaries) but says nothing about the
image's platforms.

**Worked (per the project plan; not verifiable in my Linux build
environment):** add `--platform=linux/amd64` on Apple Silicon.
`scripts/start.sh` adds it automatically on `Darwin arm64`. If the image is
actually multi-arch now, the docs should say so; either way one sentence
would end the guessing.

## 4. What DEV_MODE=true does is never stated

**Needed:** to know whether the playground, query plan view, and ART work
without a Studio connection.

**Docs:** onboarding and download-and-install both pass `-e DEV_MODE=true`
without explaining it. The local-development tutorial's `config.yaml` sets
`dev_mode: true`, also unexplained on that page.

**Assumed:** DEV_MODE=true enables the dev defaults (playground plus advanced
request tracing without the usual ART preconditions), which is what the demo
relies on for the query-plan view. Inferred from context, not stated anywhere
I could find; it deserves a line wherever it appears.

## 5. wgc router download-binary fails ugly behind a firewall

**Needed:** the router binary in a network-restricted environment (my build
sandbox allowlists npm but not api.github.com).

**Docs:** `cli/router/download-binary.mdx` documents the happy path only.

**Got:** a raw octokit `RequestError [HttpError]: Request was cancelled`
stack trace with `status: 500` after retries, plus a generic "open an issue"
box. Cosmetic, but a "this command needs github.com/api.github.com access"
note (and a friendlier error) would help CI users. Not a blocker here: the
demo uses the Docker image on the target machine.

## 6. Subgraph SDL requirements for compose are implicit

**Needed:** to know what a `schema.file` must contain for `wgc router
compose` -- specifically whether the federation v2 `@link` extension is
required and how v1 vs v2 is inferred.

**Docs:** `cli/router/compose.mdx` documents the input YAML but nothing
about the SDL contract. I wrote the schemas with
`extend schema @link(url: "https://specs.apollo.dev/federation/v2.3",
import: ["@key"])` and composition worked first try, so the answer is
"normal federation v2 SDL", but that is stated nowhere on the page.

## Non-gaps worth recording

- Publish order for incremental composition validity is documented well in
  the onboarding (expected-errors warning box). Publishing `artists ->
  catalog -> classical` avoids even the expected errors, since only the
  identity subgraph is self-contained; the connect script uses that order.
- `COSMO_API_KEY` as the non-interactive auth mechanism is documented in
  `cli/intro.mdx`.
- The `wgc subgraph publish --routing-url` create-and-publish shortcut is
  clearly documented on the publish page.
