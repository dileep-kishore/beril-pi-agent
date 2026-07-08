"""BERIL project lifecycle state machine (pure transitions; persistence in lifecycle_cmd)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

STATES = ("exploration", "proposed", "active", "analysis", "reviewed", "complete")
FORWARD = {
    "exploration": "proposed",
    "proposed": "active",
    "active": "analysis",
    "analysis": "reviewed",
    "reviewed": "complete",
}
DEMOTE = {"reviewed": "analysis", "complete": "analysis"}


class LifecycleError(ValueError):
    """Raised on an illegal lifecycle transition."""


def can_transition(frm: str, to: str) -> bool:
    return FORWARD.get(frm) == to or DEMOTE.get(frm) == to


def next_state(frm: str, to: str) -> str:
    if frm not in STATES:
        raise LifecycleError(f"unknown current state: {frm!r}")
    if to not in STATES:
        raise LifecycleError(f"unknown target state: {to!r}")
    if not can_transition(frm, to):
        raise LifecycleError(f"illegal transition {frm} → {to}")
    return to


def load_project(project_dir: Path) -> dict[str, Any]:
    path = Path(project_dir) / "beril.yaml"
    if not path.exists():
        raise LifecycleError(f"no beril.yaml in {project_dir}")
    return yaml.safe_load(path.read_text()) or {}


# Canonical key order keeps diffs stable across writes.
_KEY_ORDER = [
    "project_id",
    "status",
    "created_at",
    "last_session_at",
    "branch",
    "engine",
    "authors",
    "artifacts",
    "gates",
    "approval",
    "previous_approvals",
    "submissions",
]


def save_project(project_dir: Path, proj: dict[str, Any]) -> None:
    ordered = {k: proj[k] for k in _KEY_ORDER if k in proj}
    for k, v in proj.items():
        if k not in ordered:
            ordered[k] = v
    (Path(project_dir) / "beril.yaml").write_text(
        yaml.safe_dump(ordered, sort_keys=False, default_flow_style=False, allow_unicode=True)
    )


def set_status(project_dir: Path, to: str) -> str:
    proj = load_project(project_dir)
    proj["status"] = next_state(proj.get("status", ""), to)
    save_project(project_dir, proj)
    return proj["status"]
