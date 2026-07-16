Overall verdict: the plan has the right scope and names every promised artifact, but it is not execution-ready. It can satisfy several task acceptance bars while leaving important scenario rows untested, measuring the wrong token quantity, or running against something other than the pinned snapshot.

## 1. Feasibility issues, ordered by severity

1. **Critical: The scenario matrix is not an enforced coverage gate.**

   The spec calls the matrix a “coverage-and-evidence matrix” that every later phase completes ([design §4](/Users/bk/github/research-plans/docs/specs/2026-07-15-plugin-checkup-design.md:44)). Task 3 creates rows, but later tasks do not have to close them:

   - Task 7 does not update the matrix at all.
   - Task 8 closes only “board-related” rows.
   - Task 9 names S5, S7, S9, and S10, plus part of S2.
   - Tasks 11 and 12 do not require every row to have a terminal result.

   Consequently, the plan can clear all twelve task acceptances with S4 fault injection, S8 Python/TypeScript parity, much of S11, and several extension rows still blank. This breaks the plan’s central architecture claim at [plan lines 5 to 7](/Users/bk/github/research-plans/docs/plans/2026-07-15-plugin-checkup-plan.md:5).

2. **High: Task 7 is not yet an executable clean-room harness.**

   The loop is described, but the mechanics needed to run it are missing:

   - `/plan` requires a browser sign-off gate and then automatically runs review and board ([plan command](/Users/bk/github/research-plans/commands/plan.md:30)). A headless seeded prompt cannot approve that gate without a browser automation step. Bypassing it would invalidate S1.
   - There is no `/execute` command in `commands/`; the harness must define the ordinary prompt and expected execution artifact.
   - Separate `claude -p` calls are fresh sessions unless the harness supplies a session/resume mechanism. None is specified.
   - [`new-walkthrough.py`](/Users/bk/github/research-plans/scripts/new-walkthrough.py:147) only scaffolds data and prints interactive launch instructions. It does not implement the loop.
   - Task 7 says “install ... pinned to the audit version” but gives no way to make the marketplace source resolve to `60eaede`.
   - Its acceptance allows the loop to “complete (or its dead-ends are documented)” ([Task 7](/Users/bk/github/research-plans/docs/plans/2026-07-15-plugin-checkup-plan.md:223)). That lets a nonfunctional harness pass without producing workflow evidence.

3. **High: Task 2 builds a static prompt-footprint calculator, not the context model it claims.**

   The separation of the main context from the dispatched reviewer is correct. The formulas are not sufficient for “peak single-context input per model invocation”:

   - A real invocation contains conversation history, prior model and tool outputs, newly loaded instructions, and possible compaction. Summing unique surface sizes does not measure that.
   - A command can cause multiple model invocations and tool rounds. `cumulative(flow)` sums each modeled context once, not every invocation’s input.
   - The encoded `/plan` flow omits instruction surfaces that the real command reaches, including the execution-plan template and the full `/review` command before board ([plan command lines 26 and 34](/Users/bk/github/research-plans/commands/plan.md:26)).
   - Cached versus uncached input is promised by the spec, but Task 2 defines no fields or formula for it.

   It is buildable if renamed to “estimated static instruction footprint per modeled context” and “sum of modeled static footprints.” It is not buildable as an honest measurement of actual invocation context from file sizes alone.

   `ceil(bytes/4)` is defensible as a rough ranking proxy for mostly English Markdown. It is not defensible as an exact token count or narrow acceptance threshold. The report should retain bytes, label estimates clearly, and give an uncertainty range.

   Task 10 cannot empirically refine this proxy from ordinary transcripts because total input includes system instructions, project data, history, and tool output. The spec itself says semantic attribution requires a controlled plugin-on versus minimal-baseline comparison ([design line 125](/Users/bk/github/research-plans/docs/specs/2026-07-15-plugin-checkup-design.md:125)); Tasks 7 and 10 do not schedule that comparison.

4. **High: The snapshot is declared but not pinned operationally.**

   Task 1 proves that commit `60eaede` exists, then runs tests and builds in the current checkout ([Task 1 steps 1 to 3](/Users/bk/github/research-plans/docs/plans/2026-07-15-plugin-checkup-plan.md:49)). It never checks out the snapshot or establishes a snapshot worktree used by later commands.

   I verified that the current shipped surfaces happen to match `60eaede`, so this is not causing a discrepancy today. It will become one as soon as `main` changes. The plan needs a dedicated snapshot root, recorded SHA, and a hash or `git diff --exit-code` assertion before every probe group.

5. **Medium: Task 1’s baseline cannot meet its stated acceptance as written.**

   - It says “three suites” but runs only Python and board tests. The spec identifies the web-template suite as the third baseline suite ([design lines 93 to 95](/Users/bk/github/research-plans/docs/specs/2026-07-15-plugin-checkup-design.md:93)). The omitted suite currently passes 33 tests.
   - `npm run build` writes to a shipped file through `cp dist/index.html ../skills/managing-research-plans/assets/board-template.html` ([board/package.json](/Users/bk/github/research-plans/board/package.json:9)). That contradicts the plan’s “nothing under `skills/` or `board/` is touched” constraint.
   - The plan’s expected board count is stale: the checked tree has 278 passing tests, not 276.

   Evidence: [board tests](/Users/bk/github/research-plans/logs/2026-07-15_plan-audit-board-tests.log), [web-template tests](/Users/bk/github/research-plans/logs/2026-07-15_plan-audit-web-template-tests.log).

   Environment caveat: Python produced 313 passes and 47 failures here solely because this managed sandbox forbids binding `127.0.0.1`; the first failures show `PermissionError` at the test port allocator. That is not a repository defect, but it shows that Task 1 needs a network-capability preflight and an environment-qualified verdict. See the [Python log](/Users/bk/github/research-plans/logs/2026-07-15_plan-audit-python-tests.log).

6. **Medium: Some security acceptance bars would overstate runtime assurance.**

   Task 9 proposes confirming that the hosted private blob is not URL-readable by reading implementation and mocked tests. The code does request `access: "private"` ([blobstore.ts](/Users/bk/github/research-plans/skills/managing-research-plans/assets/web-template/lib/blobstore.ts:11)), but that proves an SDK/configuration contract, not live Vercel behavior. Without a deployed attempt, the verdict must be “static contract holds; runtime not verified.”

   Task 4 also names the wrong variables: the code uses `BOARD_SESSION_SECRET` and `BOARD_PULL_KEY` ([auth.ts](/Users/bk/github/research-plans/skills/managing-research-plans/assets/web-template/lib/auth.ts:68)), not `SESSION_SECRET` and `PULL_KEY`.

## 2. Completeness gaps versus the spec

All eight dimensions are named, and all six primary deliverable groups from the spec have corresponding files in the plan. The gaps are in substantive coverage:

- **Install and upgrade:** The spec requires marketplace add, install, restart, update, pin, and uninstall. Task 7 only schedules add/install/restart.
- **Missing-tool portability:** The spec names no pandoc, codex/agy, or node. Task 7 mentions only pandoc and node, and only “if feasible.” Changing `CLAUDE_CONFIG_DIR` does not remove binaries from `PATH`.
- **Surface inventory:** Task 6 omits `.claude-plugin/plugin.json`, `marketplace.json`, `hooks/hooks.json`, `scripts/new-walkthrough.py`, the test suites as behavioral documentation, and CHANGELOG. These are explicit spec surfaces.
- **Hook boundary:** [`hooks.json`](/Users/bk/github/research-plans/hooks/hooks.json:3) gates only `Write|Edit`. The spec explicitly identifies shell redirection as a documented boundary, but no task evaluates that authority assumption.
- **Scenario closure:** S4 has no fault-injection owner; S8 has no shared paired fixture; S11 does not explicitly cover `/adopt` or `/renew`; S2 only gets the ticket-forgery fragment; S5 lacks the pull-crash durability attempt; S6 lacks an edit/save/regenerate walkthrough.
- **Task 3 extensions:** Init update/minimal modes, renew immutability, adopt batch-gate lifecycle, drift versioning, provenance honesty, the three report entry paths, and frozen-boot reconciliation are added to the matrix but not assigned to later probes.
- **Token refinement:** No plugin-on versus minimal-baseline paired arm is present.
- **Supply chain:** `check_update.py` fetching GitHub `main` and `npx vercel` are inventoried but do not receive concrete Task 9 cases or verdicts.
- **Verification baseline:** The web-template test suite is missing.
- **Scoring:** The spec promises a derived impact × likelihood × reach × confidence priority. The plan supplies categories but no scales, combination rule, or decision table.

## 3. Task-level problems

| Task | Material problem |
|---|---|
| **1** | Does not establish a snapshot worktree; omits web-template tests; board build writes a shipped asset; isolation verification is self-report rather than an inventory/debug oracle. |
| **2** | Labels static surface sums as actual context input; omits real `/plan` surfaces; has no cached/uncached definition; self-test covers only toy aggregation and cannot detect an incomplete inventory. |
| **3** | Produces a useful matrix, but lacks a `probe task/owner` field and no later acceptance requires all rows to close. |
| **4** | Uses incorrect secret names; enumerates local and supply-chain actors without ensuring Task 9 owns cases for them. |
| **5** | “Every” rule, xref, and external assumption is not checkable without an enumerated source inventory and saved search results. |
| **6** | Omits manifests, hooks, walkthrough scaffold, tests, and CHANGELOG. Surface-group subagents are poorly aligned with cross-file scenario invariants. |
| **7** | Gate automation, session continuity, execution prompt, exact fixtures, snapshot installation, missing-tool PATH isolation, update/pin/uninstall, and per-stage oracles are unspecified. Captured `*.json` is also not covered by the proposed `*.jsonl` ignore rule. |
| **8** | No reproducible fixture is created. Every view requires populated plans, scorecards, results, reports, model data, and archive state. The development fixture is explicitly development-only ([dev-data.ts](/Users/bk/github/research-plans/board/src/dev-data.ts:1)). |
| **9** | Hosted runtime claims exceed code-only evidence; same-machine and supply-chain actors are not worked; S2 is only partially closed. |
| **10** | Aggregate transcript totals cannot refine static instruction size without a paired denominator; JSON field mapping, invocation labeling, sample size, and effective cache formula are absent. |
| **11** | Scales and derivation rules are missing. Re-reading the same lines is not independent behavioral verification. No matrix-completeness gate precedes scoring. |
| **12** | “Promote every `CONFIRMED`/`P2` finding” is ambiguous and can admit unverified P2s ([Task 12](/Users/bk/github/research-plans/docs/plans/2026-07-15-plugin-checkup-plan.md:334)). `git status` cannot prove an allowlisted audit diff, especially with pre-existing untracked files and prior task commits. |

## 4. Sequencing and dependency problems

- Task 2 hard-codes canonical flows before Task 3 and Task 5 establish the scenario and contract inventories. The flow definitions should be generated from, or checked against, those artifacts.
- Task 7 depends on Task 3 fixtures and oracles, but the matrix is not passed into its interface or acceptance.
- Task 8 needs a full synthetic board fixture before the server starts. Fixture construction belongs in Phase 0 or at the beginning of Task 8 as a committed audit artifact.
- Task 10’s valid empirical comparison depends on a plugin-off/minimal-baseline arm in Task 7. Adding it after transcript collection is too late.
- Task 9 is correctly ordered after the threat model, but its fixed step list does not consume every boundary the threat model is required to produce.
- Task 11 should be blocked until every scenario row has `PASS`, `FAIL`, or `NOT RUN` with a reason and evidence path.

## 5. Risks to conclusion quality

- **Inference:** Surface-group subagents will tend to report local prompt or code observations, while the important defects concern cross-file transitions. Controller confirmation that a cited line exists does not verify the cross-file interpretation or reveal omitted surfaces.
- **Inference:** A fresh agent using the same matrix, prompt, and assumed oracle can reproduce the same mistaken assumption. High-impact behavioral findings need a fixture-based rerun with expected and actual state captured, not merely a second reading.
- **Inference:** One clean run and one author-environment run cannot attribute tone or behavior differences to configuration. Model nondeterminism, session history, permissions, plugin version, and available binaries all differ unless explicitly held constant and runs are repeated.
- Transcript totals will confound plugin instructions with project data, tool output, conversation history, and system instructions. Calling divergence “empirical refinement” would be misleading.
- Code-only hosted security conclusions may be presented as deployed guarantees.
- An incomplete board fixture can make empty states look like successfully exercised views.
- Task 12’s P2 promotion wording risks turning read-confirmed hypotheses into final findings.
- A single controller spanning twelve long tasks may lose matrix state across handoffs or context compaction. This is an inference, but it is mitigated by making the coverage ledger machine-checkable rather than relying on memory.

## 6. Single highest-leverage improvement

Turn `scenario-matrix.md` into an executable coverage contract and make complete closure a hard gate before Task 11.

For every row, require: pinned snapshot SHA/root, probe task and owner, exact fixture, exact command or interaction script, oracle, expected observable, actual observable, evidence path, run count, environment, and terminal status (`PASS`, `FAIL`, or `NOT RUN` with reason). Phase 2 should iterate this ledger rather than running generic probes, and an automated check should refuse synthesis while any required field is blank.

This one change would expose the missing S4/S8/S11 probes, force clean-room and board fixtures to become concrete, reduce subagent omissions, strengthen handoffs, and prevent a polished but incomplete findings document.

## 7. Open questions

1. Is “real install path” meant to test the public marketplace source, a local marketplace pointed at a `60eaede` worktree, or both? Only the latter guarantees the snapshot if public `main` moves.
2. Is live Vercel deployment authorized for S7, or must hosted findings be explicitly limited to static contracts and mocked tests?
3. May the scripted arm bypass the sign-off gate? If yes, it cannot close S1; a separate browser-driven gate arm is required.
4. Which token outcome is primary: static plugin instruction footprint, context occupancy, or billed uncached input? They require different measurements.
5. What capabilities are assumed for the “local same-machine attacker”?
6. Is a `read-confirmed` static P2 eligible for the final document, or must every promoted finding have an explicit verification status?