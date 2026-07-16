# Plugin checkup — findings

**Date:** 2026-07-15 · **Target:** research-plans v0.18.0 (`60eaede`) · **Method:** `docs/specs/2026-07-15-plugin-checkup-design.md` (rev 2). Raw findings + evidence: `findings-raw.md`. Coverage ledger: `scenario-matrix.md` (9 PASS / 1 FAIL / 11 NOT-RUN, gate COMPLETE). The audit read and measured only — it changed no shipped plugin code (the one fix, WT-1, ships as its own PR #20).

## Executive summary

The plugin is in good shape. Across eight dimensions and ~40 findings, **one real security bug** surfaced (a comment-wipe CSRF, now fixed), the security *core* is otherwise sound, the docs are mostly accurate, and the rest is efficiency and polish.

- **Security:** the load-bearing invariants **hold at runtime** — the confused-deputy defense strips forged actions (S9 PASS), the local mutation surface rejects unauthenticated/cross-origin writes (S10 PASS), and ticket forgery is denied (S2 PASS). The **one hole** was `WT-1`: `/api/clear` ran its destructive delete-all on any HTTP method, so a top-level GET carried the SameSite=Lax cookie and let an attacker page wipe every comment. **Fixed in PR #20.** A cluster of P2 hardening items (comment overwrite, ingest sanitization, login rate-limit, the untested middleware gate) remain.
- **Token efficiency:** the always-on floor is **~750 tokens/session everywhere** (measured), and the single biggest lever is that **36% of `board.md` is a web-publish runbook** loaded on every plain `/board` open — and dragged into the `/plan` sign-off chain (~13.7k tokens into one context). Moving it behind its modes is a token + coherence win.
- **Portability:** the headline is **the headless `/init` dead-end** (confirmed live) — a scripted/new user runs `/init`, it asks questions and exits creating nothing, with no recovery signal. Install itself is frictionless.
- **Workflow correctness:** one real P1 — **every `--pull` re-offers the previous batch** (the inbox is never cleaned) — plus a few narrower crash-window robustness gaps.
- **Coherence / UX:** the docs largely match the code (one stale board-lifecycle description, two small omissions); the board UI has a self-rule-violating native `alert()`/`prompt()`, a dead prop, and a set of responsive/a11y gaps.

## Dimension × severity

| Dimension | P0/sec (fixed) | P1 | P2 |
|---|---|---|---|
| Security / privacy | WT-1 (CSRF) ✅fixed | — | WT-2, WT-3, WT-4, WT-5, WT-6, WT-7, HOOK-1, SEC-1 |
| Workflow correctness | — | SCR-1 | SCR-2, SCR-3, SCR-4, SCR-6, SCR-7 |
| Token efficiency | — | TOK-1, TOK-2, TOK-3 | TOK-4 |
| Portability / install | — | POR-2 | POR-1 |
| Coherence | — | — | COH-1, COH-2, COH-3, COH-4, COH-5, DOC-1, DOC-2, SCR-5, SCR-8 |
| UX / accessibility | — | — | UI-1 … UI-9 |

## P1 findings (verified this session)

Each was confirmed against the real files or a live probe — not from a summary.

1. **WT-1 · comment-wipe CSRF on `/api/clear`** — *security, confirmed end-to-end, FIXED (PR #20).* No method guard + Lax cookie + a middleware that passes authed GETs through (`middleware.ts:72`) = an attacker page wipes all comments. Fix: require POST (405 otherwise), regression-tested, codex-approved. **Real-world:** any of the author's deployed Vercel boards that are research-plans boards carry this until #20 merges and they redeploy.
2. **SCR-1 · every `--pull` re-offers the previous batch** — *workflow, confirmed (board.py:1619-1624).* The normal pull routes docs but never unlinks the inbox; the next pull's crash-drain re-routes them. Risks double-applying feedback. One-line fix (unlink after routing).
3. **POR-2 · headless `/init` dead-ends** — *portability, confirmed live (clean-room Run 2.3).* Asks questions in text, exits, creates no `plans/` dir, no recovery signal. Fix: detect non-interactive → emit "nothing created; re-run with seeded args."
4. **TOK-2 / TOK-3 · `board.md` web-runbook is 36% of every `/board`** — *token, measured.* The Vercel runbook (steps 10→EOF, 12,652 B) loads on every plain open and is dragged into the `/plan` chain (peak ~13.7k tokens/context). Fix: move it to a reference loaded only on `--publish*`/`--pull`/`--web-connect`.
5. **TOK-1 · ~750-token always-on floor** — *token, measured (paired clean-room run).* The 10 command descriptions + skill description load every session in every project. Fix: tighten the four wordiest descriptions (renew/adopt/results/report).

## P2 findings (by dimension)

**Security hardening** — `WT-2` client-id comment overwrite + author impersonation (`blobstore.ts:14` `allowOverwrite`); `WT-3` no ingest sanitization vs 14 downstream `dangerouslySetInnerHTML` sinks (stored-XSS *if* a comment field reaches one — needs a render trace); `WT-4` the real middleware gate is untested (`gateDecision` is runtime-dead; middleware can't import `./lib`); `WT-5` byte cap counts UTF-16 code units (`validate.ts:29`); `WT-6` no in-code login rate-limit (mitigated by the documented Vercel WAF step); `WT-7` dead `.err` CSS + silent login failure + login-page divergence; `HOOK-1` the sign-off gate matches Write/Edit only, so `Bash(python3)` file I/O bypasses the immutability enforcement (documented boundary, mitigated by Write-path discipline); `SEC-1` `rp-plan-reviewer` holds unscoped `Bash` (platform can't scope it — prose-restricted).

**Workflow robustness** — `SCR-2` non-atomic pulled-state write (corruption → re-pull everything); `SCR-3` server overwrites an un-acked order (relies on the board.md:11 workflow recovery); `SCR-4` ticket written after the durable order file (narrow, recoverable crash window); `SCR-6` drift detection swallows read errors as no-drift; `SCR-7` finalize silently drops model provenance on a profile-load failure.

**Token** — `TOK-4` `results.md` adopt/reconcile block is 26% of the file (mode-split candidate).

**Portability** — `POR-1` `codex`/`agy` unguarded in the board Review-with paths (no `command -v`, unlike `pandoc`) → a raw failure for users without those CLIs.

**Coherence** — `COH-1` `reference.md:50` describes the pre-v0.18 board lifecycle (refresh + idle-sleep) vs the shipped close-on-action + no-timeout; `COH-2` model-nudge verbatim ×3 (load-bearing variation); `COH-3` init-gate restated ×8; `COH-4` provenance rule near-duplicated; `COH-5` stale `token_ok` docstring (code correct); `DOC-1` `model-profile.md` omitted from the reference "what it creates" tree; `DOC-2` QUICKSTART lists "saved review scorecards" as a standalone surface (Reviews tab removed in v0.4); `SCR-5` three more hand-synced Python/TS pairs (fnv1a_hex, artifact_headers, payload_files) need parity tests; `SCR-8` `check_update` write-only state fields.

**UX / accessibility** — `UI-1` native `alert()`/`window.prompt()` in the board's copy-fallback (violates the codebase's own documented "no native prompt dialogs" rule); `UI-2` dead `canPost` prop across three views; `UI-3`/`UI-4` mouse-only annotation + line-comment (no keyboard path); `UI-5` header can't wrap (200% zoom / narrow); `UI-6` fixed `w-56` sidebars never stack; `UI-7` Tracker/Archive tables lack an `overflow-x-auto` wrapper (inconsistent with Models); `UI-8` dark-mode contrast gap (`PlanReader.tsx:447`); `UI-9` Review-with dropdown has no outside-click/Escape dismissal.

## Proposed fix batches

Each is a coherent branch to approve one at a time; ordered by value. Every batch names its regression check.

- **Batch A — Security hardening** (WT-2, WT-3, WT-4, WT-6, WT-7, HOOK-1 doc, the `/api/logout` method gap). *Regression:* web-template vitest + a middleware-driving test (WT-4). **WT-1 already shipped as PR #20 — merge it first.**
- **Batch B — Hosted-comment robustness** (SCR-1 the P1, SCR-2, SCR-3, SCR-4). *Regression:* the pull/gate Python suites + a crash-injection test for SCR-1.
- **Batch C — Token: externalize mode runbooks** (TOK-2+TOK-3 board.md web-runbook → reference; TOK-4 results.md adopt/reconcile → reference; TOK-1 tighten descriptions). *Regression:* re-run `token_report.py` (assert the floor + `/plan` peak drop) + a clean-room walkthrough (the modes still route).
- **Batch D — Portability** (POR-2 init non-interactive message; POR-1 codex/agy `command -v` guard). *Regression:* re-run the clean-room `/init` + missing-tool probes.
- **Batch E — Coherence + small script fixes** (COH-1 board-lifecycle doc, COH-5 stale comment, DOC-1/DOC-2, WT-5 byteLength, SCR-5 parity tests, SCR-6/SCR-7 narrow the excepts, SCR-8, SEC-1). *Regression:* all suites green + the xref/contract maps re-checked.
- **Batch F — Board UX + a11y** (UI-1 native dialogs → in-DOM textarea, UI-2 dead prop, UI-3..9 responsive/a11y). *Regression:* board vitest + a live-board pass at 200% zoom / narrow viewport.
- **Deferred (design calls, not mechanical fixes):** COH-2/COH-3/COH-4 (dedup vs. load-bearing restatement — weigh per item; each needs a shared-snippet mechanism the templates don't have today).

## Not run (honest gaps)

The live Vercel deploy (S7 runtime — CSRF confirmed from code instead, blob-privacy is a Vercel platform guarantee), the full 7-stage clean-room loop (Run 1 covered the seeded happy path), the live-board a11y visual pass (UI-5..9 confirmed from code, a live pass would firm the exact breakpoints), and the transcript-mining billed-token profile. None blocks the findings above; each would strengthen an already code-confirmed finding, not discover a new one.

## Considered and refuted (so they aren't re-discovered)

- `token_ok` "not enforced" comment → **code is correct**, comment stale (COH-5).
- Reports blank-render → `parseReport` never returns null (subagent self-dropped).
- "Codex GPT-5.5" board label → matches `board.md`'s actual `-m gpt-5.5` (not stale).
- `generate_passphrase` / `set_password` stub → not dead / documented-intended (subagent self-dropped).
- No unauthenticated bypass or blob-URL leak in the web-template (verified: gates check env truthiness, api re-checks isAuthed, blobstore leaks no URL).
- Manifest versions consistent; all cross-file step pointers currently resolve; the 6-tab count, gate timeout, 5 MB threshold, and version range in the docs are all accurate.

## Provenance

No shipped file was modified by the audit: `git diff --stat 60eaede..HEAD -- commands skills scripts board hooks .claude-plugin` is empty. All writes are under `docs/evaluation/`. The WT-1 fix lives on branch `fix-clear-csrf` (PR #20), separate from the audit.
