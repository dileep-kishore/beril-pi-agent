"""beril crate — write an RO-Crate 1.1 metadata file for a project.

Emits ``<project>/ro-crate-metadata.json`` (JSON-LD): a root Dataset, Person
authors (ORCID @ids), one File per report/notebook/figure/claims/provenance
artifact (with sha256 + contentSize), and one CreateAction per notebook so runs
validate against the Workflow Run Crate vocabulary. The crate is a derived
artifact — regenerated whole, never merged.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from beril_cli.lifecycle import load_project, LifecycleError
from beril_cli.paths import find_repo_root

_CONTEXT = "https://w3id.org/ro/crate/1.1/context"
_CONFORMS = "https://w3id.org/ro/crate/1.1"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _file_entity(project_dir: Path, path: Path) -> dict:
    rel = path.relative_to(project_dir).as_posix()
    return {
        "@id": rel,
        "@type": "File",
        "name": path.name,
        "sha256": _sha256(path),
        "contentSize": str(path.stat().st_size),
    }


def _person_entities(authors: list[dict]) -> list[dict]:
    people: list[dict] = []
    for i, author in enumerate(authors):
        orcid = (author.get("orcid", "") or "").strip()
        entity: dict = {
            "@id": f"https://orcid.org/{orcid}" if orcid else f"#author-{i + 1}",
            "@type": "Person",
            "name": author.get("name", "") or f"Author {i + 1}",
        }
        if author.get("affiliation"):
            entity["affiliation"] = author["affiliation"]
        people.append(entity)
    return people


def build_crate(project_dir: Path) -> dict:
    """Build the RO-Crate JSON-LD graph for a project directory."""
    try:
        proj = load_project(project_dir)
    except LifecycleError:
        proj = {}
    project_id = str(proj.get("project_id", project_dir.name))
    authors = proj.get("authors") if isinstance(proj.get("authors"), list) else []
    people = _person_entities(authors)

    dataset: dict = {
        "@id": "./",
        "@type": "Dataset",
        "name": project_id,
        "datePublished": _now(),
    }
    if proj.get("description"):
        dataset["description"] = proj["description"]
    if people:
        dataset["author"] = [{"@id": p["@id"]} for p in people]

    files: list[dict] = []
    notebooks: list[dict] = []
    figures: list[dict] = []
    for rel in ("REPORT.md", "claims.json", "provenance.json"):
        path = project_dir / rel
        if path.is_file():
            files.append(_file_entity(project_dir, path))
    notebooks_dir = project_dir / "notebooks"
    if notebooks_dir.is_dir():
        for path in sorted(notebooks_dir.glob("*.ipynb")):
            entity = _file_entity(project_dir, path)
            files.append(entity)
            notebooks.append(entity)
    figures_dir = project_dir / "figures"
    if figures_dir.is_dir():
        for path in sorted(p for p in figures_dir.iterdir() if p.is_file()):
            entity = _file_entity(project_dir, path)
            files.append(entity)
            figures.append(entity)

    dataset["hasPart"] = [{"@id": f["@id"]} for f in files]

    actions: list[dict] = []
    agent = {"@id": people[0]["@id"]} if people else None
    for nb in notebooks:
        action: dict = {
            "@id": f"#run-{Path(nb['@id']).stem}",
            "@type": "CreateAction",
            "name": f"Run {nb['name']}",
            "instrument": {"@id": nb["@id"]},
        }
        if agent:
            action["agent"] = agent
        if figures:
            action["result"] = [{"@id": f["@id"]} for f in figures]
        actions.append(action)

    graph = [
        {
            "@id": "ro-crate-metadata.json",
            "@type": "CreativeWork",
            "conformsTo": {"@id": _CONFORMS},
            "about": {"@id": "./"},
        },
        dataset,
        *people,
        *files,
        *actions,
    ]
    return {"@context": _CONTEXT, "@graph": graph}


def run_crate(args: argparse.Namespace) -> int:
    root = find_repo_root()
    if root is None:
        print("BERIL repo not found (no PROJECT.md on path).", file=sys.stderr)
        return 2
    project_dir = root / "projects" / args.project
    if not project_dir.is_dir():
        print(f"project not found: {project_dir}", file=sys.stderr)
        return 2
    crate = build_crate(project_dir)
    out = project_dir / "ro-crate-metadata.json"
    out.write_text(json.dumps(crate, indent=2) + "\n")
    json.dump({"crate": str(out), "entities": len(crate["@graph"])}, sys.stdout, default=str)
    sys.stdout.write("\n")
    return 0
