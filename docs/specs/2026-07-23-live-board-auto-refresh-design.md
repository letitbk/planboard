# Live board auto-refresh on disk changes

Date: 2026-07-23. Status: approved by BK (approach picked via question round; design approved in chat; codex sol/xhigh review findings folded in full, see Revision history).

## Problem

A live board that stays open does not show plan changes that other sessions write to disk. BK hit this directly. A `.draft-v2.md` and its scorecard were created while a board was open, and the board kept showing only v1. Even a hard browser refresh shows the stale content. The only recovery today is to kill the board process and launch a new one.

The cause is by design in the current code. `serve()` builds the payload once, injects it into the template, and freezes the bytes for the whole process life (`board.py:1308`, the `html_bytes` capture). `do_GET` re-serves those bytes for every root request (`board.py:1437`). `/api/health` returns a `generation` content hash, but it is computed once at boot (`board.py:1307`) and the client never compares it.

## What exists today that this design builds on

- The client polls `/api/health` every 3 seconds in live mode (`App.tsx:744`, `POLL_MS` in `reconnect.ts:22`). When the poll sees a new `bootId` for the same project, the tab reloads itself (`shouldReload`, `reconnect.ts:51`). So "the tab reloads itself when the server tells it to" is an established behavior, not a new idea.
- Unsent live comments are stored under a stable per-project localStorage key (`liveDraftKey`, `App.tsx:198`) precisely so a payload change does not orphan them. A reload into fresh content is safe for drafts.
- `payload_generation()` (`board.py:1063`) already hashes the payload with per-boot secrets excluded. It is the right identity for "what content does this board show".
- `/api/model-profile` (`board.py:1397`) is an existing precedent for serving a fresh disk snapshot from a route despite the frozen boot payload.

## Scope

Everything below applies only to the plain live board. The enablement check is `not sign_mode`, decided once at boot. Checking `payload["mode"]` alone would be wrong because gate and ticket sign sessions also carry `mode == "live"` and are distinguished only by `sign.transport` (`board.py:1291`). Gate, ticket sign, and batch boards stay frozen. They are transactional, they mutate their `sign` payload in place, and they end through exit codes that workflows consume. Static, remote, and hosted boards are one-shot files and are not served by this process, so they are unaffected.

The relaunch contract in `board.md` is untouched. A relaunch still mints a new `bootId`, and the existing bootId reload path stays as-is and takes precedence over the new generation comparison.

## Design

### 1. Server: one canonical payload builder

A bare `collect_payload()` result is not what the board serves. Boot preparation in `cmd_serve` (`board.py:2936`) also stamps `focusResults` and `focusView` from `split_focus`, runs `build_assets()` (which mutates each results bundle with artifact URLs and inline text, `board.py:368`), and attaches seeded annotations. A regeneration that skips any of these produces a payload that always hashes differently from the served one, which would cause a permanent reload loop, and a swap would drop artifact links, focused routing, and seeded comments.

So the first change is factoring one canonical builder, used at boot, by the freshness check, and by regeneration:

- `build_live_payload(root, boot_ctx)` runs `collect_payload(root, "live", slug)`, stamps `focusResults` and `focusView`, runs `build_assets`, and re-attaches the boot seeded annotations. The client's one-shot seed ingestion (localStorage dedup keys) makes re-attaching boot seeds safe.
- `boot_ctx` is an immutable context captured once at boot: the parsed focus triple, the seeded annotations, `projectId`, and the three process identities (`publishToken`, `boardToken`, `bootId`).

### 2. Server: immutable snapshot, atomic swap

The values `serve()` currently captures once (`payload`, `html_bytes`, `generation`, `amap`, `rmap`) become one immutable snapshot object, plus the fingerprint that produced it. A single `state` holder points at the current snapshot.

Two locks with distinct jobs:

- A refresh lock ensures only one thread builds a candidate at a time.
- A short state lock guards reading or replacing the snapshot reference. Handlers copy the reference under the state lock, release it, and then do their network and file I/O outside the lock. A slow artifact response or an expensive collect must never block other handlers. Swapping is replacing the one reference, never updating fields in place.

`regenerate()` builds a candidate through the canonical builder, re-stamps the boot identities into it (open tabs keep working across a swap, and the reconnect machine sees no change), computes its generation, injects the template, rebuilds the artifact and report maps, and swaps the snapshot reference.

Failure anywhere in candidate construction (collect, `build_assets`, template read, injection), including `SystemExit` from `die()`, is caught. The last good snapshot stays served, health keeps reporting the served generation, and the failed fingerprint is not cached as collected, so the next poll retries. The board never claims to be stale when it cannot actually refresh.

The vestigial `draft_map` capture stays as it is. It has no remaining call sites and this change does not touch it.

### 3. Freshness detection: two tiers with an explicit boundary

`git_info` (`board.py:165`) spawns about two git subprocesses per payload file, so re-collecting on every 3 second health poll is too expensive. Detection is split into a cheap check and a full check.

Tier 1 is a fingerprint: a stat walk over `plans/` recording (relative path, mtime_ns, size) for every file and (relative path) for every directory (empty staging directories are payload input via `leftoverStaging`, `board.py:459`), sorted, plus the mtimes of `HEAD` and `index` inside the repository's real git directory. The git directory is resolved once at boot with `git rev-parse --absolute-git-dir`, because in a linked worktree `.git` is a file and the naive paths do not exist. The walk excludes exactly the bookkeeping the server itself writes, by exact basename or server-written pattern: `.board.lock`, `.board-feedback.md`, `.board-feedback.md.tmp`, ticket files (`.import-approved-*`), and sign feedback files (`.sign-feedback-v*.md`). Draft files (`.draft-vN.md`) are dotfiles and are exactly what must be detected, so the exclusion list is these specific names, never "all dotfiles".

The freshness boundary is explicit: a refresh is triggered by changes inside `plans/` and by git HEAD or index changes, and by nothing else. `sourceDrift` hashes source files outside `plans/` (`results.py:528`) and `agentsGitignored` depends on gitignore state outside `plans/` (`board.py:501`); a change that affects only those does not trigger a refresh on its own. Both are recomputed and become current whenever any plans or git change triggers a regeneration. This is an accepted blind spot: those fields are hygiene chips, not plan content.

Tier 2 runs only when the fingerprint differs from the one recorded with the current snapshot: a full candidate build through the canonical builder, cached with its fingerprint. A fingerprint false positive costs one build whose generation matches the served one, so nothing reloads. The tiers make wrong reloads impossible and wasted work cheap.

Root GET behavior: compute the fingerprint, run tier 2 if needed, and if the candidate generation differs from the served one, swap before serving. So a manual browser refresh always returns current disk state. This alone fixes the worst half of the bug.

Health behavior: compute the fingerprint, run tier 2 if needed (reusing the same candidate cache, so health and a following GET share one build), and report the current disk generation. Health never swaps. The swap happens on the root GET that the client's reload issues.

### 4. Generation identity

`collect_payload` stamps `generatedAt` with the current wall clock time (`board.py:803`). Today `payload_generation` does not exclude it, so every recompute would hash differently and the client would reload forever. `payload_generation` gains two entries in its exclusion set: `generatedAt`, and the new `generation` key itself (self-referential, same treatment as `bootId`). It is the only time based field `collect_payload` creates; codex confirmed no other volatile field.

After computing the generation over the fresh payload, the builder stamps it into the payload as `payload["generation"]` before injection. The client reads it as `data.generation`, which tells the page its own content identity, symmetric with `data.bootId`. `BoardData` gains `generation?: string` (optional, because static, remote, and hosted payloads never pass through `serve()`; `types.ts:3`).

Git info stays inside the hash on purpose. A commit changes file dates and the head SHA, the board shows both, and a reload after a commit is correct behavior.

No existing consumer breaks. `health.generation` is asserted in tests only for shape (64 hex chars) and for stability across volatile tokens, and the client currently ignores it.

### 5. Client: staleness reload

The existing health poll in `App.tsx` gains a generation comparison. The health response type gains `generation: string`. The poll also gains an in-flight guard (skip this tick if the previous request has not finished), because a collect that takes longer than 3 seconds would otherwise overlap the next tick (`App.tsx:744` uses an async `setInterval` callback).

The rules, in a small pure helper module (like `reconnect.ts`, testable without React):

- The comparison requires the same `projectId`, mirroring `shouldReload` (`reconnect.ts:51`). A foreign project answering on the same port never triggers a generation reload. The existing bootId check runs first and takes precedence.
- A poll where `health.generation` differs from `data.generation` increments a counter, but only when the mismatching generation equals the one seen on the previous poll. A changing mismatch (a project mid-write) restarts the count. A matching poll resets everything.
- At a count of 2 (about 6 seconds), the helper says "reload".
- The generation logic runs only while the conn machine is in the `online` phase. `submitting`, `accepted`, `applying`, `stalled`, and `sleeping` all suppress it; in those phases the action and relaunch machinery own the tab.

At fire time App checks a guard for transient text the reload would destroy. Focus alone is not a reliable signal, because a user can blur an open editor without saving, and unsaved editor text is not in the persisted `annotations` array (`App.tsx:358`). So every transient editor marks its container with a shared `data-reload-guard` attribute while it is open: the AnnotationLayer composer, the general comment box, and the inline editors in PlanReader, ScriptViewer, and FeedbackPanel. The guard is the presence of any `[data-reload-guard]` element, plus `document.activeElement` being a textarea or text input as a fallback.

While the guard holds, App shows a persistent notice ("Plans changed on disk. The board will refresh when you finish.") with an explicit "Refresh now" button, so an abandoned open editor cannot hold the refresh forever. The notice lives in its own state, not in `syncNotice`, which auto-clears after 2.5 seconds (`App.tsx:845`). The guard is re-checked on every poll. While held, the helper keeps tracking: if disk returns to the page's generation (e.g. the change was reverted), the notice clears and nothing reloads; if disk moves to yet another generation, the two-poll debounce restarts. When the guard clears and the mismatch still holds, the tab reloads.

Unsent drawer comments survive the reload through the stable per-project key. Text inside an open editor would not survive, which is exactly what the guard protects.

The `reconnect.ts` reducer is not modified. Generation is content identity and bootId is process identity, and they stay separate concerns.

### 6. Model profile saves

The server writes `plans/model-profile.md` on a profile save (`board.py:648`), which changes the fingerprint and the disk generation. Without care, saving a profile would reload the saving tab about 6 seconds later, contradicting the Models view's designed no-reload save (`App.tsx:214`).

So the `/api/model-profile` POST response gains the fresh disk generation, and the client advances its page-generation baseline to it after a successful save. The saving tab's React state is already patched by the existing flow, its baseline now matches disk, and it does not reload. Other open tabs see the mismatch and reload into the saved state, which is correct.

### 7. Edge cases

- Agent write bursts: the debounce collapses a burst into one reload at the end.
- Half-written files: a build that lands mid-write produces some generation. If the write finishes before the second poll, the generation changes again and the counter restarts. The reload always lands on whatever is current at reload time.
- Focused live board (`--focus <slug>`): regeneration goes through the canonical builder with the boot focus, so it is identical to boot collection. For live mode, focus does not filter the payload (filtering is remote-only, `board.py:771`).
- Stale artifact URLs: after a swap, an un-reloaded tab may hold artifact URLs that are not in the new map, and those return 404 until the tab reloads. Old map objects are never mutated, so in-flight requests against the old snapshot stay coherent.
- Deleted artifact or report files: the artifact and report handlers currently call `read_bytes()` unguarded (`board.py:1410`, `board.py:1427`). They gain a try/except returning 404, since a refreshable board makes mid-session deletions a normal event.
- Multiple tabs: each tab compares and reloads independently. The candidate cache is shared, so extra tabs add only fingerprint walks.
- Sign, gate, and batch boards: the server never regenerates and health always reports the boot generation, so the client comparison never fires there, on either sign transport.

### 8. Testing

Python, in the existing HTTP harness in `tests/test_board.py`. The harness's `serve_in_thread` passes a raw `collect_payload()` result today (`test_board.py:1834`) and relies on serve mutating the caller's payload object for token readback (`test_board.py:1887`); it moves to the canonical builder and reads tokens in a way that does not depend on caller-object mutation.

- Writing a `.draft-v2.md` makes health report a new generation.
- A root GET after the change serves HTML containing the new content, with the same `bootId` and a still-valid `boardToken` (a POST authorized with the boot token succeeds after a swap).
- The regenerated HTML contains a newly added results bundle's artifact URL, and the route serves it (catches an omitted `build_assets`).
- Boot-only fields survive regeneration: `focusResults`, `focusView`, seeded annotations, `projectId`.
- An unchanged project produces an unchanged generation across health polls (no `generatedAt` volatility; `payload_generation` excludes `generatedAt` and `generation`).
- Gate mode and ticket sign mode never regenerate and health stays at the boot generation.
- A build failure (e.g. master plan removed) keeps serving the old snapshot, health keeps reporting the served generation, and a subsequent successful build (master plan restored) refreshes, proving the failed fingerprint was not cached.
- Writing `.board-feedback.md`, a ticket file, or a sign feedback file does not change the fingerprint; an empty staging directory does.
- Fingerprint git paths resolve in a linked worktree.
- Concurrent root GETs and health requests during a swap each see one coherent snapshot (HTML, generation, and maps from the same build).
- A deleted artifact file returns 404, not a dropped connection.

Vitest:

- The staleness helper: two stable mismatching polls fire; a match resets; a changing mismatch restarts; a foreign `projectId` never fires; `submitting` and the other non-online phases never fire.
- App wiring: a mismatching health response reloads; with a `data-reload-guard` element present it defers and shows the persistent notice with the "Refresh now" button; the notice clears if disk returns to the page generation; the reload happens once the guard clears.
- The model-profile save advances the baseline and suppresses the reload for the saving tab.

The template is rebuilt and the full existing suites (about 500 Python and 480 board tests) stay green.

### 9. Versioning and docs

Patch bump per the release policy, with a CHANGELOG entry. One-line additions to `board.md` and `docs/reference.md` saying the live board refreshes itself when plans change on disk.

## Out of scope, recorded deliberately

- Stored annotations whose target path disappears after a refresh (e.g. a draft signed into a version) keep today's behavior: they persist under the stable key and may show as unanchored. This is pre-existing behavior across relaunches and this feature does not change it.
- Preserving the current tab, selected component, and scroll position across a generation reload. Real polish, but scope growth beyond the bug fix. Candidate follow-up.

## Revision history

- 2026-07-23: initial design, approved by BK. Auto-refresh chosen over a staleness banner and over a refresh-only fix.
- 2026-07-23: codex review (sol, xhigh; `docs/specs/2026-07-23-live-board-auto-refresh-codex-review.md`) folded in full on BK's order: canonical payload builder (boot preparation parity), immutable snapshot swap with two locks, projectId-scoped generation comparison, `data-reload-guard` convention replacing the composer-only guard, explicit freshness boundary with directory entries and worktree-safe git paths, failure caching rule, model-profile baseline advance, submitting-phase suppression, held-notice semantics with "Refresh now", poll in-flight guard, artifact 404 hardening, optional `generation` type, harness and test additions. Two items recorded as out of scope above.
