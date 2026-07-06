---
description: Capture a versioned results bundle for a component — report, figures/tables, key numbers, and script snapshots; no argument reconciles all components needing capture; --adopt brings in pre-existing artifacts
argument-hint: [component name/number | --adopt | (none = reconcile all)]
allowed-tools: Read, Write, Edit, Glob, Grep, AskUserQuestion, Bash(python3:*), Bash(git:*), Bash(ls:*), Bash(date:*)
---

Capture results for review on the board. Skill context: `${CLAUDE_PLUGIN_ROOT}/skills/managing-research-plans/SKILL.md`. Mechanics script: `${CLAUDE_PLUGIN_ROOT}/skills/managing-research-plans/scripts/results.py` (python3 only). Requires an initialized project (`plans/master-plan.md` with its marker); if absent, say so and stop.

A bundle is immutable once finalized. It records what the analysis produced (report.md), the exact files (artifacts/, sha256-verified), the code that produced them (scripts/), and the key numbers (manifest metrics). Verdicts happen later, on the board — never here.

1. **Resolve the mode.** `$ARGUMENTS` names a component (name or number, via the master plan tracker) → single capture, step 2. `--adopt` → step 7. **No argument → reconcile mode, step 8.**

2. **Gather candidates.** Run `python3 <script> discover` and cross-reference: (a) this session's context — what was just produced; (b) the component's latest plan `Verification` section — what outputs the plan promised; (c) when session context is thin (mid-session or fresh session), name-and-history heuristics: output filenames sharing tokens with the component slug or number (`02_clean.R` → `02-data-cleaning`), and `git log` on candidate scripts around the component's execution window. Propose; the researcher confirms. Zero qualifying artifacts is a legitimate answer — report it honestly and stop; never pad a bundle.

3. **Interview.** Ask the researcher which artifacts belong in the bundle (multi-select), then for each: title, one-line caption, and the producing script if you cannot identify it from session context. Ask which key numbers to surface as metrics (label + value + optional note). Never guess a producing script — record `producedBy: null` if unknown.

4. **Stage.** Run `python3 <script> stage --component <NN-slug>` → staging dir. Copy artifacts: `python3 <script> copy --staging <dir> --into artifacts <paths...>`; copy scripts likewise with `--into scripts`. The copy output gives you sha256/bytes/oversized for the manifest.

5. **Write report.md and manifest.json into the staging dir.** report.md is brief and must be self-explanatory to a reader who has not seen the session: open with a one-to-two-line **Data & method** note (dataset and N, method in a phrase, producing script) — enough context to read the figures cold, no more (the board separately shows plan goal and source paths, so do not repeat those). Then: what ran, what came out, how it meets or misses the plan's success criteria, anomalies worth the researcher's eyes; cite artifacts by id. manifest.json fields: `schemaVersion` 1, `component`, `resultsVersion` (finalize renumbers), `planVersion` = latest signed vN (null if none), `provenance` "planned", `trigger` "initial" | "redo-after-review" (when acting on board feedback) | "plan-revision" (first capture after a new plan version), `capturedAt` via `date +"%Y-%m-%d %H:%M"`, `summary`, `metrics`, `artifacts` (id/kind/title/caption/file/source/producedBy exactly as the copy output reported; kind is figure | table | other). **Late captures:** when this session has no evidence of the run that produced the artifacts (backfill of work executed earlier), add `"late": true` and say so in the report — the script snapshots show the code as it is *now*, which may have drifted since the run. The honesty rule is the decision log's: late capture is fine, unlabeled late capture is not.

6. **Finalize and verify on disk.** Run `python3 <script> finalize --staging <dir>`. On validation failure, fix the staged files and retry. On success, verify the printed `rN` path exists on disk before reporting. Then offer the board: `/research-plans:board <NN-slug>:r<N>` opens directly on the bundle for review and verdict. Suggest a commit like `plans: results — <NN-slug> r<N> captured` (do not run without approval).

7. **Adopt mode (--adopt).** For pre-existing figures/tables made before or outside any plan. Run discover, present the candidates grouped by directory, and interview: which artifacts matter, and which component each belongs to — offer to add a tracker row for work that has no component yet (status from evidence, notes say "retrofit"). Then per component follow steps 4-6 with `provenance` "retrofit" and `planVersion` = latest signed version or null. Retrofit bundles review and verdict identically; the provenance chip keeps the record honest.

8. **Reconcile mode (no argument).** Component-first backfill for a project whose plans ran ahead of its results record. Build the worklist from the tracker and disk:
   - components `done` or `done (verified)` or `in progress` whose `plans/execution/<NN-slug>/results/` has no `r*/` bundle;
   - components whose latest bundle has drifted sources (`python3 <script> changed --component <NN-slug>`);
   - leftover `results/.staging-*` dirs (interrupted captures — offer to resume or discard).

   Present the worklist and let the researcher choose: walk all, pick some, or skip. Then per component, one at a time in tracker order, run steps 2-6 — with the routing rule: a signed plan governed the work → `provenance` "planned" + `late: true` (backfill); no plan ever governed it → treat as adopt (`provenance` "retrofit"). A component with nothing qualifying gets reported as such (and, if the researcher agrees, a one-line tracker note) — never an empty bundle. Finish by offering one board session for a verdict pass over everything captured. Never capture all components silently in bulk: the per-component interview is the verification; skipping it is how plan theater starts.

9. **Log.** Append a decision-log entry (real timestamp) recording what was captured and why, per the standard format.
