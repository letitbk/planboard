# The plan audit channel

Date: 2026-07-24. Status: approved by BK (four question rounds; design approved in chat 2026-07-24). Revised 2026-07-25 after a Codex sol/xhigh review — five blockers and six material findings folded in full, plus two decisions BK settled. See Revision history.

## Problem

A plan can score 15/15 on the rubric and still produce output that does not match it. BK has hit this several times. His own diagnosis: the plan was never reviewed carefully, only scored. He works around it by asking Codex to review the plan again by hand, outside the tool, and reports that the local `/codex` run finds "many critical issues" on plans the board already scored 15/15.

That gap is structural, not accidental, and it has three separate causes.

**The path to execution contains no substantive review.** `/plan` writes the draft and runs `/planboard:review` automatically (`commands/plan.md:30`). `/sign` runs it again on the signed plan (`references/sign-off.md:9-15`). Both are the rubric. The rubric scores five channels of *control* and says so explicitly: score "from the plan itself", no pass/fail threshold, "a plan is scored, not gated" (`references/plan-rubric.md`). It never opens the repository. Nothing on the path from draft to execution ever asks whether the plan is technically right. The board's *Review with X* button does ask that, but it is optional, manual, and easy to skip.

**The board's review contract structurally deletes the finding class that matters here.** `commands/board.md` step 5 requires every returned comment to carry a "verbatim span" quote that matches the rendered target, because that is what lets a comment land as a board annotation. A finding of the form "the plan never states the missingness rule for the 2019 wave" has no span to quote. Unspecified things are precisely where plan and output diverge, so the contract filters out the most predictive findings. A stronger model on the same contract would not fix this.

**The board reviewer is weaker than the local one.** `commands/board.md` step 5 pins `gpt-5.5` at default effort with no reasoning-effort setting. The local skill at `~/.claude/skills/codex/SKILL.md` defaults to `gpt-5.6-sol` at `xhigh`, runs `--sandbox workspace-write` with free repository exploration, and uses an open five-bucket output contract with no defined severity scale. Some of the local run's extra volume is real signal and some is severity inflation from an undefined scale, but the depth difference is real and it is a stale pin, not a calibration choice.

One clarification that shapes the whole design: a high rubric score does not predict a quiet audit. Specific steps, named success criteria, and stated boundaries are all falsifiable claims, so a well specified plan gives an auditor *more* to attack, not less. "15/15 with three blockers" is a coherent state and must render as one.

## What exists today that this design builds on

Line numbers below were verified against `codex-handoff-auto-nudge` on 2026-07-25. References to `commands/*.md` are to numbered **workflow steps**, not file lines.

- `normalize_plan(text)` (`scripts/signoff_gate.py:48-67`) normalizes line endings, strips trailing whitespace, and removes a final `Signed off:` line with its optional `---` separator. It does **not** strip an `Amendment recorded, YYYY-MM-DD` trailer; only `strip_trailer` (`signoff_gate.py:102-119`) removes either canonical trailer, and it leaves malformed text untouched. The audit hash therefore composes the two rather than using `normalize_plan` alone (section 5).
- `board.py:761-765` globs every `plans/reviews/*.md` into the payload's `reviews` list. A new artifact placed in that directory is collected with no backend change.
- `parseScorecard` returns null for content with no ```` ```json board-scorecard ```` fence (`board/src/lib/parse.ts:376-378`, proven by `parse.test.ts:290-293`), and all three production consumers guard the nullable result before use (`PlanReader.tsx:313-319`, `SignOffView.tsx:107-112`, `Timeline.tsx:295-320`). Audit files sharing the reviews directory are inert to existing scorecard rendering.
- The seed-annotation path exists end to end, but it is **launch-time only**: `--seed-annotations` validates a JSON file at startup, the payload carries it, and `boot_seeds` (`board.py:1403`) retains it across regeneration (`board.py:1456`). Nothing derives seeds from files on disk. An artifact that appears while a board is running cannot seed annotations into it. This constrains section 4.
- `/planboard:review` step 4 already solves draft-to-canonical artifact migration, rewriting `planPath` in both the JSON fence and the prose link when a draft-path card is superseded by the signed file. It is command-level orchestration, not a reusable function.
- `models.py` has a working stage table, per-stage validation, an agent generator, and `profile_canonical` (`models.py:170-180`), the gate deciding whether the board's Models view may edit the profile live (`board.py:1557-1562`, `board/src/views/Models.tsx:103-105,285-303`).
- The board's model-profile API already uses a baseline SHA-256 and returns 409 with a fresh snapshot on a concurrent external edit, and the client rebases on it (`board.py:627-640`, `Models.tsx:190-220`). This is the pattern to reuse for concurrent audit writes.
- The sign server re-reads the draft under `sign_lock` and refreshes the browser when it changed (`board.py:1732-1795`), and tickets persist for recovery (`board.py:2731-2749`, `references/sign-off.md`). Both matter for section 5.
- `/sync` step 6 writes a canonical amendment **directly**, with no ticket and no board action; the hook admits this path (`commands/sync.md` step 6, `signoff_gate.py:384-404`).
- The live board auto-refreshes on disk change as of v1.0.1, so an artifact that appears while the board is open shows up without a relaunch. Sign sessions deliberately stay frozen.

## Design

### 1. Two channels, never merged

Planboard gains a second review channel on a plan. The two are kept separate in every surface.

| | Score | Audit |
|---|---|---|
| Question | Is this a checkable contract? | Will this actually work? |
| Grounded in | The plan text alone | The plan against the repository and data |
| Output | `G·D·S·V·B = 15/15` | `2 blocker, 4 major, 3 minor` |
| Runs | `pb-plan-reviewer` (Claude) | The profile's reviewer, default Codex |
| Artifact | `plans/reviews/<NN-slug>-v<N>.md` | `plans/reviews/<NN-slug>-v<N>-audit.md` |
| Gates anything | No | Blockers require a disposition |

There is no combined number and no combined verdict. The scorecard schema stays at version 3 and the rubric is untouched.

### 2. The audit contract

The auditor returns strict JSON with three keys.

```json
{
  "overall": "one paragraph",
  "anchored": [
    {"section": "<exact heading or empty>",
     "quote": "<verbatim span, markdown stripped>",
     "evidence": {"path": "analysis/load.py", "kind": "direct", "detail": "<what you read there>"},
     "comment": "[blocker] <finding>. At execution: <the concrete failure>."}
  ],
  "gaps": [
    {"section": "<nearest heading, may be empty>",
     "evidence": {"path": "<repo or data path>", "kind": "direct|inferred", "detail": "<what you read>"},
     "comment": "[major] <what the plan never states>. At execution: <the concrete failure>."}
  ]
}
```

`anchored` keeps the verbatim-quote rule from the existing board contract unchanged, which is what lets those findings seed as board annotations when the board is relaunched. `gaps` drops the anchor requirement entirely. This is the point of the whole design: it admits the "the plan never says how to handle X" class that today's contract deletes.

Severity tags are the existing three, with the existing definitions: `[blocker]` invalidates a finding or decision and must be resolved before acting on the work, `[major]` materially changes the work if acted on, `[minor]` is worth fixing but not blocking. Findings are ordered most severe first within each bucket. As today, an absent or invalid tag triggers one repair re-prompt.

**No cap on finding count. Two precision requirements instead.**

*Predicted failure.* Every finding must name the concrete failure it predicts at execution time. "Consider handling missingness" is not a finding. "Step 4 will silently drop the 2019 wave because no missingness rule is stated and the script defaults to listwise deletion" is. A finding that cannot name a consequence is dropped before returning.

*Repository evidence.* Every finding must carry an `evidence` object naming the repository or data path the auditor actually inspected, what it found there, and whether the claim is `direct` or `inferred`. This restores a rule the existing `pb-board-reviewer` contract already enforces ("state the evidence inside the comment", "label inference explicitly"). Without it, an uncapped audit can return many concrete-sounding predictions grounded in nothing, and each one costs the researcher a disposition. The predicted-failure rule alone filters vagueness; only the evidence rule filters confident invention.

The auditor is read-only against the repository (`--sandbox read-only`). A review must not mutate the repo.

### 3. Reviewer selection and the profile

`plans/model-profile.md` gains one row:

```
| plan audit (deep) | codex-sol | xhigh | reviewer |
```

The mechanism is named `reviewer`, not `external`, because the same row must be able to name an in-harness reviewer without lying. `MECHANISMS` (`models.py:35`) becomes `{"nudge", "agent", "reviewer"}`, and `reviewer` means: the model cell holds a reviewer token rather than a Claude model, and no agent file is generated for the stage.

Valid reviewer tokens are `codex-sol`, `codex-terra`, `codex-luna`, and `subagent`. Model-cell validation branches on mechanism: `nudge` and `agent` rows keep validating against `MODEL_ALIASES` and `MODEL_ID_RE`, and `reviewer` rows validate against the token set. The effort cell keeps using `EFFORT_LEVELS`, whose values (`low`/`medium`/`high`/`xhigh`/`max`) match the Codex reasoning-effort scale exactly.

**`gemini-pro` is deliberately absent.** The existing Gemini reviewer path is self-contained by design and is given no repository access at all (`commands/board.md` step 5: the prompt is self-contained "so the model needs no repo access"). An auditor that cannot read the repository cannot do the one job this channel exists for, and shipping the token would produce confident, ungrounded audits that read exactly like grounded ones. Gemini remains available on the manual *Review with* menu, where its limits are the researcher's to judge in the moment.

Effort semantics differ by token and are defined per token, not shared: for `codex-*` the effort cell becomes `-c model_reasoning_effort`; for `subagent` it becomes the dispatched agent's pinned effort.

**A dedicated audit reviewer, not `pb-board-reviewer`.** The `subagent` token and the fallback path dispatch a new generated agent, `pb-plan-auditor`, rather than reusing `pb-board-reviewer`. The existing agent caps output at five comments and requires a verbatim quote on every finding (`templates/agents/pb-board-reviewer.md`), so reusing it would silently re-impose both the cap the audit contract removes and the anchor rule that deletes the entire `gaps` class. A fallback that structurally cannot report a missing missingness rule is worse than no fallback, because a clean audit reads as safety. `pb-plan-auditor` carries the section 2 contract, keeps the existing grounding and verify-before-returning rules, and drops the cap. It is generated from the audit row, so `AGENT_STAGES` gains an entry and the audit row's effort reaches it.

**Fallback.** Before dispatching a `codex-*` token the availability check runs (`command -v codex`). Fallback to `pb-plan-auditor` happens on any of: the executable missing, a nonzero exit, a timeout, an authentication failure, or output still malformed after the one permitted repair re-prompt. Every fallback writes `reviewerFallback` into the audit fence naming the trigger, and says so in session. The audit is never silently skipped.

**The manual board button.** The plan-scope *Review with X* menu keeps all four choices; the profile row supplies only the model and effort for the Codex choice, replacing the hardcoded `gpt-5.5`. Clicking Gemini still runs Gemini. When the target scope is `plan`, the Codex and subagent choices use the section 2 contract; Gemini and panel keep the single-bucket contract, since neither can satisfy the evidence rule. This resolves an ambiguity in the approved design, which said both that the button follows the profile row and that ad-hoc choices remain.

**Migration is mandatory and cannot live only in `/planboard:models`.** `profile_canonical` (`models.py:170-180`) requires the profile's stage set to equal `STAGE_LABELS` exactly, so adding a stage makes every pre-existing profile non-canonical and silently downgrades the board's Models view to read-only. Worse, `cmd_check` only inspects stages that generate agents, so before `pb-plan-auditor` exists in a project it cannot report the missing row at all. An upgraded project could therefore run `/plan`, reach the mandatory audit, and find no reviewer token.

The fix is `ensure_audit_stage`, invoked from **every audit lookup** as well as from `/planboard:models`. It splices in only the missing row, preserves surrounding bytes, refuses to act on an ambiguous or duplicated row, regenerates the affected agents, and reports what it did. It is atomic and idempotent. A board tab open during the migration is handled by the existing baseline-hash 409 path. `STAGE_LABELS`, `EXPECTED_MECHANISM`, `AGENT_STAGES`, the `models.py stage` CLI choices, and `templates/model-profile.md` change together, and the template's "how each planboard stage picks a Claude model" framing is rewritten to cover reviewer tokens.

The board's Models view renders the reviewer row read-only in this version. Its editor accepts only Claude aliases and `claude-*` identifiers, and its TypeScript mechanism union is `nudge | agent` (`Models.tsx:18-49,173-177`, `types.ts:50-61`). Teaching it a second vocabulary is out of scope; the union gains `reviewer` only so the row renders.

### 4. Storage and board surface

The audit lands at `plans/reviews/<NN-slug>-v<N>-audit.md`, carrying a ```` ```json board-audit ```` fence and a prose rendering above it, mirroring the scorecard template's shape. Sharing the reviews directory is deliberate and free: `board.py` already collects it, and every existing consumer guards on a successful `parseScorecard`, which an audit file fails by construction.

The fence carries `schemaVersion`, `component`, `planVersion`, `planPath`, `date`, `reviewer` (resolved token, effort, and `reviewerFallback` when applicable), `auditPlanHash`, `contextIdentity`, `supersedes`, `overall`, `anchored`, `gaps`, and `dispositions`.

**The hash field is named `auditPlanHash`, not `contentHash`.** The sign payload already uses `contentHash` for a hash of raw draft bytes (`board.py:1752-1759,1776-1787`). The audit hash is over normalized text. Two fields with one name over different inputs invite a direct comparison that reports false staleness on a line-ending or trailing-whitespace difference.

On the board, the plan header gains an audit strip beside the existing score strip:

```
G·D·S·V·B = 15/15   |   audit: 2 blocker  4 major  3 minor
```

Clicking it opens the findings list, grouped by bucket, ordered by severity, each finding showing its evidence path and its disposition when it has one. Like the score strip, it is read-only.

**Findings live in the audit panel, not in annotations.** The approved design said anchored findings would additionally seed as board annotations "through the existing path." They cannot: seeds are supplied at launch and retained as `boot_seeds`, and nothing derives them from disk, so a background audit landing in a running board would show an audit strip whose findings can never reach the curation drawer. Rather than build seed derivation at payload construction, automatic audits surface only in the panel. Seeding still happens on the existing launch path when a board is launched or relaunched after an audit exists, which covers the manual *Review with* flow unchanged. This is a deliberate reduction from the approved design, made because the alternative buys a second delivery route for findings that already have a home.

**Focused shares omit the audit.** Focused remote share construction clears the reviews list outright (`board.py:785-800`), so both the scorecard and the audit disappear. This design does not change that. A focused share carries plans, not review artifacts, and that boundary is left as it is.

The audit file follows the same draft-to-canonical migration as the scorecard: at sign-off, an audit whose `planPath` points at `.draft-v<N>.md` is rewritten in place to the canonical `v<N>.md` path in both the fence and the prose link. It is not re-run, because the section 5 hash is invariant across the trailer that finalization appends.

### 5. Runtime, currency, and concurrency

The audit is dispatched in the background when a draft is written, on the same trigger that already runs `/planboard:review` (`commands/plan.md` step 6). `/plan` returns immediately and reports that the audit is running. The live board picks the artifact up on auto-refresh when it lands.

"Wherever the review workflow runs on a draft" is the rule, not just first authorship. That means revision rounds after a change request (`commands/plan.md` step 6), feedback applied during a sign session (`commands/sign.md` step 4), amendment re-commitment candidates (`commands/sign.md` step 3, `commands/execute.md` step 1), and amendment drafts in `/sync` (step 6). Currency makes this cheap: a round that changed nothing costs nothing.

**Currency has two parts, and plan text alone is not enough.** The audit judges the plan *against the repository*, so an audit keyed only on plan text goes silently wrong when the repository moves underneath it. Concretely: the audit confirms `analysis/load.py` exists, the file is renamed, the plan text is untouched, the hash still matches, the gate skips, and a plan whose first step fails gets signed. An audit is current when **both** hold:

1. `auditPlanHash` matches `sha256(normalize_plan(strip_trailer(<plan text>)))`. Composing the two helpers makes the hash invariant across *both* canonical trailers, so an audit taken on a draft survives sign-off and survives `/sync`'s amendment write. `normalize_plan` alone would not: it strips `Signed off:` but leaves `Amendment recorded`.
2. `contextIdentity` matches: the current git HEAD, plus a content fingerprint of exactly the paths the audit's own `evidence` entries cite.

The context identity is scoped to cited evidence rather than to a whole-worktree fingerprint. A dirty-worktree hash would invalidate the audit on every unrelated edit, which during active work means constantly, and an audit that always re-runs is an audit with no cache. Scoping to cited paths catches the failure that matters (the evidence an actual finding rests on has moved) while leaving unrelated churn alone. An audit citing no paths has an empty fingerprint and is current on HEAD alone.

**Writes are atomic and serialized.** One audit service owns writing, holding a per-component-and-version lock. It writes to a validated temporary file and atomically replaces the target, so no reader can observe a partial JSON fence. Before publishing, it re-reads the plan and the context and recomputes both identities; a run whose inputs moved while it was thinking is discarded rather than published. It never replaces a current, same-identity audit that already carries dispositions. This resolves the case where a background job for draft A returns after a synchronous audit for draft B has already been written.

**The gate revalidates inside the transaction.** Checking currency before the browser opens does not close the race, because the sign server re-reads the draft under `sign_lock` and can mint a ticket on a later click (`board.py:1732-1795`). So the audit is revalidated **inside `sign_lock`, immediately before `write_ticket`**, and a stale result there refuses the ticket and refreshes the session rather than signing. `/sign`, the `/execute` gate, and `/sync`'s amendment write all perform the pre-flight check, and all three run the audit synchronously when it is missing or stale.

**Dispositions are durable before the ticket.** Tickets persist for crash recovery, and `/sign` recovery finalizes any valid ticket it finds. If a ticket were written before its dispositions and decision-log entries landed, a crash would finalize a plan whose promised audit trail does not exist. Dispositions are therefore persisted first, and decision-log replay during finalization is idempotent.

### 6. Disposition of blockers

Blockers only. `[major]` and `[minor]` findings stay purely advisory and never gate anything.

The researcher has **two** choices for each open blocker, both requiring a reason:

- `accepted` plus a reason — the risk is understood and taken
- `declined` plus a reason — the finding is wrong or does not apply

There is no `fixed` button. Once currency includes repository context, any genuine fix invalidates the audit: fixing the plan changes `auditPlanHash`, and fixing the repository changes `contextIdentity`. Either way the gate re-audits and the blocker is gone or raised again on its own merits, so a self-attested "I fixed it" is never both true and unverified. It would also have been the only disposition needing no reason, which makes it the path of least resistance under time pressure, and this design exists to remove exactly that.

**`resolved` is recorded by the system, never clicked.** Each audit names the audit it supersedes by hash. A blocker present in the superseded audit and absent from its successor is recorded as `resolved`, citing both hashes. This keeps "raised, then resolved" readable in one place instead of implicit across two files, and it needs no fuzzy matching of individual findings between two independent reviewer runs, because it points at audit identities rather than at findings.

The sign session presents the open blockers. `/sync`, which writes its amendment directly with no browser, collects them in session before the write. Dispositions are written back into the audit's `dispositions` array and produce one decision-log entry each, in the standard Context / Question / Response / Effect format. Attribution names the **reviewer as the source of the finding and the researcher as the actor** who accepted or declined it: the researcher takes the risk, so the record must not read as though the reviewer did.

Dispositions attach to a specific audit identity. If the gate re-runs a stale audit, the new audit's blockers are the ones needing disposition, and dispositions on the superseded audit do not transfer, because they were made about different plan text or a different repository state. A revised draft re-opens its blockers by design.

This is not a threshold and not a veto. Nothing about a blocker prevents signing; it can only require a sentence. That keeps the rubric's "scored, not gated" stance intact while removing the silent wave-through, and it produces the postmortem trail BK's failure mode needs: after a plan-output discrepancy, the audit file records whether it was flagged and why it was let through.

## Scope boundaries

In scope: execution plans only, the automatic draft-time audit, the audit artifact and its board panel, the profile row and its migration, blocker dispositions at every canonicalization path, and repointing the manual plan-scope Codex reviewer at the profile row.

Out of scope: audits of the master plan or of results bundles (the contract generalizes, but not in this version); any change to the rubric, the scorecard schema, or `/planboard:review`; making the reviewer row editable in the board's Models view; audits in focused or hosted shares; deriving board annotation seeds from audit files at payload construction; and any gating stronger than a required disposition.

**Amendments are audited.** `/sync` writes canonical amendments directly, with no ticket and no sign session, so an audit gate placed only at `/sign` and `/execute` would leave the amendment path as an open bypass — a blocker found on `.draft-v2.md` could reach a canonical `v2.md` untouched. `/sync` therefore performs the same pre-flight currency check and collects the same dispositions before its write. This gives `/sync` a gate it has never had, which is a real change to that command's character and is taken deliberately.

**Retrospective plans are exempt.** `/planboard:adopt` reconstructs plans for work that already happened, so auditing them for execution feasibility predicts a failure that either already occurred or already did not. A plan whose provenance is `retrospective` is not audited, and its absent audit is not treated as stale at any gate.

**Command permissions change with this design.** `/plan` and `/sign` currently have neither `Task` nor any external Bash permission, and `/execute` has `Task` but no reviewer commands. Every command that can trigger an audit needs the permissions to dispatch one, or the audit fails precisely where it is mandatory. `commands/plan.md`, `sign.md`, `execute.md`, and `sync.md` all gain what they need, or external execution is centralized in a Python audit runner and only `Task` is added.

**Seams.** This spec is larger than one sitting, and it ships in two steps rather than three. The machinery and the minimal display go together, because the artifact alone changes nothing a researcher sees: `/plan` returns before it exists and no view parses it. Seam 1 is the audit service, the contract, `pb-plan-auditor`, the profile row and its migration, the artifact, and the audit panel. Seam 2 is the gate work: the currency pre-flight, in-transaction revalidation, dispositions, and decision-log entries. Seam 1 is useful alone because findings become visible; seam 2 makes them binding.

Unchanged: the manual *Review with X* button still works for ad-hoc reviews on all three scopes, and its non-plan scopes keep the single-bucket contract.

## Open risks

- **Background dispatch can be lost.** A session that ends before the background reviewer finishes leaves no audit. The gate's currency check is the backstop, so the failure mode is a synchronous wait later rather than a missing audit.
- **Audit latency at the gate.** When the check finds no current audit, the gate pays the full multi-minute cost at the least convenient moment. Accepted deliberately: it is the price of the guarantee, and draft-time dispatch makes it rare.
- **Scoped context identity can under-invalidate.** A repository change that breaks the plan but touches no path the audit happened to cite leaves the audit "current". This is the deliberate cost of not using a whole-worktree fingerprint, which would make the cache worthless. The mitigation is the evidence rule in section 2: an auditor that cites what it inspected produces a better-scoped identity.
- **A wrong blocker still costs a sentence.** Declining a bad finding requires a reason, so auditor precision directly affects how much friction the flow carries. Both precision requirements in section 2 exist for this.
- **`/sync` gains a gate it never had.** A command that has always written directly now blocks on a reviewer run and a disposition round. If this proves too heavy in practice, the fallback is to exempt amendments, which reopens the bypass.
- **Profile migration touches every existing project.** An unmigrated profile loses live board model editing. `ensure_audit_stage` running from every audit lookup is what keeps this from becoming a silent trap.

## Revision history

- **2026-07-24** — Design approved in chat over four question rounds: placement (automatic at draft time), reviewer and configuration (profile row, default Codex), artifact (sibling audit file plus board panel), and disposition (blockers need a stated disposition).
- **2026-07-25** — Codex `gpt-5.6-sol` at `xhigh` reviewed the spec against the repository. Five blockers, all substantiated and folded: repository state absent from audit currency; the currency check sitting outside the sign transaction; the profile migration not covering an upgraded project's first audit; `pb-board-reviewer` being unable to satisfy the audit contract as a fallback; and `/sync` amendments bypassing the gate entirely. Six material findings folded: per-finding repository evidence, command permissions, the `contentHash` name collision, launch-only annotation seeding, manual-button ambiguity, and focused shares. The review also falsified four repository claims in the first revision — `is_canonical` is `profile_canonical`, `board.py:1572` is `1557-1562`, the seeding claim, and the guarantee that a plan cannot become canonical without a current audit — all corrected above. Two decisions BK settled in the same round: amendments are audited rather than exempt, and `fixed` is removed in favour of a system-recorded `resolved`.
