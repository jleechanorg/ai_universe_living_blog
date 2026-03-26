#!/usr/bin/env python3
"""agent_repo_check.py — structural validation for agent harness docs."""

from __future__ import annotations

import datetime as dt
import pathlib
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
DOC_ROOT = REPO_ROOT / "docs" / "agent"
AGENTS_PATH = REPO_ROOT / "AGENTS.md"

REQUIRED_LEAF_DOCS = [
    "index.md",
    "architecture.md",
    "quality.md",
    "reliability.md",
    "security.md",
    "plans.md",
]

REQUIRED_FRONTMATTER_KEYS = [
    "title",
    "purpose",
    "owner",
    "last_reviewed",
    "source_of_truth",
]


def parse_frontmatter(text: str) -> dict[str, str]:
    """Parse YAML frontmatter from markdown text. Returns {} if no frontmatter."""
    if not text.startswith("---"):
        return {}
    end = text.index("---", 3)
    fm_text = text[4:end]
    result = {}
    for line in fm_text.splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        result[key.strip()] = value.strip().strip('"').strip("'")
    return result


def check_agents_md() -> list[str]:
    errors = []
    if not AGENTS_PATH.exists():
        errors.append("AGENTS.md is missing")
        return errors

    text = AGENTS_PATH.read_text()
    if "docs/agent/index.md" not in text:
        errors.append("AGENTS.md does not reference docs/agent/index.md")
    if "agent_repo_check.py" not in text:
        errors.append("AGENTS.md does not reference agent_repo_check.py")
    return errors


def check_leaf_docs() -> list[str]:
    errors = []
    for doc in REQUIRED_LEAF_DOCS:
        path = DOC_ROOT / doc
        if not path.exists():
            errors.append(f"Missing required doc: docs/agent/{doc}")
            continue

        text = path.read_text()
        fm = parse_frontmatter(text)

        for key in REQUIRED_FRONTMATTER_KEYS:
            if key not in fm:
                errors.append(f"docs/agent/{doc}: missing frontmatter key '{key}'")

        if "last_reviewed" in fm:
            try:
                dt.date.fromisoformat(fm["last_reviewed"])
            except ValueError:
                errors.append(f"docs/agent/{doc}: last_reviewed is not a valid ISO date: {fm['last_reviewed']}")

    return errors


def check_index_references_all_leafs() -> list[str]:
    errors = []
    index_path = DOC_ROOT / "index.md"
    if not index_path.exists():
        errors.append("docs/agent/index.md is missing — cannot check leaf references")
        return errors

    text = index_path.read_text()
    for doc in REQUIRED_LEAF_DOCS:
        if doc not in text:
            errors.append(f"docs/agent/index.md does not reference docs/agent/{doc}")
    return errors


def main() -> int:
    all_errors: list[str] = []
    all_errors.extend(check_agents_md())
    all_errors.extend(check_leaf_docs())
    all_errors.extend(check_index_references_all_leafs())

    if all_errors:
        print("VALIDATION FAILED:", file=sys.stderr)
        for err in all_errors:
            print(f"  - {err}", file=sys.stderr)
        return 1

    print("PASS — all agent harness checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
