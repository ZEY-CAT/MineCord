#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 24+ and npm are required. Install Node.js, then rerun this script." >&2
  exit 1
fi

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( node_major < 24 )); then
  echo "MineCord requires Node.js 24 or newer (found $(node --version))." >&2
  exit 1
fi

if [[ ! -f package-lock.json ]]; then
  echo "package-lock.json is missing; refusing to install non-reproducible dependencies." >&2
  exit 1
fi

case "${1:-}" in
  "") npm ci ;;
  --production) npm ci --omit=dev ;;
  --help)
    echo "Usage: bash scripts/setup-cloud.sh [--production]"
    echo "Default installs the locked development and runtime dependencies."
    echo "--production installs only runtime dependencies."
    ;;
  *)
    echo "Unknown option: $1" >&2
    echo "Usage: bash scripts/setup-cloud.sh [--production]" >&2
    exit 2
    ;;
esac
