# Planning doctrine — how an execution plan gets authored

Referenced by `/planboard:plan` (steps 3–5). The rubric (`plan-rubric.md`) grades the artifact; this file governs the authoring, so a plan authored here works as well standalone as one authored inside a heavyweight personal setup.

## Research first — plan from the repo's reality, not from memory of it

Before any authoring dialogue, run a short read-only grounding pass: repo structure, data presence and rough shape, prior components' outputs, existing scripts touching this component's area. Bound it: roughly a dozen files and a few read-only commands (`ls`, `head`, `git log`, quick greps) — minutes, not tens of minutes. "Read-only" permits writing a gitignored evidence log when the deeper data exploration (`explore-before-planning.md`) warrants one. Say what was found in two or three sentences before the first question. The researcher can decline with "skip exploration".

## Surface assumptions — a default is a claim about the world

Every proposed default rests on an assumption. When presenting options for a consequential fork, name what the default assumes ("listwise deletion assumes missingness is ignorable here"). When the researcher waves a high-stakes choice through, say what the default assumes and ask whether it holds. When an instruction has multiple readings, present them — never pick silently.

## Evidence discipline — write success criteria that capture can test

At capture time the bundle's validation audits the plan's success criteria against artifacts, and the sealed F·A·I score derives from those verdicts. So criteria must be checkable against evidence that will exist: named outputs, thresholds, tests a third party could run. A criterion validation cannot test is a criterion the plan does not really have (rubric channel 4 scores this). The Verification section is the bridge: it says what artifact or check will show each criterion was met, and the CLAUDE.md **Evidence before claims** rule's `logs/` capture is where run evidence lands along the way.

## Simplicity and surgical scope

Plan the minimum that answers the research question — no analyses, robustness sweeps, or infrastructure beyond what the goal needs (add them when the data pushes back, by revision). Boundaries name both what is out of scope and what not to touch; execution stays inside them, and the tail's deviation stop catches drift.

## The revision loop

Authoring produces a scored pending draft. The researcher can annotate it on the board, then revise it through as many passes as needed. `/planboard:execute` signs the draft before work begins. `/planboard:sign` signs it sooner when requested. A canonical plan changes only through a new version with a `Supersedes` line. `/sync` records a confirmed amendment, and re-execution recommits that amendment through a sign session.

## Compatibility with other skills

General process skills active in a researcher's setup (brainstorming, test-driven development, worktree discipline) are welcome for the work itself. The plan documents, their locations, their versioning, and their signing flow always follow THIS plugin's template and rubric contract. External planning artifacts such as checkbox task plans or other save locations are not substitutes for `plans/execution/<NN-slug>/vN.md` and the sign workflow.

## Two review channels

A plan is judged on two independent questions, and neither substitutes for the other.

The **rubric score** asks whether the plan is a checkable contract. It reads only the plan text, scores five channels of control, and never opens the repository. Its output is a profile such as `G3·D3·S3·V3·B3 = 15/15`.

The **audit** asks whether the plan will actually work. It reads the plan against this repository and this data, and its output is a list of findings, each naming the concrete failure it predicts at execution time and the evidence path it rests on.

A high score does not predict a quiet audit. Specific steps, named success criteria, and stated boundaries are all falsifiable claims, so a well specified plan gives an auditor more to attack, not less. A vague plan gives it nothing concrete to contradict. "15/15 with two blockers" is therefore a coherent state, not a contradiction: the plan is well governed and technically wrong.

Report both. Never merge them into a single number or a single verdict.
