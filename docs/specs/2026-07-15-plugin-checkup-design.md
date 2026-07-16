# Plugin checkup — comprehensive audit design

**Date:** 2026-07-15 · **Audit target:** v0.18.0, the immutable snapshot at commit `60eaede` · **Status:** design, pre-plan

A comprehensive audit of the research-plans plugin. This document scopes the audit; it does not perform it and ships no fixes. A separate execution plan (`docs/plans/2026-07-15-plugin-checkup-plan.md`) phases the work; the prioritized findings and the fix batches are its output. This is revision 2, after a cross-model design review (`docs/specs/2026-07-15-codex-review-plugin-checkup.md`) whose central lesson reshaped the audit: **the unit of audit is a workflow invariant or user scenario, not a file** (§4).

## 1. Motivation

The plugin has grown to eighteen releases through iterative fix-as-you-use development. That process is good at adding coherent features one at a time and bad at catching problems that only show up across the whole surface — and, more importantly, across whole *workflows*. The plugin's real behavior lives in state transitions that cross several files (a draft becomes a ticket becomes a signed version; a results bundle is staged, finalized, verdicted, reported; a hosted comment is pulled, routed, acknowledged). Those seams — not individual files — are where data loss, stale state, and double-application hide. A file-by-file read catches prose drift; it does not prove a workflow is correct. Five worries motivate the checkup:

1. **Token efficiency.** Every command carries dense, deliberately-redundant instruction text. Some redundancy is load-bearing (restated invariants keep an agent honest); some is pure cost paid every session. Nobody has measured which is which, or distinguished peak context pressure from cumulative workflow text.
2. **Prompt coherence.** Ten command files, a skill, three agent templates, and a rubric reference each other and restate shared rules. Prompts authored across eighteen releases may no longer agree with each other or with the code they describe (a confirmed live example: `docs/reference.md` describes the *old* board lifecycle that `board.md` and `board.py` replaced).
3. **Workflow correctness.** The cross-file state transitions above have never been audited as transitions. String-level duplication maps do not prove that two hand-synchronized consumers (Python and TypeScript) behave identically.
4. **Security & privacy.** Untrusted input (collaborator comments, artifacts, hosted-board data) crosses trust boundaries; authority is defined partly in command-prompt frontmatter, not only in runtime code; and hosted publishing carries retention and data-minimization questions distinct from "does auth hold."
5. **Random-user portability.** The author's local environment (a global `CLAUDE.md`, superpowers/napkin skills, `codex`/`agy` CLIs, `/journal-figures` and `/journal-tables` skills, a tuned permission allowlist, a Fable/max session) may mask what a fresh user experiences — including install, upgrade, interactive interview burden, permission walls, and missing-tool degradation. The plugin's own experience is not evidence of a stranger's.

## 2. Dimensions (the lenses)

Each finding is tagged with one or more dimensions. The core five are joined by three sub-dimensions added in the revision-2 scoping.

| Dimension | The question it asks |
|---|---|
| **Token efficiency** | What does each surface cost, how often is it paid, and how much is load-bearing vs. removable? Peak single-context input vs. cumulative workflow input, cached vs. uncached. |
| **Prompt coherence** | Do the prompts agree with each other and with the code? Is every shared rule stated once and referenced, or restated (and drifting)? |
| **Workflow correctness** | Do the cross-file state transitions preserve their invariants — no data loss, no stale state, no double application — including across Python/TypeScript consumers? |
| **UX / UI** | Where does a real session or board interaction stall, confuse, or dead-end? Is the interaction model consistent? Plus **accessibility/viewport**: keyboard-only, 200% zoom, narrow screen. |
| **Security** | Can untrusted input cross a trust boundary? Are the local and hosted mutation surfaces guarded? Do the command-prompt tool grants and untrusted-input routing rules hold? |
| **Privacy / retention / least-privilege** *(new)* | Data minimization (full-board-always publishing), collaborator offboarding, comment/cookie retention, and whether each command's frontmatter tool grant is the minimum it needs. |
| **Portability** | What does a user with none of the author's setup experience — install, upgrade, interview burden, permission walls, missing-tool degradation, tone shifts? |
| **Install / upgrade / supply-chain** *(new)* | The real marketplace-add → install → restart → update → pin → uninstall path, and the trust posture of runtime fetches (`check_update.py` pulls from GitHub `main`; web publish shells `npx vercel`). |

## 3. Locked decisions

From two scoping rounds with the researcher (2026-07-15). The plan inherits all of these.

1. **Fix policy — audit-first, then batched fixes.** Complete the audit, produce one prioritized findings document, then the researcher chooses fix batches. Each batch is its own worktree branch and PR, cross-model reviewed (`/codex`) and regression-checked against the walkthrough harness before merge. No fixes ship during the audit.
2. **Clean-room depth — scripted loop + a few interactive sessions + author-env diff.** A headless scripted loop for the mechanical, token, tool-absence, and install/upgrade findings; **plus a small number of genuinely-interactive clean-env sessions** (driven as a novice, answers not pre-seeded) to probe discovery, interview burden, permission walls, and recovery; plus the identical scripted loop under the normal environment for a diff. Not the full model/OS matrix.
3. **Token remediation — measure, then decide per finding.** Build the full token accounting first; every proposed reduction carries a behavior-risk note; the researcher approves reductions individually. No hard numeric budget up front.
4. **Sequencing — checkup first.** Audit the v0.18.0 snapshot as shipped. The board-sidebar Outline+Files branch (`worktree-board-sidebar-outline`, built and pushed, unmerged) and the codex-agents-on-the-board idea both stay parked until the checkup lands.
5. **Audit structure — workflow-scenario-driven, phased Instrument → Sweep → Probe → Synthesize.** The unit of audit is a workflow invariant or user scenario (§4). Phases organize the work; the scenario matrix drives it. Each surface gets **one primary structured read**, with targeted rereads permitted where cross-file behavior demands it (the earlier "read every file exactly once" rule was dropped — it was both impossible and a false economy).
6. **Scope (revision 2) — the three added sub-dimensions are all in:** accessibility/viewport, install/upgrade/supply-chain, and privacy/retention/least-privilege, each bounded (§7).
7. **The audit runs against the pinned snapshot.** The harness checks out or installs the immutable `60eaede` (v0.18.0), never whatever local `main` holds when the audit runs — `main` may move (the sidebar branch could merge mid-audit).

## 4. The unit of audit: workflow invariants and scenarios (the spine)

The centerpiece, built first in Phase 0 and completed through the probes. A single **coverage-and-evidence matrix** (`scenario-matrix.md`) enumerates the workflows and invariants the plugin must uphold, and every later phase fills its columns. Each row carries: the scenario/invariant · all owning surfaces (files) · the expected observable result · the static evidence · the required probe + fixture · a pass/fail oracle · the environment + version · the result, confidence, and finding-id.

This is what turns "these two files restate a rule" into "this transition does/doesn't preserve its invariant, here is the reproducer, here is the oracle." Representative rows (the Phase-0 task completes and extends the set):

| # | Scenario / invariant | Owning surfaces | Expected observable | Probe |
|---|---|---|---|---|
| S1 | `/plan` draft → sign-off gate → signed `vN.md` → auto-chain to review + board | plan.md, signoff_gate.py, board.py, review.md | Signed bytes == approved bytes; ticket consumed once; score saved; board opens once | clean-room + gate unit tests |
| S2 | Draft times out → persisted `.draft-vN.md` → board Approve mints ticket → ticketed write | plan.md, signoff_gate.py, board.md | No lost draft; agent-written ticket rejected as forgery; recovery routes through board | scripted + test suite |
| S3 | `/results` stage → finalize → verdict → report | results.py, results.md, report.md, board.md | Bundle immutable; verdict written once; report gated on substantive findings | clean-room + py tests |
| S4 | Board order → durable `.board-feedback.md` → route → `--ack` | board.py, board.md | Crash before ack re-offers the order; ack only after routed work | live board + fault injection |
| S5 | Hosted comment → `--pull` → inbox → route → pulled-state update | board.py, board.md, web-template | No comment lost on crash; untrusted content never executed as instruction | security + web-template tests |
| S6 | Model-profile edit → `models.py generate` → agent regeneration | models.py, models.md, board Models tab | Stale agents removed; user-owned agents never overwritten; restart note when needed | py tests + live board |
| S7 | Full-board publish → collaborator access | board.md, web-template (auth/gate/blob) | Password gate holds; private blob not URL-readable; cookie/rotation behavior correct | security pass |
| S8 | Substantive-finding rule agrees across Python and TypeScript | results.py, findings.ts | Identical verdict on identical bundle inputs | paired scenario test |
| S9 | Confused-deputy: collaborator field cannot forge a researcher action | board.py (fence parse), web-template, board.md routing | Action keys stripped on hand-delivered ingress; fence markers neutralized; last-fence rule | security pass (adversarial) |
| S10 | Local mutation surface is not reachable cross-origin | board.py (127.0.0.1 bind, `local_request_ok`, per-boot `board_token`) | Artifact-origin fetch to `/api/*` rejected; token enforced (confirmed board.py:1216) | security pass |
| S11 | `/init`, `/adopt`, `/renew` create exactly the artifacts they claim, and headless behavior is honest | init.md, adopt.md, renew.md | No silent no-op; headless dead-end surfaced or fixed | clean-room (scripted + interactive) |

Keeping Instrument → Sweep → Probe → Synthesize as the work phases, the matrix is the connective tissue: the sweep files findings *against* rows, the probes *close* rows with reproducers and oracles, and synthesis ranks what the rows exposed.

## 5. Surface inventory

Measured sizes ground the token dimension and set reading order. Bytes are the shipped files; token figures are ≈ bytes/4 (a rough proxy, refined by real measurement in Phase 0).

**Prompt surfaces (session-loaded instruction text):**

| Surface | Bytes | ≈ tokens | Load trigger |
|---|---|---|---|
| commands/board.md | 34,825 | 8,700 | every `/board` (of which the web-publish runbook, step 10→EOF, is 12,652 B ≈ **36%**) |
| commands/results.md | 18,048 | 4,500 | every `/results` |
| SKILL.md | 16,293 | 4,100 | research-session start |
| commands/init.md | 9,430 | 2,400 | every `/init` |
| references/plan-rubric.md | 9,817 | 2,450 | every `/review` (+ dispatched to reviewer) |
| commands/plan.md | 9,123 | 2,300 | every `/plan` |
| commands/sync.md | 8,360 | 2,100 | every `/sync` |
| commands/adopt.md | 7,278 | 1,820 | every `/adopt` |
| commands/report.md | 6,241 | 1,560 | every `/report` |
| commands/renew.md | 5,753 | 1,440 | every `/renew` |
| commands/review.md | 5,539 | 1,385 | every `/review` |
| execution-plan.md (template) | 5,386 | 1,350 | `/plan`, `/adopt` (authoring) |
| commands/models.md | 3,346 | 840 | every `/models` |
| rp-plan-reviewer.md (agent) | 4,537 | 1,130 | each dispatched plan review (separate subagent context) |
| rp-board-reviewer.md (agent) | 2,653 | 660 | each dispatched board review (separate context) |
| rp-results-validator.md (agent) | 2,041 | 510 | each dispatched validation (separate context) |
| 6 smaller templates + 2 references | 17,700 | 4,420 | context-dependent |
| **always-on floor:** 10 command `description:` lines + the skill `description:` | **2,094** | **~523** | **every session, every project — the plugin's unconditional cost** |

**Code + config surfaces (workflow, security, behavior):** board.py (2,517 lines), results.py (480), signoff_gate.py (412), models.py (477), check_update.py (230), new-walkthrough.py (163); board React UI (~14,500 lines across `board/src`); the Vercel web-template (`assets/web-template/`); **`.claude-plugin/plugin.json` + `marketplace.json`** (the manifest — the sign-off guarantee is partly a manifest-level contract); **`hooks/hooks.json`** (registers *both* hooks; the sign-off matcher is only `Write|Edit`, so shell redirection escapes the gate — a documented boundary the security pass must treat).

**Verification baseline (a Phase-0 surface in its own right):** the seven Python suites (~5,000 lines: test_board, test_results, test_models, test_check_update, test_gate_archive, test_gate_explicitness, test_gate_results), the ~34 board vitest files, and the seven web-template tests. Phase 0 records that these are green and that the board builds and typechecks, *before* any finding is filed — a finding that contradicts a passing test is suspect, and the tests document intended behavior for the scenario matrix.

**Docs (portability + accuracy):** README.md, QUICKSTART.md, docs/reference.md, docs/hosting-the-board.md, CHANGELOG.md, docs/RELEASING.md.

**Token strata** (frequency is half the lever): **always-on-everywhere** (the ~523-token floor, paid in every session in every repo including ones that never use the workflow — highest leverage per byte); **research-session start** (SKILL.md body when the skill triggers); **per-invocation** (a command body when its command runs); **per-dispatch** (an agent template + rubric/plan payload, in a *separate* subagent context, each time a reviewer/validator is spawned).

## 6. Phase 0 · Instrument

Build the reusable baselines and the spine, before findings. Artifacts land under `docs/evaluation/checkup/`. These involve judgment (an agree/drift verdict, a dependency classification, a scenario's expected observable are all judgments) — "instrument" means *built first and reused*, not *mechanical*.

1. **Scenario matrix** (`scenario-matrix.md`) — §4. Enumerate the workflows/invariants, their owning surfaces, expected observables, and the probe each needs. This drives every later phase.
2. **Threat model** (`threat-model.md`) — authored *here, first*: assets (plans, decision log, results, hosted comments, secrets), actors (researcher, collaborator, a malicious collaborator, a local attacker, artifact-embedded code), trust boundaries, and authority sources (including the command-prompt frontmatter tool grants). The adversarial security pass in Phase 2 selects its cases *from* this model, rather than producing the model as a by-product.
3. **Verification baseline** — run the three suites, the board build, and the typecheck; record green/versions. (§5.)
4. **Token accounting** (`token-report.md` + its regeneration script) — per-file static size; per-stratum totals; and, crucially, **three distinct metrics** kept separate: (a) *peak single-context input* per model invocation — the tokens actually loaded into one context, with the main session and each dispatched subagent measured apart; (b) *cumulative workflow input* — the sum across a flow's invocations, labeled as cumulative, never as a single-context number; (c) *cached vs. uncached* where the headless JSON exposes it. The naive "sum the whole `/plan`→reviewer→board chain into one number" is explicitly rejected — the reviewer runs in a separate context, so its tokens are a separate invocation, not added pressure on the main one.
5. **Contract inventory** (`contract-map.md`) — every rule/schema/invariant stated in ≥2 places, with locations and an agree/drift verdict. Seeds: the model-nudge paragraph (plan.md, sync.md, SKILL.md — near-verbatim); the initialized-project gate (eight commands — all but init and renew); the substantive-finding rule (results.py + findings.ts + report.md prose — a hand-kept Python/TypeScript duplicate); the scorecard schema (rubric + rp-plan-reviewer + review-scorecard template + review.md); the sign-off/ticket rules (SKILL.md + plan.md + board.md + signoff_gate.py); the provenance rules (SKILL.md + results.md + report.md); the board lifecycle (board.md vs. the stale docs/reference.md).
6. **Cross-reference graph** (`xref-map.md`) — every "see X step N" reference, verified to resolve. Confirmed instances: review.md-step-4 cited from sync/adopt/board; /plan-step-5 from board/sync/adopt; /init-step-1 and -step-6 from renew. Tells us which files are safe to restructure and which have inbound references that must move with them.
7. **Dependency / bleed inventory** (`dependency-map.md`) — every reference assuming something outside a bare Claude Code install, classified hard-dependency / graceful-fallback / cosmetic, plus a supply-chain note per external fetch. Entries: `pandoc` (report.md, `command -v` guarded), `codex`/`agy` (board.md review paths, no guard seen), `/journal-figures`+`/journal-tables` (guarded "if available"), Node.js/Vercel (web publishing), `gh` (publish paths), the `AskUserQuestion` headless fallback (friction-log 1.1), model aliases (`fable`/`opus`), and the two runtime fetches (`check_update.py`→GitHub `main`; `npx vercel`).

## 7. Phase 1 · Sweep, and Phase 2 · Probe

**Phase 1 · Sweep.** One primary structured read per surface, in dependency order (SKILL.md → commands → templates/agents → scripts → board UI → web-template → docs), each read against the Phase-0 maps and matrix. Every observation becomes a finding record — `id · dimension(s) · surface:location · scenario-row(if any) · provisional-severity · evidence · proposed-direction · effort · risk-note` — accumulating in `findings-raw.md`. The provisional severity is a tag for triage, not the final ranking (§8). Runtime claims are marked **to-verify** and closed by a probe or a direct code check, never asserted from a read. Targeted rereads are allowed where a scenario row needs cross-file tracing.

**Phase 2 · Probe.** The empirical work, closing scenario rows and answering what static reading cannot.

- **7.1 Clean-room — scripted + interactive + install/upgrade + author-env diff.** First confirm the isolation mechanics against current Claude Code docs (claude-code-guide), not assumed: a fresh `CLAUDE_CONFIG_DIR` (or equivalent) with no global `CLAUDE.md`, no superpowers/napkin/plain-writing skills, default permissions. **Do the real install path** — marketplace add → install → restart → `/init` — rather than starting pre-installed (this is the install/upgrade dimension), and exercise update/pin/uninstall. Then two probe styles: (a) a **headless scripted loop** (init → plan → execute → sync → results → report → board --export) capturing per-stage transcripts and token JSON, logging every dead-end, permission prompt, and missing-tool degradation (no pandoc, no codex/agy, no node); and (b) **a few genuinely-interactive clean-env sessions** driven as a novice with answers *not* pre-seeded, to probe discovery, interview burden, permission walls, and recovery — the things scripting-to-completion masks. Run the scripted loop again under the normal environment and diff. **Attribution discipline:** with a small number of runs, any clean-vs-author difference in tone/verbosity/behavior is filed as a *candidate* needing paired confirmation, never asserted as environment-caused. Findings land as friction-log Run 2 (clean) and Run 3 (author-env). **Claim scope:** results describe fresh-config behavior *on this Claude Code version and macOS* (shell-specific assumptions like `/dev/null` and `set -o pipefail` are noted as portability caveats), not universal random-user portability.

- **7.2 Live board UX + accessibility/viewport.** Drive the live board over HTTP with Playwright on a synthetic project (re-resize after each navigate, per the known gotcha), exercising every view (Tracker, PlanReader + score panel, Results, Reports, Timeline, Models, Archive) and the annotation flow. Check the interaction model against the researcher's stated preference — one gesture everywhere, drag-select → comment — flagging any click-to-act or native-dialog affordance that violates it. Then a **bounded accessibility/viewport pass**: keyboard-only reach of the primary board actions (the annotation composer starts from `onMouseUp` — is there any keyboard path?), 200% zoom, and narrow-viewport behavior (the overlay/scrim under 1024px; the fixed `w-56` sidebars; the single-flex-row header). Not a full WCAG audit; touch commenting is a known deferred gap (v0.13) and noted as such, not filed as new.

- **7.3 Security + privacy, threat-model-driven.** Read board.py, signoff_gate.py, results.py, the web-template, **and the command-prompt authority surfaces** (the frontmatter tool grants — `/board` hands out codex/agy/vercel/node — and the untrusted-input routing rules in board.md) as an adversary, working the cases the Phase-0 threat model selected. Re-verify — do not assume from prior notes — each invariant (S5, S7, S9, S10): the confused-deputy fence channel, artifact MIME/CSP hardening, the Markdown link-scheme allowlist, ticket forgery rejection, the local-mutation guard, and the hosted auth/gate/private-blob path. Each gets a verdict: holds / regressed / never-covered. Add the concrete candidate: `printf '<secret>' | npx vercel env add` embeds the secret in the Bash tool invocation (and thus potentially the session transcript) even though it is not a CLI argument — threat-model it, don't jump to a verdict. **Privacy/retention/least-privilege** rides here: data minimization (full-board-always publishing), collaborator offboarding (revocation = password/secret rotation), retention (comments persist until `--web-clear`; 30-day cookies), and whether each command's tool grant is the minimum it needs.

- **7.4 Transcript mining (governed).** The empirical half of the token dimension. Parse real session transcripts from **the author's own research repos only** to measure what `/plan`, `/sync`, `/board` actually consumed, compared against the Phase-0 static accounting. **Governance:** only aggregate token counts leave the transcripts — no prompt text, tool output, or project data is copied into `docs/evaluation/`, and no transcript is committed. The known limitation: headless JSON gives input/output/cache totals, not a semantic instruction-vs-data split — that split comes from controlled paired runs (plugin-on vs. a minimal baseline) or from the measured prompt-surface sizes, not from transcript parsing. If real transcripts are too sparse, the clean-room JSON is the fallback source.

## 8. Phase 3 · Synthesize

**8.1 Severity, scored not categorized.** Each surviving finding is scored on four axes — **impact** (data loss / wrong state / security-or-privacy exposure / recurring cost / friction / cosmetic), **likelihood** (how often the triggering condition occurs), **reach** (how many users, sessions, or projects), **confidence** (how sure it is real) — and a priority is *derived* from them, not assigned by category. This fixes the earlier scheme's blind spot: a data-loss bug in a rare path and a token waste paid every session are not both "P1." Roughly: **P0** = high impact (data loss, security, privacy exposure, wrong state) × plausible likelihood × confirmed; **P1** = material recurring cost or friction, or a real defect in a rarer path; **P2** = drift, polish, low reach.

**8.2 Verification with explicit oracles.** Before any P0 or high-impact P1 is claimed, it is verified independently, with the oracle stated per finding type: **static drift** → file:line + the two conflicting texts; **behavioral/workflow** → a named reproducer scenario (from the matrix) + expected vs. actual observable + the environment + number of runs; **token** → the measurement + method + which of the three metrics; **UX/a11y** → the recorded interaction + the specific stall. "Independently" = a fresh agent/context re-runs the reproducer, or a distinct lens re-reads (the panel pattern that has repeatedly caught false positives here — and would have caught the stale-docstring trap). A finding that does not survive is downgraded or dropped.

**8.3 Findings document + fix batches** (`findings.md`, the primary deliverable). Every verified finding, deduped, ranked by derived priority, cross-tabulated dimension × severity, each with evidence, proposed fix, effort, and — for every token reduction — a behavior-risk note. Surviving findings are grouped into coherent fix batches the researcher approves one at a time; cross-cutting fixes (e.g. moving board.md's web runbook to a load-on-demand reference — a token *and* coherence *and* maintainability win) are single batches so a file is touched once. Each batch names its walkthrough-regression check. The researcher picks; nothing ships from this design.

## 9. Preliminary observations (hypotheses to verify, not conclusions)

Corrected against the real files (revision 2 fixed five overclaims the cross-model review caught). Each is a *candidate*; none is confirmed until the audit verifies it.

- **[token, P1?]** `board.md` is 8,700 tokens; the web-publish runbook (step 10→EOF) is 12,652 B ≈ **36%** (not "half" as revision 1 claimed), paid on every plain `/board` open. Candidate: move it to a reference file loaded only on `--publish`/`--publish-web`/`--pull`/`--web-connect`. `results.md` (adopt/reconcile) and the `/plan` chain are similar shapes.
- **[token, P1?]** The always-on floor is ~**523 tokens** — the ten command `description:` lines *plus the skill's own 603-byte description*, which loads for discovery even when the body never runs (revision 1 wrongly said "only 372"). Loaded in every session in every repo. Tightening the four wordiest descriptions (renew 217 B, adopt 211 B, results 209 B, report 195 B) is the highest-frequency lever in the plugin.
- **[coherence, P2 — confirmed drift]** `docs/reference.md` describes the *old* board lifecycle ("refreshes after an action, sleeps after an idle hour") that `board.md` and `board.py` replaced ("closes after an action, no idle timeout"). A real stale-doc finding, surfaced by the cross-model review.
- **[coherence, P2]** The model-nudge paragraph is near-verbatim in plan.md, sync.md, SKILL.md; the initialized-project gate in eight commands; the substantive-finding rule is a hand-kept Python/TypeScript duplicate (results.py + findings.ts + report.md prose — *not* SKILL.md, per revision 2). Candidates for state-once-reference, each pending a load-bearing check.
- **[coherence, P2]** Fragile cross-file step references ("review.md step 4", "/plan step 5", "board steps 4–5"). The checked ones currently resolve, so none is filed as stale without evidence — the xref graph enumerates them.
- **[coherence, P2 — verified non-bug]** `token_ok`'s docstring (board.py:867) says the per-boot token is "NOT yet enforced in do_POST"; do_POST at line 1216 *does* enforce it. Stale comment, correct code. The template for how the sweep treats every "looks wrong": verify against the code before filing.
- **[portability, P1?]** Headless `/init` interviews into the void when `AskUserQuestion` falls back to text (friction-log 1.1, still "pending ruling"). The clean-room probe confirms whether it still bites and how a fresh user recovers.
- **[portability/security, P2?]** board.md's review-with-`codex`/`gemini` paths shell out with no `command -v` guard seen; a user without those CLIs may hit a raw failure. To confirm in the dependency inventory + probe.
- **[housekeeping]** Two untracked design/plan docs for the parked sidebar work sit on main; `docs/plan-rubric-v0.4.md` is a tracked share artifact. Note for the researcher; not an audit finding.

## 10. Deliverables

All under `docs/evaluation/checkup/` except the friction log. No plugin behavior changes.

1. `scenario-matrix.md` — the workflow-invariant spine driving the audit.
2. `threat-model.md` — assets, actors, trust boundaries, authority sources.
3. `token-report.md` + its regeneration script — the three-metric static accounting.
4. `contract-map.md`, `xref-map.md`, `dependency-map.md` — the coherence/portability baselines.
5. `docs/evaluation/friction-log.md` — extended with Run 2 (clean, scripted + interactive) and Run 3 (author-env), diff called out.
6. `findings.md` — **the primary deliverable**: verified, priority-scored (impact × likelihood × reach × confidence), dimension × severity, with proposed fix batches.

## 11. Out of scope / boundaries

- **No fixes in this audit** (decision 1). Output is findings + a batch proposal.
- **Not re-litigating shipped feature *ideation*.** The audit does not ask "was this the right feature." It *does* judge whether an intended workflow is confusing, costly, unsafe, or drifting — evidence of excessive ceremony, interview burden, or friction is in scope, even when the workflow implements its design perfectly (revision 2 reworded this — the old blanket "not re-litigating shipped design decisions" would have wrongly excluded legitimate UX findings).
- **The sidebar branch and codex-agents idea stay parked** (decision 4). The UX pass cross-references the sidebar design doc where per-view asides come up, but does not audit or merge that branch.
- **The board React codebase gets a UX/a11y/security pass, not a full code review.** Correctness attention only where a scenario row or defect traces into it. A general `board/src` review is its own future effort.
- **No model/OS matrix** (decision 2). One macOS clean-config environment (scripted + a few interactive) and one author-env run; the resulting claim is scoped to this Claude Code version + macOS, not universal.
- **The audit runs against the pinned `60eaede` snapshot** (decision 7), installed/checked-out explicitly, never a moving `main`.
- **Leave alone:** all shipped behavior, all committed history, the parked branch. The audit's only writes are its own evaluation artifacts — everything under `docs/evaluation/checkup/` (the baselines, their scripts, the threat model, the findings doc) plus the friction-log entries. No file under `commands/`, `skills/`, `scripts/`, `board/`, or `hooks/` is touched.

## 12. Risks and mitigations

- **Over-claiming a finding.** The repeated lesson here: a plausible-looking defect is often not one (the stale docstring; revision 1's five overstated preliminary numbers; the sidebar design doc's six wrong claims). Mitigation: runtime claims marked to-verify in the sweep, closed by a probe with a stated oracle (§8.2), and top findings independently re-verified before they reach the doc.
- **Cutting load-bearing redundancy.** These prompts are dense on purpose; restated invariants protect real guarantees. Mitigation: measure-then-decide (decision 3), a risk note on every reduction, regression-checked against the walkthrough harness before merge.
- **Subagent-summary error.** Parallelized phases can bake in wrong facts. Mitigation: findings that will drive fixes are re-confirmed against real files by the controller, not trusted from a summary.
- **Scope creep from three added dimensions.** Accessibility, privacy, and install/upgrade roughly widen the audit. Mitigation: each is explicitly bounded (§7) — a checklist, not an open-ended audit — and rides existing probes rather than adding phases.
- **The audit's own token cost.** A checkup this broad is not cheap. Mitigation: the scenario matrix focuses probe effort on real invariants; each surface gets one primary read; expensive lenses run only where the matrix needs them.

## 13. Open questions (for the plan to resolve, not blocking)

1. **Token primary metric.** Of the three (§6.4), which is the headline the fix batches optimize? Working assumption: *peak single-context input per invocation* is primary (it is what pressures the context window and the prompt cache), with cumulative-workflow reported as secondary. The plan confirms once the accounting exists.
2. **Clean-room exact environment.** The precise Claude Code version, permission mode, and isolation mechanism (`CLAUDE_CONFIG_DIR` sufficiency) are resolved in Phase 0 via claude-code-guide, not assumed. Target: current CC, default permission mode, macOS, the `60eaede` checkout.
3. **Interactive-session count.** "A few" interactive clean-env sessions (decision 2) — the plan sets the number (likely 2–3: a cold `/init`, a `/plan`, and one board pass) to bound cost while still probing burden and recovery.
