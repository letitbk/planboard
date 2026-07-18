# Planning doctrine — how an execution plan gets authored

Referenced by `/research-plans:plan` (steps 3–5). The rubric (`plan-rubric.md`) grades the artifact; this file governs the authoring, so a plan authored here works as well standalone as one authored inside a heavyweight personal setup.

## Research first — plan from the repo's reality, not from memory of it

Before any authoring dialogue, run a short read-only grounding pass: repo structure, data presence and rough shape, prior components' outputs, existing scripts touching this component's area. Bound it: roughly a dozen files and a few read-only commands (`ls`, `head`, `git log`, quick greps) — minutes, not tens of minutes. "Read-only" permits writing a gitignored evidence log when the deeper data exploration (`explore-before-planning.md`) warrants one. Say what was found in two or three sentences before the first question. The researcher can decline with "skip exploration".

## Surface assumptions — a default is a claim about the world

Every proposed default rests on an assumption. When presenting options for a consequential fork, name what the default assumes ("listwise deletion assumes missingness is ignorable here"). When the researcher waves a high-stakes choice through, say what the default assumes and ask whether it holds. When an instruction has multiple readings, present them — never pick silently.

## Evidence discipline — write success criteria that capture can test

At capture time the bundle's validation audits the plan's success criteria against artifacts, and the sealed F·A·I score derives from those verdicts. So criteria must be checkable against evidence that will exist: named outputs, thresholds, tests a third party could run. A criterion validation cannot test is a criterion the plan does not really have (rubric channel 4 scores this). The Verification section is the bridge: it says what artifact or check will show each criterion was met, and CLAUDE.md rule 9's `logs/` capture is where run evidence lands along the way.

## Simplicity and surgical scope

Plan the minimum that answers the research question — no analyses, robustness sweeps, or infrastructure beyond what the goal needs (add them when the data pushes back, by revision). Boundaries name both what is out of scope and what not to touch; execution stays inside them, and the tail's deviation stop catches drift.

## The revision loop — the review room is the approval dialog

Authoring ends in the review room: the draft is scored, the researcher annotates, and Approve or Request changes closes the pass. "Keep planning" is Request changes — revise the draft and return; several passes are normal. A signed plan changes only by a new version with a `Supersedes` line; the sign-off gate enforces it.

## Compatibility with other skills

General process skills active in a researcher's setup (brainstorming, test-driven development, worktree discipline) are welcome for the work itself. The plan documents, their locations, their versioning, and their approval flow always follow THIS plugin's template and rubric contract — external planning skills' artifacts (checkbox task plans, other save locations, separate approval flows) are not substitutes for `plans/execution/<NN-slug>/vN.md` and the review room.
