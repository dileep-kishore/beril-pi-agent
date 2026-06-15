---
name: submit
description: Use when the author is ready to stand behind a BERIL research project and archive it to the lakehouse — the approval event that marks a project complete. Covers what a finished project requires (research question, named authors with ORCID, REPORT.md with Key Findings, a current review), the "responsible author approves" semantics, the pre-submission completeness rubric, the ORCID identity requirement, review-currency tied to the current report and executed notebooks, and what the approval/submission markers attest to. Run /submit to execute; this skill carries the judgment about whether a project is actually ready and what approval means.
---

# Project Submission

`/submit` is the **approval event**: the moment the responsible author stands behind a research project and commits it to the BERDL lakehouse archive as complete. This skill is the judgment layer — what "ready" means, what a complete project contains, and what the author is attesting to. The mechanics (locking, hashing, marker files, upload, idempotent retry) are handled by the `/submit` command and its tools, not by you.

To submit, run `/submit <project>`. Use `/whereami` first to confirm the project is reviewed and `/next` if the path is unclear. The command transitions the project to `complete` via `lifecycle_transition`, verifies the approval against `notebook_hash`-tracked content, gates on `beril_user` ORCID identity, and archives via `lakehouse_submit` (a destructive, confirmation-gated overwrite of the remote archive). The central `beril-safety` gate confirms the destructive upload before it runs.

## What submission means

Submission is **not** running the reviewer. Produce reviews first with `/berdl-review <project>` — run it as many times as you want, with whatever model. `/submit` *consumes* the latest review; it does not generate one.

The lakehouse archive is the source of truth for "this project was submitted." Approval is the responsible author's act of standing behind the work given everything they know. Reviews are **advisory**: you can approve a project with open critical or important issues — that is exactly what the explicit yes/no approval prompt exists for. The author, not the reviewer, decides whether the work is complete.

## When a project is ready to submit

A project must be at lifecycle state `reviewed` (report drafted, a current review exists) before it can be approved. Earlier states are not submittable, and the proper next action differs by state:

- `exploration` — write the research plan and run analysis before submitting.
- `proposed` — run the analysis notebooks before submitting.
- `active` — draft REPORT.md (run `/synthesize <project>`) before submitting.
- `analysis` — no current review exists; run `/berdl-review <project>` first.
- `reviewed` — ready. Proceed to approval.
- `complete` — already submitted, or approved and awaiting a retried upload (see *After submission*).

If `/submit` reports a project is not at `reviewed`, treat the message as a checklist of what the science still needs, not an obstacle to route around.

## Pre-submission completeness rubric

Before approving, confirm the project tells a complete scientific story. These are the criteria `/submit` checks; understand *why* each matters so you can judge borderline cases.

**Required (a project is not complete without these — a failure blocks submission):**

- A **research question** — stated and non-empty. A project with no question answers nothing.
- **Named authors** — at least one real author, not a placeholder. Anonymous or "Your Name" entries mean no one is standing behind the work.
- **REPORT.md with a `## Key Findings` section** — the report is the project's primary artifact and Key Findings is its scientific payload. A complete project without this is archiving an empty result.
- A **current review** matching the latest report (see *Review currency*).

**Expected (warn, but the author may consciously proceed):**

- **Discoveries documented** — durable findings worth carrying forward (a `## Discoveries` section in REPORT.md, or a discoveries memory). On approval these reviewed-and-approved discoveries become OV-ingestible memories; that is how vetted findings enter the knowledge layer without contaminating it with unvetted synthesizer output.
- **Performance notes** — model/method performance claims worth preserving (a `## Performance Notes` section), extracted the same way on approval.
- **Pitfalls documented** — not every project hits a pitfall worth recording, so absence is only a soft warning.
- **Interpretation** — a `## Interpretation` section: what the findings *mean*, beyond the raw numbers (e.g. what an AMR gene's presence implies, why a COG-category enrichment or GTDB placement matters).
- **References** — the literature grounding the work (gather via `/literature-review <topic>` or `lit_search`/`lit_fetch` if thin).
- A **research plan**, a **reproduction guide** (so the analysis can be re-run), **figures** (at least one), notebooks whose **code cells carry outputs** (an executed notebook, not a stale one), and a **dependencies** list.

A failing *required* check means the project genuinely is not complete — fix the science. An *expected* check is a prompt to reflect: usually add the missing piece, but the author may approve with it open if they understand the gap.

## ORCID identity gate

Approval requires a verified ORCID. There are **no anonymous approvals** — the approval record must name a responsible, attributable author. Check identity with `beril_user`; if no ORCID is configured, the author must set one up (`beril setup`) before submitting. Confirm the author's ORCID also appears in the project's `## Authors` so the archived record and the approver agree.

## The approval decision

`/submit` surfaces the latest review's critical and important issue counts and asks the author to explicitly approve. Two things to weigh:

- **Open issues are advisory.** High critical/important counts are a signal to look again, not an automatic block. Decide whether each open issue actually undermines the conclusions, or is a noted limitation the report already acknowledges.
- **Re-submission overwrites.** If the project was submitted before, approving again *replaces* the existing lakehouse archive. `lakehouse_submit` is destructive and confirmation-gated. Re-submit deliberately, only when the new content supersedes the old.

Approve only when you would defend the report's findings to a colleague. Declining is free and lossless — no state changes — so iterate with `/berdl-review` and re-run `/submit` later rather than approving work you can't stand behind.

## Review currency

The approval must be tied to the *current* report. A review written against an older draft of REPORT.md does not count — the report may have changed since. `/submit` enforces this via `notebook_hash` content tracking: it confirms the latest review **and the executed notebooks** match the report being approved, so the approval attests to exactly what gets archived. If the report changed after its last review, run `/berdl-review <project>` again for a fresh one before approving.

This currency check also guards already-`complete` projects. If a report, review, or notebook is edited *after* approval, the recorded approval no longer reflects what's on disk — it is stale and cannot be re-uploaded as-is. The correct response is to demote the project back to `analysis` and re-review, not to force the upload; the prior approval is archived and a fresh review must attest to the new content. An approval is only meaningful when it names exactly the bytes being archived.

## What the markers attest to

`beril.yaml` is the source of truth for the approval and the submission audit log; the local marker files are a derived, at-a-glance view of it:

- **Approval** (recorded in `beril.yaml` with the approver's ORCID, timestamp, and the content hashes) is the author's standing-behind event. It survives a failed upload.
- **`SUBMITTED.md`** means the latest approved content reached the lakehouse archive successfully.
- **`SUBMISSION_FAILED.md`** means the approval is recorded but the upload has not yet landed — a retry is pending. Exactly one of these two markers should be present after a submission attempt; if both ever appear, the failure marker is the more recent truth.

You do not write or reconcile these by hand — the `/submit` command manages them. Read them to understand *where a project stands*: approved-and-archived, or approved-and-awaiting-retry.

## After submission

On a successful archive, update the project's idea tracker — move the project from the active/priority ideas list to completed, with a one-line results summary — and remember that `/submit` is idempotent: re-running on an already-`complete` project is safe and simply confirms the archive or retries a failed upload. A failed upload leaves the approval intact (the author still stands behind the work); the upload can be retried with `/submit` without re-approving, and the retry will overwrite the archive with the stable approved content.

## Pitfall capture

If you hit errors, surprising results, or data oddities while preparing a submission, capture them as project pitfalls so future work avoids the same trap.
