# Verdict

The design is feasible after material revisions. There are no P0 blockers. The cited label locations, finalize seam, `cmd_check` location, and board rebuild requirement are accurate. I found eight P1 issues.

## P0 blocker

None.

## P1 material

### 1. Feasibility issues

1. `compute_score` cannot be both pure and responsible for a fresh timestamp.

   The spec calls for a deterministic `compute_score(validation, integrity)` while requiring `computedAt`. The current integrity function handles this by accepting an optional time, then consulting the clock when none is supplied ([results.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/results.py:197)). Give `compute_score` an explicit timestamp or set `computedAt` in `cmd_finalize`.

   The proposed "refinalize determinism" test is also unclear. Finalize moves the staging directory into immutable `rN` ([results.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/results.py:375)). Test repeated pure-function calls with a fixed timestamp and test that finalize overwrites a staged `score`. Do not describe finalizing the same bundle twice.

2. Fidelity and Attainment are not independent mechanical observations.

   Their arithmetic is mechanical, but their verdicts come from `rp-results-validator`, an agent that reads the evidence and assigns every step and criterion verdict ([rp-results-validator.md](/Users/bk/github/research-plans/skills/managing-research-plans/templates/agents/rp-results-validator.md:10), [results.md](/Users/bk/github/research-plans/commands/results.md:21)). The accurate claim is "no additional agent call at finalize." The UI should say the score is derived from validation verdicts so it is not mistaken for an independent measurement.

3. The Gemini reviewer cannot meet the proposed grounding contract under the current dispatch instructions.

   The Codex path runs in a read-only repository sandbox ([board.md](/Users/bk/github/research-plans/commands/board.md:45)). The Gemini path explicitly says the prompt is self-contained and needs no repository access ([board.md](/Users/bk/github/research-plans/commands/board.md:46)). Supplying file paths alone does not make those files readable. The spec must either provide Gemini with read-only repository access and a defined working directory, or limit Gemini to pasted evidence.

### 2. Missing steps and edge cases

4. The board score contract needs types and runtime validation.

   `ResultsManifest` has no `score` field or related types ([types.ts](/Users/bk/github/research-plans/board/src/lib/types.ts:148)). `board.py` parses arbitrary manifest JSON without a score schema ([board.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:271)). Add `OutputScore`, channel, and channel-ID types, plus a coercion guard that verifies exactly three ordered channels, scores of `null` or integers from 0 to 3, consistent `profile`, `total`, and `max`.

   Also define the UI for `total: null`. The score must show something such as `–/9`, not a partial sum. Hide the validation or integrity jump link when its target is absent. Those elements are conditionally rendered today ([Results.tsx](/Users/bk/github/research-plans/board/src/views/Results.tsx:601)).

5. The `compute_score` edge matrix is incomplete.

   Add explicit behavior for:

   1. Missing, non-list, or empty `steps`, `criteria`, and integrity `checks`.
   2. Duplicate or unknown integrity check names.
   3. An integrity `status` that disagrees with its checks.
   4. Multiple failing integrity checks, with the lowest rank winning.
   5. Basis text when several items share the worst verdict.
   6. `not-applicable` and `skipped` overriding any accidentally present arrays.
   7. A pre-existing malformed `score`, which finalize must overwrite.

   Fresh `compute_integrity` emits the four expected checks ([results.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/results.py:220)), but `validate_staged` validates verdicts without validating check names or cardinality ([results.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/results.py:326)). Defensive score behavior should therefore be stated.

6. `cmd_check` must mirror `generate`, not always render a row.

   A marked agent whose profile row is missing or whose mechanism is not `agent` is removed by `generate` ([models.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/models.py:375)). `cmd_check` should report regeneration drift in those cases without rendering a new body. Null effort is already handled correctly because `_render` removes the effort line ([models.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/models.py:279)).

   The hint text also needs to become generic. "Model profile changed" is false when only the shipped template changed ([models.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/models.py:55)).

7. The severity and panel cap rules conflict with current behavior.

   A single board reviewer is capped at five comments ([rp-board-reviewer.md](/Users/bk/github/research-plans/skills/managing-research-plans/templates/agents/rp-board-reviewer.md:12)), but the merged panel currently keeps about five to seven ([board.md](/Users/bk/github/research-plans/commands/board.md:47)). The spec's statement that the "`≤5` cap" stays untouched is therefore ambiguous.

   Define severity meanings, validate the prefix, repair once when it is absent or invalid, deduplicate first, then sort by severity and materiality. When duplicate comments assign different severities, retain the highest justified severity.

8. The existing-project planning upgrade has two control-flow gaps.

   Update mode skips artifact creation steps 3 through 5 ([init.md](/Users/bk/github/research-plans/commands/init.md:14)). If root `.gitignore` handling is added there, existing projects will receive rule 9 without receiving `logs/`. Put the ignore update before that skip or add it explicitly to update mode.

   Marker replacement assumes a valid start and end marker ([init.md](/Users/bk/github/research-plans/commands/init.md:31)). Add rules for a missing end marker, a stray end marker, reversed markers, and multiple marker pairs. The safe default is to stop and ask rather than risk replacing unrelated `CLAUDE.md` content.

### 3. Risks and tradeoffs

9. The new log evidence is not connected to validation or the sealed bundle.

   The validator is currently given the plan, staging directory, decision log, and pasted git window, but no execution log paths ([results.md](/Users/bk/github/research-plans/commands/results.md:21)). Board payload collection also includes bundle files, not root `logs/` ([board.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:201)).

   If logs are meant to support validation, pass the relevant paths explicitly. If evidence must remain available after sharing or handoff, copy selected logs into the bundle or attach them as artifacts. Otherwise state that the logs are local, temporary evidence.

10. Logging all output can capture sensitive data.

    This is an inference from the proposed `2>&1 | tee` rule. `/init` already asks for the project's data sensitivity ([init.md](/Users/bk/github/research-plans/commands/init.md:21)). The doctrine should prohibit row-level personal data, credentials, and secrets in logs. Gitignore prevents commits but does not make a log safe.

## P2 minor

1. Two rename assumptions are wrong or incomplete.

   Archive has no existing bundle-state mark beside which to place the score. It renders only `rN` ([Archive.tsx](/Users/bk/github/research-plans/board/src/views/Archive.tsx:211)). Either add `bundleStateMark` there or place the profile beside the version alone.

   Changing the Timeline label to `"Output"` makes the filter say `"Outputs"` because the filter appends `s` ([Timeline.tsx](/Users/bk/github/research-plans/board/src/views/Timeline.tsx:123)). Special-case that filter if the required label is exactly "Output."

   The rename sweep also misses the README image caption ([README.md](/Users/bk/github/research-plans/README.md:45)), `commands/results.md` ([results.md](/Users/bk/github/research-plans/commands/results.md:21)), and `commands/report.md` ([report.md](/Users/bk/github/research-plans/commands/report.md:11)).

2. Hash and delivery behavior is feasible, but it needs explicit regression tests.

   `shareHash` includes `manifestRaw` ([board.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:201)). Result-comment `targetHash` includes the bundle and excludes only `publishedReport` and `reportFormats` ([hostedComments.ts](/Users/bk/github/research-plans/board/src/lib/hostedComments.ts:35)). Static, remote, and hosted rendering all carry the parsed manifest.

   Add tests that `manifest.score`:

   1. Changes `shareHash` and result `targetHash`.
   2. Appears in static export, focused remote share, and hosted output.
   3. Does not change when only a derived report is regenerated.

   The spec's broader statement that render-derived fields are excluded is too strong. Only the two report fields are excluded from `targetHash`.

3. The score color ramp is private.

   `ScorePanel` keeps `chipClass` inside the component ([ScorePanel.tsx](/Users/bk/github/research-plans/board/src/components/ScorePanel.tsx:17)). Extract a small shared helper or export it. Copying the ramp into `OutputScorePanel` creates drift.

4. Add the new doctrine to the skill's reference list and describe the score in the workflow docs.

   The skill currently lists only the rubric, split criteria, and exploration reference ([SKILL.md](/Users/bk/github/research-plans/skills/managing-research-plans/SKILL.md:94)). Its results-bundle description also omits the new score ([SKILL.md](/Users/bk/github/research-plans/skills/managing-research-plans/SKILL.md:42)).

5. Define a hard bound for the default grounding pass.

   Specify a maximum time, number of files, or number of commands. Also clarify that "read-only" permits writing an ignored evidence log when the deeper data exploration is substantive.

## Suggested improvements

1. Write a normative score table before implementation, including timestamp injection, malformed-input behavior, basis wording, and the `total: null` display.
2. Add score types and coercion before building `OutputScorePanel`.
3. Make `cmd_check` reuse the same row resolution and rendering decisions as `generate`.
4. Rewrite board step 5 as one shared reviewer contract with explicit severity validation, panel cap, target paths, repository root, and per-reviewer access.
5. Make root `.gitignore` and marker validation common to both new initialization and update mode.
6. Update all user-facing rename surfaces, run `npm run build`, and commit the regenerated board template. The build script does copy the result into the shipped template ([package.json](/Users/bk/github/research-plans/board/package.json:9)).

## Open questions

1. Should `computedAt` be a timezone-aware finalize timestamp, or reuse `integrity.checkedAt`?
2. Is the final panel cap five, or the current five to seven?
3. Will Gemini receive read-only repository access, or remain limited to pasted evidence?
4. Are execution logs temporary local evidence, or should selected logs become immutable bundle artifacts?
5. Should Archive gain the missing bundle-state mark?

Verification passed: 98 Python tests and 43 targeted board tests. Direct probes confirmed that `validate_staged` accepts an unknown staged `score` key and that changing `manifestRaw` with a score changes `shareHash`. See the [Python baseline](/Users/bk/github/research-plans/logs/2026-07-18_output-validation-python-baseline.log), [board baseline](/Users/bk/github/research-plans/logs/2026-07-18_output-validation-board-baseline.log), and [probe log](/Users/bk/github/research-plans/logs/2026-07-18_output-validation-design-probes.log). No tracked files changed.

Plain-writing revision artifact: [revision-output-validation-review.html](/tmp/revision-output-validation-review.html).