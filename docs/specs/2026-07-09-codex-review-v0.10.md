**1. Feasibility Issues**

1. Validation capture needs `Task`, but `/results` cannot currently spawn a subagent. `commands/results.md` allows Read/Write/Edit/etc. but not `Task` ([commands/results.md](/Users/bk/github/research-plans/commands/results.md:4)); by contrast `/board` already includes `Task` for agent review ([commands/board.md](/Users/bk/github/research-plans/commands/board.md:4)). Add `Task` or the validation feature cannot run as specified.

2. Archive view needs new board schema and annotation plumbing, not just a payload field. Current payload has `masterPlan`, `decisionLog`, `executionPlans`, `reviews`, optional `history`, but no `archives` ([board.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:409)). The app tab set is fixed and has no Archive tab ([App.tsx](/Users/bk/github/research-plans/board/src/App.tsx:28)), and document comments only support `tracker | timeline | reviews` ([types.ts](/Users/bk/github/research-plans/board/src/lib/types.ts:315)).

3. Pre-renewal execution dirs would currently be treated as drift, contradicting “archived work is never nagged about.” Tracker computes execution groups with no current tracker row as `orphanGroups` ([Tracker.tsx](/Users/bk/github/research-plans/board/src/views/Tracker.tsx:93)) and renders them as red Drift ([Tracker.tsx](/Users/bk/github/research-plans/board/src/views/Tracker.tsx:449)). `collect_drift` also checks all execution groups for source drift ([board.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:295)).

4. The table artifact schema is under-specified for `.tex` and data links. `ResultArtifact` has optional `data` only ([types.ts](/Users/bk/github/research-plans/board/src/lib/types.ts:103)); `ArtifactCard` only resolves the primary `file` basename to a URL ([ArtifactCard.tsx](/Users/bk/github/research-plans/board/src/components/ArtifactCard.tsx:27)). `results.py` validates only `art.file` and `producedBy.script`, not `data` or secondary table sources ([results.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/results.py:182)).

5. The CSV inline-removal plan is incomplete as written. `TEXT_INLINE_EXTS` currently includes `.csv`, `.tsv`, `.tex`, `.json`, and `.txt` ([board.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:211)); any table artifact with inline text but not `.html`/`.md` falls back to `csv` rendering ([ArtifactCard.tsx](/Users/bk/github/research-plans/board/src/components/ArtifactCard.tsx:4)). If only CSV/TSV are removed, `.tex` table artifacts can still be mis-inlined.

6. The proposed `parse.test.ts` coverage cannot cover `ArtifactCard` rendering. `parse.test.ts` imports parser/hash functions only ([parse.test.ts](/Users/bk/github/research-plans/board/src/lib/parse.test.ts:8)); there is no React component test harness dependency in `board/package.json` ([board/package.json](/Users/bk/github/research-plans/board/package.json:12)). Use a component test or a lower-level pure helper test for “no CSV inline.”

**2. Missing Steps / Edge Cases**

- Add `Task` to `commands/results.md`; add full frontmatter for new `commands/renew.md` and `commands/report.md`, including `Bash(mv:*)` for archive moves and `Bash(pandoc:*)` for conversions.
- Define archive behavior for focused remote shares. Current focused share omits decision log/reviews/history but keeps full master plan ([board.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:383)); archives may be sensitive whole-project material.
- Define how `validation.md` participates in payloads/hashes, if at all. Current result payload includes `manifestRaw`, `report`, `verdictRaw`, and scripts ([board.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:139)), not arbitrary bundle markdown.
- Specify malformed validator JSON handling. `/board` review already validates and repairs/re-prompts once ([commands/board.md](/Users/bk/github/research-plans/commands/board.md:40)); validation should say whether to retry, skip, or record `unverifiable`.
- Include `board/package.json` in the release bump. It is currently `0.9.2` ([board/package.json](/Users/bk/github/research-plans/board/package.json:4)), as are plugin metadata files ([plugin.json](/Users/bk/github/research-plans/.claude-plugin/plugin.json:3), [marketplace.json](/Users/bk/github/research-plans/.claude-plugin/marketplace.json:13)).

**3. Risks And Tradeoffs**

- Payload/hash contract: Python `payload_files()` drives remote `shareHash` ([board.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:130)); TypeScript `allFiles()` drives client persistence hash ([parse.ts](/Users/bk/github/research-plans/board/src/lib/parse.ts:336)). Algorithms differ intentionally, but the file set must stay aligned for archives and any embedded validation files.
- Tests: existing Python and TS tests enumerate hashed file sets ([test_board.py](/Users/bk/github/research-plans/tests/test_board.py:109), [parse.test.ts](/Users/bk/github/research-plans/board/src/lib/parse.test.ts:268)). Add archive/hash tests there, but put UI rendering behavior elsewhere.
- `signoff_gate.py`: archive immutability should be an early pure file-policy branch like results immutability ([signoff_gate.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/signoff_gate.py:167)), before the `VERSION_RE` branch ([signoff_gate.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/signoff_gate.py:225)). It only gates Write/Edit ([signoff_gate.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/signoff_gate.py:159)), so shell moves remain convention/command-controlled.
- Backward compatibility: old master plans without RQs are intentionally tolerated ([parse.test.ts](/Users/bk/github/research-plans/board/src/lib/parse.test.ts:68)); `Renewed` should default to `null`. Old bundles lack validation, so `Results.tsx` must guard optional `manifest.validation`. Legacy CSV table artifacts changing from inline to download is acceptable but should be tested and changelogged.

**4. Suggested Improvements**

- Add explicit types: `ArchiveFile`, `RenewedBlock`, `ValidationBlock`, and `ReportRequest`.
- Add `attachments?: {label,file,kind}[]` or explicit `tex?: string` to `ResultArtifact`; do not overload `data`.
- Make `results.py validate_staged` validate `data` and attachments when present.
- Add one shared fixture for Python `payload_files` and TS `allFiles` archive coverage.
- Define focused-share archive privacy before implementation.
- Add React component tests for `ArtifactCard` table image/download behavior.

**5. Open Questions**

- Should focused remote shares include archived master plans, omit them, or show redacted archive stubs?
- Is archive immutability only for Claude Write/Edit, or should `/renew` also install/check a git hook?
- Should `validation.md` be rendered/linked on the board, or is `manifest.validation` the sole board contract?
- Should generated report markdown use paths that work from `plans/reports/`, or only pandoc `--resource-path`?
- Where is the journal target canonical: only `CLAUDE.md`, or also machine-readable in `plans/master-plan.md`?

I also recorded one persistent testing note in `.claude/napkin.md`.