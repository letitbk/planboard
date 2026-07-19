# Mechanical board launcher (`rp-board`) — design v2

**Date:** 2026-07-19
**Status:** implemented on `feat/mechanical-board-launcher` (board.py + tests + init.md/board.md notes); all findings folded in.
**Review:** `codex_review_20260719_174226.md` (gpt-5.6-sol @ xhigh) — all findings folded in.

## Problem

`/research-plans:board` is a Claude Code slash command, so opening the board always routes through the model. When the session hits a usage limit, the model never runs and the board never opens — exactly when the researcher may most want to read plans, diffs, the timeline, and reports. We want a way to open the board that (a) needs no LLM, (b) needs no edit to the user's shell dotfiles, and (c) survives plugin updates.

## Decisions

- **No dotfile edits.** Nothing a plugin ships joins the user's PATH, and every slash command needs the model. So the escape is a file already sitting in the project that the researcher runs in their own terminal (`./rp-board`) or via Claude Code's `!` bang prefix.
- **Location: project root** `./rp-board` — best ergonomics and discoverability for a recovery action. (Codex concurred over `plans/rp-board`.)
- **Kept out of git via `.git/info/exclude`** (add `/rp-board`) — no churn to any tracked file, nothing to commit, per-clone. Not the tracked `.gitignore`.
- **POSIX-only.** A `#!/bin/sh` script with mode `0755`. Native Windows is out of scope (would need a separate `.cmd`/Python launcher later).

## Approach: `board.py` writes its own launcher

`board.py` generates `rp-board` itself, so there is no path-guessing: the script knows its own location via `__file__`. Running `rp-board` opens the live board and pops the browser, with zero model involvement.

### The launcher contents

POSIX `sh`, generated with **`shlex.quote()`** on every interpolated value (Codex #4 — an unquoted baked path is a shell-injection surface):

```sh
#!/bin/sh
# rp-board-managed-launcher-v1
# research-plans: open the board with no Claude/LLM. Auto-generated; do not edit.
cd "$(dirname "$0")" || exit 1
exec <shlex.quote(sys.executable)> <shlex.quote(board.py)> --project-root . --reuse "$@"
```

- **First line marker** `rp-board-managed-launcher-v1` — the ownership token that makes rewrites safe (below).
- **`cd "$(dirname "$0")"`** so the caller's cwd doesn't matter; `.` then names this project's root.
- **`--project-root .`** (Codex #3) — `cd` alone is *not* enough: `find_root()` prefers the git toplevel, so a project nested inside a parent repo that also has `plans/` would otherwise open the parent's board. The explicit root fixes this.
- **`--reuse`** — triggers open-or-serve (below).
- **`sys.executable`, not bare `python3`** (Codex #10) — after `cd`, a bare `python3` could resolve to a project venv/pyenv that differs from the interpreter that works, or be absent. Fall back to `"python3"` only if `sys.executable` is empty.
- **`"$@"`** passthrough so `./rp-board --focus 03-foo` still works.

### Open-or-serve (Codex #1 — the reopen blocker)

A plain board has **no idle timeout**: closing the browser tab leaves the server running and holding `plans/.board.lock`. A second launch would then hit `acquire_lock()` and die with "another board is open" — an error precisely when you wanted the board. Fix: the `--reuse` flag makes `board.py`, on a **plain-live** launch only, first look for a healthy server for this project:

1. `read_lock(plans/)` → `port`.
2. `GET http://127.0.0.1:<port>/api/health` (short timeout). The endpoint already returns `{"app": "research-plans-board", "projectId": …}` (board.py ~1207).
3. If `app` matches and `projectId == project_id(root)`, **open that URL and exit 0** — no second server. (Guards against PID reuse / an unrelated process on the port.)
4. Otherwise fall through and serve normally (which opens the browser).

`--reuse` is set **only by the launcher**, so the slash command's existing "another board is open" (exit 1) contract in `commands/board.md` is unchanged. Tradeoff noted: reopening shows the already-running server's payload (possibly staler than disk); to refresh, close it and relaunch. Acceptable for offline viewing.

### Generation, self-refresh, and safe writing (Codex #2, #7, #9)

New `ensure_launcher(root, *, explicit=False)`:

- **Safe write, never destructive.** `lstat` first. Create when absent. Replace **only** a regular file whose content carries the `rp-board-managed-launcher-v1` marker. **Refuse** symlinks (never write *through* one), directories, and unmanaged regular files — warn and continue on an ordinary open; on `--install-launcher` fail explicitly.
- **Atomic.** Write a same-dir temp file, `chmod 0o755`, `os.replace()`.
- **Exec-bit idempotence** (Codex #9): rewrite if content differs **or** the executable bit is missing, even when content matches. Otherwise no-op.
- **Nonfatal on the serve path.** A launcher-write failure must never break serving.

### Where it's called from (Codex #7 — "live-serve path" was too broad)

The final `else` in `main()` covers plain-live, gate, and sign. `ensure_launcher` runs **only for plain-live** launches (not gate/sign, which deliberately shut down a prior board and can return without serving), **before** any sign/gate shutdown, and **outside** `serve()` (its own atomicity, not `.board.lock`). Also called at **`/init`** (Codex #6) so a project that never opened a board still gets one; and via the explicit `--install-launcher` action.

### Path baking (Codex #5 — dropped the marketplace guess)

Bake `Path(__file__).resolve()` — the copy actually running. The slash command always invokes `board.py` from the active install (`${CLAUDE_PLUGIN_ROOT}/…`), so `__file__` *is* the active installed path; a launcher self-run bakes the same path (idempotent). No hardcoded `marketplaces/research-plans` path (marketplace names are user-configurable — `resolve_marketplace_name()` — and a dev checkout would bake an unrelated copy). Consequence stated plainly: a fresh clone that hits a usage limit **before its first board open** has no launcher — an untracked, path-baked file cannot exist "immediately after clone"; `/init` and the first open are the bootstrap.

### `.git/info/exclude` handling (Codex #8)

`GITIGNORE_LINES` are `plans/`-relative, so `ensure_gitignore` can't be reused at the root. A dedicated `_ensure_git_exclude(root)` adds a single `/rp-board` line to the repo's local exclude, preserving existing bytes:

- `.git` a directory → `.git/info/exclude`.
- `.git` a file (worktree) → parse `gitdir:` and use `<gitdir>/info/exclude`.
- no `.git` → skip (the launcher is just an untracked file).

Idempotent; append only if absent.

## CLI wiring (Codex #11)

- `--install-launcher` (store_true): add to `parse_args`, `_ACTION_FLAGS`, and the `main()` dispatch. Writes the launcher, creates no lock, collects no payload, opens no browser, exits 0. Rejects being combined with another action via the existing `check_action_exclusivity`.
- `--project-root DIR`: not an action — consumed early in `main()` to override `find_root()` (validate `plans/master-plan.md` exists there, else `die`).
- `--reuse` (store_true): not an action — a plain-live serve modifier.

## What still needs Claude

Only *routing* submitted feedback — unchanged and safe: the board durably writes `plans/.board-feedback.md`, and the next available session recovers it via `--collect`. Opening, reading, and annotating are fully offline. **Guarantee separated** (Codex): the plain-terminal path provably avoids the model; whether `!./rp-board` works under every form of hard usage limit is platform behavior we don't assert.

## Tests (in `tests/test_board.py`)

- **Launcher content:** shebang, marker, `cd`, quoted interpreter + board.py path, `--project-root .`, `--reuse`, `"$@"`; mode `0755`.
- **Injection:** a `root`/`board.py` path containing spaces, single/double quotes, `$`, backticks, backslashes → the generated script is still safe (parses, no expansion).
- **Safe write:** create-when-absent; refuse symlink (target untouched); refuse directory; refuse unmanaged regular file; replace managed file; `--install-launcher` fails explicitly on refusal.
- **Idempotence:** second call no-ops; stale (wrong baked path) rewritten; lost exec-bit restored even when content matches.
- **Exclude:** `/rp-board` added to `.git/info/exclude`; `.git`-file (worktree) redirect; no-`.git` skip; not duplicated on re-run.
- **Open-or-serve:** with a healthy `/api/health` server up, `--reuse` opens its URL and does not start a second server / does not `die`; with a stale lock (dead pid / wrong projectId), it serves normally.
- **Project binding:** nested initialized roots — `--project-root .` opens the nested project, not the parent.
- **`--install-launcher` action:** rejects another action, no lock, no payload, no browser, exit 0.

## Scope / non-goals

- Not touching web-publishing modes.
- No PATH command / shell integration.
- Not committing or sharing the launcher (machine-specific baked path).
- Native Windows out of scope.
- The in-Claude sentinel-hook idea is out: it may not fire under a hard usage limit, the exact case this solves.
