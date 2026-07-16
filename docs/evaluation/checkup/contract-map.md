# Contract map — rules stated in ≥2 places

Every shared rule/schema/invariant, with its locations and an agree/drift verdict. Raw searches saved under `searches/`. A `drift` row is filed as a coherence finding in the Task-6 sweep; an `agree` row that is heavily restated is a *consolidation candidate* (token/maintainability), weighed against whether the restatement is load-bearing.

## Verdicts

### board lifecycle — **DRIFT** (headline coherence finding)
- `docs/reference.md:50` (user-facing): "your session applies each action and **the board refreshes itself** with the updated state. **After an idle hour it goes to sleep**; `/research-plans:board` wakes it."
- `commands/board.md:15`: "the live board … has **no idle timeout** … When the researcher submits an action, the board hands the work to you and **closes** … you do **not** relaunch it."
- `commands/board.md:22`: "Live serving no longer times out on its own … a plain live board **never sleeps**."
- **Verdict: drift.** `reference.md` describes the pre-v0.18 lifecycle (refresh-in-place + idle-sleep); the shipped v0.18 behavior is close-on-action + no-idle-timeout. The user-facing doc contradicts the shipped behavior. → coherence finding, proposed fix: update `reference.md:50`.

### model-nudge paragraph — **AGREE, duplicated ×3 (load-bearing variation)**
- `SKILL.md:27` (execute stage), `commands/plan.md:9` (plan stage, **+ effort clause**), `commands/sync.md:8` (sync stage). The core sentence "Model profile: this stage is set to <model>; you're on <current>. Switch with /model <model> …" is **verbatim** across all three.
- **Verdict: agree.** The shared sentence is identical; the surrounding logic differs per stage (SKILL uses the `execute` row and a different intro; plan.md appends `, effort <level>` handling; sync.md is the terse form). Consolidation candidate (a shared snippet with a stage parameter), but plan.md's effort clause is load-bearing — a naive merge would drop it. Risk = future drift of the shared sentence across three files.

### initialized-project gate — **AGREE, restated ×8 (2 phrasings)**
- Exact phrase "Requires an initialized project … if `plans/master-plan.md` is absent, say so and stop": `review.md:7`, `adopt.md:9`, `plan.md:7`, `sync.md:6`, `models.md:6`, `results.md:7`, `report.md:7` (7).
- Variant phrasing "Requires `plans/master-plan.md` with its marker; if absent … Stop": `board.md:9` (1).
- Not gated: `init.md` (creates it), `renew.md:9` (handles the uninitialized case).
- **Verdict: agree** (confirms codex: **8** gating commands, not 7 — my earlier grep missed board.md's variant phrasing). Consolidation candidate: a shared "requires-init" preamble; low risk since it is a simple guard.

### substantive-finding rule — **AGREE, documented Python/TS duplicate**
- `results.py:180` `is_substantive` + comment `:185` "Python/TypeScript duplication — change both".
- `board/src/lib/findings.ts:14` `isSubstantive` + comment `:12` "Kept in sync with results.py `is_substantive`".
- `report.md:11` states the rule in prose (the null-result gate).
- **Verdict: agree** (self-documented hand-sync). SKILL.md is correctly **not** in the set (confirms the spec §9 correction). Risk = future drift between the two languages; **scenario S8 validates they currently agree** and is the standing guard. No consolidation possible (two languages) — the mitigation is the parity test, not a shared source.

### scorecard schema (v3, five channels) — **AGREE (single source + references)**
- `references/plan-rubric.md:74` names the shape and says "see `templates/review-scorecard.md` for the exact shape".
- `templates/review-scorecard.md:33,50` carries the canonical JSON (scored + unscorable).
- `templates/agents/rp-plan-reviewer.md:10,19` emits exactly that shape; `commands/review.md` validates it.
- **Verdict: agree.** Deliberate single-source-with-references (rubric → template → agent → command). Channels `goal/decisions/steps/validation/boundaries`, `status` scored|unscorable, consistent everywhere. No drift.

### sign-off / ticket rules — **AGREE (source of truth + consumers)**
- `signoff_gate.py:32` `TICKET_PREFIX = ".import-approved-"`; `:230` forgery guard (agent-written tickets denied).
- `board.md:32-33` (consumer): the ticket path + "NEVER hand-write a ticket … the hook denies agent-written tickets as forgery".
- `SKILL.md:46`, `plan.md:30` describe the gate/ticket/timeout/`--gate-batch`/`RESEARCH_PLANS_NO_GATE` flow consistently.
- **Verdict: agree.** signoff_gate.py is the enforcement source; the prose consumers match it. Scenario S2 validates the forgery-denial at runtime.

### provenance rule (planned vs retrofit) — **AGREE, heavily restated**
- `SKILL.md:42,51` ("Retrospective work is retrofit, never planned"), `results.md:19` (the full rule inline in the manifest-writing step), `results.md:32` (reconcile mode), `report.md:15`.
- **Verdict: agree.** Consistent everywhere, but the full rule is near-duplicated between SKILL.md:51 and results.md:19. Consolidation candidate, but results.md needs it inline at the manifest-writing step (load-bearing there). Scenario S16 validates honest stamping.

## Summary
- **1 drift** (board lifecycle → `reference.md:50`) — a real coherence finding.
- **6 agree**, of which 4 are consolidation candidates (model-nudge ×3, init-gate ×8, provenance restatement, and — no-consolidation-possible — the substantive Py/TS duplicate guarded by S8). Each consolidation is weighed in synthesis against load-bearing local variation.
