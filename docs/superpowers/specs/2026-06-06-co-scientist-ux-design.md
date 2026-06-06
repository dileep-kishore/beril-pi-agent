# Co-scientist UX: collaboration, data visibility, and calibrated verification

**Date:** 2026-06-06 · **Scope:** P0 + P1

Driven by usability feedback from working scientists. The throughline: scientists
need to keep a mental model of what the agent is doing and to judge how far to
trust each result. The agent should collaborate and make checking easy, rather
than racing to a polished artifact.

## Context

This Pi port already minimizes interruptions — Pi has no per-tool permission
popups, and `beril-safety` gates only irreversible operations — so this work
targets the collaboration, data-visibility, and verification gaps rather than
prompt volume. (Sharpening the few remaining destructive confirmations was scoped
out of this branch.)

## Changes

| # | Change | Files |
|---|--------|-------|
| P0-A | **Always-on research-conduct contract** injected into every turn's system prompt via `before_agent_start` (the package's first system-prompt injection): ask before large moves, check in at natural seams, signal confidence, make data visible, make verification easy. | `lib/conduct.ts`, `extensions/beril-conduct.ts` |
| P0-B | **`berdl_peek` tool + `/berdl-preview <db.table>`** — one-shot table preview (column schema + types/comments + a few sample rows; no `COUNT(*)`, to respect large-table guards). Discover hint now points at `berdl_peek`. | `lib/peek.ts`, `extensions/beril-data.ts`, `lib/hints.ts` |
| P1-C | **Data-forward onboarding + feasibility step** — `/berdl-start` surfaces the top accessible collections up front and adds an explicit "is this answerable with the available data?" checkpoint. | `prompts/berdl-start.md` |
| P1-D | **Verification as the default next step** — `synthesize` flags the least-confident findings and proactively offers the relevant check (data / code / `/berdl-review`) instead of waiting to be asked. | `skills/synthesize/SKILL.md` |
| P1-E | **Research-step breadcrumb in the footer** — a scientist-facing checklist (`explore · plan · ▸analyze · review · submit`) derived from lifecycle state, always visible. | `lib/research-steps.ts`, `extensions/beril-env.ts` |

## Verification

`bun run check` (tsc against pinned 0.78.1 types + biome), 99 TS unit tests, 175
Python tests, and `pi install -l .` all green. Pure helpers (`conduct`, `peek`,
`research-steps`) are unit-tested; the `berdl_peek` tool, `/berdl-preview` command,
and the footer breadcrumb segment are covered in the extension test harnesses. A live
session-load smoke needs a configured model provider + BERDL connection and is deferred.
The reproducibility/hash substrate and the destructive-action safety gate were untouched.
