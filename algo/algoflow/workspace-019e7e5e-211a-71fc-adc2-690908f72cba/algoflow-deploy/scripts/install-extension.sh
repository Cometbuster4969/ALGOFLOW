#!/usr/bin/env bash
# ============================================================================
# AlgoFlow — Chrome Extension Installer Helper
# ============================================================================
# Opens chrome://extensions and prints instructions for loading the extension.
#
# Usage:
#   chmod +x install-extension.sh
#   ./install-extension.sh [path-to-extension-folder]
# ============================================================================

set -euo pipefail

GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

EXT_DIR="${1:-$(dirname "$0")/../extension}"

# Resolve to absolute path
EXT_DIR="$(cd "$EXT_DIR" && pwd)"

echo ""
echo "  ╔═══════════════════════════════════════════════════════════╗"
echo "  ║     AlgoFlow — Chrome Extension Installer                ║"
echo "  ╚═══════════════════════════════════════════════════════════╝"
echo ""
echo -e "  Extension folder: ${CYAN}$EXT_DIR${NC}"
echo ""

# Verify the folder has manifest.json
if [[ ! -f "$EXT_DIR/manifest.json" ]]; then
  echo "  [ERROR] No manifest.json found in $EXT_DIR"
  echo "  Make sure you're pointing to the extension root folder."
  exit 1
fi

echo -e "  ${BOLD}Installation Steps:${NC}"
echo ""
echo "  1. Open Chrome and navigate to:"
echo -e "     ${CYAN}chrome://extensions${NC}"
echo ""
echo "  2. Enable 'Developer mode' (toggle in top-right corner)"
echo ""
echo "  3. Click 'Load unpacked' (top-left)"
echo ""
echo "  4. Select this folder:"
echo -e "     ${CYAN}$EXT_DIR${NC}"
echo ""
echo "  5. The AlgoFlow extension will appear in your toolbar"
echo ""
echo "  ─────────────────────────────────────────────────────────"
echo ""
echo "  The extension will stay active until you manually remove it."
echo "  It auto-updates when you pull new code (just click the refresh"
echo "  icon on the extension card in chrome://extensions)."
echo ""

# Try to open Chrome automatically
if command -v google-chrome &>/dev/null; then
  read -p "  Open chrome://extensions now? [Y/n] " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ || -z $REPLY ]]; then
    google-chrome "chrome://extensions" &>/dev/null &
    echo -e "  ${GREEN}[✓]${NC} Chrome opened"
  fi
elif command -v open &>/dev/null; then
  read -p "  Open chrome://extensions now? [Y/n] " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ || -z $REPLY ]]; then
    open -a "Google Chrome" "chrome://extensions" 2>/dev/null || true
    echo -e "  ${GREEN}[✓]${NC} Chrome opened"
  fi
else
  echo "  (Could not auto-open Chrome — please navigate manually)"
fi

echo ""
