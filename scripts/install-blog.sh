#!/usr/bin/env bash
#
# install-blog.sh — Install the blog MCP server into any repository
#
# This is a standalone install script. It clones ai_universe_living_blog to a
# temp directory, copies src/blog and src/shared TypeScript source into the
# target repo, then runs npm install && npm run build there.
#
# Usage:
#   bash scripts/install-blog.sh --target=/path/to/your/repo
#   bash scripts/install-blog.sh --target=/path/to/your/repo --dry-run
#
# Options:
#   --target=DIR   Target repo directory (default: current directory)
#   --dry-run      Show what would be installed without making changes

set -euo pipefail

TARGET=""
DRY_RUN=""

for arg in "$@"; do
  case $arg in
    --target=*) TARGET="${arg#*=}"; shift ;;
    --dry-run)  DRY_RUN=1; shift ;;
    *)          echo "[install-blog] Unknown option: $arg" >&2; exit 1 ;;
  esac
done

TARGET="${TARGET:-$(pwd)}"
INSTALL_ID="ai-universe-living-blog-blog-$$"
TEMP_DIR="/tmp/${INSTALL_ID}"

# Register cleanup trap early so TEMP_DIR is cleaned up even on early failures.
trap cleanup EXIT

REPO_URL="https://github.com/jleechanorg/ai_universe_living_blog.git"
REPO_DIR="${TEMP_DIR}/repo"

log()  { echo "[install-blog] $1"; }
warn() { echo "[install-blog] WARNING: $1" >&2; }
die()  { echo "[install-blog] ERROR: $1" >&2; exit 1; }

# ─── Cleanup ───────────────────────────────────────────────────────────────────
cleanup() {
  if [[ -z "${DRY_RUN}" && -d "${TEMP_DIR}" ]]; then
    rm -rf "${TEMP_DIR}"
  fi
}

# ─── Dry-run banner ─────────────────────────────────────────────────────────────
log "ai-universe-living-blog — blog MCP server installer"
log "Target: ${TARGET}"
[[ -n "${DRY_RUN}" ]] && log "DRY RUN — no changes will be made"

# ─── Validate target ────────────────────────────────────────────────────────────
if [[ ! -d "${TARGET}" ]]; then
  die "Target directory does not exist: ${TARGET}"
fi

if [[ ! -d "${TARGET}/.git" ]]; then
  die "Target directory is not a git repository: ${TARGET}"
fi

# ─── Clone to temp dir ─────────────────────────────────────────────────────────
if [[ -z "${DRY_RUN}" ]]; then
  mkdir -p "${TEMP_DIR}"
  log "Cloning ai_universe_living_blog..."
  if git clone --depth=1 "${REPO_URL}" "${REPO_DIR}" 2>&1; then
    : # success
  else
    # Fall back to SSH if HTTPS is blocked
    git clone --depth=1 "git@github.com:jleechanorg/ai_universe_living_blog.git" "${REPO_DIR}" \
      || die "Clone failed — check network and credentials"
  fi
else
  log "Would clone ${REPO_URL} to ${REPO_DIR}"
fi

# ─── Verify source directories exist in the cloned repo ────────────────────────
SRC_BLOG="${REPO_DIR}/src/blog"
SRC_SHARED="${REPO_DIR}/src/shared"

if [[ -z "${DRY_RUN}" ]]; then
  if [[ ! -d "${SRC_BLOG}" ]]; then
    die "src/blog not found in cloned repo — check the repository structure"
  fi
  if [[ ! -d "${SRC_SHARED}" ]]; then
    die "src/shared not found in cloned repo — check the repository structure"
  fi
fi

# ─── Compute destination paths ─────────────────────────────────────────────────
DEST_BLOG="${TARGET}/src/blog"
DEST_SHARED="${TARGET}/src/shared"
DEST_PKG="${TARGET}/package.json"
SRC_PKG="${REPO_DIR}/package.json"

# ─── Check target package.json ─────────────────────────────────────────────────
CREATED_PLACEHOLDER=""
if [[ -z "${DRY_RUN}" ]]; then
  if [[ ! -f "${DEST_PKG}" ]]; then
    warn "No package.json found in target — creating one"
    echo '{"name":"installed-blog","private":true}' > "${DEST_PKG}"
    CREATED_PLACEHOLDER=1
  fi
fi

# ─── Copy TypeScript source ─────────────────────────────────────────────────────
if [[ -z "${DRY_RUN}" ]]; then
  log "Copying src/blog/ and src/shared/ to target..."
  mkdir -p "${TARGET}/src"

  # Copy blog (safe copy: replace contents, don't nest)
  mkdir -p "${DEST_BLOG}"
  cp -r "${SRC_BLOG}/." "${DEST_BLOG}/"
  log "  → ${DEST_BLOG}"

  # Copy shared (safe copy)
  mkdir -p "${DEST_SHARED}"
  cp -r "${SRC_SHARED}/." "${DEST_SHARED}/"
  log "  → ${DEST_SHARED}"

  # Merge package.json (preserve target's existing scripts and dependencies)
  # [1]*[0] so DEST fields win on conflicts (host project takes precedence)
  if command -v jq &>/dev/null; then
    tmp=$(mktemp)
    if jq -s '.[1] * .[0]' "${DEST_PKG}" "${SRC_PKG}" > "${tmp}"; then
      mv "${tmp}" "${DEST_PKG}"
      log "  merged → ${DEST_PKG}"
    else
      rm -f "${tmp}"
      warn "Could not merge package.json — keeping target's version"
    fi
  else
    warn "jq not available — keeping target's package.json (scripts may be missing)"
  fi

  # Create or update scripts/ directory with the blog install script
  mkdir -p "${TARGET}/scripts"
  cp "${REPO_DIR}/scripts/install-blog.sh" "${TARGET}/scripts/install-blog.sh"
  chmod +x "${TARGET}/scripts/install-blog.sh"
  log "  → ${TARGET}/scripts/install-blog.sh"
else
  log "Would copy:"
  log "  ${SRC_BLOG}  → ${DEST_BLOG}"
  log "  ${SRC_SHARED} → ${DEST_SHARED}"
  log "  ${SRC_PKG}   → ${DEST_PKG}"
fi

# ─── Install dependencies and build ─────────────────────────────────────────────
if [[ -z "${DRY_RUN}" ]]; then
  if command -v npm &>/dev/null; then
    log "Running npm install..."
    (cd "${TARGET}" && npm install) || die "npm install failed"
    if [[ -n "${CREATED_PLACEHOLDER}" ]]; then
      warn "No package.json existed — skipping build (add build script to ${DEST_PKG})"
      warn "Run manually: npm install && npm run build"
    else
      log "Running npm run build..."
      (cd "${TARGET}" && npm run build) || die "npm run build failed"
    fi
  else
    warn "npm not found — skipping install and build"
    warn "Run the following manually in ${TARGET}:"
    warn "  npm install && npm run build"
  fi
else
  log "Would run in ${TARGET}: npm install && npm run build"
fi

# ─── Next steps ───────────────────────────────────────────────────────────────
log ""
log "Install complete!"
log ""
log "Next steps:"
log "  1. cd ${TARGET}"
log "  2. Add to ~/.claude.json (MCP servers section):"
log "     {"
log "       \"blog-mcp\": {"
log "         \"command\": \"tsx\","
log "         \"args\": [\"${TARGET}/src/blog/server.ts\"]"
log "       }"
log "     }"
log "  3. Restart Claude Code to load the MCP server"
log "  4. npm run dev:blog  # start the blog MCP server"
log ""
log "Documentation: https://github.com/jleechanorg/ai_universe_living_blog/blob/main/docs/ARCHITECTURE.md"
