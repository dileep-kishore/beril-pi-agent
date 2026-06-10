"""Tests for `beril env` subcommand."""

from __future__ import annotations

import argparse
import json

from beril_cli import env_cmd
from scripts import detect_berdl_environment as detect_env


def test_env_emits_json(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(env_cmd, "find_repo_root", lambda: tmp_path)
    fake = {"location": "off-cluster", "ready": True, "checks": {}, "next_steps": []}

    def fake_run(argv, **kw):
        class R:
            returncode = 0
            stdout = json.dumps(fake)
            stderr = ""

        return R()

    monkeypatch.setattr(env_cmd.subprocess, "run", fake_run)
    rc = env_cmd.run_env(argparse.Namespace(json=True))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["ready"] is True and out["location"] == "off-cluster"


def test_env_exits_zero_when_not_ready(monkeypatch, capsys, tmp_path):
    (tmp_path / "PROJECT.md").write_text("x")
    monkeypatch.setattr(env_cmd, "find_repo_root", lambda: tmp_path)
    fake = {"location": "off-cluster", "ready": False, "checks": {}, "next_steps": ["start pproxy"]}

    def fake_run(argv, **kw):
        class R:
            returncode = 0
            stdout = json.dumps(fake)
            stderr = ""

        return R()

    monkeypatch.setattr(env_cmd.subprocess, "run", fake_run)
    rc = env_cmd.run_env(argparse.Namespace(json=True))
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["ready"] is False


def test_off_cluster_uses_uv_check_not_venv(monkeypatch):
    """Off-cluster readiness gates on uv availability, not a .venv-berdl dir."""
    monkeypatch.setattr(detect_env, "is_on_cluster", lambda: False)
    monkeypatch.setattr(detect_env, "test_connectivity", lambda *a, **k: False)
    monkeypatch.setattr(detect_env, "load_env_file", lambda p: {"KBASE_AUTH_TOKEN": "tok"})
    monkeypatch.setattr(detect_env, "check_port_listening", lambda port: True)
    monkeypatch.setattr(detect_env.shutil, "which", lambda name: "/usr/bin/uv")

    result = detect_env.detect_environment()

    assert result["location"] == "off-cluster"
    assert "venv_berdl" not in result["checks"]
    assert result["checks"]["uv_available"] is True
    assert result["ready"] is True


def test_off_cluster_not_ready_without_uv(monkeypatch):
    """Missing uv keeps the off-cluster env not-ready and surfaces a next step."""
    monkeypatch.setattr(detect_env, "is_on_cluster", lambda: False)
    monkeypatch.setattr(detect_env, "test_connectivity", lambda *a, **k: False)
    monkeypatch.setattr(detect_env, "load_env_file", lambda p: {"KBASE_AUTH_TOKEN": "tok"})
    monkeypatch.setattr(detect_env, "check_port_listening", lambda port: True)
    monkeypatch.setattr(detect_env.shutil, "which", lambda name: None)

    result = detect_env.detect_environment()

    assert result["checks"]["uv_available"] is False
    assert result["ready"] is False
    assert any("uv not found" in step for step in result["next_steps"])


def test_is_on_cluster_via_env_vars(monkeypatch):
    """Env-var detection works even when berdl_notebook_utils is not importable.

    Reproduces ``uv run beril`` inside a BERDL pod: the project venv has no
    berdl_notebook_utils, but JupyterHub's env vars do propagate to it.
    """
    monkeypatch.setenv("JUPYTERHUB_API_TOKEN", "fake")
    monkeypatch.setenv(
        "SPARK_MASTER_URL", "spark://spark-master-dkishore.jupyterhub-prod:7077"
    )
    # Force the import-based fallback to fail to prove env detection is sufficient.
    import sys as _sys
    monkeypatch.setitem(_sys.modules, "berdl_notebook_utils", None)
    assert detect_env.is_on_cluster() is True


def test_is_on_cluster_false_without_env_or_import(monkeypatch):
    """Off-cluster: no JupyterHub vars, no helper → False."""
    monkeypatch.delenv("JUPYTERHUB_API_TOKEN", raising=False)
    monkeypatch.delenv("SPARK_MASTER_URL", raising=False)
    import sys as _sys
    monkeypatch.setitem(_sys.modules, "berdl_notebook_utils", None)
    assert detect_env.is_on_cluster() is False


def test_find_on_cluster_python_prefers_opt_conda(monkeypatch):
    """Prefers /opt/conda/bin/python3 over sys.executable on the BERDL image."""
    monkeypatch.setattr(
        detect_env.Path,
        "is_file",
        lambda self: str(self) == "/opt/conda/bin/python3",
    )
    assert detect_env.find_on_cluster_python() == "/opt/conda/bin/python3"


def test_find_on_cluster_python_falls_back(monkeypatch):
    """When no /opt/conda Python exists, fall back to sys.executable."""
    monkeypatch.setattr(detect_env.Path, "is_file", lambda self: False)
    import sys as _sys
    assert detect_env.find_on_cluster_python() == _sys.executable
