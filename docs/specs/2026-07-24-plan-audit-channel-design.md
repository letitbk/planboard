# The plan audit channel

Date: 2026-07-24. Status: approved by BK (four question rounds; design approved in chat 2026-07-24).

## Problem

A plan can score 15/15 on the rubric and still produce output that does not match it. BK has hit this several times. His own diagnosis: the plan was never reviewed carefully, only scored. He works around it by asking Codex to review the plan again by hand, outside the tool, and reports that the local `/codex` run finds "many critical issues" on plans the board already scored 15/15.

That gap is structural, not accidental, and it has three separate causes.

**The path to execution contains no substantive review.** `/plan` writes the draft and runs `/planboard:review` automatically (`commands/plan.md:30`). `/sign` runs it again on the signed plan (`references/sign-off.md:14`). Both are the rubric. The rubric scores five channels of *control* and says so explicitly: score "from the plan itself", no pass/fail threshold, "a plan is scored, not gated" (`references/plan-rubric.md`). It never opens the repository. Nothing on the path from draft to execution ever asks whether the plan is technically right. The board's *Review with X* button does ask that, but it is optional, manual, and easy to skip.

**The board's review contract structurally deletes the finding class that matters here.** `commands/board.md:41` requires every returned comment to carry a "verbatim span" quote that matches the rendered target, because that is what lets a comment land as a board annotation. A finding of the form "the plan never states the missingness rule for the 2019 wave" has no span to quote. Unspecified things are precisely where plan and output diverge, so the contract filters out the most predictive findings. A stronger model on the same contract would not fix this.

**The board reviewer is weaker than the local one.** `commands/board.md:43` pins `gpt-5.5` at default effort. The local skill at `~/.claude/skills/codex/SKILL.md` defaults to `gpt-5.6-sol` at `xhigh`, runs `--sandbox workspace-write` with free repository exploration, and uses an open five-bucket output contract with no defined severity scale. Some of the local run's extra volume is real signal and some is severity inflation from an undefined scale, but the depth difference is real and it is a stale pin, not a calibration choice.

One clarification that shapes the whole design: a high rubric score does not predict a quiet audit. Specific steps, named success criteria, and stated boundaries are all falsifiable claims, so a well specified plan gives an auditor *more* to attack, not less. "15/15 with three blockers" is a coherent state and must render as one.

## What exists today that this design builds on

- `normalize_plan(text)` (`scripts/signoff_gate.py:48`) strips trailing whitespace and a final `Signed off:` line so that `normalize(draft) == normalize(signed)`. It already backs sign-off ticket hashing. Reused here as the audit's cache key, it gives a free and important property: an audit run against a draft stays valid after that draft is signed.
- `board.py:761-765` globs every `plans/reviews/*.md` into the payload's `reviews` list. A new artifact placed in that directory is collected with no backend change.
- `parseScorecard` returns null for content with no ```` ```json board-scorecard ```` fence (`board/src/lib/parse.test.ts:291`), and all three consumers filter on non-null before use (`PlanReader.tsx:316`, `SignOffView.tsx:109`, `Timeline.tsx:296`). Audit files sharing the reviews directory are inert to existing scorecard rendering.
- The seed-annotation path already exists end to end: reviewer comments become a temp JSON array, the board reopens with `--seed-annotations`, the researcher curates, *Send to Claude* routes them back through `commands/board.md:5` (`commands/board.md:41-47`).
- `/planboard:review` step 4 already solves draft-to-canonical artifact migration, rewriting `planPath` in both the JSON fence and the prose link when a draft-path card is superseded by the signed file (`commands/review.md:15`).
- `models.py` has a working stage table, per-stage validation, an agent generator, and a canonicality gate that decides whether the board's Models view may edit the profile live (`models.py:23-58`, `board.py:1572`, `board/src/views/Models.tsx`).
- The live board auto-refreshes on disk change as of v1.0.1, so an artifact that appears while the board is open shows up without a relaunch.

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
     "comment": "[blocker] <finding>. At execution: <the concrete failure>."}
  ],
  "gaps": [
    {"section": "<nearest heading, may be empty>",
     "comment": "[major] <what the plan never states>. At execution: <the concrete failure>."}
  ]
}
```

`anchored` keeps the verbatim-quote rule from `commands/board.md:41` unchanged, which is what lets those findings seed as board annotations through the path that already exists. `gaps` drops the anchor requirement entirely. This is the point of the whole design: it admits the "the plan never says how to handle X" class that today's contract deletes.

Severity tags are the existing three, with the existing definitions: `[blocker]` invalidates a finding or decision and must be resolved before acting on the work, `[major]` materially changes the work if acted on, `[minor]` is worth fixing but not blocking. Findings are ordered most severe first within each bucket. As today, an absent or invalid tag triggers one repair re-prompt.

**No cap on finding count. One precision requirement instead.** Every finding must name the concrete failure it predicts at execution time. "Consider handling missingness" is not a finding. "Step 4 will silently drop the 2019 wave because no missingness rule is stated and the script defaults to listwise deletion" is. A finding that cannot name a consequence is dropped by the auditor before returning. This replaces a numeric cap, and it targets the speculative-critical inflation that the local `/codex` run produces from its undefined severity scale.

The auditor is read-only against the repository (`--sandbox read-only`), as the board reviewer already is. A review must not mutate the repo.

### 3. Reviewer selection and the profile

`plans/model-profile.md` gains one row:

```
| plan audit (deep) | codex-sol | xhigh | reviewer |
```

The mechanism is named `reviewer`, not `external`, because the same row must be able to name an in-harness reviewer without lying. `MECHANISMS` (`models.py:35`) becomes `{"nudge", "agent", "reviewer"}`, and `reviewer` means: the model cell holds a reviewer token rather than a Claude model, and no agent file is generated for the stage.

Valid reviewer tokens are `codex-sol`, `codex-terra`, `codex-luna`, `gemini-pro`, `subagent`, and `panel`. Model-cell validation branches on mechanism: `nudge` and `agent` rows keep validating against `MODEL_ALIASES` and `MODEL_ID_RE`, and `reviewer` rows validate against the token set. The effort cell keeps using `EFFORT_LEVELS`, whose values (`low`/`medium`/`high`/`xhigh`/`max`) already match the Codex reasoning-effort scale exactly, and is passed as `-c model_reasoning_effort`.

Dispatch by token: `codex-*` runs `codex exec --sandbox read-only`; `gemini-pro` runs `agy`; `subagent` and `panel` dispatch `pb-board-reviewer` Tasks exactly as `commands/board.md:44-45` does today.

**Fallback.** Before dispatching an external token, the existing availability check runs (`command -v codex`, `command -v agy`). When it fails, the audit falls back to a `pb-board-reviewer` subagent, writes the audit file with a `"reviewerFallback"` note, and says so out loud in session. It never silently skips, because a silently skipped audit is worse than no audit: it reads as a clean bill of health.

**The manual board button uses the same row.** *Review with Codex* stops being hardcoded to `gpt-5.5` (`commands/board.md:43`) and takes its model and effort from the audit row. When its target scope is `plan`, it also uses the three-key contract above instead of the single-bucket one. One reviewer definition, two entry points: automatic at draft time, manual on demand. This is BK's original request.

**Migration is mandatory.** `is_canonical` (`models.py:178`) requires the profile's stage set to equal `STAGE_LABELS` exactly. Adding a stage makes every pre-existing `plans/model-profile.md` non-canonical, which silently downgrades the board's Models view to read-only and stops live editing. `/planboard:models` must therefore detect a profile missing the audit row, insert it with the default values, and report the insertion. `STAGE_LABELS`, `EXPECTED_MECHANISM`, the `models.py stage` CLI choices, and `templates/model-profile.md` all change together. `AGENT_STAGES` does not gain an entry.

The board's Models view renders the reviewer row read-only in this version. Its editor offers Claude model aliases, which are wrong for a reviewer token, and teaching it a second vocabulary is out of scope. The row is edited through `/planboard:models` or by hand.

### 4. Storage and board surface

The audit lands at `plans/reviews/<NN-slug>-v<N>-audit.md`, carrying a ```` ```json board-audit ```` fence and a prose rendering above it, mirroring the scorecard template's shape. Sharing the reviews directory is deliberate and free: `board.py` already collects it, and every existing consumer filters on a successful `parseScorecard`, which an audit file fails by construction.

The fence carries `schemaVersion`, `component`, `planVersion`, `planPath`, `date`, `reviewer` (the resolved token plus effort, and `reviewerFallback` when applicable), `contentHash`, `overall`, `anchored`, `gaps`, and `dispositions`.

On the board, the plan header gains an audit strip beside the existing score strip:

```
G·D·S·V·B = 15/15   |   audit: 2 blocker  4 major  3 minor
```

Clicking it opens the findings list, grouped by bucket and ordered by severity. Like the score strip, it is read-only. Anchored findings are additionally seeded as board annotations through the existing `--seed-annotations` path so they can be curated and routed like any other reviewer comment.

The audit file follows the same draft-to-canonical migration as the scorecard (`commands/review.md:15`): at sign-off, an audit whose `planPath` points at `.draft-v<N>.md` is rewritten in place to the canonical `v<N>.md` path in both the fence and the prose link. It is not re-run, because `normalize_plan` guarantees the content hash still matches.

### 5. Runtime and caching

The audit is dispatched in the background when a draft is written, on the same trigger that already runs `/planboard:review` (`commands/plan.md:30`). `/plan` returns immediately and reports that the audit is running. The live board picks the artifact up on auto-refresh when it lands.

"Wherever the review workflow runs on a draft" is the rule, not just first authorship. That means revision rounds after a change request (`commands/plan.md:32`), feedback applied during a sign session (`references/sign-off.md`, step 4 of `commands/sign.md`), and amendment re-commitment candidates (`commands/sign.md:3`, `commands/execute.md:13`) each dispatch an audit too. The content hash makes this cheap: a round that did not change the plan text costs nothing.

The cache key is `sha256(normalize_plan(<draft text>))`, recorded in the audit fence as `contentHash`. Before dispatching, the workflow compares the key against any existing audit for that component and version. A match is a no-op: no reviewer call, no wait. This keeps a typo fix in a draft from re-running a multi-minute audit, and it is why the audit survives sign-off unchanged.

**Sign-off closes the race.** Background dispatch means the researcher can reach `/sign` or the `/execute` gate before the audit lands, or with no audit at all. Both entry points verify a current audit before opening the browser: an audit file exists for this component and version, and its `contentHash` matches the draft. If it is missing or stale, the audit runs synchronously right there, before the session opens. A plan therefore cannot become canonical without a current audit having existed at that moment.

### 6. Disposition of blockers

Blockers only. `[major]` and `[minor]` findings stay purely advisory and never gate anything.

Each `[blocker]` in a current audit must carry one of three dispositions before sign-off completes:

- `fixed` — addressed in this draft
- `accepted` plus a reason — the risk is understood and taken
- `declined` plus a reason — the finding is wrong or does not apply

The sign session presents the open blockers with these three choices. Dispositions are written back into the audit file's `dispositions` array and produce one decision-log entry each, in the standard Context / Question / Response / Effect format, attributed to the reviewer rather than the researcher.

Dispositions attach to a specific audit, identified by its `contentHash`. If the currency check in section 5 re-runs a stale audit at the gate, the new audit's blockers are the ones needing disposition; dispositions carried by the superseded audit do not transfer, because they were made about different plan text. A revised draft therefore re-opens its blockers by design.

This is not a threshold and not a veto. Nothing about a blocker can prevent signing; it can only require a sentence. That keeps the rubric's "scored, not gated" stance intact while removing the silent wave-through, and it produces the postmortem trail that BK's failure mode needs: after a plan-output discrepancy, the audit file records whether it was flagged and why it was let through.

## Scope boundaries

In scope: execution plans only, the automatic draft-time audit, the audit artifact and its board strip, the profile row and its migration, blocker dispositions at sign-off, and repointing the manual plan-scope *Review with X* button at the profile row.

Out of scope: audits of the master plan or of results bundles (the contract generalizes, but not in this version); any change to the rubric, the scorecard schema, or `/planboard:review`; making the reviewer row editable in the board's Models view; and any gating stronger than a required disposition.

Retrospective plans are excluded. `/planboard:adopt` reconstructs plans for work that already happened, so auditing them for execution feasibility predicts a failure that either already occurred or already did not. A plan whose provenance is `retrospective` is not audited, and its absence of an audit is not treated as a stale audit at the sign gate.

This spec is larger than one implementation sitting. It decomposes cleanly along three seams that can ship in order and be useful at each step: the audit machinery and artifact (reviewer dispatch, contract, hashing, file format), the board surface (audit strip, findings list, seeding, read-only Models row), and the gate work (currency check, blocker dispositions, decision-log entries). The profile row and its migration belong to the first seam because everything else reads from it.

Unchanged: the manual *Review with X* button still works for ad-hoc extra reviews on all three scopes, and its non-plan scopes keep the single-bucket contract.

## Open risks

- **Background dispatch can be lost.** A session that ends before the background reviewer finishes leaves no audit. The sign-off currency check is the backstop, so the failure mode is a synchronous wait later rather than a missing audit.
- **Audit latency at the sign gate.** When the check finds no current audit, sign-off pays the full multi-minute cost at the least convenient moment. Accepted deliberately: it is the price of the guarantee, and the draft-time dispatch makes it rare.
- **A wrong blocker still costs a sentence.** Declining a bad finding requires a reason. This is the intended friction, but it means auditor precision directly affects how annoying the flow is, which is why the predicted-failure requirement is in the contract.
- **Profile migration touches every existing project.** A project whose profile is not migrated loses live model editing on the board until `/planboard:models` runs. The migration must be automatic and loud.
