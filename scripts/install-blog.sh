#!/usr/bin/env bash
#
# install-blog.sh — Install the blog MCP server into any repository
#
# Clones ai_universe_living_blog to a temp directory, builds the TypeScript,
# then copies the compiled dist/ output to the target repo's
# node_modules/ai-universe-living-blog/. This avoids touching the target's
# src/ or overwriting its package.json.
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

REPO_URL="https://github.com/jleechanorg/ai_universe_living_blog.git"
REPO_DIR="${TEMP_DIR}/repo"

log()  { echo "[install-blog] $1"; }
warn() { echo "[install-blog] WARNING: $1" >&2; }
die()  { echo "[install-blog] ERROR: $1" >&2; exit 1; }

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

# ─── Build in temp dir ────────────────────────────────────────────────────────
if [[ -z "${DRY_RUN}" ]]; then
  log "Installing dependencies and building TypeScript..."
  (cd "${REPO_DIR}" && npm install --silent 2>/dev/null && npm run build) \
    || die "npm install/build failed in ${REPO_DIR}"
else
  log "Would run: cd ${REPO_DIR} && npm install && npm run build"
fi

# ─── Copy compiled output to target node_modules ────────────────────────────────
DEST="${TARGET}/node_modules/ai-universe-living-blog"

if [[ -z "${DRY_RUN}" ]]; then
  log "Copying compiled blog server to ${DEST}..."
  mkdir -p "${DEST}"
  # cp -rT merges src/ into dest/ without creating a nested subdirectory.
  # --no-target-directory is not available on macOS; -T is the POSIX equivalent.
  cp -rT "${REPO_DIR}/dist/blog" "${DEST}/blog"
  cp -rT "${REPO_DIR}/dist/shared" "${DEST}/shared"
  # Also copy novel dist since the blog server may depend on shared types
  # that resolve via the package's own node_modules.
  cp -rT "${REPO_DIR}/dist/novel" "${DEST}/novel"
  cp "${REPO_DIR}/package.json" "${DEST}/package.json"
  log "  → ${DEST}/blog/server.js"
else
  log "Would copy:"
  log "  ${REPO_DIR}/dist/blog/   → ${DEST}/blog/"
  log "  ${REPO_DIR}/dist/shared/  → ${DEST}/shared/"
  log "  ${REPO_DIR}/dist/novel/   → ${DEST}/novel/"
fi

# ─── Merge package.json scripts into target (non-destructive) ───────────────────
if [[ -z "${DRY_RUN}" && -f "${TARGET}/package.json" ]]; then
  log "Merging npm scripts into target package.json..."
  # Use node to do a clean deep merge of scripts only (avoids bash JSON pitfalls)
  node - <<'NODE_SCRIPT'
    const fs = require('fs');
    const targetPkg = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'));
    const sourcePkg = JSON.parse(fs.readFileSync(process.argv[3], 'utf-8'));
    // Only merge the scripts field, preserve everything else in target
    if (sourcePkg.scripts) {
      targetPkg.scripts = { ...(targetPkg.scripts || {}), ...sourcePkg.scripts };
    }
    // Add blog-specific peer deps if not present
    if (!targetPkg.dependencies) targetPkg.dependencies = {};
    const peerDeps = ['express', 'cors', 'uuid', 'winston', 'zod'];
    for (const dep of peerDeps) {
      if (!targetPkg.dependencies[dep] && sourcePkg.dependencies?.[dep]) {
        targetPkg.dependencies[dep] = sourcePkg.dependencies[dep];
      }
    }
    fs.writeFileSync(process.argv[2], JSON.stringify(targetPkg, null, 2) + '\n');
    console.log('Merged scripts into', process.argv[2]);
  -- "${TARGET}/package.json" "${REPO_DIR}/package.json" || {
    warn "package.json merge failed — skipping (target package.json preserved)"
  }
fi

# ─── Next steps ───────────────────────────────────────────────────────────────
log ""
log "Install complete!"
log ""
log "Next steps:"
log "  1. cd ${TARGET} && npm install   # install any new peer dependencies"
log "  2. Add to ~/.claude.json (MCP servers section):"
log "     {"
log "       \"blog-mcp\": {"
log "         \"command\": \"node\","
log "         \"args\": [\"${DEST}/blog/server.js\"]"
log "       }"
log "     }"
log "  3. Restart Claude Code to load the MCP server"
log "  4. npm run dev:blog  # start the blog MCP server (or: node ${DEST}/blog/server.js)"
log ""
log "Documentation: https://github.com/jleechanorg/ai_universe_living_blog/blob/main/docs/ARCHITECTURE.md"

# ─── Cleanup ───────────────────────────────────────────────────────────────────
cleanup() {
  if [[ -z "${DRY_RUN}" && -d "${TEMP_DIR}" ]]; then
    rm -rf "${TEMP_DIR}"
  fi
}
trap cleanup EXIT
