# Output & Validation — rename, mechanical output score, reviewer prompt upgrade, planning independence

Date: 2026-07-18 · Status: design approved in session (BK); pending codex review · Release: version-neutral (BK numbers at cut)

## Motivation

Four issues raised together. (1) The board's "Results" tab under-describes what the view is for — it is the surface where output is checked, not just stored. (2) Validation already runs automatically after `/execute` (rp-results-validator per-step/per-criterion verdicts, mechanical integrity checks), but nothing turns that evidence into a glanceable score the way plan scorecards do for plans. (3) The rp-* reviewer prompts are thin — the board reviewer largely restates the plan rubric — while BK's /codex skill demonstrates prompt structure (grounding rules, verification loops, dig-deeper nudges, severity-ordered evidence) that measurably improves review quality. (4) The plugin's planning quality currently leans on BK's personal setup (his global CLAUDE.md discipline plus Claude Code plan-mode habits); a fresh user's `/plan` should carry that discipline without it.

## Decisions (locked in the brainstorm, 2026-07-18)

1. Rename scope: full rename — tab "Output & Validation", short form "Output" in space-tight surfaces, docs updated, internal IDs/tokens unchanged.
2. Score channels: three — Fidelity, Attainment, Integrity (F·A·I), 0–3 each. No judgment channels (a 5-channel agent-scored variant was considered and rejected as scope).
3. Scoring engine: mechanical arithmetic computed by `results.py` at finalize — **no additional agent call**. Precisely: the Fidelity/Attainment inputs are the step/criterion verdicts rp-results-validator already produced at capture; the score derives from them deterministically. The UI labels the score "derived from validation verdicts" so it is not mistaken for an independent measurement.
4. Score home: sealed `manifest.score` block beside `.validation`/`.integrity`; ScorePanel-style chips in the Output & Validation banner; compact profile in Tracker/Archive rows. Re-scoring = a new bundle version (bundles stay immutable).
5. Gating: none — purely diagnostic. The deviation stop remains the loop's only interruption; bundle-state strings and tracker states unchanged.
6. Reviewer upgrade: all three rp-* agent templates; board reviewer gets the fullest treatment; output contracts, comment cap, scoring rules, and JSON shapes untouched.
7. Severity: text convention (`[blocker]`/`[major]`/`[minor]` prefix, most-severe-first ordering) — no schema or board-UI change. First-class severity field noted as a future extension.
8. Planning independence: new CLAUDE.md rules + `/plan` research-first grounding by default + a new `references/planning-doctrine.md` loaded by `/plan`.

## 1 · Rename "Results" → "Output & Validation"

The visible label and the internal `results` ID are separable: the only ID→label map is the `TABS` array (`board/src/App.tsx:59-66`; render uses `t.label`, the click handler uses `t.id`). Every deep link (`--focus slug:rN` is numeric — `board.py split_focus`), `navTarget` route, localStorage draft key (`scope === "results"`), hosted-share staleness scope, and test keys on the ID. No test asserts the label.

Changes (IDs, tokens, anchors like `results-validation`, and the `results` scope stay untouched):

- `App.tsx:62` — `label: "Output & Validation"` (id stays `"results"`).
- Short form "Output": Tracker column header (`Tracker.tsx:415`), Archive column header (`Archive.tsx:155`), Timeline event-kind chip (`Timeline.tsx:32`), sidebar file-tree group label (`filesTree.ts:80`). The Timeline filter pluralizes labels by appending `s` (`Timeline.tsx:133`) — with the chip label "Output" the filter reads "Outputs", consistent with its sibling filters ("Decisions", "Reviews") and incidentally fixing today's "Resultss".
- In-UI prose: `Reports.tsx:305` ("…are on the Output & Validation tab…").
- Docs and command prose: `docs/reference.md` — tab enumeration, `## Results` heading → `## Output & Validation` with its TOC anchor updated; `commands/board.md`, `commands/results.md:21`, `commands/report.md:11` human-facing tab references; the README results-figure image caption (`README.md:45`). Backticked `results` scope/ID tokens kept everywhere.
- One new vitest assertion pinning the tab label and the two column headers, so a future regression is caught (labels are currently untested).
- Historical docs (friction log, old specs) are records — not rewritten.

## 2 · Mechanical output score (`manifest.score`)

### Computation

A pure function `compute_score(validation, integrity, now=None)` in `results.py`, called in `cmd_finalize` after `validation` and `integrity` are sealed (integrity is computed at finalize today, `results.py:372`; validation was sealed into the staged manifest at capture). Deterministic given `now` — the timestamp is injected by `cmd_finalize`, the same pattern `compute_integrity` uses for `checkedAt` (`results.py:197`). No I/O. A `score` key already present in a staged manifest (malformed or otherwise) is unconditionally overwritten at finalize — staging never legitimately contains one (probe-confirmed: `validate_staged` tolerates the unknown key).

Channel derivations (worst verdict wins; anchors provisional, same disclaimer as the plan rubric):

- **Fidelity** — from `validation.steps[].verdict`: all `followed` = 3 · any `amended` and nothing worse = 2 · any `unverifiable` and nothing worse = 1 · any `deviated-unrecorded` or `not-executed` = 0.
- **Attainment** — from `validation.criteria[].verdict`: all `met` = 3 · any `partial` and nothing worse = 2 · any `unverifiable` and nothing worse = 1 · any `not-met` = 0.
- **Integrity** — from `integrity.checks[]` (worst failing check wins): all pass = 3 · `findings-sourced` fail = 2 · `artifact-refs` fail = 1 · `checksums` or `artifacts-present` fail = 0.

Null channels are honest, never fabricated — the full edge matrix:

- `validation.status` ∈ {`not-applicable`, `skipped`} → Fidelity and Attainment `null` regardless of any accidentally present verdict arrays (basis names the reason, e.g. "no plan validation (retrofit)").
- `validation` block absent → F/A `null`.
- `validation.status: unverifiable` with no `steps`/`criteria` arrays (e.g. invalid validator output) → F/A `null`; when verdict arrays exist, derive normally (an all-`unverifiable` list scores 1 by the rules above).
- A missing, non-list, or empty `steps` / `criteria` / `checks` value → that channel `null` (an empty list must not vacuously score 3).
- Unknown verdict strings or unknown integrity check names → ignored for ranking, noted in `basis`; duplicate check names → the worst instance wins. Multiple failing integrity checks → the lowest-ranked (worst) failure sets the score.
- `integrity.status` disagreeing with its `checks` → the checks are ground truth for the score; `basis` notes the disagreement. `integrity` absent (defensive; finalize always seals it today) → Integrity `null`.
- When several items share the worst verdict, `basis` gives the count plus the first item ("2 steps deviated-unrecorded, first: 'refit with controls'").

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

- Sealed at finalize into `rN/manifest.json`, immutable like `validation`/`integrity`. The block is inside `shareHash` (which covers `manifestRaw`, `board.py:201`) and inside the hosted-comment result `targetHash` (which excludes exactly two fields, `publishedReport` and `reportFormats` — `hostedComments.ts:35`); this is correct for a sealed field, and old bundles never gain it, so no staleness churn. Regression tests pin all three facts: `manifest.score` changes `shareHash` and result `targetHash` on new bundles; it appears in static export, focused remote share, and hosted output; regenerating a derived report changes neither.
- Manifest `schemaVersion` stays 1 (the `integrity` block was added the same way in v0.17).
- Board side gets real types and a runtime coercion guard, not blind trust: `OutputScore`/`OutputScoreChannel` types on `ResultsManifest` (`types.ts:148`), plus a `coerceOutputScore` guard (exactly three channels in fixed order, each `score` `null` or an integer 0–3, `profile`/`total`/`max` consistent — else the block is treated as absent). `board.py collect_results` passes the manifest through verbatim — no server change (probe-confirmed: `validate_staged` accepts the unknown key).
- `results.py verdict` / legacy display / bundle-state model untouched.

### Display

- **Banner chips** in the Output & Validation view: `[F3][A2][I3] 8/9` — new `OutputScorePanel.tsx` component, a sibling of `ScorePanel.tsx` sharing one extracted chip color-ramp helper (0 = red alarm … 3 = green; null = muted `–` chip) rather than a copied ramp (`ScorePanel.tsx:17` keeps `chipClass` private today). A `total: null` renders `–/9`, never a partial sum. Hover = `basis`; click = detail popover with the three-row derivation table, `computedAt`, the caption "derived from validation verdicts and integrity checks", and jump links to the `results-validation` / `results-integrity` outline anchors — each link rendered only when its target section is present (both are conditional today, `Results.tsx:601`). Renders only when a coercible `manifest.score` exists (old bundles show nothing).
- **Tracker rows**: compact profile text (`F3·A2·I3`) beside the existing bundle-state mark in the Output column. **Archive rows**: profile beside the `rN` version link alone — Archive renders no bundle-state mark today (`Archive.tsx:211`) and does not gain one. Version-strip buttons unchanged.
- Bundle-state badge (validated / deviations flagged / unvalidated / retrofit) is unchanged and remains the state that keys tracker strings and report markers. The score keys nothing.

### Tests

py: `compute_score` verdict matrix (each anchor, worst-wins, every edge-matrix row above), repeated calls with a fixed injected timestamp are byte-identical (finalize is one-shot — staging moves into immutable `rN`, `results.py:375`, so there is no "refinalize"), finalize overwrites a pre-existing staged `score`, plus the three hash/delivery regression tests from Seams. vitest: `coerceOutputScore` accept/reject cases, chips render/hover/click, null-channel and `–/9` display, absent/malformed block renders nothing, Tracker profile text, Archive profile-beside-version.

## 3 · Reviewer prompt upgrade (codex-style discipline)

Sources: the structural elements of BK's /codex skill — explicit task + output contract, grounding rules, verification loop, dig-deeper nudge, severity-ordered findings. Adapted per agent; every output contract, the ≤5-comment cap, the five-channel scoring rules, and all JSON shapes stay byte-compatible with the pipelines that parse them.

### `templates/agents/rp-board-reviewer.md` (fullest treatment)

- **Grounding rules**: when the target cites files, artifacts, numbers, or scripts, read the actual repository evidence (the agent has Read/Grep/Glob) before asserting a problem — a comment about a table must have looked at the artifact behind it; state the evidence inside the comment text; label inference explicitly as inference ("likely", "cannot verify from the bundle") rather than asserting it; never invent problems the evidence does not support.
- **Dig-deeper nudge, per scope**: results — silent N drops between steps, join/merge errors, train/test or construction leakage, stale artifacts vs current scripts, internally inconsistent totals across tables; plan — second-order failure modes of the chosen design, empty-state and edge-case handling, steps whose failure is silent; master — sequencing dependencies and components whose outputs later components silently assume.
- **Verification loop**: before returning, re-check each comment — is it material (acting on it changes the work), actionable, and grounded in evidence actually examined? Drop what fails; fewer well-grounded comments beat five padded ones (reinforces the existing cap).
- **Severity**: order comments most-severe-first and prefix each comment text with exactly one of `[blocker]` (invalidates a finding or decision — must be resolved before acting on the work) / `[major]` (materially changes the work if acted on) / `[minor]` (worth fixing, not blocking).

### `templates/agents/rp-plan-reviewer.md` and `templates/agents/rp-results-validator.md`

Compact grounding + verification-loop additions only: ground every evidence line in text/files actually read (the validator additionally: take the pasted git window as given, never speculate beyond it); before returning, re-verify each score/verdict is anchored to its quoted evidence and each suggested move is actionable. Scoring anchors, verdict enums, and JSON contracts unchanged.

### `commands/board.md` step 5 (all four reviewer paths — one shared contract, per-reviewer access)

- The **shared output contract** gains the severity convention (the three definitions above + most-severe-first ordering) so every reviewer path follows it. The dispatching session validates the prefix on each returned comment and repairs once (re-prompt) when it is absent or invalid.
- **Panel merge**, in order: deduplicate first (same anchor AND substantively the same point — a duplicate kept at the highest justified severity among its copies), then rank `[blocker]` > `[major]` > `[minor]`, materiality within a tier. Caps stated explicitly: **5 per single reviewer, ~5–7 across the merged panel** (current behavior, now written down — the spec's "cap untouched" means both numbers).
- **Per-reviewer grounding access** (ruled): `subagent`/`panel` ground in the repository via Read/Grep/Glob; `codex` grounds via its read-only repo sandbox (`board.md:45`); **`gemini` stays limited to pasted evidence** — its dispatch is self-contained by design (`board.md:46`), so its grounding rule reads "ground every claim in the supplied material; if the material cannot support a judgment, say so" rather than pretending at repo access.
- The dispatch prompt (and the external-reviewer temp prompt file) additionally carries the **target's on-disk path(s)** — plan file, bundle directory, or master plan path — plus the repository root, for the paths-capable reviewers.
- The codex fixed instructions gain the same grounding + verification-loop text; gemini gets the pasted-evidence variant.

### Reaching existing projects (template-drift detection)

`models.py cmd_check` (models.py:436-456) currently hints only on profile-checksum mismatch — a template-only change in a plugin release would never be announced, and projects would keep stale prompts silently. Extend `cmd_check` to **mirror `generate`'s row resolution** rather than always rendering: for a marked agent file whose profile row exists with `mechanism: agent`, render the current template with that row's model/effort (`_render` already drops the effort line for a null effort, models.py:279) and compare marker-stripped bodies (the `_strip_marker` comparison `generate()` uses, models.py:413); for a marked agent whose row is missing or non-`agent` — which `generate` would remove (models.py:375) — report the pending removal as drift without rendering anything. The hint text becomes generic ("review agents are out of date with the installed plugin or profile — run /research-plans:models and regenerate"), since "model profile changed" (models.py:55) is false for a template-only change. Cheap (three small file reads at dispatch points that already run `check`). CHANGELOG notes the regeneration step for existing projects.

## 4 · Planning independence

### `templates/claude-md-section.md` — two new rules (compact; the block is always-on context in research repos)

- **9 · Evidence before claims.** Run substantive analysis with output captured to `logs/` (e.g. `… 2>&1 | tee logs/<date>_<step>.log`; `logs/` stays gitignored). Never report a result — in chat, a results bundle, or a report — without the log, notebook output, or artifact that shows the code actually ran. Logs are **local, temporary evidence** (ruled): they are not bundle artifacts, are never collected by the board, and are not passed to the validator — the durable evidence a bundle carries is its artifacts and scripts. Never write row-level personal data, credentials, or secrets into a log; gitignore prevents commits, it does not make a log safe.
- **10 · Assumptions and restraint.** State working assumptions before acting on them; when an instruction has multiple readings, present them rather than picking silently. Keep changes minimal and surgical — nothing beyond what the current plan step needs; don't refactor or "improve" what the plan doesn't touch.

`init.md` appends `logs/` to the project `.gitignore` (create-if-missing, append-if-absent) in **both** fresh init and update mode — update mode skips artifact-creation steps 3–5 (`init.md:14`), so the ignore update must live in the shared path or be named in the update-mode offer list, or existing projects would receive rule 9 without ever receiving the ignore. The update mode's "upgrade the CLAUDE.md section" offer picks the new rules up in existing projects. **Marker validation** hardens the replacement: a missing end marker, a stray end marker without a start, reversed markers, or multiple marker pairs → stop and ask the researcher, never guess a replacement range over unrelated CLAUDE.md content (`init.md:31` assumes a well-formed pair today).

### `commands/plan.md` — research-first grounding by default

Step 3 changes from an opt-in offer to a default: after resolving the component, ALWAYS run a short bounded read-only grounding pass — repo structure, data presence and rough shape, prior components' outputs, existing scripts touching this component's area — before the authoring dialogue; say what was found in two or three sentences. **Hard bound**: roughly a dozen files and a few read-only commands (`ls`, `head`, `git log`, quick greps), minutes not tens of minutes; "read-only" permits writing a gitignored evidence log when the deeper data exploration warrants one. The researcher can decline ("skip exploration"). Data-facing components still get the deeper `explore-before-planning.md` treatment (that reference is unchanged). Findings feed the Scope decisions table; surprises go to the decision log. Step 4 additionally requires stating the assumption behind each proposed default when presenting options (the existing push-back rule stays).

### New `references/planning-doctrine.md` (~1 page), loaded by `/plan` at start

The authoring standard in one teachable doc, mirroring how `execution-loop.md` serves `/execute`: research-first grounding (plan from the repo's reality, not from memory of it); assumption surfacing (per consequential fork, name what the default assumes); evidence discipline (what "validated" will mean at capture time — success criteria must be checkable against artifacts, connecting rule 9 to the plan's Verification section); simplicity and surgical scope (plan the minimum that answers the question; boundaries name what not to touch); and the revision loop (the review room + sign-off gate are the approval dialog — "keep planning" is Request changes; a signed plan changes only by a new version). `plan.md`'s step list references the doctrine instead of restating it, keeping command prose growth near zero.

**External-skill posture (ruled 2026-07-18):** the doctrine is owned, never delegated — there is no plugin-dependency mechanism in Claude Code, and external planning skills (e.g. superpowers' writing-plans) produce artifacts the board parser / rubric / sign-off gate cannot consume. The doctrine carries a short compatibility clause: general process skills active in a user's setup (brainstorming, TDD, worktrees) are welcome for the *work*, but the plan documents themselves always follow this plugin's template and rubric contract. Separately, `README.md`/`docs/reference.md` gain a brief "works well with" note (superpowers for TDD/worktree discipline in code-heavy components, plannotator for plan annotation) — suggestions only, never runtime dependencies.

### `references/execution-loop.md` — one line

The run step gains: capture long-running analysis output to `logs/` (tee) so rule 9's evidence exists during autopilot (same local-temporary-evidence status and sensitive-data prohibition as rule 9).

### `SKILL.md` — reference list and score mention

The skill's reference list (`SKILL.md:94`) gains `planning-doctrine.md`; its results-bundle description (`SKILL.md:42`) gains one clause naming the sealed F·A·I score.

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
- 2026-07-18 — v3. BK ruled the external-skill question: planning doctrine stays owned (no runtime dependency on superpowers or other plugins — their plan artifacts violate the board/rubric/gate contract); added the doctrine compatibility clause + a docs "works well with" note. Timeline filter amended: "Outputs" via the existing pluralization (consistent with sibling filters, fixes today's "Resultss") instead of a singular special-case.
- 2026-07-18 — v2. Codex review (sol·xhigh, `docs/specs/2026-07-18-codex-review-output-validation-design.md`: 0 P0, 10 P1, 5 P2) folded in full. Material corrections: "fully mechanical" reframed as no-additional-agent-call (F/A verdicts come from the validator); `compute_score` gains injected `now` and one-shot-finalize test framing; complete edge matrix (unknown/duplicate check names, status-vs-checks disagreement, override arrays under not-applicable/skipped, basis wording); board-side `OutputScore` types + `coerceOutputScore` guard, `–/9` display, conditional jump links; hash claims corrected (only `publishedReport`/`reportFormats` excluded from `targetHash`) + 3 regression tests; severity definitions + validate/repair + dedupe-before-rank + explicit caps (5 single / 5–7 panel); per-reviewer grounding access with Gemini ruled pasted-evidence-only; `cmd_check` mirrors `generate` row resolution + generic hint text; init update-mode gitignore gap + marker validation; logs ruled local temporary evidence + sensitive-data prohibition; grounding-pass hard bound; Timeline filter pluralization; rename sweep additions (README caption, results.md, report.md); Archive profile-beside-version (no new state mark); shared chip color-ramp helper; SKILL.md reference/score mentions. BK ruled the five open questions (computedAt injection, caps as stated, Gemini pasted-only, logs temporary, Archive no mark).
