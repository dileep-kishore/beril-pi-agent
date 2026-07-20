"""Tests for the BERIL-managed CBORG provider profile in Pi's models.json."""

from __future__ import annotations

import json
from pathlib import Path

import beril_cli.model_provider as mp

_EXPECTED_MODEL_IDS = [
    "lbl/cborg-coder",
    "lbl/cborg-coder-fast",
    "lbl/cborg-deepthought",
    "lbl/cborg-mini",
    "lbl/cborg-chat",
    "lbl/cborg-vision",
]


def _provision(monkeypatch, tmp_path) -> Path:
    """Provision CBORG into an isolated models.json and return its path."""
    monkeypatch.setenv("PI_CODING_AGENT_DIR", str(tmp_path))
    monkeypatch.delenv("BERIL_CBORG_API_BASE", raising=False)
    mp.ensure_model_provider("cborg")
    return tmp_path / "models.json"


def test_missing_models_json_creates_valid_file(monkeypatch, tmp_path):
    path = _provision(monkeypatch, tmp_path)
    data = json.loads(path.read_text())
    cborg = data["providers"]["cborg"]
    # Incomplete entries make Pi drop every custom provider in the file.
    assert cborg["baseUrl"] == "https://api.cborg.lbl.gov/v1"
    assert cborg["api"] == "openai-completions"
    assert cborg["apiKey"] == "$CBORG_API_KEY"
    assert [m["id"] for m in cborg["models"]] == _EXPECTED_MODEL_IDS
    for model in cborg["models"]:
        assert model["reasoning"] is False
        assert model["input"] == ["text"]
        assert model["contextWindow"] == 114688
        assert model["maxTokens"] == 16384
        assert model["cost"] == {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}


def test_existing_unrelated_providers_preserved(monkeypatch, tmp_path):
    path = tmp_path / "models.json"
    other = {"baseUrl": "https://example.com/v1", "api": "openai-completions", "apiKey": "k"}
    path.write_text(json.dumps({"providers": {"other": other}}))
    _provision(monkeypatch, tmp_path)
    data = json.loads(path.read_text())
    assert data["providers"]["other"] == other
    assert "cborg" in data["providers"]


def test_existing_cborg_entry_is_replaced(monkeypatch, tmp_path):
    path = tmp_path / "models.json"
    path.write_text(json.dumps({"providers": {"cborg": {"baseUrl": "https://stale.example"}}}))
    _provision(monkeypatch, tmp_path)
    cborg = json.loads(path.read_text())["providers"]["cborg"]
    assert cborg["baseUrl"] == "https://api.cborg.lbl.gov/v1"
    assert cborg["models"]


def test_api_base_env_overrides_base_url(monkeypatch, tmp_path):
    monkeypatch.setenv("PI_CODING_AGENT_DIR", str(tmp_path))
    monkeypatch.setenv("BERIL_CBORG_API_BASE", "https://api-local.cborg.lbl.gov/v1")
    mp.ensure_model_provider("cborg")
    cborg = json.loads((tmp_path / "models.json").read_text())["providers"]["cborg"]
    assert cborg["baseUrl"] == "https://api-local.cborg.lbl.gov/v1"


def test_written_provider_sends_both_auth_headers(monkeypatch, tmp_path):
    path = _provision(monkeypatch, tmp_path)
    cborg = json.loads(path.read_text())["providers"]["cborg"]
    assert cborg["apiKey"] == "$CBORG_API_KEY"
    assert cborg["headers"]["x-litellm-api-key"] == "$CBORG_API_KEY"


def test_malformed_models_json_left_untouched(monkeypatch, tmp_path, capsys):
    # Valid JSONC for Pi, unparseable for stdlib json — must warn, never clobber.
    jsonc = '{\n  // user comment\n  "providers": {}\n}\n'
    path = tmp_path / "models.json"
    path.write_text(jsonc)
    _provision(monkeypatch, tmp_path)
    assert path.read_text() == jsonc
    assert "Warning" in capsys.readouterr().err


def test_non_dict_models_json_left_untouched(monkeypatch, tmp_path, capsys):
    path = tmp_path / "models.json"
    path.write_text("[1, 2]\n")
    _provision(monkeypatch, tmp_path)
    assert path.read_text() == "[1, 2]\n"
    assert "Warning" in capsys.readouterr().err


def test_pi_coding_agent_dir_relocates_models_json(monkeypatch, tmp_path):
    monkeypatch.setenv("PI_CODING_AGENT_DIR", str(tmp_path / "custom"))
    assert mp.models_json_path() == tmp_path / "custom" / "models.json"
    monkeypatch.delenv("PI_CODING_AGENT_DIR")
    assert mp.models_json_path() == Path.home() / ".pi" / "agent" / "models.json"


def test_pi_coding_agent_dir_tilde_expands_like_pi(monkeypatch):
    # Pi tilde-expands the override; writing to a literal "~/..." path would
    # land where Pi never reads (and create a literal ~ dir in the cwd).
    monkeypatch.setenv("PI_CODING_AGENT_DIR", "~/pi-sandbox")
    assert mp.models_json_path() == Path.home() / "pi-sandbox" / "models.json"


def test_non_dict_providers_key_left_untouched(monkeypatch, tmp_path, capsys):
    # A hand-edit slip like {"providers": [...]} is unmergeable — warn and bail
    # rather than rewriting the file and destroying the user's content.
    content = json.dumps({"providers": [{"name": "myproxy"}]}) + "\n"
    path = tmp_path / "models.json"
    path.write_text(content)
    _provision(monkeypatch, tmp_path)
    assert path.read_text() == content
    assert "Warning" in capsys.readouterr().err
