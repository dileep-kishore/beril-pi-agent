---
name: world-model
description: Use when a long investigation risks losing its thread — to keep a lightweight, local "world model" of orientation (the working question, still-open questions, working assumptions, and tried-and-abandoned dead ends) so the arc stays coherent across context compactions. This is ORIENTATION, never findings — settled results live in the claim ledger (claims.json), not here. Run /world-model to show it, or call world_model(mode=update) to record the current orientation mid-arc.
---

# Investigation world model

A small, local, keyless block of *orientation* that rides on the cross-session
`research_state` snapshot, so a long arc (`explore → plan → analyze → review →
submit`) keeps its thread when Pi compacts the conversation. Four sections:

- **question** — the one research question under investigation, in a sentence.
- **openQuestions** — what is still unresolved and would change the conclusion.
- **assumptions** — working assumptions that, if wrong, would change the analysis.
- **deadEnds** — avenues already tried and abandoned, so they are not re-attempted.

Execution is the `world_model` tool (`mode=read` shows it as a card; `mode=update`
records the supplied sections, merging with what is already there) and the
`/world-model <project>` command. This skill is the *judgment*: what belongs here
and what does not.

## The one hard rule: orientation, NOT findings

The world model is a re-verifiable PROMPT to yourself, never proof. **Never put a
settled result here** — claims, support/refute evidence, and confidence/groundedness
live in `claims.json` (the claim ledger) via `claim_state`. Duplicating a result
into the world model would let an unverified line read back as established fact after
a compaction. If something is a *finding*, record it as a claim; if it is a
*question, assumption, or ruled-out avenue*, it belongs here.

## When to update

- After framing or reframing the research question.
- When a new open question surfaces (a confound to rule out, a branch to test later).
- When you commit to an assumption the analysis depends on.
- When you rule an avenue out — record the dead end *and why*, so it is not retried.
- Before a likely compaction (a long turn), so the thread survives.

## What makes a good entry

- **Specific and re-checkable** — "is the ANI cutoff 95% appropriate for this genus?"
  not "check the data". Name the table/column/threshold where you can.
- **Decision-relevant** — would resolving it change a conclusion or the next step?
  If not, leave it out; the model is a compass, not a log.
- **Honest dead ends** — "tried joining on `genome_id`; the column is string-typed
  in `gene` (pitfall) — abandoned for `genome_ani`." A dead end with its reason
  saves the most time.
- **Bounded** — keep each section short (the tool clamps to a handful of entries);
  prune resolved questions and superseded assumptions rather than letting it grow.

## Reading it back

On the first turn after a compaction the orientation sections are re-injected as
*background* context under an explicit "orientation only, NOT established findings —
re-verify" guard. Treat them as where you left off, not as proof: re-open the plan,
report, and `claims.json`, and re-run checks before asserting any result as settled.
