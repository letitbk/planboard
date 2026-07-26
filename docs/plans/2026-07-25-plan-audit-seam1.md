# Plan audit channel — seam 1 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the audit machinery and its board surface, so every plan draft gets an automatic repository-grounded audit whose findings are visible beside the rubric score.

**Architecture:** A new stdlib-only `audit.py` owns hashing, context identity, locked atomic artifact writes, and Codex dispatch. `models.py` gains a `reviewer` mechanism, a `plan-audit` stage, and a self-healing migration. The board gains a `board-audit` fence parser and an `AuditPanel` rendered beside the existing `ScorePanel`. Findings live in that panel; nothing gates yet.

**Tech Stack:** Python 3 standard library only (no new dependencies), React + TypeScript + Tailwind for the board, `unittest` for Python tests, `vitest` for board tests.

**Source spec:** `docs/specs/2026-07-24-plan-audit-channel-design.md` (revised 2026-07-25 after Codex review).

**Revision:** Re-cut on 2026-07-25 after a Codex review of the first draft found 6 crashing defects, 13 weak or failing tests, 19 broken existing tests, and a task order whose suite could not go green. Revised again the same day after a second Codex round found 8 more, including an `UnboundLocalError` that would have broken Task 1 at its first step and with it the atomicity the re-cut was built on. See "Why the task boundaries are cut this way" below.

## Scope

Seam 1 only, in 13 tasks: the audit service, the contract, `pb-plan-auditor`, the profile row and its migration, the artifact, the audit panel, the manual reviewer repoint, and the release. Seam 2 (currency pre-flight at the gates, in-transaction revalidation inside `sign_lock`, blocker dispositions, decision-log entries) is a separate plan. After this plan, audits run and are visible; nothing blocks and no disposition is collected.

## Why the task boundaries are cut this way

Adding a seventh stage to `STAGE_LABELS` is not a local change. `board.py:_validate_profile_rows` derives its required stage set from `STAGE_LABELS` (`board.py:575`) and demands an exact bijection (`board.py:602-603`), so the moment the constant changes, every model-profile save returns HTTP 400. `board/src/lib/types.ts:60` types `mechanism` as `"nudge" | "agent"`, so a migrated profile breaks the Models view's types. Nine tests in `tests/test_models.py` and two in `tests/test_board.py` assert the six-stage shape directly.

**Task 1 therefore lands all of that at once** — constant, server validator, board types, view, template, and every affected existing test — because there is no intermediate state where the suite is green. It is deliberately the largest task in this plan. Splitting it is the mistake the first draft made.

One consequence worth knowing: `rewrite_rows` skips any stage absent from `edits` (`models.py:228`), so narrowing the server's canonical set to the *editable* stages preserves the reviewer row verbatim on every save. That keeps the eight POST tests in `tests/test_board.py:2942-3106` passing untouched. Only the two row-count tests need updating.

## Global Constraints

- **Python: standard library only.** Every existing script in `skills/managing-planboard/scripts/` is stdlib-only. Do not add dependencies.
- **Board: no new npm dependencies.** Use the existing React + Tailwind idiom.
- **`npm run build` runs only in Task 13, and twice there.** `AGENTS.md:31-33` requires that any change under `board/src/` be followed by `cd board && npm run build` with the regenerated `skills/managing-planboard/assets/board-template.html` committed, then a second build whose diff for that template must be clean. Tasks 8-12 therefore leave the template stale on purpose. Do not run the build in any other task: it rewrites a tracked 460KB artifact and will pollute an unrelated commit.
- **The repository's own validation command is `python3 -m pytest tests/ -q`** (`AGENTS.md:23`), which Task 13 runs. Individual tasks may use `python3 -m unittest` for speed while iterating on one module, but a task is not done until the pytest command and both board commands pass.
- **Explicit `git add <paths>` on every commit.** Never `git add .`, `git add -A`, or `git commit -a`.
- **The auditor is read-only** against the repository: `codex exec --sandbox read-only`. A review must never mutate the repo.
- **Reviewer tokens:** `codex-sol`, `codex-terra`, `codex-luna`, `subagent`. `gemini-pro` is deliberately absent (its board path has no repository access).
- **Severity tags** are exactly `[blocker]`, `[major]`, `[minor]`.
- Python tests run with `python3 -m unittest tests.<module> -v` from the repo root. Board tests run with `npx vitest run <file>` from `board/`.
- Full suites before any task is considered done: `python3 -m unittest discover -s tests` and, in `board/`, `npm test` plus `npx tsc --noEmit`.

---

### Task 1: The profile change, atomically

Everything that must move together when `STAGE_LABELS` gains a seventh entry.

**Files:**
- Modify: `skills/managing-planboard/scripts/models.py:23-58` (constants) and the row-validation branch at `models.py:103-126`
- Modify: `skills/managing-planboard/scripts/board.py:570-604` (`_validate_profile_rows`)
- Modify: `skills/managing-planboard/templates/model-profile.md`
- Modify: `board/src/lib/types.ts:55-61`
- Modify: `board/src/views/Models.tsx:35-44` (`DraftRow`), `:62-70` (`MechChip`), `:173` (`allValid`), `:294-303` (the notice), and the row render
- Modify: `tests/test_models.py:34`, `:414`, `:472`
- Modify: `tests/test_board.py:2835`, `:2875`
- Test: `tests/test_models.py` (new `TestReviewerMechanism`), `board/src/views/Models.reviewer.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: stage key `"plan-audit"`, mechanism `"reviewer"`, `models.REVIEWER_TOKENS`, `models.EDITABLE_STAGES`. Task 2 reads `EXPECTED_MECHANISM["plan-audit"]`; Task 3 reads `STAGE_LABELS`; Task 7 reads the row via `models.load_profile`.

- [ ] **Step 1: Write the failing Python tests**

Append to `tests/test_models.py`:

```python
class TestReviewerMechanism(unittest.TestCase):
    def _profile(self, model="codex-sol", effort="xhigh", mech="reviewer"):
        return DEFAULT_PROFILE.replace(
            "| plan audit (deep) | codex-sol | xhigh | reviewer |",
            "| plan audit (deep) | %s | %s | %s |" % (model, effort, mech),
        )

    def test_default_template_parses_with_seven_stages(self):
        stages, warnings = models.parse_profile(DEFAULT_PROFILE)
        self.assertEqual(warnings, [])
        self.assertEqual(len(stages), 7)
        self.assertEqual(stages["plan-audit"]["model"], "codex-sol")
        self.assertEqual(stages["plan-audit"]["effort"], "xhigh")
        self.assertEqual(stages["plan-audit"]["mechanism"], "reviewer")

    def test_default_template_is_canonical(self):
        stages, warnings = models.parse_profile(DEFAULT_PROFILE)
        self.assertTrue(models.profile_canonical(stages, warnings))

    def test_reviewer_row_accepts_every_token(self):
        for token in sorted(models.REVIEWER_TOKENS):
            stages, warnings = models.parse_profile(self._profile(model=token))
            self.assertEqual(warnings, [], token)
            self.assertEqual(stages["plan-audit"]["model"], token)

    def test_reviewer_row_rejects_a_claude_alias(self):
        stages, warnings = models.parse_profile(self._profile(model="opus"))
        self.assertNotIn("plan-audit", stages)
        self.assertTrue(warnings)

    def test_reviewer_row_rejects_gemini(self):
        stages, _ = models.parse_profile(self._profile(model="gemini-pro"))
        self.assertNotIn("plan-audit", stages)

    def test_agent_row_rejects_a_reviewer_token(self):
        p = DEFAULT_PROFILE.replace(
            "| plan review (verdict + grade) | opus | medium | agent |",
            "| plan review (verdict + grade) | codex-sol | medium | agent |",
        )
        stages, _ = models.parse_profile(p)
        self.assertNotIn("plan-review", stages)

    def test_flipped_mechanism_is_non_canonical(self):
        # model MUST be a valid Claude alias here, or the row is dropped as an
        # invalid model before profile_canonical ever sees its mechanism.
        stages, warnings = models.parse_profile(self._profile(model="opus", mech="agent"))
        self.assertIn("plan-audit", stages)
        self.assertFalse(models.profile_canonical(stages, warnings))

    def test_editable_stages_excludes_the_reviewer_stage(self):
        self.assertNotIn("plan-audit", models.EDITABLE_STAGES)
        self.assertEqual(len(models.EDITABLE_STAGES), 6)

    def test_stage_cli_returns_the_audit_row(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                models.main(["--root", str(root), "stage", "plan-audit"])
            self.assertIn("codex-sol", out.getvalue())
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m unittest tests.test_models.TestReviewerMechanism -v`
Expected: FAIL — the template has no `plan audit (deep)` row, so `assertEqual(len(stages), 7)` gets 6

- [ ] **Step 3: Change the constants**

In `models.py`, extend the block at lines 23-58:

```python
STAGE_LABELS = {
    "plan": "plan",
    "execute": "execute",
    "sync": "sync",
    "plan review": "plan-review",
    "results validation": "results-validation",
    "board reviewer panel": "board-reviewer",
    "plan audit": "plan-audit",
}
```

The key is `"plan audit"`, not `"plan audit (deep)"`. `_norm` (`models.py:85-86`) runs `re.sub(r"\([^)]*\)", "", cell)` before lowercasing, so the row's first cell normalizes to `plan audit` — the same mechanism that already maps `plan review (verdict + grade)`.

```python
# Reviewer tokens name WHO audits, not a Claude model. `gemini-pro` is
# deliberately absent: the board's Gemini path is self-contained and has no
# repository access, so it cannot ground an audit, and shipping the token
# would produce confident ungrounded audits that read like grounded ones.
REVIEWER_TOKENS = {"codex-sol", "codex-terra", "codex-luna", "subagent"}
MECHANISMS = {"nudge", "agent", "reviewer"}
EXPECTED_MECHANISM = {
    "plan": "nudge",
    "execute": "nudge",
    "sync": "nudge",
    "plan-review": "agent",
    "results-validation": "agent",
    "board-reviewer": "agent",
    "plan-audit": "reviewer",
}
# Stages the board's Models editor may write. A reviewer row holds a token, not
# a Claude model, so the editor's vocabulary cannot express it; the server
# preserves such rows from the base text instead (rewrite_rows skips any stage
# absent from `edits`, models.py:228).
EDITABLE_STAGES = frozenset(
    k for k, m in EXPECTED_MECHANISM.items() if m != "reviewer"
)
```

- [ ] **Step 4: Reorder the row parser, then branch model validation on mechanism**

**The mechanism must be parsed BEFORE the model.** Today the parser assigns `model` at `models.py:110` and validates it at `:111`, but does not assign `mech` until `:120`. A mechanism-dependent model check written in place would reference `mech` before assignment and raise `UnboundLocalError` on the very first recognized row, erroring roughly forty tests across `test_models.py`, `test_board.py`, and `test_results.py`.

So move the mechanism block above the model block. Read `models.py:103-126` first and keep every existing warning string byte-identical; only the order changes. The resulting sequence, after the stage-key and duplicate checks:

```python
    mech = raw_mech.strip().lower()
    if mech not in MECHANISMS:
        warnings.append(
            f"model-profile: skipping row {rownum} (unknown mechanism {raw_mech!r})"
        )
        return
    model = raw_model.strip().lower()
    if mech == "reviewer":
        if model not in REVIEWER_TOKENS:
            warnings.append(
                f"model-profile: skipping row {rownum} — {model!r} is not a reviewer "
                f"token (expected one of {', '.join(sorted(REVIEWER_TOKENS))})"
            )
            return
    elif model not in MODEL_ALIASES and not MODEL_ID_RE.match(model):
        warnings.append(f"model-profile: skipping row {rownum} (unknown model {raw_model!r})")
        return
    effort = raw_effort.strip().lower()
    if effort in NO_EFFORT:
        effort = None
    elif effort not in EFFORT_LEVELS:
        warnings.append(f"model-profile: skipping row {rownum} (unknown effort {raw_effort!r})")
        return
    stages[key] = {"stage": key, "model": model, "effort": effort, "mechanism": mech}
```

One behavioural consequence to accept deliberately: a row with BOTH an unknown mechanism and an unknown model now warns about the mechanism rather than the model. No existing test asserts that pairing, but if one surfaces, the new order is correct — the mechanism decides which model vocabulary applies, so it must be resolved first.

Also update `profile_canonical`'s docstring (`models.py:170-176`), which says "exactly the six canonical stages" and describes every stage as a Claude-model stage.

- [ ] **Step 5: Add the row to the template**

In `skills/managing-planboard/templates/model-profile.md`, append to the table:

```
| plan audit (deep) | codex-sol | xhigh | reviewer |
```

Change the opening sentence from "How each planboard stage picks a Claude model" to "How each planboard stage picks its model or reviewer", and add a third mechanism after **agent**:

> **reviewer**: this stage runs an independent auditor rather than a Claude model. The model cell holds a reviewer token (`codex-sol`, `codex-terra`, `codex-luna`, or `subagent`), the effort cell applies to whichever reviewer runs, and the row is edited with `/planboard:models` rather than on the board.

Append to the "Why these defaults" paragraph:

> The plan audit is the one stage deliberately run by a different model family. Its whole value is that an independent auditor sees what the model that wrote the plan cannot, so it defaults to Codex at `xhigh`.

- [ ] **Step 6: Narrow the server's canonical set**

In `board.py:_validate_profile_rows`, line 575 becomes:

```python
    canonical = set(models.EDITABLE_STAGES)
```

and the completeness check at line 602-603 becomes:

```python
    if set(edits) != canonical:
        return None, "expected exactly the six editable stages"
```

Nothing else in `apply_model_profile` changes: `rewrite_rows` already leaves the reviewer row's bytes untouched because its stage is absent from `edits`.

- [ ] **Step 7: Update the three existing `test_models.py` expectations**

- `tests/test_models.py:34` — rename `test_default_template_parses_all_six_stages` to `..._all_seven_stages` and change its expected key set to include `plan-audit`.
- `tests/test_models.py:414` `test_locate_default` — expects six data rows; expect seven.
- `tests/test_models.py:472` `test_rows_in_stage_order_with_labels` — append `plan audit (deep)` / `plan-audit` to the expected ordered list. `profile_view` iterates `STAGE_LABELS.values()` (`models.py:252`), so the new row appears last.

- [ ] **Step 8: Update the two existing `test_board.py` expectations**

- `tests/test_board.py:2835` `test_present_with_six_rows_when_file_exists` — rename to `..._seven_rows...` and expect seven rows including `plan-audit`.
- `tests/test_board.py:2875` `test_noncanonical_file_not_editable_but_present` — it removes one row and expects five remaining; expect six.

Do **not** touch `DEFAULT_ROW_VALUES` or `profile_rows()` (`tests/test_board.py:2907-2916`). They post the six editable stages, which is exactly what the narrowed validator now requires, so the eight POST tests at `:2942-3106` keep passing unchanged. If any of them fails, the Step 6 change is wrong — fix Step 6, not the fixture.

- [ ] **Step 9: Write the failing board test**

Create `board/src/views/Models.reviewer.test.tsx`. Read `board/src/views/Models.test.tsx` first and mirror its `BoardData` + `ModelProfile` fixture exactly, adding a seventh row:

```ts
{ stage: "plan-audit", label: "plan audit (deep)", model: "codex-sol", effort: "xhigh", mechanism: "reviewer" }
```

Assert five behaviours. Use the accessible names the existing editor actually gives its controls — read `Models.tsx:326-359` and match them; if a control has no accessible name today, add one as part of this task, because a control a test cannot name is one a screen reader cannot name either.

```tsx
it("renders the reviewer row's label and token", () => { /* both appear as text */ });
it("renders the reviewer row's model as static text, not a control", () => { /* no editable control for that row */ });
it("explains why the reviewer row is not editable", () => { /* title mentions /planboard:models */ });
it("still exposes controls for the six Claude rows", () => { /* one per editable stage */ });
it("keeps Save enabled with a reviewer row present", () => {
  // The regression that matters: `allValid` must not run the Claude model
  // validator over `codex-sol`, or Save is permanently dead.
});
```

- [ ] **Step 10: Run it to verify it fails**

Run (from `board/`): `npx vitest run src/views/Models.reviewer.test.tsx`
Expected: FAIL, and `npx tsc --noEmit` reports the `mechanism` union error

- [ ] **Step 11: Widen the board types**

`board/src/lib/types.ts:55-61`:

```ts
export interface ModelProfileRow {
  stage: string; // canonical key: plan | execute | sync | plan-review | results-validation | board-reviewer | plan-audit
  label: string;
  model: string; // inherit | opus | sonnet | haiku | fable | claude-* id, OR a reviewer token
  effort: string | null; // low | medium | high | xhigh | max | null
  // `reviewer` rows name an auditor token (codex-sol | codex-terra |
  // codex-luna | subagent) rather than a Claude model, so the board renders
  // them read-only: its editor's vocabulary is Claude aliases only.
  mechanism: "nudge" | "agent" | "reviewer";
}
```

- [ ] **Step 12: Make the Models view tolerate the row**

In `Models.tsx`, four changes:

1. `DraftRow.mechanism` (line 40) becomes `ModelProfileRow["mechanism"]` so it cannot drift from the source type again.
2. `MechChip`'s prop (line 62) becomes `ModelProfileRow["mechanism"]`, with a third branch — reuse the stone palette from `SELECT_CLS`'s border colours and the title `"Runs an independent auditor — edit with /planboard:models"`.
3. `allValid` (line 173) becomes:

```tsx
  const allValid = draft.every((r) => r.mechanism === "reviewer" || modelValid(r.model));
```

4. Gate the per-row controls: `const rowEditable = canEdit && row.mechanism !== "reviewer";`. A non-editable row renders its model and effort as static text with `title="Reviewer rows are edited with /planboard:models — the board's editor only knows Claude models."`. Leave `canEdit`, `changedStages`, the save path, and the 409 rebase untouched; this is a per-row render gate, not a new permission concept.

Also update two pieces of stale wording: the notice at `Models.tsx:297` ("canonical six-row form" becomes "canonical form") and the view's header text at `Models.tsx:399-405`, which describes every stage as a Claude-model choice.

- [ ] **Step 13: Exclude reviewer rows from the POST body**

Wherever `Models.tsx` builds the save payload, filter them out so the server never receives a row it now rejects:

```tsx
  rows: draft.filter((r) => r.mechanism !== "reviewer").map(({ stage, model, effort }) => ({ stage, model, effort })),
```

- [ ] **Step 14: Run everything**

Run: `python3 -m unittest discover -s tests`
Run (from `board/`): `npm test && npx tsc --noEmit`
Expected: PASS on both. This task is not done until both suites are green — it is the whole reason the task is this size.

- [ ] **Step 15: Commit**

```bash
git add skills/managing-planboard/scripts/models.py skills/managing-planboard/scripts/board.py \
        skills/managing-planboard/templates/model-profile.md \
        board/src/lib/types.ts board/src/views/Models.tsx board/src/views/Models.reviewer.test.tsx \
        tests/test_models.py tests/test_board.py
git commit -m "models: add the plan-audit stage and reviewer mechanism across script, server, and board"
```

---

### Task 2: Generate `pb-plan-auditor`

The audit's subagent and fallback path must NOT reuse `pb-board-reviewer`, which caps at five comments and requires a verbatim quote on every finding (`templates/agents/pb-board-reviewer.md:12,27-30`). Reusing it would re-impose both the cap the audit removes and the anchor rule that deletes the entire `gaps` class, producing a fallback that structurally cannot report a missing missingness rule — and a clean-looking audit reads as safety.

A `reviewer` row's model cell is spent naming the primary auditor, so it holds no Claude model for the generated agent. The agent's model is therefore pinned to `opus` and its effort comes from the row; the two effort scales are identical, so only the model is token-specific.

**Files:**
- Create: `skills/managing-planboard/templates/agents/pb-plan-auditor.md`
- Modify: `skills/managing-planboard/scripts/models.py:36-47` (`AGENT_STAGES`), the generation loop at `:426-456`, and `cmd_check` at `:508-533`
- Modify: `tests/test_models.py:191` (`test_default_profile_writes_three_marked_agents`), `:501` (`test_first_generate_creates_all_three`)
- Test: `tests/test_models.py` (new `TestPlanAuditorGeneration`)

**Interfaces:**
- Consumes: `STAGE_LABELS`, `EXPECTED_MECHANISM`, `REVIEWER_TOKENS` (Task 1).
- Produces: `.claude/agents/pb-plan-auditor.md`, and `models.AGENT_MODEL_OVERRIDE`. Task 11 dispatches the agent by name on the fallback path.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_models.py`:

```python
class TestPlanAuditorGeneration(unittest.TestCase):
    def _generate(self, root):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = models.main(["--root", str(root), "generate"])
        return code, out.getvalue(), err.getvalue()

    def test_auditor_is_generated_from_a_reviewer_row(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            self._generate(root)
            self.assertTrue((root / ".claude" / "agents" / "pb-plan-auditor.md").is_file())

    def test_auditor_model_is_opus_and_effort_comes_from_the_row(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            self._generate(root)
            text = (root / ".claude" / "agents" / "pb-plan-auditor.md").read_text()
            self.assertIn("model: opus", text)
            self.assertIn("effort: xhigh", text)
            self.assertNotIn("codex-sol", text)

    def test_auditor_contract_admits_gaps_requires_evidence_and_has_no_cap(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            self._generate(root)
            text = (root / ".claude" / "agents" / "pb-plan-auditor.md").read_text()
            self.assertIn('"gaps"', text)
            self.assertIn('"evidence"', text)
            self.assertNotIn("at most 5", text)

    def test_check_is_silent_after_a_fresh_generation(self):
        # The regression that matters: cmd_check must accept the reviewer
        # mechanism and apply the same model override, or every check prints a
        # false drift hint.
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            self._generate(root)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                models.main(["--root", str(root), "check"])
            self.assertEqual(out.getvalue().strip(), "")

    def test_flipped_mechanism_removes_the_marked_auditor(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            self._generate(root)
            agent = root / ".claude" / "agents" / "pb-plan-auditor.md"
            self.assertTrue(agent.is_file())
            p = root / "plans" / "model-profile.md"
            p.write_text(p.read_text().replace(
                "| plan audit (deep) | codex-sol | xhigh | reviewer |",
                "| plan audit (deep) | opus | xhigh | agent |",
            ))
            self._generate(root)
            self.assertFalse(agent.is_file())
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m unittest tests.test_models.TestPlanAuditorGeneration -v`
Expected: FAIL — `pb-plan-auditor.md` is not generated

- [ ] **Step 3: Write the agent template**

Create `skills/managing-planboard/templates/agents/pb-plan-auditor.md`:

```markdown
---
name: pb-plan-auditor
description: Audits ONE execution plan against the repository and data for technical correctness — will this plan actually work? Separate from the rubric scorecard, which scores the plan as a governance contract. Dispatched by the planboard audit channel.
model: {{MODEL}}
effort: {{EFFORT}}
tools: Read, Grep, Glob
---
<!-- generated by planboard /models · profile sha256:{{CHECKSUM}} -->

You audit ONE execution plan for technical correctness. The dispatching command gives you the plan's full content, its on-disk path, and the repository root.

You are NOT scoring the plan. A separate reviewer scores it against a five-channel rubric for whether it is a checkable contract. Your question is different and narrower: **executed as written, against this repository and this data, will this plan produce what it claims?** A plan can be a perfect contract and still be wrong. Assume it scored well and look for what the score cannot see.

Review only; never modify anything.

**Return strict JSON with exactly three keys.**

```json
{
  "overall": "one paragraph",
  "anchored": [
    {"section": "<exact heading, or empty string>",
     "quote": "<verbatim span from the plan, markdown stripped>",
     "evidence": {"path": "<repo or data path you read>", "kind": "direct", "detail": "<what you found there>"},
     "comment": "[blocker] <finding>. At execution: <the concrete failure>."}
  ],
  "gaps": [
    {"section": "<nearest heading, or empty string>",
     "evidence": {"path": "<repo or data path you read>", "kind": "direct", "detail": "<what you found there>"},
     "comment": "[major] <what the plan never states>. At execution: <the concrete failure>."}
  ]
}
```

**`anchored` versus `gaps`.** A finding about text that IS in the plan goes in `anchored` with a short verbatim `quote`, markdown stripped (no `**`, backticks, or `[]()`), so it matches the rendered text a reader sees. A finding about something the plan NEVER says goes in `gaps` and carries no quote. The gaps bucket exists because omissions are where plans and outputs diverge, and a quote-anchored contract cannot express them. Do not force a gap into an anchor by quoting a nearby line.

**There is no cap on findings.** Return every material finding. Two requirements replace a cap:

1. **Predicted failure.** Every comment must name the concrete failure it predicts at execution time. "Consider handling missingness" is not a finding. "Step 4 will silently drop the 2019 wave because no missingness rule is stated and the script defaults to listwise deletion" is. Drop any finding you cannot attach a consequence to.
2. **Repository evidence.** Every finding carries an `evidence` object naming a path you actually opened, what you found there, and `"kind": "direct"` when you read it or `"kind": "inferred"` when you are reasoning past what you read. Never assert what you have not checked. A finding with no evidence path does not belong in the output.

**Severity.** Begin each comment with exactly one tag: `[blocker]` (invalidates a finding or decision — must be resolved before acting on the work), `[major]` (materially changes the work if acted on), `[minor]` (worth fixing, not blocking). Order most severe first within each bucket.

**Dig deeper before finalizing.** Hunt the second-order failures a surface read misses: steps whose failure would be silent, data assumptions the plan never checks, empty states, joins that can drop rows, outputs a later step assumes exist, and paths the plan names that do not exist in the repository.

**Verify before returning.** Re-check each finding: is it material, does it name a concrete execution failure, and is its evidence something you actually read? Drop what fails. A short grounded audit beats a long speculative one.
```

- [ ] **Step 4: Wire generation**

In `models.py`:

```python
AGENT_STAGES = {
    "plan-review": "pb-plan-reviewer",
    "results-validation": "pb-results-validator",
    "board-reviewer": "pb-board-reviewer",
    "plan-audit": "pb-plan-auditor",
}
# A `reviewer` row's model cell names WHO audits, so it holds no Claude model
# for the generated agent. The agent backing the subagent and fallback paths is
# pinned here; the row's effort still reaches it, because the Codex and Claude
# effort scales are identical.
AGENT_MODEL_OVERRIDE = {"plan-audit": "opus"}
```

`LEGACY_AGENT_NAMES` gains nothing: there is no pre-rename `rp-plan-auditor`.

In the generation loop (`models.py:435`), the guard becomes mechanism-aware, and the render uses the override:

```python
        if row["mechanism"] != EXPECTED_MECHANISM[key]:
```

```python
            model = AGENT_MODEL_OVERRIDE.get(key, row["model"])
            rendered = _render(template, model, row["effort"], checksum)
```

- [ ] **Step 5: Apply the identical fix to `cmd_check`**

This is the step whose omission broke five existing tests in the first draft. `cmd_check` re-renders each template to detect drift and has its own copy of both the guard and the render (`models.py:523`, `:533`):

```python
        row = stages.get(key)
        if row is None or row["mechanism"] != EXPECTED_MECHANISM[key]:
```

```python
        rendered = _render(template, AGENT_MODEL_OVERRIDE.get(key, row["model"]),
                           row["effort"], checksum)
```

Without both, every `check` prints `MISMATCH_HINT` against a freshly generated tree.

- [ ] **Step 6: Update the two stale existing tests**

- `tests/test_models.py:191` `test_default_profile_writes_three_marked_agents` — rename to `..._four_marked_agents` and add `pb-plan-auditor` to its name loop.
- `tests/test_models.py:501` `test_first_generate_creates_all_three` — rename to `..._all_four` and expect four `changedStages`.

- [ ] **Step 7: Run the full Python suite**

Run: `python3 -m unittest discover -s tests`
Expected: PASS. Watch specifically for `TestCheck.test_fresh_generation_is_silent` (`:282`), the two `TestOrphanRemovalAndGuards` checks (`:325`, `:372`), and the two `TestCheckTemplateDrift` checks (`:644`, `:687`) — all five go red if Step 5 was skipped. `TestCheckTemplateDrift` copies the template directory dynamically (`tests/test_models.py:648-662`), so it needs no new template registration.

- [ ] **Step 8: Commit**

```bash
git add skills/managing-planboard/templates/agents/pb-plan-auditor.md \
        skills/managing-planboard/scripts/models.py tests/test_models.py
git commit -m "models: generate pb-plan-auditor with the gaps-admitting audit contract"
```

---

### Task 3: Self-healing profile migration

`profile_canonical` requires the stage set to equal `STAGE_LABELS` exactly (`models.py:170-180`), so an unmigrated six-row profile is non-canonical and its board editor goes read-only. And `cmd_check` only inspects stages whose agent exists in the project, so before `pb-plan-auditor` is generated it cannot report the missing row at all. The migration therefore runs from every lookup, not only from `/planboard:models`.

**Files:**
- Modify: `skills/managing-planboard/scripts/models.py` (new function; call sites in `cmd_generate`, `cmd_check`, `cmd_stage`)
- Test: `tests/test_models.py` (new `TestEnsureAuditStage`)

**Interfaces:**
- Consumes: `STAGE_LABELS` (Task 1), `atomic_write` (`models.py:311`), `locate_table` (`models.py:183`), `_norm` (`models.py:85`), `_row_cells` (`models.py:89`).
- Produces: `ensure_audit_stage(root) -> {"changed": bool, "reason": str}`. Task 7 calls it before every audit lookup.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_models.py`:

```python
SIX_ROW_PROFILE = """# Model profile

<!-- planboard:model-profile -->

Prose that must survive the splice.

| stage | model | effort | mechanism |
|---|---|---|---|
| plan (co-authoring) | opus | max | nudge |
| execute (analysis) | sonnet | — | nudge |
| sync | inherit | — | nudge |
| plan review (verdict + grade) | opus | medium | agent |
| results validation | opus | low | agent |
| board reviewer panel | opus | low | agent |

Trailing prose that must also survive.
"""


class TestEnsureAuditStage(unittest.TestCase):
    def test_splices_the_missing_row(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=SIX_ROW_PROFILE)
            self.assertTrue(models.ensure_audit_stage(root)["changed"])
            text = (root / "plans" / "model-profile.md").read_text()
            self.assertIn("| plan audit (deep) | codex-sol | xhigh | reviewer |", text)

    def test_result_is_byte_exact(self):
        # Substring checks would pass a migration that reformatted the file.
        expected = SIX_ROW_PROFILE.replace(
            "| board reviewer panel | opus | low | agent |\n",
            "| board reviewer panel | opus | low | agent |\n"
            "| plan audit (deep) | codex-sol | xhigh | reviewer |\n",
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=SIX_ROW_PROFILE)
            models.ensure_audit_stage(root)
            self.assertEqual((root / "plans" / "model-profile.md").read_text(), expected)

    def test_migrated_profile_is_canonical(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=SIX_ROW_PROFILE)
            models.ensure_audit_stage(root)
            stages, warnings = models.parse_profile(
                (root / "plans" / "model-profile.md").read_text())
            self.assertTrue(models.profile_canonical(stages, warnings))

    def test_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=SIX_ROW_PROFILE)
            models.ensure_audit_stage(root)
            first = (root / "plans" / "model-profile.md").read_text()
            self.assertFalse(models.ensure_audit_stage(root)["changed"])
            self.assertEqual(first, (root / "plans" / "model-profile.md").read_text())

    def test_prose_only_file_does_not_crash(self):
        # The first draft's comprehension raised IndexError on "# Model profile"
        # because it split before checking the pipe count.
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile="# Model profile\n\nNo table here.\n")
            result = models.ensure_audit_stage(root)
            self.assertFalse(result["changed"])
            self.assertIn("no stage", result["reason"])

    def test_refuses_a_duplicated_audit_row(self):
        dupe = SIX_ROW_PROFILE.replace(
            "| board reviewer panel | opus | low | agent |\n",
            "| board reviewer panel | opus | low | agent |\n"
            "| plan audit (deep) | codex-sol | xhigh | reviewer |\n"
            "| plan audit (deep) | codex-luna | low | reviewer |\n",
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=dupe)
            before = (root / "plans" / "model-profile.md").read_text()
            result = models.ensure_audit_stage(root)
            self.assertFalse(result["changed"])
            self.assertIn("ambiguous", result["reason"])
            self.assertEqual(before, (root / "plans" / "model-profile.md").read_text())

    def test_a_malformed_audit_row_counts_as_present(self):
        # Three cells, not four. If the splice ignored it, a second row would
        # be inserted and the profile would be permanently non-canonical.
        malformed = SIX_ROW_PROFILE.replace(
            "| board reviewer panel | opus | low | agent |\n",
            "| board reviewer panel | opus | low | agent |\n"
            "| plan audit (deep) | codex-sol | reviewer |\n",
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=malformed)
            self.assertFalse(models.ensure_audit_stage(root)["changed"])
            self.assertEqual(
                (root / "plans" / "model-profile.md").read_text().count("plan audit (deep)"), 1)

    def test_missing_profile_file_is_not_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=None)
            self.assertFalse(models.ensure_audit_stage(root)["changed"])

    def test_crlf_profile_keeps_its_line_endings(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=SIX_ROW_PROFILE.replace("\n", "\r\n"))
            models.ensure_audit_stage(root)
            raw = (root / "plans" / "model-profile.md").read_bytes()
            self.assertIn(b"| plan audit (deep) | codex-sol | xhigh | reviewer |\r\n", raw)
            self.assertNotIn(b"reviewer |\n\r", raw)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m unittest tests.test_models.TestEnsureAuditStage -v`
Expected: FAIL with `AttributeError: module 'models' has no attribute 'ensure_audit_stage'`

- [ ] **Step 3: Write the implementation**

Add to `models.py` beside the other profile-writing helpers:

```python
AUDIT_ROW = "| plan audit (deep) | codex-sol | xhigh | reviewer |"


def ensure_audit_stage(root):
    """Splice the plan-audit row into a pre-audit profile, atomically.

    Runs from every audit lookup, not only /planboard:models: an unmigrated
    profile is non-canonical (so the board's editor goes read-only) and
    cmd_check cannot report a missing reviewer-only row before its agent exists
    in the project. An upgraded project must not reach a mandatory audit with
    no reviewer row.

    Splices ONLY the missing row and preserves every surrounding byte. Refuses
    an ambiguous file rather than guessing.
    """
    path = Path(root) / PROFILE_REL
    if not path.is_file():
        return {"changed": False, "reason": "no model-profile.md"}
    try:
        # read_bytes().decode(), NOT read_text(): read_text applies universal
        # newline translation, so a CRLF profile would come back as LF and the
        # splice would rewrite the whole file's line endings.
        text = path.read_bytes().decode("utf-8")
    except (OSError, UnicodeDecodeError) as e:
        return {"changed": False, "reason": "unreadable model-profile.md (%s)" % e}

    lines = text.splitlines(keepends=True)
    audit_rows = []
    for i, ln in enumerate(lines):
        cells = _row_cells(ln)
        # _row_cells returns None for any non-table line, so this never indexes
        # into a prose line — the first draft's bug. The cell COUNT is not
        # checked: a malformed three-cell `plan audit` row must still count as
        # present, or the splice adds a second one and leaves the profile
        # permanently non-canonical.
        if cells and STAGE_LABELS.get(_norm(cells[0])) == "plan-audit":
            audit_rows.append(i)
    if len(audit_rows) > 1:
        return {"changed": False, "reason": "ambiguous: %d plan-audit rows" % len(audit_rows)}
    if audit_rows:
        return {"changed": False, "reason": "already present"}

    loc = locate_table(text)
    if loc is None:
        return {"changed": False, "reason": "no stage/model/effort/mechanism table found"}
    # (after the splice below, the caller regenerates — see the note after this
    # code block on why regeneration cannot live inside this function)
    # locate_table returns (header_idx, first_data_idx, last_data_idx) as
    # indices into splitlines(keepends=True), INCLUSIVE of the data range
    # (models.py:183-187), so the insertion point is one past the last row.
    _header, _first, last_data = loc

    last_line = lines[last_data]
    ending = last_line[len(last_line.rstrip("\r\n")):] or "\n"
    lines.insert(last_data + 1, AUDIT_ROW + ending)
    atomic_write(path, "".join(lines))
    return {"changed": True, "reason": "inserted the plan-audit row"}
```

The line ending is copied from the row being followed, not guessed from the file's first line, so a CRLF profile stays CRLF.

- [ ] **Step 4: Call it from all three lookup paths, and regenerate after a splice**

`cmd_generate`, `cmd_check`, and `cmd_stage` each take `root` and `print()` directly — none has a `stdout` list, so use `print`:

```python
    migration = ensure_audit_stage(root)
    if migration["changed"]:
        print("model-profile: %s" % migration["reason"])
```

Place it as the first statement of `cmd_generate` (`models.py:481`) and `cmd_stage` (`models.py:279`). In `cmd_check` (`models.py:490`), place it **after** the `migrate_legacy_agents` early return so a legacy project still gets its rename hint first.

`cmd_stage` must stay silent on stdout apart from its JSON row, since callers parse it — send its migration line to `stderr` instead:

```python
        print("model-profile: %s" % migration["reason"], file=sys.stderr)
```

**A splice must be followed by regeneration.** The spec requires the migration to regenerate affected agents; without it, a project can acquire the row while `.claude/agents/pb-plan-auditor.md` stays absent indefinitely, so every fallback dispatch names an agent that does not exist. Regeneration cannot live inside `ensure_audit_stage` itself — `generate()` calls back into profile parsing, and `cmd_generate` would then run it twice — so the caller does it. In `cmd_check` and `cmd_stage`, after a `changed` migration:

```python
    if migration["changed"]:
        res = generate(root)
        for line in res["stdout"]:
            print(line)
```

`cmd_generate` needs nothing extra: its own `generate(root)` call already runs after the migration. Add a test asserting that `models.main(["--root", str(root), "stage", "plan-audit"])` on a six-row project both splices the row and leaves `.claude/agents/pb-plan-auditor.md` on disk.

- [ ] **Step 5: Run the full Python suite**

Run: `python3 -m unittest discover -s tests`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add skills/managing-planboard/scripts/models.py tests/test_models.py
git commit -m "models: self-healing plan-audit row migration from every lookup path"
```

---

### Task 4: Audit identity primitives

**Files:**
- Create: `skills/managing-planboard/scripts/audit.py`
- Create: `tests/test_audit.py`

**Interfaces:**
- Consumes: `normalize_plan` and `strip_trailer` from `signoff_gate.py` (same directory; both the CLI and the test harness put that directory on `sys.path`).
- Produces:
  - `audit_plan_hash(text) -> str` — 64-char hex sha256.
  - `context_identity(root, evidence_paths) -> {"head": str|None, "paths": {relpath: str|None}}`. A path that does not exist maps to `None`, a meaningful observation rather than an error.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_audit.py`:

```python
"""Tests for audit.py. Run:
    python3 -m unittest tests.test_audit -v
"""
import contextlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = (
    Path(__file__).resolve().parents[1]
    / "skills" / "managing-planboard" / "scripts"
)
sys.path.insert(0, str(SCRIPTS))
import audit  # noqa: E402

PLAN = "# Component 03 v2\n\nGoal: test the hash.\n\n## Steps\n\n1. Do the thing.\n"


def git_repo(root):
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.email", "t@t"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=root, check=True)
    (root / "seed.txt").write_text("seed\n")
    subprocess.run(["git", "add", "seed.txt"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "seed"], cwd=root, check=True)
    return root


class TestAuditPlanHash(unittest.TestCase):
    def test_hash_is_hex_sha256(self):
        self.assertRegex(audit.audit_plan_hash(PLAN), r"^[0-9a-f]{64}$")

    def test_invariant_across_signed_trailer(self):
        signed = PLAN + "\n---\n\nSigned off: BK, 2026-07-25\n"
        self.assertEqual(audit.audit_plan_hash(PLAN), audit.audit_plan_hash(signed))

    def test_invariant_across_amendment_trailer(self):
        # normalize_plan alone does NOT strip this; strip_trailer does. This is
        # the case that lets a /sync amendment keep its draft's audit.
        amended = PLAN + "\n---\n\nAmendment recorded, 2026-07-25\n"
        self.assertEqual(audit.audit_plan_hash(PLAN), audit.audit_plan_hash(amended))

    def test_content_change_changes_hash(self):
        other = PLAN.replace("Do the thing", "Do a different thing")
        self.assertNotEqual(audit.audit_plan_hash(PLAN), audit.audit_plan_hash(other))

    def test_crlf_and_trailing_whitespace_are_normalized(self):
        noisy = PLAN.replace("\n", "\r\n").rstrip() + "   \r\n\r\n"
        self.assertEqual(audit.audit_plan_hash(PLAN), audit.audit_plan_hash(noisy))


class TestContextIdentity(unittest.TestCase):
    def test_records_a_real_head_sha(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = git_repo(Path(tmp))
            self.assertRegex(audit.context_identity(root, [])["head"], r"^[0-9a-f]{40}$")

    def test_hashes_each_evidence_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = git_repo(Path(tmp))
            (root / "analysis").mkdir()
            (root / "analysis" / "load.py").write_text("print('load')\n")
            ident = audit.context_identity(root, ["analysis/load.py"])
            self.assertRegex(ident["paths"]["analysis/load.py"], r"^[0-9a-f]{64}$")

    def test_missing_path_records_none_not_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = git_repo(Path(tmp))
            self.assertIsNone(audit.context_identity(root, ["gone.py"])["paths"]["gone.py"])

    def test_renamed_evidence_changes_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = git_repo(Path(tmp))
            (root / "load.py").write_text("x\n")
            before = audit.context_identity(root, ["load.py"])
            (root / "load.py").rename(root / "loader.py")
            self.assertNotEqual(before["paths"], audit.context_identity(root, ["load.py"])["paths"])

    def test_no_evidence_paths_yields_empty_map(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = git_repo(Path(tmp))
            self.assertEqual(audit.context_identity(root, [])["paths"], {})

    def test_non_git_directory_records_none_head(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(audit.context_identity(Path(tmp), [])["head"])

    def test_escaping_path_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = git_repo(Path(tmp))
            with self.assertRaises(ValueError):
                audit.context_identity(root, ["../outside.py"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m unittest tests.test_audit -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'audit'`

- [ ] **Step 3: Write the implementation**

Create `skills/managing-planboard/scripts/audit.py`. All imports go at the top of the module:

```python
"""Audit identity, artifact writing, and reviewer dispatch for the planboard
audit channel. Standard library only.

The audit channel answers "will this plan actually work?" against the
repository, separately from the rubric scorecard, which answers "is this a
checkable contract?" from the plan text alone. See
docs/specs/2026-07-24-plan-audit-channel-design.md.
"""
import argparse
import datetime
import errno
import hashlib
import json
import os
import shutil
import stat
import subprocess
import tempfile
import time
from pathlib import Path

from signoff_gate import normalize_plan, strip_trailer


def audit_plan_hash(text):
    """The audit's plan identity.

    Composes strip_trailer with normalize_plan so the hash is invariant across
    BOTH canonical trailers. normalize_plan alone strips only `Signed off:`, so
    an audit taken on a draft would go stale the moment /sync appends
    `Amendment recorded`. Composing them means one audit survives sign-off AND
    the amendment write.
    """
    return hashlib.sha256(
        normalize_plan(strip_trailer(text)).encode("utf-8")
    ).hexdigest()


def _git_head(root):
    """Current HEAD sha, or None outside a git repo or in one with no commits."""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(root), capture_output=True, text=True, timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def context_identity(root, evidence_paths):
    """Identity of the repository state an audit's findings rest on.

    Scoped to the paths the audit's own evidence cites, NOT a whole-worktree
    fingerprint: during active work the tree is always dirty, so a broad
    fingerprint would invalidate every audit immediately and the cache would
    buy nothing. A missing path hashes to None, which is a real observation
    (the audit saw it absent), not a failure.
    """
    root = Path(root).resolve()
    paths = {}
    for rel in evidence_paths:
        p = (root / rel).resolve()
        if p != root and root not in p.parents:
            raise ValueError("evidence path escapes the repository: %s" % rel)
        paths[rel] = hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None
    return {"head": _git_head(root), "paths": paths}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `python3 -m unittest tests.test_audit -v`
Expected: PASS, 12 tests

- [ ] **Step 5: Commit**

```bash
git add skills/managing-planboard/scripts/audit.py tests/test_audit.py
git commit -m "audit: plan hash invariant across both trailers, scoped context identity"
```

---

### Task 5: Locked, atomic artifact writes

**Files:**
- Modify: `skills/managing-planboard/scripts/audit.py`
- Modify: `tests/test_audit.py`

**Interfaces:**
- Consumes: Task 4.
- Produces: `audit_path`, `render_audit`, `write_audit`, `read_audit`, `is_current`, `audit_lock`, `AuditLocked`, `SCHEMA_VERSION`, `REQUIRED_KEYS`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_audit.py`:

```python
def payload(**over):
    p = {
        "schemaVersion": 1,
        "component": "03-attrition",
        "planVersion": 2,
        "planPath": "plans/execution/03-attrition/.draft-v2.md",
        "date": "2026-07-25",
        "reviewer": {"token": "codex-sol", "effort": "xhigh"},
        "auditPlanHash": "a" * 64,
        "contextIdentity": {"head": None, "paths": {}},
        "supersedes": None,
        "overall": "Reads sound; two gaps.",
        "anchored": [],
        "gaps": [],
        "dispositions": [],
    }
    p.update(over)
    return p


def project(tmp):
    root = Path(tmp)
    (root / "plans" / "reviews").mkdir(parents=True)
    (root / "plans" / "execution" / "03-attrition").mkdir(parents=True)
    return root


FINDING = {
    "section": "Steps",
    "evidence": {"path": "analysis/fit.R", "kind": "direct", "detail": "no seed"},
    "comment": "[blocker] No seed. At execution: results are irreproducible.",
}


class TestWriteAudit(unittest.TestCase):
    def test_writes_a_readable_fence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            p = audit.write_audit(root, "03-attrition", 2, payload())
            self.assertEqual(p.name, "03-attrition-v2-audit.md")
            self.assertEqual(audit.read_audit(root, "03-attrition", 2)["component"], "03-attrition")

    def test_rejects_a_payload_missing_a_required_key(self):
        for key in ("overall", "auditPlanHash", "contextIdentity", "supersedes"):
            with tempfile.TemporaryDirectory() as tmp:
                root = project(tmp)
                bad = payload()
                del bad[key]
                with self.assertRaises(ValueError, msg=key):
                    audit.write_audit(root, "03-attrition", 2, bad)

    def test_rejects_a_bucket_that_is_not_a_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            with self.assertRaises(ValueError):
                audit.write_audit(root, "03-attrition", 2, payload(gaps={"not": "a list"}))

    def test_rejects_a_finding_with_no_severity_tag(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            bad = dict(FINDING, comment="No tag at all.")
            with self.assertRaises(ValueError):
                audit.write_audit(root, "03-attrition", 2, payload(gaps=[bad]))

    def test_rejects_a_finding_with_no_evidence_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            bad = {k: v for k, v in FINDING.items() if k != "evidence"}
            with self.assertRaises(ValueError):
                audit.write_audit(root, "03-attrition", 2, payload(gaps=[bad]))

    def test_rejects_an_anchored_finding_with_no_quote(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            with self.assertRaises(ValueError):
                audit.write_audit(root, "03-attrition", 2, payload(anchored=[FINDING]))

    def test_write_is_atomic_when_the_replace_fails(self):
        # Tests ATOMICITY, not validation order: force a failure inside the
        # write itself and assert the old file survives with no temp left over.
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            audit.write_audit(root, "03-attrition", 2, payload())
            good = audit.audit_path(root, "03-attrition", 2).read_text()
            boom = payload(auditPlanHash="b" * 64)
            real_replace = os.replace

            def fail_replace(*a, **k):
                raise OSError("disk full")

            os.replace = fail_replace
            try:
                with self.assertRaises(OSError):
                    audit.write_audit(root, "03-attrition", 2, boom)
            finally:
                os.replace = real_replace
            self.assertEqual(good, audit.audit_path(root, "03-attrition", 2).read_text())
            leftovers = list((root / "plans" / "reviews").glob("*.tmp"))
            self.assertEqual(leftovers, [])

    def test_refuses_to_clobber_an_audit_carrying_dispositions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            audit.write_audit(root, "03-attrition", 2, payload(
                dispositions=[{"finding": "f1", "status": "accepted", "reason": "known"}]))
            with self.assertRaises(audit.AuditLocked):
                audit.write_audit(root, "03-attrition", 2, payload())

    def test_replaces_an_audit_at_a_different_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            audit.write_audit(root, "03-attrition", 2, payload(
                dispositions=[{"finding": "f1", "status": "accepted", "reason": "known"}]))
            audit.write_audit(root, "03-attrition", 2, payload(auditPlanHash="b" * 64))
            self.assertEqual(
                audit.read_audit(root, "03-attrition", 2)["auditPlanHash"], "b" * 64)

    def test_replaces_a_disposed_audit_taken_at_a_new_context(self):
        # Same plan text, new repository state. Comparing the plan hash alone
        # would wrongly refuse this and leave the stale audit in place.
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            audit.write_audit(root, "03-attrition", 2, payload(
                dispositions=[{"finding": "f1", "status": "accepted", "reason": "known"}]))
            audit.write_audit(root, "03-attrition", 2, payload(
                contextIdentity={"head": "deadbeef" * 5, "paths": {}}))
            self.assertEqual(
                audit.read_audit(root, "03-attrition", 2)["contextIdentity"]["head"],
                "deadbeef" * 5)

    def test_supersedes_names_the_artifact_actually_replaced(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            audit.write_audit(root, "03-attrition", 2, payload(auditPlanHash="a" * 64))
            audit.write_audit(root, "03-attrition", 2, payload(auditPlanHash="b" * 64))
            self.assertEqual(
                audit.read_audit(root, "03-attrition", 2)["supersedes"], "a" * 64)

    def test_first_audit_supersedes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            audit.write_audit(root, "03-attrition", 2, payload())
            self.assertIsNone(audit.read_audit(root, "03-attrition", 2)["supersedes"])

    def test_read_audit_returns_none_when_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(audit.read_audit(project(tmp), "03-attrition", 2))

    def test_prose_link_points_into_execution(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            audit.write_audit(root, "03-attrition", 2, payload())
            text = audit.audit_path(root, "03-attrition", 2).read_text()
            self.assertIn("../execution/03-attrition/", text)
            self.assertNotIn("../../", text)


class TestAuditLock:
    pass  # replaced below


class TestLock(unittest.TestCase):
    def test_second_holder_is_refused_while_the_first_holds(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            with audit.audit_lock(root, "03-attrition", 2):
                with self.assertRaises(audit.AuditLocked):
                    with audit.audit_lock(root, "03-attrition", 2):
                        pass

    def test_lock_is_released_on_exception(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            with self.assertRaises(RuntimeError):
                with audit.audit_lock(root, "03-attrition", 2):
                    raise RuntimeError("boom")
            with audit.audit_lock(root, "03-attrition", 2):
                pass  # acquired again — no leaked lock file

    def test_different_versions_do_not_block_each_other(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            with audit.audit_lock(root, "03-attrition", 2):
                with audit.audit_lock(root, "03-attrition", 3):
                    pass

    def test_a_dead_owners_lock_is_reclaimed(self):
        # Without this, one crashed run locks the component out permanently.
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            lock = audit.audit_lock(root, "03-attrition", 2)
            # PID 2**31-1 is not a running process on any supported platform.
            lock.path.parent.mkdir(parents=True, exist_ok=True)
            lock.path.write_text("%d %f\n" % (2 ** 31 - 1, time.time()))
            with audit.audit_lock(root, "03-attrition", 2):
                pass
            self.assertFalse(lock.path.exists())

    def test_a_live_owners_lock_is_respected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            lock = audit.audit_lock(root, "03-attrition", 2)
            lock.path.parent.mkdir(parents=True, exist_ok=True)
            lock.path.write_text("%d %f\n" % (os.getpid(), time.time()))
            with self.assertRaises(audit.AuditLocked):
                with audit.audit_lock(root, "03-attrition", 2):
                    pass

    def test_an_ancient_lock_is_reclaimed_even_if_its_pid_is_live(self):
        # A recycled PID must not hold the component hostage forever.
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            lock = audit.audit_lock(root, "03-attrition", 2)
            lock.path.parent.mkdir(parents=True, exist_ok=True)
            lock.path.write_text("%d %f\n" % (os.getpid(), time.time() - 7200))
            with audit.audit_lock(root, "03-attrition", 2):
                pass

    def test_an_unreadable_lock_is_reclaimed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            lock = audit.audit_lock(root, "03-attrition", 2)
            lock.path.parent.mkdir(parents=True, exist_ok=True)
            lock.path.write_text("garbage")
            with audit.audit_lock(root, "03-attrition", 2):
                pass


class TestIsCurrent(unittest.TestCase):
    def test_matching_hash_head_and_paths_is_current(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = git_repo(Path(tmp))
            rec = payload(auditPlanHash=audit.audit_plan_hash(PLAN),
                          contextIdentity=audit.context_identity(root, []))
            self.assertTrue(audit.is_current(rec, PLAN, root))

    def test_changed_plan_text_is_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = git_repo(Path(tmp))
            rec = payload(auditPlanHash=audit.audit_plan_hash(PLAN),
                          contextIdentity=audit.context_identity(root, []))
            self.assertFalse(audit.is_current(rec, PLAN + "\nExtra.\n", root))

    def test_moved_evidence_is_stale_though_the_plan_is_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = git_repo(Path(tmp))
            (root / "load.py").write_text("x\n")
            rec = payload(auditPlanHash=audit.audit_plan_hash(PLAN),
                          contextIdentity=audit.context_identity(root, ["load.py"]))
            (root / "load.py").unlink()
            self.assertFalse(audit.is_current(rec, PLAN, root))

    def test_new_head_is_stale(self):
        # The spec defines context identity as HEAD **plus** cited paths.
        with tempfile.TemporaryDirectory() as tmp:
            root = git_repo(Path(tmp))
            rec = payload(auditPlanHash=audit.audit_plan_hash(PLAN),
                          contextIdentity=audit.context_identity(root, []))
            (root / "next.txt").write_text("n\n")
            subprocess.run(["git", "add", "next.txt"], cwd=root, check=True)
            subprocess.run(["git", "commit", "-qm", "next"], cwd=root, check=True)
            self.assertFalse(audit.is_current(rec, PLAN, root))

    def test_no_record_is_not_current(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertFalse(audit.is_current(None, PLAN, Path(tmp)))
```

Delete the placeholder `class TestAuditLock` line when writing the file; it is shown only to mark where the lock tests belong.

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m unittest tests.test_audit -v`
Expected: FAIL with `AttributeError: module 'audit' has no attribute 'write_audit'`

- [ ] **Step 3: Write the implementation**

Append to `audit.py`:

```python
SCHEMA_VERSION = 1
REQUIRED_KEYS = (
    "schemaVersion", "component", "planVersion", "planPath", "date", "reviewer",
    "auditPlanHash", "contextIdentity", "supersedes",
    "overall", "anchored", "gaps", "dispositions",
)
SEVERITIES = ("[blocker]", "[major]", "[minor]")


class AuditLocked(Exception):
    """Raised when another audit run holds this component-version's lock, or
    when a write would clobber a current audit that already carries
    dispositions."""


def audit_path(root, component, version):
    return Path(root) / "plans" / "reviews" / ("%s-v%d-audit.md" % (component, version))


class audit_lock:
    """Exclusive per-component-and-version lock, so two runs for the same plan
    cannot interleave their writes. O_CREAT|O_EXCL is atomic on every platform
    the board already supports.

    A crashed writer must not lock the component out forever, so an existing
    lock is reclaimed when its owner is gone. Liveness mirrors board.py's
    existing lock recovery: os.kill(pid, 0) to test the process, plus an age
    ceiling for a stale file whose pid has been recycled.
    """

    STALE_AFTER = 3600  # a reviewer run is capped at 30 minutes

    def __init__(self, root, component, version):
        self.path = Path(root) / "plans" / "reviews" / (
            ".%s-v%d-audit.lock" % (component, version))

    def _owner_is_gone(self):
        try:
            pid_s, ts_s = self.path.read_text(encoding="utf-8").split()
            pid, ts = int(pid_s), float(ts_s)
        except (OSError, ValueError):
            return True  # unreadable or truncated — treat as abandoned
        if time.time() - ts > self.STALE_AFTER:
            return True
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        except PermissionError:
            return False  # alive, owned by another user
        except OSError:
            return False
        return False

    def _acquire(self):
        fd = os.open(str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        with os.fdopen(fd, "w") as f:
            f.write("%d %f\n" % (os.getpid(), time.time()))

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self._acquire()
        except OSError as e:
            if e.errno != errno.EEXIST:
                raise
            if not self._owner_is_gone():
                raise AuditLocked("another audit run holds %s" % self.path.name)
            try:
                self.path.unlink()
                self._acquire()
            except OSError:
                # Another process reclaimed it first — it is live, not stale.
                raise AuditLocked("another audit run holds %s" % self.path.name)
        return self

    def __exit__(self, *exc):
        try:
            self.path.unlink()
        except OSError:
            pass
        return False


def _validate(payload):
    missing = [k for k in REQUIRED_KEYS if k not in payload]
    if missing:
        raise ValueError("audit payload missing keys: %s" % ", ".join(missing))
    for bucket in ("anchored", "gaps", "dispositions"):
        if not isinstance(payload[bucket], list):
            raise ValueError("audit payload '%s' must be a list" % bucket)
    for bucket in ("anchored", "gaps"):
        for finding in payload[bucket]:
            if not isinstance(finding, dict) or not isinstance(finding.get("comment"), str):
                raise ValueError("every finding needs a string 'comment'")
            if not any(finding["comment"].startswith(s) for s in SEVERITIES):
                raise ValueError("finding has no severity tag: %r" % finding["comment"][:60])
            ev = finding.get("evidence")
            if not isinstance(ev, dict) or not ev.get("path"):
                raise ValueError(
                    "finding has no evidence path: %r" % finding["comment"][:60])
            if ev.get("kind") not in ("direct", "inferred"):
                # Defaulting a missing kind to "direct" would render an
                # unverified claim as one the reviewer confirmed by reading.
                raise ValueError(
                    "finding evidence has no valid kind: %r" % finding["comment"][:60])
            if not ev.get("detail"):
                raise ValueError(
                    "finding evidence has no detail: %r" % finding["comment"][:60])
            if bucket == "anchored" and not finding.get("quote"):
                raise ValueError(
                    "anchored finding has no quote: %r" % finding["comment"][:60])


def _counts(payload):
    counts = {"blocker": 0, "major": 0, "minor": 0}
    for finding in list(payload["anchored"]) + list(payload["gaps"]):
        for sev in counts:
            if finding["comment"].startswith("[%s]" % sev):
                counts[sev] += 1
    return counts


def _severity_key(finding):
    for i, s in enumerate(SEVERITIES):
        if finding["comment"].startswith(s):
            return i
    return len(SEVERITIES)


def render_audit(payload):
    """The artifact: prose a human reads, then the fence the board parses."""
    counts = _counts(payload)
    # The plan lives at plans/execution/<component>/<file>; this artifact lives
    # at plans/reviews/, so the link is ../execution/... — matching
    # templates/review-scorecard.md:3.
    plan_file = payload["planPath"].rsplit("/", 1)[-1]
    link = "../execution/%s/%s" % (payload["component"], plan_file)
    lines = [
        "# Audit — %s v%s" % (payload["component"], payload["planVersion"]),
        "",
        "Plan: [%s](%s) · Reviewer: **%s** · Date: %s"
        % (plan_file, link, payload["reviewer"].get("token", "?"), payload["date"]),
        "Findings: **%d blocker · %d major · %d minor**"
        % (counts["blocker"], counts["major"], counts["minor"]),
        "",
        "## Overall",
        "",
        payload["overall"],
        "",
    ]
    for label, bucket in (("Anchored", "anchored"), ("Gaps", "gaps")):
        lines += ["## %s" % label, ""]
        if not payload[bucket]:
            lines += ["None.", ""]
            continue
        for finding in sorted(payload[bucket], key=_severity_key):
            ev = finding.get("evidence") or {}
            lines.append("- %s" % finding["comment"])
            if finding.get("quote"):
                lines.append('  - quote: "%s"' % finding["quote"])
            lines.append("  - evidence: `%s` (%s) — %s"
                         % (ev.get("path", ""), ev.get("kind", "direct"), ev.get("detail", "")))
        lines.append("")
    lines += ["## Data", "", "```json board-audit",
              json.dumps(payload, indent=1, sort_keys=True), "```"]
    return "\n".join(lines) + "\n"


def _atomic_write(target, text):
    mode = stat.S_IMODE(target.stat().st_mode) if target.exists() else 0o644
    fd, tmpname = tempfile.mkstemp(dir=str(target.parent), prefix=target.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        os.chmod(tmpname, mode)
        os.replace(tmpname, target)
    except BaseException:
        try:
            os.unlink(tmpname)
        except OSError:
            pass
        raise


def write_audit(root, component, version, payload):
    """Validate, then atomically replace this component-version's audit under
    the per-component lock.

    Validation runs BEFORE any file is touched, so a malformed payload can
    never leave a partial fence for a reader. An existing audit with the same
    FULL identity — plan hash AND context identity — that already carries
    dispositions is never replaced: those dispositions were made about exactly
    this text against exactly this repository state, and a background run
    returning late must not silently discard them. Comparing the plan hash
    alone would wrongly refuse a genuinely newer audit taken at a new HEAD.

    `supersedes` is stamped from the read INSIDE the lock, so it always names
    the artifact this write actually replaces.
    """
    payload.setdefault("schemaVersion", SCHEMA_VERSION)
    _validate(payload)
    target = audit_path(root, component, version)
    target.parent.mkdir(parents=True, exist_ok=True)
    with audit_lock(root, component, version):
        existing = read_audit(root, component, version)
        if existing and existing.get("dispositions"):
            same_identity = (
                existing.get("auditPlanHash") == payload.get("auditPlanHash")
                and existing.get("contextIdentity") == payload.get("contextIdentity")
            )
            if same_identity:
                raise AuditLocked(
                    "audit for %s v%s already carries dispositions at this identity"
                    % (component, version))
        payload["supersedes"] = (existing or {}).get("auditPlanHash")
        _atomic_write(target, render_audit(payload))
    return target


def read_audit(root, component, version):
    p = audit_path(root, component, version)
    if not p.is_file():
        return None
    try:
        raw = p.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    marker = "```json board-audit"
    start = raw.find(marker)
    if start < 0:
        return None
    body = raw[start + len(marker):]
    end = body.find("```")
    if end < 0:
        return None
    try:
        return json.loads(body[:end])
    except ValueError:
        return None


def is_current(audit_record, plan_text, root):
    """Current iff BOTH identities match: the plan text AND the repository
    state the findings rest on. Plan text alone is not enough — an audit that
    confirmed a path exists goes wrong when that path is renamed with the plan
    untouched."""
    if not audit_record:
        return False
    if audit_record.get("auditPlanHash") != audit_plan_hash(plan_text):
        return False
    recorded = audit_record.get("contextIdentity") or {}
    fresh = context_identity(root, list((recorded.get("paths") or {}).keys()))
    return (recorded.get("paths") or {}) == fresh["paths"] and recorded.get("head") == fresh["head"]
```

- [ ] **Step 4: Run them to verify they pass**

Run: `python3 -m unittest tests.test_audit -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add skills/managing-planboard/scripts/audit.py tests/test_audit.py
git commit -m "audit: locked atomic artifact writes with evidence-enforcing validation"
```

---

### Task 6: Codex dispatch, JSON recovery, and one repair re-prompt

The runner lives in Python so the trigger commands need no new Bash permission beyond the `Bash(python3:*)` they already carry.

**Files:**
- Modify: `skills/managing-planboard/scripts/audit.py`
- Modify: `tests/test_audit.py`

**Interfaces:**
- Consumes: Tasks 4 and 5.
- Produces: `build_prompt`, `parse_reviewer_json`, `CODEX_MODELS`, `run_codex_audit(root, token, effort, prompt_path, out_path, _which=None, _run=None) -> {"ok", "reason", "payload"}`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_audit.py`:

```python
GOOD_JSON = '{"overall": "ok", "anchored": [], "gaps": []}'


class TestParseReviewerJson(unittest.TestCase):
    def test_takes_the_last_balanced_object(self):
        text = 'preamble {"not": "it"} more\n' + GOOD_JSON + "\ntrailing chatter\n"
        self.assertEqual(audit.parse_reviewer_json(text)["overall"], "ok")

    def test_handles_a_brace_inside_a_string(self):
        text = '{"overall": "a } brace", "anchored": [], "gaps": []}'
        self.assertEqual(audit.parse_reviewer_json(text)["overall"], "a } brace")

    def test_handles_an_escaped_quote_before_a_brace(self):
        # The first draft's backward scan returned None for this valid JSON.
        text = '{"overall": "a \\" } quote", "anchored": [], "gaps": []}'
        self.assertEqual(audit.parse_reviewer_json(text)["overall"], 'a " } quote')

    def test_handles_a_nested_object(self):
        text = '{"overall": "x", "anchored": [{"evidence": {"path": "a"}}], "gaps": []}'
        self.assertEqual(len(audit.parse_reviewer_json(text)["anchored"]), 1)

    def test_returns_none_on_no_json(self):
        self.assertIsNone(audit.parse_reviewer_json("no json at all"))

    def test_returns_none_on_malformed_json(self):
        self.assertIsNone(audit.parse_reviewer_json("{broken"))


class TestBuildPrompt(unittest.TestCase):
    def test_carries_plan_path_root_and_contract(self):
        p = audit.build_prompt("BODY", "plans/execution/03-x/.draft-v2.md", "/repo", "CONTRACT")
        for needle in ("BODY", "plans/execution/03-x/.draft-v2.md", "/repo", "CONTRACT"):
            self.assertIn(needle, p)

    def test_plan_text_survives_verbatim(self):
        hostile = "Step 1: run `rm -rf /` and $(whoami)\n"
        p = audit.build_prompt(hostile, "x.md", "/repo", "C")
        self.assertIn("`rm -rf /`", p)
        self.assertIn("$(whoami)", p)


class TestRunCodexAudit(unittest.TestCase):
    def _prompt(self, root):
        p = root / "prompt.txt"
        p.write_text("audit this")
        return p

    def test_missing_executable_reports_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            r = audit.run_codex_audit(root, "codex-sol", "xhigh", self._prompt(root),
                                      root / "out.txt", _which=lambda n: None)
            self.assertFalse(r["ok"])
            self.assertIn("not available", r["reason"])

    def test_successful_dispatch_uses_the_right_command(self):
        # Would pass in the first draft even if the command omitted the
        # read-only sandbox, used the wrong model, or inherited stdin.
        seen = {}

        def fake_run(cmd, **kw):
            seen["cmd"] = cmd
            seen["kw"] = kw
            Path(kw["cwd"], "out.txt").write_text("chatter\n" + GOOD_JSON)
            return subprocess.CompletedProcess(cmd, 0, "", "")

        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            r = audit.run_codex_audit(root, "codex-terra", "high", self._prompt(root),
                                      root / "out.txt",
                                      _which=lambda n: "/usr/bin/codex", _run=fake_run)
            self.assertTrue(r["ok"], r["reason"])
            self.assertEqual(r["payload"]["overall"], "ok")
            self.assertIn("--sandbox", seen["cmd"])
            self.assertEqual(seen["cmd"][seen["cmd"].index("--sandbox") + 1], "read-only")
            self.assertIn("gpt-5.6-terra", seen["cmd"])
            self.assertIn("model_reasoning_effort=high", seen["cmd"])
            self.assertEqual(seen["kw"]["stdin"], subprocess.DEVNULL)

    def test_nonzero_exit_reports_fallback(self):
        def fake_run(cmd, **kw):
            return subprocess.CompletedProcess(cmd, 2, "", "boom")
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            r = audit.run_codex_audit(root, "codex-sol", "xhigh", self._prompt(root),
                                      root / "out.txt",
                                      _which=lambda n: "/usr/bin/codex", _run=fake_run)
            self.assertFalse(r["ok"])
            self.assertIn("exited 2", r["reason"])

    def test_unparseable_output_is_retried_once_then_falls_back(self):
        calls = []

        def fake_run(cmd, **kw):
            calls.append(cmd)
            Path(kw["cwd"], "out.txt").write_text("no json here")
            return subprocess.CompletedProcess(cmd, 0, "", "")

        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            r = audit.run_codex_audit(root, "codex-sol", "xhigh", self._prompt(root),
                                      root / "out.txt",
                                      _which=lambda n: "/usr/bin/codex", _run=fake_run)
            self.assertEqual(len(calls), 2, "spec requires exactly one repair re-prompt")
            self.assertFalse(r["ok"])

    def test_repair_reprompt_can_succeed(self):
        calls = []

        def fake_run(cmd, **kw):
            calls.append(cmd)
            body = "garbage" if len(calls) == 1 else GOOD_JSON
            Path(kw["cwd"], "out.txt").write_text(body)
            return subprocess.CompletedProcess(cmd, 0, "", "")

        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            r = audit.run_codex_audit(root, "codex-sol", "xhigh", self._prompt(root),
                                      root / "out.txt",
                                      _which=lambda n: "/usr/bin/codex", _run=fake_run)
            self.assertTrue(r["ok"])
            self.assertEqual(len(calls), 2)

    def test_unknown_token_reports_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            r = audit.run_codex_audit(root, "subagent", "xhigh", self._prompt(root),
                                      root / "out.txt", _which=lambda n: "/usr/bin/codex")
            self.assertFalse(r["ok"])

    def test_parseable_but_contract_violating_output_triggers_the_repair(self):
        # Well-formed JSON that breaks the contract must get the re-prompt, not
        # be returned as a success that fails later at write time.
        calls = []
        bad = json.dumps({"overall": "x", "anchored": [],
                          "gaps": [{"section": "", "comment": "no severity tag"}]})

        def fake_run(cmd, **kw):
            calls.append(cmd)
            Path(kw["cwd"], "out.txt").write_text(bad if len(calls) == 1 else GOOD_JSON)
            return subprocess.CompletedProcess(cmd, 0, "", "")

        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            r = audit.run_codex_audit(root, "codex-sol", "xhigh", self._prompt(root),
                                      root / "out.txt",
                                      _which=lambda n: "/usr/bin/codex", _run=fake_run)
            self.assertEqual(len(calls), 2)
            self.assertTrue(r["ok"])

    def test_still_violating_after_the_repair_reports_the_reason(self):
        bad = json.dumps({"overall": "x", "anchored": [],
                          "gaps": [{"section": "", "comment": "no severity tag"}]})

        def fake_run(cmd, **kw):
            Path(kw["cwd"], "out.txt").write_text(bad)
            return subprocess.CompletedProcess(cmd, 0, "", "")

        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            r = audit.run_codex_audit(root, "codex-sol", "xhigh", self._prompt(root),
                                      root / "out.txt",
                                      _which=lambda n: "/usr/bin/codex", _run=fake_run)
            self.assertFalse(r["ok"])
            self.assertIn("severity", r["reason"])
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m unittest tests.test_audit -v`
Expected: FAIL with `AttributeError: module 'audit' has no attribute 'parse_reviewer_json'`

- [ ] **Step 3: Write the implementation**

Append to `audit.py`:

```python
CODEX_MODELS = {
    "codex-sol": "gpt-5.6-sol",
    "codex-terra": "gpt-5.6-terra",
    "codex-luna": "gpt-5.6-luna",
}
REPAIR_SUFFIX = (
    "\n\nYour previous reply could not be parsed. Reply with ONLY the JSON "
    "object described in the output contract — no prose before or after it.\n"
)


def reviewer_payload_problem(payload):
    """None when a reviewer payload satisfies the three-key contract, else a
    short reason. Shares its rules with _validate so a payload that passes here
    cannot fail at write time — the reviewer gets a repair re-prompt instead of
    a lost audit."""
    if not isinstance(payload, dict):
        return "not an object"
    if not isinstance(payload.get("overall"), str) or not payload["overall"].strip():
        return "missing 'overall'"
    for bucket in ("anchored", "gaps"):
        if not isinstance(payload.get(bucket), list):
            return "'%s' is not a list" % bucket
        for finding in payload[bucket]:
            if not isinstance(finding, dict) or not isinstance(finding.get("comment"), str):
                return "a finding has no string 'comment'"
            if not any(finding["comment"].startswith(s) for s in SEVERITIES):
                return "a finding has no severity tag"
            ev = finding.get("evidence")
            if not isinstance(ev, dict) or not ev.get("path") or not ev.get("detail"):
                return "a finding has no evidence path and detail"
            if ev.get("kind") not in ("direct", "inferred"):
                return "a finding's evidence has no valid kind"
            if bucket == "anchored" and not finding.get("quote"):
                return "an anchored finding has no quote"
    return None


def build_prompt(plan_text, plan_path, root, contract):
    """The audit prompt. Written to a FILE by the caller and passed with a
    shell-safe substitution, never interpolated into a command line — a plan
    containing backticks or $(...) must not be shell-expanded."""
    return (
        "<task>\n"
        "Audit ONE execution plan for technical correctness against this repository.\n"
        "You are NOT scoring it. A separate reviewer scores it as a governance\n"
        "contract. Your question: executed as written, against this repository and\n"
        "this data, will this plan produce what it claims?\n\n"
        "Plan path: %s\n"
        "Repository root: %s\n"
        "</task>\n\n"
        "<plan>\n%s\n</plan>\n\n"
        "%s\n"
    ) % (plan_path, root, plan_text, contract)


def _scan_object(text, end):
    """Return the balanced object ending at `end`, or None. Scans FORWARD from
    each candidate start so string and escape state is tracked in the direction
    the grammar is written — a backward scan cannot tell an escaped quote from
    a real one."""
    start = text.rfind("{", 0, end + 1)
    while start != -1:
        depth = 0
        in_str = False
        esc = False
        for i in range(start, end + 1):
            ch = text[i]
            if esc:
                esc = False
            elif in_str:
                if ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    if i == end:
                        try:
                            return json.loads(text[start:end + 1])
                        except ValueError:
                            break
                    break
        start = text.rfind("{", 0, start)
    return None


def parse_reviewer_json(text):
    """The LAST balanced JSON object in reviewer output. Reviewers wrap their
    answer in prose, so a first-match scan picks up the wrong object."""
    end = text.rfind("}")
    while end != -1:
        got = _scan_object(text, end)
        if got is not None:
            return got
        end = text.rfind("}", 0, end)
    return None


def run_codex_audit(root, token, effort, prompt_path, out_path, _which=None, _run=None):
    """Dispatch Codex read-only, with exactly one repair re-prompt on
    unparseable output. Returns ok=False with a reason on every failure mode —
    missing executable, unknown token, nonzero exit, timeout, or still-
    unparseable output — so the caller can fall back to pb-plan-auditor. The
    audit is never silently skipped: a skipped audit reads as a clean bill of
    health."""
    which = _which or shutil.which
    runner = _run or subprocess.run
    if which("codex") is None:
        return {"ok": False, "reason": "codex is not available on PATH", "payload": None}
    model = CODEX_MODELS.get(token)
    if model is None:
        return {"ok": False, "reason": "%r is not a codex reviewer token" % token,
                "payload": None}

    prompt = prompt_path.read_text(encoding="utf-8")
    for attempt in (0, 1):
        cmd = [
            "codex", "exec", "--sandbox", "read-only",
            "-m", model,
            "-c", "model_reasoning_effort=%s" % effort,
            "-o", str(out_path),
            prompt if attempt == 0 else prompt + REPAIR_SUFFIX,
        ]
        try:
            proc = runner(cmd, cwd=str(root), capture_output=True, text=True,
                          timeout=1800, stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            return {"ok": False, "reason": "codex timed out after 30 minutes", "payload": None}
        except OSError as e:
            return {"ok": False, "reason": "could not launch codex (%s)" % e, "payload": None}
        if proc.returncode != 0:
            return {"ok": False,
                    "reason": "codex exited %d: %s" % (proc.returncode, (proc.stderr or "")[:200]),
                    "payload": None}
        try:
            text = Path(out_path).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as e:
            return {"ok": False, "reason": "could not read codex output (%s)" % e,
                    "payload": None}
        payload = parse_reviewer_json(text)
        # The repair must fire on a CONTRACT violation, not only on
        # unparseable text. A well-formed JSON object missing `overall`, or
        # carrying a finding with no severity tag or no evidence, is exactly
        # the case one re-prompt is meant to fix; returning ok=True here would
        # instead surface it later as a write failure and a lost audit.
        problem = None if payload is None else reviewer_payload_problem(payload)
        if payload is not None and problem is None:
            return {"ok": True, "reason": "", "payload": payload}
        last = problem or "no parseable JSON object"
    return {"ok": False,
            "reason": "codex output did not satisfy the contract after one repair (%s)" % last,
            "payload": None}
```

`stdin=subprocess.DEVNULL` is load-bearing: Codex launched from an agent harness with inherited stdin hangs indefinitely at 0% CPU with no output.

- [ ] **Step 4: Run them to verify they pass**

Run: `python3 -m unittest tests.test_audit -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add skills/managing-planboard/scripts/audit.py tests/test_audit.py
git commit -m "audit: codex dispatch with forward-scan JSON recovery and one repair re-prompt"
```

---

### Task 7: The `run` and `record-fallback` CLI

**Files:**
- Modify: `skills/managing-planboard/scripts/audit.py`
- Modify: `tests/test_audit.py`
- Modify: `skills/managing-planboard/scripts/board.py:85-103` (the runtime ignore list)

**Interfaces:**
- Consumes: Tasks 3-6.
- Produces:
  - `python3 audit.py --root <root> run --component <NN-slug> --version <N> --plan <path>` — exit 0 written or already current, 3 fallback required, 1 error.
  - `python3 audit.py --root <root> record-fallback --component <NN-slug> --version <N> --plan <path> --json <file> --reason <text> --expected-plan-hash <hex>` — turns a subagent's JSON into the artifact, refusing it when the plan has changed since the subagent saw it. Task 11 calls it.
  - `--plan` accepts a repo-relative or absolute path on both subcommands.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_audit.py`. Note every fixture here writes a profile, but the implementation must also survive one that does not — that is the `FileNotFoundError` the first draft shipped.

```python
import models  # noqa: E402  (already on sys.path via SCRIPTS)

TEMPLATES = SCRIPTS.parent / "templates"


def audit_project(tmp, with_profile=True):
    root = project(tmp)
    (root / "plans" / "master-plan.md").write_text("<!-- planboard:master-plan -->\n")
    if with_profile:
        (root / "plans" / "model-profile.md").write_text(
            (TEMPLATES / "model-profile.md").read_text(encoding="utf-8"), encoding="utf-8")
    plan = root / "plans" / "execution" / "03-attrition" / ".draft-v2.md"
    plan.write_text(PLAN)
    return root, plan


def run_cli(root, argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = audit.main(["--root", str(root)] + argv)
    return code, out.getvalue()


class TestRunCli(unittest.TestCase):
    def test_skips_when_a_current_audit_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, plan = audit_project(tmp)
            audit.write_audit(root, "03-attrition", 2, payload(
                auditPlanHash=audit.audit_plan_hash(PLAN),
                contextIdentity=audit.context_identity(root, [])))
            code, out = run_cli(root, ["run", "--component", "03-attrition",
                                       "--version", "2", "--plan", str(plan)])
            self.assertEqual(code, 0)
            self.assertIn("current", out)

    def test_signals_fallback_when_codex_is_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, plan = audit_project(tmp)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = audit.main(["--root", str(root), "run", "--component", "03-attrition",
                                   "--version", "2", "--plan", str(plan)],
                                  _which=lambda n: None)
            self.assertEqual(code, 3)
            self.assertIn("fallback", out.getvalue().lower())

    def test_a_project_with_no_profile_does_not_crash(self):
        # The first draft read model-profile.md unconditionally.
        with tempfile.TemporaryDirectory() as tmp:
            root, plan = audit_project(tmp, with_profile=False)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = audit.main(["--root", str(root), "run", "--component", "03-attrition",
                                   "--version", "2", "--plan", str(plan)],
                                  _which=lambda n: None)
            self.assertIn(code, (0, 3))

    def test_subagent_token_signals_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, plan = audit_project(tmp)
            p = root / "plans" / "model-profile.md"
            p.write_text(p.read_text().replace("codex-sol", "subagent"))
            code, out = run_cli(root, ["run", "--component", "03-attrition",
                                       "--version", "2", "--plan", str(plan)])
            self.assertEqual(code, 3)

    def test_missing_plan_file_is_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, _ = audit_project(tmp)
            code, _ = run_cli(root, ["run", "--component", "03-attrition",
                                     "--version", "2", "--plan", str(root / "nope.md")])
            self.assertEqual(code, 1)

    def test_a_repo_relative_plan_path_works(self):
        # /planboard:plan passes plans/execution/..., not an absolute path.
        # Leaving it relative while root is absolute makes relative_to() raise.
        with tempfile.TemporaryDirectory() as tmp:
            root, _ = audit_project(tmp)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = audit.main(
                    ["--root", str(root), "run", "--component", "03-attrition",
                     "--version", "2",
                     "--plan", "plans/execution/03-attrition/.draft-v2.md"],
                    _which=lambda n: None)
            self.assertEqual(code, 3)
            self.assertNotIn("not found", out.getvalue())

    def test_a_plan_outside_the_repository_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, _ = audit_project(tmp)
            with tempfile.TemporaryDirectory() as other:
                stray = Path(other) / "stray.md"
                stray.write_text(PLAN)
                code, out = run_cli(root, ["run", "--component", "03-attrition",
                                           "--version", "2", "--plan", str(stray)])
                self.assertEqual(code, 1)
                self.assertIn("outside the repository", out)

    def test_a_plan_edited_during_the_run_is_not_published(self):
        # A 30-minute audit must not publish findings about text that changed
        # while it was thinking.
        with tempfile.TemporaryDirectory() as tmp:
            root, plan = audit_project(tmp)

            def fake_run(cmd, **kw):
                plan.write_text(PLAN + "\nA step added mid-run.\n")
                # Write to the -o path the implementation actually passed, not
                # a guessed one: out_path lives under plans/, not root.
                Path(cmd[cmd.index("-o") + 1]).write_text(GOOD_JSON)
                return subprocess.CompletedProcess(cmd, 0, "", "")

            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                code = audit.main(["--root", str(root), "run", "--component", "03-attrition",
                                   "--version", "2", "--plan", str(plan)],
                                  _which=lambda n: "/usr/bin/codex", _run=fake_run)
            self.assertEqual(code, 1)
            self.assertIn("changed during", buf.getvalue())
            self.assertIsNone(audit.read_audit(root, "03-attrition", 2))

    def test_writes_the_artifact_with_both_identities(self):
        def fake_run(cmd, **kw):
            Path(cmd[cmd.index("-o") + 1]).write_text(json.dumps({
                "overall": "one gap",
                "anchored": [],
                "gaps": [FINDING],
            }))
            return subprocess.CompletedProcess(cmd, 0, "", "")

        with tempfile.TemporaryDirectory() as tmp:
            root, plan = audit_project(tmp)
            (root / "analysis").mkdir()
            (root / "analysis" / "fit.R").write_text("fit\n")
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                code = audit.main(["--root", str(root), "run", "--component", "03-attrition",
                                   "--version", "2", "--plan", str(plan)],
                                  _which=lambda n: "/usr/bin/codex", _run=fake_run)
            self.assertEqual(code, 0, buf.getvalue())
            rec = audit.read_audit(root, "03-attrition", 2)
            self.assertEqual(rec["auditPlanHash"], audit.audit_plan_hash(PLAN))
            self.assertIn("analysis/fit.R", rec["contextIdentity"]["paths"])
            self.assertEqual(rec["reviewer"]["token"], "codex-sol")

    def test_temp_files_are_cleaned_up(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, plan = audit_project(tmp)
            with contextlib.redirect_stdout(io.StringIO()):
                audit.main(["--root", str(root), "run", "--component", "03-attrition",
                            "--version", "2", "--plan", str(plan)], _which=lambda n: None)
            self.assertEqual(list((root / "plans").glob(".pb-audit-*")), [])


class TestRecordFallback(unittest.TestCase):
    def test_writes_an_artifact_marked_as_a_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, plan = audit_project(tmp)
            (root / "analysis").mkdir()
            (root / "analysis" / "fit.R").write_text("fit\n")
            blob = root / "sub.json"
            blob.write_text(json.dumps({"overall": "from the subagent",
                                        "anchored": [], "gaps": [FINDING]}))
            code, _ = run_cli(root, ["record-fallback", "--component", "03-attrition",
                                     "--version", "2", "--plan", str(plan),
                                     "--json", str(blob),
                                     "--reason", "codex is not available on PATH",
                                     "--expected-plan-hash", audit.audit_plan_hash(PLAN)])
            self.assertEqual(code, 0)
            rec = audit.read_audit(root, "03-attrition", 2)
            self.assertEqual(rec["reviewer"]["token"], "subagent")
            self.assertEqual(rec["reviewer"]["reviewerFallback"],
                             "codex is not available on PATH")
            self.assertEqual(rec["auditPlanHash"], audit.audit_plan_hash(PLAN))

    def test_a_plan_edited_since_the_subagent_saw_it_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, plan = audit_project(tmp)
            blob = root / "sub.json"
            blob.write_text(json.dumps({"overall": "x", "anchored": [], "gaps": []}))
            stale = audit.audit_plan_hash(PLAN)
            plan.write_text(PLAN + "\nEdited after the subagent ran.\n")
            code, out = run_cli(root, ["record-fallback", "--component", "03-attrition",
                                       "--version", "2", "--plan", str(plan),
                                       "--json", str(blob), "--reason", "x",
                                       "--expected-plan-hash", stale])
            self.assertEqual(code, 1)
            self.assertIn("changed since", out)
            self.assertIsNone(audit.read_audit(root, "03-attrition", 2))

    def test_contract_violating_subagent_json_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, plan = audit_project(tmp)
            blob = root / "sub.json"
            blob.write_text(json.dumps({"overall": "x", "anchored": [],
                                        "gaps": [{"section": "", "comment": "no tag"}]}))
            code, out = run_cli(root, ["record-fallback", "--component", "03-attrition",
                                       "--version", "2", "--plan", str(plan),
                                       "--json", str(blob), "--reason", "x",
                                       "--expected-plan-hash", audit.audit_plan_hash(PLAN)])
            self.assertEqual(code, 1)
            self.assertIn("contract", out)

    def test_malformed_subagent_json_is_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, plan = audit_project(tmp)
            blob = root / "sub.json"
            blob.write_text("{not json")
            code, _ = run_cli(root, ["record-fallback", "--component", "03-attrition",
                                     "--version", "2", "--plan", str(plan),
                                     "--json", str(blob), "--reason", "x",
                                     "--expected-plan-hash", audit.audit_plan_hash(PLAN)])
            self.assertEqual(code, 1)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m unittest tests.test_audit -v`
Expected: FAIL with `AttributeError: module 'audit' has no attribute 'main'`

- [ ] **Step 3: Write the implementation**

Append to `audit.py`:

```python
EXIT_OK = 0
EXIT_ERROR = 1
EXIT_FALLBACK = 3  # caller must dispatch pb-plan-auditor via Task

CONTRACT = (
    "<output_contract>\n"
    'Return strict JSON with exactly three keys: {"overall": "<one paragraph>", '
    '"anchored": [...], "gaps": [...]}.\n'
    "An `anchored` finding is about text IN the plan and carries a short verbatim "
    "`quote` with markdown stripped. A `gap` is about something the plan NEVER says "
    "and carries no quote. Do not force a gap into an anchor.\n"
    "There is no cap on findings. Every finding must (1) name the concrete failure it "
    "predicts at execution time, and (2) carry an `evidence` object "
    '{"path", "kind": "direct"|"inferred", "detail"} naming a repository or data path '
    "you actually opened. Drop any finding failing either test.\n"
    "Begin each comment with exactly one of [blocker], [major], [minor]. "
    "Order most severe first.\n"
    "</output_contract>\n"
)


def _evidence_paths(payload):
    return sorted({
        (f.get("evidence") or {}).get("path")
        for f in list(payload.get("anchored") or []) + list(payload.get("gaps") or [])
        if (f.get("evidence") or {}).get("path")
    })


def _finalize(root, component, version, plan_file, plan_text, payload, token, effort,
              fallback_reason):
    """Stamp identities onto a reviewer payload and write it.

    `plan_text` is the text the reviewer ACTUALLY audited, passed in by the
    caller — this function never re-reads the file. A third read would let an
    edit between the caller's check and this write produce findings about one
    text stamped with another text's hash, after which is_current() would
    happily call that audit current. `supersedes` is stamped by write_audit
    under the lock, not here.
    """
    payload.setdefault("anchored", [])
    payload.setdefault("gaps", [])
    reviewer = {"token": token, "effort": effort}
    if fallback_reason:
        reviewer["reviewerFallback"] = fallback_reason
    payload.update({
        "component": component,
        "planVersion": version,
        "planPath": str(plan_file.relative_to(root)),
        "date": datetime.date.today().isoformat(),
        "reviewer": reviewer,
        "auditPlanHash": audit_plan_hash(plan_text),
        "contextIdentity": context_identity(root, _evidence_paths(payload)),
        "dispositions": [],
    })
    return write_audit(root, component, version, payload)


def _resolve_row(root):
    import models
    models.ensure_audit_stage(root)
    stages, _warnings, _exists = models.load_profile(root)
    return stages.get("plan-audit") or {"model": "codex-sol", "effort": "xhigh"}


def main(argv=None, _which=None, _run=None):
    parser = argparse.ArgumentParser(prog="audit.py")
    parser.add_argument("--root", default=None)
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("run", "record-fallback"):
        s = sub.add_parser(name)
        s.add_argument("--component", required=True)
        s.add_argument("--version", type=int, required=True)
        s.add_argument("--plan", required=True)
        if name == "record-fallback":
            s.add_argument("--json", required=True)
            s.add_argument("--reason", required=True)
            s.add_argument("--expected-plan-hash", required=True)
    args = parser.parse_args(argv)

    root = Path(args.root).resolve() if args.root else Path.cwd()
    # The trigger commands pass a repo-relative path, so resolve it against
    # root before any relative_to() call. Leaving it relative while root is
    # absolute makes plan_file.relative_to(root) raise ValueError.
    raw_plan = Path(args.plan)
    plan_file = (raw_plan if raw_plan.is_absolute() else root / raw_plan).resolve()
    if not plan_file.is_file():
        print("audit: plan not found: %s" % args.plan)
        return EXIT_ERROR
    try:
        plan_rel = plan_file.relative_to(root)
    except ValueError:
        print("audit: plan is outside the repository: %s" % args.plan)
        return EXIT_ERROR
    plan_text = plan_file.read_text(encoding="utf-8")

    if args.cmd == "record-fallback":
        # The subagent audited whatever the command showed it. Refuse to stamp
        # this artifact unless that text is still what is on disk, or the
        # audit would claim currency for text nobody reviewed.
        if audit_plan_hash(plan_text) != args.expected_plan_hash:
            print("audit: the plan changed since the fallback reviewer saw it — discarding")
            return EXIT_ERROR
        try:
            payload = json.loads(Path(args.json).read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            print("audit: could not read fallback JSON (%s)" % e)
            return EXIT_ERROR
        problem = reviewer_payload_problem(payload)
        if problem:
            print("audit: fallback JSON does not satisfy the contract (%s)" % problem)
            return EXIT_ERROR
        row = _resolve_row(root)
        try:
            _finalize(root, args.component, args.version, plan_file, plan_text, payload,
                      "subagent", row["effort"], args.reason)
        except (ValueError, AuditLocked) as e:
            print("audit: not written (%s)" % e)
            return EXIT_ERROR
        print("audit: wrote %s v%d from the fallback reviewer"
              % (args.component, args.version))
        return EXIT_OK

    existing = read_audit(root, args.component, args.version)

    if existing and is_current(existing, plan_text, root):
        print("audit: current for %s v%d — no reviewer run" % (args.component, args.version))
        return EXIT_OK

    row = _resolve_row(root)
    if row["model"] not in CODEX_MODELS:
        print("audit: profile selects %r — fallback dispatch required" % row["model"])
        return EXIT_FALLBACK

    plans_dir = root / "plans"
    prompt_path = plans_dir / (".pb-audit-%s-v%d.txt" % (args.component, args.version))
    out_path = plans_dir / (".pb-audit-out-%s-v%d.txt" % (args.component, args.version))
    try:
        prompt_path.write_text(
            build_prompt(plan_text, str(plan_rel), str(root), CONTRACT), encoding="utf-8")
        result = run_codex_audit(root, row["model"], row["effort"], prompt_path, out_path,
                                 _which=_which, _run=_run)
        if not result["ok"]:
            print("audit: %s — fallback dispatch required" % result["reason"])
            return EXIT_FALLBACK
        # Re-read before publishing: a reviewer run takes minutes, and findings
        # about text that has since changed must never be published as current.
        # `plan_text` — the text actually audited — is what _finalize stamps,
        # so the artifact and its hash can never describe different bytes.
        if plan_file.read_text(encoding="utf-8") != plan_text:
            print("audit: the plan changed during the reviewer run — discarding this audit")
            return EXIT_ERROR
        try:
            _finalize(root, args.component, args.version, plan_file, plan_text,
                      result["payload"], row["model"], row["effort"], None)
        except (ValueError, AuditLocked) as e:
            print("audit: not written (%s)" % e)
            return EXIT_ERROR
        n = len(result["payload"]["anchored"]) + len(result["payload"]["gaps"])
        print("audit: wrote %s v%d — %d findings" % (args.component, args.version, n))
        return EXIT_OK
    finally:
        for p in (prompt_path, out_path):
            try:
                p.unlink()
            except OSError:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Add the temp files to the runtime ignore list**

The `.pb-audit-*` files live under a *user's* `plans/`, not this repository, so the repo `.gitignore` is the wrong place. Add the pattern where the board already ignores its own temp files, `board.py:85-103`, alongside the existing `.pb-review-*` entry. Read that list first and match its exact idiom. Add the lock pattern too — `plans/reviews/.*-audit.lock` — so a lock held during a board export or share never reaches a collaborator.

- [ ] **Step 5: Run the full Python suite**

Run: `python3 -m unittest discover -s tests`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add skills/managing-planboard/scripts/audit.py skills/managing-planboard/scripts/board.py tests/test_audit.py
git commit -m "audit: run and record-fallback CLI with pre-publication plan re-read"
```

---

### Task 8: Board types and the `board-audit` parser

**Warning:** `board/src/lib/parse.ts` contains a raw NUL byte at line 451, so `grep` treats the whole file as binary and silently returns nothing. Use a file-reading tool on it, not grep.

**Files:**
- Modify: `board/src/lib/types.ts` (append the audit types)
- Modify: `board/src/lib/parse.ts` (append `parseAudit` after `parseScorecard` at line 376)
- Test: `board/src/lib/parse.audit.test.ts`

**Interfaces:**
- Consumes: the fence written by Task 5's `render_audit`.
- Produces: `parseAudit(raw) => Audit | null`, plus `Audit`, `AuditFinding`, `AuditEvidence`, `AuditSeverity`. Tasks 9 and 10 import them.

- [ ] **Step 1: Write the failing test**

Create `board/src/lib/parse.audit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseAudit } from "./parse";

const fence = (obj: unknown) =>
  `# Audit\n\nprose\n\n## Data\n\n\`\`\`json board-audit\n${JSON.stringify(obj)}\n\`\`\`\n`;

const finding = (comment: string, over: Record<string, unknown> = {}) => ({
  section: "Steps",
  quote: "Run the model",
  evidence: { path: "analysis/fit.R", kind: "direct", detail: "no seed set" },
  comment,
  ...over,
});

const VALID = {
  schemaVersion: 1,
  component: "03-attrition",
  planVersion: 2,
  planPath: "plans/execution/03-attrition/v2.md",
  date: "2026-07-25",
  reviewer: { token: "codex-sol", effort: "xhigh" },
  auditPlanHash: "a".repeat(64),
  overall: "Two gaps.",
  anchored: [finding("[blocker] No seed. At execution: results are irreproducible.")],
  gaps: [finding("[major] No missingness rule. At execution: listwise drops 2019.", { quote: undefined })],
  dispositions: [],
};

describe("parseAudit", () => {
  it("parses a valid fence", () => {
    const a = parseAudit(fence(VALID))!;
    expect(a.component).toBe("03-attrition");
    expect(a.anchored).toHaveLength(1);
    expect(a.gaps).toHaveLength(1);
  });

  it("exposes severity counts", () => {
    expect(parseAudit(fence(VALID))!.counts).toEqual({ blocker: 1, major: 1, minor: 0 });
  });

  it("orders findings most severe first within each bucket", () => {
    const many = {
      ...VALID,
      gaps: [
        finding("[minor] Small. At execution: nothing breaks.", { quote: undefined }),
        finding("[blocker] Big. At execution: it crashes.", { quote: undefined }),
        finding("[major] Medium. At execution: wrong numbers.", { quote: undefined }),
      ],
    };
    expect(parseAudit(fence(many))!.gaps.map((f) => f.severity)).toEqual([
      "blocker",
      "major",
      "minor",
    ]);
  });

  it("returns null with no fence", () => {
    expect(parseAudit("# Audit\n\nNo fence here")).toBeNull();
  });

  it("returns null on broken JSON", () => {
    expect(parseAudit("```json board-audit\n{broken\n```")).toBeNull();
  });

  it("returns null when a bucket is not an array", () => {
    expect(parseAudit(fence({ ...VALID, gaps: "nope" }))).toBeNull();
  });

  it("does not parse a scorecard fence", () => {
    expect(parseAudit('```json board-scorecard\n{"schemaVersion":3}\n```')).toBeNull();
  });

  it("drops a finding with no valid severity tag", () => {
    const bad = { ...VALID, gaps: [finding("no tag here", { quote: undefined })] };
    expect(parseAudit(fence(bad))!.gaps).toHaveLength(0);
  });

  it("keeps a finding whose evidence is missing rather than dropping it", () => {
    // The writer enforces evidence; the reader stays tolerant so a
    // hand-edited or older artifact still renders.
    const noEv = {
      ...VALID,
      gaps: [{ section: "", comment: "[minor] Small. At execution: nothing breaks." }],
    };
    expect(parseAudit(fence(noEv))!.gaps[0].evidence).toBeUndefined();
  });

  it("exposes dispositions untouched", () => {
    const d = { ...VALID, dispositions: [{ finding: "f1", status: "accepted", reason: "known" }] };
    expect(parseAudit(fence(d))!.dispositions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `board/`): `npx vitest run src/lib/parse.audit.test.ts`
Expected: FAIL — `parseAudit` is not exported

- [ ] **Step 3: Add the types**

Append to `board/src/lib/types.ts`:

```ts
export type AuditSeverity = "blocker" | "major" | "minor";

export type AuditEvidence = { path: string; kind: "direct" | "inferred"; detail?: string };

export type AuditFinding = {
  section: string;
  quote?: string;
  evidence?: AuditEvidence;
  comment: string;
  severity: AuditSeverity;
};

export type AuditDisposition = {
  finding?: string;
  status?: string;
  reason?: string;
};

export type Audit = {
  schemaVersion: number;
  component: string;
  planVersion: number;
  planPath: string;
  date: string;
  reviewer: { token: string; effort?: string; reviewerFallback?: string };
  auditPlanHash?: string;
  supersedes?: string | null;
  overall: string;
  anchored: AuditFinding[];
  gaps: AuditFinding[];
  dispositions: AuditDisposition[];
  counts: Record<AuditSeverity, number>;
};
```

- [ ] **Step 4: Add the parser**

Append to `board/src/lib/parse.ts`, after `parseScorecard`, adding `Audit`, `AuditFinding`, `AuditSeverity` to the existing `import type { ... } from "./types"` line:

```ts
const AUDIT_SEVERITIES: AuditSeverity[] = ["blocker", "major", "minor"];

function toAuditFinding(raw: unknown): AuditFinding | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.comment !== "string") return null;
  const severity = AUDIT_SEVERITIES.find((s) => (r.comment as string).startsWith(`[${s}]`));
  // A finding with no valid severity tag is dropped rather than shown
  // unranked: the panel orders by severity and an untagged finding has no
  // place in that order.
  if (!severity) return null;
  const ev = r.evidence as Record<string, unknown> | undefined;
  return {
    section: typeof r.section === "string" ? r.section : "",
    quote: typeof r.quote === "string" ? r.quote : undefined,
    evidence:
      ev && typeof ev.path === "string"
        ? {
            path: ev.path,
            kind: ev.kind === "inferred" ? "inferred" : "direct",
            detail: typeof ev.detail === "string" ? ev.detail : undefined,
          }
        : undefined,
    comment: r.comment,
    severity,
  };
}

export function parseAudit(raw: string): Audit | null {
  const m = /```json board-audit\s*\n([\s\S]*?)\n```/.exec(raw);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.anchored) || !Array.isArray(parsed.gaps)) return null;
    if (typeof parsed.overall !== "string") return null;
    const rank = (f: AuditFinding) => AUDIT_SEVERITIES.indexOf(f.severity);
    const clean = (xs: unknown[]) =>
      (xs.map(toAuditFinding).filter(Boolean) as AuditFinding[]).sort((a, b) => rank(a) - rank(b));
    const anchored = clean(parsed.anchored);
    const gaps = clean(parsed.gaps);
    const counts: Record<AuditSeverity, number> = { blocker: 0, major: 0, minor: 0 };
    for (const f of [...anchored, ...gaps]) counts[f.severity] += 1;
    return {
      schemaVersion: typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 1,
      component: String(parsed.component ?? ""),
      planVersion: Number(parsed.planVersion ?? 0),
      planPath: String(parsed.planPath ?? ""),
      date: String(parsed.date ?? ""),
      reviewer: parsed.reviewer ?? { token: "unknown" },
      auditPlanHash: parsed.auditPlanHash,
      supersedes: parsed.supersedes ?? null,
      overall: parsed.overall,
      anchored,
      gaps,
      dispositions: Array.isArray(parsed.dispositions) ? parsed.dispositions : [],
      counts,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run the test and type check**

Run (from `board/`): `npx vitest run src/lib/parse.audit.test.ts && npx tsc --noEmit`
Expected: PASS, 10 tests

- [ ] **Step 6: Commit**

```bash
git add board/src/lib/types.ts board/src/lib/parse.ts board/src/lib/parse.audit.test.ts
git commit -m "board: parse the board-audit fence into a severity-ordered Audit"
```

---

### Task 9: The `AuditPanel` component

**Files:**
- Create: `board/src/components/AuditPanel.tsx`
- Test: `board/src/components/AuditPanel.test.tsx`

**Interfaces:**
- Consumes: `Audit`, `AuditFinding`, `AuditSeverity` (Task 8).
- Produces: `<AuditPanel audit={audit} />`. Task 10 renders it.

- [ ] **Step 1: Write the failing test**

Create `board/src/components/AuditPanel.test.tsx`. Build the fixture with `parseAudit`-shaped data (severity already resolved, findings already ordered) and assert:

```tsx
it("shows the severity strip collapsed", () => { /* "1 blocker" visible, finding text not */ });
it("expands to show findings", () => { /* click the button, both comments visible */ });
it("shows the evidence path for a finding", () => { /* analysis/fit.R visible */ });
it("labels gaps distinctly from anchored findings", () => { /* "Not stated in the plan" */ });
it("reads clean when there are no findings", () => { /* "no findings" */ });
it("names the reviewer and effort", () => { /* codex-sol and xhigh */ });
it("surfaces a fallback reviewer", () => { /* reviewerFallback text visible */ });
it("shows a disposition when one exists", () => { /* "accepted" and its reason */ });
```

Use `// @vitest-environment jsdom` as the first line and `afterEach(cleanup)`, matching `board/src/components/ScorePanel`'s neighbouring tests.

- [ ] **Step 2: Run it to verify it fails**

Run (from `board/`): `npx vitest run src/components/AuditPanel.test.tsx`
Expected: FAIL — cannot resolve `./AuditPanel`

- [ ] **Step 3: Write the component**

Create `board/src/components/AuditPanel.tsx`. Model it on `ScorePanel.tsx`: a `useState(false)` open flag, a chip-style trigger button, and an absolutely positioned panel. Requirements:

- The trigger reads `audit: {blocker} blocker · {major} major · {minor} minor`, or `audit: no findings` when all three are zero. Its tone is the highest severity present.
- `aria-label="audit findings"` on the trigger so the test can name it.
- The expanded panel shows `overall`, then `reviewer.token`, `reviewer.effort` and `date`, then `reviewer.reviewerFallback` in a warning tone when present.
- Findings render `anchored` first, then `gaps`, each already severity-ordered by `parseAudit`. A gap is labelled `Not stated in the plan` where an anchored finding shows its `section`.
- Each finding shows its `comment`, its `quote` when present, and its `evidence` as `` `path` (kind) — detail ``.
- A finding whose `comment` appears in a `dispositions` entry shows that status and reason. Dispositions are written by seam 2; this only displays them.
- Read-only. No buttons other than the expand toggle.

```tsx
const SEV_CLASS: Record<AuditSeverity, string> = {
  blocker:
    "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300",
  major:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  minor:
    "border-stone-300 bg-stone-50 text-stone-600 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-400",
};
```

- [ ] **Step 4: Run the test and type check**

Run (from `board/`): `npx vitest run src/components/AuditPanel.test.tsx && npx tsc --noEmit`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add board/src/components/AuditPanel.tsx board/src/components/AuditPanel.test.tsx
git commit -m "board: AuditPanel — severity strip expanding to grounded findings"
```

---

### Task 10: Render the audit strip in `PlanReader`

**Files:**
- Modify: `board/src/views/PlanReader.tsx:313-319` (add the memo) and `:386` (render beside `ScorePanel`)
- Test: `board/src/views/PlanReader.audit.test.tsx`

**Interfaces:**
- Consumes: `parseAudit` (Task 8), `AuditPanel` (Task 9).
- Produces: nothing downstream.

**Matching rule, and why it differs from the scorecard's.** `ScorePanel` matches on exact `planPath` because a draft and its signed version are different documents to the rubric. The audit is different: `audit_plan_hash` is invariant across the sign-off trailer, so an audit taken on `.draft-v2.md` is still valid for `v2.md`. Matching on exact path would make the strip vanish the moment a plan is signed, and seam 1 has no sign-off hook to rewrite the path. So the audit matches on **component and version**, which the fence carries.

- [ ] **Step 1: Write the failing test**

Create `board/src/views/PlanReader.audit.test.tsx`. The fixture below mirrors `PlanReader.score.test.tsx:19-57` deliberately — that file keeps its `data()`/`draw()` builders local rather than exporting them, so this test carries its own copy rather than extracting a shared module for two callers.

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import PlanReader from "./PlanReader";
import type { BoardData } from "../lib/types";

afterEach(cleanup);

const SIGNED_PATH = "plans/execution/01-x/v1.md";
const noop = () => {};

function auditFence(component: string, version: number, planPath: string): string {
  return `# Audit\n\n\`\`\`json board-audit\n${JSON.stringify({
    schemaVersion: 1,
    component,
    planVersion: version,
    planPath,
    date: "2026-07-25",
    reviewer: { token: "codex-sol", effort: "xhigh" },
    overall: "One blocker.",
    anchored: [],
    gaps: [
      {
        section: "",
        evidence: { path: "data/wave3.csv", kind: "direct", detail: "12% missing" },
        comment: "[blocker] No missingness rule. At execution: listwise drops 2019.",
      },
    ],
    dispositions: [],
  })}\n\`\`\`\n`;
}

const DRAFT_PATH = "plans/execution/01-x/.draft-v2.md";

function data(
  reviews: { path: string; content: string }[],
  draft = false,
): BoardData {
  return {
    schemaVersion: 1,
    generatedAt: "t",
    mode: "live",
    focus: null,
    project: { name: "p" },
    git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [
        {
          component: "01-x",
          versions: [{ version: 1, path: SIGNED_PATH, content: "# Plan v1\n" }],
          // PlanReader copies proposedVersion into DocRef.version
          // (PlanReader.tsx:156), which is what the audit matches on.
          draft: draft
            ? { path: DRAFT_PATH, content: "# Draft v2\n", proposedVersion: 2 }
            : undefined,
          results: [],
        },
      ],
      reviews,
    },
  } as unknown as BoardData;
}

function draw(boardData: BoardData) {
  return render(
    <PlanReader
      data={boardData}
      canAnnotate={false}
      selectedComponent="01-x"
      annotations={[]}
      onAddPlanComment={noop}
      onPaintResult={noop}
      onOpenResults={noop}
    />,
  );
}

describe("PlanReader audit strip", () => {
  it("renders the strip when an audit matches the open plan", () => {
    draw(data([{ path: "plans/reviews/01-x-v1-audit.md", content: auditFence("01-x", 1, SIGNED_PATH) }]));
    expect(screen.getByText(/audit: 1 blocker/)).toBeTruthy();
  });

  it("still matches after sign-off, when the audit records the draft path", () => {
    // audit_plan_hash is trailer-invariant, so a draft's audit stays valid for
    // the signed version. Exact-path matching would drop it here.
    draw(
      data([
        {
          path: "plans/reviews/01-x-v1-audit.md",
          content: auditFence("01-x", 1, "plans/execution/01-x/.draft-v1.md"),
        },
      ]),
    );
    expect(screen.getByText(/audit: 1 blocker/)).toBeTruthy();
  });

  it("matches a working draft on its proposed version", () => {
    // The draft opens by default, and PlanReader gives it version 2 from
    // proposedVersion. An audit written for v2 must match it.
    draw(
      data([{ path: "plans/reviews/01-x-v2-audit.md", content: auditFence("01-x", 2, DRAFT_PATH) }], true),
    );
    expect(screen.getByText(/audit: 1 blocker/)).toBeTruthy();
  });

  it("renders nothing when the audit belongs to another version", () => {
    draw(data([{ path: "plans/reviews/01-x-v9-audit.md", content: auditFence("01-x", 9, "plans/execution/01-x/v9.md") }]));
    expect(screen.queryByText(/audit:/)).toBeNull();
  });

  it("renders nothing when the audit belongs to another component", () => {
    draw(data([{ path: "plans/reviews/02-y-v1-audit.md", content: auditFence("02-y", 1, "plans/execution/02-y/v1.md") }]));
    expect(screen.queryByText(/audit:/)).toBeNull();
  });

  it("renders nothing when there is no audit", () => {
    draw(data([]));
    expect(screen.queryByText(/audit:/)).toBeNull();
  });

  it("shows nothing when two audits claim the same component and version", () => {
    const content = auditFence("01-x", 1, SIGNED_PATH);
    draw(
      data([
        { path: "plans/reviews/a-audit.md", content },
        { path: "plans/reviews/b-audit.md", content },
      ]),
    );
    expect(screen.queryByText(/audit:/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `board/`): `npx vitest run src/views/PlanReader.audit.test.tsx`
Expected: FAIL — no audit strip rendered

- [ ] **Step 3: Add the memo**

In `PlanReader.tsx`, after the `scorecard` memo at lines 313-319:

```tsx
  // The audit for THIS document, matched on component and version rather than
  // exact path. audit_plan_hash is invariant across the sign-off trailer, so a
  // draft's audit stays valid for the signed version; exact-path matching
  // would make the strip vanish at sign-off. A duplicate match is ambiguous —
  // show nothing rather than the wrong audit.
  const auditRecord = useMemo(() => {
    if (!doc || (doc.docKind !== "signed" && doc.docKind !== "workingDraft")) return null;
    // doc.group, not the outer `group`: that one is `... ?? groups[0] ?? null`
    // (PlanReader.tsx:125-126) and tsc rejects `group.component` with
    // TS18047. `doc` is already narrowed non-null by the guard above.
    const matches = data.files.reviews
      .map((r) => parseAudit(r.content))
      .filter((a) => a && a.component === doc.group.component && a.planVersion === doc.version);
    return matches.length === 1 ? matches[0] : null;
  }, [doc, data.files.reviews]);
```

- [ ] **Step 4: Render it**

At `PlanReader.tsx:386`:

```tsx
            {scorecard && <ScorePanel scorecard={scorecard} />}
            {auditRecord && <AuditPanel audit={auditRecord} />}
```

Add `parseAudit` to the existing `../lib/parse` import and `AuditPanel` from `../components/AuditPanel`.

- [ ] **Step 5: Run the whole board suite**

Run (from `board/`): `npm test && npx tsc --noEmit`
Expected: PASS, including every pre-existing PlanReader test

- [ ] **Step 6: Commit**

```bash
git add board/src/views/PlanReader.tsx board/src/views/PlanReader.audit.test.tsx
git commit -m "board: render the audit strip beside the score strip in PlanReader"
```

---

### Task 11: Trigger the audit wherever a draft is reviewed

The spec's rule is "wherever the review workflow runs on a draft", not first authorship only. That is four commands, not one: `/plan` (authoring and revision rounds), `/sign` (feedback applied in a sign session, and amendment re-commitment candidates), `/execute` (its own re-commitment path), and `/sync` (amendment drafts). A trigger missing from any of them is a path to execution with no audit.

This task adds **dispatch** everywhere. It does not add the currency pre-flight, blocker dispositions, or any gating — those are seam 2.

**Files:**
- Modify: `commands/plan.md:4` (frontmatter) and step 6
- Modify: `commands/sign.md:4` (frontmatter), step 3, and step 4
- Modify: `commands/execute.md:4` (frontmatter) and step 1
- Modify: `commands/sync.md` (frontmatter) and step 6
- Modify: `skills/managing-planboard/references/planning-doctrine.md`
- Modify: `commands/init.md:28`
- Test: `tests/test_command_docs.py` (new class)

**Interfaces:**
- Consumes: `audit.py run` and `audit.py record-fallback` (Task 7), `pb-plan-auditor` (Task 2).
- Produces: nothing downstream. Seam 2 adds the gate paths.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_command_docs.py`. The module's existing constant is `REPO` (`tests/test_command_docs.py:7`) — use it, do not define a new one.

```python
TRIGGER_COMMANDS = ("plan.md", "sign.md", "execute.md", "sync.md")


class TestAuditWiring(unittest.TestCase):
    def _cmd(self, name):
        return (REPO / "commands" / name).read_text(encoding="utf-8")

    def test_every_trigger_command_can_dispatch_the_fallback_subagent(self):
        for name in TRIGGER_COMMANDS:
            head = self._cmd(name).split("---")[1]
            self.assertIn("Task", head, name)

    def test_every_trigger_command_runs_the_audit(self):
        for name in TRIGGER_COMMANDS:
            self.assertIn("audit.py", self._cmd(name), name)

    def test_every_trigger_command_names_the_fallback_agent(self):
        for name in TRIGGER_COMMANDS:
            self.assertIn("pb-plan-auditor", self._cmd(name), name)

    def test_plan_command_documents_every_exit_code(self):
        body = self._cmd("plan.md")
        for token in ("Exit 0", "Exit 1", "Exit 3"):
            self.assertIn(token, body)

    def test_the_fallback_is_recorded_through_the_cli_with_a_hash(self):
        body = self._cmd("plan.md")
        self.assertIn("record-fallback", body)
        self.assertIn("--expected-plan-hash", body)

    def test_sign_migrates_the_audit_path_at_finalization(self):
        self.assertIn("-audit.md", self._cmd("sign.md"))

    def test_init_does_not_promise_six_stages(self):
        self.assertNotIn("six stages", self._cmd("init.md"))
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m unittest tests.test_command_docs.TestAuditWiring -v`
Expected: FAIL — `Task` is not in `plan.md`'s frontmatter

- [ ] **Step 3: Add `Task` to all four frontmatters**

`commands/plan.md:4` becomes:

```
allowed-tools: Read, Write, Edit, Glob, Grep, AskUserQuestion, Task, Bash(python3:*), Bash(git:*), Bash(ls:*), Bash(date:*), Bash(mkdir:*)
```

Add `Task` to `commands/sign.md:4` and `commands/sync.md` the same way, preserving each file's existing list verbatim and appending nothing else. `commands/execute.md:4` already has `Task` and needs no change.

`Task` is the only addition anywhere. Codex runs inside `audit.py`, which the `Bash(python3:*)` these commands already carry permits, so no external-command permission is needed.

- [ ] **Step 4: Add the audit to `/plan` step 6**

In `commands/plan.md` step 6, after the sentence that runs the review workflow:

> **Dispatch the audit.** Immediately after the review workflow, run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/managing-planboard/scripts/audit.py --root . run --component <NN-slug> --version <N> --plan <the draft path>` **in the background** and continue without waiting — the reviewer takes minutes and the live board picks the artifact up on auto-refresh. Tell the researcher the audit is running.
>
> **Exit 0** means the audit was written, or an existing one was still current. **Exit 3** means a fallback is required: note the draft's hash first (`python3 -c` over `audit.audit_plan_hash`, or simply pass the value `audit.py` printed), dispatch one `pb-plan-auditor` Task with the draft's full content, its on-disk path, and the repository root; write its JSON to a temp file; then record it with `audit.py --root . record-fallback --component <NN-slug> --version <N> --plan <draft path> --json <temp file> --reason "<the exit-3 reason>" --expected-plan-hash <the hash you noted>`. Never hand-write the artifact — `record-fallback` is what stamps the plan hash and context identity that make it current, and the hash argument is what stops it certifying text the subagent never saw. Delete the temp file afterward. **Exit 1** is an error: report it and continue, because a failed audit must never block authoring.
>
> If `pb-plan-auditor` is not yet loaded in this session (a project that has just been migrated generates it for the first time, and named agents load at session start), say so and spawn an anonymous `Task` subagent carrying the same contract instead, then record it the same way. Never report an audit as clean when it did not run: a silently skipped audit reads as a clean bill of health.
>
> The audit answers a different question from the scorecard. The score says whether the plan is a checkable contract; the audit says whether it will work against this repository and data. A plan can score 15/15 and carry blockers, and that is a coherent state, not a contradiction. Report both, and never merge them into one judgment.

- [ ] **Step 5: Add the same dispatch to the other three commands**

Each gets the same instruction, phrased for its own trigger. Keep it short — refer back to `/plan` step 6 for the exit-code handling rather than repeating it four times, but state the trigger and the target explicitly in each:

- **`commands/sign.md` step 4** — after applying a feedback file to a draft and re-running the review workflow, dispatch the audit on that draft. **Step 3** — after materializing a re-commitment candidate and running the review workflow on it, dispatch the audit on the candidate.
- **`commands/execute.md` step 1** — after the re-commitment materialization runs the review workflow, dispatch the audit on the candidate.
- **`commands/sync.md` step 6** — after the review workflow runs on the amendment draft and before the canonical write, dispatch the audit on the draft.

In every case the dispatch is the same command with that draft's component, version, and path, and a failed audit never blocks the surrounding work.

- [ ] **Step 6: Migrate the audit's path at sign-off**

`/planboard:review` step 4 already rewrites a scorecard's `planPath` from `.draft-v<N>.md` to `v<N>.md` when a draft is finalized. The audit needs the same treatment or its artifact permanently names a deleted file. Add to `commands/sign.md`, in the finalization transaction beside the existing scorecard migration:

> If `plans/reviews/<NN-slug>-v<N>-audit.md` exists and its fence's `planPath` is the draft path, rewrite that value and the prose link to the canonical `plans/execution/<NN-slug>/v<N>.md`. Do not re-run the audit: `auditPlanHash` is computed over the plan with its trailer stripped, so finalization cannot invalidate it.

The board strip does not depend on this — it matches on component and version (Task 10) precisely so a draft's audit survives sign-off — but the artifact should not point at a file that no longer exists.

- [ ] **Step 7: Update the doctrine and `init.md`**

Add a short "Two review channels" section to `skills/managing-planboard/references/planning-doctrine.md`: the rubric scores control and reads only the plan; the audit checks correctness and reads the repository; neither substitutes for the other; a high score predicts more audit findings, not fewer, because a specific plan is a falsifiable one.

`commands/init.md:28` says the profile has six stages and generation writes three agents. Update both counts to seven and four.

- [ ] **Step 8: Run the full Python suite**

Run: `python3 -m unittest discover -s tests`
Expected: PASS. `tests/test_command_docs.py` also has existing structural checks over the command inventory — confirm none of them assert a fixed allowed-tools string that the added `Task` would break.

- [ ] **Step 9: Commit**

```bash
git add commands/plan.md commands/sign.md commands/execute.md commands/sync.md commands/init.md \
        skills/managing-planboard/references/planning-doctrine.md tests/test_command_docs.py
git commit -m "commands: dispatch the audit wherever a draft is reviewed"
```

---

### Task 12: Repoint the manual Codex reviewer at the profile row

The originating complaint: the board's *Review with Codex* is pinned to `gpt-5.5` at default effort while the local `/codex` habit runs `gpt-5.6-sol` at `xhigh`. The menu keeps all four choices; only the Codex choice's model and effort now come from the profile.

**Files:**
- Modify: `commands/board.md` step 5 (the shared contract paragraph and the `codex` dispatch bullet)
- Test: `tests/test_command_docs.py` (extend `TestAuditWiring`)

**Interfaces:**
- Consumes: the `plan-audit` row (Task 1), the contract text (Task 7).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing tests**

Append to `TestAuditWiring`. These assert on the dispatch bullet specifically, not on the whole document, so that deleting the bullet and adding the words elsewhere cannot satisfy them.

```python
    def _codex_bullet(self):
        body = self._cmd("board.md")
        i = body.index("- **`codex`**")
        return body[i:body.index("- **`gemini`**", i)]

    def test_board_codex_is_not_pinned_to_a_stale_model(self):
        self.assertNotIn("gpt-5.5", self._codex_bullet())

    def test_board_codex_resolves_the_profile_row(self):
        bullet = self._codex_bullet()
        self.assertIn("plan-audit", bullet)
        self.assertIn("model_reasoning_effort", bullet)

    def test_board_codex_maps_every_token(self):
        bullet = self._codex_bullet()
        for token, model in (("codex-sol", "gpt-5.6-sol"),
                             ("codex-terra", "gpt-5.6-terra"),
                             ("codex-luna", "gpt-5.6-luna")):
            self.assertIn(token, bullet)
            self.assertIn(model, bullet)

    def test_board_codex_stays_read_only(self):
        self.assertIn("--sandbox read-only", self._codex_bullet())

    def test_plan_scope_uses_the_gaps_contract(self):
        body = self._cmd("board.md")
        self.assertIn("Plan scope uses the audit contract", body)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m unittest tests.test_command_docs.TestAuditWiring -v`
Expected: FAIL — `gpt-5.5` is still in the bullet

- [ ] **Step 3: Rewrite the codex dispatch bullet**

In `commands/board.md` step 5:

> **`codex`** — resolve the model and effort from the profile's audit row (`python3 ${CLAUDE_PLUGIN_ROOT}/skills/managing-planboard/scripts/models.py stage plan-audit`), mapping the token to its model id (`codex-sol` → `gpt-5.6-sol`, `codex-terra` → `gpt-5.6-terra`, `codex-luna` → `gpt-5.6-luna`) and falling back to `gpt-5.6-sol` at `xhigh` when the row is absent or names `subagent`. Then run `codex exec --sandbox read-only -m <model> -c model_reasoning_effort=<effort> -o plans/.pb-review-out.txt "$(cat plans/.pb-review-<slug>.txt)" < /dev/null` — **read-only** (a review must not mutate the repo), the prompt passed via a shell-safe substitution, the final message saved with `-o`. Parse the LAST balanced JSON object from `plans/.pb-review-out.txt`.

- [ ] **Step 4: Add the plan-scope contract paragraph**

Immediately after the shared output-contract paragraph in step 5:

> **Plan scope uses the audit contract.** When `reviewRequest.scope` is `plan` and the chosen agent is `codex` or `subagent`, the reviewer returns `{"overall", "anchored", "gaps"}` instead of `{"overall", "comments"}` — identical to the audit channel's contract, including the requirement that every finding name the concrete execution failure it predicts and carry an `evidence` object naming a path the reviewer actually opened. `anchored` findings seed as annotations exactly as `comments` do today; `gaps` carry no quote, so they are relayed to the researcher in session rather than seeded. `gemini` and `panel` keep the single-bucket `comments` contract: the Gemini path is given no repository access, and the panel's per-seat caps contradict the audit's no-cap rule.

- [ ] **Step 5: Run the full Python suite**

Run: `python3 -m unittest discover -s tests`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add commands/board.md tests/test_command_docs.py
git commit -m "board: manual Codex reviewer follows the profile's audit row"
```

---

### Task 13: Ship it

`AGENTS.md:31-33` requires the board template to be rebuilt and committed whenever `board/src/` changes, and `AGENTS.md:35-47` makes every behaviour-changing PR a release. Tasks 8-12 deliberately left the template stale; this task closes both.

**Files:**
- Modify: `skills/managing-planboard/assets/board-template.html` (generated)
- Modify: `.claude-plugin/plugin.json`, `board/package.json`, `board/package-lock.json`
- Modify: `CHANGELOG.md`
- Modify: `skills/managing-planboard/scripts/board.py:514-529` (`agents_gitignored`)
- Modify: `commands/models.md`

**Interfaces:**
- Consumes: every prior task.
- Produces: a releasable tree.

- [ ] **Step 1: Teach `agents_gitignored` about the new agent**

`board.py:514-529` checks only the three original generated agents, so it would miss a gitignored `pb-plan-auditor.md` and show the collaborator notice wrongly. Read it and derive its name list from `models.AGENT_STAGES.values()` rather than a hardcoded triple, so the next agent needs no edit here.

- [ ] **Step 2: Update `/planboard:models`**

`commands/models.md:6-14` advertises two mechanisms, six rows, and Claude-only model values. Add the `reviewer` mechanism, the seventh row, the four reviewer tokens, and one line saying the board renders reviewer rows read-only so this command is where they are changed.

- [ ] **Step 3: Rebuild the board template**

```bash
cd board && npm run build
```

Then verify the audit code actually reached the bundle. Source comments are stripped by the bundler, so grep for a user-facing string instead:

```bash
grep -c "Not stated in the plan" skills/managing-planboard/assets/board-template.html
```

Expected: at least 1. If it is 0, the build did not pick up `AuditPanel` — stop and diagnose rather than committing.

- [ ] **Step 4: Confirm the build is reproducible**

Run `cd board && npm run build` a second time and confirm `git diff --stat skills/managing-planboard/assets/board-template.html` is empty. `AGENTS.md:33` requires this clean second-build diff.

- [ ] **Step 5: Bump the version**

Keep `.claude-plugin/plugin.json` and `board/package.json` identical, then run `cd board && npm install --package-lock-only` to sync the root package fields in `board/package-lock.json` (`AGENTS.md:40-46`). This is a feature, so take a minor bump from the current version.

- [ ] **Step 6: Write the changelog entry**

Add a `CHANGELOG.md` section for the new version covering: the audit channel and what it is for; the `plan-audit` profile row and its automatic migration; `pb-plan-auditor`; the audit artifact and its board panel; and the manual Codex reviewer now following the profile. State plainly that nothing is gated yet and that blocker dispositions arrive with seam 2.

- [ ] **Step 7: Run the repository's exact validation set**

These are the three commands `AGENTS.md:23-29` requires, verbatim:

```sh
python3 -m pytest tests/ -q
(cd board && npm test && npx tsc --noEmit)
(cd skills/managing-planboard/assets/web-template && npm test)
```

Expected: PASS on all three. The hosted web-template suite is easy to forget and is required.

- [ ] **Step 8: Commit**

```bash
git add skills/managing-planboard/assets/board-template.html \
        skills/managing-planboard/scripts/board.py commands/models.md \
        .claude-plugin/plugin.json board/package.json board/package-lock.json CHANGELOG.md
git commit -m "release: the plan audit channel (seam 1)"
```

---

## After this plan

Seam 2, a separate plan: the currency pre-flight in `/sign`, the `/execute` gate and `/sync`; revalidation inside `sign_lock` immediately before `write_ticket`; blocker dispositions with reasons; `resolved` recorded from the `supersedes` pointer; and decision-log entries attributing the finding to the reviewer and the decision to the researcher.

Seam 1 now covers every spec requirement in its scope. The audit dispatches from all four draft-review triggers (Task 11), the migration regenerates its agent (Task 3), and the draft-to-canonical `planPath` rewrite happens at sign-off (Task 11, step 6). What seam 2 adds is not visibility but *consequence*: until it lands, an audit can be full of blockers and nothing stops the plan being signed.
