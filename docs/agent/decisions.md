# Current decisions and history

This page records current conclusions that are easy to misread in dated plans.
It links to historical rationale instead of duplicating full design documents.

## Standing design decisions

- Science stays in the foreground: tools render artifacts as science cards and
  routine plumbing recedes.
- The workflow is advisory except where human responsibility or irreversible
  state requires a gate.
- The human is the verifier of record; AI review is independent input, not the
  approval authority.
- Trust is derived from artifacts and disconfirmation, never persuasive prose
  or a model-supplied confidence number.
- The notebook with saved outputs is the reproducible record. Hashes protect
  integrity and review currency; BERIL does not rerun notebooks to create a
  reproducibility score.
- Durable lifecycle authority remains in Python and `beril.yaml`; Pi caches and
  provenance snapshots support presentation and orientation.
- New core capabilities remain free/keyless and avoid third-party dependencies
  in tool access, safety, or integrity paths.

## PR #10: trust and investigation-state hardening

[PR #10](https://github.com/dileep-kishore/beril-pi-agent/pull/10) merged the
following current behavior:

- A leakage/evaluation-integrity review rubric that reads material notebook
  outputs as well as source.
- Mandatory human ORCID sign-off on `analysis → reviewed`, enforced inside the
  Python transition and fail-closed in headless/untrusted sessions.
- Artifact-derived groundedness and a single review-preflight warning when
  written confidence outruns distinct evidence.
- A bounded research world model stored in
  `provenance.json:research_state`; it is orientation only.
- Context-aware, state-aware, throttled capability nudges.
- Explicit rejection of rerunning notebooks or comparing output bytes as a
  reproducibility metric.

Rationale and phased history:

- [`Co-scientist trust hardening design`](../superpowers/specs/2026-06-23-coscientist-trust-hardening-design.md)
- [`Co-scientist trust hardening plan`](../superpowers/plans/2026-06-23-coscientist-trust-hardening.md)
- [`Context-aware route-nudge plan`](../superpowers/plans/2026-06-23-context-aware-route-nudge.md)

The plans contain deliberately cut intermediate ideas, including a dead
faithfulness helper and reproducibility evaluation. Do not revive them merely
because an unchecked task remains in a historical phase list.

## PR #11: KOROS-mined upgrade and gate closure

[PR #11](https://github.com/dileep-kishore/beril-pi-agent/pull/11) added a broad
set of current capabilities despite its narrow final title:

- Typed, legible auto/judgment/human gates and recorded verdicts/overrides.
- Data-validity profiling for zero sentinels, numeric strings, low variance,
  sparse axes, and pseudoreplication.
- A separate content-addressed cross-project commons for findings, lessons, and
  gaps.
- Filesystem-derived coherence checks on `reviewed → complete` and RO-Crate
  generation before submission.
- Claim types, content-addressed claim UIDs, and a higher scrutiny bar for
  synthesis claims.
- Conservative infrastructure-error separation and inline/new-figure display.
- Follow-up fixes requiring current claims, ORCID-shaped override attribution,
  real refutation-search notes, inferred evidence pointer kinds, and early abort
  when crate/commons preparation fails.

Rationale and audit material:

- [`KOROS-mined upgrade spec`](../superpowers/specs/2026-07-07-koros-mined-upgrade.md)
- [`KOROS-mined review dossier`](../superpowers/reviews/2026-07-07-koros-mined-upgrade-review-dossier.md)

## Historical documentation policy

Files under `docs/superpowers/specs/` explain intended designs; files under
`plans/` capture implementation sequencing; files under `reviews/` capture an
audit at a point in time. Preserve them as history. For current behavior, prefer
the live source registries and this wiki, then use the dated record to recover
rationale.
