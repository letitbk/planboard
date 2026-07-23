<!-- research-plans:start -->
## Research plans workflow

This project uses the research-plans workflow (https://github.com/letitbk/research-plans). These rules apply to every session in this repository:

1. At session start, read `plans/master-plan.md`, then the latest version of the execution plan for whichever component the work touches (`plans/execution/<NN-slug>/`).
2. Execution plans are versioned `v1.md, v2.md, ...` and are **never overwritten or edited**. A revision is a new file with a `Supersedes` line explaining what changed and why.
3. Append entries to `plans/decision-log.md` **as decisions happen**: when you ask a clarifying question, when the researcher sets or changes scope, when you make a non-trivial interpretive call (flag it), or when a surprising result changes what happens next. Do not backfill at the end of a session.
4. Surface interpretive choices (variable selection, case exclusions, coding rules, model specification) to the researcher **before** acting on them. Do not decide research questions, analytical choices, or interpretation on the researcher's behalf.
5. After execution work, update the Components table in `plans/master-plan.md`. Keep Outcome / notes to one line per component, and keep each component's Serves linkage (which research questions it serves) current.
6. If work is about to exceed what the current execution plan covers, pause and tell the researcher. Propose a new plan version rather than drifting.
7. Output conventions — target journal: <target journal>. Analysis deliverables are journal-ready, not raw output:
   - Figures: vector PDF plus a PNG preview, sized to a journal column, grayscale-safe. Use the /journal-figures skill if available; otherwise export to the same spec with standard tooling.
   - Tables: a typeset table (.png preview plus .tex source, booktabs style). Use the /journal-tables skill if available; otherwise modelsummary/kableExtra/gt to the same formats. A CSV of estimates is an intermediate, never the deliverable.
   - Every figure and table carries a title and a one-line caption suitable for the manuscript.
8. An execution plan is short, plain-language, and read cold by a coauthor. Carry the five things it is judged on and cut the rest: (1) a goal with success criteria a third party could check; (2) the consequential decisions with reasons that have depth and connect to the research question — an authored reason, a choice among options, or an approval all count equally; (3) steps concrete enough that "did the agent do this?" has an answer; (4) a validation step that tests whether the success criteria were actually met, not just that code ran; (5) boundaries — what is out of scope and what not to touch. Push code and low-level commands into collapsible `<details class="agent-detail">` blocks so the default read stays scannable.
9. Evidence before claims. Run substantive analysis with output captured to `logs/` (e.g. `2>&1 | tee logs/<date>_<step>.log`; `logs/` stays gitignored). Never report a result — in chat, a results bundle, or a report — without the log, notebook output, or artifact that shows the code actually ran. Logs are local, temporary evidence: never write row-level personal data, credentials, or secrets into them.
10. Assumptions and restraint. State working assumptions before acting on them; when an instruction has multiple readings, present them rather than picking silently. Keep changes minimal and surgical — nothing beyond what the current plan step needs.

The `managing-planboard` skill (from the research-plans plugin) has these conventions in depth. The primary loop is plan → draft review → execute gate → tail. If work happened outside that loop or mid-session logging was missed, `/research-plans:sync` is the recovery checkpoint.
<!-- research-plans:end -->
