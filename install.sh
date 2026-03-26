#!/usr/bin/env bash
#
# install.sh — Install ai-universe-living-blog into any repository
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/jleechanorg/ai_universe_living_blog/main/install.sh | bash
#   bash install.sh --target=/path/to/your/repo
#
# Options:
#   --target=DIR      Target repo (default: current directory)
#   --blog-only      Install blog MCP server only
#   --novel-only     Install novel engine only
#   --no-mcp         Skip MCP server config
#   --dry-run        Show what would be installed
#

set -euo pipefail

TARGET=""
BLOG_ONLY=""
NOVEL_ONLY=""
NO_MCP=""
DRY_RUN=""

for arg in "$@"; do
  case $arg in
    --target=*) TARGET="${arg#*=}"; shift ;;
    --blog-only) BLOG_ONLY=1; shift ;;
    --novel-only) NOVEL_ONLY=1; shift ;;
    --no-mcp) NO_MCP=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
  esac
done

TARGET="${TARGET:-$(pwd)}"
INSTALL_ID="ai-universe-living-blog-$$"
TEMP_DIR="/tmp/${INSTALL_ID}"

log() { echo "[install] $1"; }
warn() { echo "[install] WARNING: $1" >&2; }
die() { echo "[install] ERROR: $1" >&2; exit 1; }

# ─── Validate mutually-exclusive flags ─────────────────────────────────────────
if [[ -n "${BLOG_ONLY}" && -n "${NOVEL_ONLY}" ]]; then
  die "--blog-only and --novel-only cannot be used together"
fi

# ─── Banner ──────────────────────────────────────────────────────────────────────
log "ai-universe-living-blog installer"
log "Target: ${TARGET}"
[[ -n "${DRY_RUN}" ]] && log "DRY RUN — no changes will be made"

# ─── Pre-flight ────────────────────────────────────────────────────────────────
if [[ ! -d "${TARGET}/.git" ]]; then
  die "Target directory is not a git repository: ${TARGET}"
fi

if [[ ! -f "${TARGET}/package.json" ]]; then
  warn "No package.json found — creating one"
  [[ -z "${DRY_RUN}" ]] && echo '{"name":"installed-blog","private":true}' > "${TARGET}/package.json"
fi

# ─── Bootstrap temp dir ────────────────────────────────────────────────────────
if [[ -z "${DRY_RUN}" ]]; then
  mkdir -p "${TEMP_DIR}"
  log "Cloning ai_universe_living_blog..."
  if git clone --depth=1 https://github.com/jleechanorg/ai_universe_living_blog.git "${TEMP_DIR}/src" 2>&1; then
    : # success
  else
    git clone --depth=1 git@github.com:jleechanorg/ai_universe_living_blog.git "${TEMP_DIR}/src" || die "Clone failed"
  fi
fi

# Source root inside the cloned repo (repo root is at ${TEMP_DIR}/src/)
SRC_ROOT="${TEMP_DIR}/src"

# ─── Install blog ─────────────────────────────────────────────────────────────
install_blog() {
  log "Installing blog MCP server..."
  local dest="${TARGET}/node_modules/ai-universe-living-blog"
  if [[ -z "${DRY_RUN}" ]]; then
    mkdir -p "${dest}"
    # Build TypeScript first so dist/ exists — single authoritative build step
    if command -v npm &>/dev/null && [[ -f "${SRC_ROOT}/package.json" ]]; then
      (cd "${SRC_ROOT}" && npm install --silent 2>/dev/null && npm run build) || \
        die "npm build failed in ${SRC_ROOT} — cannot install"
    fi
    cp -r "${SRC_ROOT}/dist/blog" "${dest}/"
    cp -r "${SRC_ROOT}/dist/shared" "${dest}/"
    cp "${SRC_ROOT}/package.json" "${dest}/package.json"
  fi
  log "  → Blog server: ${dest}"
  log "  → MCP path: ${dest}/dist/blog/server.js"
}

# ─── Install novel ─────────────────────────────────────────────────────────────
install_novel() {
  log "Installing novel engine..."
  local dest="${TARGET}/node_modules/ai-universe-living-blog"
  if [[ -z "${DRY_RUN}" ]]; then
    mkdir -p "${dest}"
    # Build TypeScript first so dist/ exists — single authoritative build step
    if command -v npm &>/dev/null && [[ -f "${SRC_ROOT}/package.json" ]]; then
      (cd "${SRC_ROOT}" && npm install --silent 2>/dev/null && npm run build) || \
        die "npm build failed in ${SRC_ROOT} — cannot install"
    fi
    cp -r "${SRC_ROOT}/dist/novel" "${dest}/"
    cp -r "${SRC_ROOT}/dist/shared" "${dest}/"
    cp "${SRC_ROOT}/package.json" "${dest}/package.json"
  fi
  log "  → Novel engine: ${dest}/dist/novel/engine.js"
  log "  → CLI: node ${dest}/dist/novel/cli.js"
}

# ─── Install install scripts ────────────────────────────────────────────────────
install_scripts() {
  log "Installing per-feature install scripts..."
  if [[ -z "${DRY_RUN}" ]]; then
    mkdir -p "${TARGET}/scripts"
    cp "${SRC_ROOT}/scripts/install-blog.sh" "${TARGET}/scripts/" 2>/dev/null || true
    cp "${SRC_ROOT}/scripts/install-novel.sh" "${TARGET}/scripts/" 2>/dev/null || true
    chmod +x "${TARGET}/scripts/install-blog.sh" "${TARGET}/scripts/install-novel.sh" 2>/dev/null || true
  fi
  log "  → scripts/install-blog.sh — install blog only"
  log "  → scripts/install-novel.sh — install novel only"
}

# ─── MCP config ────────────────────────────────────────────────────────────────
install_mcp_config() {
  if [[ -n "${NO_MCP}" ]]; then
    log "Skipping MCP config (--no-mcp)"
    return
  fi

  log "Adding MCP server config to ~/.claude.json..."
  local claude_json="${HOME}/.claude.json"
  # MCP path after build: dist/blog/server.js
  local mcp_path="${TARGET}/node_modules/ai-universe-living-blog/dist/blog/server.js"

  if [[ -z "${DRY_RUN}" ]]; then
    if [[ -f "${claude_json}" ]] && command -v jq &>/dev/null; then
      # Safe read-modify-write: merge blog-mcp into existing mcpServers, preserve all other keys
      local tmp
      tmp=$(mktemp)
      if jq --arg path "${mcp_path}" \
         '.mcpServers += {"blog-mcp": {"command":"node","args":[$path]}}' \
         "${claude_json}" > "${tmp}"; then
        mv "${tmp}" "${claude_json}"
        log "~/.claude.json updated with blog-mcp server (existing config preserved)"
        log "Restart Claude Code to load the MCP server"
      else
        warn "Failed to merge into ~/.claude.json — append manually:"
        warn "  {\"blog-mcp\": {\"command\":\"node\",\"args\":[\"${mcp_path}\"]}}"
        rm -f "${tmp}"
      fi
    elif [[ -f "${claude_json}" ]]; then
      warn "~/.claude.json exists but jq is not available — append manually:"
      warn "  {\"blog-mcp\": {\"command\":\"node\",\"args\":[\"${mcp_path}\"]}}"
    else
      cat > "${claude_json}" <<EOF
{
  "mcpServers": {
    "blog-mcp": {
      "command": "node",
      "args": ["${mcp_path}"]
    }
  }
}
EOF
      log "Created ~/.claude.json with blog-mcp server"
      log "Restart Claude Code to load the MCP server"
    fi
  fi
}

# ─── Install npm dependency ────────────────────────────────────────────────────
install_npm_dep() {
  log "Adding ai-universe-living-blog as npm dependency..."
  if [[ -z "${DRY_RUN}" && -f "${TARGET}/package.json" ]]; then
    if command -v npm &>/dev/null; then
      if ! (cd "${TARGET}" && npm install --save ai-universe-living-blog@latest 2>/dev/null); then
        warn "npm install failed — package not yet published to npm."
        warn "Install complete via dist/ copy. Publish to npm when ready."
      fi
    else
      warn "npm not found — add 'ai-universe-living-blog' to ${TARGET}/package.json manually"
    fi
  fi
}

# ─── Cleanup ────────────────────────────────────────────────────────────────────
cleanup() {
  if [[ -z "${DRY_RUN}" && -d "${TEMP_DIR}" ]]; then
    rm -rf "${TEMP_DIR}"
  fi
}
trap cleanup EXIT

# ─── Main ─────────────────────────────────────────────────────────────────────
if [[ -z "${NOVEL_ONLY}" ]]; then
  install_blog
fi

if [[ -z "${BLOG_ONLY}" ]]; then
  install_novel
fi

install_scripts
install_npm_dep

if [[ -z "${NOVEL_ONLY}${BLOG_ONLY}" ]]; then
  install_mcp_config
fi

log ""
log "Install complete!"
log ""
log "Next steps:"
log "  1. cd ${TARGET}"
log "  2. npm install && npm run build   # (if not already done by installer)"
log "  3. npm run dev:blog              # start blog MCP server"
log "  4. npm run dev:novel -- help     # novel CLI usage"
log ""
log "Documentation: https://github.com/jleechanorg/ai_universe_living_blog"
