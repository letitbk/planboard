Found six actionable issues. No Blockers.

## High

1. [board/src/lib/findings.ts:24](/Users/bk/github/research-plans/.claude/worktrees/result-report-clarity/board/src/lib/findings.ts:24): A manifest without `metrics` crashes the Tracker and Reports views. Python validation does not require `metrics` at [results.py:266](/Users/bk/github/research-plans/.claude/worktrees/result-report-clarity/skills/managing-research-plans/scripts/results.py:266), and Python treats the missing field as no findings. TypeScript calls `m.metrics.some(...)`, which throws. The new Tracker and Reports calls can therefore crash the default board for a bundle that successfully finalized. Fix by requiring an array during finalization and defensively using `Array.isArray(m.metrics)` in TypeScript.

2. [results.py:212](/Users/bk/github/research-plans/.claude/worktrees/result-report-clarity/skills/managing-research-plans/scripts/results.py:212): The checksum check reports `pass` when an artifact has no recorded SHA256. `validate_staged` also compares only when the hash is present at [results.py:280](/Users/bk/github/research-plans/.claude/worktrees/result-report-clarity/skills/managing-research-plans/scripts/results.py:280). An artifact with `source: {}` and an existing file finalizes with a permanently sealed `checksums: pass`, although no checksum was checked. Fix by treating a missing or malformed SHA256 as a failed advisory checksum check and add a regression test.

## Medium

1. [board/src/views/Results.tsx:464](/Users/bk/github/research-plans/.claude/worktrees/result-report-clarity/board/src/views/Results.tsx:464): Null result gating does not cover every Generate report entry point. The Result tab always offers the button, including for descriptive-only and unreadable manifests. Reports also offers regeneration for an existing report without checking substance at [Reports.tsx:205](/Users/bk/github/research-plans/.claude/worktrees/result-report-clarity/board/src/views/Reports.tsx:205). Clicking submits and ends the board session at [App.tsx:605](/Users/bk/github/research-plans/.claude/worktrees/result-report-clarity/board/src/App.tsx:605), while `/report` refuses to write a file. Inference: the board workflow can then retain the pending order because it acknowledges only after files are written at [commands/board.md:56](/Users/bk/github/research-plans/.claude/worktrees/result-report-clarity/commands/board.md:56). Gate every report button on a readable manifest with substantive findings, add a defensive check before submission, and define the board router’s no-file acknowledgment behavior.

2. [commands/report.md:19](/Users/bk/github/research-plans/.claude/worktrees/result-report-clarity/commands/report.md:19): Generated reports omit `manifest.integrity`. A robust, unsourced finding can finalize with `integrity.status: failed` because integrity is advisory, then receive a report whose validation section shows only plan conformance. Collaborators will not see the integrity failure, contrary to the design requirement at [design.md:20](/Users/bk/github/research-plans/.claude/worktrees/result-report-clarity/docs/specs/2026-07-13-result-report-separation-design.md:20). Include integrity status, all four checks, and the pre-feature “not recorded” state in the report header or validation section.

## Low

1. [commands/results.md:23](/Users/bk/github/research-plans/.claude/worktrees/result-report-clarity/commands/results.md:23): The chained report-offer rule does not copy the shared rule exactly. Its wording treats any `statement` as qualifying and only excludes descriptive counts. A retracted or superseded metric with a statement can therefore receive an offer even though Python, TypeScript, and `/report` classify it as non-substantive. Copy the exact demoted-status condition into this step.

2. [results.py:186](/Users/bk/github/research-plans/.claude/worktrees/result-report-clarity/skills/managing-research-plans/scripts/results.py:186): Python `strip()` and TypeScript `trim()` disagree on some Unicode-only statements. A statement containing only U+0085 is non-substantive in Python but substantive in TypeScript. U+FEFF produces the reverse result at [findings.ts:16](/Users/bk/github/research-plans/.claude/worktrees/result-report-clarity/board/src/lib/findings.ts:16). Use an explicit shared whitespace definition and add parity tests for both characters.

Verification:

- Board tests: 237 passed.
- Focused results tests: 31 passed.
- Production build and TypeScript check passed; the built HTML matched the committed template.
- Full Python run: 273 passed and 30 failed solely because the sandbox denied localhost socket binds.
- An unsourced substantive finding finalized successfully with `integrity.status: failed`, confirming that integrity remains advisory.
- I found no change-induced `targetHash`, `share_hash`, pre-feature integrity, or normal staging-finalize overwrite regression.