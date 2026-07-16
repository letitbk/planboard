<!--
CODEX HANDOFF — plugin checkup fixes.
Paste the block below into a codex run, e.g.:
  codex exec --sandbox workspace-write -m gpt-5.6-sol -c model_reasoning_effort=high \
    "$(sed -n '/^<task>/,/^<\/handoff>/p' docs/plans/2026-07-15-checkup-fixes-CODEX-HANDOFF.md)" < /dev/null
Run one batch per invocation (recommended) by naming the batch in <scope>, or all in order.
-->

<task>
Execute the fix plan at docs/plans/2026-07-15-checkup-fixes-plan.md (rev 2). It fixes the audit findings in docs/evaluation/checkup/findings.md. Read BOTH files in full before editing anything. The plan is authoritative; this brief only sets the execution protocol and guardrails. Do not redesign the fixes — implement exactly what the plan specifies.
</task>

<scope>
Work batches in this order: B -> A -> C -> D -> E -> F. If this invocation is scoped to a single batch, do only that batch and stop; otherwise do them all in order. Batch A MUST run before Batch C (both edit commands/board.md and C must preserve A's WT-6 wording). Batches B and E both edit board.py — apply cleanly, one finding at a time.
</scope>

<setup>
1. Confirm the working branch. If `fix-checkup-batches` does not exist, create it off `main`: `git checkout -b fix-checkup-batches main`. If it exists, `git checkout fix-checkup-batches`. All commits land here. Never commit to `main`.
2. Verify you are on the branch before every commit: `git rev-parse --abbrev-ref HEAD` must print `fix-checkup-batches`.
</setup>

<execution_protocol>
- ONE commit per finding (finding id in the message, e.g. `fix(SCR-1): unlink inbox after routing`). Not one commit per batch.
- For every CODE fix, use TDD: write the failing test first, run it and see it fail, implement the minimal change, run it and see it pass. For doc/comment fixes, make the change and run the batch's suite.
- After each finding: run the finding's test. After each batch: run the batch's full suite (Python: `python3 -m pytest tests/ -q`; board: `cd board && ./node_modules/.bin/vitest run && npx tsc --noEmit`; web-template: `cd skills/managing-research-plans/assets/web-template && npm test`). Do NOT proceed to the next finding while the suite is red.
- Stage explicitly: `git add <exact paths>`. NEVER `git add -A`, `git add .`, or `git commit -a`.
- The plan's line numbers are from an earlier commit and have shifted (the board was rebased over a sidebar merge). Before editing any board/src file, re-locate the exact line by reading the current file; adapt to the real code while preserving the plan's intent.
</execution_protocol>

<hard_constraints>
- BUILD ONLY IN BATCH F. `board.py` serves the committed `skills/managing-research-plans/assets/board-template.html`, which `cd board && npm run build` regenerates from `board/src`. UI fixes are invisible until that asset is rebuilt. So: do NOT run `npm run build` in any batch except the FINAL step of Batch F, where you build it once, `git add skills/managing-research-plans/assets/board-template.html`, and commit it. If you are not doing Batch F, do not build and do not touch board-template.html.
- Board tests run via the LOCAL binary: `cd board && ./node_modules/.bin/vitest run`. Never bare `npx vitest` (it resolves a global vitest without jsdom).
- WT-2 is the highest-risk fix. Implement the idempotency contract EXACTLY as the plan states: keep the client UUID as the key; store create-only; existing key + identical canonical content -> 200 with the existing id; existing key + different content -> 409 without modifying; the client treats an identical replay as success. Add the full test matrix the plan lists (first post, identical replay, conflicting reuse, concurrent duplicate, lost-response retry). Do not "simplify" to a random server id or a blind 409.
- SCR-4 is a restructure, not a reorder: allocate the actionId, write the ticket, THEN write the durable `.board-feedback.md`, and add the orphan-ticket recovery rule. SCR-3 must REFUSE (not warn) a new order while an un-acked `.board-feedback.md` exists.
- SCR-1: also UPDATE the existing tests that assert successful-pull inbox files remain (search `test_board.py` for the inbox-retention assertions). Do not claim exactly-once.
- Keep the middleware login HTML self-contained (do NOT import from `./lib` in middleware.ts — it cannot). Keep the untrusted-input routing security label INLINE in board.md step 5 when externalizing the web runbook (TOK-2); use named reference headings, not "go to step N".
- Do NOT modify: anything under `docs/evaluation/` (the audit record), the plan files, or `.claude-plugin/`. Do NOT change version numbers or CHANGELOG. Do NOT open, merge, or force-push a PR — the researcher opens the single giant PR themselves.
</hard_constraints>

<when_stuck>
If a fix's real code diverges from the plan such that you cannot implement it faithfully, or a test cannot be made to pass, or a security/workflow fix (WT-2, WT-3, SCR-3, SCR-4) is ambiguous: DO NOT guess. Skip that finding, leave its file untouched, commit the findings you did complete, and write a short note in your final message naming the skipped finding and why. A skipped fix is fine; a wrong security fix is not.
</when_stuck>

<verification_before_done>
Before finishing, from a clean tree: run ALL three suites and confirm green (Python, board vitest + tsc, web-template). If Batch F ran, confirm `npm run build` produced a changed `board-template.html`, it is committed, and a `board.py`-served board renders the UI fixes without console errors. Confirm no shipped file outside the plan's scope changed: `git diff --stat main..fix-checkup-batches` should show only the files the batches name (plus board-template.html for Batch F). Then push the branch (`git push -u origin fix-checkup-batches`) and STOP — do not open the PR.
</verification_before_done>

<report>
End with: which findings were fixed (one line each, with the commit), which were skipped and why, the final suite results (exact pass counts), and whether the board template was rebuilt. This message is read by the researcher, not another agent.
</report>

<handoff>
The researcher reviews the pushed branch and opens the single giant PR. Do not do that step.
</handoff>
