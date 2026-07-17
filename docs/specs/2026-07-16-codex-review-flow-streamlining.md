The v0.19.1 work is mostly feasible, but H3 needs redesign. The v0.20 design is not implementation-ready: draft scorecard identity, verdictless bundle state, commit timing, and resumable batch state are underspecified. I found no P0 security or ticket-model blocker.

The important positive finding is that S1’s ticket chain does compose, provided the agent keeps the current route-before-ack order:

1. The server limits approval to the exact draft displayed in the payload.
2. Approve rereads the draft from disk and rejects stale content.
3. The ticket is written with the normalized content hash and the pending order’s `actionId`.
4. The order is atomically persisted after the ticket.
5. The hook requires that same pending order and hashes the proposed signed file with the same normalization.
6. Only after the signed write should the agent acknowledge the order.

That chain is enforced by [board.py:997](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:997), [board.py:1107](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1107), [board.py:1273](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1273), [signoff_gate.py:38](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/signoff_gate.py:38), [signoff_gate.py:60](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/signoff_gate.py:60), and the routing order in [board.md:11](/Users/bk/github/research-plans/commands/board.md:11).

## 1. Factual errors in the spec

1. **Batch gating is not actually restricted to `/adopt`.** `apply_gate_batch` accepts the newest draft from every component. The only functional restriction is fewer than two unapproved drafts unless `--allow-single` is supplied. The `/adopt` limitation exists in the docstring, help text, and error wording, not as provenance or command-origin enforcement. Two ordinary `/plan` drafts already qualify today. [board.py:2366](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:2366)

2. **The headless path does not preserve the researcher-approval invariant.** `RESEARCH_PLANS_NO_GATE=1` bypasses the plan gate outright; it is not a modal or equivalent approval path. The project skill explicitly recommends that variable for headless/CI use. [signoff_gate.py:273](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/signoff_gate.py:273), [SKILL.md:46](/Users/bk/github/research-plans/skills/managing-research-plans/SKILL.md:46)

3. **A draft scorecard cannot currently “serve the signed plan too” through normalization.** Normalization is used only for sign-off ticket hashing. Review scorecards identify a plan by exact `planPath`, and the UI only attaches a scorecard to a signed document whose path exactly matches. The reviewer template and agent also hardcode `vN.md`. A score written for `.draft-vN.md` will not appear on `vN.md`; a score pre-labelled `vN.md` will not attach to the draft. [PlanReader.tsx:248](/Users/bk/github/research-plans/board/src/views/PlanReader.tsx:248), [review.md:15](/Users/bk/github/research-plans/commands/review.md:15), [review-scorecard.md:32](/Users/bk/github/research-plans/skills/managing-research-plans/templates/review-scorecard.md:32), [rp-plan-reviewer.md:23](/Users/bk/github/research-plans/skills/managing-research-plans/templates/agents/rp-plan-reviewer.md:23)

4. **“Reopen stays” is false for new verdictless bundles without another change.** Results renders Reopen only when `bundle.verdict` exists. Removing Accept/Request means new bundles never acquire a verdict, so Reopen disappears. The board routing text also defines Reopen specifically as operating on an accepted bundle. [Results.tsx:589](/Users/bk/github/research-plans/board/src/views/Results.tsx:589), [board.md:35](/Users/bk/github/research-plans/commands/board.md:35)

5. **Adding `(auto-captured)` to a decision-log heading will not surface that state on the Timeline.** The parser keeps only a boolean for `late-captured` and discards other heading suffixes; Timeline only renders that existing late-capture badge. [parse.ts:195](/Users/bk/github/research-plans/board/src/lib/parse.ts:195), [Timeline.tsx:223](/Users/bk/github/research-plans/board/src/views/Timeline.tsx:223)

6. **The stated 1024px reading measure is not the normal expanded-sidebar measure.** The application is already constrained to `max-w-5xl`, and the desktop sidebar consumes `w-56` inside that container. Inference: the prose approaches 1024px mainly with the sidebar collapsed, so the 52rem change may be considerably smaller than the spec suggests in the default layout. [App.tsx:1176](/Users/bk/github/research-plans/board/src/App.tsx:1176), [Sidebar.tsx:111](/Users/bk/github/research-plans/board/src/components/Sidebar.tsx:111)

7. **The parser’s `EXEC_SECTIONS` list contains ten accepted headings, not nine.** One is the legacy `Scope decisions` alias, so the template can still have nine canonical sections, but the spec should distinguish the canonical template from the compatibility parser. [parse.ts:242](/Users/bk/github/research-plans/board/src/lib/parse.ts:242)

## 2. Design flaws and feasibility issues

### P0 blocker

None found. The existing live sign-off model has content binding, order binding, local-host checks, token checks, immutable signed versions, and a hook-level ticket-forgery guard. [board.py:1226](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1226), [signoff_gate.py:245](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/signoff_gate.py:245), [signoff_gate.py:285](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/signoff_gate.py:285)

### P1 material

1. **S1 lacks a canonical draft-to-signed scorecard transition.**

   The implementation needs either:

   - a scorecard migration from `.draft-vN.md` to `vN.md` during sign-off, including its prose link and JSON path; or
   - a new canonical identity such as component, version, and normalized content hash, with explicit matching precedence.

   A client-only fallback based on version is unsafe because PlanReader deliberately treats duplicate exact matches as ambiguous. The reviewer command, reviewer-agent template, scorecard template, parser, and UI all need to participate. [PlanReader.tsx:248](/Users/bk/github/research-plans/board/src/views/PlanReader.tsx:248), [review.md:15](/Users/bk/github/research-plans/commands/review.md:15)

   The new draft must also omit the current template’s `Signed off:` trailer because persistent-board approval explicitly rejects an already signed draft. [execution-plan.md:79](/Users/bk/github/research-plans/skills/managing-research-plans/templates/execution-plan.md:79), [board.py:1302](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1302)

2. **Verdict removal is broader than Results.tsx.**

   The spec correctly observes that there is no `/api/verdict`; verdict is currently an action encoded in feedback prose, and `finalize` does not require it. [board.py:1273](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1273), [feedback.ts:125](/Users/bk/github/research-plans/board/src/lib/feedback.ts:125), [results.py:339](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/results.py:339)

   However, verdict currently controls:

   - Results’ pending banner and Accept/Request/Reopen controls. [Results.tsx:502](/Users/bk/github/research-plans/board/src/views/Results.tsx:502)
   - Tracker’s verified/unverified treatment. [Tracker.tsx:224](/Users/bk/github/research-plans/board/src/views/Tracker.tsx:224)
   - Report status chips and stale-report comparison. [Reports.tsx:21](/Users/bk/github/research-plans/board/src/views/Reports.tsx:21), [Reports.tsx:229](/Users/bk/github/research-plans/board/src/views/Reports.tsx:229)
   - Report markers, which always stamp accepted, changes-requested, or pending. [report.md:14](/Users/bk/github/research-plans/commands/report.md:14)
   - The documented workflow in README, QUICKSTART, and the reference guide. [README.md:49](/Users/bk/github/research-plans/README.md:49), [QUICKSTART.md:54](/Users/bk/github/research-plans/QUICKSTART.md:54), [reference.md:72](/Users/bk/github/research-plans/docs/reference.md:72)

   A replacement bundle-state model is required, not merely removal of two buttons.

3. **The end-only commit conflicts with the prospective-plan integrity rule.**

   The current reviewer marks a plan `uncommitted` when it was not committed before the work it governs, and the rubric defines that as a workflow-integrity failure. An autopilot that commits the plan and results only at the end makes that flag inevitable or meaningless. [review.md:9](/Users/bk/github/research-plans/commands/review.md:9), [plan-rubric.md:67](/Users/bk/github/research-plans/skills/managing-research-plans/references/plan-rubric.md:67)

   The design must choose between a researcher-approved pre-execution commit or retiring/redefining this integrity condition.

4. **H3 auto-close breaks review and report relaunches.**

   Review and report actions intentionally terminate the old server, perform potentially long work, and relaunch on the same port with `--no-open`; the existing tab waits for the new boot. Closing that tab after three seconds leaves the relaunched board with no visible browser window. [board.md:15](/Users/bk/github/research-plans/commands/board.md:15), [board.md:38](/Users/bk/github/research-plans/commands/board.md:38), [board.md:55](/Users/bk/github/research-plans/commands/board.md:55), [ConnBanner.tsx:6](/Users/bk/github/research-plans/board/src/components/ConnBanner.tsx:6)

   In addition, `submitState` records only `"sent"`, not which action was sent, so the proposed logic cannot safely distinguish plain terminal actions from actions expecting a relaunch. [App.tsx:487](/Users/bk/github/research-plans/board/src/App.tsx:487), [App.tsx:812](/Users/bk/github/research-plans/board/src/App.tsx:812)

5. **S4’s stale refresh and interrupted-session story require a server/client state redesign.**

   Current batch behavior:

   - `BatchGate` reads plans from immutable props and initializes every one as pending. [BatchGate.tsx:13](/Users/bk/github/research-plans/board/src/views/BatchGate.tsx:13)
   - The server approves the payload’s captured content without a disk reread. [board.py:1388](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1388)
   - `apply_gate_batch` includes already ticketed drafts in the payload while only excluding them from its pending count. [board.py:2375](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:2375)
   - Rejections live only in process memory. [board.py:1405](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1405)

   Therefore, “refresh that entry in place” must update both the server’s authoritative batch entry and React state. Resumed batches also need an `approved` state or must filter already ticketed drafts. Request-change decisions need durable recovery if the process exits.

6. **The autopilot tail does not define all validation outcomes or preserve all `/sync` responsibilities.**

   Current validation can produce `conforms`, `conforms-with-amendments`, `deviations-found`, `unverifiable`, `not-applicable`, and `skipped`. Integrity can independently pass or fail. The spec only defines proceed/stop for a subset, so `done (validated)` is ambiguous for skipped, retrofit, unverifiable, failed-integrity, and zero-artifact cases. [results.md:21](/Users/bk/github/research-plans/commands/results.md:21), [types.ts:189](/Users/bk/github/research-plans/board/src/lib/types.ts:189), [results.py:370](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/results.py:370)

   `/sync` also performs hosted-comment checks, adoption-cutoff handling, no-git evidence handling, late-capture confirmation, component split checks, plan revision, tracker reconciliation, and source-drift detection. Inline bookkeeping plus the validator does not replace those behaviors. [sync.md:10](/Users/bk/github/research-plans/commands/sync.md:10), [sync.md:16](/Users/bk/github/research-plans/commands/sync.md:16), [sync.md:22](/Users/bk/github/research-plans/commands/sync.md:22), [sync.md:28](/Users/bk/github/research-plans/commands/sync.md:28), [sync.md:32](/Users/bk/github/research-plans/commands/sync.md:32)

7. **Capture without an interview transfers claim authorship to the agent.**

   The current flow asks the researcher to confirm artifacts, titles, captions, and substantive finding statements. The conformance validator checks execution against the plan; it does not validate whether an automatically phrased empirical claim is substantively warranted. This is an intentional workflow tradeoff that the spec should state. [results.md:13](/Users/bk/github/research-plans/commands/results.md:13), [results.md:21](/Users/bk/github/research-plans/commands/results.md:21)

### P2 minor

1. **A failed POST followed by a dead health probe is ambiguous.** Inference: the order may already have been durably accepted before the response was lost, because persistence occurs before the response is sent. Calling the page simply “expired” can invite a duplicate attempt even though `.board-feedback.md` exists. The recovery copy should direct the user to the session’s pending-order recovery. [board.py:1122](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1122), [board.py:1330](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1330)

2. **Sidebar active-file state needs an explicit clearing rule.** Only plan/results/report-style views are named as reporters. Switching to Archive or Models could leave the previous leaf active unless App clears it on tab change. Current Sidebar knows only tab and component. [Sidebar.tsx:20](/Users/bk/github/research-plans/board/src/components/Sidebar.tsx:20), [App.tsx:1180](/Users/bk/github/research-plans/board/src/App.tsx:1180)

3. **Batch ticket writes are not atomic.** A crash during `write_text` can leave a corrupt ticket, which the hook safely denies but requires reapproval. Generalizing batch increases exposure to that recovery path. [board.py:2301](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:2301), [signoff_gate.py:65](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/signoff_gate.py:65)

4. **Step cards need structural Markdown handling.** Build steps are ordinary lists, unlike the deliberately pre-marked agent-detail blocks. Regex wrapping risks breaking nested lists, multi-paragraph steps, annotations, or generated HTML. The existing safe block approach is in [PlanReader.tsx:578](/Users/bk/github/research-plans/board/src/views/PlanReader.tsx:578), while HTML rendering and escaping are centralized in [Markdown.tsx:31](/Users/bk/github/research-plans/board/src/components/Markdown.tsx:31).

## 3. Missing steps and edge cases by release

### v0.19.1

- Add `bootId` to `BoardData`; assign it before `payload_generation()` and HTML injection; exclude it alongside both tokens. Otherwise every restart changes `generation`, defeating content-identity comparisons. [board.py:875](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:875), [board.py:1080](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1080), [types.ts:3](/Users/bk/github/research-plans/board/src/lib/types.ts:3)
- Move the BatchGate branch below a stable hook boundary or split normal and batch modes into child components. An ErrorBoundary alone does not legalize conditional hooks. [App.tsx:142](/Users/bk/github/research-plans/board/src/App.tsx:142), [main.tsx:46](/Users/bk/github/research-plans/board/src/main.tsx:46)
- Centralize 403 recovery for normal actions, gate approve/deny, and eventually batch actions. Test both changed-boot reload and same-boot authorization failure.
- Redesign auto-close for review/report actions: exempt them, reopen a new browser tab after work, or retain the old reconnecting tab.
- Store the submitted action kind, not only `"sent"`.
- Clear active-file state on tab/document changes; auto-expand every ancestor and move the roving tab stop to the active leaf.
- Add an old-tab integration test covering 403 → health probe → changed boot → reload, not only a successful approval.

### v0.20

- Define the draft scorecard identity and migration mechanism. Update `review.md`, both scorecard/reviewer templates, PlanReader matching, and compatibility tests.
- Require unsigned `.draft-vN.md`; append the separator and sign-off line only for the ticketed `vN.md` write.
- Add one full integration test: live approval POST → bound ticket/order → actual hook admission → signed write → ack. Current tests cover ticket creation and hand-built order binding separately. [test_board.py:2257](/Users/bk/github/research-plans/tests/test_board.py:2257), [test_gate_explicitness.py:275](/Users/bk/github/research-plans/tests/test_gate_explicitness.py:275)
- Define a bundle-state matrix for every validation and integrity outcome, including zero-artifact capture.
- Make Reopen available for verdictless finalized bundles, and revise the “accepted bundle” routing language.
- Replace or version report-marker `verdict`; update Reports, Tracker, Timeline, hosted comment parsing, and legacy tests.
- Preserve `/sync`’s adoption cutoff, hosted-comment pull, split checks, plan-revision logic, and drift detection inside the new tail.
- Parse and display `auto-captured` decision entries, while preserving the append-only decision-log rule. [board.md:28](/Users/bk/github/research-plans/commands/board.md:28)
- Define headless defaults for the initial AskUserQuestion, validation, reporting preference, plan approval, and deviation stop.
- Persist batch approval state, stale-entry replacement, and request-change results. Handle deleted drafts and a newly created higher draft version.
- Specify `/plan 03 04 05` behavior for missing, already signed, already drafted, and partially approved components.
- Resolve pre-execution commit policy.
- Rerun the repository token report and externalize the execution runbook instead of duplicating results/sync/board instructions. The repository already treats command descriptions as unconditional cost and recommends reference externalization. [token-report.md:5](/Users/bk/github/research-plans/docs/evaluation/checkup/token-report.md:5), [token-report.md:45](/Users/bk/github/research-plans/docs/evaluation/checkup/token-report.md:45)
- Update QUICKSTART, reference documentation, results-adopt, split criteria, screenshots, and tests, not only README.

### v0.21

- Scope typography changes to PlanReader if they are not intended to alter results, reports, tracker prose, and other `.prose-md` surfaces.
- Measure line length with sidebar expanded/collapsed, docked feedback, desktop, and mobile.
- Implement step cards through parsed Markdown structure or an explicit authoring marker; test nested lists, paragraphs, links, code, details, and annotations.
- Keep metadata parsing tolerant of legacy plans, missing lines, links, malformed metadata, and preamble text. The current parser already exposes component/date/provenance/supersedes fields. [parse.ts:294](/Users/bk/github/research-plans/board/src/lib/parse.ts:294)
- Extend `OutlineEntry` or add separate active-heading state; it currently has no active property. Define behavior in diff mode and for collapsed method sections. [outline.ts:1](/Users/bk/github/research-plans/board/src/lib/outline.ts:1), [Sidebar.tsx:150](/Users/bk/github/research-plans/board/src/components/Sidebar.tsx:150)
- Verify that DOM wrapping and scroll-spy updates do not destabilize annotation anchors.

## 4. Risks and tradeoffs worth naming

- **Ticket security remains strong if current invariants survive.** Live POSTs are local-host and token protected, persistent approval rereads disk, tickets bind exact normalized content, and agents cannot create ticket files through Write/Edit. [board.py:1226](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1226), [signoff_gate.py:245](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/signoff_gate.py:245)
- **General batch approvals are less auditable than live approvals.** Batch tickets have no `orderActionId`; that is intentional today, but broader use makes the short-lived hash ticket itself the entire authorization record. [board.py:2315](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:2315)
- **Collaborator ingress must retain action stripping.** Hosted or remote comments are data only, and `ACTION_KEYS` includes legacy verdict actions. Verdict UI removal is not a reason to relax that rule. [board.py:2005](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:2005), [board.md:24](/Users/bk/github/research-plans/commands/board.md:24)
- **Backward compatibility needs asymmetric scorecard matching.** Preserve exact signed-path matching for existing cards, then apply any new canonical draft fallback only when unambiguous.
- **Autopilot improves continuity but weakens visible authorship checkpoints.** Validation is advisory and cannot replace researcher confirmation of interpretation.
- **A larger `/execute` command raises both prompt cost and drift risk.** Duplicated rules across execute/results/sync/board will become inconsistent; the existing reference-file pattern is the safer source of truth.

## 5. Open questions

1. What replaces verdict as the durable bundle state: capture completion, validation status, integrity status, or a composite?
2. When should Reopen be available: every finalized bundle, only validated bundles, or only bundles with substantive findings?
3. How do `unverifiable`, `skipped`, `not-applicable`, integrity failure, and zero-artifact execution map to tracker status?
4. Must a prospective plan be committed before execution? If yes, where is the required researcher-approved stop?
5. Should draft scoring migrate the scorecard at sign-off, or should scorecards gain a content-based canonical identity?
6. Should review/report actions suppress auto-close, or should their eventual relaunch explicitly open a new browser window?
7. Is the headless gate bypass an accepted, documented exception to researcher approval, or should headless sessions receive a separate approval mechanism?
8. Are batch request-change decisions required to survive server or agent interruption?
9. Does one initial report preference apply to every component in a multi-component execution, or should it be stored per component?
10. Does “amend” an auto-captured decision mean appending a corrective decision, consistent with the immutable log, or editing the original entry?