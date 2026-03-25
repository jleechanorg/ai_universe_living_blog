#!/usr/bin/env bash
#
# install-novel.sh — Install the novel engine into any repository
#
# Clones ai_universe_living_blog to a temp directory, builds the TypeScript,
# then copies the compiled dist/ output to the target repo's
# node_modules/ai-universe-living-blog/. This avoids touching the target's
# src/ or overwriting its package.json.
#
# Usage:
#   bash scripts/install-novel.sh --target=/path/to/your/repo
#   bash scripts/install-novel.sh --target=/path/to/your/repo --dry-run
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
    *)          echo "[install-novel] Unknown option: $arg" >&2; exit 1 ;;
  esac
done

TARGET="${TARGET:-$(pwd)}"
INSTALL_ID="ai-universe-living-blog-novel-$$"
TEMP_DIR="/tmp/${INSTALL_ID}"

REPO_URL="https://github.com/jleechanorg/ai_universe_living_blog.git"
REPO_DIR="${TEMP_DIR}/repo"

log()  { echo "[install-novel] $1"; }
warn() { echo "[install-novel] WARNING: $1" >&2; }
die()  { echo "[install-novel] ERROR: $1" >&2; exit 1; }

# ─── Dry-run banner ─────────────────────────────────────────────────────────────
log "ai-universe-living-blog — novel engine installer"
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
  log "Copying compiled novel engine to ${DEST}..."
  mkdir -p "${DEST}"
  cp -rT "${REPO_DIR}/dist/novel" "${DEST}/novel"
  cp -rT "${REPO_DIR}/dist/shared" "${DEST}/shared"
  cp -rT "${REPO_DIR}/dist/blog" "${DEST}/blog"
  cp "${REPO_DIR}/package.json" "${DEST}/package.json"
  log "  → ${DEST}/novel/cli.js"
  log "  → ${DEST}/novel/engine.js"
else
  log "Would copy:"
  log "  ${REPO_DIR}/dist/novel/   → ${DEST}/novel/"
  log "  ${REPO_DIR}/dist/shared/  → ${DEST}/shared/"
  log "  ${REPO_DIR}/dist/blog/    → ${DEST}/blog/"
fi

# ─── Merge package.json scripts into target (non-destructive) ───────────────────
if [[ -z "${DRY_RUN}" && -f "${TARGET}/package.json" ]]; then
  log "Merging npm scripts into target package.json..."
  node - <<'NODE_SCRIPT'
    const fs = require('fs');
    const targetPkg = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'));
    const sourcePkg = JSON.parse(fs.readFileSync(process.argv[3], 'utf-8'));
    if (sourcePkg.scripts) {
      targetPkg.scripts = { ...(targetPkg.scripts || {}), ...sourcePkg.scripts };
    }
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
log "  2. Set ANTHROPIC_API_KEY in your environment for the editor pass:"
log "     export ANTHROPIC_API_KEY=sk-ant-..."
log "  3. The blog MCP server must be running for daily-summary to work:"
log "     npm run dev:blog   # in one terminal"
log "  4. Generate a branch novel entry:"
log "     node ${DEST}/novel/cli.js branch-entry \\"
log "       --repo=owner/repo --session=ao-826 --branch=feat/my-branch --pr=42"
log "  5. Generate a daily community summary (requires ≥3 posts for the day):"
log "     node ${DEST}/novel/cli.js daily-summary --repo=owner/repo --session=ao-827"
log ""
log "Documentation: https://github.com/jleechanorg/ai_universe_living_blog/blob/main/docs/ARCHITECTURE.md"

# ─── Cleanup ───────────────────────────────────────────────────────────────────
cleanup() {
  if [[ -z "${DRY_RUN}" && -d "${TEMP_DIR}" ]]; then
    rm -rf "${TEMP_DIR}"
  fi
}
trap cleanup EXIT
