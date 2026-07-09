---
description: Generate a shareable results report for a component's bundle — plan context, findings, embedded figures/tables, validation, provenance; markdown always, PDF/DOCX via pandoc
argument-hint: <component name/number> [rN — default: latest bundle]
allowed-tools: Read, Write, Glob, Grep, AskUserQuestion, Bash(pandoc:*), Bash(python3:*), Bash(ls:*), Bash(date:*), Bash(mkdir:*), Bash(command:*)
---

Assemble a standalone, collaborator-readable report for one results bundle. Skill context: `${CLAUDE_PLUGIN_ROOT}/skills/managing-research-plans/SKILL.md`. Requires an initialized project (`plans/master-plan.md` with its marker); if absent, say so and stop. Reports are **derived documents**: they live in `plans/reports/` (committed, never gitignored), regenerating overwrites, and nothing about them is immutable — the immutable record is the bundle itself.

1. **Resolve the target.** `$ARGUMENTS` names a component (name or number via the master plan tracker) and optionally `rN`; default is the latest bundle. Read the bundle (`manifest.json`, `report.md`, `verdict.json` if present, `validation.md` if present), the governing plan version (`manifest.planVersion` → `plans/execution/<NN-slug>/v<N>.md`), the master plan (project name, the RQs this component serves), and the decision-log entries mentioning the component. If the bundle does not exist, say so and stop.

2. **Write `plans/reports/<NN-slug>-r<N>-report.md`** (`mkdir -p plans/reports` first), self-contained for a reader with no project context:
   - **Header block:** project, component, plan v<N>, bundle r<N>, verdict state (accepted / changes requested / pending), validation status, generated date. One line each.
   - **1. Background and goal** — rewrite the plan's Goal and Context as prose (no template headers), naming the research question(s) served.
   - **2. Data and methods** — from report.md's data-and-method note plus the producing scripts (name each script file and what it does in a phrase).
   - **3. Findings** — each manifest metric: the `statement` as a lead sentence, then `label`, `value`, `note`, `status`.
   - **4. Figures and tables** — embed every figure/table artifact with its title and caption: `![<title>](../execution/<NN-slug>/results/r<N>/artifacts/<file>)` — paths RELATIVE to `plans/reports/` so the markdown renders on GitHub and in editors. Tables embed their `.png` render; note `.tex` availability in the caption line when present.
   - **5. Validation summary** — the manifest.validation status plus its steps/criteria as a compact table; "not validated" when absent.
   - **6. Provenance appendix** — scripts with repo paths and sha256s from the manifest, source-drift state (`python3 ${CLAUDE_PLUGIN_ROOT}/skills/managing-research-plans/scripts/results.py changed --component <NN-slug>`), and the related decision-log entries (timestamps plus a one-line gist).

   No overclaiming: every number traces to a metric or artifact; the report never introduces findings the bundle does not contain.

3. **Convert.** Check `command -v pandoc`. When available, run from `plans/reports/` so the relative image paths resolve: `pandoc <name>.md -o <name>.pdf` (needs a LaTeX engine; on failure report which is missing) and `pandoc <name>.md -o <name>.docx`. Markdown is always the source of truth; report honestly which conversions succeeded and why any failed (pandoc missing, no LaTeX engine) — never fabricate success.

4. **Wrap up.** List the written files with sizes. Suggest a commit such as `plans: report — <NN-slug> r<N>` (do not run without approval). If this run was triggered from the board's Generate report button, offer to reopen the board (`/research-plans:board <NN-slug>:r<N>`).
