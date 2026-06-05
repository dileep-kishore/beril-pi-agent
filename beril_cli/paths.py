"""Shared filesystem helpers for the BERIL CLI."""

from __future__ import annotations

from pathlib import Path


def find_repo_root(start: Path | None = None) -> Path | None:
    """Walk up from `start` (or cwd) looking for PROJECT.md (repo marker)."""
    current = start or Path.cwd()
    for parent in [current, *current.parents]:
        if (parent / "PROJECT.md").exists():
            return parent
    return None
