## Overall verdict

Do not execute either plan unchanged. Plan A has two clean-checkout TypeScript failures and a batch-approval trust flaw. Plan B’s contracts mostly line up with A, including the three tracker strings, but its autopilot tail, deviation recovery, and headless behavior need material clarification.

## 1. Factual errors in the plans

1. **Plan A’s verdict-removal sweep is incomplete.** The five `App.tsx` `buildFeedbackMarkdown` call sites are correctly identified at [App.tsx:501](/Users/bk/github/research-plans/board/src/App.tsx:501), [App.tsx:569](/Users/bk/github/research-plans/board/src/App.tsx:569), [App.tsx:667](/Users/bk/github/research-plans/board/src/App.tsx:667), [App.tsx:715](/Users/bk/github/research-plans/board/src/App.tsx:715), and [App.tsx:763](/Users/bk/github/research-plans/board/src/App.tsx:763), and the proposed shifted positions are correct. But Task 2 removes only the top-level fence’s `verdict` field; review and report fences also set it at [App.tsx:579](/Users/bk/github/research-plans/board/src/App.tsx:579) and [App.tsx:677](/Users/bk/github/research-plans/board/src/App.tsx:677). Once `FeedbackMeta.verdict` is deleted from [feedback.ts:24](/Users/bk/github/research-plans/board/src/lib/feedback.ts:24), both object literals become TypeScript errors.

2. **One caller is not swept.** [hostedFeedbackFixture.test.ts:29](/Users/bk/github/research-plans/board/src/lib/hostedFeedbackFixture.test.ts:29) still supplies the old second `null`. It remains semantically harmless under the new signature because it becomes a null review request, but the “every caller” sweep is not complete.

3. **The tracker exhaustiveness inventory missed `Archive.tsx`.** There are exactly two exhaustive `Record<TrackerStatus, string>` maps: [Tracker.tsx:31](/Users/bk/github/research-plans/board/src/views/Tracker.tsx:31) and [Archive.tsx:17](/Users/bk/github/research-plans/board/src/views/Archive.tsx:17). Task 3 updates only the former. Adding the three union members at [types.ts:296](/Users/bk/github/research-plans/board/src/lib/types.ts:296) will break `tsc`.

4. **`ReportMarker` does not “gain” `schemaVersion`.** It already has `schemaVersion: number` at [reportMarker.ts:11](/Users/bk/github/research-plans/board/src/lib/reportMarker.ts:11). Task 4 needs to narrow/version its shape and make `verdict` conditional, not introduce the field.

5. **The Task 3 fixture helper does not exist.** The plan calls `trackerFixtureWithStatus(...)`, but the current tracker-status test is inline at [parse.test.ts:319](/Users/bk/github/research-plans/board/src/lib/parse.test.ts:319). The task must create a helper or keep the new cases inline.

6. **Task 9’s “today these are separate” claim is outdated.** HEAD already has a real live approval POST → ticket/order → actual hook subprocess admission test at [test_board.py:2406](/Users/bk/github/research-plans/tests/test_board.py:2406). The planned test still adds useful ack and second-write immutability coverage, but it should extend that test rather than duplicate the entire chain in a new file.

7. **`[Unreleased]` does not currently exist.** `CHANGELOG.md` starts with 0.19.1 at [CHANGELOG.md:3](/Users/bk/github/research-plans/CHANGELOG.md:3). Both plans need to create one shared section, not independently append duplicate `Added`/`Changed` headings.

A claim that is correct: keeping `verdictRaw` in [parse.ts:453](/Users/bk/github/research-plans/board/src/lib/parse.ts:453) and [board.py:214](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:214) preserves file-payload hashing. Both implementations still hash the legacy file at [parse.ts:471](/Users/bk/github/research-plans/board/src/lib/parse.ts:471) and [board.py:201](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:201). Feedback fence metadata is not part of that file list.

## 2. Design and feasibility issues

### P0

1. **Plan A will not compile as written.** The unremoved `verdict` fence fields and omitted `Archive.tsx` map are both clean-checkout build failures. The existing Results fixtures that pass `onVerdict` also require edits, including [Results.lean.test.tsx:50](/Users/bk/github/research-plans/board/src/views/Results.lean.test.tsx:50), [Results.summary.test.tsx:45](/Users/bk/github/research-plans/board/src/views/Results.summary.test.tsx:45), [Results.navsync.test.tsx:71](/Users/bk/github/research-plans/board/src/views/Results.navsync.test.tsx:71), [Results.outline.test.tsx:41](/Users/bk/github/research-plans/board/src/views/Results.outline.test.tsx:41), [Results.viewer.test.tsx:55](/Users/bk/github/research-plans/board/src/views/Results.viewer.test.tsx:55), and [Results.integrity.test.tsx:45](/Users/bk/github/research-plans/board/src/views/Results.integrity.test.tsx:45). Task 1 says to fix them but its explicit `git add` omits all but the integrity file.

2. **The 409 refresh can authorize text the researcher did not see.** The server creates `html_bytes` once at boot at [board.py:1090](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1090) and re-serves those frozen bytes at [board.py:1214](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1214). Task 10 mutates only the in-memory `entry["content"]`; Task 11’s approval still sends only component/version, matching today’s request at [BatchGate.tsx:55](/Users/bk/github/research-plans/board/src/views/BatchGate.tsx:55).

   Inference: after tab A receives a 409 and updates the server entry, a reloaded tab or already-open tab B still renders the old boot payload but can click Approve. The server sees disk equal to its refreshed in-memory entry and mints a ticket for the unseen content. Because the server is a `ThreadingHTTPServer` at [board.py:892](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:892), two tabs can produce the same failure without any reload.

   Approval must carry a hash of the text actually displayed. The server must compare that client-acknowledged hash with disk inside one lock before writing the ticket. A fresh-entry GET endpoint would also solve the frozen-HTML problem; mutating the boot payload alone does not.

### P1

1. **The bundle-state sweep misses PlanReader.** Results chips still derive their marks exclusively from `b.verdict` at [PlanReader.tsx:386](/Users/bk/github/research-plans/board/src/views/PlanReader.tsx:386) and [PlanReader.tsx:400](/Users/bk/github/research-plans/board/src/views/PlanReader.tsx:400). New conforming verdictless bundles will remain `●`. Extend [PlanReader.reportchip.test.tsx:74](/Users/bk/github/research-plans/board/src/views/PlanReader.reportchip.test.tsx:74) with validation-state cases.

2. **The final doctrine remains internally contradictory.** Reopen markdown still describes an “ACCEPTED bundle” and a future bundle with “its own verdict” at [feedback.ts:92](/Users/bk/github/research-plans/board/src/lib/feedback.ts:92). `report.md` still requires a verdict-state header at [report.md:15](/Users/bk/github/research-plans/commands/report.md:15). `sync.md` still says accepted/verified/verdict pass at [sync.md:32](/Users/bk/github/research-plans/commands/sync.md:32). The on-demand results reference still prescribes the verdict flow and says the interview is the verification at [results-adopt.md:9](/Users/bk/github/research-plans/skills/managing-research-plans/references/results-adopt.md:9) and [results-adopt.md:26](/Users/bk/github/research-plans/skills/managing-research-plans/references/results-adopt.md:26), despite the spec explicitly naming that reference for the S5 sweep at [design spec:136](/Users/bk/github/research-plans/docs/specs/2026-07-16-flow-streamlining-design.md:136). The SKILL marker description also still says verdict at [SKILL.md:42](/Users/bk/github/research-plans/skills/managing-research-plans/SKILL.md:42).

3. **The new tracker statuses are not reconciled with bundle state.** The missing-plan drift check recognizes only old statuses at [Tracker.tsx:213](/Users/bk/github/research-plans/board/src/views/Tracker.tsx:213). More importantly, both current and proposed bundle-consistency logic run only when `r.status === "done"` at [Tracker.tsx:228](/Users/bk/github/research-plans/board/src/views/Tracker.tsx:228). Therefore `done (validated)` can coexist with an unvalidated latest bundle, and `done (unvalidated)` with a conforming one, without warning.

4. **Draft scorecard idempotence is unsafe for mutable drafts and the modal fallback.** Current idempotence is exact-path based at [review.md:15](/Users/bk/github/research-plans/commands/review.md:15). Plan A proposes also skipping a signed review when a same-component/version draft-path card exists. That causes two failures:

   - Revising `.draft-vN.md` and “re-running” review reuses a stale score because the path is unchanged.
   - In the direct-write modal fallback, no board routing migrates the scorecard. The post-signoff signed review sees the draft-path card and skips, leaving the signed plan without a matching card.

   Use a draft content hash or always rescore mutable drafts. For signed fallback, migrate or regenerate and verify an exact signed `planPath` before allowing the review to no-op.

5. **Draft integrity provenance cannot stay correct through signoff and commit.** The reviewer template admits only `uncommitted`, `unsupported-sources`, and `unrecorded-deviation` flag IDs at [rp-plan-reviewer.md:23](/Users/bk/github/research-plans/skills/managing-research-plans/templates/agents/rp-plan-reviewer.md:23); the scorecard template likewise has no applicability state at [review-scorecard.md:5](/Users/bk/github/research-plans/skills/managing-research-plans/templates/review-scorecard.md:5). Plan A introduces “not-yet-applicable” without defining its JSON representation, then migrates the card and no-ops. Plan B commits only afterward, so the integrity state is never refreshed.

6. **The scorecard prose link is not draft-aware.** The template still hardcodes the signed link at [review-scorecard.md:3](/Users/bk/github/research-plans/skills/managing-research-plans/templates/review-scorecard.md:3), while Task 6 changes only JSON examples. A draft card will link to a nonexistent signed file before approval, and the proposed “rewrite draft prose link” has no draft path to find.

7. **Tracker state after review-room approval is unresolved.** `/plan` currently writes `planned` after signoff at [plan.md:30](/Users/bk/github/research-plans/commands/plan.md:30), while board routing changes `planned → in progress` at [board.md:33](/Users/bk/github/research-plans/commands/board.md:33). Under Plan B, choosing “execute later” would leave an untouched component falsely marked in progress. Finalization should leave it `planned`; execution start should set `in progress`.

8. **Batch routes need a batch-wide lock.** `profile_lock` exists because the server is threaded at [board.py:1103](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1103), but batch entry refresh, ticket writes, result-list mutation, rejects, and done are unguarded at [board.py:1389](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1389). The critical section must cover entry lookup, newest-draft check, disk read, client-hash comparison, ticket write, and result mutation.

9. **A newly appeared draft version is not detected.** Batch collection selects `newest_draft` at [board.py:2381](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:2381), but Task 10’s route only rereads the boot entry’s existing path. If `.draft-vN+1.md` appears while `.draft-vN.md` remains, the old version can still be approved. Recompute newest-draft identity during approval and return a refresh/conflict.

10. **Resumed approvals disappear from the batch summary.** `result["approved"]` starts empty at [board.py:1094](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1094), is populated only by current-boot approval posts at [board.py:1401](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1401), and is the only list printed on exit at [board.py:1461](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1461). A ticketed plan rendered “already approved” after restart will not appear in stdout, so `/plan` may never write its `vN.md`. Initialize the server result from valid ticketed entries or make post-batch routing enumerate valid tickets directly.

11. **Ticket cleanup runs before the board lock.** `apply_gate_batch` calls `retire_orphan_order_tickets` at [board.py:2375](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:2375), before `serve()` acquires the lock at [board.py:1074](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1074). Another live board may be between ticket creation and durable order replacement at [board.py:1124](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1124). This fails closed, but can destroy a legitimate approval transaction. All cleanup mutation should occur only after the lock.

12. **Plan B does not actually enforce one tail commit prompt.** `results.md` still suggests a results commit at [results.md:23](/Users/bk/github/research-plans/commands/results.md:23), and `report.md` always suggests a report commit at [report.md:26](/Users/bk/github/research-plans/commands/report.md:26). Plan B Task 6 changes report-offer and board-open behavior but does not suppress either intermediate prompt. Add explicit autopilot return modes to both commands.

13. **“Finalize using results.md step 7 mechanics” is too broad.** Step 7 currently finalizes, asks about reports, logs, opens the board, and suggests a commit at [results.md:23](/Users/bk/github/research-plans/commands/results.md:23). The runbook separately performs report, bookkeeping, commit, and board at [v0.20b plan:130](/Users/bk/github/research-plans/docs/plans/2026-07-17-v0.20b-autopilot.md:130). Define the reused portion as finalize plus disk verification only, then return control to the runbook.

14. **Deviation recovery uses a nonexistent `rN+1`.** The runbook validates before finalization at [v0.20b plan:127](/Users/bk/github/research-plans/docs/plans/2026-07-17-v0.20b-autopilot.md:127), but “Fix the work” says recapture as `rN+1` at [v0.20b plan:141](/Users/bk/github/research-plans/docs/plans/2026-07-17-v0.20b-autopilot.md:141). No `rN` exists yet: results are still in staging until [results.md:23](/Users/bk/github/research-plans/commands/results.md:23). Fix or rebuild the current staging capture and finalize it as the same next `rN`, or explicitly finalize the deviating bundle before choosing a remedy.

15. **Revise-plan recovery leaves stale provenance unless specified.** The staged manifest is stamped with the latest signed plan in step 5 at [results.md:19](/Users/bk/github/research-plans/commands/results.md:19). If the deviation stop signs `vN+1`, revalidation alone does not update top-level `manifest.planVersion`, `validation.planVersion`, and trigger/provenance as necessary. Those fields must be rewritten before finalization.

16. **Headless execution is incomplete.** The runbook requires an “explicit go” at [v0.20b plan:161](/Users/bk/github/research-plans/docs/plans/2026-07-17-v0.20b-autopilot.md:161), but `execute.md`’s proposed argument syntax has no `--go` at [v0.20b plan:186](/Users/bk/github/research-plans/docs/plans/2026-07-17-v0.20b-autopilot.md:186), and its resolver treats each argument as a component at [v0.20b plan:192](/Users/bk/github/research-plans/docs/plans/2026-07-17-v0.20b-autopilot.md:192). It also lacks headless policies for already-executed components and mid-execution interpretive choices, even though those choices must still surface at [v0.20b plan:121](/Users/bk/github/research-plans/docs/plans/2026-07-17-v0.20b-autopilot.md:121).

17. **Multi-component aggregation is ambiguous.** The reference is framed as a per-component tail and includes its commit suggestion and board step at [v0.20b plan:123](/Users/bk/github/research-plans/docs/plans/2026-07-17-v0.20b-autopilot.md:123), while `execute.md` says to run that tail for each component at [v0.20b plan:196](/Users/bk/github/research-plans/docs/plans/2026-07-17-v0.20b-autopilot.md:196). Explicitly defer commit and board until all selected components complete.

### P2

- The dual parser is feasible: the existing common field checks at [reportMarker.ts:43](/Users/bk/github/research-plans/board/src/lib/reportMarker.ts:43) can precede a schema-specific verdict/validation branch, and the current v1 tests at [reportMarker.test.ts:4](/Users/bk/github/research-plans/board/src/lib/reportMarker.test.ts:4) do not conflict. However, the current parser accepts any numeric schema version with a valid verdict; the proposal will reject unknown versions. Add an explicit unknown-version test and document that compatibility decision.

- PlanReader’s ambiguity rule remains safe in the normal migration flow: the canonical scorecard filename is one component/version file, and matching is exact with duplicate matches hidden at [PlanReader.tsx:262](/Users/bk/github/research-plans/board/src/views/PlanReader.tsx:262). A draft-path and signed-path card would not both match one document. Arbitrary duplicate review files are possible because all `*.md` files are loaded at [board.py:727](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:727). Task 11’s proposed `Map` silently chooses the last duplicate instead of preserving ambiguity-to-none.

- Batch UI says approved plans “are being written” and “have already been written” at [BatchGate.tsx:101](/Users/bk/github/research-plans/board/src/views/BatchGate.tsx:101) and [BatchGate.tsx:223](/Users/bk/github/research-plans/board/src/views/BatchGate.tsx:223), but the server has written only tickets. Update the wording.

- Timeline still deliberately emits legacy verdict events at [Timeline.tsx:269](/Users/bk/github/research-plans/board/src/views/Timeline.tsx:269). Removing “verdict events” entirely from `board.md` makes legacy behavior undocumented; call them “legacy verdict events” instead.

## 3. Missing steps and edge cases

### Plan A

- Remove all three `FeedbackMeta.verdict` writes and stage every modified Results fixture.
- Update both exhaustive tracker maps, PlanReader result marks, and tracker/status consistency rules.
- Expand the doctrine sweep to `report.md`’s header, `sync.md`, `results-adopt.md`, `split-criteria.md`, `feedback.ts`, and the SKILL report-marker sentence.
- Define draft scorecard freshness, the `not-yet-applicable` JSON representation, and post-commit integrity refresh.
- Make signed fallback review migrate/regenerate instead of skipping a draft-path card.
- Add an automated migration test covering JSON `planPath`, prose link, signed PlanReader attachment, and modal fallback.
- Define tracker transitions: finalization → `planned`; execution start → `in progress`.
- Replace ID-only batch approval with displayed-content hash approval; add a batch lock.
- Test two tabs, same-boot reload after 409, concurrent 409/approve, newer draft appearance, ticketed approvals in exit output, and new-boot reload.
- Extend the existing signoff E2E test with file creation, ack, and second-write denial. The existing harness is writable: server helpers are at [test_board.py:1796](/Users/bk/github/research-plans/tests/test_board.py:1796), HTTP helpers at [test_board.py:1837](/Users/bk/github/research-plans/tests/test_board.py:1837), and in-process hook helpers at [test_gate_explicitness.py:180](/Users/bk/github/research-plans/tests/test_gate_explicitness.py:180).

### Plan B

- Add explicit autopilot caller modes to `results.md` and `report.md`, with no intermediate AskUserQuestion, commit suggestion, log duplication, or board open.
- Specify staged-bundle handling for all three deviation remedies.
- Update manifest and validation plan provenance after revise-plan.
- Define exact headless syntax, including `--go`, rerun/skip handling, and stop behavior for interpretive choices.
- State that multi-component commit and board operations are deferred and aggregated.
- Update `results-adopt.md` and other on-demand references included by the spec.
- Clarify the zero-artifact retrospective exception: current results rules allow an explicitly confirmed summary-only retrospective bundle at [results-adopt.md:24](/Users/bk/github/research-plans/skills/managing-research-plans/references/results-adopt.md:24), whereas the proposed matrix says simply “no bundle.”

Cross-plan contracts otherwise line up: Plan B’s tracker outputs at [v0.20b plan:148](/Users/bk/github/research-plans/docs/plans/2026-07-17-v0.20b-autopilot.md:148) are exactly A’s three additions, and v2 report markers/`curatedBy` have producers. The sequential edits to `plan.md`, `sync.md`, and `board.md` are textually composable if applied A then B, but the semantic issues above remain.

Batch tickets do admit the subsequent writes: `orderActionId` is added only when supplied at [board.py:2316](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:2316), the batch call supplies none at [board.py:1401](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1401), and the hook checks order binding only when that field exists at [signoff_gate.py:82](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/signoff_gate.py:82), while always checking the content hash at [signoff_gate.py:96](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/signoff_gate.py:96).

## 4. Risks worth adding

- Batch approval tickets expire after seven days at [board.py:54](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:54); “durable resume” should not imply indefinite authorization.
- The reconnect story is sound only when a fresh server becomes reachable at the same endpoint: `shouldReload` detects a new boot for the same project at [reconnect.ts:51](/Users/bk/github/research-plans/board/src/lib/reconnect.ts:51). It does not discover a replacement server that bound a different fallback port.
- V2 report “staleness” is mostly defensive because validation is sealed into an immutable bundle. The plans should state whether this check is intended primarily to detect manual corruption rather than ordinary workflow drift.
- Request-changes decisions remain process-local by design; batch summaries and user copy should say explicitly that only approvals survive a crash.
- Both plans edit the same changelog section. Create `[Unreleased]` once and merge bullets beneath one pair of headings.

## 5. Open questions

1. Should a newly finalized but not-yet-executed plan always remain `planned`, including revisions?
2. Should mutable draft scorecards carry a `planHash`, or should automatic draft review always rescore?
3. What is the durable representation of draft integrity: omit `uncommitted`, mark it not applicable, or refresh the scorecard immediately after the plan commit?
4. Should batch approval POST an exact normalized content hash, a raw-byte hash, or both?
5. When a new draft version appears during a batch, should the old entry be removed, replaced in place, or require a batch reload?
6. In headless `/execute`, what exact flags authorize execution and reruns, and what must happen when an interpretive choice arises?
7. On “revise plan” after deviations, should the pending bundle be finalized as evidence of the failed run, or should its staging be rebound to the new plan and finalized once?

Verification at HEAD `812219b`: 86 targeted board tests passed, 60 targeted Python tests passed, and `tsc -b` was clean. The HTTP harness could not bind loopback in this managed sandbox; the failure was environmental at [test_board.py:1749](/Users/bk/github/research-plans/tests/test_board.py:1749), not a repository failure. Logs: [board tests](/Users/bk/github/research-plans/logs/2026-07-17_v020-plan-audit-board.log), [Python tests](/Users/bk/github/research-plans/logs/2026-07-17_v020-plan-audit-python.log), [TypeScript](/Users/bk/github/research-plans/logs/2026-07-17_v020-plan-audit-tsc.log), [HTTP harness](/Users/bk/github/research-plans/logs/2026-07-17_v020-plan-audit-http-harness.log).