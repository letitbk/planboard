# Automatic pull request review and release automation design

**Date:** 2026-07-23
**Status:** Implemented in the working tree. Repository settings remain after the first workflow run.

## Goal

Planboard should review and validate every pull request before merge. Codex will review the change for design and correctness. GitHub Actions will enforce tests and release requirements.

Every pull request that changes shipped code or behavior must include a new version and a matching changelog entry. A patch release is the default. A larger feature may use a minor release. Documentation, tests, and repository maintenance may merge without a version change.

After merge, automation may create the matching Git tag and GitHub release. It must not edit repository files or pull request branches.

## Decisions

- The current product and repository name is `planboard`.
- References to `research-plans`, `rp-*`, and related names may remain when they support compatibility, migration, or release history.
- Codex automatic review will provide the judgment based review.
- GitHub Actions will provide the required merge checks.
- Codex review findings will be advisory. Only failed GitHub checks will block merge.
- Managed Claude Code Review is outside the current scope because it requires access that is not available for this repository.
- Each shipped change will use the next patch version or the next minor version.
- Documentation and maintenance changes may keep the current version.
- The release workflow may create tags and GitHub releases after merge. It will never rewrite a tag.

## Architecture

The repository will use two independent review paths.

Codex will read the root `AGENTS.md` and review each pull request. Its review will focus on repository rules and risks that ordinary test scripts cannot judge. This includes compatibility code, immutable artifacts, stale client checks, checksum validation, and retry safety.

GitHub Actions will run four required jobs on each pull request:

- `release-policy`
- `python-tests`
- `board`
- `hosted-board`

The repository rules will require these checks and require the pull request branch to be current with `main`. Keeping the branch current prevents two pull requests from both claiming the same next version.

A separate workflow will run after a merge to `main`. It will compare the plugin version before and after the merge. An unchanged version will end successfully without a release. An increased version will create the matching tag and GitHub release.

## Root `AGENTS.md`

The implementation will add this file at the repository root:

````md
# AGENTS.md

## Repository

Planboard is a Claude Code plugin published from `letitbk/planboard`.

The product name and current identifiers are `planboard` and `pb-*`. References
to `research-plans`, `rp-*`, and old environment variables may be intentional
compatibility code, migration fixtures, or historical documentation. Do not
remove them based on name alone.

## Working rules

Keep changes limited to the requested work. Preserve unrelated changes in a
dirty worktree. Stage files by explicit path.

Canonical plan versions and finalized result bundles are immutable. A change
must not weaken sign-off binding, stale-client checks, checksum validation, or
retry safety.

## Validation

Before completing a code change, run:

```sh
python3 -m pytest tests/ -q
(cd board && npm test && npx tsc --noEmit)
(cd skills/managing-planboard/assets/web-template && npm test)
```

If `board/src/` changes, run `cd board && npm run build`. Commit the regenerated
`skills/managing-planboard/assets/board-template.html`. Run the build again and
require a clean diff for that template.

## Release policy

Every PR that changes shipped code or behavior is a release. Use a patch bump
by default. Use a minor bump for a larger feature.

Keep these versions identical:

- `.claude-plugin/plugin.json`
- `board/package.json`
- The root package fields in `board/package-lock.json`

Run `cd board && npm install --package-lock-only` after changing the version.
Add the new version as the first release entry in `CHANGELOG.md`.

Documentation-only, test-only, and maintenance-only PRs do not require a
version bump.

## Code Review Rules

- Flag changes that weaken immutable artifact handling, sign-off binding,
  content-hash checks, stale-client protection, or idempotent retries.
- Treat legacy `research-plans` and `rp-*` readers as compatibility behavior.
  Flag their removal unless the PR explicitly ends that compatibility.
- For board lifecycle changes, check persistent, sign-session, hosted, offline,
  and stale-tab paths. Do not assume one mode represents all modes.
- Treat reported model provenance as self-attested. Do not present it as
  confirmed runtime identity.
````

## Pull request policy checker

Add `scripts/check_pr_policy.py` with unit tests. The script will accept a base revision and a head revision. It will read changed paths with `git diff` and file contents with `git show`. This keeps the result independent from the checked out files.

The following changes are exempt from a required version increase:

- Files under `docs/`
- `README.md`, `QUICKSTART.md`, `CHANGELOG.md`, `LICENSE`, and `AGENTS.md`
- Files under `.github/`
- `.gitignore`
- Files under `tests/`
- Test files such as `*.test.ts` and `*.test.tsx`
- The policy checker and its unit tests

Any other changed path counts as shipped behavior. This default prevents a new code location from silently avoiding a release.

For a shipped change, the checker will require all of these conditions:

- The head version is greater than the base version.
- The new version is the next patch version, or the next minor version with patch number zero.
- `.claude-plugin/plugin.json`, `board/package.json`, and both root version fields in `board/package-lock.json` contain the same version.
- The first release heading in `CHANGELOG.md` contains that version and a valid ISO date.
- The changelog entry has at least one standard section with at least one bullet.
- A Git tag matching the base version already exists.

A maintenance change may keep the current version. If it changes the version, the checker will apply the full release rules.

Failures will state the missing condition and the file to fix. Unit tests will cover exempt changes, patch releases, minor releases, version collisions, mismatched files, missing tags, and malformed changelog entries.

## Pull request validation workflow

Add `.github/workflows/pr-validation.yml`. It will run when a pull request is opened, updated, reopened, or marked ready for review. It will only need read access to repository contents. It will not use secrets, so it can also validate pull requests from forks.

Each pull request will have one concurrency group. A new commit will cancel older runs for the same pull request.

The jobs will run these checks:

- `release-policy` will fetch full history and tags, run the policy checker tests, and check the pull request base and head revisions.
- `python-tests` will use the minimum supported Python version and run `python3 -m pytest tests/ -q`.
- `board` will use Node 22, run `npm ci`, run Vitest, run TypeScript checking, rebuild the board template, and require a clean diff for the generated template.
- `hosted-board` will run `npm ci` and `npm test` in `skills/managing-planboard/assets/web-template`.

These four stable job names will become the required branch checks.

## Release workflow

Add `.github/workflows/release.yml`. It will run after a push to `main` and will have permission to write repository contents. Repository level concurrency will allow only one release job at a time.

The workflow will compare the plugin manifest at the push event's before and after revisions.

- If the version is unchanged, it will exit successfully.
- If the version increased, it will rerun the version and changelog consistency checks.
- It will create an annotated `v<version>` tag on the merged commit.
- It will extract that version's changelog section and use it as the GitHub release body.
- If the tag already points to the same commit, it will keep the tag and create a missing GitHub release.
- If the GitHub release already exists, it will exit successfully.
- If the tag points to another commit, it will fail. It will never move or replace the tag.

This behavior makes the workflow safe to rerun after a permission failure or a temporary GitHub error.

## Repository settings

After the workflows first run, configure the repository in this order:

1. Confirm that GitHub Actions may write repository contents.
2. Add the four validation jobs as required branch checks.
3. Require pull request branches to be current with `main` before merge.
4. Enable Codex Code Review for `letitbk/planboard`.
5. Enable automatic Codex reviews for pull requests.

The required checks should not be added before GitHub has registered their names. Adding them early can prevent merges without providing a runnable check.

## Rollout tests

First, merge the automation setup as a maintenance pull request. The setup changes no shipped behavior and does not need a version increase. The release workflow should see that version `1.0.0` is unchanged and finish without creating another release.

Next, open a documentation only pull request without a version change. All four jobs should pass.

Then open a small code pull request using version `1.0.1` with a matching changelog entry. After merge, confirm that GitHub contains tag `v1.0.1` on the merged commit and a release with the extracted changelog text.

## Recovery

If the release workflow creates the tag but cannot create the release, fix the permission or temporary error and rerun the workflow. It will recognize the tag on the same commit and create the missing release.

If a tag points to another commit, stop and inspect the repository history. Do not move the tag automatically.

If the policy checker classifies a path incorrectly, update the exemption list and add a unit test in a maintenance pull request.

The historical tag table in `docs/RELEASING.md` can end at `v1.0.0`. Future release history will be recorded in `CHANGELOG.md`, Git tags, and GitHub Releases.

## Implementation sequence

1. Add root `AGENTS.md` and check its commands against the current repository paths.
2. Add the policy checker and its unit tests. Verify all allowed and rejected version paths locally.
3. Add the pull request workflow. Check the YAML syntax and confirm each job uses the agreed stable name.
4. Add the release workflow. Test its decision scripts against unchanged, valid release, repeated release, and tag collision cases without pushing a tag.
5. Update `docs/RELEASING.md` to describe the automated process and retain the historical tag table through `v1.0.0`.
6. Run the full repository validation. Confirm that a fresh board build leaves the generated template unchanged.
7. Open the maintenance pull request, complete the repository settings, and run the two rollout pull requests.

## References

- [Codex GitHub integration](https://learn.chatgpt.com/docs/third-party/github)
- [Claude Code Review](https://code.claude.com/docs/en/code-review)
