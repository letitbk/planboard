Overall, the four-phase scaffold is useful, but the design is not yet capable of supporting its strongest claims. The central problem is that it treats files as the unit of audit. The plugin’s important behavior lives in workflows, state transitions, and trust boundaries that cross several files.

## 1. Feasibility and soundness issues

Ordered by severity:

1. **High: “Read every file exactly once” is internally impossible and risks incomplete conclusions.**

   Phase 0 is described as mechanical, but the contract map must find “every rule, schema, or invariant” and issue an “agree/drift verdict” before the deep read begins ([spec §5](/Users/bk/github/research-plans/docs/specs/2026-07-15-plugin-checkup-design.md:77)). That already requires semantic reading and judgment. Phase 1 then reads every surface again, and Phase 2 explicitly rereads `board.py`, `signoff_gate.py`, `results.py`, and the web template “as an adversary” ([spec §7.3](/Users/bk/github/research-plans/docs/specs/2026-07-15-plugin-checkup-design.md:106)).

   This is more than an efficiency problem. It encourages trusting Phase 0 maps as “ground truth” even though those maps cannot establish behavioral completeness. A current example is the live-board lifecycle: [docs/reference.md](/Users/bk/github/research-plans/docs/reference.md:50) says the board refreshes after an action and sleeps after an idle hour, while [commands/board.md](/Users/bk/github/research-plans/commands/board.md:15) says it closes after an action and has no idle timeout. [board.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1392) confirms the command, not the reference. Catching this requires semantic comparison and runtime ownership tracing, not merely a cross-reference scan.

2. **High: the token methods cannot answer all the questions the design assigns to them.**

   Static bytes divided by four is useful for relative size. Summing an entire `/plan` → reviewer → board chain is not a measurement of one context, however. The reviewer may run in a separate subagent context ([review.md](/Users/bk/github/research-plans/commands/review.md:11)), while later commands add or replace context independently. The proposed number conflates:

   - cumulative instruction text across the workflow;
   - peak context pressure in one model invocation;
   - cached versus uncached input;
   - main-session versus subagent input;
   - billed input versus text merely present in a source file.

   Those should be separate metrics.

   Section 7.4 also promises “instruction tokens vs. data tokens vs. model output” from session transcripts. Claude’s documented headless JSON usage provides input, output, and cache accounting, but not a semantic split of input into instructions and project data ([official headless documentation](https://code.claude.com/docs/en/headless)). That split requires controlled prompt instrumentation or paired runs, not transcript parsing alone.

3. **High: the clean-room probe is not a valid test of the interactive user experience or an attributable environment effect.**

   A single clean run and a single author-environment run are vulnerable to normal model variation. A difference in tone or verbosity cannot safely be attributed to the environment without repeated paired trials or a controlled replay. This is an inference, but it follows directly from the proposed one-run comparison in [§7.1](/Users/bk/github/research-plans/docs/specs/2026-07-15-plugin-checkup-design.md:102).

   More importantly, the commands depend heavily on interactive questions. `/init` has two explicit `AskUserQuestion` stages ([init.md](/Users/bk/github/research-plans/commands/init.md:21)), and the existing [friction log](/Users/bk/github/research-plans/docs/evaluation/friction-log.md:41) already records that bare headless `/init` asks questions and exits with no artifacts. Seeding all answers makes the harness finish, but then it no longer tests discovery, interview burden, permission handling, or recovery as a new interactive user experiences them.

4. **High: important executable surfaces and the existing verification baseline are absent.**

   The stated inventory omits:

   - [.claude-plugin/plugin.json](/Users/bk/github/research-plans/.claude-plugin/plugin.json:1) and the marketplace manifest;
   - [hooks/hooks.json](/Users/bk/github/research-plans/hooks/hooks.json:1), which actually registers both security-relevant hooks;
   - seven Python test suites totaling about 5,000 lines;
   - 34 board UI test files and seven web-template test files;
   - an explicit test, build, and type-check baseline.

   This matters because the sign-off guarantee is partly a manifest-level contract. The hook matcher covers only `Write|Edit` ([hooks.json](/Users/bk/github/research-plans/hooks/hooks.json:3)), and the documentation explicitly acknowledges that shell redirection is outside that boundary ([reference.md](/Users/bk/github/research-plans/docs/reference.md:93)). Auditing `signoff_gate.py` without its registration and documented boundary is incomplete.

5. **Medium: the verification stage lacks explicit oracles.**

   Section 8.2 says top findings will be independently and adversarially verified, but does not define the reproducer, expected result, environment, number of runs, or what “independently” means ([spec §8.2](/Users/bk/github/research-plans/docs/specs/2026-07-15-plugin-checkup-design.md:120)). File-and-line evidence is enough for static drift. It is not enough for prompt effectiveness, intermittent behavior, environment effects, or UX claims.

## 2. Blind spots

1. **Workflow and state-transition correctness.**

   The maps cover duplicated prose and references, but not lifecycle invariants such as:

   - board order → durable feedback → route → acknowledge;
   - draft → ticket → signed version;
   - results staging → finalize → verdict → report;
   - hosted comment → inbox → route → pulled-state update;
   - model-profile save → generated agent update.

   These are the seams most likely to produce data loss, stale state, or double application. For example, `board.py` maintains its own payload file traversal ([board.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:199)), mirrored by TypeScript `allFiles()` ([parse.ts](/Users/bk/github/research-plans/board/src/lib/parse.ts:442)). The substantive-finding contract is similarly hand-synchronized between [results.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/results.py:180) and [findings.ts](/Users/bk/github/research-plans/board/src/lib/findings.ts:9). A string-level contract map helps, but only scenario tests prove that cross-language consumers behave identically.

2. **Accessibility, keyboard, touch, zoom, and narrow-screen behavior.**

   The UX probe does not state accessibility or viewport coverage. The annotation composer begins from `onMouseUp` ([AnnotationLayer.tsx](/Users/bk/github/research-plans/board/src/components/AnnotationLayer.tsx:79)), while several primary views use fixed `w-56` sidebars, for example [PlanReader.tsx](/Users/bk/github/research-plans/board/src/views/PlanReader.tsx:266) and [Results.tsx](/Users/bk/github/research-plans/board/src/views/Results.tsx:419). The header also packs tabs and actions into a single flex row ([App.tsx](/Users/bk/github/research-plans/board/src/App.tsx:1012)).

   This does not prove a UI defect. It does show that one ordinary Playwright walkthrough cannot clear the risks. Keyboard-only, touch, 200% zoom, and narrow viewport scenarios are needed.

3. **Interactive workflow burden.**

   The “not re-litigating shipped design decisions” boundary ([spec §11](/Users/bk/github/research-plans/docs/specs/2026-07-15-plugin-checkup-design.md:151)) could exclude legitimate UX findings about the number and timing of interviews, mandatory board hops, sign-off ceremony, or recovery burden. The existing friction log already records about 15 minutes for five scripted stages before results or board were reached ([friction-log.md](/Users/bk/github/research-plans/docs/evaluation/friction-log.md:42)). A workflow can implement its intended design perfectly and still impose material friction.

4. **Prompt-level and tool-level security.**

   The adversarial pass concentrates on runtime code, but the command prompts define authority, tool access, and untrusted-input handling. For example, `/board` grants external reviewer and deployment tools in frontmatter ([board.md](/Users/bk/github/research-plans/commands/board.md:4)) and contains the confused-deputy routing rules ([board.md](/Users/bk/github/research-plans/commands/board.md:24)). Those should be inside the security pass, not left to a general prompt-coherence read.

   A concrete candidate the proposed security surface could miss is secret handling: [board.md](/Users/bk/github/research-plans/commands/board.md:80) recommends `printf '<value>' | npx vercel env add ...`. Although the value is not a Vercel CLI argument, it is still embedded in the Bash tool invocation and therefore potentially the session transcript. This needs verification and threat-model treatment, not an immediate vulnerability conclusion.

5. **Privacy, retention, and authorization policy.**

   Hosted publishing always includes the full board ([board.md](/Users/bk/github/research-plans/commands/board.md:88)); comments persist indefinitely until explicitly cleared ([board.md](/Users/bk/github/research-plans/commands/board.md:100)); and hosted login cookies last 30 days ([auth.ts](/Users/bk/github/research-plans/skills/managing-research-plans/assets/web-template/lib/auth.ts:4)). These may all be intended. The audit nevertheless needs to judge data minimization, collaborator offboarding, retention, and disclosure boundaries, not only whether authentication technically holds.

6. **Installation, upgrade, and supply-chain portability.**

   Starting with the plugin already installed skips marketplace discovery, installation, restart requirements, update behavior, pinning, and uninstall/reinstall recovery. The dependency inventory also classifies availability but not version reproducibility or dependency/update trust. For example, the SessionStart hook fetches metadata from GitHub `main` ([check_update.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/check_update.py:145)), while web publishing invokes `npx vercel` through the command workflow.

7. **Transcript-mining governance.**

   Section 7.4 does not specify which research repositories may be mined, whether prompts or tool outputs can contain sensitive data, how records are redacted, or whether only aggregates may enter `docs/evaluation/checkup/`. That is a real omission because the proposed source is “real session transcripts.”

## 3. Scoping, contradiction, or sequencing problems

- Phase 0 is called “mechanical, before any judgment,” but `agree/drift` verdicts and dependency classifications are judgments.

- Phase 1 says the sweep “does not rank,” yet every raw record receives a P0/P1/P2 severity ([spec §6](/Users/bk/github/research-plans/docs/specs/2026-07-15-plugin-checkup-design.md:88)). Severity assignment is ranking, even if final ordering waits.

- The threat model is produced during the adversarial pass. Assets, actors, authority sources, and trust boundaries should be written first, then used to select adversarial cases.

- “Not re-litigating shipped design decisions” conflicts with a comprehensive UX and token audit. The boundary should exclude feature ideation, not evidence that an intended workflow is confusing, costly, or unsafe.

- The severity scheme is category-biased. P0 covers broken/security, P1 covers token/friction, and P2 covers drift/polish. It has no clear treatment for likely data loss, incorrect state, privacy exposure, or serious reliability failure short of total breakage. Severity should use impact, likelihood, reach, and confidence.

- One clean environment and no OS matrix is a reasonable budget boundary, but the resulting claim must be “fresh configuration on this Claude Code version and OS,” not general random-user portability. The commands contain shell-specific assumptions such as `/dev/null` ([board.md](/Users/bk/github/research-plans/commands/board.md:46)) and `set -o pipefail` ([results.md](/Users/bk/github/research-plans/commands/results.md:44)).

- The audit names the intended snapshot as v0.18.0 at commit `60eaede` ([spec header](/Users/bk/github/research-plans/docs/specs/2026-07-15-plugin-checkup-design.md:3)), which is good. The harness must actually install or check out that immutable snapshot rather than whatever local `main` contains when the audit runs.

## 4. Honesty check on preliminary findings

The section is honestly labeled as hypotheses, but several supporting “measurements” are stated too confidently and are wrong.

| Preliminary observation | Verdict |
|---|---|
| `board.md` is 34,825 bytes and steps 10–14 are “roughly half” | File size is correct. Steps 10–14 are about 11,580 bytes, roughly 33%, not half. Conditional extraction is still a plausible candidate. |
| Always-on cost is “only” 1,491 bytes / 372 tokens | Incomplete. The managing-research-plans skill has another 603-byte discovery description in [SKILL.md](/Users/bk/github/research-plans/skills/managing-research-plans/SKILL.md:3). Claude Code loads skill descriptions for discovery even when the body is not invoked ([official skill documentation](https://code.claude.com/docs/en/slash-commands)). Using the spec’s own approximation, the known description floor is about 2,094 bytes or 524 tokens. |
| “Tightening the three wordiest” descriptions | It lists four. The byte counts themselves are correct: renew 217, adopt 211, results 209, report 195. |
| Initialized-project gate appears in seven commands | It appears in eight: adopt, board, models, plan, report, results, review, and sync. Init and renew are the two exceptions. |
| Model-nudge paragraph is near-verbatim | Supported by [plan.md](/Users/bk/github/research-plans/commands/plan.md:9), [sync.md](/Users/bk/github/research-plans/commands/sync.md:8), and [SKILL.md](/Users/bk/github/research-plans/skills/managing-research-plans/SKILL.md:27). Local differences such as stage, timing, and effort handling may be load-bearing, so the proposed caution is honest. |
| Substantive-finding rule is a Python/TypeScript duplicate | Supported and explicitly documented in both implementations. However, the Phase 0 seed overstates the duplicate set by including `SKILL.md`; the exact rule is present in `results.py`, `findings.ts`, and command prose such as [report.md](/Users/bk/github/research-plans/commands/report.md:11), not in `SKILL.md`. |
| Cross-file step references may be stale | Honest as a hypothesis. The checked references currently resolve, so no stale pointer should be filed without further evidence. |
| `token_ok` comment is stale, code is correct | Correct. The stale comment is at [board.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:867), and enforcement is at [board.py](/Users/bk/github/research-plans/skills/managing-research-plans/scripts/board.py:1216). |
| Headless `/init` may dead-end | Honestly framed and already supported by [friction-log 1.1](/Users/bk/github/research-plans/docs/evaluation/friction-log.md:41) plus current `AskUserQuestion` instructions. |
| `codex`/`agy` lack availability guards | Supported by [board.md](/Users/bk/github/research-plans/commands/board.md:44). Whether the resulting failure is acceptably handled remains a proper probe question. |
| Two sidebar documents are untracked | Correct in the present worktree. This is housekeeping, not an audit finding, as the spec says. |

## 5. Single highest-leverage improvement

**Make the unit of audit a workflow invariant or user scenario, not a file.**

Add one Phase 0 coverage-and-evidence matrix that drives every later phase. Each row should name:

- the scenario or invariant;
- all owning surfaces;
- the expected observable result;
- static evidence;
- the required probe and fixture;
- a pass/fail oracle;
- environment and version;
- result, confidence, and finding ID.

Representative rows would cover draft → sign-off → review → board, results → finalize → verdict → report, hosted comment → pull → route → acknowledge, model-profile edit → agent regeneration, and full-board publish → collaborator access.

Keep Instrument → Sweep → Probe → Synthesize, but drop the one-read constraint and permit targeted rereads. This single change would expose missing hooks and tests, make probes causal and reproducible, prevent file-local conclusions about cross-file behavior, and give every final finding an actionable reproducer.

## 6. Open questions

1. Does “not re-litigating shipped design” permit findings that the intended workflow itself creates excessive ceremony or confusion?

2. Which token outcome is primary: cumulative workflow input, peak context occupancy, uncached billed tokens, cache-read tokens, or all four separately?

3. Must the clean-room audit represent an interactive novice, a scripted headless user, or both?

4. What exact Claude Code version, permission mode, OS, and immutable plugin checkout define the clean-room environment?

5. Are accessibility, mobile/touch behavior, privacy/retention, least privilege, and dependency/update trust explicitly in scope?

6. Which real transcripts may be mined, and what redaction, aggregation, retention, and consent rules apply?