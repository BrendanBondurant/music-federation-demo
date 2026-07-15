#!/usr/bin/env bash
# One-command boot: subgraphs -> local composition -> Cosmo Router in Docker.
# Ctrl-C stops everything.
set -euo pipefail
cd "$(dirname "$0")/.."

# --- preflight ---------------------------------------------------------------
command -v node >/dev/null || { echo "node not found (need >= 22.11)"; exit 1; }
command -v docker >/dev/null || { echo "docker not found (Docker Desktop must be running)"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker daemon not running"; exit 1; }
[ -f seed/artists.json ] || { echo "No seed data. Run: npm run seed -- /path/to/Personal/Music"; exit 1; }
[ -d node_modules ] || { echo "Installing dependencies..."; npm install; }

# --- subgraphs ---------------------------------------------------------------
pids=""
cleanup() {
  docker rm -f cosmo-router >/dev/null 2>&1 || true
  for pid in $pids; do kill "$pid" >/dev/null 2>&1 || true; done
}
trap cleanup EXIT

for s in artists catalog discography; do
  npx tsx "subgraphs/$s/server.ts" &
  pids="$pids $!"
done

for port in 4001 4002 4003; do
  for i in $(seq 1 30); do
    curl -s -o /dev/null "http://localhost:$port/graphql?query=%7B__typename%7D" && break
    sleep 0.5
    [ "$i" = 30 ] && { echo "subgraph on :$port did not come up"; exit 1; }
  done
done
echo "All three subgraphs are up."

# --- compose -----------------------------------------------------------------
npx -y wgc@latest router compose -i graph.yaml -o router-config.json
echo "Composition OK -> router-config.json"

# --- router ------------------------------------------------------------------
PLATFORM_FLAG=""
if [ "$(uname -sm)" = "Darwin arm64" ]; then
  PLATFORM_FLAG="--platform=linux/amd64"
fi

echo "Starting Cosmo Router on http://localhost:3002 (playground there too)."
echo "Try queries/01-piece-across-genres.graphql, then open the query-plan dropdown."
docker run \
  --name cosmo-router \
  --rm \
  -p 3002:3002 \
  --add-host=host.docker.internal:host-gateway \
  --pull always \
  $PLATFORM_FLAG \
  -e DEV_MODE=true \
  -e LISTEN_ADDR=0.0.0.0:3002 \
  -e EXECUTION_CONFIG_FILE_PATH=/config/router-config.json \
  -v "$PWD/router-config.json:/config/router-config.json:ro" \
  ghcr.io/wundergraph/cosmo/router:latest
