---
name: lifecycle-gates
description: Use when the scientist asks what stands between a project and its next phase, why a transition is blocked, who has to sign off, or wants to record a verdict or override on a gate. Explains the lifecycle gate catalog — the auto / judgment / human gate types, what each checks, and how verdicts and overrides are recorded and audited. Applies to "what's blocking this?", "can I move to reviewed?", "who approves?", and recording gate decisions. Reference and mechanics, not analysis.
---

# Lifecycle Gates

A project moves `exploration → proposed → active → analysis → reviewed →
complete`. The discipline lives on the **edges**: each transition carries gates.
The point is legibility and calibrated trust — the scientist always knows what a
check is, whose call it is, and what was recorded — never a wall that blocks
capable work. `/gates [project]` prints the live catalog with any recorded
verdicts merged in.

## The three gate types

- **auto** — re-evaluated live from the record every time. A recorded verdict
  does **not** clear it; you fix the *inputs*. Example: `coherence` (the record
  is current with the work products), `report-present`, `claims-present`.
- **judgment** — a recorded verdict (with a note saying what it rests on) clears
  it. Record with `gate_record`. Example: `data-validity`, `feasibility`,
  `independent-review`, `commons-landed`.
- **human** — satisfiable *only* by the scientist's own sign-off; the agent may
  request it but never grant it. Example: `plan-approval`, `orcid-signoff`.

## The gates that block, and how to cross them

- **`active → analysis`** requires `report-present` + `claims-present` (auto:
  REPORT.md and a valid claims.json exist) and invites a `data-validity`
  judgment verdict on the analyzed data.
- **`analysis → reviewed`** requires an ORCID sign-off (`orcid-signoff`, human):
  AI review is advisory; a human stands behind the report. This is enforced
  inline and cannot be reached headlessly.
- **`reviewed → complete`** runs the **`coherence`** auto gate: the record must
  be current with the work products (no notebooks/figures newer than the
  provenance, claims not stale against REPORT.md). If it blocks, the record is
  behind — bring it current and retry. Overriding is a *conscious human act*:
  confirm, give a reason, and it is recorded against your ORCID. Do not override
  to dodge bookkeeping; override only when the record is genuinely acceptable
  as-is.

## Judgment

- **Overrides are a metered signal, not a bypass.** Every override is logged
  with its reason and ORCID. A rising override rate means a gate is
  mis-calibrated or the discipline is slipping — surface it, do not normalize it.
- **A recorded verdict is not a substitute for the thing.** Recording
  `data-validity pass` means *you looked and judged*, not that the check is
  ceremony. Say what it rests on in the note.
- Gates exist to make verification the path of least resistance — the fast path
  and the disciplined path should be the same one.
