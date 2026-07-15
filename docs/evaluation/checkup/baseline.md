# Checkup baseline (Task 1)

Verification baseline for the plugin checkup. Everything below is measured, not assumed. Audit target is the immutable snapshot `60eaede` (v0.18.0).

## Snapshot worktree

- Worktree: `.claude/worktrees/checkup-snapshot`, created with `git worktree add --detach .claude/worktrees/checkup-snapshot 60eaede`.
- `git -C .claude/worktrees/checkup-snapshot rev-parse HEAD` → `60eaede90e849cda9110f5c20ae24e5bb2babba8`.
- `.claude/` is gitignored (`.gitignore:2`), and git auto-excludes the registered worktree from `git status` — the worktree adds no dirt to the primary tree.
- **All shipped-surface reads and probes run from this worktree; audit artifacts are written to `docs/evaluation/` on `main`.** Re-assert the SHA before each probe group.

## Primary-tree divergence

- `git diff --stat 60eaede -- commands skills hooks .claude-plugin board/src board/package.json` → **empty**. The primary checkout currently matches the snapshot for all shipped surfaces. (Reads may therefore run from either tree today, but the worktree is the canonical source if `main` moves.)

## Localhost-bind capability (feasibility gate for live-board probes)

- `python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); ..."` → **bind OK** (`127.0.0.1:63740`).
- This environment can bind localhost, so the live-board, sign-off-gate, and local-server probes (Tasks 8–10) can run here. (Contrast: the codex plan-review sandbox could not bind `127.0.0.1`, which produced 47 false Python failures at the test port allocator — a run in such an environment must qualify its suite verdict.)

## Suites + typecheck (no build)

Measured at the snapshot. `npm run build` was **not** run (its postbuild `cp`s into the shipped `board-template.html`).

| Suite | Command | Result |
|---|---|---|
| Python | `python3 -m pytest tests/ -q` | **360 passed** in 26.45s |
| Board (vitest) | `board/ ./node_modules/.bin/vitest run` | **278 passed** (34 files) in 4.70s |
| Board typecheck | `board/ npx tsc --noEmit` | clean (exit 0) |
| Web-template (vitest) | `.../web-template/ npm test` | **33 passed** (7 files) |

All green. These counts are the behavioral baseline; a later finding that contradicts a passing test is suspect, and the suites document intended behavior for the scenario matrix.

## Installed plugin

- `~/.claude/plugins/installed_plugins.json` → research-plans **0.18.0**, `gitCommitSha 60eaede90e849cda9110f5c20ae24e5bb2babba8`, lastUpdated 2026-07-15.
- **The installed plugin is exactly the audit snapshot** — what the researcher runs matches what is being audited.

## Clean-room isolation, snapshot install, permissions, session continuity

Resolved against current Claude Code docs (not assumed). Confirmed procedure for Tasks 7–8:

**Isolation.** `CLAUDE_CONFIG_DIR=<fresh-empty-dir>` isolates *installed plugins, skills, and marketplaces* to that fresh dir (so none of the author's superpowers/napkin/journal skills or third-party plugins load). It does **not** by itself guarantee the global `~/.claude/CLAUDE.md` is skipped. Two levers, used per purpose:
- **Install-dimension test (Task 7):** fresh `CLAUDE_CONFIG_DIR` + real marketplace install (below). Verify no author-setup bleed with the probe `claude -p "list every active skill and CLAUDE.md rule"`; if the global `CLAUDE.md` leaks, record it as a caveat (and optionally neutralize via an explicit `--append-system-prompt`).
- **Pure behavior/token runs (Task 8):** `--bare` skips auto-discovery of hooks, skills, plugins, MCP, auto-memory, and CLAUDE.md entirely; then load only the plugin explicitly with `--plugin-dir <worktree>`. This guarantees zero bleed but bypasses the install path, so it is for behavior/token measurement, not the install-dimension test.

**Snapshot-pinned install.** The `60eaede` worktree already contains `.claude-plugin/marketplace.json`. Install the audited commit (not public `main`) by pointing a local marketplace at the worktree: `/plugin marketplace add .claude/worktrees/checkup-snapshot` → `/plugin install research-plans@research-plans`. Verify the installed commit via `installed_plugins.json` → `gitCommitSha` (it records the SHA, as seen above). (Marketplace *sources* pin by `ref` only; individual *plugin* sources support `sha` — but installing directly from the local worktree sidesteps that, since the worktree is already at the SHA.)

**Permissions (headless).** Default headless auto-denies unpre-approved tool calls (the session aborts). For a realistic-but-scripted run: `--permission-mode dontAsk` with an `--allowedTools`/settings allow-list. **`dontAsk` denies `AskUserQuestion`** — this is exactly the mechanism behind the headless `/init` dead-end (friction-log 1.1): the interview questions are auto-denied and the session exits with no artifacts. `bypassPermissions` is the full-bypass (containers only) and does not reflect a real user.

**Session continuity.** Capture `session_id` from `--output-format json` (`jq -r '.session_id'`); pass `--resume "$session_id"` to each subsequent stage, all from the same working directory. `--continue` resumes the most-recent session without tracking the id. This is how the scripted loop carries context across `/init → /plan → execute → /sync → /results → /report → /board`.

## Status

Task 1 acceptance met: snapshot worktree pinned, three suites + typecheck green (no build), bind capability confirmed, installed version matches the snapshot, isolation/install/permission/continuity procedure resolved and recorded.
