---
name: berdl-start
description: Use when starting or resuming a BERIL session, orienting to the current project, checking BERDL connection readiness, or deciding the next workflow step. Pairs the /berdl-start prompt template with /whereami, /next, and berdl_env_check so the scientist sees connection state, active project state, and the next safe action before analysis proceeds.
---

# BERDL Start / Session Orientation

Use this skill when the scientist is beginning a session, returning to existing work, or asks where they are in the BERIL research arc.

## Core behavior

1. **Orient before acting.** Use `/whereami` or the available project state to identify the active project, lifecycle phase, and likely next command. If no project is active, say that plainly and suggest starting with `/berdl-start` or a research question.
2. **Check connection state.** Use `berdl_env_check` when data access matters. If BERDL is not ready, relay the next steps rather than attempting analysis.
3. **Make data visible early.** When connected and the scientist is still choosing a question, use `berdl_discover` and offer `/berdl-preview <table>` before committing to a plan.
4. **Choose the next seam.** Prefer `/next` for a deterministic next step from lifecycle state; otherwise suggest the smallest safe next command:
   - exploration → `/research-plan <project>` once the question is feasible
   - proposed → `/analyze <project> --first-result`
   - active/analysis → `/synthesize <project>` after notebooks have saved outputs
   - reviewed → `/submit <project>` if the responsible author approves
5. **Do not skip feasibility.** Before a new study moves to planning, confirm answerability with the available data using `berdl_feasibility` or targeted `berdl_peek`/`berdl_query` probes.

## Good response shape

- Current project/phase, if known.
- BERDL readiness and the one blocking setup action, if any.
- The next recommended command and why.
- A short offer to preview data, review literature, or write the plan depending on the scientist's goal.
