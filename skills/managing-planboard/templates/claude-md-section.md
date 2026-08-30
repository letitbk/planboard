<!-- planboard:start -->
## Research plans workflow

This project uses the planboard workflow (https://github.com/letitbk/planboard). The rules below apply when a planboard command is running, or when work touches a component that already has a signed execution plan. Outside those, work normally. Finalized plan versions, results bundles and archived master plans stay immutable at all times regardless.

1. **Read the governing plan first.** Before changing anything in a component that has a signed execution plan, read `plans/master-plan.md` and that component's latest version (`plans/execution/<NN-slug>/`, highest `vN.md`).
2. **Plan versions are immutable.** Execution plans are versioned `v1.md, v2.md, ...` and are never overwritten or edited. A revision is a new file with a `Supersedes` line explaining what changed and why; `/planboard:sync` records one.
3. **Log decisions in real time.** Append entries to `plans/decision-log.md` **as decisions happen**: when you ask a clarifying question, when the researcher sets or changes scope, when you make a non-trivial interpretive call (flag it), or when a surprising result changes what happens next. Do not backfill at the end of a session.
4. **Interpretive choices are the researcher's.** Surface interpretive choices (variable selection, case exclusions, coding rules, model specification) to the researcher **before** acting on them. Do not decide research questions, analytical choices, or interpretation on their behalf. **When the researcher has already stated a decision, record it and act on it rather than asking again** — re-opening a settled choice is not diligence.
5. **Output conventions** — target journal: <target journal>. Analysis deliverables are journal-ready, not raw output:
   - Figures: vector PDF plus a PNG preview, sized to a journal column, grayscale-safe. Use the /journal-figures skill if available; otherwise export to the same spec with standard tooling.
   - Tables: a typeset table (.png preview plus .tex source, booktabs style). Use the /journal-tables skill if available; otherwise modelsummary/kableExtra/gt to the same formats. A CSV of estimates is an intermediate, never the deliverable.
   - Every figure and table carries a title and a one-line caption suitable for the manuscript.
6. **Evidence before claims.** Run substantive analysis with output captured to `logs/` (e.g. `2>&1 | tee logs/<date>_<step>.log`; `logs/` stays gitignored). Never report a result — in chat, a results bundle, or a report — without the log, notebook output, or artifact that shows the code actually ran. Logs are local, temporary evidence: never write row-level personal data, credentials, or secrets into them.
7. **Assumptions and restraint.** State working assumptions before acting on them; when an instruction has multiple readings, present them rather than picking silently. Keep changes minimal and surgical — nothing beyond what the current plan step needs.

The `managing-planboard` skill (from the planboard plugin) has these conventions in depth, including which commands activate this workflow. The primary loop is plan → draft review → execute gate → tail. If work happened outside that loop or mid-session logging was missed, `/planboard:sync` is the recovery checkpoint.
<!-- planboard:end -->
