#!/usr/bin/env bash
set -euo pipefail

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RESET="\033[0m"

echo -e "${BOLD}⚡ Chrona installer${RESET}"
echo ""

# ─── Check / install Bun ───
if ! command -v bun &> /dev/null; then
  echo -e "${YELLOW}Bun not found. Installing...${RESET}"
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
else
  echo -e "${GREEN}✓ Bun found${RESET}"
fi

INSTALL_METHOD="${1:-npm}"

case "$INSTALL_METHOD" in
  git)
    echo ""
    echo "Cloning Chrona repository..."
    INSTALL_DIR="${CHRONA_HOME:-$HOME/.chrona}"
    if [ -d "$INSTALL_DIR" ]; then
      echo "Chrona already installed at $INSTALL_DIR. Updating..."
      git -C "$INSTALL_DIR" pull --ff-only
    else
      git clone https://github.com/your-org/Chrona.git "$INSTALL_DIR"
    fi
    cd "$INSTALL_DIR"
    bun install
    bun run setup
    echo ""
    echo -e "${GREEN}✅ Chrona installed at $INSTALL_DIR${RESET}"
    echo ""
    echo "To start: cd $INSTALL_DIR && bun run dev"
    echo "Or add to PATH: export PATH=\"$INSTALL_DIR/packages/cli/src:\$PATH\""
    ;;
  npm|*)
    echo ""
    echo "Installing Chrona via npm..."
    if command -v npm &> /dev/null; then
      npm install -g chrona
    else
      echo -e "${YELLOW}npm not found, using bun...${RESET}"
      bun add -g chrona
    fi
    echo ""
    echo -e "${GREEN}✅ Chrona installed!${RESET}"
    echo ""
    echo "Run: chrona"
    ;;
esac
