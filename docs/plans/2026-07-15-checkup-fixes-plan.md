# Plugin Checkup — Fix Execution Plan (rev 2)

> Fixes the findings in `docs/evaluation/checkup/findings.md`, landed on **one branch** for a **single giant PR**. WT-1 (CSRF) already shipped as merged PR #20. Revision 2 folds in the `/codex` review (`docs/specs/2026-07-15-codex-review-checkup-fixes-plan.md`) and three researcher decisions (WT-2 idempotency contract; SCR-8 remove; SEC-1 document+keep).

**Goal:** Apply fix batches A–F on one branch, ending in one PR the researcher opens.

**Base:** current `origin/main` (`dd5cf9d` — has the merged sidebar work PR #19 + CSRF PR #20), plus the audit docs (rebased on top). Fixes verified against this **post-sidebar** code.

**Branch strategy:** one branch `fix-checkup-batches` off `main`. Giant PR carries **audit docs + all fixes** (default; say if you want fixes-only). **One commit per finding** (not per batch) so review/rollback is granular.

## Global Constraints

- **The board build is part of Batch F, not forbidden.** `board.py` serves the committed `skills/managing-research-plans/assets/board-template.html`, which `npm run build` regenerates from `board/src` (`board/package.json:9`). Any `board/src` change is invisible until the template is rebuilt + committed. So: build once at the end of Batch F, commit the generated asset, and smoke-test the plugin-served board. (Elsewhere, don't build — only Batch F ships UI.)
- **File overlaps are real** (codex): Batches B + E both edit `board.py`; A + C + D all edit `commands/board.md`. Consequences: sequence **A before C** (C must preserve A's WT-6 WAF wording); coordinate B/E edits to board.py; WT-2/WT-3 add **board** tests (overlap F's board vitest).
- **Regression:** after each batch run its suite; at the end run **all three** (py `pytest tests/`, board `./node_modules/.bin/vitest run` + `tsc --noEmit`, web-template `npm test`) together, then the Batch-F build + smoke. One `/codex` on the full diff before the PR.
- Board line numbers shifted post-sidebar; each board fix re-confirms its line before editing.
- **Deferred (design calls):** COH-2/COH-3/COH-4 (dedup) — need a shared-snippet mechanism the system lacks. The self-review does **not** claim every P2 ships; these three are explicitly out.

---

## Batch B — Hosted-comment robustness (P1 here)

**Files:** `board.py`, `tests/test_board.py`.

- [ ] **SCR-1 (P1) · unlink the inbox after successful routing.** `pull()` (~1608-1624): pair each written inbox filename with its doc; after `inspect_feedback_document(root, doc)` succeeds, `unlink()` that file. The recovery drain (1567-1571) then handles only crash leftovers. **Do not claim exactly-once** — a crash after routing but before unlink can duplicate once (external side-effect boundary). **Tests:** (a) **update** the existing cases that assert successful-pull inbox files remain (`test_board.py:1250` and the collision test ~1278); (b) new: two pulls over the same comments → the second re-routes nothing and the **old comment text is absent** from the second run's output (not merely "No new remote comments").
- [ ] **SCR-2 · atomic pulled-state write.** board.py:1622 → tmp-file + `os.replace` (pattern at 1112-1114). **Test:** a mid-write crash leaves the prior `.board-web-pulled.json` intact (or assert the write goes via a temp path).
- [ ] **SCR-3 · refuse (not warn) an un-acked order.** When `.board-feedback.md` exists un-acked, **refuse** to accept a new order and print an actionable recovery message (route/`--ack` the pending one first) — cover **every** order-writing mode, not just startup. **Test:** with a pending `.board-feedback.md` present, a new order attempt leaves the **original bytes unchanged** and surfaces recovery.
- [ ] **SCR-4 · restructure accept_order to id→ticket→order.** Not a simple reorder: `accept_order` (1100) mints `actionId` internally then writes the order before returning. Restructure so, after id allocation, the **ticket is written before** the durable `.board-feedback.md` (a pre-commit hook/staged step inside `accept_order`, or hoist ticket-writing in). This creates the safer reverse window (orphan ticket, no order) — add an **orphan-ticket recovery rule** (a stale ticket with no matching order/draft is ignored/retired). **Tests:** inject a failure at the ticket write AND at the order replace; assert no state where an order exists without its ticket; assert an orphan ticket is retired.
- [ ] Run `pytest tests/ -q`; one commit per SCR-* finding.

## Batch A — Security hardening (WT-1 merged; do before Batch C)

**Files:** web-template `lib/blobstore.ts`, `api/comments.ts`, `lib/validate.ts`, `middleware.ts` + tests; **board** `components/FeedbackPanel.test.tsx` (WT-3); `commands/board.md` + `docs/hosting-the-board.md` (WT-6); `docs/reference.md` (HOOK-1).

- [ ] **WT-2 · idempotency contract for comment posting** (highest-risk fix, per the confirmed decision). The client keeps one UUID per annotation to retry a lost response with the same id (`App.tsx:249`), treats non-2xx as failure (leaves pending, `App.tsx:269`), and doesn't read the server id. So: **keep the client UUID as the idempotency key; store create-only; if the key exists with identical canonical content → 200 (existing id); if it exists with different content → 409 without modifying; client treats an identical replay as success.** Implement the conflict check in `putComment`/`comments.ts` (today there is none). Name the author-impersonation mitigation: document `author` in the collaborator-facing copy as **self-entered, unauthenticated identity** (the shared-password model has no server-bound identity). **Tests (client + server):** first post; identical replay → success + one stored + pending cleared; conflicting reuse → 409, unchanged; concurrent duplicate posts; simulated lost-response retry → exactly one stored comment and one cleared pending annotation.
- [ ] **WT-3 · regression test only (currently safe).** Codex traced it: hosted fields render via React text interpolation in `FeedbackPanel.tsx:151` — **no comment-to-HTML sink exists**. Add a **board** regression test (`FeedbackPanel.test.tsx`) pinning that a comment containing `<img onerror>`/`javascript:` renders inert. **Batch A runs the board vitest** for this. No live vuln to close.
- [ ] **WT-4 · test the real middleware gate.** New test driving `middleware.ts`'s default export (authed → `next()`; unauth `/api/*` → 401 JSON; unauth page → login HTML) + a parity assertion its inlined `isAuthed`/`verifyCookie` agree with `lib/auth.ts`.
- [ ] **WT-5 · byte-accurate cap.** validate.ts:29 → `Buffer.byteLength(serialized, "utf8")`. **Test:** a multibyte payload just over 64 KB in bytes is rejected.
- [ ] **WT-6 · login rate-limit.** Make the **Vercel Firewall step non-optional** in `commands/board.md` (first-run setup) and `docs/hosting-the-board.md` — it is the primary defense. An optional in-code per-IP backoff in `api/login.ts` is defense-in-depth only, **not** presented as equivalent to the WAF. **Test:** doc assertion (+ backoff unit test if coded).
- [ ] **WT-7 · login page cleanup.** Wire an error message on failed login or drop the dead `.err` CSS (`loginPage.ts:12`, `api/login.ts:16`). **Keep the middleware login HTML self-contained** — do NOT import the shared login module (middleware can't import `./lib`; that's the recorded constraint). Reconcile the two copies by keeping them intentionally-parallel with a sync comment. **Test:** login-page test asserts the error affordance.
- [ ] **`/api/logout` · close as no-change.** Codex confirms no board code invokes `/api/logout`; leave it and add a one-line note that it's intentionally method-agnostic with no caller. (Reopen only if a caller appears.)
- [ ] **HOOK-1 · document the gate boundary** in `docs/reference.md`: immutability is enforced against Write/Edit; a Bash-mediated write is outside the matcher (the workflow always uses Write). Doc only.
- [ ] Run web-template `npm test` + board `vitest` (for WT-3) + `tsc`; one commit per finding.

## Batch C — Token: externalize the mode runbooks (after A)

**Files:** `commands/board.md`, `commands/results.md`, new `references/web-publishing.md` + `references/results-adopt.md`, the 4 wordiest `description:` lines.

- [ ] **TOK-2/TOK-3 · board.md web-runbook → reference.** Move steps 10–14 (~12.6 KB) into `references/web-publishing.md`. **Keep the untrusted-input routing security label INLINE** in step 5 (it governs pulled documents and must not be externalized). Replace the mode dispatch's **numeric jumps** ("go to step 11") with **named reference headings** ("follow the Publish-to-web section of `references/web-publishing.md`"). Preserve A's WT-6 WAF wording in the moved runbook. **Verify:** `token_report.py` shows the bare-`/board` + `/plan`-chain peaks drop; a clean-room `--publish-web`/`--pull`/`--collect` smoke still routes; no dead step reference remains (`rg 'step 1[0-4]' commands/board.md`).
- [ ] **TOK-4 · results.md adopt/reconcile → reference.** Move step 8 + step 9 + the regeneration appendix into `references/results-adopt.md`; keep single-capture (steps 1–7) inline. **Update the common-path link:** results.md step 2 currently points at the appendix — repoint it to the reference; preserve the adopt/reconcile→inline-steps-2-7 back-references. **Verify:** `token_report.py` per-invocation `/results` drop; `--adopt`/reconcile still resolve.
- [ ] **TOK-1 · tighten the 4 wordiest descriptions** (renew/adopt/results/report). **Verify:** always-on floor drops in `token_report.py`; descriptions still read clearly.
- [ ] Run all suites (template contract tests read these files); one commit per finding.

## Batch D — Portability

**Files:** `commands/init.md`; `commands/board.md` (+ its `allowed-tools`).

- [ ] **POR-2 (P1) · headless /init recovery.** When `AskUserQuestion` is unavailable and required answers are missing: create nothing and print a recovery message that shows the **full** non-interactive form — all required inputs (research questions, data source/size/sensitivity, target journal), e.g. `/research-plans:init` with the RQs + data + journal seeded in the argument. **Verify:** clean-room headless `/init` emits the complete recovery form (re-run the Run-2 probe).
- [ ] **POR-1 · codex/agy guard + permission.** Add a `command -v codex`/`command -v agy` preflight in board.md's Review-with steps. **This needs `Bash(command:*)` added to board.md's `allowed-tools`** (report.md grants it; board.md does not). **Verify:** clean-room missing-tool probe (PATH minus codex/agy) degrades to "not available — pick another reviewer."
- [ ] Commit per finding.

## Batch E — Coherence + small script fixes

**Files:** `docs/reference.md`, `board.py`, `results.py`, `check_update.py`, agent template, `QUICKSTART.md`, board `lib/*` tests.

- [ ] **COH-1** `reference.md:50` → close-on-action + no-idle-timeout. **COH-5** delete the stale `token_ok` docstring (board.py:867-870). **DOC-1** add `model-profile.md` to the reference "what it creates" tree. **DOC-2** `QUICKSTART.md:72` reword "saved review scorecards" → "each plan version's rubric score in its header." (docs/comments)
- [ ] **SCR-6** (board.py:458-460) + **SCR-7** (results.py:355-361): **log the swallowed error to stderr and assert the message** in a test — narrowing-and-continuing-silently does not resolve the finding; preserve advisory (non-fatal) behavior.
- [ ] **SCR-8 · remove the write-only state fields** (decision): drop `lastSuccess`/`lastSeenRemoteVersion`/`installedVersionAtLastCheck` from `check_update.py` (17-20, 200-202). **Test:** state round-trips with only the used fields.
- [ ] **SEC-1 · document + keep** (decision): add a comment in `rp-plan-reviewer.md` explaining the unscoped `Bash` is for read-only git evidence (integrity flags) and can't be scoped in agent frontmatter; keep the grant. No behavior change.
- [ ] **SCR-5 · pin the Py/TS pairs.** Add parity tests for `artifact_headers`↔`artifactDisplay.inlineSafe` and `payload_files`↔`parse.allFiles` (the fnv1a pair is already partly pinned — cover the gap). Mirror the `is_substantive` pinned-vector approach.
- [ ] Run all suites; commit per finding.

## Batch F — Board UX + accessibility (build + ship the asset)

**Files:** board `src/App.tsx`, `views/Tracker.tsx`, `views/Archive.tsx`, `views/PlanReader.tsx`, `views/Results.tsx`, `components/{AnnotationLayer,ScriptViewer,ReviewMenu,Sidebar}.tsx`; **`assets/board-template.html`** (rebuilt at the end).

- [ ] **Pre-step: re-confirm each finding against real code** (codex corrected two): UI-6's real target is the **global `Sidebar.tsx` + `App.tsx`** (the `w-56` in Results.tsx are **form input widths**, not a sidebar); UI-5 still unfixed.
- [ ] **UI-1 · native dialogs → in-DOM** (App.tsx copy-fallback): replace `alert()`/`window.prompt()` with an in-DOM selectable textarea. **Test:** renders a textarea, calls no native dialog.
- [ ] **UI-2 · drop dead `canPost`** from Tracker/PlanReader/Results signatures + App call sites. **List and update every test that instantiates these views with `canPost`** (else `tsc` fails on excess props). **Test:** tsc clean.
- [ ] **UI-5 · header can wrap** (App.tsx:1012 nav): allow `flex-wrap` or collapse the tab nav into an overflow menu below a breakpoint. (This had no fix in rev 1.) **Verify:** live pass at 200% zoom / narrow.
- [ ] **UI-6 · global sidebar responsive collapse** (`Sidebar.tsx:68` + `App.tsx:979`): collapse/stack by **viewport**, not only coarse-pointer, so a fine-pointer desktop at 200% zoom isn't squeezed. **Verify:** live zoom/viewport check (JSDOM won't verify Tailwind layout).
- [ ] **UI-7** wrap Tracker/Archive tables in `overflow-x-auto`. **UI-8** dark-mode contrast (PlanReader.tsx:413) add `dark:bg-red-900/*` or drop the `dark:` text override. **UI-9** ReviewMenu outside-click + Escape dismissal. **Tests:** component tests.
- [ ] **UI-3 · annotation keyboard path** — a `selectionchange`-driven affordance / shortcut to open the composer (not only `onMouseUp`). **UI-4 · line-comment keyboard** — focusable line numbers with Enter to set / Shift-Enter to extend. **Tests:** component tests for the keyboard behaviors.
- [ ] **Sidebar a11y sweep** (new, un-audited): keyboard navigation of the file tree, focus management, `aria` roles/labels on the tree + toggle. Fix what's obviously wrong; name each check.
- [ ] **Build + ship:** `cd board && npm run build` (regenerates `assets/board-template.html`), commit the generated asset, and **smoke-test the plugin-served board** (`board.py` on a fixture, Playwright — the fixes render, no console errors). Run board `vitest` + `tsc` first.

---

## Self-review

- **Coverage:** every P1 (SCR-1/B, POR-2/D, TOK-1/2/3/C; WT-1 merged) + every P2 maps to a batch **except COH-2/3/4, explicitly deferred** (rev 1 wrongly claimed full P2 coverage — corrected). UI-5 now has a real fix; SCR-8/SEC-1 have chosen implementations; UI-6 retargeted. ✓
- **Regression safety:** the Batch-F build + committed asset + live smoke closes the "fix doesn't ship" gap; WT-2 has the full idempotency test matrix; SCR-1 updates the tests that assert the old behavior. ✓
- **No placeholders:** SCR-8 (remove), SEC-1 (document+keep), WT-2 (the contract) are all decided. WT-3 is a test-only regression (currently safe). ✓
- **File overlaps** noted (B/E→board.py; A/C/D→board.md, A before C); one commit per finding. ✓

## Execution handoff

On approval I create `fix-checkup-batches` off `main`, work B→A→C→D→E→F (one commit per finding, suite after each batch), run all three suites + the Batch-F build + smoke, one `/codex` on the full diff, and hand you a branch ready for the single giant PR.
