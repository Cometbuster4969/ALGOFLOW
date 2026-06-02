#!/usr/bin/env bash
# ============================================================================
# AlgoFlow — Firewall Configuration Script
# ============================================================================
# Opens the WebSocket port for cross-device whiteboard sync.
# Run this on the laptop (the server machine).
#
# Usage:
#   chmod +x setup-firewall.sh
#   sudo ./setup-firewall.sh
# ============================================================================

set -euo pipefail

PORT=${1:-3001}
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  AlgoFlow — Firewall Setup (Port $PORT)"
echo "═══════════════════════════════════════════════════════"
echo ""

# ── Detect OS ────────────────────────────────────────────────────────────────

if [[ "$OSTYPE" == "linux-gnu"* ]]; then

  # ── Linux: ufw or iptables ──────────────────────────────────────────────

  if command -v ufw &>/dev/null; then
    info "Using ufw..."
    sudo ufw allow "$PORT/tcp" comment "AlgoFlow whiteboard sync"
    sudo ufw reload
    info "Port $PORT/tcp opened via ufw"
  elif command -v firewall-cmd &>/dev/null; then
    info "Using firewalld..."
    sudo firewall-cmd --permanent --add-port="$PORT/tcp"
    sudo firewall-cmd --reload
    info "Port $PORT/tcp opened via firewalld"
  else
    warn "No firewall manager found. Adding iptables rule..."
    sudo iptables -A INPUT -p tcp --dport "$PORT" -j ACCEPT -m comment --comment "AlgoFlow"
    info "Port $PORT/tcp opened via iptables (not persistent across reboot)"
    warn "To make persistent: sudo apt-get install iptables-persistent"
  fi

elif [[ "$OSTYPE" == "darwin"* ]]; then

  # ── macOS: socketfilterfw ───────────────────────────────────────────────

  info "Configuring macOS Application Firewall..."

  # Find the AlgoFlow binary
  ALGOFLOW_APP="/Applications/AlgoFlow.app"

  if [[ -d "$ALGOFLOW_APP" ]]; then
    sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "$ALGOFLOW_APP"
    sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp "$ALGOFLOW_APP"
    info "AlgoFlow.app added to firewall allow list"
  else
    warn "AlgoFlow.app not found in /Applications"
    warn "The macOS firewall prompt will appear on first launch — click 'Allow'"
  fi

  echo ""
  info "Also ensure your Wi-Fi network allows local device communication."
  warn "If using 'Stealth Mode' in System Preferences > Security > Firewall, disable it."

elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then

  # ── Windows (Git Bash / WSL) ────────────────────────────────────────────

  info "Adding Windows Firewall inbound rule..."

  # Try netsh from within Git Bash
  netsh advfirewall firewall add rule \
    name="AlgoFlow Whiteboard Sync (TCP $PORT)" \
    dir=in action=allow protocol=TCP localport="$PORT" \
    profile=private \
    2>/dev/null && info "Inbound rule added for port $PORT (private networks)" || {
      warn "Could not add rule automatically."
      echo ""
      echo "  Please run this in an Administrator Command Prompt:"
      echo ""
      echo "    netsh advfirewall firewall add rule \\"
      echo "      name=\"AlgoFlow Whiteboard Sync\" \\"
      echo "      dir=in action=allow protocol=TCP localport=$PORT \\"
      echo "      profile=private"
      echo ""
    }
else
  error "Unsupported OS. Please open port $PORT manually."
fi

# ── Get local IP ─────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Network Information"
echo "═══════════════════════════════════════════════════════"
echo ""

# Get local IPv4 address
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || \
           ifconfig 2>/dev/null | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1 || \
           ipconfig 2>/dev/null | grep -i "IPv4" | awk '{print $NF}' | head -1 || \
           echo "UNKNOWN")

echo "  Local IP Address:  $LOCAL_IP"
echo "  WebSocket Port:    $PORT"
echo "  WebSocket URL:     ws://$LOCAL_IP:$PORT"
echo ""
echo "  Configure your tablet app to connect to:"
echo "  ┌─────────────────────────────────────────┐"
echo "  │  ws://$LOCAL_IP:$PORT"
echo "  └─────────────────────────────────────────┘"
echo ""

warn "If your router assigns dynamic IPs, the address may change."
echo "  To prevent this, set a static IP for this machine in your router's DHCP settings."
echo "  Or use: hostnamectl set-hostname algoflow (for mDNS: algoflow.local)"
echo ""

info "Firewall configuration complete."
