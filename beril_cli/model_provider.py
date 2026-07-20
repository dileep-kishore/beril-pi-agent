"""CBORG model-provider provisioning for Pi's `models.json`."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

CBORG_API_BASE = "https://api.cborg.lbl.gov/v1"
CBORG_DEFAULT_MODEL = "lbl/cborg-coder"

# contextWindow/maxTokens are doc-sourced for the coder family and applied to
# all six aliases pending live /model/info verification (the CBORG API was
# IP-gated during the 2026-07-20 audit).
_CBORG_CONTEXT_WINDOW = 114688
_CBORG_MAX_TOKENS = 16384

_CBORG_MODELS: list[tuple[str, str]] = [
    ("lbl/cborg-coder", "CBORG Coder"),
    ("lbl/cborg-coder-fast", "CBORG Coder Fast"),
    ("lbl/cborg-deepthought", "CBORG Deepthought"),
    ("lbl/cborg-mini", "CBORG Mini"),
    ("lbl/cborg-chat", "CBORG Chat"),
    ("lbl/cborg-vision", "CBORG Vision"),
]


def models_json_path() -> Path:
    """Return Pi's models.json path, honoring Pi's own $PI_CODING_AGENT_DIR override.

    Pi tilde-expands the override (expandTildePath in its config loader), so a
    literal `~/...` value must expand here too or we would write where Pi never
    reads.
    """
    override = os.environ.get("PI_CODING_AGENT_DIR")
    base = Path(override).expanduser() if override else Path.home() / ".pi" / "agent"
    return base / "models.json"


def _cborg_provider() -> dict:
    """Build the complete CBORG provider entry.

    An incomplete entry (missing baseUrl/apiKey/api) makes Pi 0.79.1 drop every
    custom provider in the file, so all fields are always written together.
    """
    return {
        "name": "CBORG API",
        "baseUrl": os.environ.get("BERIL_CBORG_API_BASE") or CBORG_API_BASE,
        "api": "openai-completions",
        "apiKey": "$CBORG_API_KEY",
        "headers": {"x-litellm-api-key": "$CBORG_API_KEY"},
        "compat": {
            "supportsStore": False,
            "supportsDeveloperRole": False,
            "supportsReasoningEffort": False,
            "maxTokensField": "max_tokens",
        },
        "models": [
            {
                "id": model_id,
                "name": name,
                "reasoning": False,
                "input": ["text"],
                "contextWindow": _CBORG_CONTEXT_WINDOW,
                "maxTokens": _CBORG_MAX_TOKENS,
                "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
            }
            for model_id, name in _CBORG_MODELS
        ],
    }


def ensure_model_provider(provider: str) -> None:
    """Merge the BERIL-managed provider profile into Pi's models.json.

    Same fail-safe merge convention as `_set_theme`: read-if-exists, bail
    (warn, leave the file untouched) on non-dict or parse failure — a user file
    may be valid JSONC for Pi and still unparseable by stdlib json — mutate
    only `providers.<provider>`, warn-don't-raise on write errors.
    """
    if provider != "cborg":
        return
    path = models_json_path()
    try:
        data = json.loads(path.read_text()) if path.exists() else {}
        if not isinstance(data, dict):
            print(
                f"Warning: {path} is not a JSON object; leaving it untouched.",
                file=sys.stderr,
            )
            return
        providers = data.setdefault("providers", {})
        if not isinstance(providers, dict):
            # Same fail-safe as the non-dict top level: never rewrite (and so
            # destroy) user content we can't merge into.
            print(
                f"Warning: 'providers' in {path} is not a JSON object; leaving it untouched.",
                file=sys.stderr,
            )
            return
        providers["cborg"] = _cborg_provider()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2) + "\n")
    except (OSError, json.JSONDecodeError) as exc:
        print(
            f"Warning: could not update Pi models.json for CBORG: {exc}",
            file=sys.stderr,
        )
