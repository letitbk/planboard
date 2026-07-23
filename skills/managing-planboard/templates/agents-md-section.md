## Planboard workflow (codex handoff)

You are operating in a project that uses the **planboard** research workflow. Follow planboard's discipline: plan before executing, one committed execution plan per component, honest provenance. You are trusted to follow these rules — nothing here is a security boundary; the enforced sign gate runs in a Claude session (below).

Read these planboard reference files by absolute path before working (if any is missing, STOP and tell the researcher to rerun `/planboard:handoff` — your paths are stale):
- Planning doctrine: `{{SKILL_DIR}}/references/planning-doctrine.md`
- Plan template: `{{SKILL_DIR}}/templates/execution-plan.md`
- Execution loop: `{{SKILL_DIR}}/references/execution-loop.md`
- Sign-off contract: `{{SKILL_DIR}}/references/sign-off.md`
- Rubric: `{{SKILL_DIR}}/references/plan-rubric.md`, split criteria: `{{SKILL_DIR}}/references/split-criteria.md`
- Loop delegates to these command specs — read the one for the step you are on: results capture `{{SKILL_DIR}}/../../commands/results.md`, report `{{SKILL_DIR}}/../../commands/report.md`, amendments `{{SKILL_DIR}}/../../commands/sync.md`, board `{{SKILL_DIR}}/../../commands/board.md`, review `{{SKILL_DIR}}/../../commands/review.md`

Run planboard's stdlib scripts by absolute path (python3):
- `{{SKILL_DIR}}/scripts/models.py stage <plan|execute|sync>` — the per-stage model row
- `{{SKILL_DIR}}/scripts/results.py stage|finalize` — capture a results bundle (staging + atomic rename); never write into a bundle directory by hand
- `{{SKILL_DIR}}/scripts/board.py` — the board (read-only viewing / sign server)

The loop:
1. Author the execution plan per the plan template and doctrine. Make the very first line the provenance marker `<!-- pb-model {"prescribed":P,"reported":{"model":"{{CODEX_MODEL}}","effort":null}} -->`, where `P` is the `plan` row from `models.py stage plan` as `{"model":...,"effort":...}` or `null`. Carry this line UNCHANGED into every draft snapshot and the final version — it is hashed at sign-off and cannot be added afterward.
2. Hand off to the researcher for review and signing IN A CLAUDE SESSION: `/planboard:review` then `/planboard:sign`. Signing is a browser-approved, hook-enforced human commitment that only Claude can perform. Do not append a `Signed off:` trailer yourself and do not write the signed `vN.md`.
3. After the plan is signed, execute the analysis under it per the execution loop. Do not modify the signed plan or any finalized results bundle.
4. Capture results with `results.py stage` then `results.py finalize`.

Provenance note: `{{CODEX_MODEL}}` is recorded as the reporting model (self-attested, as planboard treats all reported models). The board will show it as differing from a Claude-prescribed profile — that is correct and expected.
