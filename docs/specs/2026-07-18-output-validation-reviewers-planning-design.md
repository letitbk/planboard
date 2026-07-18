# Output & Validation — rename, mechanical output score, reviewer prompt upgrade, planning independence

Date: 2026-07-18 · Status: design approved in session (BK); pending codex review · Release: version-neutral (BK numbers at cut)

## Motivation

Four issues raised together. (1) The board's "Results" tab under-describes what the view is for — it is the surface where output is checked, not just stored. (2) Validation already runs automatically after `/execute` (rp-results-validator per-step/per-criterion verdicts, mechanical integrity checks), but nothing turns that evidence into a glanceable score the way plan scorecards do for plans. (3) The rp-* reviewer prompts are thin — the board reviewer largely restates the plan rubric — while BK's /codex skill demonstrates prompt structure (grounding rules, verification loops, dig-deeper nudges, severity-ordered evidence) that measurably improves review quality. (4) The plugin's planning quality currently leans on BK's personal setup (his global CLAUDE.md discipline plus Claude Code plan-mode habits); a fresh user's `/plan` should carry that discipline without it.

## Decisions (locked in the brainstorm, 2026-07-18)

1. Rename scope: full rename — tab "Output & Validation", short form "Output" in space-tight surfaces, docs updated, internal IDs/tokens unchanged.
2. Score channels: three — Fidelity, Attainment, Integrity (F·A·I), 0–3 each. No judgment channels (a 5-channel agent-scored variant was considered and rejected as scope).
3. Scoring engine: fully mechanical, computed by `results.py` at finalize. No agent involvement, no new agent, no rubric-judgment doc.
4. Score home: sealed `manifest.score` block beside `.validation`/`.integrity`; ScorePanel-style chips in the Output & Validation banner; compact profile in Tracker/Archive rows. Re-scoring = a new bundle version (bundles stay immutable).
5. Gating: none — purely diagnostic. The deviation stop remains the loop's only interruption; bundle-state strings and tracker states unchanged.
6. Reviewer upgrade: all three rp-* agent templates; board reviewer gets the fullest treatment; output contracts, comment cap, scoring rules, and JSON shapes untouched.
7. Severity: text convention (`[blocker]`/`[major]`/`[minor]` prefix, most-severe-first ordering) — no schema or board-UI change. First-class severity field noted as a future extension.
8. Planning independence: new CLAUDE.md rules + `/plan` research-first grounding by default + a new `references/planning-doctrine.md` loaded by `/plan`.

## 1 · Rename "Results" → "Output & Validation"

The visible label and the internal `results` ID are separable: the only ID→label map is the `TABS` array (`board/src/App.tsx:59-66`; render uses `t.label`, the click handler uses `t.id`). Every deep link (`--focus slug:rN` is numeric — `board.py split_focus`), `navTarget` route, localStorage draft key (`scope === "results"`), hosted-share staleness scope, and test keys on the ID. No test asserts the label.

Changes (IDs, tokens, anchors like `results-validation`, and the `results` scope stay untouched):

- `App.tsx:62` — `label: "Output & Validation"` (id stays `"results"`).
- Short form "Output": Tracker column header (`Tracker.tsx:415`), Archive column header (`Archive.tsx:155`), Timeline event-kind chip (`Timeline.tsx:32`), sidebar file-tree group label (`filesTree.ts:80`).
- In-UI prose: `Reports.tsx:305` ("…are on the Output & Validation tab…").
- Docs: `docs/reference.md` — tab enumeration, `## Results` heading → `## Output & Validation` with its TOC anchor updated; `commands/board.md` human-facing prose (backticked `results` scope token kept).
- One new vitest assertion pinning the tab label and the two column headers, so a future regression is caught (labels are currently untested).
- Historical docs (friction log, old specs) are records — not rewritten.

## 2 · Mechanical output score (`manifest.score`)

### Computation

A pure function `compute_score(validation, integrity)` in `results.py`, called in `cmd_finalize` after `validation` and `integrity` are sealed (integrity is computed at finalize today, `results.py:372`; validation was sealed into the staged manifest at capture). Deterministic, no I/O.

Channel derivations (worst verdict wins; anchors provisional, same disclaimer as the plan rubric):

- **Fidelity** — from `validation.steps[].verdict`: all `followed` = 3 · any `amended` and nothing worse = 2 · any `unverifiable` and nothing worse = 1 · any `deviated-unrecorded` or `not-executed` = 0.
- **Attainment** — from `validation.criteria[].verdict`: all `met` = 3 · any `partial` and nothing worse = 2 · any `unverifiable` and nothing worse = 1 · any `not-met` = 0.
- **Integrity** — from `integrity.checks[]` (worst failing check wins): all pass = 3 · `findings-sourced` fail = 2 · `artifact-refs` fail = 1 · `checksums` or `artifacts-present` fail = 0.

Null channels are honest, never fabricated:

- `validation.status` ∈ {`not-applicable`, `skipped`} or the block absent → Fidelity and Attainment are `null` (basis names the reason, e.g. "no plan validation (retrofit)").
- `validation.status: unverifiable` with no `steps`/`criteria` arrays (e.g. invalid validator output) → F/A `null`; when verdict arrays exist, derive normally (an all-`unverifiable` list scores 1 by the rules above).
- An empty `steps` or `criteria` array → that channel `null` (an empty list must not vacuously score 3).
- `integrity` absent (defensive; finalize always seals it today) → Integrity `null`.

### Block shape

```json
{"schemaVersion": 1,
 "channels": [
   {"id": "fidelity",   "name": "Fidelity",   "score": 0-3 | null, "basis": "<one-line derivation>"},
   {"id": "attainment", "name": "Attainment", "score": 0-3 | null, "basis": "<one line>"},
   {"id": "integrity",  "name": "Integrity",  "score": 0-3 | null, "basis": "<one line>"}],
 "profile": "F3·A2·I3" | "F–·A–·I3",
 "total": 0-9 | null, "max": 9,
 "computedAt": "<ISO timestamp>"}
```

`basis` is the derivation in words ("6 of 6 steps followed", "1 criterion partial: effect-size threshold", "findings-sourced failed: finding 'wage gap robust' names no artifact"). `total` is the sum when all three scores are integers, else `null` (never a partial sum against max 9). `profile` renders `–` for null channels. Exactly three channels, fixed order.

### Seams (verified)

- Sealed at finalize into `rN/manifest.json`, immutable like `validation`/`integrity`. Sealed manifest fields are correctly inside the hosted-comment `targetHash` (same class as `validation` — render-derived fields are excluded, sealed fields included); old bundles never gain the field, so no staleness churn.
- Manifest `schemaVersion` stays 1 (the `integrity` block was added the same way in v0.17).
- `board.py collect_results` passes the manifest through verbatim — no server change for display. Implementation must confirm `validate_staged` tolerates an unexpected pre-existing `score` key in a staged manifest (finalize computes fresh and overwrites; staging never legitimately contains one).
- `results.py verdict` / legacy display / bundle-state model untouched.

### Display

- **Banner chips** in the Output & Validation view: `[F3][A2][I3] 8/9` — new `OutputScorePanel.tsx` component (sibling of `ScorePanel.tsx`, reusing its chip color ramp: 0 = red alarm … 3 = green; null = muted `–` chip). Hover = `basis`; click = detail popover with the three-row derivation table, `computedAt`, and links that scroll to the existing `results-validation` / `results-integrity` outline anchors. Renders only when `manifest.score` exists (old bundles show nothing).
- **Tracker and Archive rows**: compact profile text (`F3·A2·I3`) beside the existing bundle-state mark in the Output column. Version-strip buttons unchanged.
- Bundle-state badge (validated / deviations flagged / unvalidated / retrofit) is unchanged and remains the state that keys tracker strings and report markers. The score keys nothing.

### Tests

py: `compute_score` verdict matrix (each anchor, worst-wins, empty-list null, retrofit/skipped null, unverifiable-with-verdicts vs without), finalize seals the block, refinalize determinism. vitest: chips render/hover/click, null-channel display, absent-block renders nothing, Tracker/Archive profile text.

## 3 · Reviewer prompt upgrade (codex-style discipline)

Sources: the structural elements of BK's /codex skill — explicit task + output contract, grounding rules, verification loop, dig-deeper nudge, severity-ordered findings. Adapted per agent; every output contract, the ≤5-comment cap, the five-channel scoring rules, and all JSON shapes stay byte-compatible with the pipelines that parse them.

### `templates/agents/rp-board-reviewer.md` (fullest treatment)

- **Grounding rules**: when the target cites files, artifacts, numbers, or scripts, read the actual repository evidence (the agent has Read/Grep/Glob) before asserting a problem — a comment about a table must have looked at the artifact behind it; state the evidence inside the comment text; label inference explicitly as inference ("likely", "cannot verify from the bundle") rather than asserting it; never invent problems the evidence does not support.
- **Dig-deeper nudge, per scope**: results — silent N drops between steps, join/merge errors, train/test or construction leakage, stale artifacts vs current scripts, internally inconsistent totals across tables; plan — second-order failure modes of the chosen design, empty-state and edge-case handling, steps whose failure is silent; master — sequencing dependencies and components whose outputs later components silently assume.
- **Verification loop**: before returning, re-check each comment — is it material (acting on it changes the work), actionable, and grounded in evidence actually examined? Drop what fails; fewer well-grounded comments beat five padded ones (reinforces the existing cap).
- **Severity**: order comments most-severe-first and prefix each comment text with exactly one of `[blocker]` / `[major]` / `[minor]`.

### `templates/agents/rp-plan-reviewer.md` and `templates/agents/rp-results-validator.md`

Compact grounding + verification-loop additions only: ground every evidence line in text/files actually read (the validator additionally: take the pasted git window as given, never speculate beyond it); before returning, re-verify each score/verdict is anchored to its quoted evidence and each suggested move is actionable. Scoring anchors, verdict enums, and JSON contracts unchanged.

### `commands/board.md` step 5 (all four reviewer paths)

- The **shared output contract** gains the severity convention (ordering + prefix enum) so subagent, panel, codex, and gemini reviewers all follow it; the panel merge step ranks `[blocker]` > `[major]` > `[minor]` before materiality within a tier.
- The dispatch prompt (and the external-reviewer temp prompt file) additionally carries the **target's on-disk path(s)** — plan file, bundle directory, or master plan path — so grounding against real files is possible; today only the pasted content is guaranteed.
- The external-reviewer (codex/gemini) fixed instructions gain the same grounding + verification-loop text.

### Reaching existing projects (template-drift detection)

`models.py cmd_check` (models.py:436-456) currently hints only on profile-checksum mismatch — a template-only change in a plugin release would never be announced, and regenerated projects would keep stale prompts silently. Extend `cmd_check`: for each marked agent file, also render the current template with the on-disk row's model/effort and compare marker-stripped bodies (the `_strip_marker` comparison `generate()` already uses, models.py:413); on drift, print a hint naming `/research-plans:models` → regenerate. Cheap (three small file reads at dispatch points that already run `check`). CHANGELOG notes the regeneration step for existing projects.

## 4 · Planning independence

### `templates/claude-md-section.md` — two new rules (compact; the block is always-on context in research repos)

- **9 · Evidence before claims.** Run substantive analysis with output captured to `logs/` (e.g. `… 2>&1 | tee logs/<date>_<step>.log`; `logs/` stays gitignored). Never report a result — in chat, a results bundle, or a report — without the log, notebook output, or artifact that shows the code actually ran.
- **10 · Assumptions and restraint.** State working assumptions before acting on them; when an instruction has multiple readings, present them rather than picking silently. Keep changes minimal and surgical — nothing beyond what the current plan step needs; don't refactor or "improve" what the plan doesn't touch.

`init.md` additionally appends `logs/` to the project `.gitignore` (create-if-missing, append-if-absent — same pattern the board uses for its bookkeeping ignores), and its update mode's "upgrade the CLAUDE.md section" offer picks the new rules up in existing projects (marker-replacement already handles this).

### `commands/plan.md` — research-first grounding by default

Step 3 changes from an opt-in offer to a default: after resolving the component, ALWAYS run a short bounded read-only grounding pass — repo structure, data presence and rough shape, prior components' outputs, existing scripts touching this component's area — before the authoring dialogue; say what was found in two or three sentences. The researcher can decline ("skip exploration"). Data-facing components still get the deeper `explore-before-planning.md` treatment (that reference is unchanged). Findings feed the Scope decisions table; surprises go to the decision log. Step 4 additionally requires stating the assumption behind each proposed default when presenting options (the existing push-back rule stays).

### New `references/planning-doctrine.md` (~1 page), loaded by `/plan` at start

The authoring standard in one teachable doc, mirroring how `execution-loop.md` serves `/execute`: research-first grounding (plan from the repo's reality, not from memory of it); assumption surfacing (per consequential fork, name what the default assumes); evidence discipline (what "validated" will mean at capture time — success criteria must be checkable against artifacts, connecting rule 9 to the plan's Verification section); simplicity and surgical scope (plan the minimum that answers the question; boundaries name what not to touch); and the revision loop (the review room + sign-off gate are the approval dialog — "keep planning" is Request changes; a signed plan changes only by a new version). `plan.md`'s step list references the doctrine instead of restating it, keeping command prose growth near zero.

### `references/execution-loop.md` — one line

The run step gains: capture long-running analysis output to `logs/` (tee) so rule 9's evidence exists during autopilot.

## Cross-cutting

- One branch/PR; board/src changes end with `cd board && npm run build` + committing the regenerated `assets/board-template.html` (fixes are invisible until the template ships).
- Suites: py (`tests/`), board vitest, tsc; new tests as listed per section; template-contract tests updated for the new CLAUDE.md rules.
- CHANGELOG under `[Unreleased]` (create-once/merge — the section does not exist post-release); version fields untouched until BK numbers the release.
- Token budget: command-body growth is concentrated in `board.md` step 5 and `plan.md` step 3 (small); the doctrine and reviewer-template text loads only when `/plan` runs or an agent is dispatched. The claude-md-section grows by two rules (~5 lines) in every initialized project — kept deliberately compact.

## Out of scope

- First-class severity field through the seed/annotation chain (future extension if the text convention proves useful).
- Agent-judged score channels (reproducibility, claims discipline) — a future 5-channel extension can add them beside F·A·I without changing the sealed-block mechanism.
- Any change to bundle-state strings, tracker states, the deviation stop, or the sign-off gate.

## Revision history

- 2026-07-18 — v1. Brainstormed in session (two AskUserQuestion rounds, all eight decisions BK's); grounded in three exploration reports (rename surface, validation/scoring infrastructure, plan-mode feature inventory) with load-bearing claims re-verified in code (`models.py cmd_check` template-drift gap found this way). Pending: BK spec review, /codex review.
