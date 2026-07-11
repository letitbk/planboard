# Releasing research-plans

## Every release
1. Bump the version in **two** files (keep them identical):
   - `.claude-plugin/plugin.json`
   - `board/package.json`
   (`.claude-plugin/marketplace.json` no longer carries a version — `plugin.json` is authoritative.)
2. Add a `## [X.Y.Z] - YYYY-MM-DD` entry to `CHANGELOG.md` in Keep-a-Changelog form
   (`### Added / ### Changed / ### Fixed`, user-facing bold-lead bullets).
3. Commit as `vX.Y.Z: <summary>` (no `Co-Authored-By` trailer).
4. Tag: `git tag -a vX.Y.Z -m "vX.Y.Z"`.
5. Push with tags: `git push && git push --tags`.

The SessionStart update hook announces the new version to installed users automatically,
reading the newest CHANGELOG entry for highlights — so write that entry for a human reader.

## Retroactive tag map (created 2026-07-09)
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
