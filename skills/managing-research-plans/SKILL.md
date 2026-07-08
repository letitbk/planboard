---
name: managing-research-plans
description: Use when working in a research repository initialized for the research-plans workflow (plans/master-plan.md exists AND the repo's CLAUDE.md contains the research-plans marker) — when a session starts there, when the researcher asks to adopt the workflow mid-session after exploratory work has begun, when executing analysis or data work, when a decision point arises with the researcher, when work deviates from an execution plan, or when the researcher mentions the master plan, an execution plan, or the decision log. Not for software project planning, and not for repositories without both markers.
---

# Managing Research Plans

## Overview

Dual-tracking: **the researcher plans and decides; you carry the bookkeeping.** The project keeps a lightweight master plan (a roadmap with a components tracker), one versioned execution plan per component, and an append-only decision log. Your job is to keep those three artifacts truthful without the researcher having to think about them.

Artifacts are organized around **the research project and its questions**: the master plan carries numbered research questions (RQ1, RQ2, …) and every component serves one or more of them (the Serves column; `—` for genuine infrastructure). Components are research activities, never a history of repository actions — what exists in the repo informs status, never structure.

## When NOT to use (hard gate)

This skill applies only when **both** opt-in markers exist:

1. `plans/master-plan.md` containing `<!-- research-plans:master-plan -->`
2. The repo's `CLAUDE.md` containing `<!-- research-plans:start -->`

If either is absent, this workflow does not apply. Stay silent about it, never create `plans/` uninvited, and never suggest initializing unless the researcher asks. A stray copied `master-plan.md` without the CLAUDE.md marker does not count as opt-in. For software implementation plans, use superpowers writing-plans instead.

## Core pattern

**Session start.** Read `plans/master-plan.md`, then the latest version of the execution plan for whichever component the work touches (`plans/execution/<NN-slug>/`, highest `vN.md`).

**Mid-session adoption.** The workflow can be adopted mid-session, after exploratory work has begun (`/research-plans:init` works either way). What the session already established feeds the plan — context, research questions, goals, scope reasons — never the log. The log starts at the master plan's `Initialized:` timestamp; nothing before it is loggable or counts as a deviation.

**During work.**
- Surface interpretive choices (variable selection, case exclusions, coding rules, model specification) to the researcher *before* acting. Do not decide research questions, analytical choices, or interpretation on the researcher's behalf.
- Append to `plans/decision-log.md` **as decisions happen** — when you ask a clarifying question, when the researcher sets or changes scope, when you make a non-trivial interpretive call (flag it), or when a surprising result changes what happens next. Use the entry format in `templates/decision-log.md`, with a real timestamp (`date +"%Y-%m-%d %H:%M"`). If unsure whether to log: log it.
- If work is about to exceed what the current plan covers, pause and say so. Either the researcher rescopes the task, or you draft a new plan version. Do not drift.

**After execution work.**
- Update the component's row in the master plan tracker (status + one-line outcome) when there is real evidence of progress (outputs on disk, commits), and update `Last updated:`.
- If execution deviated materially from the plan, propose `v<N+1>.md` with a `Supersedes` line stating what changed and why. The researcher approves and signs before it is written.
- When a component's analysis has produced outputs, offer `/research-plans:results` to capture a results bundle for board review; never capture silently.
- `/research-plans:sync` is the explicit checkpoint for all of this; use its late-capture protocol if logging was missed mid-session.

**Results bundles.** `plans/execution/<NN-slug>/results/rN/` holds an immutable snapshot of what an analysis produced: `manifest.json` (plan version, provenance planned|retrofit, trigger, metrics, artifacts with sha256 sources and producing scripts), `report.md` (brief, cites artifacts by id, honest about misses), `artifacts/` (copies; >5 MB recorded by path+checksum only), `scripts/` (the code that ran), and `verdict.json` once the researcher rules on it (written exactly once — by `scripts/results.py verdict`, driven from board feedback). Capture always goes through `scripts/results.py` staging (`stage`/`copy`/`finalize`); direct writes into `rN/` are hook-denied. On an accepted verdict the tracker status becomes `done (verified)`; on changes-requested the fix is a NEW bundle (`trigger: redo-after-review`), never an edit. Verdicts are recorded acts, not gates. Backfilling is legitimate: `/research-plans:results` with no argument reconciles components whose plans ran ahead of their results record, one interview at a time; plan-governed work captured after the fact carries `late: true` in the manifest (the results analogue of the log's late-captured label — the script snapshot shows the code as of capture, not necessarily as of the run).

## Conventions

- **Versions are immutable — and mechanically enforced.** `v1.md, v2.md, ...` are never overwritten or edited; the plugin's sign-off gate (a PreToolUse hook) blocks edits to signed versions and opens a browser approval for every new version write. Approval happens on the board, not in the terminal. If the gate denies, read `plans/.board-feedback.md`, revise, and write again. Headless/CI sessions set `RESEARCH_PLANS_NO_GATE=1` (the bypass leaves a stderr trace). Deviations are recorded, never hidden — especially the improvised ones.
- **The log is append-only and real-time.** Never backfill at the end of a session. Late captures happen only via `/research-plans:sync` and carry the `(late-captured at sync)` label. Pre-adoption decisions go in `plans/history.md`, never the log.
- **Plan provenance (v0.3).** A plan is prospective by default. Work adopted after it was done gets a full plan carrying `Provenance: retrospective — covers <range>` plus a `Sources` section — an honest label, not a lesser plan, judged by every rubric check. Undeclared retrospection (a methods section passed off as prospective) fails the threshold; a declared, evidence-cited retrospective plan passes. `/research-plans:adopt` drafts these in bulk and reviews them in one board batch.
- **Numbers are stable identifiers.** A component's `#` and slug are assigned once and never change, move, or get reused — the execution plan and any finalized results bundle are addressed by that slug forever. Work sequence is the **table row order**; reorder rows, never renumber. A late-adopted component shows its true place by moving its row.
- **Pre-adoption history is a record, not the log.** Decisions predating `Initialized:` go in `plans/history.md`: reconstructed, evidence-cited, date-granularity, appendable anytime but scoped strictly to pre-adoption events. The decision log stays real-time; `history.md` never fabricates a clock time.
- **Retrospective work is retrofit, never planned.** A results bundle backfilled under a retrospective plan is `provenance: retrofit` (the plan links it via `planVersion` without claiming to have governed it). Stamping `planned` is the results-layer version of undeclared retrospection — and it is permanent.
- **The master plan stays light.** One line of outcome per component; detail lives in execution plans and the log. Do not let sync bloat it.
- **The plan is not a preregistration — it is a contract with a built-in amendment process.** A recorded revision is an amendment: legitimate, expected. A silent deviation is a breach. Preregistration freezes the contract; this workflow keeps it amendable and treats only undisclosed change as deviation.
- **Researcher signs.** Every execution plan version ends with a sign-off line. Jointly produced, but committed by the researcher.
- **Native plan mode.** If the researcher uses Claude Code's plan mode anyway, copy the approved plan into the component's next version slot so the repo record stays complete.
- **Commits.** After plan versions, log milestones, or tracker changes, suggest a short commit (e.g., `plan: 02-analysis v2 — switched to multilevel after ICC check`). Do not commit without the researcher's go-ahead.

## Quick reference

| Artifact | Path | Rule |
|----------|------|------|
| Master plan | `plans/master-plan.md` | Tracker + context; one-line outcomes |
| Execution plans | `plans/execution/<NN-slug>/vN.md` | One component each; versions immutable |
| Decision log | `plans/decision-log.md` | Append-only, timestamped, real-time |
| Reconstructed history | `plans/history.md` | Pre-adoption record; date-granularity, evidence-cited; not the log |
| Drafts | `plans/execution/<NN-slug>/.draft-vN.md` | Unsigned, mutable, gitignored; deleted on sign-off |
| Results bundles | `plans/execution/<NN-slug>/results/rN/` | Immutable once finalized; verdict.json written once |
| Results staging | `plans/execution/<NN-slug>/results/.staging-*/` | Mutable, gitignored; finalized via results.py |
| Saved reviews | `plans/reviews/<NN-slug>-vN.md` | Rubric scorecards; prose and JSON fence agree |
| Board snapshot | `plans/board.html` | Read-only export; regenerate, never hand-edit |

| Command | Purpose |
|---------|---------|
| `/research-plans:init` | Opt a project in (creates the artifacts) |
| `/research-plans:adopt` | Retrospectively decompose done work into components with retrospective plans; reconstruct pre-adoption history |
| `/research-plans:plan` | Scope next component, author its execution plan |
| `/research-plans:sync` | Post-execution checkpoint: tracker, log, revisions |
| `/research-plans:results` | Capture a results bundle (report, artifacts, scripts, metrics); no argument = reconcile/backfill walk; `--adopt` for pre-existing outputs |
| `/research-plans:review` | Two-stage review per `references/plan-rubric.md`: threshold verdict (is it a plan?), then engagement grade |
| `/research-plans:board` | Browser board: tracker (with drift flags), plans + diffs, timeline, scorecards; live annotation or static export |

Judgment criteria live in `references/`: `plan-rubric.md` (quality scoring), `split-criteria.md` (when a plan is too big), `explore-before-planning.md` (bounded data exploration before authoring).

## Common mistakes

- **Backfilling the log** to look thorough. A reconstructed log is worse than a sparse one.
- **Editing an existing version** "to fix a typo." Versions are evidence; new version or nothing.
- **Deciding for the researcher** because the choice seems obvious. Obvious choices are cheap to confirm and expensive to unwind.
- **Updating the tracker without evidence.** Status changes follow artifacts (outputs, commits), not optimism.
- **Letting exploration become analysis.** Bounded exploration informs a plan; results worth keeping belong under a signed plan.
- **Padding a results bundle.** Zero qualifying artifacts is a legitimate capture outcome; report it and stop. Never guess a producing script — `producedBy: null` beats a fabricated provenance.
- **Editing a finalized bundle** to "fix" a figure. The fix is a re-run captured as the next `rN`; what the researcher verified stays verifiable.
