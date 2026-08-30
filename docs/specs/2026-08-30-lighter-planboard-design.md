# Lighter planboard: invoked, not ambient

Date: 2026-08-30. Status: design approved in chat by BK (package B, with the triage rule dropped and the signed-component clause kept). Revised the same day after a Codex sol/xhigh review that returned five blockers; BK selected which to fold. See Revision history for what was folded and what was deliberately left out.

## Problem

BK reports that planboard is "more frustrating than useful" in daily work and that he no longer reaches for it. A sweep of the 11 initialized repositories and the surviving August transcripts for `ai-network-survey` and `p2p-ewas` locates four mechanisms. Completion is not one of them: 75 of 149 tracker rows are done, and the ceremony has caught real defects, so this design removes gates, not rigor.

**The gate overrides the researcher's own instruction.** On 2026-08-16 BK typed "rerun on the full sample". A sign session launched at 21:00 and expired at 22:00 with "the sign-off gate needs your approval before I can execute". The session died because `SIGN_IDLE_GRACE` (`board.py:60`) is 900 seconds and the browser tab was never opened. At least three sign sessions expired with nothing executed, two of them recorded in the decision logs themselves.

**The same event shows the immutability cost.** Component 7's signed v3 carried the row "Batch 13762: retain; flag as not QC-covered". The IDATs arrived on 2026-08-15, so the premise died, so the rerun required authoring v4, scoring it, auditing it, and signing it. Reality changed and the workflow charged a full plan cycle to acknowledge it.

**The standing rules argue with a researcher who has already decided.** On 2026-08-07 BK asked for three small edits. The agent replied that the cap change "reopens the decision that made this a pure interface change" and opened a question box; BK interrupted. He asked for a second concrete fix; the agent replied that it "grows the scope past what the draft covers"; BK interrupted twice more. Those two sentences are CLAUDE.md rules 4 and 6 (`templates/claude-md-section.md`) plus `/planboard:plan` step 4's instruction to push back on a bare pick.

**Ceremony is uniform regardless of what the work is.** Component 10, "show one name box at a time instead of five", ran from 2026-08-07 16:36 to 2026-08-09 13:32 and produced a 3,370-word plan, a 1,674-word scorecard, an external review, 15 log entries, a results bundle, and one expired sign session. Across the 11 repositories `plans/` now holds roughly 623,000 words. In `ai-network-survey` it is 174,000 words against 26,000 in `spec/`, the survey being built.

A fifth mechanism, that interpretive and communicative work is invisible to the workflow, is out of scope here and gets its own design.

An earlier draft of this design proposed a triage rule that would route work to a light or heavy lane by how recoverable a mistake would be. BK rejected it: a rule that classifies research by riskiness becomes a thing to litigate with the agent, which is more bureaucracy, not less. The trigger below replaces it. The researcher is the dial.

## What exists today that this design builds on

Verified against `plan-audit-seam1` on 2026-08-30.

- The skill's hard gate (`SKILL.md`, "When NOT to use") keys on two markers: `plans/master-plan.md` carrying `<!-- planboard:master-plan -->` and the repo's CLAUDE.md carrying `<!-- planboard:start -->`. When both are present the workflow governs **every session in the repository**. There is no narrower condition anywhere in the plugin.
- `/sync` step 6 already writes a canonical amendment **directly**, with no ticket and no board action. The hook admits it: `parse_trailer` classifies the `Amendment recorded, YYYY-MM-DD` trailer (`signoff_gate.py:71,88`) and the gate allows the write with "no human-approval claim is made" (`signoff_gate.py:392-404`). `/sync` is the *documented* caller, not the only mechanically reachable one: the gate checks the trailer, the version number and the predecessor file, and knows nothing about which command produced the write. Through `/sync` the path still costs a draft cycle, a rescore, and an audit dispatch.
- `/planboard:execute` step 1 already contains **Re-commitment materialization**: it copies an amendment `v<N>.md` to `.draft-v<N+1>.md`, strips exactly one trailer via `strip_trailer` (`signoff_gate.py:102`), sets a `Supersedes` line, and folds the candidate into the next sign session.
- Tickets are `.import-approved-<slug>-v<N>` (`TICKET_PREFIX`, `signoff_gate.py:42`), minted by `write_ticket` (`board.py:2763`), validated by `check_ticket` (`signoff_gate.py:122`) and `has_valid_ticket` (`board.py:2894`). A present-but-invalid ticket fast-denies; an absent one falls through to the interactive gate (`signoff_gate.py:406-414`).
- **A forgery guard forbids the agent from writing a ticket itself**: tickets "are created only by /planboard:sign" (`signoff_gate.py:324-337`). Any new approval path must mint through `write_ticket`, never through a Write call.
- `signoff_gate.py` matches only Claude's `Write` and `Edit` tools (`hooks/hooks.json`). Bash-mediated writes are outside the matcher. This is a documented boundary, not a hole to plug here.
- `results.py` copies and hashes the source paths it is handed (`:157`) but does **not** infer ownership: the agent authors the manifest, `producedBy` is allowed to be null (`commands/results.md:15`), and drift checks look only at `artifact.source.path` (`results.py:528`). Component-owned files are therefore *not* enumerable from disk today. Section 1's governed-path index is new work, not an existing capability being read.

## Design

### 1. The trigger: invoked, not ambient

The two markers keep deciding whether planboard **may** apply. They stop deciding whether the planning and bookkeeping discipline **does**. That discipline applies when either condition holds:

1. An **activating** planboard command is running.
2. The edit touches a path governed by a component that has a signed plan.

Outside both, the agent does the work as it would in any repository, and no planning or bookkeeping rule fires.

**Activation is scoped, not sticky.** Not every command activates: `/plan`, `/execute`, `/sign`, `/sync`, `/results`, `/review`, `/adopt` and `/renew` do; `/board`, `/report` and `/models` do not, because reading a report or editing a model profile is not doing governed work. Activation lasts only while that command is running and reaches only the components it names. Opening the board to read a result does not switch on execution discipline for the rest of the session, and neither does running `/sync` as the recovery net.

**Workflow activation is not artifact integrity.** The hook's protections for finalized results bundles (`signoff_gate.py:263`), archived master plans (`:303`) and existing canonical versions (`:364`) are pure path policy with no notion of which command ran. They stay active whenever the two markers exist, invoked or not. "No planboard rule fires" in the paragraph above means no *planning or bookkeeping* rule; it never means the immutable artifacts become writable.

Condition 2 needs a mechanical test, not a judgment, and **the groundwork for one does not exist yet**. Plans name files in free prose that nothing parses: Build steps and Files to reuse are prose sections (`templates/execution-plan.md:60,73`) and `board/src/lib/parse.ts:306` extracts section bodies, not paths. On the results side `results.py` stores whatever path the caller supplied (`:157`), never infers ownership, and `producedBy` is allowed to be null (`commands/results.md:15`). So this design must **build** a governed-path index, not read one.

The index is generated when a plan is signed and when a bundle is finalized, and it stores repository-relative normalized paths. It must define: how absolute paths, symlinks, directories, globs and deleted paths normalize; that zero owners means ordinary work; that one owner governs; and that **two or more owners stop and ask the researcher which component the tweak belongs to** rather than appending to several ledgers.

Condition 2 is enforceable only for `Write` and `Edit`, because the hook matcher sees nothing else (`hooks/hooks.json:5`) while `/execute` itself permits `Bash(python3:*)`, `Bash(Rscript:*)` and `Bash(bash:*)` (`commands/execute.md:4`). For a governed file changed by a script, condition 2 is **advisory**: the agent honors it, the hook cannot. This is the same documented enforcement boundary the skill already states, and the spec must not claim more.

A component whose only plan is an unsigned `.draft-v<N>.md` does not govern anything. This is the 2026-08-07 case: component 10 was a draft when BK asked for seven boxes and a wording change, so under this design that work is ordinary and the agent simply does it. The draft is what the researcher is still authoring; it is not yet a commitment that can be exceeded.

This is deliberately evidence-based. The agent never decides whether work "feels" consequential; it checks whether a signed plan or a captured bundle already claims the file.

### 2. The amendment ledger

BK's requirement: an ordinary tweak inside a signed component's work should revise the plan. The cost today is that revising means a new immutable version plus a rescore, an audit, and a sign session. Component 01 reached v8 this way.

Each component gains `plans/execution/<NN-slug>/amendments.md`, append-only and committed. When condition 2 fires for an ordinary tweak, the agent does the work and appends one entry:

```
## a7f3c1 — 2026-08-16 20:51 — researcher instruction — base v4
Raised MAX_ROSTER 15 -> 25 in the D2 choice list.
Paths: spec/questions.yaml
Digest: sha256:9c1e…
Why: BK asked for the ceiling to cover the observed roster tail.
```

Every entry carries a **stable ID**, a timestamp, the trigger (`researcher instruction` or `agent call`), the **base plan version** it was written against, the normalized paths, a content digest, and why. Identity is what makes the rest of this section possible; a ledger of undifferentiated prose entries cannot be folded, sealed into a bundle, or recovered after a crash.

The signed `v<N>.md` is not touched, so plan immutability holds and the audit hash still matches the bytes that were approved. That guarantee is narrower than it sounds: it says the audit was run against this plan text, not that the audit is still current for a repository the ledger has since changed. See Open risks.

**Folding.** At the next `/planboard:execute` of the component, the unconsumed entries materialize into the re-commitment `v<N+1>` draft. Consumption is recorded by **appending a checkpoint**, never by editing or deleting entries:

```
## FOLD — 2026-08-20 09:12 — entries a7f3c1..d40b92 folded into v5 (draft sha256:1b7e…)
```

Without a checkpoint a later fold cannot tell a new entry from one already folded or one already superseded by a `/sync` version. Folding also happens on component completion, on `/sync`, on renewal, and before results capture, not only on execution: a component that is finished, skipped, or archived would otherwise never fold and would strand its ledger permanently. A pre-renewal component is browse-only (`commands/execute.md` step 1), so its ledger must be folded by renewal or it can never be folded at all.

**Crash recovery.** Appending the ledger entry happens *after* the work and *before* the commit suggestion, and every crash point needs a defined resume: work done with no entry is recovered by `/sync` as an unrecorded change; an entry with unfinished work is resolved by re-running or by a superseding entry; a signed fold whose checkpoint was never written is detected by comparing the fold draft's digest against the ledger, so a retry cannot apply the same entries twice. Appends go through a locked helper, because two sessions each writing the whole file back can silently drop the other's append.

**Results bundles must name the ledger state that governed them.** Today a manifest's only plan identity is `planVersion` (`results.py:499`, `board/src/lib/types.ts:162`), so two bundles captured under v4 with different ledger contents would both record `planVersion: 4` — permanently, since finalized bundles are immutable. The manifest therefore gains a sealed plan-state block recording the plan version, the last included entry ID, and a digest over the included entries, verified at finalize. The validator must also be handed that exact ledger snapshot: `commands/results.md` step 4 currently gives it the plan, the staging directory, the decision log and the git log, so a ledger-covered change would otherwise be reported as an unrecorded deviation.

The rejected alternative was to require a fold before every planned capture, which needs no schema change but puts a sign gate at capture time. That is the gate this design exists to remove.

**What the ledger is not for.** A material deviation still takes a canonical version through `/sync` step 6. The existing definition governs and this design does not narrow it: `commands/sync.md` step 2 calls a change material when a Scope decision changed, a build step was replaced, verification differed, or work happened outside Out of scope. An earlier draft of this spec listed only Scope decisions, success criteria and boundaries; that was a silent narrowing and is withdrawn. The distinction survives BK's objection to the triage rule because it is a factual comparison against a written plan, not a forecast about risk.

The hook gains an append-only rule for `amendments.md`: a Write or Edit that removes or rewrites an existing entry or checkpoint is denied with the same grammar as the immutability denial.

### 3. Terminal sign-off

`board.py` gains a non-serving subcommand that mints an approval ticket from the terminal and calls `write_ticket` (`board.py:2763`).

**The thing this must not quietly break.** Today the agent physically cannot mint a ticket: the forgery guard denies an agent Write of `.import-approved-*` (`signoff_gate.py:324-337`), and the only other minter is a human clicking in the browser. A subcommand invoked through Bash sits outside the hook matcher entirely (`hooks/hooks.json:5`), so "the agent still never writes the ticket file" would preserve a tool-name distinction and nothing else. An earlier draft of this spec claimed that as the safeguard; it is withdrawn.

The terminal path therefore must:

1. **refuse to run without a controlling TTY on stdin**, and refuse piped or redirected stdin outright, so an agent-invoked run cannot satisfy it in a normal harness session;
2. **repeat the checks the browser path performs**, not just the final hash — take `sign_lock`, resolve the newest draft, re-read it from disk, reject a draft carrying a trailer, and compare the hash the researcher was shown against the hash on disk right now (`board.py:1754-1809`);
3. **print the normalized hash it is about to approve** and require a typed confirmation at the terminal.

Residual risk, stated rather than hidden: a process that allocates a pty could still satisfy the TTY check. This narrows the boundary rather than restoring it. The trade is accepted because the alternative is the failure this design exists to fix, and because `PLANBOARD_NO_GATE=1` already documents an explicit bypass. The implementation plan must include a test asserting that a non-TTY invocation is refused.

The board remains the way to read a rendered plan and a version diff, and the researcher can always ask for it. The default is: terminal for re-commitment and ledger-fold versions, board for a first canonical version of a component.

`SIGN_IDLE_GRACE` (`board.py:60`) is unchanged and simply leaves the critical path. A sign session that nobody opens can no longer strand an instruction the researcher already gave.

### 4. A standing instruction as the commitment

When all three hold, the researcher's typed instruction is the commitment and execution proceeds without a sign session:

1. the candidate is a re-commitment or a ledger-fold version, never a first version;
2. its Decisions table is unchanged except for rows whose premise is factually dead, evidenced on disk;
3. the researcher's instruction in this session names the work.

**This is agent-attested, not machine-enforced, and the spec must say so wherever it appears.** The hook receives only the tool name, the tool input, the file path and the working directory (`signoff_gate.py:239`); it never sees the researcher's instruction or the session transcript. The amendment allowance checks only the trailer, the version number and the predecessor file (`signoff_gate.py:392`). Nothing in the codebase can evaluate "the Decisions table is unchanged except for a dead premise", and nothing can decide whether "go ahead" named the work. Condition 3 in particular can be satisfied by a broad assent that the agent reads too generously.

Because it cannot be enforced before the fact, it must be **auditable after** it. The decision-log entry quotes the instruction verbatim, names the normalized hash of the candidate it authorized, and cites the on-disk evidence for the dead premise. One entry authorizes one candidate; it is not a standing exemption for the component.

The version is written with `Amendment recorded, <date>`, never `Signed off:`. That keeps a version from ever claiming a sign-off that did not happen. It does **not** distinguish a `/sync` amendment from a ledger fold from a standing instruction: the trailer grammar carries only a date (`signoff_gate.py:71`), and the board renders every one of them as `amended △` (`board/src/views/PlanReader.tsx:624`). If those three need to be told apart on the board, that is a trailer-grammar and rendering change this design does not make.

This is the specific fix for 2026-08-16. "Rerun on the full sample" would have run. Whether the weakened guarantee is worth that is BK's call, and section 4 can be dropped without disturbing sections 1, 2, 3 or 5.

### 5. The standing rules: ten to seven

`templates/claude-md-section.md` drops from ten rules to seven.

1. When work touches a component with a signed plan, read `plans/master-plan.md` and that component's latest version first. *(narrowed from "at session start")*
2. Signed plan versions are immutable. An ordinary tweak inside a signed component is recorded in that component's `amendments.md`; a material deviation takes a new version.
3. Append to `plans/decision-log.md` as decisions happen, never backfilled. *(unchanged)*
4. Do not decide research questions, analytical choices, or interpretation on the researcher's behalf. **When the researcher has already stated a decision, record it and act on it rather than asking again.** *(second sentence is new)*
5. Output conventions — target journal and journal-ready deliverables. *(unchanged, was rule 7)*
6. Evidence before claims — substantive analysis captured to `logs/`. *(unchanged, was rule 9)*
7. Assumptions and restraint. *(unchanged, was rule 10)*

Three are deleted. Old rule 5, the post-execution tracker update, because the machinery already does it (`references/execution-loop.md:13,27`, `commands/sync.md` step 3). Old rule 8, the plan authoring standard, because `/planboard:plan` step 5 already carries it in full. Old rule 6, "pause when work exceeds the plan", because section 2 replaces it: the ledger is what a tweak does instead of stopping. Old rule 6 and the new clause in rule 4 are together the direct fix for the 2026-08-07 interruptions.

**An earlier draft cut four more rules on the grounds that they duplicate BK's personal global CLAUDE.md. That reasoning is withdrawn.** Planboard ships to other researchers who have no such file, so for them those rules are not redundant. Old rule 7 in particular is not a duplicate at all: it carries the project's target journal, it is substituted by `/init` and `/renew`, and eight places in the plugin depend on it. The honest trim is smaller than first claimed, and the daily relief comes from sections 1 through 4, not from the rule count.

**Renumbering is the trap.** Eleven places refer to these rules *by number*: rule 7 at `commands/init.md:21,37`, `commands/renew.md:13,21`, `commands/plan.md:19`, `commands/results.md:15`, `SKILL.md:53`, `templates/execution-plan.md:67`; rule 9 at `commands/init.md:14`, `references/planning-doctrine.md:15`, `references/execution-loop.md:17`; rule 4 at `references/execution-loop.md:17`. Deleting three rules silently repoints every one of them. So this change is not "edit the template": it must **remove numbered cross-references from the plugin entirely**, replacing them with stable named anchors ("the output conventions rule", "the evidence rule"), in the same commit. `/init` step 6 and `/renew` step 7 also substitute the `<target journal>` placeholder into what they call rule 7, so both need updating with it.

`/planboard:plan` step 4's "push back on a bare pick" is narrowed to the plan-authoring dialogue, where the researcher has opted into being questioned, and stops applying to ordinary work requests.

## Scope boundaries

Unchanged in substance: the five-channel rubric, the plan audit channel, Codex review, results bundles, validation, and the score. These are where the value showed up, including three genuine plan errors on component 10 and the alignment bug in `p2p-ewas`. The intent is to make them things the researcher enters rather than things that enter uninvited.

Two of them are nonetheless *touched* by the ledger and the spec should not pretend otherwise. The results manifest gains a sealed plan-state block and its validator gains the ledger snapshot (section 2). And audit currency becomes harder to reason about, since a committed ledger entry moves git HEAD while the board still matches an audit by component and version alone; that one is recorded under Open risks rather than solved here.

Also out of scope: the invisibility of interpretive work (diagnosis problem 4), and any change to the hook's `Write|Edit` matcher.

## Migration

Eleven repositories carry the ten-rule block between the `planboard:start` and `planboard:end` markers, and rewriting the template does not touch them. The mechanism to fix that exists: `/planboard:init` **step 6** (`commands/init.md:33`) replaces everything between the markers with the current block and touches nothing outside them (`:36`). Two qualifications the first draft of this spec got wrong. It is step 6, not step 5. And in update mode the refresh is **offered**, not performed — it is option (c) of the update-mode menu (`commands/init.md:14`) — so a researcher who re-runs `/init` and declines that option keeps the old block.

The rule-number dereferencing in section 5 has to land in the same change, because a migrated block and an unmigrated plugin reference disagree about what "rule 7" means.

Whether the block should also migrate itself, without the researcher re-running init, is a decision for the implementation plan. `ensure_audit_stage` (`models.py:374`) is the precedent for an automatic, byte-preserving in-place migration of a researcher-owned file, and `e893db2` is the reminder that such a migration must regenerate its dependents. Until then, repositories that are never re-inited keep the current behavior, and the release notes must say so rather than leave it assumed.

## Open risks

- **Work that deserved a plan happens with no record**, because nobody invoked the workflow. This is the real cost of dropping the triage rule. The net is `/planboard:sync` and `/planboard:adopt`, which record it after the fact. A missing record is recoverable; a gate that blocks the researcher is not.
- **The governed-path test can miss, and cannot see script writes at all.** A tweak to a file the plan never named still escapes it, and a governed file changed by Bash, R or Python is outside the hook matcher, so condition 2 is advisory there (section 1). `/sync` catches both at the next checkpoint.
- **The ledger could become a dumping ground** that never folds. Mitigated by folding on completion, `/sync`, renewal and capture rather than only on execution, and by the board showing the amendment count.
- **The audit goes stale and the board will not say so.** Audit currency depends on git HEAD and cited-evidence hashes (`audit.py:312`), so a committed ledger entry or a tweak to a cited file makes an audit stale, while the board matches an audit by component and version alone (`board/src/views/PlanReader.tsx:323`) and its `Audit` type omits context identity (`board/src/lib/types.ts:650`). Section 2's claim that the audit hash still matches is about the approved plan bytes only. Making audit identity ledger-aware is real work this design does not do.
- **Section 4 is agent-attested and cannot be enforced by the gate.** The mitigations are the trailer, which stops any version claiming a sign-off that did not happen, and the per-candidate decision-log attestation. Neither is enforcement. Section 4 is the most droppable part of this design.
- Cosmetic, not fixed here: `signoff_gate.py`'s user-facing strings name `RESEARCH_PLANS_NO_GATE` while `SKILL.md` documents `PLANBOARD_NO_GATE`. Both work (`_env`, `signoff_gate.py:196-201`).

### Raised in review, not addressed in this revision

Recorded so a later reader does not mistake silence for absence. BK scoped this revision deliberately and these were left out of it.

- **"Signed" and "governing" would mean different things.** `/execute` step 1 treats only a signed version as ready, `commands/results.md` step 4 treats a signed *or* amendment trailer as governing, and the board's action state recognizes only a signed trailer (`board/src/lib/actions.ts:44`). Section 1 condition 2 says "signed plan", so a path first introduced by a section 4 amendment version may not govern anything. One canonical state vocabulary is needed.
- **`/init` does not migrate the Codex handoff.** `templates/agents-md-section.md` still imposes the ambient plan-before-executing loop and is refreshed only by `/planboard:handoff` (`commands/handoff.md`), so a repository can get the lighter CLAUDE.md while Codex keeps the old discipline.
- **Commands do not consistently check both markers.** `/execute` (`:7`), `/sync` (`:6`) and `/report` (`:7`) check only the master-plan marker, which undercuts the claim that the two markers decide whether planboard may apply.

## Revision history

- 2026-08-30: first draft, from the friction diagnosis of the same date. Package B as approved, minus the triage rule, plus the amendment ledger that replaces it.
- 2026-08-30, after a Codex sol/xhigh review (`logs/2026-08-30_codex_spec_review.md`, five blockers): folded in the two structural blockers (results bundles must name the ledger state that governed them; terminal sign-off must preserve a human boundary, not a tool-name distinction), the two findings BK selected (section 4 relabeled agent-attested; the governed-path index specified as work to build rather than groundwork that exists), and both scoping errors (activation is a named command list and is not sticky; artifact integrity is separate from workflow activation and stays on). Three factual errors corrected independently of that selection: the numbered CLAUDE.md rules have eleven by-number dependents across the plugin, old rule 7 is not a duplicate of BK's global file and stays, and the CLAUDE.md replacement is `/init` step 6 and is offered rather than automatic. The rule trim is consequently ten to seven, not ten to four. Section 2's definition of a material deviation was silently narrower than `/sync` step 2's and is withdrawn.
