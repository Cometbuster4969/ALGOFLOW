#!/usr/bin/env bash
# ============================================================================
# AlgoFlow — First-Run Setup Wizard
# ============================================================================
# One-command setup that:
#   1. Detects OS and installs missing compilers
#   2. Configures firewall rules
#   3. Detects local network IP for tablet sync
#   4. Validates the full toolchain
#
# Usage:
#   chmod +x first-run-setup.sh
#   ./first-run-setup.sh
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1"; }
heading() { echo -e "\n${CYAN}${BOLD}$1${NC}\n"; }

clear
echo ""
echo "  ╔═══════════════════════════════════════════════════════════╗"
echo "  ║                                                          ║"
echo "  ║          ⚡ AlgoFlow — First-Run Setup Wizard            ║"
echo "  ║                                                          ║"
echo "  ╚═══════════════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Install compilers ────────────────────────────────────────────────

heading "Step 1/4: Checking Compilers"

echo "Checking g++, python3, javac..."
echo ""

COMPILER_OK=true

if command -v g++ &>/dev/null; then
  info "g++: $(g++ --version 2>&1 | head -1)"
else
  error "g++ NOT FOUND — C++ submissions will fail"
  COMPILER_OK=false
fi

if command -v python3 &>/dev/null; then
  info "python3: $(python3 --version 2>&1)"
elif command -v python &>/dev/null; then
  info "python: $(python --version 2>&1)"
else
  error "python3 NOT FOUND — Python submissions will fail"
  COMPILER_OK=false
fi

if command -v javac &>/dev/null; then
  info "javac: $(javac -version 2>&1)"
else
  warn "javac NOT FOUND — Java submissions will fail (optional)"
fi

if ! $COMPILER_OK; then
  echo ""
  read -p "Install missing compilers now? [Y/n] " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ || -z $REPLY ]]; then
    bash "$SCRIPT_DIR/install-compilers.sh"
  else
    warn "Skipping compiler installation. Some features may not work."
  fi
fi

# ── Step 2: Configure firewall ───────────────────────────────────────────────

heading "Step 2/4: Firewall Configuration"

PORT=3001

# Check if port is already open
if command -v ss &>/dev/null; then
  if ss -tlnp 2>/dev/null | grep -q ":$PORT"; then
    warn "Port $PORT is already in use — another instance may be running"
  fi
fi

echo "The whiteboard sync server needs port $PORT open for tablet connections."
echo ""
read -p "Configure firewall now? [Y/n] " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ || -z $REPLY ]]; then
  bash "$SCRIPT_DIR/setup-firewall.sh" "$PORT"
else
  warn "Skipping firewall setup. Tablet sync may be blocked."
fi

# ── Step 3: Network discovery ────────────────────────────────────────────────

heading "Step 3/4: Network Information"

LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || \
           ifconfig 2>/dev/null | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1 || \
           echo "UNKNOWN")

HOSTNAME=$(hostname)

echo "  ┌─────────────────────────────────────────────────────────┐"
echo "  │                                                         │"
echo "  │  Laptop IP Address:    $LOCAL_IP"
echo "  │  Laptop Hostname:      $HOSTNAME"
echo "  │  WebSocket Port:       $PORT"
echo "  │  WebSocket URL:        ws://$LOCAL_IP:$PORT"
echo "  │  mDNS URL (if avail):  ws://${HOSTNAME}.local:$PORT"
echo "  │                                                         │"
echo "  └─────────────────────────────────────────────────────────┘"
echo ""
echo "  On your tablet, set the sync server URL to:"
echo -e "  ${BOLD}ws://$LOCAL_IP:$PORT${NC}"
echo ""

if [[ "$LOCAL_IP" == "UNKNOWN" ]]; then
  warn "Could not detect local IP automatically."
  echo "  Run 'ip addr show' or 'ifconfig' to find your IP manually."
fi

# ── Step 4: Validation ───────────────────────────────────────────────────────

heading "Step 4/4: Validation"

echo "Running quick validation..."
echo ""

PASS=0
FAIL=0

# Test g++ compilation
if command -v g++ &>/dev/null; then
  TMPFILE=$(mktemp /tmp/algoflow_test_XXXXXX.cpp)
  echo '#include <iostream>
int main() { std::cout << "OK" << std::endl; return 0; }' > "$TMPFILE"

  if g++ -O2 -std=c++17 -o /tmp/algoflow_test_bin "$TMPFILE" 2>/dev/null; then
    OUTPUT=$(/tmp/algoflow_test_bin 2>/dev/null)
    if [[ "$OUTPUT" == "OK" ]]; then
      info "g++ compile + run: OK"
      PASS=$((PASS + 1))
    else
      error "g++ compile OK but run failed"
      FAIL=$((FAIL + 1))
    fi
    rm -f /tmp/algoflow_test_bin
  else
    error "g++ compilation failed"
    FAIL=$((FAIL + 1))
  fi
  rm -f "$TMPFILE"
fi

# Test python3
if command -v python3 &>/dev/null; then
  OUTPUT=$(python3 -c "print('OK')" 2>/dev/null)
  if [[ "$OUTPUT" == "OK" ]]; then
    info "python3 run: OK"
    PASS=$((PASS + 1))
  else
    error "python3 run failed"
    FAIL=$((FAIL + 1))
  fi
fi

# Test node
if command -v node &>/dev/null; then
  info "node: $(node --version)"
  PASS=$((PASS + 1))
else
  error "node NOT FOUND — AlgoFlow requires Node.js"
  FAIL=$((FAIL + 1))
fi

# Test port availability
if command -v ss &>/dev/null; then
  if ! ss -tlnp 2>/dev/null | grep -q ":$PORT"; then
    info "Port $PORT: available"
    PASS=$((PASS + 1))
  else
    warn "Port $PORT: in use (may need to stop existing process)"
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Setup Complete: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════════════"
echo ""

if [[ $FAIL -eq 0 ]]; then
  info "Everything is ready! Launch AlgoFlow to get started."
else
  warn "Some checks failed. Review the output above and fix issues before launching."
fi

echo ""
echo "  To launch AlgoFlow:"
echo "    Desktop app:  Double-click the AlgoFlow icon"
echo "    Browser:      Open http://127.0.0.1:$PORT"
echo "    Extension:    Load the extension/ folder in chrome://extensions"
echo ""
