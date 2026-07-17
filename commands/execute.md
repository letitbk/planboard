---
description: Execute one or more signed plans — one question, then the loop runs to results, validation, and report
argument-hint: [component names/numbers... | --go --report yes|no [--model <id>] [--rerun] (headless)]
allowed-tools: Read, Write, Edit, Glob, Grep, AskUserQuestion, Task, Bash(python3:*), Bash(python:*), Bash(Rscript:*), Bash(bash:*), Bash(tee:*), Bash(mkdir:*), Bash(git:*), Bash(ls:*), Bash(date:*)
---

Execute signed execution plans and run the full loop after them. Skill context: `${CLAUDE_PLUGIN_ROOT}/skills/managing-research-plans/SKILL.md`. The whole choreography lives in `${CLAUDE_PLUGIN_ROOT}/skills/managing-research-plans/references/execution-loop.md` — load it and follow its named sections; this command adds only the entry checks below. Requires an initialized project (`plans/master-plan.md` with its marker); if absent, say so and stop.

1. **Resolve the components.** Arguments starting with `--` are flags (headless — see **Headless rules** in the reference), never component names. Each remaining entry names a component (name or number via the master plan tracker). No component argument → propose the first `planned` row and confirm inside the execute prompt. Per component: unknown → error naming the valid rows, before anything runs; no signed plan → point at `/research-plans:plan <component>` (an unsigned draft belongs in the review room first); already executed with a current bundle → interactive: say so and ask re-run vs skip inside the execute prompt; headless: skip unless `--rerun`.

2. **The execute prompt.** Follow **The execute prompt** in the execution loop reference — one question covering now/later, model, and the report preference, with plan-commit consent inside the "now" option. Headless sessions follow **Headless rules** instead (`--go` authorizes; absent → print what is needed and stop).

3. **Execute and run the tail.** For each component in order: do the work under the plan (**During execution**), then **The per-component tail** — capture into staging, validate, branch on the **Outcome matrix** (the **deviation stop** interrupts on deviations), finalize, report when pre-answered, bookkeeping. Then **After all components** — the single commit suggestion, the one view-only board, and **Loop closure**.
