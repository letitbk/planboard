Overall, the design is feasible, but it is not ready to implement as written. One security boundary is incomplete, and several cross-mode contracts need more detail.

## 1. Findings ordered by severity

### Blocker

1. Hosted report comments can retain a forged `reopen` action key.

`ACTION_KEYS` includes `reopen`, and hand-delivered files strip action keys from both the top level and nested annotations. However, `_neutralized_annotation` strips only `verdict`, `reviewRequest`, `reportRequest`, and `signoff`. Hosted validation also permits arbitrary extra annotation fields. Hosted pull then assembles the annotations directly without passing them through `strip_action_keys_from_document`.

Evidence:

- [`ACTION_KEYS` includes `reopen`](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1582)
- [Hand-delivered ingress strips nested action keys](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1601)
- [`_neutralized_annotation` omits `reopen`](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1677)
- [Hosted validation accepts extra annotation fields](/Users/bk/github/research-plans/skills/managing-research-plans/assets/web-template/lib/validate.ts:36)
- [Pull passes annotations straight to the hosted assembler](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1257)

I confirmed that a nested `reopen` object survives into the pulled JSON fence. The command instructions say hosted actions have no authority, which reduces the risk, but the mechanical boundary is still inconsistent. The repository already treats nested action keys as forgery candidates elsewhere.

Fix this before adding the new view. `_neutralized_annotation` should remove every key in `ACTION_KEYS`, preferably by using that constant instead of another hand-maintained tuple.

### Major

2. The spec omits the committed board template rebuild.

`board.py` does not run the React source. It serves the committed `board-template.html`. The build command copies the Vite output into that file, and hosted publication uses the same template.

Evidence:

- [`board.py` loads the committed template](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:543)
- [`npm run build` copies the output into that template](/Users/bk/github/research-plans/board/package.json:9)
- [Hosted publication writes an index from the same template](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1104)

Without an explicit `npm run build` step and committing `skills/managing-research-plans/assets/board-template.html`, none of the React changes will appear in live, share, export, Pages, or hosted modes.

3. The focus and navigation design does not carry enough state to select a report bundle.

Current `split_focus` returns only `(slug, resultsVersion)`. Today, `01-x:r2:reports` is interpreted as the literal slug `01-x:r2:reports`, with no bundle number. Every caller assumes the two-value result.

Evidence:

- [Current two-part parser](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:333)
- [Static caller](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1088)
- [Share caller](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1365)
- [Live caller](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:2048)
- [Board data only has `focusResults`](/Users/bk/github/research-plans/board/src/lib/types.ts:7)

The proposed `onOpenReport(slug)` also loses the bundle number. This is especially visible in PlanReader, which renders several bundle buttons under one plan version.

- [PlanReader maps individual bundles](/Users/bk/github/research-plans/board/src/views/PlanReader.tsx:391)
- [But its existing callback passes only the component](/Users/bk/github/research-plans/board/src/views/PlanReader.tsx:399)

Define a separate `focusView` field and make navigation bundle-specific, such as `onOpenReport(slug, resultsVersion)`. Also update:

- `NavTarget["tab"]`, which currently excludes `reports`.
- A Reports `navRequest` prop and bundle-selection effect.
- All `split_focus` callers.
- Tests for live, share, and export focus.
- Collection logic so `meta.focus` remains the plain slug for remote hash recomputation.

4. Hosted pull discards the per-document staleness information.

The browser stores `docHash` and can classify report comments as current or outdated. During pull, Python throws away `docHash`, passes only the annotation to the assembler, and uses the last comment's `shareHash` for the whole author and device group.

Evidence:

- [Stored comments carry `docHash`](/Users/bk/github/research-plans/board/src/lib/types.ts:441)
- [The browser uses it for staleness](/Users/bk/github/research-plans/board/src/lib/hostedComments.ts:45)
- [Pull discards it when assembling](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1257)
- [The group uses one comment's `shareHash`](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1260)
- [Blob listing does not establish a meaningful report-version order](/Users/bk/github/research-plans/skills/managing-research-plans/assets/web-template/lib/blobstore.ts:20)

Thus a report comment can appear “outdated” in the hosted board but lose that status when the researcher runs `--pull`. The spec needs a pull-side contract that preserves or recomputes per-comment staleness.

5. Planless retrofit bundles cannot follow the proposed report contract.

The repository explicitly supports bundles whose `planVersion` is null. The report command currently assumes a governing `vN.md`, a “plan vN” header, and plan goal/context. The proposed marker also permits only `plan=v<N>`.

Evidence:

- [`planVersion` is nullable](/Users/bk/github/research-plans/board/src/lib/types.ts:80)
- [The Python tests cover a results-only component with no plan](/Users/bk/github/research-plans/tests/test_board.py:511)
- [`report.md` assumes a governing plan](/Users/bk/github/research-plans/commands/report.md:9)
- [Its header requires “plan vN”](/Users/bk/github/research-plans/commands/report.md:11)

Define the planless report shape. For example, use “No governing plan,” take background from the tracker and capture note, omit the plan goal, and encode `plan=null` in the marker.

Malformed manifests need a related state. The Reports empty state should not expose a Generate report button that submits an order the command cannot complete.

6. A malformed marker can hide the entire rendered report.

A well-formed HTML comment is hidden correctly. `Markdown.tsx` removes any HTML token whose trimmed text begins with `<!--`.

Evidence:

- [Marked renderer configuration](/Users/bk/github/research-plans/board/src/components/Markdown.tsx:20)
- [Comment stripping](/Users/bk/github/research-plans/board/src/components/Markdown.tsx:24)
- [Repository uses Marked 15](/Users/bk/github/research-plans/board/package.json:14)

I verified locally that the proposed well-formed marker is hidden. I also verified that a missing closing `-->` causes Marked to treat the rest of the document as the comment token, after which the renderer removes the whole report. This contradicts the spec's claim that malformed markers never break rendering.

The client should remove the first marker line before passing the body to `Markdown`. If the first line starts with the report marker prefix but is malformed, remove only that line, show the soft warning, and render the remaining document.

The marker grammar also needs tightening:

- Use JSON rather than whitespace-separated fields.
- Use an ISO timestamp without spaces.
- Support `plan: null`.
- Validate `component`, `bundle`, and `plan`, not only `verdict`.
- Treat an identity mismatch as a wrong-file warning, not merely “unknown vintage.”

7. Several required UI states are incomplete.

The lean Results change will still mishandle summary-only finding bundles. A metric with a `statement` puts the bundle into finding mode, but the “Summary only” state exists only in the non-finding branch.

Evidence:

- [Finding mode includes statement-only metrics](/Users/bk/github/research-plans/board/src/views/Results.tsx:527)
- [Summary-only notice exists only in the fallback branch](/Users/bk/github/research-plans/board/src/views/Results.tsx:683)

The design also needs explicit behavior for:

- Invalid or missing manifests.
- A PDF or DOCX that exists while the Markdown report is missing.
- Report markdown whose marker identifies another bundle.
- Pre-renewal components. Results already shows a quiet badge, while the Reports layout does not mention one.
- Archive rows. Archive currently links only to Results, so pre-renewal reports have no direct link from their archived tracker row.
- A later component bundle with a missing report when several later bundles exist.
- A stale report that already exists. The spec implies a Generate report remedy but describes the button explicitly only for missing reports.

8. Command ownership and ordering remain ambiguous.

`results.md` opens the board in step 7, but its capture log is step 10. A persistent board session can therefore start before the new report-generation entry is written.

- [Board opens during results step 7](/Users/bk/github/research-plans/commands/results.md:23)
- [Capture logging is later](/Users/bk/github/research-plans/commands/results.md:34)

The report round trip also has competing owners:

- [`report.md` offers to reopen](/Users/bk/github/research-plans/commands/report.md:24)
- [`board.md` requires a relaunch and mentions acknowledgment](/Users/bk/github/research-plans/commands/board.md:56)
- [The next bullet again requires exactly one acknowledgment](/Users/bk/github/research-plans/commands/board.md:57)

Make the caller own reopening. When called from `results`, results opens one board. When called from the board, board relaunches automatically. A standalone report command may offer to open the board. Move the capture and report log entry before the single board open.

### Minor

9. `reportFormats` is outside both hash surfaces.

`payload_files` and `allFiles` hash only file-shaped records. Adding or removing a PDF or DOCX changes `reportFormats` and the visible pointer note, but does not change `shareHash` or `payloadHash`.

Evidence:

- [Python hashes BoardFiles only](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:198)
- [TypeScript does the same](/Users/bk/github/research-plans/board/src/lib/parse.ts:379)

This does not break report content staleness, but a general comment about download availability could remain current after that availability changes. Either include a synthetic format-state record in both hash lists or document that formats do not participate in staleness.

10. The image renderer needs a safe implementation contract.

`Markdown.tsx` currently escapes raw HTML. A custom image renderer that concatenates `href`, title, or alt text into HTML could bypass that policy.

- [Current HTML safety policy](/Users/bk/github/research-plans/board/src/components/Markdown.tsx:5)
- [The existing basename resolver](/Users/bk/github/research-plans/board/src/lib/artifactDisplay.ts:27)

Resolve only against `bundle.assets`, then let Marked's normal image renderer escape the final token. Do not fall back to arbitrary external image URLs. The live download route should also specify an `<a download>` or `Content-Disposition`; otherwise PDFs may open in the tab instead of downloading.

### Nit

11. The numeric anchors are current, with one path correction.

All cited line numbers match HEAD `8a6afc8`, including the Python collection and enforcement blocks, App, parse, feedback, types, hosted comments, navigation, commands, README, QUICKSTART, and SKILL.

The only path error is `Results.tsx`. There is no `board/src/Results.tsx`; the file is [board/src/views/Results.tsx](/Users/bk/github/research-plans/board/src/views/Results.tsx:381). Its cited line numbers are otherwise correct.

## 2. Missing steps or edge cases

- Add `publishedReport` and `reportFormats` to `ResultsBundle`, with an explicit absent shape such as `null` plus two false booleans.
- Add `focusView` to `BoardData`.
- Rebuild and commit `board-template.html`.
- Preserve per-comment `docHash` through hosted pull.
- Strip all `ACTION_KEYS` in hosted assembly.
- Add Report links and pre-renewal badges to Tracker, PlanReader, and Archive.
- Update App's remote-review banner, which currently enumerates views without Reports at [App.tsx:1067](/Users/bk/github/research-plans/board/src/App.tsx:1067).
- Update README's Results and provenance description at [README.md:89](/Users/bk/github/research-plans/README.md:89), not only the three cited README lines.
- Add tests for planless retrofit, invalid manifest, summary-only finding mode, missing Markdown with orphaned formats, malformed marker, marker identity mismatch, and pre-renewal navigation.
- Test the full mode matrix: live, focused share, export, Pages publish, hosted materialization, hosted republish, remote collect, and hosted pull.

## 3. Risks and tradeoffs

- Capture-end generation happens before verdict. Almost every newly generated pending report will become stale as soon as the researcher records the first verdict.
- Hashing the complete marker means regeneration at a new timestamp invalidates hosted report comments even when the visible report body is unchanged.
- `/report` is prompt-driven rather than implemented by a deterministic generator. Marker spelling and section structure therefore depend on the agent following the command exactly.
- Report Markdown adds modest payload size, but there is no size limit. The “tens of KB” estimate is a convention, not an enforced bound.
- The exact-key download map is traversal-safe. No new signoff-gate path or PDF/DOCX payload leak was found. A collaborator report comment also exposes no new local path beyond the repo-relative report path already present in the shared payload.

## 4. Suggested improvements

1. Close the hosted enforcement gap first. Strip every `ACTION_KEYS` entry and retain per-comment stale metadata through pull.
2. Define a three-part focus result: component, bundle, and view. Keep `focus` as the plain slug for share collection.
3. Use a one-line JSON marker with `schemaVersion`, nullable plan, and ISO timestamp. Remove the marker line before Markdown rendering.
4. Make all report navigation callbacks accept the bundle number.
5. Specify the complete state matrix for malformed, planless, summary-only, pre-renewal, and partially generated reports.
6. Move results logging before the board starts and assign reopening to the caller.
7. Add the template rebuild and a mode-matrix integration test to the acceptance criteria.

## 5. Open questions

1. Is a report generated before verdict intentionally expected to become stale after the first review, or should capture-end generation occur after the verdict?
2. What should a planless retrofit report use for its Background and goal section?
3. Should a tracker report chip point to the latest bundle, the latest bundle with a report, or show both states?
4. Should PDF and DOCX availability participate in `shareHash`?
5. Should Archive rows gain direct Reports links for pre-renewal components?