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
#   --source=DIR      Use local source dir instead of cloning from GitHub (for testing)
#   --blog-only      Install blog MCP server only
#   --novel-only     Install novel engine only
#   --no-mcp         Skip MCP server config
#   --dry-run        Show what would be installed
#

set -euo pipefail

TARGET=""
SOURCE_DIR=""
BLOG_ONLY=""
NOVEL_ONLY=""
NO_MCP=""
DRY_RUN=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --target=*) TARGET="${1#*=}"; shift ;;
    --source=*) SOURCE_DIR="${1#*=}"; shift ;;
    --blog-only) BLOG_ONLY=1; shift ;;
    --novel-only) NOVEL_ONLY=1; shift ;;
    --no-mcp) NO_MCP=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "[install] ERROR: Unknown option: $1 — exiting" >&2; exit 1 ;;
  esac
done

TARGET="${TARGET:-$(pwd)}"
INSTALL_ID="ai-universe-living-blog-$$"
TEMP_DIR="/tmp/${INSTALL_ID}"
INSTALLED_BLOG=""
INSTALLED_NOVEL=""

log() { echo "[install] $1"; }
warn() { echo "[install] WARNING: $1" >&2; }
die() { echo "[install] ERROR: $1" >&2; exit 1; }

# ─── Cleanup ────────────────────────────────────────────────────────────────────
# Registered early so TEMP_DIR is always cleaned up even on early failures.
cleanup() {
  if [[ -z "${DRY_RUN}" && -d "${TEMP_DIR}" ]]; then
    rm -rf "${TEMP_DIR}"
  fi
}
trap cleanup EXIT

# ─── Validate mutually-exclusive flags ─────────────────────────────────────────
if [[ -n "${BLOG_ONLY}" && -n "${NOVEL_ONLY}" ]]; then
  die "--blog-only and --novel-only cannot be used together"
fi

# ─── Banner ──────────────────────────────────────────────────────────────────────
log "ai-universe-living-blog installer"
log "Target: ${TARGET}"
[[ -n "${DRY_RUN}" ]] && log "DRY RUN — no changes will be made"

# ─── Pre-flight ────────────────────────────────────────────────────────────────
if [[ ! -d "${TARGET}/.git" && ! -f "${TARGET}/.git" ]]; then
  die "Target directory is not a git repository: ${TARGET}"
fi

CREATED_PLACEHOLDER=""
if [[ ! -f "${TARGET}/package.json" ]]; then
  warn "No package.json found — creating one"
  [[ -z "${DRY_RUN}" ]] && echo '{"name":"installed-blog","private":true}' > "${TARGET}/package.json"
  CREATED_PLACEHOLDER=1
fi

# ─── Bootstrap temp dir ────────────────────────────────────────────────────────
if [[ -z "${DRY_RUN}" ]]; then
  mkdir -p "${TEMP_DIR}"
  if [[ -n "${SOURCE_DIR}" ]]; then
    # Use local source (for smoke tests that run against a local build)
    log "Using local source: ${SOURCE_DIR}"
    cp -r "${SOURCE_DIR}/." "${TEMP_DIR}/src/"
  else
    log "Cloning ai_universe_living_blog..."
    if git clone --depth=1 https://github.com/jleechanorg/ai_universe_living_blog.git "${TEMP_DIR}/src" 2>&1; then
      : # success
    else
      git clone --depth=1 git@github.com:jleechanorg/ai_universe_living_blog.git "${TEMP_DIR}/src" || die "Clone failed"
    fi
  fi
fi

# Source root inside the cloned/local repo (repo root is at ${TEMP_DIR}/src/)
SRC_ROOT="${TEMP_DIR}/src"

# ─── Install blog ─────────────────────────────────────────────────────────────
install_blog() {
  log "Installing blog MCP server..."
  INSTALLED_BLOG=1
  local dest="${TARGET}/node_modules/ai-universe-living-blog"
  if [[ -z "${DRY_RUN}" ]]; then
    mkdir -p "${dest}"
    # Fail fast when --source is used but the source isn't pre-built.
    if [[ -n "${SOURCE_DIR}" ]]; then
      [[ -d "${SRC_ROOT}/dist/shared" ]] || die "--source requires a built checkout (missing ${SRC_ROOT}/dist/shared); run: cd ${SOURCE_DIR} && npm install && npm run build"
      [[ -n "${NOVEL_ONLY}" || -d "${SRC_ROOT}/dist/blog" ]] || die "--source requires ${SRC_ROOT}/dist/blog (or run: cd ${SOURCE_DIR} && npm install && npm run build)"
    fi
    # Build TypeScript so dist/ exists — single authoritative build step.
    # Skip if --source was used (local source already has node_modules + dist/).
    if [[ -z "${SOURCE_DIR}" ]] && command -v npm &>/dev/null && [[ -f "${SRC_ROOT}/package.json" ]]; then
      (cd "${SRC_ROOT}" && npm install --silent 2>/dev/null && npm run build) || \
        die "npm build failed in ${SRC_ROOT} — cannot install blog"
    fi
    mkdir -p "${dest}/dist/blog"
    cp -r "${SRC_ROOT}/dist/blog/"* "${dest}/dist/blog/"
    cp -r "${SRC_ROOT}/dist/shared" "${dest}/dist/"
    # Copy npm dependencies so the server can resolve express, cors, etc.
    # at the TARGET level (not inside the package subdirectory).
    cp -r "${SRC_ROOT}/node_modules/"* "${TARGET}/node_modules/" 2>/dev/null || true
  fi
  log "  → Blog server: ${dest}/dist/blog"
  log "  → MCP path: ${dest}/dist/blog/server.js"
}

# ─── Install novel ─────────────────────────────────────────────────────────────
install_novel() {
  log "Installing novel engine..."
  INSTALLED_NOVEL=1
  local dest="${TARGET}/node_modules/ai-universe-living-blog"
  if [[ -z "${DRY_RUN}" ]]; then
    mkdir -p "${dest}"
    # Build TypeScript first so dist/ exists — single authoritative build step.
    # Skip if --source was used (local source already has node_modules + dist/).
    if [[ -z "${SOURCE_DIR}" ]] && command -v npm &>/dev/null && [[ -f "${SRC_ROOT}/package.json" ]]; then
      (cd "${SRC_ROOT}" && npm install --silent 2>/dev/null && npm run build) || \
        die "npm build failed in ${SRC_ROOT} — cannot install"
    fi
    # Fail fast when --source is used but the source isn't pre-built.
    if [[ -n "${SOURCE_DIR}" ]]; then
      [[ -d "${SRC_ROOT}/dist/shared" ]] || die "--source requires a built checkout (missing ${SRC_ROOT}/dist/shared); run: cd ${SOURCE_DIR} && npm install && npm run build"
      [[ -n "${BLOG_ONLY}" || -d "${SRC_ROOT}/dist/novel" ]] || die "--source requires ${SRC_ROOT}/dist/novel (or run: cd ${SOURCE_DIR} && npm install && npm run build)"
    fi
    cp -r "${SRC_ROOT}/dist/novel" "${dest}/dist/"
    cp -r "${SRC_ROOT}/dist/shared" "${dest}/dist/"
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
  # MCP path: built JavaScript in the installed npm package
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
      if [[ -n "${CREATED_PLACEHOLDER}" ]]; then
        warn "No package.json existed — skipping npm install (add dependencies to ${TARGET}/package.json)"
        warn "Run manually: npm install"
      elif [[ -n "${SOURCE_DIR}" ]]; then
        # Use local source — add as file: dependency so the local build is used.
        # This bypasses the registry install that would overwrite the local copy.
        if command -v jq &>/dev/null; then
          local tmp
          tmp=$(mktemp)
          if jq --arg dep "file:./node_modules/ai-universe-living-blog" \
             '.dependencies["ai-universe-living-blog"] = $dep' \
             "${TARGET}/package.json" > "${tmp}"; then
            mv "${tmp}" "${TARGET}/package.json"
            log "Added ai-universe-living-blog as file: dependency (local source)"
          else
            rm -f "${tmp}"
            warn "Could not update package.json — add manually: \"ai-universe-living-blog\": \"file:./node_modules/ai-universe-living-blog\""
          fi
        else
          warn "jq not available — add manually to ${TARGET}/package.json:"
          warn "  \"dependencies\": { \"ai-universe-living-blog\": \"file:./node_modules/ai-universe-living-blog\" }"
        fi
      elif ! (cd "${TARGET}" && npm install --save ai-universe-living-blog@latest 2>/dev/null); then
        # Fallback: add as a file: dependency pointing to the copied node_modules path
        warn "npm install failed — adding as file: dependency..."
        if command -v jq &>/dev/null; then
          local tmp
          tmp=$(mktemp)
          if jq --arg dep "file:./node_modules/ai-universe-living-blog" \
             '.dependencies["ai-universe-living-blog"] = $dep' \
             "${TARGET}/package.json" > "${tmp}"; then
            mv "${tmp}" "${TARGET}/package.json"
            log "Added ai-universe-living-blog as file: dependency"
          else
            rm -f "${tmp}"
            warn "Could not update package.json — add manually: \"ai-universe-living-blog\": \"file:./node_modules/ai-universe-living-blog\""
          fi
        else
          warn "jq not available — add manually to ${TARGET}/package.json:"
          warn "  \"dependencies\": { \"ai-universe-living-blog\": \"file:./node_modules/ai-universe-living-blog\" }"
        fi
      fi
    else
      warn "npm not found — add 'ai-universe-living-blog' to ${TARGET}/package.json manually"
    fi
  fi
}

# ─── Main ─────────────────────────────────────────────────────────────────────
if [[ -z "${NOVEL_ONLY}" ]]; then
  install_blog
fi

if [[ -z "${BLOG_ONLY}" ]]; then
  install_novel
fi

install_scripts
install_npm_dep

# install_mcp_config only when blog is installed (not --novel-only) and --no-mcp not passed
if [[ -z "${NOVEL_ONLY}" && -z "${NO_MCP}" ]]; then
  install_mcp_config
fi

log ""
log "Install complete!"
log ""
log "Next steps:"
log "  1. cd ${TARGET}"
log "  2. npm install && npm run build   # (if not already done by installer)"
if [[ -n "${INSTALLED_BLOG}" ]]; then
  log "  • npm run dev:blog              # start blog MCP server"
fi
if [[ -n "${INSTALLED_NOVEL}" ]]; then
  log "  • npm run dev:novel -- help     # novel CLI usage"
fi
log ""
log "Documentation: https://github.com/jleechanorg/ai_universe_living_blog"
