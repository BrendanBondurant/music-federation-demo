#!/usr/bin/env bash
# Publish this graph to Cosmo Cloud: namespace, federated graph, all three
# subgraphs (artists, catalog, discography), and a router token. Everything
# except the API key is automated.
#
# Manual step first (once): create an API key in Cosmo Studio
# (Settings -> API Keys), then:
#
#   export COSMO_API_KEY=cosmo_...
#   npm run connect-cosmo
set -euo pipefail
cd "$(dirname "$0")/.."

: "${COSMO_API_KEY:?Set COSMO_API_KEY first (Cosmo Studio -> Settings -> API Keys)}"
NAMESPACE="${COSMO_NAMESPACE:-music-demo}"
GRAPH="${COSMO_GRAPH:-music}"
WGC="npx -y wgc@latest"

echo "==> Namespace: $NAMESPACE"
$WGC namespace create "$NAMESPACE" || echo "    (already exists, continuing)"

echo "==> Federated graph: $GRAPH (routing URL = local router)"
$WGC federated-graph create "$GRAPH" \
  --namespace "$NAMESPACE" \
  --routing-url http://localhost:3002/graphql || echo "    (already exists, continuing)"

# Publish in this order and every intermediate composition stays valid:
# artists is self-contained, catalog adds fields to Artist, discography joins
# both. Composition happens to accept discography even before catalog (its
# Piece @interfaceObject composes as a plain object type until the entity
# interface arrives -- see DOC-GAPS.md #8), but catalog-first is the order
# under which every intermediate graph also means what it says.
echo "==> Publishing subgraphs"
for s in artists catalog discography; do
  port=$([ "$s" = artists ] && echo 4001 || { [ "$s" = catalog ] && echo 4002 || echo 4003; })
  $WGC subgraph publish "$s" \
    --namespace "$NAMESPACE" \
    --schema "subgraphs/$s/schema.graphql" \
    --routing-url "http://host.docker.internal:$port/graphql"
done

echo "==> Creating router token (shown once -- copy it)"
$WGC router token create demo-router --graph-name "$GRAPH" --namespace "$NAMESPACE"

cat <<'EOF'

Next:
  1. Copy the token printed above.
  2. GRAPH_API_TOKEN=<token> npm run start:cloud
  3. Open the graph in https://cosmo.wundergraph.com -- schema, checks,
     and (once queries flow) analytics are live.
EOF
