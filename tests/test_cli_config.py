"""Tests for beril CLI user configuration (config.py)."""

from __future__ import annotations

import pytest

from beril_cli import config


@pytest.fixture()
def tmp_config(tmp_path, monkeypatch):
    """Point config at a temporary directory."""
    cfg_dir = tmp_path / ".config" / "beril"
    cfg_dir.mkdir(parents=True)
    monkeypatch.setattr(config, "CONFIG_DIR", cfg_dir)
    monkeypatch.setattr(config, "CONFIG_PATH", cfg_dir / "config.toml")
    return cfg_dir / "config.toml"


def test_get_default_agent_falls_back_to_pi(tmp_config):
    """With no [defaults] agent set, the default agent is 'pi'."""
    assert config.get_default_agent() == "pi"


def test_get_default_agent_uses_configured_value(tmp_config):
    """A configured [defaults] agent overrides the fallback."""
    config.save({"defaults": {"agent": "codex"}})
    assert config.get_default_agent() == "codex"
