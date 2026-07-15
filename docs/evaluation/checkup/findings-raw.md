# Findings (raw) — Phase 1 sweep + Phase 2 probes

Working ledger. Each finding: `id` · dimension · surface:location · scenario-row · provisional-severity · evidence · verification-status · proposed-direction · effort · risk-note. Provisional severity is a triage tag; final priority is derived in Task 12 (impact × likelihood × reach × confidence). `read-confirmed` = verified against the real file by the controller; `to-verify` = needs a Phase-2 probe to close.

Sections: controller reads (commands/skill/templates/manifests/hooks) filed first; subagent sweeps (board UI, scripts, docs, web-template) integrated after controller verification; probe findings appended per task.

---

## Coherence

**COH-1 · board lifecycle doc drift** · `docs/reference.md:50` vs `commands/board.md:15,22` · S18-adjacent · **P2** · read-confirmed
`reference.md:50`: "the board refreshes itself with the updated state. After an idle hour it goes to sleep." `board.md:15`: "has **no idle timeout** … the board … **closes**." `board.md:22`: "a plain live board **never sleeps**." The user-facing reference describes the pre-v0.18 lifecycle.
→ Update `reference.md:50` to the close-on-action + no-idle-timeout behavior. Effort **S**. Risk-note: none (pure doc fix).

**COH-2 · model-nudge paragraph duplicated ×3** · `SKILL.md:27`, `plan.md:9`, `sync.md:8` · — · **P2** · read-confirmed
The sentence "Model profile: this stage is set to <model>… Switch with /model…" is verbatim in all three; surrounding logic differs per stage.
→ Extract a shared snippet parameterized by stage. Effort **M**. Risk-note: **load-bearing variation** — `plan.md:9` appends `, effort <level>` handling the other two lack; a naive merge drops it. Weigh in synthesis.

**COH-3 · initialized-project gate restated ×8** · `review.md:7`, `adopt.md:9`, `plan.md:7`, `sync.md:6`, `models.md:6`, `results.md:7`, `report.md:7` (exact phrase) + `board.md:9` (variant phrasing) · — · **P2** · read-confirmed
Eight commands gate on an initialized project in two phrasings (init/renew are the exceptions).
→ A shared "requires-init" preamble. Effort **S**. Risk-note: low; a simple guard, though board.md integrates it into its step 1.

**COH-4 · provenance rule near-duplicated** · `SKILL.md:51` + `results.md:19` · S16 · **P2** · read-confirmed
The full planned/retrofit rule appears nearly verbatim in both.
→ Consolidate to SKILL.md + a reference. Effort **M**. Risk-note: `results.md:19` needs the rule inline at the manifest-writing step (load-bearing there) — keep a terse inline pointer.

**COH-5 · stale `token_ok` docstring** · `board.py:867-870` · S10 · **P2** · read-confirmed (non-bug)
Docstring says the per-boot token is "NOT yet enforced in do_POST"; `do_POST:1216` enforces it. Code correct, comment stale.
→ Delete/correct the docstring. Effort **S**. Risk-note: none.

---

## Token efficiency

**TOK-1 · always-on floor = 524 est-tokens** · 10 command `description:` lines + skill description · — · **P1** · read-confirmed (measured, `token-report.md §1` = 2094 B)
The only unconditional cost — loaded every session in every project, including repos that never use the workflow.
→ Tighten the 4 wordiest descriptions (renew 217 B, adopt 211 B, results 209 B, report 195 B). Effort **S**. Risk-note: descriptions are discovery text — keep them clear; trim padding, not meaning. **Highest-frequency lever in the plugin.**

**TOK-2 · board.md web-runbook is 36% of every /board open** · `board.md` step 10→EOF = 12,652 B of 34,825 · — · **P1** · read-confirmed (measured)
The Vercel web-publish runbook (steps 10–14) loads on every plain `/board` open, though it is only reached by `--publish*`/`--pull`/`--web-connect`.
→ Move the web runbook to a reference file loaded only on those modes; board.md's plain-open path drops ~36%. Effort **M**. Risk-note: the mode dispatch (step 3) must still route correctly — keep the mode table, externalize the runbook body.

**TOK-3 · /plan sign-off chain loads ~13.7k est-tokens into the main context** · `plan.md`+`execution-plan.md`+`review.md`+`board.md` · — · **P1** · read-confirmed (measured, `token-report.md §3`)
The `/plan` auto-chain (plan.md:34 → /review → /board) pulls the entire `board.md` (8.7k) into the main session context; peak 13,719 est-tokens, board.md dominant.
→ Directly reduced by TOK-2 (board.md split). Effort **M** (same fix). Risk-note: none beyond TOK-2's.

**TOK-4 · results.md adopt/reconcile block is 26%** · `results.md` step 8→EOF = 4,861 B of 18,048 · — · **P2** · read-confirmed (measured)
The adopt/reconcile/regeneration modes load on every plain single-capture `/results`.
→ Mode-split like board.md (move adopt+reconcile to a reference). Effort **M**. Risk-note: the single-capture path (steps 1–7) is the common case and must stay inline; only the mode branches externalize.

---

## Portability

**POR-1 · codex/agy unguarded in board Review-with** · `board.md:44,46,47` · SUP · **P1** · read-confirmed (static); runtime to-verify by T8
The `codex`/`agy` review paths shell out with no `command -v` guard, unlike `pandoc` (`report.md:24`).
→ Add a `command -v codex`/`agy` preflight mirroring report.md's pandoc guard, so a missing CLI yields a graceful "not available" not a raw failure. Effort **S**. Risk-note: verify the exact failure mode in T8 (missing-tool arm) before wording the fix.

**POR-2 · headless /init dead-ends** · `init.md` interview · S11 · **P1** · to-verify (T8 closes)
Headless `AskUserQuestion` is auto-denied (`--permission-mode dontAsk`, per baseline.md), so a bare headless `/init` asks questions and exits with no artifacts (friction-log 1.1, still pending ruling).
→ Detect headless + either seed-args guidance or a clear "nothing was created; re-run with …" message. Effort **M**. Risk-note: confirm the current behavior in the T8 clean-room before designing the fix.

---

## Security / least-privilege

**SEC-1 · rp-plan-reviewer grants unscoped Bash** · `rp-plan-reviewer.md:6` (`tools: Read, Grep, Glob, Bash`) · — · **P2** · read-confirmed
The other two agents (`rp-board-reviewer`, `rp-results-validator`) carry no Bash. rp-plan-reviewer needs git for integrity flags, but agent frontmatter can't scope `Bash(git:*)` (platform limitation), so it holds **unrestricted** Bash restricted only by body prose ("Bash is for read-only evidence gathering only", :17).
→ Defense-in-depth gap; document the platform limitation, consider whether integrity flags could be precomputed by the dispatching command and passed in (removing the agent's Bash entirely). Effort **M**. Risk-note: the git-evidence need is real; removing Bash means moving integrity-flag computation upstream.

**HOOK-1 · Write|Edit-only gate matcher; redirection escape** · `hooks.json:5` · HOOK · **P1** · to-verify (T10 closes)
The sign-off gate matches `Write|Edit` only. A shell **redirection** (`Bash` `>`) is outside the matcher and could, in principle, create/modify a signed `vN.md` without the gate. `reference.md:93` documents this boundary.
→ Assess in T10 whether redirection actually bypasses the immutability invariant; if so, weigh a broader matcher or a complementary check. Effort **M**. Risk-note: this is the plugin's core integrity invariant — verify carefully, do not overstate before the T10 probe.

---

## Considered and cleared (not findings)

- **Manifest versions consistent** — `plugin.json` 0.18.0, `board/package.json` 0.18.0, `marketplace.json` version-less (the documented 2-file-bump convention). No drift.
- **Cross-file step pointers resolve** — all load-bearing "see X step N" references currently resolve (`xref-map.md`); recorded as a restructuring constraint, not a finding.
- **rp-board-reviewer / rp-results-validator tool grants** — correctly minimal (Read/Grep/Glob, no Bash).

---

## Subagent sweeps (integrated after controller verification)

### Board UI (subagent, controller-verified)
Agent self-dropped two false leads (Reports blank-render: `parseReport` never returns null; "Codex GPT-5.5" label matches `board.md`'s `-m gpt-5.5`). Remaining 9, verified:

**UI-1 · native alert()/window.prompt() in copy-fallback** · `board/src/App.tsx:752,754` · — · **P2** · read-confirmed (controller-verified)
`copyFallback` calls `alert("Feedback copied…")` on success and `window.prompt("Copy the feedback below:", …)` on clipboard failure. **Violates the codebase's own documented rule** (`RequestChangesButton.tsx:1-2`: "BK's board rule: no native prompt dialogs") and the napkin's recorded pet peeve. Grep confirms these are the ONLY native dialogs in `board/src`.
→ Render the fallback in an in-DOM selectable textarea (reuse the panel). Effort **S**. Risk-note: it is a fallback path, but the success `alert` fires on the normal copy action, not just on error.

**UI-2 · dead `canPost` prop** · `board/src/views/{Tracker.tsx:47,65, PlanReader.tsx:65,85, Results.tsx:219,235}` · — · **P2** · read-confirmed (controller-verified)
Destructured + typed in all three views, referenced nowhere in their bodies; App threads it in (App.tsx:1145,1168,1179). Also a typing inconsistency: `Results` types it required (`canPost: boolean`), the others optional (`canPost?: boolean`).
→ Drop the prop from the three signatures + call sites. Effort **S**. Risk-note: verified unused by grep; safe removal.

**UI-3 · annotation composer is mouse-only** · `board/src/components/AnnotationLayer.tsx:79-100,121` · S18-adjacent · **P2** · read-confirmed
The "Comment" pill surfaces only via `onMouseUp`; no keyboard path to open the composer (the known drag-select gap).
→ Add a selectionchange-driven affordance or a comment-on-selection shortcut. Effort **M**. Risk-note: touch-commenting is separately a known deferred gap; this is the keyboard axis.

**UI-4 · line-comment range selection mouse-only** · `board/src/components/ScriptViewer.tsx:82-98` · — · **P2** · read-confirmed
Line-comment ranges are set via `onClick`/shift-click; gutter cells get `tabIndex` only on already-saved lines, so keyboard users cannot create a line comment.
→ Make line numbers focusable with Enter/Shift-Enter. Effort **M**.

**UI-5 · header row cannot wrap** · `board/src/App.tsx:1012,1022` · — · **P2** · to-verify (T9)
Header `flex … gap-4` + `<nav>` with up to 8 tabs and controls, no `flex-wrap`/overflow.
→ Allow wrap or collapse nav into an overflow menu below a breakpoint. Effort **M**. Risk-note: confirm overflow at 200% zoom / narrow viewport in the T9 live probe.

**UI-6 · fixed w-56 sidebars never stack** · `board/src/views/{PlanReader.tsx:266, Results.tsx:419, Reports.tsx:157}` · — · **P2** · to-verify (T9)
14rem aside in a `flex` row squeezes the main pane at narrow width / high zoom.
→ Stack the sidebar above content below a breakpoint. Effort **M**. Risk-note: T9 confirms the squeeze point.

**UI-7 · Tracker/Archive tables lack an overflow wrapper** · `board/src/views/Tracker.tsx:366, Archive.tsx:134` · — · **P2** · to-verify (T9)
7–8-column tables with no scroll wrapper, whereas `Models.tsx:288` wraps its table in `overflow-x-auto`. Inconsistent + can force page-level horizontal scroll.
→ Wrap Tracker/Archive tables in `overflow-x-auto` to match Models. Effort **S**.

**UI-8 · dark-mode contrast gap** · `board/src/views/PlanReader.tsx:447` · — · **P2** · to-verify (T9)
`bg-red-100 … text-red-800 dark:text-red-300` — a `dark:` text override with no `dark:bg-*`, so light text on light-pink in dark mode.
→ Add `dark:bg-red-900/*` or drop the `dark:` text override. Effort **S**. Risk-note: verify the rendered contrast in T9.

**UI-9 · Review-with dropdown has no outside-click/Escape dismissal** · `board/src/components/ReviewMenu.tsx:21-30` · — · **P2** · to-verify (T9)
`setOpen((o) => !o)` with no document/outside-click or Escape handler.
→ Add outside-click + Escape dismissal. Effort **S**.

### Web-template / hosted board (subagent, controller-verified)
Agent scope note (verified): **no** unauthenticated bypass and **no** blob-URL leak — both gates check `env` truthiness before comparing (no empty-secret bypass), the api functions re-check `isAuthed` behind the middleware (defense in depth), and `blobstore.ts:33` returns parsed content only (no url leaves the module). These hold as **static contracts**; the live Vercel probe (T10/S7) confirms runtime.

**WT-1 · CSRF-to-destruction on /api/clear** · `web-template/api/clear.ts:8,21-22` · S7 · **P1 (top security finding)** · read-confirmed (code gap) + to-verify (live exploit, T10)
`clear.ts` `run(headers, env, now)` takes **no method** and the handler calls it for any HTTP method — while `comments.ts:9,25` correctly switches on method and 405s otherwise. With the `SameSite=Lax` session cookie (auth.ts:48), a **top-level GET navigation** to `/api/clear` (a clicked link, `window.location`, or a `<meta http-equiv=refresh>`) carries the cookie, `isAuthed` passes, and **every collaborator comment is deleted** — unauthorized, irreversible (`--web-clear` is the only reset). Verified: clear.ts has no method guard; comments.ts does.
→ Require POST (405 otherwise), matching comments.ts; consider a CSRF token. Same method gap makes GET `/api/logout` a lesser forced-logout nuisance. Effort **S**. Risk-note: needs an authed victim to visit an attacker page while the 30-day cookie is valid — plausible for a targeted collaborator, and the fix is trivial.

**WT-2 · comment overwrite + author impersonation** · `web-template/lib/blobstore.ts:12,14` + `api/comments.ts:21` · S5 · **P2** · read-confirmed
Blob path is the **client-supplied** `id` with `allowOverwrite: true`; GET hands every reader each comment's `id`. Any authed collaborator can re-POST another's `id` to silently overwrite/erase their comment; `author` is self-asserted (shared-password model has no server-bound identity). UUID validation does prevent path traversal via `id`.
→ Server-assign the blob id (ignore client id) or reject overwrite of an existing id; treat `author` as untrusted display text. Effort **M**. Risk-note: inherent to the shared-password design; document the trust model even if not fully fixed.

**WT-3 · no content sanitization on ingest; 14 dangerouslySetInnerHTML sinks downstream** · `web-template/lib/validate.ts:38-45` → board bundle · S5/S9 · **P2** · to-verify (T10 render trace)
Ingestion length-caps only known keys and stores content **raw**; safety rests entirely on the downstream React renderer escaping. The board bundle has 14 `dangerouslySetInnerHTML` sinks (markdown). A crafted `comment`/`quote`/`excerpt` reaching one would be **stored XSS** against other collaborators.
→ Trace whether any hosted-comment field flows into a `dangerouslySetInnerHTML` sink (connects to the napkin's Markdown link-scheme history); sanitize on render or server-side. Effort **M**. Risk-note: requires an authed poster and React escapes plain text by default — **exploitability must be adjudicated by the live/code render trace in T10**, do not overstate.

**WT-4 · middleware gate is untested; gateDecision is runtime-dead** · `web-template/lib/gate.ts:1` + `middleware.ts:4` · — · **P2** · read-confirmed
The real gate is **inlined** in middleware.ts (it "does NOT import from ./lib" — the Node-runtime constraint); `gateDecision()` + its `gate.test.ts` suite test a parallel copy the deployment never runs, so the security-critical middleware gate + its duplicated `verifyCookie`/`isAuthed` have **no direct test**. (gate.ts's `SECURITY_HEADERS` export IS used by the api functions — only `gateDecision` is dead.)
→ Add tests driving the middleware default export, or a snapshot test asserting the two implementations agree. Effort **M**. Risk-note: logic is currently consistent; the risk is a future middleware edit going uncaught.

**WT-5 · byte cap counts UTF-16 code units** · `web-template/lib/validate.ts:6,29` · — · **P2** · read-confirmed
`serialized.length > MAX_TOTAL_BYTES` (65536) counts code units, not bytes, so the "64KB" cap admits ~2-3× that in bytes for multibyte/emoji content.
→ `Buffer.byteLength(serialized, "utf8")`. Effort **S**.

**WT-6 · no rate limiting on /api/login (code)** · `web-template/api/login.ts:13` · S7 · **P2** · read-confirmed
The single shared password has no attempt counter/backoff in code (comparison is correctly timing-safe; empty password fails closed). **Mitigation:** `board.md:81` documents enabling Vercel Firewall rate-limiting on the login route as a manual first-run step — so this is "relies on a setup step the user may skip."
→ Keep the documented WAF step prominent; consider an in-code backoff as defense-in-depth; require a strong generated password (already done). Effort **M**. Risk-note: partially mitigated by the documented WAF step; verify the doc makes it non-optional.

**WT-7 · dead `.err` CSS + silent login failure + login-page divergence** · `web-template/lib/loginPage.ts:12`, `api/login.ts:16`, `middleware.ts:64-66` · — · **P2** · read-confirmed
`.err` style has no matching element; a failed login silently re-serves the plain form with no feedback; the middleware's inlined login page omits the `.err` rule (the two login pages have cosmetically diverged).
→ Wire an error message on failed login (or drop the dead rule) and reconcile the two page copies. Effort **S**.

### Docs (subagent, controller-verified)
Agent verified NOT-drift (spares rework): the 6-tab count, the 25-min gate ceiling (=1500s), the 5 MB oversized threshold, the v0.1.0–v0.18.0 range, the update strings, and all TOC anchors/file paths resolve. The board-lifecycle drift it found is **COH-1** (already filed; the agent corroborated it with CHANGELOG 0.18.0 and argued P1 for user-facing confusion — kept at COH-1, reach noted). Two new:

**DOC-1 · model-profile.md omitted from the reference "what it creates" tree** · `docs/reference.md:100-123` vs `init.md:28` (+ `reference.md:80`) · — · **P2** · read-confirmed
The `plans/` tree omits `plans/model-profile.md`, which `init.md:28` writes unconditionally at init — and `reference.md:80` itself says init creates it, so the doc is internally inconsistent with its own tree.
→ Add a `model-profile.md` row to the tree. Effort **S**.

**DOC-2 · QUICKSTART lists "saved review scorecards" as a standalone surface** · `QUICKSTART.md:72` vs `App.tsx:53-61` · — · **P2** · to-verify (borderline)
Post-v0.4 the Reviews tab was removed (scores live in the plan header); QUICKSTART still lists "saved review scorecards" as a board surface alongside the tabs. Stale phrasing rather than a hard contradiction (scorecards are still saved to `plans/reviews/` and their scores still render in the header).
→ Reword to "each plan version's rubric score in its header." Effort **S**.

### Python scripts (subagent, controller-verified)
Agent self-rejected two false leads (`generate_passphrase` is called out-of-process by board.md:80 + tested; `set_password`'s stub is documented-intended). Verified findings, with one controller severity correction:

**SCR-1 · normal --pull never unlinks the inbox → re-offers the prior batch** · `board.py:1619-1624` · S5 · **P1** · read-confirmed (controller-verified)
The normal pull writes each doc to `.board-web-inbox/*.txt` (1619), marks ids pulled (1622), and routes (1624) — but **never unlinks the inbox files**. Only the *next* pull's recovery drain (1571) removes them, and it **re-routes them first**. So every `--pull` after the first re-presents the previous batch's already-routed comments (risking double-application). Verified against the drain at 1567-1571 vs the normal loop at 1623-1624.
→ Unlink each inbox file immediately after routing it in the normal loop, so the drain handles only genuine crash leftovers. Effort **S**. Risk-note: routing is "idempotent-minded" (board.md), which softens but does not remove the double-processing.

**SCR-2 · non-atomic pulled-state write** · `board.py:1622` · S5 · **P2** · read-confirmed
`_pulled_path(root).write_text(json.dumps(...))` is a plain write, unlike the order file at 1112-1114 (tmp + `os.replace`). A crash mid-write corrupts `.board-web-pulled.json`, `_read_pulled` returns an empty set, and **every historical comment is re-pulled and re-routed**.
→ Write via tmp + `os.replace` (the pattern already used at 1114). Effort **S**.

**SCR-3 · server overwrites an un-acked order; relies on workflow recovery** · `board.py:1114` (accept_order); `serve()` · S4 · **P2** · read-confirmed
`accept_order` `os.replace`s `.board-feedback.md` unconditionally; the single-slot guard prevents two orders per *run* but the server never checks for a prior crashed session's un-acked order at startup. The current defense is the **workflow** (board.md:11: run `--collect` recovery before opening a new board) — if that step is skipped, a prior un-acked feedback-only order (no ticket) is silently overwritten and lost.
→ Have `serve()`/`accept_order` refuse or warn when an un-acked `.board-feedback.md` already exists (belt-and-suspenders behind the workflow recovery). Effort **M**. Risk-note: the advertised "crash re-offers the order" (board.md:11) holds only if the workflow recovery runs; this hardens the server side.

**SCR-4 · ticket written after the durable order file (narrow crash window)** · `board.py:1282-1293` · S2 · **P2** *(agent flagged P1; controller downgraded)* · read-confirmed
`accept_order` writes `.board-feedback.md` (1114), then `write_ticket` runs after (1291-1293). A SIGKILL between leaves an "approved" order with no authorizing ticket → the routed sign-off is denied (board.md:33) and needs re-approval. **Downgraded to P2**: the window is tiny, recoverable by re-approval, and the agent's own evidence confirms no corruption (draft persists, immutability holds).
→ Write the ticket before the durable order file, so "an approved order always has its ticket" holds. Effort **S**.

**SCR-5 · three more hand-synced Python/TypeScript pairs** · `board.py:237-246` (fnv1a_hex↔hostedComments.ts), `board.py:331-344` (artifact_headers↔artifactDisplay.ts), `board.py:199-221` (payload_files↔allFiles in parse.ts) · S8-class · **P2** · read-confirmed
Beyond the known `is_substantive` duplicate, three more Py/TS pairs each carry a "keep in sync" comment. Drift consequences: hash mismatch (staleness detection mis-fires), inline-vs-download divergence, shareHash file-set desync. fnv1a_hex + payload_files are guarded by pinned cross-language test vectors; artifact_headers may not be.
→ Ensure each pair has a pinned cross-language parity test (extend the S8 approach to all four pairs). Effort **S** each. Risk-note: no fix removes the duplication (two languages) — the mitigation is the parity test.

**SCR-6 · drift detection swallows read errors as no-drift** · `board.py:458-460` · S15 · **P2** · read-confirmed
`except Exception: changed = []` — a transient `sha256_file` OSError is swallowed and the component is reported no-drift, masking a real (advisory) drift-detection failure.
→ Narrow the except or log to stderr. Effort **S**.

**SCR-7 · finalize silently drops model provenance on profile-load failure** · `results.py:355-361` · S16 · **P2** · read-confirmed
`except Exception: prescribed = None` — any `models.load_profile` failure is swallowed and the sealed, immutable bundle omits prescribed-model provenance with no diagnostic (permanent, since bundles are immutable).
→ Narrow to expected errors / emit a stderr note. Effort **S**.

**SCR-8 · check_update write-only state fields** · `check_update.py:17-20,200-202` · — · **P2** · read-confirmed (possibly intentional)
`lastSuccess`/`lastSeenRemoteVersion`/`installedVersionAtLastCheck` are written and round-tripped but never read for control flow (only `lastAttempt` and `lastNotifiedVersion` drive logic).
→ Drop the unused fields or wire the intended consumer — confirm they aren't intentional diagnostics first. Effort **S**.

---

## Sweep summary
**~40 findings** filed (13 controller-read + 9 board UI + 7 web-template + 2 docs + 8 scripts, minus the board-lifecycle dup). Severity mix: **2 P1** verified from the sweep (WT-1 CSRF, SCR-1 pull re-offer) plus the earlier P1 token/portability levers (TOK-1/2/3, POR-1/2, HOOK-1); the rest P2. Behavioral P1/P2s tagged to scenario rows (S2/S4/S5/S7/S8/S15/S16/S11) are `to-verify` — the Phase-2 probes close them. Next: Phase 2 probes.
