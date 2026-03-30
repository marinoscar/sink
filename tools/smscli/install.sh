#!/usr/bin/env bash
#
# install.sh — Install or update smscli on Linux (Ubuntu-targeted)
#
# This script:
#   1. Checks prerequisites (Node.js >= 18, npm)
#   2. Resolves the smscli source directory (where this script lives)
#   3. Installs npm dependencies
#   4. Builds TypeScript
#   5. Creates a symlink at /usr/local/bin/smscli (or updates it if it exists)
#   6. Verifies the installation
#
# Usage:
#   ./install.sh              # Install or update (may prompt for sudo)
#   ./install.sh --uninstall  # Remove smscli from the system
#
# The script is idempotent — running it again performs an update:
#   - Reinstalls dependencies (picks up any changes)
#   - Rebuilds TypeScript
#   - Re-creates the symlink (in case the repo moved)
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_SOURCE="${SCRIPT_DIR}/bin/smscli.js"
LINK_TARGET="/usr/local/bin/smscli"
MIN_NODE_MAJOR=18

# ---------------------------------------------------------------------------
# Colors (if terminal supports them)
# ---------------------------------------------------------------------------

if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  DIM='\033[2m'
  RESET='\033[0m'
else
  RED='' GREEN='' YELLOW='' CYAN='' BOLD='' DIM='' RESET=''
fi

info()    { echo -e "${CYAN}${BOLD}[info]${RESET}  $*"; }
success() { echo -e "${GREEN}${BOLD}[ok]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}${BOLD}[warn]${RESET}  $*"; }
fail()    { echo -e "${RED}${BOLD}[error]${RESET} $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------

if [[ "${1:-}" == "--uninstall" ]]; then
  info "Uninstalling smscli…"

  if [ -L "${LINK_TARGET}" ]; then
    sudo rm -f "${LINK_TARGET}"
    success "Removed ${LINK_TARGET}"
  elif [ -f "${LINK_TARGET}" ]; then
    sudo rm -f "${LINK_TARGET}"
    success "Removed ${LINK_TARGET}"
  else
    warn "${LINK_TARGET} does not exist — nothing to remove."
  fi

  info "To also remove config and auth tokens:"
  echo "  rm -rf ~/.config/smscli"
  exit 0
fi

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------

echo ""
echo -e "${BOLD}Sink SMS CLI — Installer${RESET}"
echo -e "${DIM}────────────────────────${RESET}"
echo ""

# ---------------------------------------------------------------------------
# 1. Check prerequisites
# ---------------------------------------------------------------------------

info "Checking prerequisites…"

# Node.js
if ! command -v node &>/dev/null; then
  fail "Node.js is not installed. Install Node.js ${MIN_NODE_MAJOR}+ first:\n  https://nodejs.org/ or: sudo apt install nodejs"
fi

NODE_VERSION="$(node -v | sed 's/^v//')"
NODE_MAJOR="$(echo "${NODE_VERSION}" | cut -d. -f1)"

if [ "${NODE_MAJOR}" -lt "${MIN_NODE_MAJOR}" ]; then
  fail "Node.js ${NODE_VERSION} found but ${MIN_NODE_MAJOR}+ is required.\n  Upgrade: https://nodejs.org/"
fi
success "Node.js ${NODE_VERSION}"

# npm
if ! command -v npm &>/dev/null; then
  fail "npm is not installed. It should come with Node.js."
fi
success "npm $(npm -v)"

# ---------------------------------------------------------------------------
# 2. Resolve source directory
# ---------------------------------------------------------------------------

info "Source directory: ${SCRIPT_DIR}"

if [ ! -f "${SCRIPT_DIR}/package.json" ]; then
  fail "package.json not found in ${SCRIPT_DIR}. Run this script from the tools/smscli directory."
fi

if [ ! -f "${BIN_SOURCE}" ]; then
  fail "bin/smscli.js not found. The repository may be incomplete."
fi

# ---------------------------------------------------------------------------
# 3. Install dependencies
# ---------------------------------------------------------------------------

info "Installing dependencies…"

# Check if we're in a monorepo (workspaces) — if so, install from root
REPO_ROOT="${SCRIPT_DIR}/../.."
if [ -f "${REPO_ROOT}/package.json" ] && grep -q '"workspaces"' "${REPO_ROOT}/package.json" 2>/dev/null; then
  info "Detected monorepo — installing from repository root…"
  (cd "${REPO_ROOT}" && npm install --workspace=tools/smscli 2>&1 | tail -5)
else
  (cd "${SCRIPT_DIR}" && npm install 2>&1 | tail -5)
fi
success "Dependencies installed"

# ---------------------------------------------------------------------------
# 4. Build TypeScript
# ---------------------------------------------------------------------------

info "Building TypeScript…"
(cd "${SCRIPT_DIR}" && npm run build 2>&1)
success "Build complete"

# ---------------------------------------------------------------------------
# 5. Create/update symlink
# ---------------------------------------------------------------------------

# Extract version from the built output
CLI_VERSION="$(node "${BIN_SOURCE}" --version 2>/dev/null || echo "unknown")"

info "Installing smscli ${CLI_VERSION} to ${LINK_TARGET}…"

# Check if the link already exists
if [ -L "${LINK_TARGET}" ]; then
  EXISTING_TARGET="$(readlink -f "${LINK_TARGET}")"
  if [ "${EXISTING_TARGET}" = "$(readlink -f "${BIN_SOURCE}")" ]; then
    success "Symlink already points to the correct location — updated in place"
  else
    info "Updating existing symlink (was: ${EXISTING_TARGET})"
    sudo ln -sf "${BIN_SOURCE}" "${LINK_TARGET}"
    success "Symlink updated"
  fi
elif [ -f "${LINK_TARGET}" ]; then
  warn "${LINK_TARGET} exists and is not a symlink — replacing it"
  sudo ln -sf "${BIN_SOURCE}" "${LINK_TARGET}"
  success "Symlink created (replaced existing file)"
else
  sudo ln -sf "${BIN_SOURCE}" "${LINK_TARGET}"
  success "Symlink created"
fi

# Ensure the bin script is executable
chmod +x "${BIN_SOURCE}"

# ---------------------------------------------------------------------------
# 6. Verify
# ---------------------------------------------------------------------------

echo ""
info "Verifying installation…"

if command -v smscli &>/dev/null; then
  INSTALLED_VERSION="$(smscli --version 2>/dev/null || echo "unknown")"
  success "smscli ${INSTALLED_VERSION} is now available globally"
else
  warn "smscli is installed at ${LINK_TARGET} but may not be in your PATH"
  warn "Add /usr/local/bin to your PATH if it's not already there:"
  echo "  export PATH=\"/usr/local/bin:\$PATH\""
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

echo ""
echo -e "${BOLD}Installation complete!${RESET}"
echo ""
echo "  Get started:"
echo "    smscli --help              # Show all commands"
echo "    smscli --version           # Show version"
echo "    smscli config set-url URL  # Set your API URL"
echo "    smscli auth login          # Authenticate"
echo "    smscli doctor              # Check setup"
echo ""
echo "  To update later, run this script again:"
echo "    ${SCRIPT_DIR}/install.sh"
echo ""
echo "  To uninstall:"
echo "    ${SCRIPT_DIR}/install.sh --uninstall"
echo ""
