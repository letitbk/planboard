# Flow streamlining: approve reliability, workflow autopilot, plan readability

**Date:** 2026-07-16 · **Status:** approved design, rev 2 (codex findings folded) · **Baseline:** main @ 11cf00c (v0.19.0)

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
| Commit policy | Plan-commit consent folds into the execute prompt: a yes to "execute now?" explicitly includes committing the signed plan first, so the rubric's `uncommitted` integrity flag stays meaningful with zero extra stops (codex P1, BK "fold all") |

Defaults BK ratified: auto-close defaults **on** (cancel link + persisted preference); the results **Accept button is removed entirely** (Reopen stays, extended to verdictless bundles — see S3); `/sync` survives as a manual recovery checkpoint.

Cross-model review: codex (gpt-5.6-sol, xhigh) reviewed rev 1 against the code — `docs/specs/2026-07-16-codex-review-flow-streamlining.md`. No P0. All 7 factual corrections and all P1/P2 findings are folded into this revision; codex confirmed the S1 ticket chain composes with the sign-off hook provided the agent keeps the route-before-ack order (`board.py:997/1107/1273`, `signoff_gate.py:38/60`, `board.md:11`).

## Verified root causes (do not re-derive)

- **Gate approve white-screens on success (issue #5, cause 1).** `App.tsx:787` and `:812` return early on `submitState`, but ~15 hooks (`conn` state `:834`, health-poll effect `:838`, nav/outline/sidebar state `:913-989`) are declared **after** those returns. A successful `gateApprove` sets `submitState="approved"` (`:588`) → next render returns early → React throws `Rendered fewer hooks than expected`. No ErrorBoundary exists (`main.tsx`). **Reproduced empirically 2026-07-16** with a jsdom test (gate fixture, click Approve → uncaught hook-order error; the "Approved" card never renders). Shipped since v0.14.0 (`f3b7129` added the reconnect hooks below a v0.4-era early return; `git tag --contains` confirms). Zero existing test touches `/api/approve`. The POST lands before the crash, so the approval itself succeeds — the researcher just sees a blank page. (The `data.gateBatch` early return at `App.tsx:146` is a different case: render-stable because `data` is static, so legal — until batch gains polling in v0.20, when it must move below the hooks or split into a child component.)
- **Approve dead after long-open board (issue #5, causes 2–3).** (a) The gate board has a hard 1500 s ceiling (`signoff_gate.py:34`, clamp at `:138`); after exit the tab's POST hits nothing and shows a generic "failed". (b) After any relaunch, the old tab's per-boot `boardToken` (minted `board.py:1087`, checked `:1244-1248`) 403s; `handleActionResponse` (`App.tsx:866-902`) has no 403 branch → generic "failed". The auto-reload that should rescue the tab has a hole: `initialConn` starts `lastBootId: null` and `shouldReload` returns false on null (`reconnect.ts:33`, `:57`), so a tab that never health-polled the old boot never reloads.
- **Results approval is pure convention (issue #1).** There is no `/api/verdict` route; the verdict rides the feedback POST as markdown prose only (`feedback.ts:125-136`), applied because `board.md:31` tells the agent to run `results.py verdict`. `signoff_gate.py:199-203` allows any agent's **first** `verdict.json` write unconditionally (file policy, never opens the board). Nothing blocks on a missing verdict; `finalize` ignores it. But the verdict is load-bearing for **display**: Reopen renders only when `bundle.verdict` exists (`Results.tsx:589`), Tracker's verified styling (`Tracker.tsx:224`), report status chips and stale-report comparison (`Reports.tsx:21/229`), and report markers (`report.md:14`) all read it. Removal therefore requires a replacement bundle-state model (S3), not just deleting two buttons.
- **Stop economics (issue #7).** A full single-component loop has ~15 human stops; exactly **one** is mechanically enforced (the plan sign-off gate, `hooks/hooks.json:3-13` → `signoff_gate.py`). Four are commit suggestions. The execute→sync hop has **no chain at all** (nothing anywhere invokes `/sync`). The deviation remedy is ordered wrong: `/sync` step 6 (version-on-deviation) runs **before** step 7 chains into `/results`, whose validator is what detects `deviations-found` — the remedy step has already passed when the problem is found.
- **Batch is already multi-component and NOT mechanically adopt-restricted (issue #4).** `apply_gate_batch` (`board.py:2366-2406`) iterates component dirs, newest draft each; two ordinary `/plan` drafts qualify today. The `/adopt`-only framing lives in the docstring, help text, and the `pending < 2` refusal message (`:2398-2404`) — policy prose, not provenance enforcement. So S4 is policy/UX work, not an authorization change. Known gaps to fix when generalizing: BatchGate mints tickets from the boot-frozen `entry["content"]` without the disk re-read `/api/feedback` does (`:1287-1301`); it renders via the pre-hook early return so it never health-polls; already-ticketed drafts ride the payload and render as pending on resume (`:2375`, `BatchGate.tsx:13`); rejections live only in process memory (`:1405`); ticket writes are not atomic (`:2301`).
- **Sidebar shows no active file (issue #6).** Highlight is component-level only (`Sidebar.tsx:8`, `:218-219`); no leaf ever highlights; Outline has no active state (`OutlineEntry` has no active property, `outline.ts:1`); selection lives locally in each view (`PlanReader.tsx:164`, `Results.tsx:265`, `Reports.tsx:72`). The `onOutline` callback (`App.tsx:915`) is the established lift-view-state-to-App pattern to mirror. Gap: a component with signed versions never shows its working draft in the Files tree (`filesTree.ts:33-48`).
- **Scorecard identity is exact-path (issue #2 dependency).** Review scorecards attach by exact `planPath` match to a **signed** document (`PlanReader.tsx:248`); `normalize_plan` plays no role in matching (it only feeds ticket hashing). The reviewer command, scorecard template, and reviewer agent all hardcode `vN.md` (`review.md:15`, `review-scorecard.md:32`, `rp-plan-reviewer.md:23`). A card scored for `.draft-vN.md` will never attach to `vN.md` without an explicit migration (S1).
- **Plan readability (issue #8).** Heading scale nearly flat and partly inverted (h1 1.25rem, h2 1.05rem, h3 0.95rem — **smaller than body**); near-uniform spacing (section gap only 2.5× paragraph gap); one flat text color; h4–h6 unstyled; task lists render bullet + checkbox; no syntax highlighting (`index.css:23-109`). Measure: no max-width on prose; the app container is `max-w-5xl` (`App.tsx:1176`) and the expanded desktop sidebar consumes `w-56` of it, so prose approaches ~1024 px mainly with the sidebar collapsed — still uncapped, but the win varies by layout state. Benchmark (plannotator, measured): 832 px measure, 1.6× h1:body ratio, mt-8 section rhythm, OKLCH opacity ladder, TOC that navigates instead of collapse that hides.

---

## Release 1 — v0.19.1 hotfix

### H1. Gate-approve crash fix (#5)

Move every hook declaration in `App.tsx` above the first conditional return; the early-return JSX blocks stay where they are, below all hooks. Add an `ErrorBoundary` around `<App/>` in `main.tsx` as a backstop (render a plain "the board hit an error — reload" card; never swallow silently) — noting the boundary is a backstop, not a fix: it does not legalize conditional hooks. Regression test: the 2026-07-16 reproduction becomes a permanent test — gate fixture, click Approve, assert the "Approved — the version is being written" card renders and no hook-order error is thrown. Same assertion for Deny.

### H2. Stale-tab structural repair (#5)

1. **Seed the boot baseline.** `serve()` embeds `payload["bootId"] = boot_id` (minted at `board.py:1080`) **before** `payload_generation()` runs and before HTML injection, and `bootId` joins the exclusion set alongside `publishToken`/`boardToken` (`:876-878`) — otherwise every restart would change `generation` and defeat content-identity comparison. `bootId` is added to the `BoardData` type. Client: `initialConn` seeds `lastBootId` from `data.bootId` instead of `null` — `shouldReload` then works from the first health poll and the null-hole (`reconnect.ts:33`, `:57`) closes.
2. **Centralized self-heal on failed POST.** One recovery helper shared by `handleActionResponse`, the gate approve/deny handlers (and batch actions in v0.20): on `!res.ok` (esp. 403) or fetch failure, probe `/api/health` once. A live server with a different `bootId` → `location.reload()` (the new boot serves a fresh token and payload). No server → a contextual card, not a generic "failed" — and the copy must account for the ambiguity that the order may already have been durably persisted before the response was lost (`board.py:1122`, `:1330`): gate mode → "This sign-off gate has ended. If you clicked Approve, it may already be recorded — check your Claude session. Your draft is saved either way; you can approve it from the board (`/research-plans:board`)."; live mode → "The board server isn't running — your submission may already have reached your session; otherwise reopen with `/research-plans:board`." The sleeping banner becomes gate-aware with the same copy.

### H3. Auto-close after action (#3)

Port plannotator's `useAutoClose` shape: on entering a terminal submit state, count down 3→1, `window.close()`, then a 300 ms `window.closed` check → on refusal, fall back to "You can close this tab and return to your session." Default **on**; a "keep open" link during the countdown cancels; preference persisted in localStorage (per-project key, matching the sidebar's `rp-sidebar:` convention).

**Scope — auto-close applies only to actions that end the board session for good:** gate approve, gate deny, in-board signoff approve/request-changes, plain feedback send. **Review requests and report requests are exempt:** those actions intentionally terminate the server, do long work, and relaunch on the same port with `--no-open` (`board.md:15/38/55`) — the old tab reloading into the new boot **is** the browser window; closing it would leave the relaunched board with no window. Since `submitState` today records only `"sent"` (`App.tsx:487`, `:812`), the client additionally records **which action kind was sent**, and the auto-close hook keys off that. Note: `window.close()` succeeds for single-history-entry tabs opened by the launcher (plannotator-proven on this setup); the fallback covers refusal. Verify live during build.

### H4. Active-file indicator (#6)

- New `onActiveFile?(id: string | null)` callback, mirroring `onOutline` (publish on render, **clear on unmount**): PlanReader reports `doc.path` (leaf ids in the Files tree **are** plan paths, `filesTree.ts:43`); Results reports `` `${component}:r${N}` ``; Reports `` `${component}:report:r${N}` ``; Tracker `master-plan`; Timeline `decision-log` (fixing the two never-highlightable roots). App clears the active id on switches to non-reporting tabs (Archive, Models) so a stale leaf never stays lit.
- `Sidebar` takes `activeId`; leaf highlight replaces the component-only rule (`Sidebar.tsx:218-219`); **every** ancestor of the active node auto-expands; the roving tab stop re-syncs to the active leaf. The Outline sub-tab gets a header naming the active document ("v2 — 03-hetero-effects").
- Files tree: when a component has signed versions **and** a working draft, add a `v{proposedVersion} (draft)` leaf (today the draft is invisible unless it's the only plan, `filesTree.ts:48`) routing to the plans tab.

### Release mechanics

Board template rebuild + commit is part of the branch (napkin rule: `board.py` serves the committed `assets/board-template.html`; UI fixes are invisible until rebuilt). Two-file version bump + lockfile sync per `docs/RELEASING.md`. Suites: board vitest (new: hook-order regression for approve **and** deny; auto-close with fake timers incl. cancel link, persisted pref, refusal fallback, and the review/report exemption; active-id highlight, ancestor expansion, clearing rule, draft leaf) plus an **old-tab integration test**: stale token → failed POST → health probe → changed boot → reload (not just the happy approve); py — `bootId` present in payload, excluded from `payload_generation`, assigned before injection.

---

## Release 2 — v0.20 flow redesign

### The new stage map

Four human stops; everything else runs.

```
/plan (dialogue)                                       ← STOP 1: co-authoring
  → write .draft-v1.md (not v1.md; NO sign-off trailer)
  → rp-plan-reviewer scores the DRAFT
  → persistent board opens (scorecard, annotations, Review-With, Approve)
                                                       ← STOP 2: finalize (Approve → ticket → v1.md)
  → execute prompt: now/later · model · report at end?
    (a yes includes committing the signed plan first)  ← STOP 3: one question
execution (main session; interpretive choices still surface per SKILL rule 4)
  → capture (agent-curated bundle)         [auto]
  → validate (rp-results-validator)        [auto]
      conforms* → report (if pre-answered) → tail bookkeeping → one commit suggestion
                → board on bundle (view-only) → next-step proposal   [all auto]
      deviations-found                                 ← STOP 4 (exception only):
        revise plan (auto-draft v(N+1) → review room → re-validate)
        | fix work (fix → recapture → re-validate)
        | accept-and-log (decision entry)
```

### S1. Review-room finalize (#2)

`commands/plan.md` step 7 changes: instead of writing `v1.md` (which pops the modal gate), the agent writes `.draft-v1.md` — **without** the template's `---` separator and `Signed off:` trailer, which are appended only in the ticketed `vN.md` write, because the board's approve rejects a draft whose last line is already a trailer (`board.py:1302`; template comment and `plan.md` gain this instruction). It then runs the `/review` scoring pass **on the draft** and opens the persistent board via the full `board.md` workflow. The researcher reviews with every affordance available (`actionsVisible` is true — no gate), and Approve mints the ticket via the existing in-board signoff route (`board.py:1273-1348`); the routed order has the agent write `v1.md`, which the hook admits via the ticket (`signoff_gate.py:309-314`). The agent keeps the existing route-before-ack order (write the signed file, then acknowledge the order) — codex confirmed the chain composes on exactly that order. Request-changes routes back to the dialogue; the agent revises the draft, re-scores, and the board reopens (existing close-on-action loop). Revisions at `/sync` already use exactly this flow (`sync.md:30` writes `.draft-v<N+1>.md`); v0.20 makes v1 consistent with it.

- **Scorecard on drafts — explicit migration, not matching magic.** Scorecards attach by exact `planPath` (`PlanReader.tsx:248`), so: `review.md`, `review-scorecard.md`, and the `rp-plan-reviewer` template learn to score a `.draft-vN.md` path (filename stays `<slug>-vN.md`, keyed by proposed version); PlanReader learns to attach a card whose `planPath` exactly matches the **working draft's** path; and at sign-off routing, the same step that writes `vN.md` **rewrites the scorecard's `planPath` and prose link** from the draft path to the signed path. Matching stays exact-path with signed-path precedence — existing cards on old projects are untouched, and the deliberate ambiguous-match-→-none rule is preserved. Compatibility tests cover: legacy signed card, migrated card, draft card pre-signing, and the ambiguous case. Score-on-signed stays as the idempotent fallback for gate-path writes.
- **The modal gate survives as fallback** for direct `vN.md` writes outside this flow (hand-driven writes, recovery). Its semantics, timeout recovery, and deny loop are untouched. The invariant — no signed version without researcher approval — is mechanically enforced on both paths, **with one pre-existing documented exception:** `RESEARCH_PLANS_NO_GATE=1` bypasses the gate outright and the skill recommends it for headless/CI use (`signoff_gate.py:273`, `SKILL.md:46`). This design does not change that escape hatch; it remains the accepted, documented headless exception.
- **Integration test (new):** one end-to-end py test drives the full chain — live approval POST → bound ticket + durable order → actual hook admission of the `vN.md` write → ack — rather than today's separate ticket-creation and hand-built-order tests (`test_board.py:2257`, `test_gate_explicitness.py:275`).

### S2. Execute prompt + `/execute` (#7, #4)

After a clean finalize (or standalone), one AskUserQuestion bundles: **execute now or later** · **model** (profile `execute` stage pre-selected; picking a different model prints the standard nudge line and waits for the `/model` switch — the researcher opted in, so waiting is correct here, unlike the never-block nudge) · **generate a report when done?** (one answer covers every component in a batch; if capture later happens in a fresh session, `results.md`'s existing offer is the fallback). **A yes to "execute now" explicitly includes committing the signed plan (and scorecard) before execution starts** — stated in the question — so the rubric's prospective-plan integrity condition (`review.md:9`, `plan-rubric.md:67`) keeps firing honestly and no extra stop is added.

New `commands/execute.md`: accepts one or more components, requires a signed latest plan per component (else points at `/plan`), asks the same prompt once, then runs components **sequentially**, full loop each, with one combined summary, one batched tail commit suggestion, and one next-step proposal at the end. Argument edge cases specified: unknown component → error naming valid rows; unsigned draft → point at the review room; already-executed with current results → offer re-run vs skip; mixed set → per-component statement before starting. **Headless:** the prompt cannot be asked, so `/execute` never auto-runs — it requires explicit arguments (`--model`, `--report`, an explicit go), and absent those it prints what is needed and stops. To keep the command lean (checkup TOK pattern, `docs/evaluation/checkup/token-report.md`), the execution runbook lives in `skills/managing-research-plans/references/execution-loop.md` and `execute.md` stays a thin entry point; results/sync/board instructions are referenced, never duplicated.

### S3. Autopilot tail (#7, #1)

- **Capture without interview:** the agent curates the bundle — artifact candidates from the plan's Verification section plus session outputs, captions and metrics drafted by the agent — finalizes, and shows the result on the board. **Named tradeoff (accepted by BK):** this transfers first-draft claim authorship to the agent; the conformance validator checks execution against the plan, not whether an auto-phrased empirical claim is warranted. Mitigations: findings carry an agent-drafted provenance label (rides the existing `modelUsage` provenance seam), the bundle is surfaced on the board immediately, and the researcher's standing remedy is reopen/recapture as `r(N+1)` (bundles are immutable). `SKILL.md:39`'s "the per-component interview is the verification" doctrine is rewritten accordingly.
- **Validate before bookkeeping** (fixes the ordering hole): validation runs immediately after capture, **before** tracker/decision-log updates. Status derivation stays mechanical exactly as `results.md:21` specifies. The **full outcome matrix** (codex P1 — the tail must define every case, not just two):

| Validation outcome | Tracker status | Flow |
|---|---|---|
| `conforms` | `done (validated)` | proceed |
| `conforms-with-amendments` | `done (validated — amendments logged)` | proceed |
| `deviations-found` | held — no status write until resolved | **STOP 4** with remedies; revise-plan path re-validates against the new version |
| `unverifiable` | `done (validation unverifiable)` | proceed; surfaced on the board |
| `skipped` (opt-out / headless) | `done (unvalidated)` | proceed |
| `not-applicable` (retrofit) | `done (retrofit)` | proceed |
| integrity failed | badge only — orthogonal to all rows above | advisory as today (`results.py:370`); never blocks |
| zero qualifying artifacts | no bundle | existing `results.md` rule: report and stop, never an empty bundle |

- **Verdict removal (#1) — a replacement bundle-state model, not button deletion.** Validation status becomes the durable bundle state. Concretely: Results.tsx drops Accept/Request-changes and the `pendingVerdict` wiring; **Reopen extends to every finalized bundle** (today it renders only when `bundle.verdict` exists, `Results.tsx:589`) and `board.md`'s "accepted bundle" reopen language is revised; Tracker's verified styling (`Tracker.tsx:224`) keys off validation status; the report marker's `verdict` field is versioned — new markers stamp validation status, readers accept both generations — and Reports' status chips + stale-report comparison (`Reports.tsx:21/229`) follow; legacy `verdict.json` files still display; `results.py verdict` remains as a manual/legacy CLI. Collaborator-ingress action stripping (`ACTION_KEYS`, `board.py:2005`) is untouched — legacy verdict keys stay stripped; UI removal is not a reason to relax ingress hardening.
- **Tail bookkeeping — explicit division of `/sync`'s jobs.** The tail carries: tracker reconciliation, decision-log capture, the split flag (propose split as tracker rows when a component ballooned), source-drift detection (`results.py changed`), and plan revision via STOP 4. `/sync` **retains as manual-checkpoint-only:** hosted-comment pulls, adoption-cutoff handling, no-git evidence handling, and full recovery reconciliation for work done outside `/execute`. Unlogged decisions found in the session are appended automatically with an `(auto-captured)` heading label — which requires **parser + Timeline support** (today `parse.ts:195` keeps only a `late-captured` boolean and discards other suffixes; the parser gains an `autoCaptured` flag and Timeline a badge). Amending an auto-captured entry means **appending a corrective entry** — the decision log stays append-only.
- **Loop closure:** after the tail, the agent proposes next steps from the tracker — next `not started` row(s), a batch-plan suggestion when several are ready, or `/renew` when the master plan is exhausted.
- **Commit ceremony:** the plan commit rides the execute prompt (see S2); one tail suggestion covers bundle, report, tracker, and log; the intermediate suggestions are dropped.
- **Headless deviation stop:** record `deviations-found`, stop, and report — never auto-pick a remedy.

### S4. Multi-plan (#4)

- `/plan 03 04 05`: sequential co-authoring dialogues (shared context established once), each ending in a queued `.draft-v1.md` + draft scorecard; then **one** batch review room. Argument edge cases: already-signed component → named and skipped; existing draft → resumed, not duplicated; unknown → error before any dialogue.
- The batch review room is the generalized `--gate-batch` — a **policy/UX change, not an authorization change** (batch was never mechanically adopt-restricted): the `pending < 2` refusal message (`board.py:2398-2404`) drops its "/adopt bulk flow" framing; `--allow-single` semantics stay for resumed batches. BatchGate gains: **scorecard chips** (parse the payload's reviews per plan); **stale-draft re-read** before ticket mint (mirror `/api/feedback`'s disk re-hash, `board.py:1287-1301`) where a mismatch returns 409 **and refreshes both the server's authoritative batch entry and the React entry in place**; **health polling** (the `data.gateBatch` branch moves below App's hooks or BatchGate becomes a child component with its own poll — required, since the current pre-hook early return is why it can't reconnect); and **resume honesty** — already-ticketed drafts render as `approved`, not pending (today `apply_gate_batch` includes them while only excluding them from the pending count, `board.py:2375`, and `BatchGate.tsx:13` initializes everything pending). Ticket writes switch to `atomic_write` (today a crash mid-`write_text` leaves a corrupt ticket the hook denies, `board.py:2301`). Request-changes decisions remain in process memory — acceptable and now documented: if the process dies, unapproved drafts simply stay pending and the batch re-runs. Deleted-draft and newer-draft-appeared cases 404/refresh cleanly.
- Batch sign-off writes tickets per approve as today; the session then writes each `vN.md` and the execute prompt offers the whole set. Named tradeoff: batch tickets carry no `orderActionId` (`board.py:2315`) — intentional, but broader use makes the content-hash ticket the entire authorization record; the audit trail is the ticket file plus the batch summary the session prints.

### S5. Text/doctrine edits

`SKILL.md` (stage list, rule-of-verification rewrite, autopilot description), `claude-md-section.md` (requirements rule references), `QUICKSTART.md` (the manual `/sync` hop is no longer the primary path; verdict language removed), `docs/reference.md` and `results-adopt.md` (verdict → validation-state language), `plan.md`/`sync.md`/`results.md`/`board.md`/`report.md` rewiring per S1–S4, new `execute.md` + `references/execution-loop.md`. README's authorship story is unchanged; audit its claims for stale verdict references (`README.md:49`, `QUICKSTART.md:54`, `reference.md:72`). Docs screenshots re-shoot after the board changes (screenshots are version-specific). **Re-run the checkup token report after v0.20** — command `description:` lines are unconditional per-session cost and the new command must not regress the ~750-token floor.

### Backward compatibility

Old projects: existing `verdict.json` display unchanged; legacy report markers read; scorecard matching keeps exact signed-path precedence (new draft matching applies only when unambiguous); components without drafts behave as today; the gate fallback keeps direct-write muscle memory working; `/sync` still works standalone. Payload schema changes: `bootId` (v0.19.1), batch entry status (v0.20), report-marker versioning (v0.20) — all additive, present-only keys.

---

## Release 3 — v0.21 readability (#8)

Template keeps its nine canonical sections (the parser's `EXEC_SECTIONS` accepts ten headings — the tenth is the legacy `Scope decisions` alias, `parse.ts:242` — and that compatibility list is untouched; rubric v0.4 scores from the canonical sections). Three workstreams:

### R1. Typography (`index.css`, all hand-rolled — no plugin added)

Scope: the shared `.prose-md` improvements (heading scale, emphasis ladder, task lists, tables, code, h4–h6) apply to **every** prose surface — they are strict improvements. The **measure cap** applies to the document-reading views (PlanReader, Reports), and line length is verified in all four layout states: sidebar expanded/collapsed, docked feedback panel, and mobile — the effective measure differs per state (`App.tsx:1176` `max-w-5xl` minus the expanded sidebar's `w-56`), so the cap is sized against the widest case rather than assumed from one number.

| Element | Today | Target |
|---|---|---|
| Measure | uncapped (up to ~1024 px with sidebar collapsed) | max-width ~52rem on the prose column of reading views |
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

- **Metadata card:** the `Component:`/`Master plan:`/`Date:`/`Provenance:`/`Supersedes:` block renders as a bordered card (plannotator's frontmatter-card pattern), not undifferentiated prose lines. The parser already exposes these fields (`parse.ts:294`); the card renderer must stay tolerant of legacy plans — missing lines, links in values, malformed metadata, preamble text — falling back to plain prose rendering.
- **Step cards:** items of the `## Build steps` ordered list render as numbered cards with a "Step N of M" label, making the chronological spine visually dominant. **Implemented through parsed Markdown structure (marked's lexer tokens or the section model), never regex over raw text** — build steps are ordinary lists, unlike the deliberately pre-marked agent-detail convention, and regex wrapping breaks nested lists and multi-paragraph steps. Tests: nested lists, multi-paragraph steps, links, code blocks, agent-detail blocks inside a step, and annotation anchors across all of it. Constraint: content stays mounted in the DOM (AnnotationLayer anchoring); no raw HTML.
- **Navigating TOC:** the sidebar Outline gains scroll-spy (IntersectionObserver on section headings) with an active entry — disclosure that navigates rather than collapse that hides. `OutlineEntry` gains an active-state channel (or a parallel active-heading state — it currently has no active property, `outline.ts:1`). Defined behaviors: diff mode publishes no outline (existing rule, unchanged); compact-collapsed method sections keep visible headings, so the spy tracks headings regardless of body clipping. Verify scroll-spy DOM reads don't destabilize annotation anchors. Builds on H4's active-doc plumbing.

### R3. Authoring guidance (template + `plan.md`)

The template's guidance comment and `plan.md`'s authoring instructions start prescribing visual emphasis: bold the decision keyword in each Decisions row and each step's verb phrase, italics for rationale asides, paragraphs ≤4 lines, one sentence per build step with elaboration in a following indented line. The renderer has always supported bold/italic; plans simply never used them.

Hard constraints (both releases touching the renderer): collapsed content is clipped, never unmounted (AnnotationLayer); the escape-all-raw-HTML policy stands — every richness gain arrives via CSS or structure-level rendering of parsed Markdown.

---

## Out of scope

- Parallel worktree execution (ruled out for v0.20; candidate for a later release once the sequential loop is proven).
- Chronological template rewrite / rubric v0.5 / scorecard schemaVersion 4 (ruled out with the readability decision).
- Footnotes, mermaid, or any new markdown engine features.
- Hosted/web-template changes (none of the eight issues touch the Vercel path).
- Changing the headless `RESEARCH_PLANS_NO_GATE` escape hatch (documented accepted exception; unchanged).
- `parse.ts` non-text-byte hygiene (grep-invisibility hazard noted during exploration; separate chore, not this train).

## Testing strategy

- **v0.19.1:** vitest — hook-order regression (gate approve **and** deny render their cards), auto-close (fake timers: countdown, close call, refusal fallback, cancel link, persisted pref, review/report exemption), sidebar active-id (highlight, ancestor expansion, clearing on tab switch, draft leaf); the old-tab integration test (403 → health probe → changed boot → reload); py — `bootId` in payload, excluded from `payload_generation`, assigned before injection; live smoke: gate approve end-to-end in a real browser plus a review-request relaunch with auto-close enabled (the tab must survive it).
- **v0.20:** py — the full sign-off chain integration test (POST → ticket/order → hook admission → signed write → ack); batch: policy change, stale-draft 409 + in-place refresh, resume shows ticketed drafts as approved, atomic ticket write; scorecard migration fixtures (legacy signed, migrated, draft pre-signing, ambiguous); report-marker two-generation reads; walkthrough script (`scripts/new-walkthrough.py` synthetic project) driving plan→finalize→execute→capture→validate happy path, the deviation branch, and headless refusal paths; template rebuild; live board eyeball of the review room.
- **v0.21:** vitest for metadata card (incl. legacy-tolerance cases), step cards (nested/multi-paragraph/agent-detail/annotation cases), TOC scroll-spy; visual eyeball against a real plan at all three detail levels and all four layout states; annotation round-trip on collapsed and step-card content.

## Resolved defaults (codex open questions)

1. Durable bundle state = validation status (+ orthogonal integrity badge); capture completion = bundle existence. 2. Reopen available on every finalized bundle. 3. Outcome→status mapping per the S3 matrix. 4. Plan committed before execution via execute-prompt consent (rulings table). 5. Scorecard: migrate at sign-off; exact-path matching with signed precedence. 6. Review/report actions are exempt from auto-close. 7. Headless `NO_GATE` bypass stays a documented accepted exception. 8. Batch request-changes decisions are process-memory only — documented; re-run on interruption. 9. One report preference per execution batch. 10. Amending an auto-captured decision = appending a corrective entry; the log stays append-only.

## Revision history

- 2026-07-16 rev 2 — codex (sol/xhigh) review folded in full, BK "fold all": 7 factual corrections (batch never mechanically adopt-restricted; NO_GATE headless caveat; scorecard exact-path identity + migration mechanism; Reopen's verdict dependency → bundle-state model; auto-captured needs parser/Timeline support; measure claim corrected for sidebar layouts; EXEC_SECTIONS ten-heading compatibility list), auto-close review/report exemption + action-kind tracking, commit-policy fork resolved as execute-prompt consent, validation outcome matrix, /sync job division, batch state/resume/atomicity work, headless defaults, token/doc sweep items, expanded tests.
- 2026-07-16 rev 1 — initial design; rulings from two AskUserQuestion rounds (sequencing, stop map, multi-plan shape, readability depth, first-plan finalize, batch execution mode); root causes verified in code, gate-approve crash reproduced empirically.
