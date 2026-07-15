# Plan Rubric v0.4 — five channels

*Draft for Candice's feedback. Builds on the v2 rubric; the two substantive changes are flagged in "What changed from v2" at the end.*

## What the rubric is for

A plan is a jointly-produced contract that keeps the agent from improvising outside the human's awareness — concrete enough to govern and check an agent's execution, open enough to be revised when the data push back. The rubric measures how well a plan does that job. It scores five channels, each on a 0–3 scale, where each channel is one place where authorship and control can leak from the human to the agent.

The score is never the deliverable. The rubric produces a diagnosis — a five-number profile, the biggest leak, and the specific open decisions to fix in the next revision. The point is to motivate a better plan, not to pass or fail one.

## The five channels

Each channel is scored 0–3. Judge on the anchors: a person or a model can defend "this is a 1, not a 2"; nobody can defend "this is a 73, not a 76." The precision lives in the anchors, not in a large point count.

### 1 · Goal and success

Is the target defined so a third party could check it, and is the whole plan visibly in service of it?

- **0** — No extractable objective or success criteria. Nothing says what the work is for or how success will be judged. This is a task list, not a plan.
- **1** — An objective is extractable, but the success criteria are implicit ("find significant predictors" — at what threshold? in which model?); or a goal is stated yet the plan reads as a backlog of actions not clearly in service of it.
- **2** — A goal plus partial criteria a reader could mostly check, and most steps trace back to the goal — but a consequential success condition is still implicit, or deferred without a rule.
- **3** — An objective plus success criteria a third party could check without asking the author (any deferred criterion is stated as a rule, not omitted), and every part of the plan is visibly in service of the goal.

### 2 · Decisions and reasons — the spine

Are the choices that change the outcome resolved with reasons that have real depth and connect to the project's research questions or goal?

This is the heaviest channel. It is scored from the plan itself — its decisions and the reasons attached to them. A good decision record stands on its own.

Two clarifications matter here. First, control is not the same as authorship. In real projects the human's control over a fork is often exercised by choosing among options, or by approving a proposed choice, not by writing the reason from scratch. All of these count fully. A coarse "keep all" over options the human genuinely chose is fine. What is scored is the quality of the reasoning on the page, not who first phrased it. Second, the failure the channel is looking for is a shallow reason, or one disconnected from the research goal — not the human choosing efficiently.

- **0** — Substantive choices with no reasons (an empty "why," or a reason that merely restates the choice); or a consequential fork the agent settled with no human choice at all.
- **1** — Each substantive choice has a stated reason, but the reasons are shallow or generic — they go no deeper than the choice itself and are not connected to the project's research questions or goal.
- **2** — Reasons are real and specific to this study, but some consequential forks carry thin reasons, or their link to the broader research goal is left implicit.
- **3** — Every consequential fork is settled with a reason that has genuine depth and is visibly connected to the project's research questions or goal. Nothing consequential rests on a shallow or disconnected rationale. An authored reason, a choice among options, an approval, and joint authorship all count as full control.

### 3 · Steps — can execution be checked?

Is the method concrete enough that "did the agent do this?" has an answer?

- **0** — No steps, or a one-line gesture. The method is improvised.
- **1** — A generic skeleton that fits any project of this type ("clean the data, run the model, report").
- **2** — Steps with some specifics, but a consequential context-specific step is missing or vague ("handle missing data" without saying how this data's missingness should be handled).
- **3** — Steps at a grain where "did the agent do this?" has an answer, with the non-obvious, outcome-affecting specifics surfaced. Interchangeable or standard steps are left appropriately open. A high-level approach may guide without determining — do not lower the score for a high-level framing when the build steps themselves are precise. Verbosity on trivia does not raise the score.

### 4 · Validation — can the plan test that it hit its goal?

Does the plan include tests or checks that let the agent (or the researcher) confirm the success criteria from channel 1 were actually met — not merely that code ran?

This is validation, not bare verifiability. A plan with no way to test whether it accomplished its goal fails this channel. It is separate from channel 3: channel 3 asks whether the agent did the steps; this channel asks whether the plan can tell that the goal was reached.

- **0** — No test of goal-accomplishment. Nothing in the plan would show whether the work met its success criteria.
- **1** — Checks are named, but they test the wrong thing (that a script ran, that a file exists) rather than whether the success criteria were met.
- **2** — Tests cover some success criteria but leave a consequential one untested.
- **3** — Concrete tests or checks — executable tests, data audits, citation validation, named outputs a human will review — that let the agent or researcher confirm each success criterion was actually met.

### 5 · Boundaries

Does the agent know how far to go and what to leave alone?

Where channel 1 fixes the target, this channel fixes the negative space — the stopping point and the blast radius. The improvisation it prevents is the classic agent failure: told to "improve the script," the agent rewrites the whole module.

- **0** — Nothing about limits. The agent decides on its own how far to go and what to touch.
- **1** — Extent is only inferable from the goal; nothing explicit about what is excluded or off-limits.
- **2** — Partial: either what is out of scope or what not to touch is stated, but not both.
- **3** — Both are stated: what is out of scope, and what to leave alone.

## Scoring and diagnosis

Sum the five channels for a 0–15 total, but read the profile, not the total. A missing channel must not hide behind a strong total: `3·3·3·0·3 = 12/15` is not "80% good," it is a plan with no validation. So the five-number profile is the headline, and any channel scoring 0 is flagged as a missing control channel. There is no band or headline percentage that lets one channel's strength cover another's absence.

For each plan, the rubric reports:

- The **profile** — e.g. `Goal 3 · Decisions 2 · Steps 2 · Validation 1 · Boundaries 0`.
- The **biggest leak** — the lowest channel, named as "where the most authorship is being handed to the agent."
- The **unresolved forks** — the specific open decisions dragging the score down. This is the fix-it list for the next revision.
- **One suggested move per leak.**

## What the rubric does not score

Three things sit outside the score but still matter. Naming where each went keeps them from silently disappearing.

- **Readability is a precondition, not a channel.** Before scoring, the reader checks that the five channels' content can be extracted at all. If it cannot, the plan is returned as "unscorable — fix readability first" rather than given a fabricated score. This is a narrow extractability gate, not style policing. Brevity and plain language are handled during authoring, not measured here.
- **Prospective and revisable are workflow-integrity flags, not scores.** Whether a plan was committed before its work, whether its retrospective sources hold up, and whether deviations were recorded are properties of how the plan is *held*, not of its content. They are surfaced as flags ("uncommitted," "unsupported sources," "unrecorded deviation") beside the profile, so a polished reconstruction with no dated evidence, or a plan followed by a silent deviation, is not quietly scored as strong. They diagnose process, not plan quality.
- **The revision trace is a separate analysis, not part of the score.** How much a plan improved across rounds of feedback measures responsiveness to that feedback, not the intrinsic quality of the final plan. It stays out of the per-plan score so the two do not contaminate each other. It is the right instrument for the research question ("does structured questioning improve plans?") — not for scoring a single plan.

The plan's basic requirements — that it has a goal, reasons, validation, and boundaries at all — are built in during authoring (the planning dialogue and the project conventions) rather than policed after the fact. The rubric grades quality, not existence.

## What changed from v2

- **Added Validation as its own channel.** v2 folded verification into the success-definition channel. Testing whether the goal was actually reached is load-bearing enough in research to stand alone, and separating it from "did the agent do the steps" makes both cleaner.
- **Reframed the spine to score depth and goal-connection, and to credit approval and joint authorship.** v2's spine asked whether the human's *authorship* of the reasons was visible. In practice, most consequential decisions in agent-assisted research are settled by the human choosing among options or approving a proposal, not by authoring the reason. The reframed channel scores the depth of the reasoning and its connection to the research goal, and treats an authored reason, an informed choice, an approval, and joint authorship as equally full control. The evidence for this is below.
- Everything else tracks v2: the 0–3 anchors, readability as a precondition, prospective/revisable moved out of the score, and the revision trace kept separate.

## Methods note for the empirical claim

The reframe of channel 2 rests on an informal review of how decisions were actually settled across 14 research projects that used this workflow (the richest being `ai_reliance`, `meetup-chicago`, and `ai-network-survey`). The coding unit was a "consequential decision moment" — a choice that would change the analysis or its interpretation. Roughly half of these were the agent proposing an option with a rationale and the human selecting or approving it; only about a fifth were reasons the human authored unprompted; the rest were jointly constructed or flagged agent-defaults. This is a single-coder pass over the decision logs and transcripts, not an inter-rater–reliability study, so treat the proportions as directional evidence for the design choice rather than as a measured result. The sharpest observation from the review: a record where the human accepted a well-reasoned proposal and one where the human rubber-stamped a generic default often read *identically* on the page — which is why the channel scores the depth and goal-connection of the reasoning, the part that actually differs, rather than who first phrased it.
