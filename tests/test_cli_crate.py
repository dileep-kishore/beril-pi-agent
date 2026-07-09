"""Tests for `beril crate` — RO-Crate 1.1 JSON-LD emission."""

from __future__ import annotations

import argparse
import hashlib
import json

from beril_cli import crate_cmd


def _project(tmp_path):
    repo = tmp_path / "repo"
    pdir = repo / "projects" / "demo"
    (pdir / "notebooks").mkdir(parents=True)
    (pdir / "figures").mkdir(parents=True)
    (repo / "PROJECT.md").write_text("x")
    (pdir / "beril.yaml").write_text(
        "project_id: demo\nstatus: reviewed\ndescription: A study\n"
        "authors:\n  - name: Dee Kay\n    affiliation: LBL\n    orcid: 0000-0001-2345-6789\n"
    )
    (pdir / "REPORT.md").write_text("# Report\n")
    (pdir / "claims.json").write_text("{}")
    (pdir / "notebooks" / "01.ipynb").write_text('{"cells": []}')
    (pdir / "figures" / "f1.png").write_text("PNG")
    return repo, pdir


def _by_id(graph, entity_id):
    return next(e for e in graph if e["@id"] == entity_id)


def test_crate_writes_file_and_reports_entities(monkeypatch, capsys, tmp_path):
    repo, pdir = _project(tmp_path)
    monkeypatch.setattr(crate_cmd, "find_repo_root", lambda: repo)
    rc = crate_cmd.run_crate(argparse.Namespace(project="demo"))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0
    crate_path = pdir / "ro-crate-metadata.json"
    assert crate_path.exists()
    assert out["crate"] == str(crate_path)
    crate = json.loads(crate_path.read_text())
    assert crate["@context"].endswith("/ro/crate/1.1/context")
    assert out["entities"] == len(crate["@graph"])


def test_crate_dataset_and_person(monkeypatch, capsys, tmp_path):
    repo, pdir = _project(tmp_path)
    monkeypatch.setattr(crate_cmd, "find_repo_root", lambda: repo)
    crate_cmd.run_crate(argparse.Namespace(project="demo"))
    graph = json.loads((pdir / "ro-crate-metadata.json").read_text())["@graph"]
    dataset = _by_id(graph, "./")
    assert dataset["@type"] == "Dataset" and dataset["name"] == "demo"
    assert dataset["description"] == "A study"
    assert dataset["author"] == [{"@id": "https://orcid.org/0000-0001-2345-6789"}]
    person = _by_id(graph, "https://orcid.org/0000-0001-2345-6789")
    assert person["@type"] == "Person" and person["name"] == "Dee Kay"


def test_crate_file_entities_have_sha256(monkeypatch, capsys, tmp_path):
    repo, pdir = _project(tmp_path)
    monkeypatch.setattr(crate_cmd, "find_repo_root", lambda: repo)
    crate_cmd.run_crate(argparse.Namespace(project="demo"))
    graph = json.loads((pdir / "ro-crate-metadata.json").read_text())["@graph"]
    nb = _by_id(graph, "notebooks/01.ipynb")
    assert nb["@type"] == "File"
    assert nb["sha256"] == hashlib.sha256((pdir / "notebooks" / "01.ipynb").read_bytes()).hexdigest()
    assert "contentSize" in nb


def test_crate_create_action_per_notebook(monkeypatch, capsys, tmp_path):
    repo, pdir = _project(tmp_path)
    monkeypatch.setattr(crate_cmd, "find_repo_root", lambda: repo)
    crate_cmd.run_crate(argparse.Namespace(project="demo"))
    graph = json.loads((pdir / "ro-crate-metadata.json").read_text())["@graph"]
    actions = [e for e in graph if e.get("@type") == "CreateAction"]
    assert len(actions) == 1
    action = actions[0]
    assert action["instrument"] == {"@id": "notebooks/01.ipynb"}
    assert action["agent"] == {"@id": "https://orcid.org/0000-0001-2345-6789"}
    assert action["result"] == [{"@id": "figures/f1.png"}]


def test_crate_missing_project_returns_2(monkeypatch, capsys, tmp_path):
    repo = tmp_path / "repo"
    (repo / "projects").mkdir(parents=True)
    (repo / "PROJECT.md").write_text("x")
    monkeypatch.setattr(crate_cmd, "find_repo_root", lambda: repo)
    rc = crate_cmd.run_crate(argparse.Namespace(project="nope"))
    assert rc == 2
