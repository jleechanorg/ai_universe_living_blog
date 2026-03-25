#!/usr/bin/env bash
# Install blog MCP server only
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "${SCRIPT_DIR}/install.sh" --blog-only "$@"
