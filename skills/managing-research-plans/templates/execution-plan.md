# <Component> — Execution Plan v<N>

Component: `<NN-slug>` · Master plan: [master-plan.md](../../master-plan.md) · Date: <YYYY-MM-DD>
Provenance: <omit for a prospective plan. For work already done when this plan is written: `retrospective — written <YYYY-MM-DD>; covers work executed <start>–<end>`>
Supersedes: v<N-1> — <one line: what changed and why>
<!-- Omit the Supersedes line for v1. Never edit an earlier version; a revision is a new file.
     Provenance absent = prospective (the default, and every plan written before its work).
     A retrospective plan is an honest label, not a lesser plan: it must still pass every
     rubric item. Cite each claim to its dated source or commit; tag anything reconstructed
     with hindsight inline as (reconstructed), the same honesty move as history.md's Uncertain. -->

## Part 1 — For humans (the what & why)

<!-- The human-readable half: what this component is for and why. A coauthor with no chat
     context should be able to read Part 1 alone and understand the work. On the board,
     Part 1 is shown and Part 2 is collapsed under a toggle. Keep the "## Part 1 —"/"## Part 2 —"
     banner lines verbatim: the board splits the plan on them. -->

## Goal and success criteria

Serves: <RQ numbers from the master plan, e.g. `RQ1` or `RQ1, RQ2`; `—` for infrastructure>

<What this component will produce or establish, and the concrete criteria by which the
researcher will judge that it succeeded. Every build step below must trace back to this.>

Stopping rule: <only for an iterated component — a collection round, a pilot/retest wave, a re-fielding. The condition that ends the series (target N reached, saturation, budget spent, a fixed number of waves). One wave under this rule is not a plan deviation; the series is done when this is met. Delete this line for a single-shot component.>

## Context

<Why this work, what it builds on, and what question it answers. A paragraph or two, readable by a coauthor with no chat context.>

## Scope decisions

| Dimension | Decision | Why |
|-----------|----------|-----|
| <e.g., dependent variable> | <chosen option> | <one-line reason: the engagement, condensed> |
| <e.g., sample restriction> | <chosen option> | <one-line reason> |

<Every substantive dimension of the design gets a row: what was chosen and why. The reason column is what a reader checks first. A list is fine instead of a table for small components.>

## Part 2 — For agents (the how)

<!-- The technical half: how to execute. On the board this is collapsed by default under the
     "Part 2 — For agents" toggle. -->

## Approach

<The high-level pipeline, two to four stages, in a form another agent could pick up and execute.>

## Build steps

1. <Numbered steps. Add sub-steps where the decisions are technical.>
2. <...>

## Verification

<How the researcher will judge whether the work succeeded. Concrete and checkable: executable tests, data audits, citation validation, code review, human review of specific outputs. Not "review the results".>

## Out of scope

<Explicit non-goals that keep execution from drifting beyond the planned work. Name the tempting adjacent work this plan deliberately does not do.>

## Files to reuse

<Optional. Existing code or data this work should build on rather than rebuild. Delete this section if empty.>

## Sources

<Retrospective plans only — delete this section in a prospective plan. The dated documents and evidence this reconstruction rests on: the ad-hoc plan docs that actually governed the work, review notes, and the commits/outputs that show what was done and when. In-repo docs are cited by relative path (their own git history is the evidence). Out-of-repo docs (e.g. `~/.claude/plans/*.md`) are snapshotted into `sources/<date>-<name>.md` and listed here as original-path → snapshot → date. A reviewer resolves every entry against the declared coverage range.>

| Source | In repo? | Date | Snapshot |
|--------|----------|------|----------|
| <original path> | <yes: cite path / no: snapshotted> | <YYYY-MM-DD from git/mtime> | <sources/…-name.md, or — for in-repo> |

---
Signed off: <researcher name>, <YYYY-MM-DD>
