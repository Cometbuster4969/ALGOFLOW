#!/usr/bin/env bash
# ============================================================================
# AlgoFlow — Compiler Installation Script
# ============================================================================
# Detects the OS and installs g++, python3, and javac.
# Run this once on the production machine before first launch.
#
# Usage:
#   chmod +x install-compilers.sh
#   ./install-compilers.sh
# ============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }

check_cmd() {
  if command -v "$1" &>/dev/null; then
    info "$1 found: $(command -v "$1")"
    return 0
  else
    error "$1 NOT FOUND"
    return 1
  fi
}

# ── Detect OS ────────────────────────────────────────────────────────────────

detect_os() {
  if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    if command -v apt-get &>/dev/null; then
      echo "debian"
    elif command -v dnf &>/dev/null; then
      echo "fedora"
    elif command -v pacman &>/dev/null; then
      echo "arch"
    else
      echo "linux-unknown"
    fi
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo "macos"
  elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    echo "windows"
  else
    echo "unknown"
  fi
}

OS=$(detect_os)
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  AlgoFlow Compiler Installer — Detected OS: $OS"
echo "═══════════════════════════════════════════════════════"
echo ""

# ── Check what's already installed ───────────────────────────────────────────

MISSING=()

echo "Checking existing compilers..."
check_cmd g++     || MISSING+=("g++")
check_cmd python3 || check_cmd python || MISSING+=("python3")
check_cmd javac   || MISSING+=("javac")
echo ""

if [[ ${#MISSING[@]} -eq 0 ]]; then
  info "All compilers are already installed!"
  echo ""
  echo "  g++:     $(g++ --version 2>&1 | head -1)"
  echo "  python3: $(python3 --version 2>&1)"
  echo "  javac:   $(javac -version 2>&1)"
  echo ""
  exit 0
fi

warn "Missing: ${MISSING[*]}"
echo ""

# ── Install ──────────────────────────────────────────────────────────────────

install_debian() {
  info "Updating package lists..."
  sudo apt-get update -qq

  for pkg in "${MISSING[@]}"; do
    case "$pkg" in
      g++)
        info "Installing g++ (build-essential)..."
        sudo apt-get install -y build-essential
        ;;
      python3)
        info "Installing python3..."
        sudo apt-get install -y python3 python3-pip
        ;;
      javac)
        info "Installing OpenJDK..."
        sudo apt-get install -y default-jdk
        ;;
    esac
  done
}

install_fedora() {
  info "Installing compilers via dnf..."
  for pkg in "${MISSING[@]}"; do
    case "$pkg" in
      g++)     sudo dnf install -y gcc-c++ ;;
      python3) sudo dnf install -y python3 ;;
      javac)   sudo dnf install -y java-latest-openjdk-devel ;;
    esac
  done
}

install_arch() {
  info "Installing compilers via pacman..."
  sudo pacman -Sy --noconfirm
  for pkg in "${MISSING[@]}"; do
    case "$pkg" in
      g++)     sudo pacman -S --noconfirm gcc ;;
      python3) sudo pacman -S --noconfirm python ;;
      javac)   sudo pacman -S --noconfirm jdk-openjdk ;;
    esac
  done
}

install_macos() {
  # Check for Xcode Command Line Tools
  if ! xcode-select -p &>/dev/null; then
    info "Installing Xcode Command Line Tools (includes g++)..."
    xcode-select --install
    echo "  Please complete the installer dialog, then re-run this script."
    exit 0
  fi

  # Check for Homebrew
  if ! command -v brew &>/dev/null; then
    info "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi

  for pkg in "${MISSING[@]}"; do
    case "$pkg" in
      g++)
        info "g++ is provided by Xcode CLT (already installed above)"
        ;;
      python3)
        info "Installing python3 via Homebrew..."
        brew install python3
        ;;
      javac)
        info "Installing OpenJDK via Homebrew..."
        brew install openjdk
        # Add to PATH
        echo 'export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"' >> ~/.zshrc
        export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"
        ;;
    esac
  done
}

install_windows() {
  echo ""
  echo "  ╔═══════════════════════════════════════════════════════════╗"
  echo "  ║  Windows detected — please install manually:             ║"
  echo "  ╠═══════════════════════════════════════════════════════════╣"
  echo "  ║                                                          ║"
  echo "  ║  C++ (g++):                                              ║"
  echo "  ║    Download MSYS2 from https://www.msys2.org             ║"
  echo "  ║    Then run: pacman -S mingw-w64-x86_64-gcc              ║"
  echo "  ║    Add C:\\msys64\\mingw64\\bin to System PATH             ║"
  echo "  ║                                                          ║"
  echo "  ║  Python 3:                                               ║"
  echo "  ║    Download from https://python.org/downloads            ║"
  echo "  ║    Check 'Add Python to PATH' during install             ║"
  echo "  ║                                                          ║"
  echo "  ║  Java (JDK):                                             ║"
  echo "  ║    Download from https://adoptium.net                    ║"
  echo "  ║    Add JAVA_HOME and %JAVA_HOME%\\bin to PATH            ║"
  echo "  ║                                                          ║"
  echo "  ╚═══════════════════════════════════════════════════════════╝"
  echo ""
}

case "$OS" in
  debian)   install_debian ;;
  fedora)   install_fedora ;;
  arch)     install_arch ;;
  macos)    install_macos ;;
  windows)  install_windows ;;
  *)
    error "Unsupported OS: $OS"
    echo "  Please install g++, python3, and javac manually."
    exit 1
    ;;
esac

# ── Verify ───────────────────────────────────────────────────────────────────

echo ""
echo "Verifying installation..."
echo ""

ALL_OK=true
check_cmd g++     || ALL_OK=false
check_cmd python3 || check_cmd python || ALL_OK=false
check_cmd javac   || ALL_OK=false

echo ""
if $ALL_OK; then
  info "All compilers installed successfully!"
  echo ""
  echo "  g++:     $(g++ --version 2>&1 | head -1)"
  echo "  python3: $(python3 --version 2>&1)"
  echo "  javac:   $(javac -version 2>&1)"
else
  warn "Some compilers are still missing. The app will work for installed languages only."
fi

echo ""
echo "Done. You can now launch AlgoFlow."
