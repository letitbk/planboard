## Verdict

The plan is not executable as written. It has one P0 blocker, five material gaps, and several minor contract issues. No tracked files were modified.

## P0 blocker

1. [Correctness] Task 2 assumes a false `shareHash` behavior.

[Task 2](/Users/bk/github/research-plans/docs/plans/2026-07-18-output-validation.md:373) expects adding or regenerating `publishedReport` to leave `shareHash` unchanged, with no production change. The backend includes `publishedReport` in `payload_files()` at [board.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:217), and `collect_payload()` hashes those files at [board.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:825). The existing `TestShareHash` also pins the report’s inclusion at [test_board.py](/Users/bk/github/research-plans/tests/test_board.py:319).

The repository fixture produced:

- Before report: `d96bac7c5290570b`
- After adding report: `f64be21c8ee747d8`
- After editing report: `dc7c549a678c4eba`

Evidence: [share-hash probe](/Users/bk/github/research-plans/logs/2026-07-18_share-hash-probe.log).

Suggested fix: add a production task that excludes `publishedReport` only from the inputs used for `shareHash`. Do not remove it from the payload or `payload_files()`, since exports still need it. Alternatively, revise the spec to accept report-driven board staleness.

## P1 material findings

2. [Correctness] `_integrity_channel` does not meet the required `basis` contract.

The score arithmetic is correct, but the explanation is not. The spec requires a count and first item when several checks share the worst result, and its example includes the failing check’s detail at [spec](/Users/bk/github/research-plans/docs/specs/2026-07-18-output-validation-reviewers-planning-design.md:51). The proposed code returns only check names at [plan](/Users/bk/github/research-plans/docs/plans/2026-07-18-output-validation.md:284).

For two failing `checksums` entries, it returns:

```text
failed: checksums, checksums
```

For `findings-sourced`, it returns no detail:

```text
failed: findings-sourced
```

Update the function and add duplicate-check and detail assertions.

3. [Spec coverage] Task 6 omits the command prose required by rev 3.

The spec explicitly names `commands/board.md`, `commands/results.md`, and `commands/report.md` at [spec](/Users/bk/github/research-plans/docs/specs/2026-07-18-output-validation-reviewers-planning-design.md:29). Task 6 neither lists nor stages those files at [plan](/Users/bk/github/research-plans/docs/plans/2026-07-18-output-validation.md:865).

Current definite leftovers include:

- [commands/results.md](/Users/bk/github/research-plans/commands/results.md:21): “Result tab”
- [commands/report.md](/Users/bk/github/research-plans/commands/report.md:11): “Result tab”

The proposed sweep searches only `Results tab|Results view`, so it misses the singular form. Add the three command files to Task 6 and its commit.

4. [Spec coverage] Several required tests and the TypeScript check have no executable step.

- Rev 3 requires hosted delivery coverage. Task 2 tests live payload, static export, and focused remote delivery, but not hosted output. `TestCollaboratorFacingPayload` exists at [test_board.py](/Users/bk/github/research-plans/tests/test_board.py:369), so this is easy to add.
- Rev 3 requires the tab label and both Output column headers to be pinned. The proposed test checks only `TABS` at [plan](/Users/bk/github/research-plans/docs/plans/2026-07-18-output-validation.md:876).
- Rev 3 requires `tsc`. Task 12 runs Python, Vitest, and a template grep, but never TypeScript at [plan](/Users/bk/github/research-plans/docs/plans/2026-07-18-output-validation.md:1405). `npm run build` is only Vite plus copy at [package.json](/Users/bk/github/research-plans/board/package.json:7), so it is not a substitute.
- Task 1 does not test every promised edge row. Missing cases include non-list arrays, missing or empty integrity checks, duplicate check names, and `validation.status: unverifiable` with usable arrays.
- Task 4 has no integrated Results test proving absent or malformed scores render nothing, and it does not exercise the chip hover title.

Add explicit tests and `./node_modules/.bin/tsc -b`, followed by removal of `tsconfig.tsbuildinfo`.

5. [Executability] The plan makes an optional external plugin mandatory.

The first instruction requires `superpowers:subagent-driven-development` or `superpowers:executing-plans` at [plan](/Users/bk/github/research-plans/docs/plans/2026-07-18-output-validation.md:3). Rev 3 says external process skills are optional and cannot be dependencies at [spec](/Users/bk/github/research-plans/docs/specs/2026-07-18-output-validation-reviewers-planning-design.md:131).

A fresh engineer without superpowers cannot follow the plan literally. Make that line optional or remove it.

6. [Test realism] Task 5’s Archive fixture instruction is not satisfiable as stated.

The plan says to “extend a fixture bundle’s manifest” in the existing Archive test at [plan](/Users/bk/github/research-plans/docs/plans/2026-07-18-output-validation.md:781). The only Archive test is [Archive.outline.test.tsx](/Users/bk/github/research-plans/board/src/views/Archive.outline.test.tsx:1). Its `executionPlans` array is empty, and its archived component has no plan link, so it has no result bundle to extend.

Create `Archive.score.test.tsx`, or explicitly instruct the engineer to add a linked execution group and result bundle to `Archive.outline.test.tsx`.

## P2 minor findings

7. [Correctness] `coerceOutputScore` accepts values that do not satisfy its declared return type.

All 12 stated Task 3 cases pass and the snippet type-checks. However, the guard accepts:

- Missing or wrong `schemaVersion`
- Missing channel names
- Non-string `basis`
- Unchecked `computedAt`

It then casts the raw value to `OutputScore` at [plan](/Users/bk/github/research-plans/docs/plans/2026-07-18-output-validation.md:561). This can produce blank labels or unsafe React values from a malformed manifest. Evidence: [TypeScript probe](/Users/bk/github/research-plans/logs/2026-07-18_output-score-ts-probe.log).

Validate `schemaVersion === 1`, exact channel names, string basis, and optional string `computedAt`.

8. [Correctness] The Results splice uses block presence instead of target-section presence.

The proposed prop is:

```tsx
sections={{ validation: !!m?.validation, integrity: !!m?.integrity }}
```

But the `results-integrity` target is rendered whenever `m` exists, including the “not recorded” state, at [Results.tsx](/Users/bk/github/research-plans/board/src/views/Results.tsx:600). Since a displayed score already implies `m`, the integrity target exists even when `m.integrity` does not. Pass `integrity: !!m` if the contract is truly “link when target section exists.”

The other splice points are correct:

- Results early return, `m`/`badge`, and banner: [Results.tsx](/Users/bk/github/research-plans/board/src/views/Results.tsx:362)
- Tracker result cell: [Tracker.tsx](/Users/bk/github/research-plans/board/src/views/Tracker.tsx:539)
- Archive result cell: [Archive.tsx](/Users/bk/github/research-plans/board/src/views/Archive.tsx:211)

9. [Spec coverage] Task 9 shortens the required blocker definition.

Rev 3 defines `[blocker]` as invalidating the work and requiring resolution before acting at [spec](/Users/bk/github/research-plans/docs/specs/2026-07-18-output-validation-reviewers-planning-design.md:96). The shared external-review contract omits the “must be resolved” part at [plan](/Users/bk/github/research-plans/docs/plans/2026-07-18-output-validation.md:1204). Use the same complete definition in both places.

10. [Executability] Update-mode `logs/` handling remains ambiguous.

Current update mode says “Skip steps 3–5” at [init.md](/Users/bk/github/research-plans/commands/init.md:14). Task 10 puts the detailed `.gitignore` operation in step 5 and adds only an update-mode offer pointing back to that skipped step. Make the command say explicitly that an accepted update-mode offer performs the append before skipping steps 3 to 5, or move the operation to a shared step.

11. [Correctness] The proposed doctrine claims `/adopt` references it, but no task wires `/adopt`.

The verbatim opening says it is referenced by `/plan` and `/adopt` at [plan](/Users/bk/github/research-plans/docs/plans/2026-07-18-output-validation.md:1305). Task 11 changes only `plan.md`. Remove `/adopt` from that sentence or add the missing command change.

## Verified code and test idioms

- `compute_score`, `_verdict_channel`, and `_integrity_channel` passed all 28 assertions represented by Task 1’s matrix. Evidence: [Python probe](/Users/bk/github/research-plans/logs/2026-07-18_output-score-python-probe.log).
- `coerceOutputScore` passed all 12 Task 3 accept/reject cases and compiled under TypeScript 5.9.3.
- The proposed `cmd_check` passed fresh generation, template drift, profile drift, removed row, and user-owned-file cases. `parse_profile(text)` returns two values at [models.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/models.py:113), `DEFAULT_PROFILE` exists at [test_models.py](/Users/bk/github/research-plans/tests/test_models.py:19), and the exact row is “plan review (verdict + grade)” at [model-profile.md](/Users/bk/github/research-plans/skills/managing-research-plans/templates/model-profile.md:12). Evidence: [cmd_check probe](/Users/bk/github/research-plans/logs/2026-07-18_cmd-check-probe.log).
- Task 1’s helpers exist: `make_project`, `run_cli`, and `manifest_for` at [test_results.py](/Users/bk/github/research-plans/tests/test_results.py:23), plus the finalize fixture at [test_results.py](/Users/bk/github/research-plans/tests/test_results.py:643).
- Task 2’s named classes exist: `TestResultsPayload` and `TestExportResults` at [test_board.py](/Users/bk/github/research-plans/tests/test_board.py:571). The focused-share idiom is `TestRemotePayload.test_focused_remote_payload_prunes` at [test_board.py](/Users/bk/github/research-plans/tests/test_board.py:411).
- Task 3’s `resultsBundle` and result-hash fixture exist at [hostedComments.test.ts](/Users/bk/github/research-plans/board/src/lib/hostedComments.test.ts:58) and [hostedComments.test.ts](/Users/bk/github/research-plans/board/src/lib/hostedComments.test.ts:156).
- Task 4’s cited harness exists at [Results.integrity.test.tsx](/Users/bk/github/research-plans/board/src/views/Results.integrity.test.tsx:9).
- The best Tracker fixture is [Tracker.state.test.tsx](/Users/bk/github/research-plans/board/src/views/Tracker.state.test.tsx:14). It already has a typed manifest-bearing result bundle.
- All current `App.*.test.tsx` files use the jsdom pragma. Their shared `matchMedia` and `scrollIntoView` setup is visible at [App.route.test.tsx](/Users/bk/github/research-plans/board/src/App.route.test.tsx:1).

## Open questions

1. Should report regeneration stop changing whole-board `shareHash`, as rev 3 says, or is current remote-board staleness intentional?
2. Should the implementation plan require superpowers, despite rev 3 making external skills optional?
3. Should `coerceOutputScore` validate the full sealed schema or only the fields needed to display the score?