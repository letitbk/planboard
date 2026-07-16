Verdict: the plan needs revision before execution. Most fixes are feasible, but WT-2, SCR-3, SCR-4, UI-6, and the board build strategy are not yet safe or complete.

## 1. Per-fix feasibility issues, ordered by severity

1. **Batch F, affecting UI-1 through UI-9: the fixes would not ship.** The plan forbids `npm run build` because a later release supposedly owns it ([plan](/Users/bk/github/research-plans/docs/plans/2026-07-15-checkup-fixes-plan.md:11)). In reality, that command copies the compiled UI into the plugin’s shipped `board-template.html` ([package.json](/Users/bk/github/research-plans/board/package.json:9)), and the release checklist contains no build step ([RELEASING.md](/Users/bk/github/research-plans/docs/RELEASING.md:3)). A live board launched through `board.py` would therefore continue serving the old UI. Batch F needs one final build, the generated asset committed, and a live test against the actual plugin entry point.

2. **WT-2: both proposed implementations break retry semantics as currently written.** The client deliberately retains one UUID per annotation because a lost response must be retried with the same blob ID ([App.tsx](/Users/bk/github/research-plans/board/src/App.tsx:249)). It also treats every non-2xx response as failure, leaves the comment pending, and never reads the ID returned by the server ([App.tsx](/Users/bk/github/research-plans/board/src/App.tsx:269)).

   - A random server-assigned ID would create duplicates after a lost response.
   - `allowOverwrite: false` plus an unconditional 409 would leave an identical retry permanently pending.
   - The current API has no conflict handling around `putComment` ([comments.ts](/Users/bk/github/research-plans/skills/managing-research-plans/assets/web-template/api/comments.ts:16)).

   Preserve the client UUID as an idempotency key. On an existing ID, return success when the canonical stored payload is identical, but return 409 for different content. Add client tests for a lost-response retry, not just a storage overwrite test. The author-impersonation part is also only partially addressed: “untrusted display text” needs a named UI or documentation location and should describe the field as self-entered, unauthenticated identity.

3. **UI-6: the post-sidebar target is wrong.** The two remaining `w-56` occurrences in `Results.tsx` are form input widths, not sidebars ([Results.tsx](/Users/bk/github/research-plans/board/src/views/Results.tsx:558)). The actual fixed sidebar is the new global component ([Sidebar.tsx](/Users/bk/github/research-plans/board/src/components/Sidebar.tsx:68)). It defaults to collapsed only for coarse pointers ([App.tsx](/Users/bk/github/research-plans/board/src/App.tsx:979)).  
   **Inference:** at 200% zoom on a fine-pointer desktop, it can still squeeze the main area. UI-6 should target `App.tsx` and `Sidebar.tsx`, with viewport-based collapse or stacking. A JSDOM “renders at narrow width” test does not verify Tailwind layout; retain the live zoom/viewport check.

4. **SCR-3: “refuse-or-warn” does not define a safe behavior.** A warning followed by the current overwrite would not resolve the finding. The plan should require refusal, with an actionable recovery message, and test that the original `.board-feedback.md` bytes remain unchanged. It must cover every mode able to write an order, not just startup output.

5. **SCR-4: this cannot be implemented as a simple reorder.** `accept_order` creates the `actionId` internally and writes the durable order before returning it ([board.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1100)); `write_ticket` needs that returned ID and currently runs afterward ([board.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1292)). The implementation needs a pre-commit callback or staged transaction after ID allocation.

   **Inference:** ticket-first creates the reverse crash window, an orphan approval ticket with no durable order. That is safer than an order without its authorization ticket, but it needs an explicit recovery rule. Inject failures at ticket write and order replace; “ticket exists whenever order exists” on the normal path is insufficient.

6. **WT-3: the current render trace is safe, but the named test location is incomplete.** Hosted fields render through React text interpolation in `FeedbackPanel` ([FeedbackPanel.tsx](/Users/bk/github/research-plans/board/src/components/FeedbackPanel.tsx:151)), so no current comment-to-HTML sink was found. The regression belongs in `FeedbackPanel.test.tsx`. Batch A names and runs only web-template files and tests ([plan](/Users/bk/github/research-plans/docs/plans/2026-07-15-checkup-fixes-plan.md:34)); it must add the board test and board Vitest run.

7. **POR-1: `command -v` is not currently allowed by `board.md`.** `report.md` grants `Bash(command:*)`, but `board.md` does not ([board.md](/Users/bk/github/research-plans/commands/board.md:4)). Add that permission or choose a preflight compatible with the existing allowlist.

8. **POR-2: the recovery example does not seed all required inputs.** The plan says data and journal must be seeded but gives only an RQ one-liner ([plan](/Users/bk/github/research-plans/docs/plans/2026-07-15-checkup-fixes-plan.md:59)). A genuinely headless rerun could dead-end again. Define the noninteractive argument format or show all required inputs.

9. **TOK-2/TOK-3: feasible, but the cross-file contract is underspecified.** Current mode dispatch points directly to steps 10 through 14 ([board.md](/Users/bk/github/research-plans/commands/board.md:13)), and the untrusted-input rule in step 5 refers to documents produced by step 12 ([board.md](/Users/bk/github/research-plans/commands/board.md:24)). Keep the security label inline, replace numeric cross-file jumps with named reference headings, and test every moved mode. Otherwise the move can leave dead dispatch and routing references.

10. **TOK-4: update the common-path regeneration link.** Step 2 already points to the appendix ([results.md](/Users/bk/github/research-plans/commands/results.md:13)). Moving the appendix requires a new explicit reference link while preserving references from adopt/reconcile back to inline steps 2 through 7.

11. **SCR-1: the code change is sound and does not conflict badly with recovery, but existing tests need adjustment.** Pairing each filename with its document and unlinking only after successful routing preserves crash recovery: a failure before completion leaves the file for the next drain ([board.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1561)).  
    **Inference:** a crash after routing succeeds but before unlink can still duplicate once; this is an unavoidable external side-effect boundary unless routing becomes idempotent. Do not claim exactly-once behavior. Also update tests that currently assert successful-pull inbox files remain, including [test_board.py](/Users/bk/github/research-plans/tests/test_board.py:1250) and the collision test at line 1278. The new second-pull test should assert that the old comment text is absent, not merely that “No new remote comments” appears.

12. **SCR-6/SCR-7: “narrow or log” must resolve to observable behavior.** Narrowing an exception and continuing silently still fails the finding. Log expected read/profile failures to stderr and assert the message. Preserve advisory behavior where appropriate rather than turning routine drift detection into a board failure.

13. **SCR-8 and SEC-1 are decisions, not executable fixes.** “Drop or wire” and “implement only if low-risk” contradict the plan’s no-placeholder claim ([plan](/Users/bk/github/research-plans/docs/plans/2026-07-15-checkup-fixes-plan.md:72)). Choose the behavior before approval and name its tests.

14. **UI-2 is truly dead post-sidebar.** `canPost` is only destructured and typed in Tracker, PlanReader, and Results; its live uses are elsewhere in `App` and `FeedbackPanel`. Removing those three props is safe. However, all tests that still instantiate the views with `canPost` must be listed and updated; `tsc` will otherwise fail on excess props.

15. **UI-3/UI-4 are too vague.** Specify the keyboard behaviors, such as a selection-change shortcut for annotation and focusable line controls with Enter/Shift-Enter, then require component tests. “Tests where feasible” is not sufficient for accessibility behavior.

16. **WT-6/WT-7 need file and architecture corrections.** Batch A’s file list omits `commands/board.md` and the hosting guide required by WT-6. An in-memory per-IP backoff should not be presented as equivalent to Vercel Firewall protection. For WT-7, keep the middleware login HTML self-contained; importing the shared login module would conflict with the recorded middleware constraint.

No material feasibility problem was found with SCR-2, WT-4, WT-5, TOK-1, COH-1, COH-5, DOC-1, DOC-2, UI-1, UI-7, UI-8, UI-9, or HOOK-1. SCR-5 is feasible, although the FNV cross-language vector is already partly pinned, so effort should focus on the missing artifact and payload parity coverage.

## 2. Completeness gaps versus findings.md

All formal P1 findings map: WT-1 is already merged, and SCR-1, POR-2, and TOK-1/2/3 are present.

P2 gaps or incomplete mappings:

- **UI-5 has no fix.** The current header still uses a non-wrapping flex/nav layout ([App.tsx](/Users/bk/github/research-plans/board/src/App.tsx:1012)). A live pass is verification, not a fix.
- **COH-2, COH-3, COH-4 are explicitly deferred.** That is transparent, but the self-review claim that every P2 maps to a batch is false.
- **SCR-8 and SEC-1 have no selected implementation.**
- **UI-6 maps to an obsolete target.**
- **WT-2’s author-impersonation aspect has only an unnamed documentation instruction.**

Plan additions that are not formal findings:

- The `/api/logout` method check is a sibling observation, not a finding ID. Current board code does not appear to invoke it, so it should be closed as “no change required” unless a caller is found.
- The broad new Sidebar accessibility sweep is additional scope. It is reasonable post-merge, but should name exact checks and tests.

## 3. Post-sidebar accuracy problems

I checked `git diff --name-only 60eaede..1d2cf68`. PR #19 changed board frontend files and the generated `board-template.html`, but did not change `board.py`, the web template, command files, reference docs, `results.py`, `check_update.py`, or the reviewer agent. Batch A through E findings are therefore unaffected by the sidebar merge.

Batch F’s re-verification is inadequate:

- It incorrectly identifies `Results.tsx` as the remaining sidebar.
- It misses unresolved UI-5.
- It does not account for responsive behavior moving into global `Sidebar.tsx` and `App.tsx`.
- UI-2 remains correctly identified as dead, but its test call sites are omitted.
- The new sidebar’s shipped generated asset is not included in the plan.

## 4. Sequencing and branch-strategy problems

One branch is technically workable, but the claimed “independent file areas” are inaccurate:

- B and E both edit `board.py`.
- A, C, and D all edit `commands/board.md`.
- WT-2/WT-3 need board client tests, overlapping F.
- C must preserve or relocate the WT-6 WAF language added in A.

The existing B, A, C, D, E, F order is otherwise reasonable. If the giant PR requirement remains, use one commit per finding, run the stated suite after each batch, then run all Python, board, and web-template suites together. Finish with one board build, commit the generated asset, and smoke-test the plugin-served board. The primary branch risk is review and rollback difficulty, not a hard implementation dependency.

## 5. Highest-risk fix and how to de-risk it

**WT-2 is the highest-risk fix.** A superficially secure overwrite fix can silently create duplicate comments or make pending comments impossible to clear.

Use this contract:

1. Keep the client UUID as an idempotency key.
2. Store create-only.
3. If the key exists with identical canonical content, return 200 with the existing ID.
4. If it exists with different content, return 409 without modifying it.
5. Have the client read the returned ID and treat identical replay as success.

Tests should cover first post, identical replay, conflicting reuse, concurrent duplicate posts, and a simulated lost response followed by retry. The last case must assert one stored comment and one cleared pending annotation.

## 6. Open questions

1. Is identical same-ID replay accepted as success for WT-2, or is a separate server-side idempotency mapping preferred?
2. Should SCR-3 refuse all order-producing modes while an unacked file exists, or offer an explicit recovery/ack action?
3. How should an orphan SCR-4 ticket be detected and retired after an order-write failure?
4. For SCR-8, should the three state fields be removed or exposed as diagnostics?
5. For SEC-1, should `/review` precompute integrity evidence so the reviewer agent can lose Bash access?
6. Will the final PR commit the rebuilt `board-template.html`? Without that, Batch F does not ship.

The optional independent `agy` review could not run in the managed sandbox; this evaluation is based directly on the complete plan, findings, git history, and current working-tree code.