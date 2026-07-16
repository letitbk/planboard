# Plugin Checkup — Audit Execution Plan

> **For agentic workers:** This is an **audit** plan (revision 2, after a `/codex` plan review — `docs/specs/2026-07-15-codex-review-plugin-checkup-plan.md`). Tasks that produce tooling (Task 2 matrix checker, Task 5 token script) follow test-first cycles; investigative tasks carry concrete methods, exact commands, artifact schemas, and an **Acceptance** bar that stands in for a test. Steps use checkbox (`- [ ]`) syntax. Execute task-by-task; commit at each task boundary. **The scenario matrix (Task 2) is an enforced coverage ledger: `check_matrix.py` must pass before synthesis (Task 12).** The controller re-verifies any subagent-produced finding against real files before it is filed.

**Goal:** Produce a verified, priority-ranked findings document for the research-plans plugin across eight dimensions (token, coherence, workflow-correctness, UX/UI, accessibility, security, privacy, portability/install), with a proposed fix-batch plan — changing no shipped plugin behavior.

**Architecture:** A workflow-invariant *scenario matrix* is an **executable coverage contract**: every row names an owning task, a fixture, an oracle, expected/actual observables, an evidence path, and a terminal status, and a checker refuses synthesis while any row is open. Four phases serve it: **Instrument** (snapshot + baselines + matrix + threat model + token tooling), **Sweep** (one primary read per surface, filing findings against rows), **Probe** (clean-room install + execution, live board UX/a11y, adversarial security/privacy incl. a live Vercel arm, transcript mining — each *closing* rows with reproducers), **Synthesize** (matrix-closure gate, impact-scored severity, fixture-based verification, findings doc + fix batches).

**Tech stack:** python3 (stdlib) for the checker and token script; `claude -p --output-format json` for the clean-room; Playwright MCP over HTTP for the live board and the sign-off-gate arm; `codex` for adversarial verification; a throwaway Vercel deploy for the one hosted-runtime check; git worktree for the pinned snapshot.

**Spec:** `docs/specs/2026-07-15-plugin-checkup-design.md` (rev 2). **Reviews:** `docs/specs/2026-07-15-codex-review-plugin-checkup.md` (spec), `docs/specs/2026-07-15-codex-review-plugin-checkup-plan.md` (this plan).

## Global Constraints

- **Read the snapshot, write to main.** All shipped-surface reads and probes run against a **worktree pinned at `60eaede` (v0.18.0)** — created in Task 1 at `.claude/worktrees/checkup-snapshot`. Audit artifacts are written to `docs/evaluation/` in the primary checkout on `main`. Before each probe group, assert `git -C .claude/worktrees/checkup-snapshot rev-parse HEAD` == `60eaede`. Never read a shipped surface from a moving `main`.
- **No shipped plugin behavior changes.** Writes are confined to `docs/evaluation/checkup/` and `docs/evaluation/friction-log.md`. Nothing under `commands/`, `skills/`, `scripts/`, `board/`, `hooks/`, `.claude-plugin/` is modified. **Never run `npm run build`** — its postbuild `cp`s into `skills/.../board-template.html`, a shipped file. Board checks use `vitest run` + `tsc --noEmit` only. Fixes are separate, later, researcher-authorized PRs.
- **Verify before filing.** No runtime/behavioral claim is filed from a read alone or a subagent summary. It is `to-verify` in the sweep and closed by a probe with a stated oracle, or a direct code check. The controller re-confirms every fix-driving finding — including the *cross-file interpretation*, not just that a cited line exists.
- **Measure, then decide** (token). Accounting is descriptive and honestly labeled as *estimated static footprint* (not exact tokens); no reduction is recommended without a tokens-saved × frequency figure and a behavior-risk note. The researcher approves reductions per item.
- **Token metric framing** (decision): the **primary** number is the plugin's *added instruction footprint per context* — measured empirically by the plugin-on-vs-minimal-baseline paired run (Task 8), estimated statically in Task 5; the **cost** number is *billed uncached input* from real transcripts (Task 11). Static file-size sums are a ranking proxy with an uncertainty range, never presented as measured invocation context.
- **Transcript-mining governance.** Author's own repos only. Only aggregate token counts leave a transcript — no prompt text, tool output, or project data enters `docs/evaluation/`; no transcript is committed.
- **Security verdict labels.** Every security finding is labeled `static-contract` (code/mocked-test evidence) or `runtime-verified` (a live attempt). A code-only conclusion is never presented as a deployed guarantee.
- **Finding-record schema** (every finding, `findings-raw.md` → `findings.md`): `id` · `dimension(s)` · `surface:location` · `scenario-row` (Sxx or `—`) · `provisional-severity` (triage tag; final priority derived in Task 12) · `evidence` (file:line, measurement, or repro) · `verification-status` (`read-confirmed` / `CONFIRMED` / `downgraded` / `dropped`) · `proposed-direction` · `effort` (S/M/L) · `risk-note`.
- **Commit prose unwrapped** (one line per paragraph). No `Co-Authored-By` in commit messages.

## File structure (audit artifacts — all created; none modify shipped code)

- `docs/evaluation/checkup/scenario-matrix.md` — the coverage ledger (Task 2).
- `docs/evaluation/checkup/check_matrix.py` — the closure gate (Task 2).
- `docs/evaluation/checkup/threat-model.md` — assets/actors/boundaries (Task 4).
- `docs/evaluation/checkup/token_report.py` + `token-report.md` — static footprint model + report (Task 5; appended by Tasks 8, 11).
- `docs/evaluation/checkup/contract-map.md`, `xref-map.md`, `dependency-map.md` (Task 3).
- `docs/evaluation/checkup/baseline.md` — verification baseline, versions, isolation + bind capability (Task 1).
- `docs/evaluation/checkup/fixtures/board-demo/` — committed synthetic board fixture (Task 9).
- `docs/evaluation/checkup/findings-raw.md` (Tasks 6–12) → `findings.md` (Task 13, primary deliverable).
- `docs/evaluation/friction-log.md` — extended Run 2/Run 3 (Task 8).
- `docs/evaluation/checkup/clean-room/` — harness scripts + captured JSON (a local `.gitignore` covers `*.jsonl`, `*.json`, transcripts; commit only derived aggregate notes).
- `.claude/worktrees/checkup-snapshot/` — read-only snapshot at `60eaede` (Task 1; gitignored worktree path).

---

## Phase 0 · Instrument

### Task 1: Pin the snapshot, record the verification baseline, resolve isolation + bind capability

**Files:** Create `docs/evaluation/checkup/baseline.md`; create the snapshot worktree.

**Acceptance:** A read-only worktree exists at `60eaede`; the **three** suites (Python, board vitest, web-template vitest) are recorded green with counts; a board typecheck passes; the installed-plugin version is recorded; the clean-room isolation mechanism and the **localhost-bind capability** of this execution environment are confirmed and written down. Every claim carries its command + output. No `npm run build` is run.

- [ ] **Step 1: Create the pinned snapshot worktree.**
  Run: `git -C /Users/bk/github/research-plans worktree add --detach .claude/worktrees/checkup-snapshot 60eaede` then `git -C .claude/worktrees/checkup-snapshot rev-parse HEAD`. Expected: prints `60eaede…`. Confirm `.claude/worktrees/` is gitignored (napkin/convention); if not, note it.

- [ ] **Step 2: Confirm the primary tree still matches the snapshot for shipped surfaces.**
  Run: `git -C /Users/bk/github/research-plans diff --stat 60eaede -- commands skills hooks .claude-plugin board/src board/package.json`. Expected: empty (no divergence). If non-empty, do all reads from the worktree only and note the divergence.

- [ ] **Step 3: Localhost-bind preflight (feasibility gate for live-board probes).**
  Run: `python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print('bind OK', s.getsockname()); s.close()"`. Record OK/failure in `baseline.md`. If it fails (as the codex sandbox did — that is why an unaudited run can show false test failures), flag that Tasks 8–10's server-dependent probes need a bind-capable environment, and qualify any suite run accordingly.

- [ ] **Step 4: Run the three suites + the typecheck (no build).**
  Run, capturing to gitignored `logs/`:
  ```bash
  cd /Users/bk/github/research-plans && python3 -m pytest tests/ -q 2>&1 | tail -6
  cd board && ./node_modules/.bin/vitest run 2>&1 | tail -4 && npx tsc --noEmit 2>&1 | tail -3
  cd skills/managing-research-plans/assets/web-template && npm test 2>&1 | tail -4
  ```
  Record pass counts (expected ≈ 360 py, ≈ 278 board, ≈ 33 web-template; treat exact numbers as measured-now, not asserted). If the bind preflight failed, note which Python tests are environment-false-failures (the port allocator) rather than defects.

- [ ] **Step 5: Record the installed-plugin baseline** from `~/.claude/plugins/installed_plugins.json`, and whether it matches `60eaede`.

- [ ] **Step 6: Resolve clean-room isolation (do not assume).**
  Dispatch a `claude-code-guide` agent: does `CLAUDE_CONFIG_DIR` fully isolate global `CLAUDE.md`, user skills, plugins, and permissions for a `claude -p` run? What is the minimal true-clean invocation, and how is a plugin installed into an isolated config **from a local marketplace pointed at a specific worktree/commit** (so the snapshot, not public `main`, is installed)? Record the confirmed procedure.

- [ ] **Step 7: Write `baseline.md`, commit.**
  Sections: Snapshot worktree + SHA · Primary-tree divergence check · Bind capability · Three suites + typecheck · Installed version · Isolation + local-marketplace-pin procedure.
  ```bash
  git add docs/evaluation/checkup/baseline.md && git commit -m "checkup: baseline — snapshot worktree, 3 suites, bind + isolation capability"
  ```

### Task 2: Scenario matrix as an executable coverage ledger + the closure gate (test-first)

**Files:** Create `docs/evaluation/checkup/scenario-matrix.md`, `docs/evaluation/checkup/check_matrix.py`.

**Interfaces:** Produces the ledger every probe closes and the gate Task 12 runs. Columns (exact, pipe-delimited): `id | scenario | surfaces | task | fixture | command | oracle | expected | actual | evidence | runs | environment | status`. `status` ∈ `PASS` / `FAIL` / `NOT-RUN:<reason>` / `PENDING`. The checker treats `PENDING` and any blank required cell as incomplete.

**Acceptance:** ≥ 15 rows seeded from spec §4 + extensions, each with an owning `task`; `check_matrix.py` self-test passes; running the checker on the freshly-authored matrix reports it INCOMPLETE (rows are `PENDING` until probes close them) — proving the gate actually gates.

- [ ] **Step 1: Write the checker's failing self-test.**
  ```python
  # check_matrix.py  (--selftest)
  def _selftest():
      complete = "| id | scenario | surfaces | task | fixture | command | oracle | expected | actual | evidence | runs | environment | status |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n| S1 | x | a.py | T8 | fx | cmd | orc | exp | act | e.md | 1 | mac | PASS |\n"
      pending = complete.replace("| PASS |", "| PENDING |")
      assert validate(complete) == []                      # complete -> no problems
      assert any("S1" in p for p in validate(pending))     # PENDING -> flagged
  ```

- [ ] **Step 2: Run the self-test, watch it fail.**
  Run: `python3 docs/evaluation/checkup/check_matrix.py --selftest`. Expected: FAIL (`validate` undefined).

- [ ] **Step 3: Implement `validate(md)` + the CLI.**
  ```python
  import re, sys, pathlib
  REQUIRED = ["id","scenario","surfaces","task","fixture","command","oracle",
              "expected","actual","evidence","runs","environment","status"]
  TERMINAL = re.compile(r"^(PASS|FAIL|NOT-RUN:.+)$")
  def _rows(md):
      out=[]
      for ln in md.splitlines():
          if ln.startswith("|"): out.append([c.strip() for c in ln.strip().strip("|").split("|")])
      return out
  def validate(md):
      rows=_rows(md)
      if len(rows)<3: return ["no data rows"]
      hdr=[h.lower() for h in rows[0]]
      probs=[]
      for r in rows[2:]:
          if all((not c) or set(c)<=set("-") for c in r): continue
          rec=dict(zip(hdr,r)); rid=rec.get("id","?")
          for f in REQUIRED:
              if not rec.get(f,"").strip(): probs.append(f"{rid}: missing '{f}'")
          st=rec.get("status","").strip()
          if st and not TERMINAL.match(st): probs.append(f"{rid}: status '{st}' not terminal")
      return probs
  def main(p):
      probs=validate(pathlib.Path(p).read_text(encoding="utf-8"))
      if probs:
          print("MATRIX INCOMPLETE — synthesis blocked:"); [print("  -",x) for x in probs]; return 1
      print("MATRIX COMPLETE — all rows terminal."); return 0
  if __name__=="__main__":
      if "--selftest" in sys.argv: _selftest(); print("selftest OK"); sys.exit(0)
      sys.exit(main(sys.argv[1] if len(sys.argv)>1 else "docs/evaluation/checkup/scenario-matrix.md"))
  ```

- [ ] **Step 4: Run the self-test, watch it pass.**
  Run: `python3 docs/evaluation/checkup/check_matrix.py --selftest`. Expected: `selftest OK`.

- [ ] **Step 5: Author the matrix** — transcribe S1–S11 from spec §4 and extend (init update/minimal modes; renew archive-immutability + carry-over; adopt batch-gate ticket lifecycle; `results.py changed` drift → sync versioning; provenance honesty stamping; report null-result gate across all three entry paths; frozen-boot payload reconcile). **Every row gets an owning `task`** (which Phase-2 task closes it) and `status: PENDING`. Fill `surfaces`, `oracle`, `expected`, `fixture` now (static); leave `actual`/`evidence`/`runs`/`environment` for the probe.

- [ ] **Step 6: Prove the gate gates + commit.**
  Run: `python3 docs/evaluation/checkup/check_matrix.py docs/evaluation/checkup/scenario-matrix.md`. Expected: INCOMPLETE (every row PENDING) — this is correct pre-probe. Confirm ≥15 rows, each with an owning task and a falsifiable oracle. Then:
  ```bash
  git add docs/evaluation/checkup/scenario-matrix.md docs/evaluation/checkup/check_matrix.py
  git commit -m "checkup: scenario matrix as coverage ledger + closure gate"
  ```

### Task 3: Contract, cross-reference, and dependency maps

**Files:** Create `contract-map.md`, `xref-map.md`, `dependency-map.md` (+ save raw search output under `checkup/searches/` as evidence).

**Acceptance:** Each map's verdicts are backed by file:line on every side and by a saved search; `contract-map` covers the seed set with agree/drift; `xref-map` marks every step-reference resolves/stale; `dependency-map` classifies every external assumption and adds a supply-chain note per runtime fetch.

- [ ] **Step 1: Contract map.** For each seed (model-nudge in plan/sync/SKILL; initialized-project gate — enumerate exactly which commands, expected 8 = all but init/renew; substantive-finding rule results.py + findings.ts + report.md prose; scorecard schema rubric + rp-plan-reviewer + template + review.md; sign-off/ticket rules; provenance rules; board lifecycle board.md vs docs/reference.md), quote every side with file:line via `rg -n` (use `rg -a` on `parse.ts` — null byte), save the `rg` output to `checkup/searches/`, and mark `agree` / `drift: <what differs>`.

- [ ] **Step 2: Cross-reference map.** `rg -n 'step [0-9]|steps [0-9]|\.md step' commands/ skills/ > checkup/searches/xrefs.txt`; open each target and confirm the cited step still says what the citation assumes; mark `resolves` / `stale: <detail>`.

- [ ] **Step 3: Dependency map.** For pandoc, codex, agy, journal-figures/tables, node/vercel, gh, AskUserQuestion headless fallback, model aliases, `check_update`→GitHub `main`, `npx vercel`: classify hard/fallback/cosmetic, cite the guard or its absence (`rg -n 'command -v' commands/`), and add a supply-chain/trust note per runtime fetch.

- [ ] **Step 4: Acceptance + commit.**
  ```bash
  git add docs/evaluation/checkup/contract-map.md docs/evaluation/checkup/xref-map.md docs/evaluation/checkup/dependency-map.md docs/evaluation/checkup/searches
  git commit -m "checkup: contract, cross-reference, dependency baselines (evidence saved)"
  ```

### Task 4: Threat model

**Files:** Create `threat-model.md`.

**Acceptance:** Assets, actors (with the local same-machine attacker's capabilities defined), trust boundaries, and authority sources enumerated; each hosted/local/ingestion boundary carries a named adversarial case that Task 10 owns; correct env-var names used.

- [ ] **Step 1: Assets** — plans, decision log, results bundles, verdicts, hosted comments, the per-boot board token, the publish token, `BOARD_PASSWORD` / `BOARD_SESSION_SECRET` / `BOARD_PULL_KEY` / `BOARD_URL` (exact names — verify against `web-template/lib/auth.ts` and board.md), the private blob store.

- [ ] **Step 2: Actors** — researcher (full authority); honest collaborator (comment-only); **malicious collaborator** (crafts comment fields); **local same-machine attacker** — define capability: a non-root local user who can connect to `127.0.0.1` and read the repo, but not read another user's process environment or memory; artifact-embedded code (md/svg/html served by the board); a supply-chain position (`check_update`→GitHub `main`; `npx vercel`).

- [ ] **Step 3: Trust boundaries** — collaborator-comment → researcher-action (confused deputy); artifact-origin → local mutation routes; hosted blob → password gate; agent-written ticket → gate; the `Write|Edit`-only hook matcher → shell-redirection escape (documented boundary); command-prompt frontmatter tool grants (`/board` authorizes codex/agy/vercel/node) → session authority.

- [ ] **Step 4: Per-boundary adversarial case** Task 10 must attempt (mapped to S2/S5/S7/S9/S10 + the hook-boundary + supply-chain rows). Commit:
  ```bash
  git add docs/evaluation/checkup/threat-model.md && git commit -m "checkup: threat model — assets, actors, boundaries, adversarial cases"
  ```

### Task 5: Token accounting — static instruction-footprint model (test-first)

**Files:** Create `token_report.py`, `token-report.md`.

**Interfaces:** Produces the **static** section of `token-report.md` (Tasks 8 and 11 append the empirical + billed sections). Outputs are labeled *estimated static instruction footprint per modeled context* and *sum of modeled footprints* — never "measured tokens." `est_tokens(bytes) = ceil(bytes/4)` with a stated ±25% uncertainty band; bytes retained alongside.

**Acceptance:** self-test passes; the report distinguishes per-context footprint from cumulative-across-contexts (they differ for `/plan` because the reviewer is a separate context); the always-on floor is reported (~523 est-tokens incl. the skill description); flow surface-lists are **derived by reading each command body's load/dispatch instructions** (not hard-coded), and cross-checked against the matrix; a `cached/uncached` column exists (values filled by Task 11).

- [ ] **Step 1: Write the failing self-test.**
  ```python
  def _selftest():
      sizes={"A":400,"B":160,"C":160}                      # bytes
      flow=[["A"],["B","C"]]                                # ctx0: A; ctx1: B+C
      assert peak_context(flow,sizes)==100                 # max(ceil(400/4), ceil(320/4))=max(100,80)
      assert cumulative(flow,sizes)==180                    # 100+40+40
  ```

- [ ] **Step 2: Run it, watch it fail.** `python3 docs/evaluation/checkup/token_report.py --selftest` → FAIL (`peak_context` undefined).

- [ ] **Step 3: Implement** `est_tokens`, `peak_context`, `cumulative`, the surface table (sizes via `os.path.getsize` on the **snapshot worktree** paths, strata tags, `separate_context=True` for the three `rp-*` agent files), and the flow model. **Derive each flow's surfaces by reading the command body** — e.g. for `/plan`: grep the plan.md body for every `${CLAUDE_PLUGIN_ROOT}` load, the Task dispatch (rp-plan-reviewer + rubric + plan payload = a separate context), the execution-plan template, and the chained `/review` + `/board` steps — and record them as data with a comment citing plan.md line numbers. Emit `token-report.md` with the static section + an empty "empirical (Task 8)" and "billed (Task 11)" section.

- [ ] **Step 4: Run self-test + generate.** `python3 … --selftest && python3 … --out docs/evaluation/checkup/token-report.md`. Expected: selftest OK; report written; `/plan` peak ≠ cumulative; always-on floor ≈ 523.

- [ ] **Step 5: Sanity + commit.** Confirm no flow shows peak==cumulative when it spans a dispatch (else the separate-context modeling is wrong). Confirm every flow's surface list cites the command line it was derived from.
  ```bash
  git add docs/evaluation/checkup/token_report.py docs/evaluation/checkup/token-report.md
  git commit -m "checkup: static token-footprint model (per-context vs cumulative, derived flows)"
  ```

---

## Phase 1 · Sweep

### Task 6: One primary read per surface, filing findings against the ledger

**Files:** Create `findings-raw.md`; read (one primary pass, from the snapshot worktree) SKILL.md → 10 commands → templates/agents → the manifests (`.claude-plugin/plugin.json`, `marketplace.json`) → `hooks/hooks.json` → scripts (board.py, results.py, signoff_gate.py, models.py, check_update.py, new-walkthrough.py) → `board/src` → web-template → docs (README, QUICKSTART, reference, hosting-the-board, RELEASING, CHANGELOG) → the test suites as behavioral documentation.

**Acceptance:** every listed surface read once and filed as finding records (schema in Global Constraints); every finding tagged to a scenario row (Sxx) or `—`; behavioral claims tagged `to-verify`; findings filed *against* the Phase-0 maps (a `contract-map` drift → coherence finding; a `dependency-map` hard-dep-without-guard → portability finding; a `hooks.json` boundary gap → security finding).

**Method note:** Parallel subagents may sweep surface-groups to save wall-clock, but a subagent finding is a **draft**: the controller re-reads the cited file:line **and confirms the cross-file interpretation** before it is kept (line-existence alone is not confirmation — codex §5). Give each subagent the Phase-0 maps + the finding schema + "cite file:line; mark runtime behavior to-verify; name the scenario row."

- [ ] **Step 1: Sweep SKILL.md + the 10 command bodies** — duplication (vs contract-map), fragile xrefs (vs xref-map), token weight (vs token-report), and workflow steps a scenario row covers (tag Sxx, behavioral→to-verify).
- [ ] **Step 2: Sweep templates + the 3 agent files** — scorecard schema agreement; `{{MODEL/EFFORT/CHECKSUM}}` substitution contract; least-privilege of `tools:` grants (does rp-plan-reviewer need `Bash`?).
- [ ] **Step 3: Sweep the manifests + `hooks/hooks.json`** — the plugin/marketplace version + metadata contract; the `Write|Edit` matcher and its redirection-escape boundary (tag the hook-boundary scenario row, to-verify by Task 10).
- [ ] **Step 4: Sweep the scripts** — coherence (stale comments like `token_ok`), workflow invariants vs S-rows (tag + to-verify), Python/TS duplication (S8). No adversarial probing here (Task 10 owns it).
- [ ] **Step 5: Sweep `board/src`** (UX/coherence a read can surface; live-behavior→to-verify for Task 9), the **web-template** (security claims→to-verify for Task 10), the **docs** (every doc-vs-code drift — the board-lifecycle drift is the confirmed seed), and the **test suites** as behavioral documentation (what invariant each guards — feeds the matrix).
- [ ] **Step 6: Controller verification pass** — for every subagent finding, re-open the cited file:line, confirm the claim and its cross-file reading; drop/correct the rest; mark verified reads `read-confirmed`, behavioral ones `to-verify`.
- [ ] **Step 7: Commit.**
  ```bash
  git add docs/evaluation/checkup/findings-raw.md && git commit -m "checkup: Phase 1 sweep — findings filed against the ledger"
  ```

---

## Phase 2 · Probe

### Task 7: Clean-room foundation — isolated env + snapshot install + install/upgrade/uninstall

**Files:** Create `clean-room/env.md` (+ the local `.gitignore`); append install-dimension findings to `findings-raw.md`.

**Acceptance:** an isolated config with none of the author's setup is stood up and *verified* isolated; the plugin is installed **from a local marketplace pinned to the `60eaede` worktree** (not public `main`); the full install/upgrade/uninstall path (marketplace add → install → restart → update → pin → uninstall/reinstall) is exercised and every step's friction filed. Assert the snapshot SHA before starting.

- [ ] **Step 1: Snapshot assertion.** `git -C .claude/worktrees/checkup-snapshot rev-parse HEAD` == `60eaede`.
- [ ] **Step 2: Stand up + verify isolation** per Task 1 Step 6's procedure (fresh `CLAUDE_CONFIG_DIR`, no global CLAUDE.md/skills/permissions). Verify with `claude -p "list every active skill and CLAUDE.md rule"` — confirm none of the author's setup bleeds in. Record the exact env.
- [ ] **Step 3: Local marketplace pinned to the snapshot.** Point a local marketplace at `.claude/worktrees/checkup-snapshot` (or a file-path marketplace source resolving to `60eaede`), so `install` resolves to the audited commit, not public `main`. Record the exact commands (from Task 1 Step 6).
- [ ] **Step 4: Exercise the full path** — marketplace add → install `research-plans@…` → restart → confirm loaded → update (no-op at same version; note behavior) → pin → uninstall → reinstall. Log every step, prompt, restart requirement, and silent failure. File each friction as an install/upgrade finding; close the install scenario rows.
- [ ] **Step 5: Commit.**
  ```bash
  git add docs/evaluation/checkup/clean-room/env.md docs/evaluation/checkup/clean-room/.gitignore docs/evaluation/checkup/findings-raw.md docs/evaluation/checkup/scenario-matrix.md
  git commit -m "checkup: clean-room foundation — isolated env, snapshot install, upgrade/uninstall"
  ```

### Task 8: Clean-room execution — scripted loop, live gate arm, interactive, missing-tool, baseline arm, author diff

**Files:** Append to `friction-log.md` (Run 2 clean, Run 3 author); append the empirical section to `token-report.md`; append findings; close workflow scenario rows (S1, S2, S3, S11, …).

**Acceptance:** the scripted loop runs with **session continuity** and captures per-stage token JSON; the **sign-off gate is exercised for real** via a Playwright arm (closing S1/S2, not bypassing them); 2–3 interactive novice sessions probe burden/permission/recovery; **missing-tool degradation** is tested by removing binaries from `PATH` (pandoc, codex, agy, node — not just `CLAUDE_CONFIG_DIR`); the **plugin-on-vs-minimal-baseline paired run** measures the plugin's added instruction footprint; the author-env run is diffed; every clean-vs-author difference is a *candidate needing paired confirmation*, never asserted; claims scoped "fresh config, this CC version + macOS."

- [ ] **Step 1: Scaffold a synthetic analysis project** (reuse `scripts/new-walkthrough.py` to seed data + structure; note it only scaffolds — the loop is driven below).
- [ ] **Step 2: Scripted loop with session continuity.** Drive `/init` → `/plan` → *execute* (an explicit ordinary prompt — there is no `/execute` command; e.g. "run the cleaning script and produce the planned figure") → `/sync` → `/results` → `/report` → `/board --export`, each `claude -p --output-format json` **resuming the same session** (`--resume <id>` / `--continue` per Task-1 findings) so context carries. For this arm set `RESEARCH_PLANS_NO_GATE=1` (documented bypass — it covers token/friction/loop-shape, NOT S1/S2). Capture JSON to `clean-room/`. This is friction-log **Run 2**.
- [ ] **Step 3: Live sign-off-gate arm (closes S1/S2).** In a bind-capable environment, drive `/plan` to the point it writes `v1.md` **without** `NO_GATE` — the gate opens a board on the lock-file port. Poll `plans/.board.lock` for the port; connect Playwright MCP over HTTP; click **Approve**; let the `/plan` process unblock and write `v1.md`. Oracle S1: the signed `v1.md` bytes equal the approved draft bytes (diff them). Oracle S2: attempt an **agent-written** `.import-approved-*` ticket and confirm the hook denies it as forgery (re-run the signoff_gate tests + one live attempt). Record actual/evidence; close S1, S2.
- [ ] **Step 4: 2–3 interactive novice sessions**, answers NOT seeded: a cold `/init` (does it dead-end per friction-log 1.1?), a `/plan` (interview burden), a `/board` pass (permission walls, first-hook-trust). Record narratively in the friction log.
- [ ] **Step 5: Missing-tool degradation.** Re-run the relevant stages with binaries removed from `PATH` (`env PATH=<pruned> claude -p …`) for pandoc (report conversion), node (web publish), codex/agy (board review-with). Confirm each documented fallback fires gracefully vs. a raw failure; file findings; close the dependency scenario rows.
- [ ] **Step 6: Plugin-on-vs-minimal-baseline paired run.** Run one identical task (`/plan` a fixed component) in (a) the plugin-installed project and (b) a minimal project without the plugin's command/skill; diff the **input** tokens from the JSON. The delta is the plugin's added instruction footprint — the empirical anchor for the static Task-5 estimate. Append to `token-report.md` (empirical section).
- [ ] **Step 7: Author-env scripted run + diff.** Re-run Step 2's script under the normal environment; diff token usage + behavior/tone; file differences as candidates (paired-confirmation needed). Friction-log **Run 3**.
- [ ] **Step 8: Write Run 2/3, file findings, close rows, commit.**
  ```bash
  git add docs/evaluation/friction-log.md docs/evaluation/checkup/token-report.md docs/evaluation/checkup/findings-raw.md docs/evaluation/checkup/scenario-matrix.md
  git commit -m "checkup: clean-room execution — loop, live gate arm, interactive, missing-tool, baseline, diff"
  ```

### Task 9: Live board — synthetic fixture + UX walkthrough + accessibility/viewport

**Files:** Create `fixtures/board-demo/` (committed synthetic `plans/` tree); append findings; close board scenario rows (S6 live half + UX rows).

**Acceptance:** a **committed, reproducible** board fixture populating every view (plans, scorecards, results, reports, model profile, archive) exists — `dev-data.ts` is dev-only and not used; every view is exercised live; the annotation gesture is checked against one-gesture-everywhere; a bounded a11y/viewport pass (keyboard, 200% zoom, <1024px) runs; touch-commenting noted as a known deferred gap.

- [ ] **Step 1: Build the fixture.** Construct `fixtures/board-demo/plans/` matching the current templates (master plan, ≥2 components with signed vN plans, a scorecard, a results bundle with a figure + a report, a model profile, an archived master plan). Verify it loads by `board.py --export` and asserting the embedded JSON carries each surface (the napkin's export-smoke technique — silent-drop risk otherwise). Commit the fixture.
- [ ] **Step 2: Serve + walk every view.** `board.py --port N --no-open --timeout 3600` in the background over the fixture; Playwright MCP over HTTP, re-`browser_resize` after every navigate. Walk Tracker, PlanReader (+score panel), Results, Reports, Timeline, Models, Archive + the annotation flow. File any one-gesture violation, dead control, or empty state reading as broken.
- [ ] **Step 3: Accessibility/viewport (bounded).** Keyboard-only reach of approve / request-changes / comment / review-with (the composer starts from `onMouseUp` — is there a keyboard path?); 200% zoom (header flex row, `w-56` sidebars); <1024px overlay/scrim. File each with the recorded interaction as evidence.
- [ ] **Step 4: Close rows + commit.**
  ```bash
  git add docs/evaluation/checkup/fixtures docs/evaluation/checkup/findings-raw.md docs/evaluation/checkup/scenario-matrix.md
  git commit -m "checkup: live board UX + accessibility/viewport over a committed fixture"
  ```

### Task 10: Adversarial security + privacy — threat-driven, with a live Vercel arm

**Files:** Append findings; annotate `threat-model.md` with per-boundary verdicts; close S2 (mechanical half), S5, S7, S9, S10, hook-boundary, supply-chain rows.

**Acceptance:** every threat-model boundary carries a verdict labeled `static-contract` or `runtime-verified`; the confused-deputy, artifact-serving, ticket-forgery, local-mutation, hook-redirection, and supply-chain invariants are re-verified (not assumed); the hosted private-blob privacy is checked **live** on a throwaway Vercel deploy (decision); privacy/retention/least-privilege judged.

**Method note:** a small adversarial panel (parallel subagents: injection / auth-authz / data-exfil lenses) works the threat-model cases; the controller confirms every claimed vulnerability against real code before filing P0; a refuted case is filed "boundary holds."

- [ ] **Step 1: Confused deputy (S9).** Craft a collaborator feedback doc embedding a ```json board-feedback``` fence with `verdict`/`reviewRequest`/`reopen` in a `quote`; run `--collect <file>`; confirm keys stripped + headings demoted; trace `FENCE_RE`/`parse_fence` last-fence + multi-fence rules. Verdict (static or runtime) → S9.
- [ ] **Step 2: Local mutation surface (S10).** Confirm 127.0.0.1 bind + `local_request_ok` + per-boot `board_token` on every `/api/*` POST (board.py:1216); confirm an artifact served under the board origin cannot reach a mutation route (CSP/MIME headers). Runtime-verify with a live board + a crafted fetch. → S10.
- [ ] **Step 3: Artifact serving + Markdown scheme.** Verify md/svg/html served `text/plain`/attachment (never active under origin) and the Markdown renderer blocks `javascript:` links (attempt one). File regressions.
- [ ] **Step 4: Ticket forgery (S2) + hook boundary.** Confirm agent-written ticket denied (signoff_gate.py — re-run tests + live attempt); evaluate the `Write|Edit`-only matcher's shell-redirection escape (can a redirection write a signed `vN.md` outside the gate? test it). → S2 + hook-boundary row.
- [ ] **Step 5: Hosted auth — LIVE (S7).** Deploy a throwaway board to real Vercel (the v0.13 e2e path — napkin has the mechanics: `--access private` blob, env on both targets, `vercel deploy --prod`). Attempt to read a comment blob by URL without the password (expect denied / non-guessable-private); verify the password gate + cookie-after-secret-rotation. Label `runtime-verified`. Tear down; note the manual blob-store dashboard cleanup (napkin: CLI delete needs token). → S7.
- [ ] **Step 6: Secret-in-Bash + least-privilege + supply-chain.** Assess `printf '<secret>' | npx vercel env add` (secret in the Bash invocation → possibly the transcript) — propose a mitigation, do not overstate. Review each command's frontmatter tool grant for least privilege. Give `check_update`→GitHub `main` and `npx vercel` concrete supply-chain verdicts. → supply-chain rows.
- [ ] **Step 7: Privacy/retention.** Judge full-board-always publishing (minimization), offboarding (revocation = rotation only), comment persistence until `--web-clear`, 30-day cookies. File with proposed directions.
- [ ] **Step 8: Annotate verdicts, file findings, close rows, commit.**
  ```bash
  git add docs/evaluation/checkup/findings-raw.md docs/evaluation/checkup/threat-model.md docs/evaluation/checkup/scenario-matrix.md
  git commit -m "checkup: adversarial security + privacy with per-boundary verdicts + live Vercel arm"
  ```

### Task 11: Transcript mining (governed) — billed uncached input

**Files:** Append the billed section to `token-report.md`; append findings.

**Acceptance:** real per-flow **billed uncached input** (+ cache-read) for `/plan`, `/sync`, `/board` is measured from the author's own transcripts; only aggregates recorded; the confound (total input mixes instructions + data + history + tool output) is stated, so this is presented as the cost number, **not** a "refinement" of the static footprint (that is the Task-8 paired run).

- [ ] **Step 1: Locate the author's real research-repo transcripts.** If too sparse, fall back to Task-8 clean-room JSON (note the substitution).
- [ ] **Step 2: Extract per-flow aggregate billing** (input / cache-read / output per invocation) with a throwaway script writing ONLY numbers — no prompt/data content. Map to `/plan`, `/sync`, `/board`.
- [ ] **Step 3: Write the billed section (with the confound stated), file findings, delete the extract, commit.**
  ```bash
  git add docs/evaluation/checkup/token-report.md docs/evaluation/checkup/findings-raw.md
  git commit -m "checkup: billed uncached-input profile from real transcripts (aggregates only)"
  ```

---

## Phase 3 · Synthesize

### Task 12: Matrix-closure gate, severity scoring, fixture-based adversarial verification

**Files:** Modify `findings-raw.md` (scores + verdicts); run the gate.

**Acceptance:** `check_matrix.py` reports COMPLETE (every row PASS / FAIL / NOT-RUN:<reason>) — synthesis is blocked otherwise; every finding scored on the four axes with a concrete rule; every P0 and high-impact P1 re-verified by a **fixture-based rerun** capturing expected/actual state (not a re-read).

- [ ] **Step 1: Run the closure gate.** `python3 docs/evaluation/checkup/check_matrix.py`. If INCOMPLETE, return to the owning task and close the row (or mark `NOT-RUN:<reason>` honestly) — do not proceed until it prints COMPLETE.
- [ ] **Step 2: Score every finding** on **impact** (data-loss 4 / wrong-state 4 / security-privacy 3 / recurring-cost 2 / friction 2 / cosmetic 1), **likelihood** (routine 3 / plausible 2 / rare 1), **reach** (all-sessions 3 / all-projects 2 / single-flow 1), **confidence** (confirmed 3 / read-confirmed 2 / speculative 1). Priority: **P0** if impact ≥3 and likelihood ≥2 and confidence ≥2; **P2** if impact ≤1 or reach ==1 with low likelihood; else **P1**. Replace the provisional tags.
- [ ] **Step 3: Adversarially verify the P0s + high-impact P1s.** Oracle by type — static drift → file:line + conflicting texts; workflow → the matrix reproducer + captured expected/actual; token → the measurement + which metric; UX/a11y → the recorded interaction. Verify independently: a fresh subagent/context **reruns the reproducer against the fixture** (not a second reading); panel pattern for the load-bearing ones. Record `CONFIRMED` / `downgraded` / `dropped` with evidence.
- [ ] **Step 4: Commit.**
  ```bash
  git add docs/evaluation/checkup/findings-raw.md && git commit -m "checkup: matrix-closure gate + severity scoring + fixture-based verification"
  ```

### Task 13: Findings document + fix-batch proposal (primary deliverable)

**Files:** Create `findings.md`.

**Acceptance:** all `CONFIRMED`/`read-confirmed`-P2 findings promoted (deduped, priority-sorted), each with explicit `verification-status`; a dimension × severity cross-tab; a one-screen executive summary; fix batches each naming their walkthrough-regression check; a "considered and refuted" appendix; and a proof that no shipped file changed via `git diff --stat 60eaede..HEAD -- commands skills scripts board hooks .claude-plugin` being empty.

- [ ] **Step 1: Promote findings.** Every `CONFIRMED`, plus `read-confirmed` P2s (static drift needs no reproducer, but carries its status explicitly); dedupe (same anchor + point); sort by derived priority; drop `dropped` ones into a short "considered and refuted" appendix (so they are not re-discovered).
- [ ] **Step 2: Cross-tabulate** dimension × severity; write the executive summary (where the tokens are, where coherence drift concentrates, which invariants hold/regressed, the portability + a11y + privacy verdicts).
- [ ] **Step 3: Propose fix batches** — coherent branches approved one at a time; cross-cutting fixes (board.md web-runbook → load-on-demand reference) single batches touching a file once; each batch: findings, net win, effort, walkthrough-regression check.
- [ ] **Step 4: Acceptance + commit.**
  Verify: every finding traceable to evidence + a verification-status; every P0/high-P1 CONFIRMED; batches cover all P0/P1; token reductions each carry a risk note; `git diff --stat 60eaede..HEAD -- commands skills scripts board hooks .claude-plugin` is **empty** (no shipped file touched). Then:
  ```bash
  git add docs/evaluation/checkup/findings.md && git commit -m "checkup: findings document + fix-batch proposal (primary deliverable)"
  ```

---

## Self-Review

**Spec coverage:** §2 dimensions (8) → T6 tags all; token T5/T8/T11; coherence T3/T6; workflow T2/T8/T10; UX/a11y T9; security/privacy T4/T10; portability/install T7/T8. ✓ · §4 spine → T2 builds the ledger + gate; T8/T9/T10 close rows; T12 gates. ✓ · §5 surfaces incl. manifests/hooks/tests → T1 (suites), T6 (manifests, hooks, CHANGELOG, tests-as-doc). ✓ · §6 Instrument → T1–T5. ✓ · §7 Probe (clean-room scripted+interactive+install+baseline arm, board UX+a11y, security+prompts+live-Vercel, transcript governance) → T7–T11. ✓ · §8 Synthesize (impact severity, oracles, fixture-based verify, batches) → T12–T13. ✓ · §10 deliverables (6) → matrix T2, threat-model T4, token-report T5/T8/T11, three maps T3, friction-log T8, findings T13. ✓

**Codex plan-review coverage:** matrix-as-gate → T2 + T12 Step 1 ✓ · snapshot worktree → Global Constraints + T1 ✓ · web-template suite + no-build + bind preflight → T1 ✓ · Task-2 honest reframe + derived flows → T5 ✓ · plugin-on-vs-baseline → T8 Step 6 ✓ · session continuity + exec prompt + local-marketplace pin + PATH tool removal + update/pin/uninstall → T7/T8 ✓ · Playwright gate arm (S1/S2) → T8 Step 3 (decision 2) ✓ · committed board fixture → T9 Step 1 ✓ · scoring scales → T12 Step 2 ✓ · env-var names → T4 Step 1 ✓ · hook-boundary + supply-chain cases → T4/T10 ✓ · live Vercel S7 → T10 Step 5 (decision 1) ✓ · static-vs-runtime labels → Global Constraints + T10 ✓ · git-diff-stat + P2 promotion → T13 ✓ · token metric reframed → Global Constraints (decision 3) ✓

**Placeholder scan:** the two tooling tasks (T2, T5) carry real test+impl code; investigative tasks carry method + exact commands + acceptance (findings are the output, correctly not pre-written). No "TBD"/"handle edge cases"/"similar to Task N". ✓

**Type/naming consistency:** `validate()`/`_rows()`/`REQUIRED`/`TERMINAL` consistent in T2; `peak_context`/`cumulative`/`est_tokens` consistent in T5; `findings-raw.md`→`findings.md`; scenario ids Sxx consistent T2/T8/T9/T10/T12; `verification-status` values consistent (schema ↔ T6/T12/T13). ✓

## Execution Handoff

**Plan complete (rev 2) and saved to `docs/plans/2026-07-15-plugin-checkup-plan.md`** — 13 tasks, 4 phases, matrix-gated. It runs across sessions (Phase 0→1→2→3), each task committing an artifact, with the closure gate (Task 12 Step 1) as a hard checkpoint before synthesis.

**One execution prerequisite:** Tasks 8–10's server-dependent probes (live board, gate arm, live Vercel) need an environment that can bind `127.0.0.1` and reach the network — Task 1 Step 3 preflights it. If this session's Bash sandbox cannot bind localhost, those probes run in a bind-capable environment; the static/read/sweep phases are unaffected.

Execution options when you are ready:
1. **Inline, phase-by-phase (recommended for an audit)** — I run tasks in-session, dispatching subagents for the parallel sweep and the adversarial verification panel, re-verifying their findings and cross-file readings myself. Checkpoints at the three points that matter: after Phase 0 (baselines + matrix), after Phase 2 (findings-raw + closed ledger), and at the findings doc.
2. **Subagent-driven, task-by-task** — fresh subagent per task with review between; stronger isolation, weaker for the sweep and synthesis, whose value is one context holding the whole surface.

My recommendation remains inline (option 1). Want a final `/codex` pass on this revised plan, or shall I start Phase 0?
