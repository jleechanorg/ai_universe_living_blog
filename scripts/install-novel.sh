#!/usr/bin/env bash
#
# install-novel.sh — Install the novel engine into any repository
#
# This is a standalone install script. It clones ai_universe_living_blog to a
# temp directory, copies src/novel and src/shared TypeScript source into the
# target repo, then runs npm install && npm run build there.
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

# Register cleanup trap early so TEMP_DIR is cleaned up even on early failures.
trap cleanup EXIT

REPO_URL="https://github.com/jleechanorg/ai_universe_living_blog.git"
REPO_DIR="${TEMP_DIR}/repo"

log()  { echo "[install-novel] $1"; }
warn() { echo "[install-novel] WARNING: $1" >&2; }
die()  { echo "[install-novel] ERROR: $1" >&2; exit 1; }

# ─── Cleanup ───────────────────────────────────────────────────────────────────
# Defined early so the trap is registered before any operation that could fail.
cleanup() {
  if [[ -z "${DRY_RUN}" && -d "${TEMP_DIR}" ]]; then
    rm -rf "${TEMP_DIR}"
  fi
}

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

# ─── Verify source directories exist in the cloned repo ────────────────────────
SRC_NOVEL="${REPO_DIR}/src/novel"
SRC_SHARED="${REPO_DIR}/src/shared"

if [[ -z "${DRY_RUN}" ]]; then
  if [[ ! -d "${SRC_NOVEL}" ]]; then
    die "src/novel not found in cloned repo — check the repository structure"
  fi
  if [[ ! -d "${SRC_SHARED}" ]]; then
    die "src/shared not found in cloned repo — check the repository structure"
  fi
fi

# ─── Compute destination paths ─────────────────────────────────────────────────
DEST_NOVEL="${TARGET}/src/novel"
DEST_SHARED="${TARGET}/src/shared"
DEST_PKG="${TARGET}/package.json"
SRC_PKG="${REPO_DIR}/package.json"

# ─── Check target package.json ─────────────────────────────────────────────────
CREATED_PLACEHOLDER=""
if [[ -z "${DRY_RUN}" ]]; then
  if [[ ! -f "${DEST_PKG}" ]]; then
    warn "No package.json found in target — creating one"
    echo '{"name":"installed-novel","private":true}' > "${DEST_PKG}"
    CREATED_PLACEHOLDER=1
  fi
fi

# ─── Copy TypeScript source ─────────────────────────────────────────────────────
if [[ -z "${DRY_RUN}" ]]; then
  log "Copying src/novel/ and src/shared/ to target..."
  mkdir -p "${TARGET}/src"

  # Copy novel (safe copy: replace contents, don't nest)
  mkdir -p "${DEST_NOVEL}"
  cp -r "${SRC_NOVEL}/." "${DEST_NOVEL}/"
  log "  → ${DEST_NOVEL}"

  # Copy shared (safe copy)
  mkdir -p "${DEST_SHARED}"
  cp -r "${SRC_SHARED}/." "${DEST_SHARED}/"
  log "  → ${DEST_SHARED}"

  # Copy blog helpers required by the CLI and engine
  mkdir -p "${TARGET}/src/blog"
  cp "${REPO_DIR}/src/blog/storage.ts" "${TARGET}/src/blog/storage.ts"
  cp "${REPO_DIR}/src/blog/tools.ts" "${TARGET}/src/blog/tools.ts"
  log "  → ${TARGET}/src/blog/storage.ts"
  log "  → ${TARGET}/src/blog/tools.ts (required by src/novel/engine.ts)"

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

  # Create or update scripts/ directory with the novel install script
  mkdir -p "${TARGET}/scripts"
  cp "${REPO_DIR}/scripts/install-novel.sh" "${TARGET}/scripts/install-novel.sh"
  chmod +x "${TARGET}/scripts/install-novel.sh"
  log "  → ${TARGET}/scripts/install-novel.sh"
else
  log "Would copy:"
  log "  ${SRC_NOVEL}  → ${DEST_NOVEL}"
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
log "  2. Set ANTHROPIC_API_KEY in your environment for the editor pass:"
log "     export ANTHROPIC_API_KEY=sk-ant-..."
log "  3. Generate a branch novel entry:"
log "     npm run dev:novel -- branch-entry \\"
log "       --repo=owner/repo \\"
log "       --session=ao-826 \\"
log "       --branch=feat/my-branch \\"
log "       --pr=42"
log "  4. Generate a daily community summary (requires ≥3 posts for the day):"
log "     npm run dev:novel -- daily-summary --repo=owner/repo --session=ao-827"
log ""
log "Documentation: https://github.com/jleechanorg/ai_universe_living_blog/blob/main/docs/ARCHITECTURE.md"
