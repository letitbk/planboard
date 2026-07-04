---
description: Capture a versioned results bundle for a component — report, figures/tables, key numbers, and script snapshots — or adopt pre-existing artifacts (--adopt)
argument-hint: [component name/number | --adopt]
allowed-tools: Read, Write, Edit, Glob, Grep, AskUserQuestion, Bash(python3:*), Bash(git:*), Bash(ls:*), Bash(date:*)
---

Capture results for review on the board. Skill context: `${CLAUDE_PLUGIN_ROOT}/skills/managing-research-plans/SKILL.md`. Mechanics script: `${CLAUDE_PLUGIN_ROOT}/skills/managing-research-plans/scripts/results.py` (python3 only). Requires an initialized project (`plans/master-plan.md` with its marker); if absent, say so and stop.

A bundle is immutable once finalized. It records what the analysis produced (report.md), the exact files (artifacts/, sha256-verified), the code that produced them (scripts/), and the key numbers (manifest metrics). Verdicts happen later, on the board — never here.

1. **Resolve the component.** From `$ARGUMENTS` (name or number) via the master plan tracker. With `--adopt`, skip to step 7.

2. **Gather candidates.** Run `python3 <script> discover` and cross-reference: (a) this session's context — what was just produced; (b) the component's latest plan `Verification` section — what outputs the plan promised. Zero qualifying artifacts is a legitimate answer — report it honestly and stop; never pad a bundle.

3. **Interview.** Ask the researcher which artifacts belong in the bundle (multi-select), then for each: title, one-line caption, and the producing script if you cannot identify it from session context. Ask which key numbers to surface as metrics (label + value + optional note). Never guess a producing script — record `producedBy: null` if unknown.

4. **Stage.** Run `python3 <script> stage --component <NN-slug>` → staging dir. Copy artifacts: `python3 <script> copy --staging <dir> --into artifacts <paths...>`; copy scripts likewise with `--into scripts`. The copy output gives you sha256/bytes/oversized for the manifest.

5. **Write report.md and manifest.json into the staging dir.** report.md is brief and must be self-explanatory to a reader who has not seen the session: open with a one-to-two-line **Data & method** note (dataset and N, method in a phrase, producing script) — enough context to read the figures cold, no more (the board separately shows plan goal and source paths, so do not repeat those). Then: what ran, what came out, how it meets or misses the plan's success criteria, anomalies worth the researcher's eyes; cite artifacts by id. manifest.json fields: `schemaVersion` 1, `component`, `resultsVersion` (finalize renumbers), `planVersion` = latest signed vN (null if none), `provenance` "planned", `trigger` "initial" | "redo-after-review" (when acting on board feedback) | "plan-revision" (first capture after a new plan version), `capturedAt` via `date +"%Y-%m-%d %H:%M"`, `summary`, `metrics`, `artifacts` (id/kind/title/caption/file/source/producedBy exactly as the copy output reported; kind is figure | table | other).

6. **Finalize and verify on disk.** Run `python3 <script> finalize --staging <dir>`. On validation failure, fix the staged files and retry. On success, verify the printed `rN` path exists on disk before reporting. Then offer the board: `/research-plans:board <NN-slug>:r<N>` opens directly on the bundle for review and verdict. Suggest a commit like `plans: results — <NN-slug> r<N> captured` (do not run without approval).

7. **Adopt mode (--adopt).** For pre-existing figures/tables made before or outside any plan. Run discover, present the candidates grouped by directory, and interview: which artifacts matter, and which component each belongs to — offer to add a tracker row for work that has no component yet (status from evidence, notes say "retrofit"). Then per component follow steps 4-6 with `provenance` "retrofit" and `planVersion` = latest signed version or null. Retrofit bundles review and verdict identically; the provenance chip keeps the record honest.

8. **Log.** Append a decision-log entry (real timestamp) recording what was captured and why, per the standard format.
