"""Tests for `beril discover` subcommand."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from beril_cli import discover_cmd


def test_discover_emits_snapshot(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(discover_cmd, "find_repo_root", lambda: tmp_path)
    snap = {"databases": [{"name": "db1"}]}

    def fake_run(argv, **kw):
        out = argv[argv.index("--output") + 1]
        Path(out).write_text(json.dumps(snap))

        class R:
            returncode = 0
            stdout = "Discovered 1 database"
            stderr = ""

        return R()

    monkeypatch.setattr(discover_cmd.subprocess, "run", fake_run)
    rc = discover_cmd.run_discover(argparse.Namespace(max_databases=None))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["databases"][0]["name"] == "db1"


def test_discover_passes_max_databases(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(discover_cmd, "find_repo_root", lambda: tmp_path)
    seen = {}

    def fake_run(argv, **kw):
        seen["argv"] = list(argv)
        out = argv[argv.index("--output") + 1]
        Path(out).write_text(json.dumps({"databases": []}))

        class R:
            returncode = 0
            stdout = ""
            stderr = ""

        return R()

    monkeypatch.setattr(discover_cmd.subprocess, "run", fake_run)
    discover_cmd.run_discover(argparse.Namespace(max_databases=3))
    argv = seen["argv"]
    assert "--max-databases" in argv
    assert argv[argv.index("--max-databases") + 1] == "3"
    assert "--berdl-proxy" not in argv  # discover has no proxy flag


def test_discover_omits_max_databases_when_none(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(discover_cmd, "find_repo_root", lambda: tmp_path)
    seen = {}

    def fake_run(argv, **kw):
        seen["argv"] = list(argv)
        out = argv[argv.index("--output") + 1]
        Path(out).write_text(json.dumps({"databases": []}))

        class R:
            returncode = 0
            stdout = ""
            stderr = ""

        return R()

    monkeypatch.setattr(discover_cmd.subprocess, "run", fake_run)
    discover_cmd.run_discover(argparse.Namespace(max_databases=None))
    assert "--max-databases" not in seen["argv"]


def test_discover_maps_child_exit_code(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(discover_cmd, "find_repo_root", lambda: tmp_path)

    def fake_run(argv, **kw):
        class R:
            returncode = 2
            stdout = ""
            stderr = "discovery failed"

        return R()

    monkeypatch.setattr(discover_cmd.subprocess, "run", fake_run)
    rc = discover_cmd.run_discover(argparse.Namespace(max_databases=None))
    assert rc == 2
    assert "discovery failed" in capsys.readouterr().err


def test_discover_no_repo_returns_2(monkeypatch, capsys):
    monkeypatch.setattr(discover_cmd, "find_repo_root", lambda: None)
    rc = discover_cmd.run_discover(argparse.Namespace(max_databases=None))
    assert rc == 2
    assert "BERIL repo not found" in capsys.readouterr().err


# --- discovery curation: pmi_data regression + denylist behavior --------------


def test_curated_visibility_surfaces_newly_onboarded_tenant_dbs():
    """Real tenant databases (incl. ones not in the old allowlist) pass through.

    The old allowlist hid plantmicrobeinterfaces_pmi_data, refdata_*, and dot-
    namespaced variants because they hadn't been hand-added. The denylist must
    surface them all.
    """
    from scripts.discover_berdl_collections import _is_curated_visible

    for db in (
        "plantmicrobeinterfaces_pmi_data",
        "plantmicrobeinterfaces.pmi_data",
        "plantmicrobeinterfaces_kepangenome_mapping",
        "refdata_uniprot",
        "refdata.bvbrc",
        "kbase.ke_pangenome",
        "kbase_ke_pangenome",
        "protect_integration",
    ):
        assert _is_curated_visible(db), f"{db} should be visible"


def test_curated_visibility_hides_scratch_and_test_namespaces():
    """globalusers, personal, default, and *_test_* / *_demo_* are still hidden."""
    from scripts.discover_berdl_collections import _is_curated_visible

    for db in (
        "globalusers_demo_test",
        "globalusers.kepangenome_parquet_1",
        "globalusers_carbon_source_phenotypes",
        "u_abc123__scratch",
        "default",
        "kescience.test_db",
        "kescience.test_mika",
        "globalusers.aisynbio_test_1",
        "anything_demo_1",
        "anything_startup",
    ):
        assert not _is_curated_visible(db), f"{db} should be hidden"


def test_infer_tenant_id_handles_both_namespace_forms():
    """Dotted ids split on '.', underscored split on '_', personal namespaces stay whole."""
    from scripts.discover_berdl_collections import infer_tenant_id

    assert infer_tenant_id("kbase.ke_pangenome") == "kbase"
    assert infer_tenant_id("plantmicrobeinterfaces.pmi_data") == "plantmicrobeinterfaces"
    assert infer_tenant_id("kbase_ke_pangenome") == "kbase"
    assert infer_tenant_id("plantmicrobeinterfaces_pmi_data") == "plantmicrobeinterfaces"
    assert infer_tenant_id("kescience_fitnessbrowser") == "kescience"
    assert infer_tenant_id("phagefoundry_strain_modelling") == "phagefoundry"
    assert infer_tenant_id("u_abc123__scratch") == "u_abc123"


def test_dedupe_namespace_aliases_drops_underscored_duplicate():
    """When dotted + underscored ids point at the same Delta tables, keep dotted only."""
    from scripts.discover_berdl_collections import _dedupe_namespace_aliases

    databases = [
        {"id": "kbase.ke_pangenome"},
        {"id": "kbase_ke_pangenome"},
        {"id": "plantmicrobeinterfaces.pmi_data"},
        {"id": "plantmicrobeinterfaces_pmi_data"},
        {"id": "refdata.uniprot"},
        {"id": "refdata_uniprot"},  # empty legacy alias
        {"id": "enigma_coral"},  # underscored-only, no dotted equivalent
        {"id": "kbase.uniref100"},  # dotted-only
    ]
    kept_ids = {d["id"] for d in _dedupe_namespace_aliases(databases)}
    assert kept_ids == {
        "kbase.ke_pangenome",
        "plantmicrobeinterfaces.pmi_data",
        "refdata.uniprot",
        "enigma_coral",
        "kbase.uniref100",
    }


def test_filter_user_facing_snapshot_uses_denylist():
    """filter_user_facing_snapshot drops only denied collections, keeps the rest."""
    from scripts.discover_berdl_collections import filter_user_facing_snapshot

    snap = {
        "tenants": [
            {
                "id": "plantmicrobeinterfaces",
                "name": "Plant–Microbe Interfaces",
                "collections": [
                    {"id": "plantmicrobeinterfaces_pmi_data", "name": "PMI Data"},
                    {"id": "plantmicrobeinterfaces_gtdb_mapping", "name": "GTDB Mapping"},
                ],
            },
            {
                "id": "globalusers",
                "name": "Development/Test",
                "collections": [{"id": "globalusers_demo_test", "name": "Demo Test"}],
            },
        ]
    }
    filtered = filter_user_facing_snapshot(snap)
    tenant_ids = {t["id"]: [c["id"] for c in t["collections"]] for t in filtered["tenants"]}
    assert "plantmicrobeinterfaces" in tenant_ids
    assert tenant_ids["plantmicrobeinterfaces"] == [
        "plantmicrobeinterfaces_pmi_data",
        "plantmicrobeinterfaces_gtdb_mapping",
    ]
    # Whole globalusers tenant drops out because none of its collections survive.
    assert "globalusers" not in tenant_ids
    assert filtered["visibility_filter"] == "user_facing_v2"
