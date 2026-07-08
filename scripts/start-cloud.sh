#!/usr/bin/env bash
# Boot in registry-connected mode: subgraphs local, router config fetched
# from Cosmo Cloud using GRAPH_API_TOKEN (from scripts/connect-cosmo.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

: "${GRAPH_API_TOKEN:?Set GRAPH_API_TOKEN (from: npm run connect-cosmo)}"
command -v docker >/dev/null || { echo "docker not found"; exit 1; }
[ -f seed/artists.json ] || { echo "No seed data. Run: npm run seed -- /path/to/Personal/Music"; exit 1; }
[ -d node_modules ] || npm install

pids=""
cleanup() {
  docker rm -f cosmo-router >/dev/null 2>&1 || true
  for pid in $pids; do kill "$pid" >/dev/null 2>&1 || true; done
}
trap cleanup EXIT

for s in artists catalog classical; do
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

PLATFORM_FLAG=""
if [ "$(uname -sm)" = "Darwin arm64" ]; then
  PLATFORM_FLAG="--platform=linux/amd64"
fi

echo "Starting Cosmo Router (config polled from Cosmo Cloud)."
docker run \
  --name cosmo-router \
  --rm \
  -p 3002:3002 \
  --add-host=host.docker.internal:host-gateway \
  --pull always \
  $PLATFORM_FLAG \
  -e DEV_MODE=true \
  -e LISTEN_ADDR=0.0.0.0:3002 \
  -e GRAPH_API_TOKEN="$GRAPH_API_TOKEN" \
  ghcr.io/wundergraph/cosmo/router:latest
