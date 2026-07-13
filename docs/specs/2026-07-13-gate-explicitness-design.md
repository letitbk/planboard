# Sign-off harmonization: timeout → board route, batch made explicit — design

Status: revised after codex review · 2026-07-13 · target: post-v0.15.0 branch (BK numbers the release at cut)

## Problem

BK hit a "Batch sign-off · plan 1 of 1" screen at his ai-network-survey project board and asked why sessions have "different logic to direct sign-off." Diagnosis (2026-07-13, this session):

- The plugin has **three sign-off routes** that enforce the same researcher-approval policy but differ in mechanism and look: (1) the hook-launched blocking single-plan gate (`signoff_gate.py` runs `board.py --gate <slug>/vN` on every `vN.md` write; synchronous; approval flows back as the subprocess exit code — **no ticket**), (2) `board.py --gate-batch` (background server; each Approve mints a durable `.import-approved-<slug>-vN` ticket; documented only for `/adopt`), (3) the persistent board's in-board Approve (since v0.14; mints the identical ticket via `/api/feedback` → `write_ticket`).
- Route 1's **timeout deny message is a dead end**: "Re-attempt the write when they are ready … or set `RESEARCH_PLANS_NO_GATE=1`" — it offers the bypass but not the durable ticket routes. After a real timeout on 2026-07-10, BK's project sessions recorded a napkin rule to use `--gate-batch` instead, and every plan revision there (v1, v2, now v3) has gone through the batch UI since. The workaround is sound — but it puts single-plan revisions through a bulk-adoption surface, confusing the researcher.
- Nothing stops an agent from launching `--gate-batch` for one plan: `apply_gate_batch` only refuses at **zero** pending drafts, and `signoff_gate.py`'s ticket-error messages ("Re-run board.py --gate-batch to re-approve…") actively teach agents the batch incantation outside the `/adopt` context.

BK's decisions (2026-07-13, AskUserQuestion): timeout points to the persistent-board route; `--gate-batch` refuses fewer than 2 pending drafts unless `--allow-single`; his project napkin gets updated after the release (tracked separately, not part of this branch).

Codex review (docs/specs/2026-07-13-codex-review-gate-explicitness.md) established that a message-only timeout fix cannot guarantee its own recommendation — the hook deletes the `.gate-vN.md` proposal on timeout and the persistent board displays only `.draft-vN.md` files, which `/plan` treats as an optional preview. Hence the one mechanics addition below.

## Changes

### 1. `signoff_gate.py`: timeout persists the draft, messages stop teaching batch

- **Timeout branch (`code == 2`) gains one mechanic:** before denying, the hook writes the gated proposal content to `plans/execution/<slug>/.draft-v<N>.md` (creating or overwriting — the write content is the session's newest intent; if an identical draft already exists this is a no-op rewrite). This guarantees the persistent board has the exact draft to display and approve, and the minted ticket's normalized hash matches the retried write (`normalize_plan` strips the `Signed off:` trailer on both sides). `.draft-*` writes are not themselves gated, and the hook writes via Python, so no hook recursion.

- **Timeout message** becomes (replacing the current text and its `RESEARCH_PLANS_NO_GATE` suggestion — the env var stays documented in SKILL.md for genuinely headless/CI runs only):

  > "Sign-off gate timed out — no approval arrived within %ds. The proposed plan has been saved as plans/execution/%s/.draft-v%d.md. Do NOT bypass the gate and do NOT use --gate-batch. Instead, relaunch the board for this component via the /research-plans:board workflow and tell the researcher the draft awaits their Approve there. Approving mints a durable ticket, and the board workflow's routing then performs the ticketed vN.md write — do not re-attempt the Write separately before that approval round-trip."

  ("no approval arrived" also covers the synthesized code-2 from `subprocess.TimeoutExpired`; the routing sentence avoids the double-write trap — the board workflow's approval routing already lands `vN.md`, and a second manual write would deny as an overwrite.)

- **Ticket-error messages in `check_ticket`** stop naming `--gate-batch` and state the draft prerequisite:
  - corrupt: "Approval ticket %s is unreadable or corrupt. Have the researcher re-approve %s v%d on the board — their Approve writes a fresh ticket (the draft must still exist at plans/execution/%s/.draft-v%d.md)."
  - expired: "Approval for %s v%d has expired. Have the researcher re-approve the current draft on the board."
  - content-hash mismatch: "The draft for %s v%d changed since it was approved (content-hash mismatch). Have the researcher re-approve the current draft on the board."
  - The slug/version-mismatch message already says "Re-approve this plan on the board" — unchanged.

  These messages also fire during legitimate `/adopt` batches; "re-approve on the board" is correct there too (any ticket-minting Approve surface refreshes the fixed ticket path).

### 2. `board.py --gate-batch` guard: batch is an explicit bulk behavior

- **Pending means unticketed.** `apply_gate_batch` computes, for each collected draft, whether a valid matching ticket already exists (`.import-approved-<slug>-v<N>` with matching normalized content hash and unexpired) — those drafts are *approved awaiting write*, not pending. Collection/UI behavior is unchanged (all drafts still appear in the wizard; re-approving a ticketed draft harmlessly overwrites its ticket); only the guard counts pending.
- Guard, evaluated after the existing zero-drafts `die` (unchanged):
  - all drafts ticketed → `die`: "every pending draft is already approved (tickets present) — write the vN.md files; no batch session is needed."
  - pending count < 2 and no `--allow-single` → `die`:

    > "%d pending draft(s) — batch sign-off is the /adopt bulk flow. For a single plan, write vN.md (the sign-off gate opens automatically) or have the researcher Approve the draft on the board (writes the same ticket). If this is a one-component adoption or you are resuming an interrupted batch with one draft left, re-run with --gate-batch --allow-single."
- New argparse flag `--allow-single` (default false); passing it **without** `--gate-batch` is an error ("--allow-single only applies to --gate-batch"). Dispatch: `apply_gate_batch(root, payload, allow_single=args.allow_single)`.
- **Numeric draft selection (pre-existing bug, fixed here):** both `apply_gate_batch` and the payload draft collection pick the "newest" `.draft-vN.md` by lexicographic `sorted()`, so `.draft-v9.md` beats `.draft-v10.md`. Both switch to a numeric key on the parsed N.

### 3. Docs

- `commands/adopt.md`: correct the existing wrong claim that each batch approval "writes the plan's `vN.md`" (it writes the **ticket**; the session performs the `vN.md` writes afterwards, which the tickets admit); note the <2-pending refusal and that `--allow-single` covers one-component adoptions **and** resuming an interrupted batch with one draft left.
- `skills/managing-research-plans/SKILL.md` (versions-immutable bullet): one added sentence — batch sign-off (`--gate-batch`) is the `/adopt` bulk flow only; a single plan's approval happens at the write-triggered gate or via the researcher's Approve on the persistent board, and a timed-out gate's recovery is the board route (never the bypass).
- `commands/plan.md` step 6: one added sentence — if the sign-off gate times out, the proposal is saved as the component's `.draft-vN.md`; relaunch `/research-plans:board <NN-slug>` for the researcher's Approve, whose routing completes the write.

## Explicitly unchanged

- Ticket mechanics (hash, expiry, fixed path, overwrite-on-refresh), enforcement order in `signoff_gate.py` (ticket check before gate reservation), the hook's auto-gate on `vN.md` writes, gate-mode approval via exit code (no ticket — by design), `/api/feedback`'s in-board Approve path, `RESEARCH_PLANS_NO_GATE` semantics (headless only; unchanged, just no longer advertised in the interactive timeout message), exit codes (0 approved / 3 changes / 2 timeout), and the batch wizard UI itself.

## Tests

- **Numeric selection:** a component with `.draft-v9.md` and `.draft-v10.md` → batch entry and payload draft both pick v10.
- **Guard:** 1 unticketed draft → `SystemExit` naming the redirect (assert message content); 1 draft + `allow_single=True` → `gateBatch` with 1 entry; 2 unticketed drafts (two components) → proceeds; 1 unticketed + 1 validly-ticketed draft → still refused as single-pending (assert); all drafts ticketed → "already approved" death; 0 drafts → existing death unchanged.
- **CLI:** `--gate-batch --allow-single` parses and reaches the guard; `--allow-single` without `--gate-batch` dies with the pairing error.
- **Hook timeout:** simulate the exit-2 path (fake `board.py` or monkeypatched `subprocess.run`) → `.draft-vN.md` now contains the gated content (created when absent; overwritten when different); deny message contains "Approve there"-style board routing and contains neither "NO_GATE" nor "--gate-batch".
- **Hook ticket errors:** corrupt / expired / hash-mismatch denials assert the new reasons (no "--gate-batch"), not just the deny decision (existing tests assert only `"deny"` — tighten).
- **Round-trip:** timeout persists draft → `write_ticket` over that draft → re-attempted signed write (with `Signed off:` trailer) is admitted by the ticket.

## Out of scope

- Any change to how `/adopt` orchestrates batches (it keeps instructing `--gate-batch`).
- Retitling the batch UI for the single-plan case (unreachable without `--allow-single`, an explicit adoption of the behavior).
- Gate-mode Approve minting tickets (its exit-code contract with the hook is correct as is).
- BK's ai-network-survey napkin update (post-release, separate task).

## Revision history

- 2026-07-13 — revised per codex sol/high review: timeout fix gains the persist-draft mechanic (message-only could not guarantee recovery — `.gate-vN.md` is deleted on timeout and the board displays only `.draft-vN.md`); "same ticket enforcement" corrected (gate mode approves via exit code, no ticket); pending redefined as unticketed; `--allow-single` documented for resumed/partial batches; numeric draft selection fixed (pre-existing `.draft-v9` > `.draft-v10` bug); adopt.md's "approval writes vN.md" misclaim corrected; timeout wording covers the synthesized code-2; double-write trap avoided by routing language.
- 2026-07-13 — draft, after BK chose: timeout→board messaging fix, <2-drafts refusal + `--allow-single`, post-release napkin update.
