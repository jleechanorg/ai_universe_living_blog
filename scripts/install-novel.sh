#!/usr/bin/env bash
# Install novel engine only
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "${SCRIPT_DIR}/install.sh" --novel-only "$@"
