"""Content-addressed knowledge commons (the "agora") — store + tf-idf query.

A durable, cross-project memory of findings, lessons, and gaps. Bodies are
content-addressed by sha256 (dedup is free), inlined in an append-only
``index.jsonl`` for queryability, and mirrored under ``objects/``. Query is a
stdlib tf-idf cosine — no third-party dependency in this path.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

KINDS = ("finding", "lesson", "gap")
MAX_BODY = 2000
_NOVEL_BELOW = 0.15
_RELATED_BELOW = 0.5
_TOKEN = re.compile(r"[a-z0-9]+")


def store_root() -> Path:
    """The commons directory: ``$BERIL_COMMONS_DIR`` or ``~/.beril/agora``."""
    env = os.environ.get("BERIL_COMMONS_DIR")
    return Path(env) if env else Path.home() / ".beril" / "agora"


def _index_path(root: Path) -> Path:
    return root / "index.jsonl"


def read_index(root: Path) -> list[dict]:
    """Read all records from the append-only index (empty when absent)."""
    path = _index_path(root)
    if not path.is_file():
        return []
    records: list[dict] = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return records


def _known_shas(root: Path) -> set[str]:
    return {r.get("sha256", "") for r in read_index(root)}


def make_record(kind: str, body: str, project: str, by: str = "", tags: list[str] | None = None) -> dict:
    """Build a commons record (body trimmed to ``MAX_BODY``, sha256 over the body)."""
    body = body.strip()[:MAX_BODY]
    sha = hashlib.sha256(body.encode("utf-8")).hexdigest()
    return {
        "kind": kind,
        "body": body,
        "sha256": sha,
        "by": by or "",
        "project": project,
        "created": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "visibility": "project",
        "tags": tags or [],
    }


def land(root: Path, record: dict, known: set[str] | None = None) -> bool:
    """Persist a record; return True if landed, False if a duplicate/rejected.

    Private records never land (the store simply doesn't accept them). Dedup is
    by sha256 against the existing index.
    """
    if record.get("visibility") != "project":
        return False
    if not record.get("body"):
        return False
    sha = record["sha256"]
    if known is None:
        known = _known_shas(root)
    if sha in known:
        return False
    objects_dir = root / "objects" / sha[:2]
    objects_dir.mkdir(parents=True, exist_ok=True)
    (objects_dir / sha).write_text(record["body"])
    root.mkdir(parents=True, exist_ok=True)
    with _index_path(root).open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, sort_keys=True) + "\n")
    known.add(sha)
    return True


def _tokens(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if len(t) > 1]


def _tfidf(counts: Counter, idf: dict[str, float]) -> dict[str, float]:
    return {term: tf * idf.get(term, 0.0) for term, tf in counts.items()}


def _cosine(a: dict[str, float], b: dict[str, float]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(a[t] * b.get(t, 0.0) for t in a)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


def query(root: Path, text: str, k: int = 5) -> dict:
    """tf-idf cosine query over index bodies → {verdict, matches}."""
    records = read_index(root)
    if not records:
        return {"verdict": "novel", "matches": []}
    doc_tokens = [_tokens(r.get("body", "")) for r in records]
    n_docs = len(records)
    df: Counter = Counter()
    for toks in doc_tokens:
        for term in set(toks):
            df[term] += 1
    idf = {term: math.log((1 + n_docs) / (1 + d)) + 1.0 for term, d in df.items()}
    q_vec = _tfidf(Counter(_tokens(text)), idf)
    scored: list[tuple[float, dict]] = []
    for toks, rec in zip(doc_tokens, records):
        score = _cosine(q_vec, _tfidf(Counter(toks), idf))
        scored.append((score, rec))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    top = scored[0][0] if scored else 0.0
    verdict = "novel" if top < _NOVEL_BELOW else ("related" if top < _RELATED_BELOW else "overlap")
    matches = [
        {
            "score": round(score, 4),
            "kind": rec.get("kind"),
            "project": rec.get("project"),
            "body": rec.get("body"),
            "created": rec.get("created"),
        }
        for score, rec in scored[:k]
        if score > 0.0
    ]
    return {"verdict": verdict, "matches": matches}


# ── report extraction ────────────────────────────────────────────────────────


def _section_bullets(text: str, headings: list[str]) -> list[str]:
    """Bullet lines under any of the given ``## Heading`` sections (case-insensitive)."""
    wanted = {h.lower() for h in headings}
    lines = text.splitlines()
    bullets: list[str] = []
    in_section = False
    for line in lines:
        stripped = line.strip()
        header = re.match(r"^#{1,6}\s+(.*)$", stripped)
        if header:
            in_section = header.group(1).strip().lower() in wanted
            continue
        if in_section and stripped.startswith(("- ", "* ")):
            bullets.append(stripped[2:].strip())
    return [b for b in bullets if b]


def _supported_claims(project_dir: Path) -> list[str]:
    claims = project_dir / "claims.json"
    if not claims.is_file():
        return []
    try:
        payload = json.loads(claims.read_text())
    except json.JSONDecodeError:
        return []
    rows = payload.get("rows") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    return [
        str(r["claim"]).strip()
        for r in rows
        if isinstance(r, dict) and r.get("status") == "supported" and r.get("claim")
    ]


def _newest_refutation(project_dir: Path) -> Path | None:
    candidates = sorted(project_dir.glob("REFUTATION_*.md"))
    if not candidates:
        return None

    def index(path: Path) -> int:
        m = re.search(r"REFUTATION_(\d+)", path.name)
        return int(m.group(1)) if m else -1

    return max(candidates, key=index)


def _surviving_checks(text: str) -> list[str]:
    """Surviving disconfirming checks: lines under ``## Surviving`` + ``- SURVIVES:`` lines."""
    survives = [
        line.strip()[len("- SURVIVES:"):].strip()
        for line in text.splitlines()
        if line.strip().startswith("- SURVIVES:")
    ]
    section = _section_bullets(text, ["surviving", "surviving checks"])
    out: list[str] = []
    for item in section + survives:
        if item and item not in out:
            out.append(item)
    return out


def extract_from_report(project_dir: Path) -> dict[str, list[str]]:
    """Extract findings / gaps / lessons from a project's report artifacts."""
    report = project_dir / "REPORT.md"
    report_text = report.read_text() if report.is_file() else ""
    findings = _section_bullets(report_text, ["findings", "key findings"]) if report_text else []
    if not findings:
        findings = _supported_claims(project_dir)
    gaps = (
        _section_bullets(report_text, ["open questions", "gaps", "open questions / gaps", "future directions"])
        if report_text
        else []
    )
    refutation = _newest_refutation(project_dir)
    lessons = _surviving_checks(refutation.read_text()) if refutation else []
    return {"finding": findings, "gap": gaps, "lesson": lessons}
