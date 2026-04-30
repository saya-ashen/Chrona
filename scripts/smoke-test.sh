#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# Chrona npm smoke test
# ──────────────────────────────────────────────────────────────

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "==> Root: $ROOT"

# Create output directory
OUT_DIR="${ROOT}/.smoke-test-output"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# ── Step 1: Build everything ──────────────────────────────────
echo ""
echo "==> Step 1: Building web + npm bundles"
cd "$ROOT"
bun run build 2>&1
bun run build:npm 2>&1

# ── Step 2: npm pack ──────────────────────────────────────────
echo ""
echo "==> Step 2: npm pack"
PKG_NAME=$(npm pack --silent 2>&1)
echo "    Packaged: $PKG_NAME"

# ── Step 3: Create temp env ───────────────────────────────────
echo ""
echo "==> Step 3: Setting up temp environment"
TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT

export HOME="${TMP}/home"
export npm_config_prefix="${TMP}/prefix"
export npm_config_cache="${TMP}/cache"
export CHRONA_DATA_DIR="${TMP}/data"
export CHRONA_CONFIG_DIR="${TMP}/config"
export CHRONA_RUNTIME_DIR="${TMP}/runtime"
export CHRONA_SKIP_BUN_DOWNLOAD=1

mkdir -p "$HOME" "$npm_config_prefix" "$npm_config_cache" \
  "$CHRONA_DATA_DIR" "$CHRONA_CONFIG_DIR" "$CHRONA_RUNTIME_DIR"

echo "    TMP=$TMP"
echo "    HOME=$HOME"
echo "    PREFIX=$npm_config_prefix"

# ── Step 4: npm install -g ────────────────────────────────────
echo ""
echo "==> Step 4: npm install -g"
mv "$PKG_NAME" "$OUT_DIR/"
cd "$OUT_DIR"
npm install -g "$OUT_DIR/$PKG_NAME" 2>&1
echo "    Installed."

# ── Step 5: Verify no better-sqlite3 ──────────────────────────
echo ""
echo "==> Step 5: Verify no better-sqlite3"
if find "$npm_config_prefix" -path "*/node_modules/better-sqlite3" -type d 2>/dev/null | grep -q .; then
  echo "    FAIL: better-sqlite3 package installed!"
  exit 1
fi
# Check for @prisma/adapter-better-sqlite3 too
if find "$npm_config_prefix" -path "*/node_modules/@prisma/adapter-better-sqlite3" -type d 2>/dev/null | grep -q .; then
  echo "    FAIL: @prisma/adapter-better-sqlite3 installed!"
  exit 1
fi
echo "    ✓ No better-sqlite3 in node_modules"

# ── Step 6: chrona --help ──────────────────────────────────────
echo ""
echo "==> Step 6: chrona --help"
export PATH="${npm_config_prefix}/bin:$PATH"
chrona_path=$(command -v chrona)
echo "    chrona at: $chrona_path"
"$chrona_path" --help 2>&1 || true

# ── Step 7: Verify no node-gyp was triggered ───────────────────
echo ""
echo "==> Step 7: Verify no node-gyp"
# Check if node-gyp exists anywhere in the installed tree
if find "$npm_config_prefix" -name "node-gyp" 2>/dev/null | grep -q .; then
  echo "    FAIL: node-gyp found!"
  exit 1
fi
echo "    ✓ No node-gyp"

echo ""
echo "==> Smoke test PASSED"
echo "    (Use PATH: $npm_config_prefix/bin)"
echo "    To start: chrona start"
echo "    Temp dir: $TMP"
