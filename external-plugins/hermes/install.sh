#!/usr/bin/env bash
set -euo pipefail

PLUGIN_SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
INSTALL_DIR="${CHRONA_HERMES_PLUGIN_DIR:-$HERMES_HOME/plugins/chrona}"

mkdir -p "$INSTALL_DIR"

cp "$PLUGIN_SOURCE_DIR/__init__.py" "$INSTALL_DIR/__init__.py"
cp "$PLUGIN_SOURCE_DIR/tools.py" "$INSTALL_DIR/tools.py"
cp "$PLUGIN_SOURCE_DIR/plugin.yaml" "$INSTALL_DIR/plugin.yaml"
cp "$PLUGIN_SOURCE_DIR/README.md" "$INSTALL_DIR/README.md"
cp "$PLUGIN_SOURCE_DIR/smoke_test.py" "$INSTALL_DIR/smoke_test.py"

printf 'Chrona Hermes plugin installed to %s\n' "$INSTALL_DIR"

if [ "${CHRONA_HERMES_SKIP_ENABLE:-}" = "1" ]; then
  printf 'Skipped Hermes enable step. Enable later with: hermes plugins enable chrona\n'
  exit 0
fi

if command -v hermes >/dev/null 2>&1; then
  if hermes plugins enable chrona; then
    printf 'Chrona Hermes plugin enabled.\n'
  else
    printf 'Chrona Hermes plugin copied, but `hermes plugins enable chrona` failed.\n' >&2
    printf 'Run it manually after checking Hermes configuration.\n' >&2
  fi
else
  printf 'Hermes CLI not found. Enable later with: hermes plugins enable chrona\n'
fi
