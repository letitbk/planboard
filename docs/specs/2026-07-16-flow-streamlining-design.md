# Flow streamlining: approve reliability, workflow autopilot, plan readability

**Date:** 2026-07-16 · **Status:** approved design, pre-implementation · **Baseline:** main @ 11cf00c (v0.19.0)

Addresses BK's eight issues (2026-07-16) across three releases: **v0.19.1** (hotfix: approve crash, auto-close, active-file indicator), **v0.20** (flow redesign: drop results approval, review-room finalize, autopilot tail, multi-plan), **v0.21** (plan readability). Issue → release map: #3 #5 #6 → v0.19.1; #1 #2 #4 #7 → v0.20; #8 → v0.21.

## Rulings

Decided with BK via AskUserQuestion (2026-07-16):

| Fork | Ruling |
|---|---|
| Sequencing | Hotfix now (v0.19.1), flow redesign (v0.20), readability (v0.21) — three cuts |
| Stop map | "Author, then autopilot": keep 4 human stops (plan dialogue, finalize, execute prompt, deviation exception); automate the other 11 |
| Multi-plan | Generalize the existing batch machinery (tickets + BatchGate wizard); no new mechanism |
| Readability depth | Typography + reading spine; the nine-section template contract stays (rubric v0.4 safe) |
| First-plan finalize | Review room, then finalize: draft → scorecard → persistent board → Approve mints ticket → v1 writes. No modal gate in the normal flow; invariant kept |
| Batch execution | Sequential autopilot in the main session; parallel worktrees out of scope |

Defaults BK ratified: auto-close defaults **on** (cancel link + persisted preference); the results **Accept button is removed entirely** (Reopen stays); `/sync` survives as a manual recovery checkpoint.

## Verified root causes (do not re-derive)

- **Gate approve white-screens on success (issue #5, cause 1).** `App.tsx:787` and `:812` return early on `submitState`, but ~15 hooks (`conn` state `:834`, health-poll effect `:838`, nav/outline/sidebar state `:913-989`) are declared **after** those returns. A successful `gateApprove` sets `submitState="approved"` (`:588`) → next render returns early → React throws `Rendered fewer hooks than expected`. No ErrorBoundary exists (`main.tsx`). **Reproduced empirically 2026-07-16** with a jsdom test (gate fixture, click Approve → uncaught hook-order error; the "Approved" card never renders). Shipped since v0.14.0 (`f3b7129` added the reconnect hooks below a v0.4-era early return; `git tag --contains` confirms). Zero existing test touches `/api/approve`. The POST lands before the crash, so the approval itself succeeds — the researcher just sees a blank page.
- **Approve dead after long-open board (issue #5, causes 2–3).** (a) The gate board has a hard 1500 s ceiling (`signoff_gate.py:34`, clamp at `:138`); after exit the tab's POST hits nothing and shows a generic "failed". (b) After any relaunch, the old tab's per-boot `boardToken` (minted `board.py:1087`, checked `:1244-1248`) 403s; `handleActionResponse` (`App.tsx:866-902`) has no 403 branch → generic "failed". The auto-reload that should rescue the tab has a hole: `initialConn` starts `lastBootId: null` and `shouldReload` returns false on null (`reconnect.ts:33`, `:57`), so a tab that never health-polled the old boot never reloads.
- **Results approval is pure convention (issue #1).** There is no `/api/verdict` route; the verdict rides the feedback POST as markdown prose only (`feedback.ts:125-136`), applied because `board.md:31` tells the agent to run `results.py verdict`. `signoff_gate.py:199-203` allows any agent's **first** `verdict.json` write unconditionally (file policy, never opens the board). Nothing blocks on a missing verdict; `finalize` ignores it. Removing the stop forfeits no mechanical guarantee.
- **Stop economics (issue #7).** A full single-component loop has ~15 human stops; exactly **one** is mechanically enforced (the plan sign-off gate, `hooks/hooks.json:3-13` → `signoff_gate.py`). Four are commit suggestions. The execute→sync hop has **no chain at all** (nothing anywhere invokes `/sync`). The deviation remedy is ordered wrong: `/sync` step 6 (version-on-deviation) runs **before** step 7 chains into `/results`, whose validator is what detects `deviations-found` — the remedy step has already passed when the problem is found.
- **Batch machinery exists and is multi-component (issue #4).** `apply_gate_batch` (`board.py:2366-2406`) iterates component dirs, newest draft each; `BatchGate.tsx` is a working wizard; tickets persist per-approve. Policy-locked to `/adopt` by the `pending < 2` refusal (`:2398-2404`). Known gaps to fix when generalizing: BatchGate mints tickets from the boot-frozen `entry["content"]` without the disk re-read `/api/feedback` does (`:1287-1301`), and it renders via an early return before every hook (`App.tsx:146`) so it never health-polls.
- **Sidebar shows no active file (issue #6).** Highlight is component-level only (`Sidebar.tsx:8`, `:218-219`); no leaf ever highlights; Outline has no active state; selection lives locally in each view (`PlanReader.tsx:164`, `Results.tsx:265`, `Reports.tsx:72`). The `onOutline` callback (`App.tsx:915`) is the established lift-view-state-to-App pattern to mirror. Gap: a component with signed versions never shows its working draft in the Files tree (`filesTree.ts:33-48`).
- **Plan readability (issue #8).** No measure limit (~1024 px column ≈ 130–150 chars/line); heading scale nearly flat and partly inverted (h1 1.25rem, h2 1.05rem, h3 0.95rem — **smaller than body**); near-uniform spacing (section gap only 2.5× paragraph gap); one flat text color; h4–h6 unstyled; task lists render bullet + checkbox; no syntax highlighting (`index.css:23-109`). Benchmark (plannotator, measured): 832 px measure, 1.6× h1:body ratio, mt-8 section rhythm, OKLCH opacity ladder, TOC that navigates instead of collapse that hides.

---

## Release 1 — v0.19.1 hotfix

### H1. Gate-approve crash fix (#5)

Move every hook declaration in `App.tsx` above the first conditional return; the early-return JSX blocks stay where they are, below all hooks. Add an `ErrorBoundary` around `<App/>` in `main.tsx` as a backstop (render a plain "the board hit an error — reload" card; never swallow silently). Regression test: the 2026-07-16 reproduction becomes a permanent test — gate fixture, click Approve, assert the "Approved — the version is being written" card renders and no hook-order error is thrown. Same assertion for Deny.

### H2. Stale-tab structural repair (#5)

1. **Seed the boot baseline.** `serve()` embeds `payload["bootId"] = boot_id` (minted at `board.py:1080`) and adds `bootId` to the `payload_generation` exclusion set alongside `publishToken`/`boardToken` (`:876-878`) so content identity is unperturbed. Client: `initialConn` seeds `lastBootId` from `data.bootId` instead of `null` — `shouldReload` then works from the first health poll and the null-hole (`reconnect.ts:33`, `:57`) closes.
2. **Self-heal on failed POST.** In `handleActionResponse` and the gate handlers: on `!res.ok` (esp. 403) or fetch failure, probe `/api/health` once. A live server with a different `bootId` → `location.reload()` (the new boot serves a fresh token and payload). No server → show a contextual card, not a generic "failed": gate mode → "This sign-off gate expired. Your draft is saved — approve it from the board (`/research-plans:board`)."; live mode → "The board server isn't running — reopen with `/research-plans:board`." The sleeping banner becomes gate-aware with the same copy.

### H3. Auto-close after action (#3)

Port plannotator's `useAutoClose` shape: on entering a terminal submit state, count down 3→1, `window.close()`, then a 300 ms `window.closed` check → on refusal, fall back to "You can close this tab and return to your session." Applies to every session-ending submit: gate approve, gate deny, in-board approve/request-changes, review request, report request (i.e., the `approved`/`denied`/action-bearing `sent` cards). Default **on**; a "keep open" link during the countdown cancels; preference persisted in localStorage (per-project key, matching the sidebar's `rp-sidebar:` convention). Note: `window.close()` succeeds for single-history-entry tabs opened by the launcher (plannotator-proven on this setup); the fallback covers refusal. Verify live during build.

### H4. Active-file indicator (#6)

- New `onActiveFile?(id: string | null)` callback, mirroring `onOutline`: PlanReader reports `doc.path` (leaf ids in the Files tree **are** plan paths, `filesTree.ts:43`); Results reports `` `${component}:r${N}` ``; Reports `` `${component}:report:r${N}` ``; Tracker `master-plan`; Timeline `decision-log` (fixing the two never-highlightable roots).
- `Sidebar` takes `activeId`; leaf highlight replaces the component-only rule (`Sidebar.tsx:218-219`); ancestors of the active node auto-expand; the roving tab stop re-syncs to the active node. The Outline sub-tab gets a header naming the active document ("v2 — 03-hetero-effects").
- Files tree: when a component has signed versions **and** a working draft, add a `v{proposedVersion} (draft)` leaf (today the draft is invisible unless it's the only plan, `filesTree.ts:48`) routing to the plans tab.

### Release mechanics

Board template rebuild + commit is part of the branch (napkin rule: `board.py` serves the committed `assets/board-template.html`; UI fixes are invisible until rebuilt). Two-file version bump + lockfile sync per `docs/RELEASING.md`. Suites: board vitest (new: hook-order regression, auto-close with fake timers, active-id highlight), py (bootId in payload + excluded from generation).

---

## Release 2 — v0.20 flow redesign

### The new stage map

Four human stops; everything else runs.

```
/plan (dialogue)                                       ← STOP 1: co-authoring
  → write .draft-v1.md (not v1.md)
  → rp-plan-reviewer scores the DRAFT
  → persistent board opens (scorecard, annotations, Review-With, Approve)
                                                       ← STOP 2: finalize (Approve → ticket → v1.md)
  → execute prompt: now/later · model · report at end? ← STOP 3: one question
execution (main session; interpretive choices still surface per SKILL rule 4)
  → capture (agent-curated bundle)         [auto]
  → validate (rp-results-validator)        [auto]
      conforms → report (if pre-answered) → sync bookkeeping → one commit suggestion
                → board on bundle (view-only) → next-step proposal   [all auto]
      deviations-found                                 ← STOP 4 (exception only):
        revise plan (auto-draft v(N+1) → review room → re-validate)
        | fix work (fix → recapture → re-validate)
        | accept-and-log (decision entry)
```

### S1. Review-room finalize (#2)

`commands/plan.md` step 7 changes: instead of writing `v1.md` (which pops the modal gate), the agent writes `.draft-v1.md`, runs the `/review` scoring pass **on the draft**, then opens the persistent board via the full `board.md` workflow. The researcher reviews with every affordance available (`actionsVisible` is true — no gate), and Approve mints the ticket via the existing in-board signoff route (`board.py:1273-1348`); the routed order has the agent write `v1.md`, which the hook admits via the ticket (`signoff_gate.py:309-314`). Request-changes routes back to the dialogue; the agent revises the draft, re-scores, and the board reopens (existing close-on-action loop). Revisions at `/sync` already use exactly this flow (`sync.md:30` writes `.draft-v<N+1>.md`); v0.20 makes v1 consistent with it.

- **Scorecard on drafts:** the scorecard file stays keyed `<slug>-v<N>.md` where N = the proposed version; PlanReader/ScorePanel matching extends from "signed version" to "working draft whose `proposedVersion` matches". On signing, content is `normalize_plan`-identical, so the same scorecard serves the signed v1 — no second dispatch (score-on-signed stays as the idempotent fallback for gate-path writes).
- **The modal gate survives as fallback** for direct `vN.md` writes outside this flow (headless sessions, hand-driven writes). Its semantics, timeout recovery, and deny loop are untouched. The invariant — no signed version without researcher approval, mechanically enforced — is preserved on both paths.

### S2. Execute prompt + `/execute` (#7, #4)

After a clean finalize (or standalone), one AskUserQuestion bundles: **execute now or later** · **model** (profile `execute` stage pre-selected; picking a different model prints the standard nudge line and waits for the `/model` switch — the researcher opted in, so waiting is correct here, unlike the never-block nudge) · **generate a report when done?** (pre-answering kills the mid-flow report question; if capture later happens in a fresh session, `results.md`'s existing offer is the fallback). New `commands/execute.md`: accepts one or more components, requires a signed latest plan per component (else points at `/plan`), asks the same prompt once, then runs components **sequentially**, full loop each, with one combined summary, one batched commit suggestion, and one next-step proposal at the end.

### S3. Autopilot tail (#7, #1)

- **Capture without interview:** the agent curates the bundle — artifact candidates from the plan's Verification section plus session outputs, captions and metrics drafted by the agent — finalizes, and shows the result on the board. `SKILL.md:39`'s "the per-component interview is the verification" doctrine is rewritten: verification = agent-curated bundle + mechanical validation + the researcher's standing reopen/recapture right (remedy for a bad bundle is `r(N+1)`, since bundles are immutable).
- **Validate before bookkeeping** (fixes the ordering hole): validation runs immediately after capture, **before** tracker/decision-log updates. `conforms`/`conforms-with-amendments` → proceed. `deviations-found` → STOP 4 with concrete remedies (above); the revise-plan path re-validates against the new version. Status derivation stays mechanical exactly as `results.md:21` specifies.
- **Sync bookkeeping runs inline** at the tail (tracker row, decision log). Unlogged decisions found in the session transcript are appended automatically with an `(auto-captured)` label — same convention as `(late-captured at sync)` — surfaced on the Timeline where the researcher can amend or annotate; the per-decision confirmation interview is dropped. `/sync` remains a manual recovery checkpoint (crashed sessions, hosted-comment pulls, work done outside `/execute`).
- **Verdict removal (#1):** Results.tsx drops Accept/Request-changes and the `pendingVerdict` wiring; **Reopen stays** (files a change request; never touched verdict.json anyway). The live board stops emitting VERDICT blocks; `board.md` drops the verdict-application step; `results.py verdict` remains as a manual/legacy CLI; existing `verdict.json` files still display. Tracker convention: `done (verified)` → **`done (validated)`**, driven by the validation status. Collaborator-ingress verdict stripping (`ACTION_KEYS` scrub) is untouched.
- **Loop closure:** after the tail, the agent proposes next steps from the tracker — next `not started` row(s), a batch-plan suggestion when several are ready, or `/renew` when the master plan is exhausted.
- **Commit ceremony:** one suggestion at the very end of the tail (covering plan, bundle, report, tracker, log); the three intermediate suggestions are dropped.

### S4. Multi-plan (#4)

- `/plan 03 04 05`: sequential co-authoring dialogues (shared context established once), each ending in a queued `.draft-v1.md` + draft scorecard; then **one** batch review room.
- The batch review room is the generalized `--gate-batch`: drop the `/adopt`-only framing in the `pending < 2` refusal (`board.py:2398-2404`) — any ≥2 pending drafts qualify; `--allow-single` semantics stay for resumed batches. BatchGate gains: **scorecard chips** (parse the payload's reviews per plan), **stale-draft re-read** before ticket mint (mirror `/api/feedback`'s disk re-hash, `board.py:1287-1301`; on mismatch return 409 and refresh the entry), and **health polling** (either move the `data.gateBatch` return below App's hooks or give BatchGate its own poll — decide in the plan phase; the current pre-hook early return is why it can't reconnect).
- Batch sign-off writes tickets per approve as today; the session then writes each `vN.md` and the execute prompt offers the whole set.

### S5. Text/doctrine edits

`SKILL.md` (stage list, rule-of-verification rewrite, autopilot description), `claude-md-section.md` (requirements rule references), `QUICKSTART.md` (the manual `/sync` hop is no longer the primary path), `plan.md`/`sync.md`/`results.md`/`board.md`/`report.md` rewiring per S1–S4, new `execute.md`. Keep additions lean — the checkup's token findings (TOK-2 externalization pattern: move runbooks to `references/`) apply to any new prose. README's authorship story is unchanged; audit its claims for stale "verdict" references.

### Backward compatibility

Old projects: existing `verdict.json` display unchanged; components without drafts behave as today; the gate fallback keeps direct-write muscle memory working; `/sync` still works standalone. No schema changes to payload files beyond `bootId` (v0.19.1) and scorecard-on-draft matching (client-side rule only).

---

## Release 3 — v0.21 readability (#8)

Template keeps its nine sections and `EXEC_SECTIONS` contract (rubric v0.4 scores from them). Three workstreams:

### R1. Typography (`index.css`, all hand-rolled — no plugin added)

| Element | Today | Target |
|---|---|---|
| Measure | none (~1024 px, 130–150 chars/line) | max-width ~52rem (832 px) on the prose column |
| h1 | 1.25rem | 1.5rem, tracking-tight (1.5× body) |
| h2 | 1.05rem | 1.25rem; top margin 1.25rem → 2rem (section rhythm) |
| h3 | 0.95rem (below body!) | 1.05rem |
| h4–h6 | unstyled | explicit fallback (semibold, ≥1em) |
| p | margin 0.5rem | 0.75rem bottom |
| hr | margin 1rem | 2rem (real section break) |
| color | one flat stone-800 | emphasis ladder: headings full-contrast, body slightly muted, metadata/captions muted (CSS vars, dark counterparts) |
| task lists | bullet + checkbox both render | `list-style: none` on checkbox items, styled check |
| tables | full 1px grid, no hover | bottom-borders, header background, row hover |
| code blocks | flat stone-100 | border + radius; syntax highlighting only if it fits the single-file template budget (decide in plan phase) |

### R2. Reading spine (renderer, `PlanReader`/`PlanBody`)

- **Metadata card:** the `Component:`/`Master plan:`/`Date:`/`Provenance:`/`Supersedes:` block renders as a bordered card (plannotator's frontmatter-card pattern), not undifferentiated prose lines.
- **Step cards:** items of the `## Build steps` ordered list render as numbered cards with a "Step N of M" label, making the chronological spine visually dominant. Constraint: content stays mounted in the DOM (AnnotationLayer anchoring); implemented as a pre-marked interception like `splitAgentDetail`, never via raw HTML.
- **Navigating TOC:** the sidebar Outline gains scroll-spy (IntersectionObserver on section headings) with an active entry — disclosure that navigates rather than collapse that hides. Builds on H4's active-doc plumbing. The detail-level collapse tiers stay (compact/standard/full semantics unchanged).

### R3. Authoring guidance (template + `plan.md`)

The template's guidance comment and `plan.md`'s authoring instructions start prescribing visual emphasis: bold the decision keyword in each Decisions row and each step's verb phrase, italics for rationale asides, paragraphs ≤4 lines, one sentence per build step with elaboration in a following indented line. The renderer has always supported bold/italic; plans simply never used them.

Hard constraints (both releases touching the renderer): collapsed content is clipped, never unmounted (AnnotationLayer); the escape-all-raw-HTML policy stands — every richness gain arrives via CSS or pre-marked conventions.

---

## Out of scope

- Parallel worktree execution (ruled out for v0.20; candidate for a later release once the sequential loop is proven).
- Chronological template rewrite / rubric v0.5 / scorecard schemaVersion 4 (ruled out with the readability decision).
- Footnotes, mermaid, or any new markdown engine features.
- Hosted/web-template changes (none of the eight issues touch the Vercel path).
- `parse.ts` non-text-byte hygiene (grep-invisibility hazard noted during exploration; separate chore, not this train).

## Testing strategy

- **v0.19.1:** vitest — hook-order regression (gate approve + deny render their cards), auto-close (fake timers: countdown, close call, refusal fallback, cancel link, persisted pref), sidebar active-id (highlight, ancestor expansion, draft leaf); py — `bootId` present in payload and excluded from `payload_generation`; live smoke: gate approve end-to-end in a real browser (the class of bug that unit tests structurally missed — no test ever clicked Approve).
- **v0.20:** py — batch policy change (≥2 pending non-adopt drafts accepted; stale-draft 409 in batch approve), scorecard-on-draft matching fixtures; walkthrough script (`scripts/new-walkthrough.py` synthetic project) driving plan→finalize→execute→capture→validate happy path and the deviation branch; template rebuild; live board eyeball of the review room.
- **v0.21:** vitest snapshot/behavior tests for metadata card, step cards, TOC scroll-spy; visual eyeball against a real plan at all three detail levels; annotation round-trip on collapsed/step-card content (the AnnotationLayer constraint).

## Revision history

- 2026-07-16 — initial design; rulings from two AskUserQuestion rounds (sequencing, stop map, multi-plan shape, readability depth, first-plan finalize, batch execution mode); root causes verified in code, gate-approve crash reproduced empirically.
