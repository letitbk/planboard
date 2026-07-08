---
description: Set up the plan-based research workflow in this project (master plan, decision log, CLAUDE.md conventions)
argument-hint: [optional: one-line project description]
allowed-tools: Read, Write, Edit, Glob, Grep, AskUserQuestion, Bash(git:*), Bash(ls:*), Bash(date:*), Bash(mkdir:*), Bash(touch:*)
---

Initialize (or update) the research-plans workflow in this project. Skill context: read `${CLAUDE_PLUGIN_ROOT}/skills/managing-research-plans/SKILL.md` first if you have not already.

Follow these steps in order:

1. **Resolve the project root.** If inside a git repository, the root is `git rev-parse --show-toplevel`. If that differs from the current directory, or if this is not a git repository, confirm the intended project root with the researcher before creating anything. Never nest a second `plans/` tree inside a project that already has one at its root.

2. **Check for prior initialization.**
   - If `plans/master-plan.md` already exists: switch to **update mode**. Never clobber it. Offer to (a) review and refresh the components table together, (b) upgrade a pre-v0.3 master plan in place — add the `### Research questions` subsection, the `Serves` column, and an `Initialized:` line backdated to the git first-commit of master-plan.md — and (c) upgrade the CLAUDE.md section (step 6) if the plugin has changed. Skip steps 3–5.
   - If the repo's `CLAUDE.md` contains `<!-- research-plans:start -->` but `plans/` is missing, tell the researcher the project looks partially initialized and ask how to proceed.

   **Mid-session adoption.** This command works at session start or mid-session, after exploratory work has already happened. Fold what the session established into the plan artifacts: explored data quirks, sharpened questions, and choices already made become Project context, the research questions, and later Scope-decision reasons — **the session's history feeds the plan, not the log**. The decision log starts at initialization: no entries for pre-init work, no reconstructed timestamps (the same rule as never fabricating entries). Pre-adoption *history* — decisions that predate initialization — is recorded separately and honestly in `plans/history.md` via `/research-plans:adopt`, never backdated into the log.

   **Adopting substantial prior work.** When the repo already holds months of executed analysis (many scripts and outputs, a long git history) that no plan ever governed, do not reconstruct it here — init derives components from the research design and sets status only. Instead run init in **minimal mode** (project context + research questions + markers + the `Initialized:` stamp; leave the components table with a one-line "components adopted via /adopt" note), then hand off to `/research-plans:adopt`. That command decomposes the done work into components, drafts a full **retrospective** plan for each (reviewed in one board batch), and reconstructs pre-adoption history into `plans/history.md` — the machinery that lets already-done work carry a real plan without pretending it was prospective.

3. **Short interview — research questions first.** Ask the researcher (use AskUserQuestion; keep it to one round, three questions max): **the research questions** (they become the master plan's numbered list: RQ1, RQ2, …), then the data (sources, rough size, sensitivity), and key constraints or deadlines. `$ARGUMENTS`, if provided, seeds the project description — confirm rather than re-ask.

4. **Derive components from the research design, not the repo.** Components are the research activities required to answer the research questions — propose each with a `Serves` entry (`RQ1`, `RQ1, RQ2`, or `—` for genuine infrastructure). Then scan the repo (`git log --oneline | tail -30`, top-level directories, existing scripts and data folders) to set **STATUS ONLY** — work that already happened gets `done` or `in progress`, not `not started`. The repo scan never shapes the component structure; never create components that narrate repository history. Keep components at the granularity of "independently completable and verifiable" (see `${CLAUDE_PLUGIN_ROOT}/skills/managing-research-plans/references/split-criteria.md`). Confirm the list with the researcher. If demo-style artifacts exist (`plan-versions/`, `askuserquestion-log.md`), mention them and treat them as read-only context; do not migrate or modify them.

5. **Create the artifacts** from the templates in `${CLAUDE_PLUGIN_ROOT}/skills/managing-research-plans/templates/`:
   - `plans/master-plan.md` from `master-plan.md` — keep the `<!-- research-plans:master-plan -->` marker on line 1, fill in project context (2–3 paragraphs from the interview), the `### Research questions` list, the confirmed components table with its `Serves` column, today's date (`date +%Y-%m-%d`), and stamp `Initialized:` with the real current time (`date +"%Y-%m-%d %H:%M"`). Delete the Sequencing notes section unless dependencies are non-linear.
   - `plans/decision-log.md` from `decision-log.md` — header and rules only. **Never fabricate entries for work that predates initialization.** The log starts now.
   - `plans/execution/.gitkeep` — write it as an empty file with the Write tool (not `touch`), so the directory survives a git commit. Execution plans are created later by `/research-plans:plan`.

6. **Bind the conventions in CLAUDE.md.** Read `${CLAUDE_PLUGIN_ROOT}/skills/managing-research-plans/templates/claude-md-section.md`.
   - If the project has no `CLAUDE.md`, create one containing that block.
   - If `CLAUDE.md` exists without the `<!-- research-plans:start -->` marker, append the block to the end. Touch nothing else in the file.
   - If the marker already exists, replace everything between `<!-- research-plans:start -->` and `<!-- research-plans:end -->` (inclusive) with the current block. Never duplicate the section; never modify content outside the markers.

7. **Wrap up.** Verify on disk that every artifact from steps 5–6 actually exists, and report only what exists — if a write was denied or skipped, say so plainly. Then suggest (do not run without approval) a commit such as `plans: initialize research-plans workflow`. **Point to the right next command:** if the repo scan in step 4 turned up substantial prior work that no plan governed — many analysis scripts/outputs and a long history (roughly 20+ commits) predating this init — recommend `/research-plans:adopt` to bring that done work under retrospective plans; otherwise point the researcher at `/research-plans:plan` to scope the first component.
