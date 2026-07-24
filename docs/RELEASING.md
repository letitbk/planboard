# Releasing planboard

## Pull requests

Every pull request that changes shipped code or behavior is a release. Use the
next patch version by default. A larger feature may use the next minor version
with its patch number reset to zero.

Before opening the pull request:

1. Update `.claude-plugin/plugin.json` and `board/package.json` to the same
   version.
2. Run `cd board && npm install --package-lock-only`. Commit both version fields
   in `board/package-lock.json`.
3. Add `## [X.Y.Z] - YYYY-MM-DD` as the first release entry in `CHANGELOG.md`.
   Add at least one bullet under `Added`, `Changed`, `Fixed`, `Removed`,
   `Deprecated`, or `Security`.
4. Run the validation commands in the root `AGENTS.md`.

Documentation, tests, and repository maintenance may keep the current version.
If a maintenance pull request changes the version, it must follow the complete
release process above.

The `release-policy` pull request check enforces these rules. The repository
also requires the Python, board, and hosted board checks. Keep the pull request
branch current with `main` so two pull requests cannot claim the same version.

## After merge

The release workflow compares the version before and after each push to `main`.
An unchanged version ends without a release. A new version causes the workflow
to create an annotated `vX.Y.Z` tag on the merged commit and a GitHub release
whose body comes from the matching changelog entry.

Do not create or push release tags by hand. The workflow never changes
repository files and never moves an existing tag.

At session start, the update hook announces the new version to installed users.
It uses the newest changelog entry for highlights. Write that entry for a human
reader.

## Repository setup

After the workflows first run, configure the repository settings:

1. Allow GitHub Actions to write repository contents.
2. Require `release-policy`, `python-tests`, `board`, and `hosted-board` before
   merge.
3. Require pull request branches to be current with `main`.
4. Turn on Code review and Automatic reviews for `letitbk/planboard` in
   [Codex settings](https://chatgpt.com/codex/settings/code-review).

GitHub must see each workflow job once before you can select it as a required
check.

## Recovery

If tag creation succeeds but release creation fails, fix the permission or
temporary error and rerun the workflow. It will keep the tag and create the
missing release.

If a version tag points to another commit, stop and inspect the history. Do not
move or replace the tag.

## Historical tag map through v1.0.0
| version | commit  | note |
|---------|---------|------|
| v0.1.0  | 3a02ddb | |
| v0.2.0  | ac21573 | |
| v0.3.0  | 73702c8 | |
| v0.4.0  | 0f2cb0d | |
| v0.5.0  | 3cc1543 | CHANGELOG marks 0.5.0 "(unreleased)", but the version bump shipped and was merged into the results-layer branch via 3c9457f; tagged at the bump commit. |
| v0.6.0  | ed3fbeb | |
| v0.6.1  | f36bb03 | |
| v0.6.2  | d33f9f6 | |
| v0.6.3  | 3bdd4db | |
| v0.6.4  | ca3c505 | |
| v0.7.0  | dc3f0f1 | release commit (many "toolkit v0.7.0" WIP commits precede it) |
| v0.8.0  | b9c5560 | |
| v0.9.0  | 510712c | |
| v0.9.1  | b8ce5cf | |
| v0.9.2  | 42193ce | |
| v0.10.0 | 4cdebc6 | |
| v0.11.0 | 4ded951 | |
| v0.12.0 | 467f28c | tag sits on the post-release hardening tip |
| v0.13.0 | a7db0e3 | tag sits on the final hardened tip |
| v0.14.0 | 661cbc8 | release commit (feature work merged via PR #9; bump + tag rode a follow-up PR) |
| v0.15.0 | be5c29a | release commit (feature work merged via PR #11; bump rode its own PR) |
| v0.16.0 | a425c47 | release commit (feature work merged via PRs #13/#14; bump rode its own PR) |
| v0.17.0 | 3a6c204 | release commit (PR #16 Models tab + provenance combined with PR #17 result/report separation; both folded into PR #16, bump on the same branch) |
| v0.18.0 | dab695b | release commit (PR #18 five-channel rubric + score-in-header + one-narrative plans; bump on main after merge) |
| v0.19.0 | 402d44e | release commit (board sidebar PR #19 + CSRF PR #20 + checkup fixes PR #21, all post-0.18.0; bump on main after merges) |
| v0.19.1 | 31601fd | release commit (PR #22 hotfix: approve crash + stale-tab + auto-close + active-file sidebar; bump on main after merge) |
| v0.20.0 | 15fe5d8 | release commit (PR #23 flow redesign: review-room finalize + bundle-state + batch + /execute; bump on main after merge) |
| v0.21.0 | 28e5274 | release commit (PR #24 readability: typography + metadata card + step cards + scroll-spy; bump on main after merge) |
| v0.22.0 | 7eb0930 | release commit (PR #25 output & validation: tab rename + F·A·I score + reviewer discipline + planning doctrine; bump on main after merge) |
| v0.23.0 | f465edc | release commit (PR #26 sign-at-execution: strict trailer grammar + sign sessions both transports + amendments + /sign + shutdown handoff; bump on main after merge) |
| v0.24.0 | 89f7b95 | release commit (mechanical rp-board launcher: ./rp-board opens the board with no LLM; feature merged to main directly, bump on main) |
| v0.24.1 | cfd9e15 | release commit (hotfix: board highlight-and-comment, broken since v0.19.0; fix committed to main directly, bump on main) |
| v0.25.0 | 2d3ce3c | release commit (PR #27 board comment UX: global comment + edit-unsent + highlight-persistence fix; PR #28 reopen-on-draft; bump on main after merges) |
| v1.0.0 | a7960ba | release commit (PR #29: rename research-plans → planboard; new install id planboard@planboard; backward-compatible readers + in-place migrations for markers, rp-*/pb- agents, launcher, browser storage, env vars; bump on main after merge) |
