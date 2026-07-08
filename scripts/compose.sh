#!/usr/bin/env bash
# Compose the three subgraph schemas into a router execution config, locally,
# with no control-plane connection. Re-run after any schema change.
set -euo pipefail
cd "$(dirname "$0")/.."

npx -y wgc@latest router compose -i graph.yaml -o router-config.json
echo "Wrote router-config.json"
