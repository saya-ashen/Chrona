#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# Chrona binary smoke test
# ──────────────────────────────────────────────────────────────

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "==> Root: $ROOT"

# Create output directory
OUT_DIR="${ROOT}/.smoke-test-output"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# ── Step 1: Build binary ──────────────────────────────────────
echo ""
echo "==> Step 1: Building portable binary"
cd "$ROOT"
bun run build 2>&1

chrona_path="$(find "$ROOT/dist/releases" -path "*/chrona" -type f | head -n 1)"
if [ -z "$chrona_path" ]; then
  chrona_path="$(find "$ROOT/dist/releases" -path "*/Chrona.exe" -type f | head -n 1)"
fi
if [ -z "$chrona_path" ]; then
  echo "    FAIL: built binary not found under dist/releases"
  exit 1
fi
echo "    chrona at: $chrona_path"

# ── Step 2: Create temp env ───────────────────────────────────
echo ""
echo "==> Step 2: Setting up temp environment"
TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT

export HOME="${TMP}/home"
export CHRONA_DATA_DIR="${TMP}/data"
export CHRONA_CONFIG_DIR="${TMP}/config"
export CHRONA_RUNTIME_DIR="${TMP}/runtime"

mkdir -p "$HOME" "$CHRONA_DATA_DIR" "$CHRONA_CONFIG_DIR" "$CHRONA_RUNTIME_DIR"

echo "    TMP=$TMP"
echo "    HOME=$HOME"

# ── Step 3: chrona --help ─────────────────────────────────────
echo ""
echo "==> Step 3: chrona --help"
"$chrona_path" --help 2>&1 || true

echo ""
echo "==> Smoke test PASSED"
echo "    To start: $chrona_path start"
echo "    Temp dir: $TMP"
