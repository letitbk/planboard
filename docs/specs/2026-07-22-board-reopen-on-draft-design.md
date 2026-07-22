# Board reopen-on-draft (#4) — design

Date: 2026-07-22
Status: design (awaiting review)
Scope: a prompt/command-doc change to the `/research-plans:board` feedback-routing flow. No React, no `board.py`, no bundle rebuild.

## Context

When a reviewer submits board feedback, the board **closes** and the work moves into the Claude session, which discusses the comments with the researcher. A new plan draft (`.draft-v(N+1).md`) is written **only if the researcher accepts a change**.

Today the board reopens **only** for a **review-request** or a **report-request** — "to show their result." An ordinary request-change that produces a new draft does **not** reopen; the researcher reruns `/research-plans:board` (or `./rp-board`) to see the draft. Verified in `commands/board.md`:
- `:18` (exit 0): "do not relaunch: the board has closed. The two exceptions are a **review-request** and a **report-request**."
- `:26` (the draft-writing branch): ends at "pending — signs at /execute or /sign." No reopen.
- `:55`: "unless it was a review/report order that reopened … the board stays closed."

"Refresh-after-everything" was deliberately removed (`:18`), so the fix is **not** "reopen after every submit." The fix extends the existing **"reopen when there's a result to show"** principle to a third case: **a produced draft is a result to show.**

**Framing for the maintainer (this is a default change, not a purely additive feature).** `board.md:18` enumerates the reopen triggers as "the **two exceptions** … a review-request and a report-request," and the draft-writing branch (`:26`) was deliberately left without a reopen. This proposal changes that enumerated behavior — making it three triggers — for **all** users, not behind an opt-in. It is aligned with the maintainer's own "reopen to show a result" principle, but it overrides a deliberate choice, so it should land as a reviewed proposal the maintainer can accept, reject, or ask to make opt-in. Unlike the additive board-comment features (global comment, edit-unsent), this one alters existing workflow behavior.

## The change

Make **"routing a request-change produced a new or refined plan draft"** a third reopen trigger, alongside review-request and report-request.

### When it reopens
Reviewer submits request-change comments → session discusses → researcher accepts → session writes/refines `.draft-v(N+1).md` and runs the draft review (existing `board.md:26` flow) → **then the session reopens the board focused on that component**, landing on the draft with its diff (auto-on for a working draft) and its new score.

### When it does NOT reopen
Feedback only discussed, answered, or declined → **no draft written → board stays closed**, exactly as today. (No "refresh-after-everything.")

### Reopen mechanism (already exists — no code change)
Reuse the stable per-project port from `plans/.board.lock`:

```
python3 <script> --focus <component> --port <that port>
```

**Difference from the standard reopen:** review/report reopen with `--no-open` because they disarm auto-close and reuse the still-open tab. A request-change **can't** disarm auto-close — whether a draft results is decided *during* the session discussion, long after the tab's 3-second auto-close has fired. The draft-write + review takes minutes, so by reopen time the tab is **gone** under the default setting. Therefore #4 reopens **with the browser opening** (omit `--no-open`) so the draft appears as a fresh tab regardless of the auto-close setting.

### Auto-close interaction (verified in `board/src/lib/autoClose.ts`)
Auto-close is a per-project setting: **default ON (3s)**; the **"Keep open"** button turns it off (persisted).

| Auto-close | Tab after submit | #4 reopen behavior |
|---|---|---|
| **ON** (default) | closes after 3s | opens a fresh tab on the draft |
| **OFF** ("Keep open") | stays open, polling `/api/health` | the open tab reloads in place (health poll sees the new bootId) **and** a fresh tab may also open — a minor, acceptable duplication |

No change to auto-close itself.

## Timing and edge cases
- **Reopen after the draft review runs**, not the instant the draft file is written — so the reopened board shows the draft's diff *and* score (mirrors review/report reopening only once their result is ready).
- **Acknowledge (`--ack`) discipline unchanged:** ack after the routed work (including the draft + review) is complete, then reopen — a crash before completion must re-offer the order.
- **Multiple drafts in one feedback batch:** reopen focused on the first component whose draft was produced; mention the others in session (the researcher navigates). Rare; not worth special UI.

## Out of scope
- Reopening on **no-draft** feedback (the rejected Option 2 / "refresh-after-everything").
- **Result-comment / script-comment** routes — those produce a *results bundle*, a separate reopen concern with its own `--focus <component>:rN` handling; unchanged here.
- Any change to the **review/report** reopen, to **auto-close**, or to `board.py` / the React board.

## Files touched
- `commands/board.md` — three spots:
  1. `:18` (exit-0 handling): add the produced-draft case as a third reopen trigger next to review/report.
  2. `:26` (anchored-comment / accepted-change branch that writes the draft): after writing the draft and running its review, reopen focused on the component (browser opens, same port).
  3. `:55` (close-the-loop): the "stays closed" now excepts draft-producing routes too.
- `tests/test_command_docs.py` — add one assertion that `board.md` documents the draft-reopen trigger (guards the doc from silently losing it). Must not introduce any forbidden approval phrase ("Sign-off order", "clicked Approve", "Approve on the board", etc.).

## Verification
This is a prompt/doc change, so "testing" is doc-consistency plus a manual walk-through:
- `test_command_docs.py` passes, including the new draft-reopen assertion and the existing no-approval-on-board assertions.
- Manual: in a real project, submit a request-change, accept it so a draft is written, and confirm the board reopens focused on the component's draft (fresh tab). Submit a discuss-only comment and confirm the board stays closed.
