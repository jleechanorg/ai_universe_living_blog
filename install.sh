#!/usr/bin/env bash
#
# install.sh — Install ai-universe-living-blog into any repository
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/jleechanorg/ai_universe_living_blog/main/install.sh | bash
#   # or, from a cloned copy:
#   bash install.sh --target=/path/to/your/repo
#
# This installs:
#   - The blog MCP server (blog/ directory)
#   - The novel engine (novel/ directory)
#   - The install scripts (scripts/install-blog.sh, scripts/install-novel.sh)
#   - MCP server config stub for ~/.claude.json (optional)
#
# Options:
#   --target=DIR      Target repo to install into (default: current directory)
#   --blog-only       Install blog MCP server only
#   --novel-only      Install novel engine only
#   --no-mcp          Skip MCP server config
#   --dry-run         Show what would be installed without installing
#

set -euo pipefail

TARGET="${TARGET:-$(pwd)}"
BLOG_ONLY="${BLOG_ONLY:-}"
NOVEL_ONLY="${NOVEL_ONLY:-}"
NO_MCP="${NO_MCP:-}"
DRY_RUN="${DRY_RUN:-}"

for arg in "$@"; do
  case $arg in
    --target=*) TARGET="${arg#*=}"; shift ;;
    --blog-only) BLOG_ONLY=1; shift ;;
    --novel-only) NOVEL_ONLY=1; shift ;;
    --no-mcp) NO_MCP=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_ID="ai-universe-living-blog-$(date +%s)"
TEMP_DIR="/tmp/${INSTALL_ID}"

log() { echo "[install] $1"; }
warn() { echo "[install] WARNING: $1" >&2; }
die() { echo "[install] ERROR: $1" >&2; exit 1; }

# ─── Banner ───────────────────────────────────────────────────────────────────
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
  # Clone the living-blog repo into temp
  log "Cloning ai_universe_living_blog..."
  git clone --depth=1 https://github.com/jleechanorg/ai_universe_living_blog.git "${TEMP_DIR}/src" 2>/dev/null || \
    git clone --depth=1 git@github.com:jleechanorg/ai_universe_living_blog.git "${TEMP_DIR}/src"
fi

# ─── Install blog ─────────────────────────────────────────────────────────────
install_blog() {
  log "Installing blog MCP server..."
  local dest="${TARGET}/node_modules/ai-universe-living-blog"
  if [[ -z "${DRY_RUN}" ]]; then
    mkdir -p "${dest}"
    cp -r "${TEMP_DIR}/src/src/blog" "${dest}/"
    cp -r "${TEMP_DIR}/src/src/shared" "${dest}/"
    cp "${TEMP_DIR}/src/src/blog/server.ts" "${dest}/src/blog/server.ts"
    cp "${TEMP_DIR}/src/src/blog/storage.ts" "${dest}/src/blog/storage.ts"
    cp "${TEMP_DIR}/src/src/blog/tools.ts" "${dest}/src/blog/tools.ts"
    cp "${TEMP_DIR}/src/package.json" "${dest}/package.json"
  fi
  log "  → Blog server: ${dest}"
  log "  → Run: node \${dest}/src/blog/server.js"
  log "  → Or: npm run dev:blog (if using as workspace package)"
}

# ─── Install novel ─────────────────────────────────────────────────────────────
install_novel() {
  log "Installing novel engine..."
  local dest="${TARGET}/node_modules/ai-universe-living-blog"
  if [[ -z "${DRY_RUN}" ]]; then
    mkdir -p "${dest}"
    cp -r "${TEMP_DIR}/src/src/novel" "${dest}/"
    cp -r "${TEMP_DIR}/src/src/shared" "${dest}/"
    cp "${TEMP_DIR}/src/package.json" "${dest}/package.json"
  fi
  log "  → Novel engine: ${dest}/src/novel/engine.js"
  log "  → CLI: node \${dest}/src/novel/cli.js"
  log "  → Usage:"
  log "       node \${dest}/src/novel/cli.js branch-entry --repo=owner/repo --session=ID --branch=name"
  log "       node \${dest}/src/novel/cli.js daily-summary --repo=owner/repo --session=ID"
}

# ─── Install install scripts ───────────────────────────────────────────────────
install_scripts() {
  log "Installing per-feature install scripts..."
  if [[ -z "${DRY_RUN}" ]]; then
    mkdir -p "${TARGET}/scripts"
    cp "${TEMP_DIR}/src/scripts/install-blog.sh" "${TARGET}/scripts/" 2>/dev/null || true
    cp "${TEMP_DIR}/src/scripts/install-novel.sh" "${TARGET}/scripts/" 2>/dev/null || true
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
  local mcp_entry="{\"blog-mcp\":{\"command\":\"node\",\"args\":[\"${TARGET}/node_modules/ai-universe-living-blog/src/blog/server.js\"],\"env\":{\"PORT\":\"8081\"}}}"

  if [[ -z "${DRY_RUN}" ]]; then
    if [[ -f "${claude_json}" ]]; then
      # Append to existing mcpServers
      if grep -q '"mcpServers"' "${claude_json}"; then
        warn "mcpServers already exists in ~/.claude.json — append manually:"
        warn "  ${mcp_entry}"
      else
        warn "~/.claude.json exists — append MCP server config manually"
      fi
    else
      cat > "${claude_json}" <<EOF
{
  "mcpServers": {
    "blog-mcp": {
      "command": "node",
      "args": ["${TARGET}/node_modules/ai-universe-living-blog/src/blog/server.js"],
      "env": { "PORT": "8081" }
    }
  }
}
EOF
      log "Created ~/.claude.json with blog-mcp server"
      log "Restart Claude Code to load the MCP server"
    fi
  fi

  log "  → MCP server config stub written"
}

# ─── Install npm dependency ────────────────────────────────────────────────────
install_npm_dep() {
  log "Adding ai-universe-living-blog as npm dependency..."
  if [[ -z "${DRY_RUN}" ]]; then
    if command -v npm &>/dev/null; then
      (cd "${TARGET}" && npm install --save ai-universe-living-blog@latest 2>/dev/null) || \
        warn "npm install failed — install manually: npm install ai-universe-living-blog"
    else
      warn "npm not found — install manually: npm install ai-universe-living-blog"
    fi
  fi
}

# ─── Cleanup ───────────────────────────────────────────────────────────────────
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
log "  2. npm install"
log "  3. npm run dev:blog           # start blog MCP server"
log "  4. npm run dev:novel -- help  # novel CLI usage"
log ""
log "Documentation: https://github.com/jleechanorg/ai_universe_living_blog"
