# Codex plan+execute handoff + automatic execute nudge — design

Date: 2026-07-23. Status: design, reviewed by codex (sol/xhigh, `logs/codex_review_20260723_112941_codex-handoff-design.md`), revised. Pending implementation plan.

Two independent work items, one design doc. They ship together because both touch the model/provenance surface, but neither depends on the other.

## Threat model (decided up front — it frames everything below)

The codex handoff assumes a **cooperative** codex: a trusted collaborator, not an adversary. The goal is workflow fidelity and an honest record, not structural protection against a malicious codex process. This matters because planboard's sign gate is a **Claude Code PreToolUse hook** (`hooks.json` matcher `Write|Edit`) — it wraps only Claude's Write/Edit tool, so it cannot and does not gate codex's file writes. Consequences accepted by this design:

- The human sign-off is a real, hook-enforced human-commitment **record** at the moment Claude writes the signed plan. It does not extend structural protection over codex's later execution phase.
- Post-sign integrity on the codex side is **git audit + convention** (prompt-prose discipline), not structural enforcement. A cooperative codex follows the rules; nothing mechanically stops a raw write. That is acceptable under this threat model and is stated plainly rather than papered over.
- Tamper *detection* (re-hashing signed plans against their recorded hash) was considered and deferred; structural *prevention* (canonical artifacts outside codex's writable sandbox with a trusted helper owning writes) was considered and rejected as over-engineering for a trusted collaborator.

## Work item 1 — the execute nudge fires deterministically

**Problem.** The model nudge gates on the model knowing its own identity — every nudge block reads `when its model is not inherit and differs from the model you are running as (you know your own identity)`. Self-reported identity is unreliable, so the nudge can silently fail to fire.

**Change.** Remove the self-identity condition and fire deterministically from `models.py stage <key>` output plus the researcher's selection. The nudge fires **only when a usable, non-`inherit` row exists** — empty `models.py` output (no profile / no usable row) stays silent, preserving the standing "no profile → zero behavior change" contract (`SKILL.md`).

- **execute** (`skills/managing-planboard/references/execution-loop.md` → "The execute prompt", with mirrors in `skills/managing-planboard/SKILL.md`): the execute `AskUserQuestion` always includes the model choice, pre-set to the profile's `execute` row read live from `models.py stage execute`, whatever the session is on. On a non-`inherit` selection, print the one-line `/model` hint and WAIT — no self-identity comparison. If already on that model, the switch is a no-op.
- **plan** (`commands/plan.md`) and **sync** (`commands/sync.md`): drop the `differs from the model you are running as` clause; when the row's model is not `inherit`, always print the one-line hint; empty/`inherit` stays silent.
- `commands/execute.md` is **unchanged** — it delegates to the execution-loop reference. So the edit touches **four** files: `plan.md`, `sync.md`, `execution-loop.md`, `SKILL.md`.

**Two distinct lines** (the old single line wrongly implied the profile even on an override, and depended on knowing the current model):

- Profile hint (row is authoritative): `Model profile: this stage is set to <model>. Switch with /model <model> if you're not already on it (safe mid-conversation — nothing is lost), or continue as-is.`
- Override line (researcher picked a model other than the row): `Execution choice: use <model> — switch with /model <model> if you're not already on it, or continue as-is.`

Append `, effort <level>` when the row names an effort and the build exposes a session effort control. The switch stays a human `/model` action — a command cannot change the live session model. Unchanged: empty-output silence, "never repeat in a session," and the headless `--model` path (already bypasses the nudge).

## Work item 2 — codex plan+execute handoff (`AGENTS.md`)

**Premise.** Planboard's value is the discipline — plan-before-execute, provenance, the decision log, the tracker — and it should not be Claude-locked. Codex auto-loads `AGENTS.md` the way Claude auto-loads `CLAUDE.md`, so the handoff is the codex-side twin of the `CLAUDE.md` conventions block that `/init` installs. (See "Verify before implementation" — the exact codex `AGENTS.md` loading rules and the absence of `${CLAUDE_PLUGIN_ROOT}` in codex are external runtime facts to confirm, not repo facts.)

### Architecture: `AGENTS.md` carries a marked, generated pointer block

Codex cannot resolve `${CLAUDE_PLUGIN_ROOT}` (Claude Code plugin machinery). So the handoff command resolves it at generation time and bakes **absolute cache paths** into a **marked block** inside `AGENTS.md`, directing codex to read the *same* shipped references and run the *same* stdlib scripts by absolute path. No content duplication → no drift.

The pointer block must be **complete enough to actually run the loop**. `execution-loop.md` delegates capture/validation to `commands/results.md`, reporting to `commands/report.md`, amendments to `commands/sync.md`, and board routing to `commands/board.md` — so the pointer list includes both the references *and* those command files:

- References: `references/execution-loop.md`, `references/sign-off.md`, `references/planning-doctrine.md`, `references/split-criteria.md`, `references/plan-rubric.md`, `templates/execution-plan.md`.
- Command files (the loop delegates to these): `commands/results.md`, `commands/report.md`, `commands/sync.md`, `commands/board.md`, `commands/review.md`.
- Scripts: `scripts/models.py`, `scripts/results.py`, `scripts/board.py`.

**Ownership / existing-file policy** (mirror `/init`'s `CLAUDE.md` handling and the `pb-board` launcher's foreign-file refusal): write the pointer between `<!-- planboard:start -->` … `<!-- planboard:end -->` markers inside `AGENTS.md`; create the file if absent; append the block if a marker-less `AGENTS.md` exists (touch nothing else); replace only the marked block on refresh (atomic replace); **stop and report** on malformed/duplicated markers rather than guessing a range over unrelated instructions.

**Machine-local, fail-closed.** Absolute cache paths are machine- and version-specific, so the marked block is machine-local — recommend gitignoring `AGENTS.md` (or at least the block is understood as local); a collaborator runs the command on their own machine. The block carries a plugin-root/version stamp, and instructs codex to **fail closed** — "rerun `/planboard:handoff`" — when any referenced path is missing (reuse the `board.py` launcher's resolve-active-path + safe-quote pattern). Re-running refreshes the paths after a plugin upgrade.

### The codex loop (what the pointer block instructs)

1. **Author the plan** in codex per `templates/execution-plan.md` + `references/planning-doctrine.md`. Write the first-line provenance marker from the start — `<!-- pb-model {"prescribed":P,"reported":{"model":"<codex model id>","effort":null}} -->`, `P` = the `plan` row from `models.py stage plan` (or `null`) — carried unchanged into every snapshot and the final version (the gate hashes the approved text, so the marker cannot be added after approval). The **codex model id is supplied by the researcher / the `/handoff` invocation, not self-inferred by codex** — self-inference would repeat the exact self-identity unreliability work item 1 removes, and the board/`results.py` already treat this value as self-attested.
2. **Hand to Claude for review + sign** (co-located, one visit): the researcher runs `/planboard:review` then `/planboard:sign` in a Claude session. Review does not touch the plan bytes, so the hash stays valid. This produces the hook-enforced human-commitment record. Note the review agent (`pb-plan-reviewer`) runs at the profile's model (platform-overridable) and can fall back inline if unloaded — it is a cross-model check by default, not a guaranteed opus critic.
3. **Execute** the analysis in codex under the signed plan per `references/execution-loop.md`. (Cooperative: codex is trusted not to rewrite the signed `vN.md`; nothing structurally prevents it — see threat model.)
4. **Capture results** in codex via `results.py stage` / `results.py finalize`. `results.py` gives mechanical correctness (staging + atomic rename) but is **not** an enforcement equivalent of the hook — its validator does not check `planVersion`/plan existence/trailer; those rules live in `commands/results.md` prose, which codex follows by convention. Codex must use `results.py`, never raw bundle writes.

Sync and the board stay optional Claude-side touchpoints.

### Signing: a human-commitment record in Claude (not a forgery-proof boundary)

Grounding (verified): `board.py --sign` runs a browser sign server that on approval writes a `.import-approved-<slug>-v<N>` ticket carrying `sha256(normalize_plan(draft))`; the PreToolUse hook (`signoff_gate.py` → `check_ticket`) validates the write against that hash. Precise facts (corrected from the first draft):

- The hash is over **normalized** plan text, not "exact bytes": `normalize_plan()` normalizes CRLF, strips trailing whitespace, and **excludes the final `Signed off:` trailer** — so the plan body + model marker are bound, but the displayed signatory name/date are convention, not hash-bound.
- Writes are **not** "always denied without a ticket": amendment trailers are admitted ticketless, `NO_GATE=1` bypasses, and an absent ticket falls through to the interactive browser gate.
- The hook matches `Write|Edit` only, so it governs Claude, not codex.

Decision: **sign in Claude, co-located with the cross-model review.** The researcher is already in Claude at the sign moment, so it adds no extra round-trip and yields a real hook-enforced human-commit record. It does **not** "close the codex forgery gap" or give "unconditional enforcement" over codex's execution phase — that language is removed. Under the cooperative threat model this is the right, honest boundary with zero new machinery.

### Provenance stays honest, no board code

The `reported` side of the `pb-model` marker is already free-form: `board/src/lib/modelUsage.ts` `isSide()` accepts any string `model` with string-or-null `effort`, and `results.py --reported-model` takes any value. The `claude-*` restriction lives only on the prescribed/profile side. So codex stamps `reported:{"model":"gpt-5.6"}` and the board renders it. `modelsEquivalent()` only knows Claude aliases, so a codex-reported model against a Claude-prescribed profile renders as "differs" — truthful (it *is* a divergence), not a bug. No board change.

### Delivery: a dedicated, re-runnable command

New command (working name `/planboard:handoff`) writes/refreshes the marked `AGENTS.md` block, generated from the shipped files with paths resolved at run time. Opt-in, re-runnable to re-sync. **Requires both markers** — a marked `plans/master-plan.md` *and* the planboard marker in `CLAUDE.md` — matching `find_project_root()` and the skill's hard gate; without both, even the Claude sign gate is inactive, so the handoff must refuse. Report whether `AGENTS.md` is gitignored. This researcher-project `AGENTS.md` is unrelated to the planboard *dev-repo* `AGENTS.md` (review/release rules) — different repositories.

## Decisions locked (brainstorming + codex review, 2026-07-23)

| Fork | Decision |
|---|---|
| Threat model | Cooperative codex — honest reframe, zero new machinery |
| Execute nudge | Always pre-select from a usable non-`inherit` row; drop self-identity gate; distinct profile vs. override wording |
| Codex role | Codex runs the stdlib scripts for mechanical correctness; immutability/provenance rules are convention on the codex side, not hook-enforced |
| Delivery | Dedicated re-runnable command; requires BOTH markers; marked-block ownership; fail-closed on stale paths |
| Stage scope | Full loop: author → (Claude review+sign) → execute → results |
| Plan review | Claude `pb-plan-reviewer` at the profile model (overridable; inline fallback) |
| Sign gate | Sign in Claude, co-located with review — a human-commit record, not structural protection over codex |
| Provenance | Honest; codex model id supplied by researcher/invocation (not self-inferred); no board code |

## Verify before implementation (external runtime facts, not repo facts)

- **VERIFIED 2026-07-23** (OpenAI codex docs, `developers.openai.com/codex/guides/agents-md`, corroborated by the `agents.md` standard): Codex starts at the **project root (typically the Git root)** and walks down to the cwd, reading `AGENTS.md` (and `AGENTS.override.md`) in each directory; it concatenates them **root-to-leaf** (global `~/.codex` → repo root → nested → cwd), injected before the user prompt. So a **repo-root `AGENTS.md` is automatically read and honored** anywhere in the repo — the design's write target is correct. A closer subdir `AGENTS.md` is also read and concatenated *after* the root block, so our planboard block at the repo root is always present (a deeper file can add, not erase it). Codex has **no `${CLAUDE_PLUGIN_ROOT}`** — it uses `CODEX_HOME`/`~/.codex`; that variable is Claude Code plugin machinery, absent in codex, so baking absolute paths at generation time is required (as designed).
- `/model <current-model>` mid-session is a harmless no-op in Claude Code (a confirmation, nothing lost) — low-risk assumption, not independently doc-verified.

## What this explicitly does NOT do (YAGNI)

- No new signing machinery, no finalize CLI, no server-side sign write, no tamper-detection layer (deferred).
- No board/TypeScript changes — provenance already renders codex models.
- No copying of scripts/references into the researcher's project.
- No codex-side review or sign; no change to the headless `--model` path.

## Next

Task-by-task implementation plan. The nudge de-gating is small and prose-only (four files). The handoff is a new command plus a generator that resolves paths, enforces both-markers, and writes the marked `AGENTS.md` block with fail-closed pointers. **This is shipped plugin behavior**, so the plan must also carry the release mechanics the planboard dev-repo `AGENTS.md` requires: version bump, lockfile sync, CHANGELOG entry, and public command documentation (README/reference + command frontmatter).
