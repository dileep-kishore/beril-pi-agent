---
name: commons-check
description: Use when a research question is being framed — before committing to new analysis — to check the cross-project knowledge commons for prior findings, negative-result lessons, and open gaps, and to decide whether to build on prior work or aim at an unfilled gap. Also use at the end of a project to land its findings/gaps/lessons as durable, reusable memory. Applies whenever "has this been done?", "did anyone already try X?", or "what's still open?" is the live question. Anti-redundancy and cumulative memory, not literature search (that is literature-review).
---

# Knowledge Commons

The commons is beril's **cumulative memory across projects**: a content-addressed,
append-only store of `finding`, `lesson`, and `gap` entries (in
`~/.beril/agora` or `$BERIL_COMMONS_DIR`). It is what makes the co-scientist
*build on prior work instead of starting from amnesia every session*. It is
local and keyless; nothing here reaches the network.

## The two moments

1. **At the start (anti-redundancy).** As soon as a question takes shape, call
   `commons_check` with it. This is a *reuse* moment, never a *prohibition*:
   - **novel** → fresh ground; proceed.
   - **related** → distinct but adjacent prior work exists; it is reusable
     context, not a duplicate.
   - **overlap** → a prior project already touched this. **Skim that project's
     REPORT.md and build on it** — extend, contrast, or deepen rather than
     re-run. Never tell the scientist "don't do this."
   A matched **open gap** is the single most actionable thing in the store: it
   is a recorded "what's needed" rather than "what's known." Prefer aiming a new
   project at a gap when one fits.

2. **At the finalize seam (cumulative capture).** When a project is submitted,
   its findings, open gaps, and *surviving refutations* (durable negative
   results — "we tried X, it did not hold, here is why") land automatically via
   `commons_land --from-report`. You can also land a single entry mid-project
   with `commons_land` (a lesson learned, a gap you noticed but will not
   pursue). Landing is dedup'd by content hash and ORCID-attributed.

## Judgment

- **Negative results are first-class.** The most valuable thing you can leave
  the next scientist is often what did *not* work. Capture dead ends as
  `lesson` entries; do not let them evaporate with the session.
- **Frame overlaps as opportunity.** The presentation is deliberately
  reuse-first because a raw overlap score reads as "give up" — which is wrong.
  An overlap means you have a running start.
- **Gaps drive the next project.** When mining approved memory for ideas
  (`/idea-tournament`), a recorded gap is a stronger seed than a blank prompt.
- The commons complements, does not replace, `literature-review`: the commons
  is *your lab's* accumulated work; literature is the outside field.
