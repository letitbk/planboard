# Plan audit channel — seam 1 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the audit machinery and its board surface, so every plan draft gets an automatic repository-grounded audit whose findings are visible beside the rubric score.

**Architecture:** A new stdlib-only `audit.py` owns hashing, context identity, locked atomic artifact writes, and Codex dispatch. `models.py` gains a `reviewer` mechanism, a `plan-audit` stage, and a self-healing migration. The board gains a `board-audit` fence parser and an `AuditPanel` rendered beside the existing `ScorePanel`. Findings live in that panel; nothing gates yet.

**Tech Stack:** Python 3 standard library only (no new dependencies), React + TypeScript + Tailwind for the board, `unittest` for Python tests, `vitest` for board tests.

**Source spec:** `docs/specs/2026-07-24-plan-audit-channel-design.md` (revised 2026-07-25 after Codex review).

## Scope

This plan implements **seam 1 only**, in 13 tasks: the audit service, the contract, `pb-plan-auditor`, the profile row and its migration, the artifact, the audit panel, and the manual reviewer repoint. Seam 2 (currency pre-flight at the gates, in-transaction revalidation inside `sign_lock`, blocker dispositions, decision-log entries) is a separate plan. After this plan, audits run and are visible; nothing blocks and no disposition is collected.

## Global Constraints

- **Python: standard library only.** Every existing script in `skills/managing-planboard/scripts/` is stdlib-only. Do not add dependencies.
- **Board: no new npm dependencies.** Use the existing React + Tailwind idiom.
- **Never `npm run build`.** It rewrites the 460KB tracked `skills/managing-planboard/assets/board-template.html`. Only the final ship task rebuilds the template, and this plan contains no such task.
- **Explicit `git add <paths>` on every commit.** Never `git add .`, `git add -A`, or `git commit -a`.
- **The auditor is read-only** against the repository: `codex exec --sandbox read-only`. A review must never mutate the repo.
- **Reviewer tokens:** `codex-sol`, `codex-terra`, `codex-luna`, `subagent`. `gemini-pro` is deliberately absent (its board path has no repository access).
- **Severity tags** are exactly `[blocker]`, `[major]`, `[minor]`.
- Python tests run with `python3 -m unittest tests.<module> -v` from the repo root. Board tests run with `npx vitest run <file>` from `board/`.
- Full suites before any task is considered done: `python3 -m unittest discover -s tests -v` and, in `board/`, `npm test` plus `npx tsc --noEmit`.

---

### Task 1: Audit identity primitives

The two halves of "is this audit current": a plan hash invariant across both canonical trailers, and a context identity over the evidence paths a finding cites.

**Files:**
- Create: `skills/managing-planboard/scripts/audit.py`
- Create: `tests/test_audit.py`

**Interfaces:**
- Consumes: `normalize_plan` and `strip_trailer` from `signoff_gate.py` (same directory).
- Produces:
  - `audit_plan_hash(text: str) -> str` — 64-char hex sha256.
  - `context_identity(root: Path, evidence_paths: list[str]) -> dict` — `{"head": str|None, "paths": {relpath: str|None}}`. A path that does not exist maps to `None`, which is a meaningful value (the audit observed its absence), not an error.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_audit.py`:

```python
"""Tests for audit.py. Run:
    python3 -m unittest tests.test_audit -v
"""
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


class TestAuditPlanHash(unittest.TestCase):
    def test_hash_is_hex_sha256(self):
        h = audit.audit_plan_hash(PLAN)
        self.assertEqual(len(h), 64)
        self.assertRegex(h, r"^[0-9a-f]{64}$")

    def test_invariant_across_signed_trailer(self):
        signed = PLAN + "\n---\n\nSigned off: BK, 2026-07-25\n"
        self.assertEqual(audit.audit_plan_hash(PLAN), audit.audit_plan_hash(signed))

    def test_invariant_across_amendment_trailer(self):
        # normalize_plan alone does NOT strip this trailer; strip_trailer does.
        # This is the case that makes a /sync amendment keep its draft's audit.
        amended = PLAN + "\n---\n\nAmendment recorded, 2026-07-25\n"
        self.assertEqual(audit.audit_plan_hash(PLAN), audit.audit_plan_hash(amended))

    def test_content_change_changes_hash(self):
        other = PLAN.replace("Do the thing", "Do a different thing")
        self.assertNotEqual(audit.audit_plan_hash(PLAN), audit.audit_plan_hash(other))

    def test_crlf_and_trailing_whitespace_are_normalized(self):
        noisy = PLAN.replace("\n", "\r\n").rstrip() + "   \r\n\r\n"
        self.assertEqual(audit.audit_plan_hash(PLAN), audit.audit_plan_hash(noisy))


class TestContextIdentity(unittest.TestCase):
    def _repo(self, tmp):
        root = Path(tmp)
        subprocess.run(["git", "init", "-q"], cwd=root, check=True)
        (root / "analysis").mkdir()
        (root / "analysis" / "load.py").write_text("print('load')\n")
        return root

    def test_records_head_and_path_hashes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self._repo(tmp)
            ident = audit.context_identity(root, ["analysis/load.py"])
            self.assertIn("head", ident)
            self.assertEqual(len(ident["paths"]), 1)
            self.assertRegex(ident["paths"]["analysis/load.py"], r"^[0-9a-f]{64}$")

    def test_missing_path_records_none_not_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self._repo(tmp)
            ident = audit.context_identity(root, ["analysis/gone.py"])
            self.assertIsNone(ident["paths"]["analysis/gone.py"])

    def test_renamed_evidence_changes_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self._repo(tmp)
            before = audit.context_identity(root, ["analysis/load.py"])
            (root / "analysis" / "load.py").rename(root / "analysis" / "loader.py")
            after = audit.context_identity(root, ["analysis/load.py"])
            self.assertNotEqual(before["paths"], after["paths"])

    def test_no_evidence_paths_yields_empty_map(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self._repo(tmp)
            ident = audit.context_identity(root, [])
            self.assertEqual(ident["paths"], {})

    def test_escaping_path_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self._repo(tmp)
            with self.assertRaises(ValueError):
                audit.context_identity(root, ["../outside.py"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest tests.test_audit -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'audit'`

- [ ] **Step 3: Write the implementation**

Create `skills/managing-planboard/scripts/audit.py`:

```python
"""Audit identity, artifact writing, and reviewer dispatch for the planboard
audit channel. Standard library only.

The audit channel answers "will this plan actually work?" against the
repository, separately from the rubric scorecard, which answers "is this a
checkable contract?" from the plan text alone. See
docs/specs/2026-07-24-plan-audit-channel-design.md.
"""
import hashlib
import subprocess
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
    """Current HEAD sha, or None outside a git repo / in an empty one."""
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
    root = Path(root)
    paths = {}
    for rel in evidence_paths:
        p = (root / rel).resolve()
        if root.resolve() not in p.parents and p != root.resolve():
            raise ValueError("evidence path escapes the repository: %s" % rel)
        if p.is_file():
            paths[rel] = hashlib.sha256(p.read_bytes()).hexdigest()
        else:
            paths[rel] = None
    return {"head": _git_head(root), "paths": paths}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m unittest tests.test_audit -v`
Expected: PASS, 11 tests

- [ ] **Step 5: Run the full Python suite**

Run: `python3 -m unittest discover -s tests -v 2>&1 | tail -5`
Expected: no new failures against the pre-task baseline

- [ ] **Step 6: Commit**

```bash
git add skills/managing-planboard/scripts/audit.py tests/test_audit.py
git commit -m "audit: plan hash invariant across both trailers, scoped context identity"
```

---

### Task 2: The `reviewer` mechanism and the `plan-audit` stage

**Files:**
- Modify: `skills/managing-planboard/scripts/models.py:23-58` (constants), and the row-validation branch around `models.py:103-126`
- Modify: `skills/managing-planboard/templates/model-profile.md`
- Test: `tests/test_models.py` (new class)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: stage key `"plan-audit"`, mechanism `"reviewer"`, and `models.REVIEWER_TOKENS`. Task 3 reads `EXPECTED_MECHANISM["plan-audit"]`; Task 4 reads `STAGE_LABELS`; Task 6 reads the resolved row via `models.py stage plan-audit`.

- [ ] **Step 1: Write the failing tests**

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
        self.assertIn("plan-audit", stages)
        self.assertEqual(stages["plan-audit"]["model"], "codex-sol")
        self.assertEqual(stages["plan-audit"]["effort"], "xhigh")
        self.assertEqual(stages["plan-audit"]["mechanism"], "reviewer")

    def test_default_template_is_canonical(self):
        stages, warnings = models.parse_profile(DEFAULT_PROFILE)
        self.assertTrue(models.profile_canonical(stages, warnings))

    def test_reviewer_row_accepts_every_token(self):
        for token in ("codex-sol", "codex-terra", "codex-luna", "subagent"):
            stages, warnings = models.parse_profile(self._profile(model=token))
            self.assertEqual(warnings, [], token)
            self.assertEqual(stages["plan-audit"]["model"], token)

    def test_reviewer_row_rejects_claude_alias(self):
        # `opus` is a valid model for an agent row but not a reviewer token.
        stages, warnings = models.parse_profile(self._profile(model="opus"))
        self.assertNotIn("plan-audit", stages)
        self.assertTrue(any("plan-audit" in w or "opus" in w for w in warnings))

    def test_reviewer_row_rejects_gemini(self):
        stages, warnings = models.parse_profile(self._profile(model="gemini-pro"))
        self.assertNotIn("plan-audit", stages)

    def test_agent_row_still_rejects_reviewer_token(self):
        p = DEFAULT_PROFILE.replace(
            "| plan review (verdict + grade) | opus | medium | agent |",
            "| plan review (verdict + grade) | codex-sol | medium | agent |",
        )
        stages, warnings = models.parse_profile(p)
        self.assertNotIn("plan-review", stages)

    def test_flipped_mechanism_is_non_canonical(self):
        stages, warnings = models.parse_profile(self._profile(mech="agent"))
        self.assertFalse(models.profile_canonical(stages, warnings))

    def test_stage_cli_returns_the_audit_row(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                models.main(["--root", str(root), "stage", "plan-audit"])
            self.assertIn("codex-sol", buf.getvalue())
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest tests.test_models.TestReviewerMechanism -v`
Expected: FAIL — the default template has no `plan audit (deep)` row, so `test_default_template_parses_with_seven_stages` fails on `assertIn`

- [ ] **Step 3: Add the constants**

In `skills/managing-planboard/scripts/models.py`, extend the constant block at lines 23-58:

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
MODEL_ALIASES = {"inherit", "opus", "sonnet", "haiku", "fable"}
MODEL_ID_RE = re.compile(r"^claude-[a-z0-9.-]+$")
# Reviewer tokens name WHO audits, not a Claude model. `gemini-pro` is
# deliberately absent: the board's Gemini path is self-contained and has no
# repository access, so it cannot ground an audit, and shipping the token
# would produce confident ungrounded audits that read like grounded ones.
REVIEWER_TOKENS = {"codex-sol", "codex-terra", "codex-luna", "subagent"}
EFFORT_LEVELS = {"low", "medium", "high", "xhigh", "max"}
NO_EFFORT = {"", "-", "—", "–"}  # blank, hyphen, em dash, en dash
MECHANISMS = {"nudge", "agent", "reviewer"}
```

and extend `EXPECTED_MECHANISM`:

```python
EXPECTED_MECHANISM = {
    "plan": "nudge",
    "execute": "nudge",
    "sync": "nudge",
    "plan-review": "agent",
    "results-validation": "agent",
    "board-reviewer": "agent",
    "plan-audit": "reviewer",
}
```

The `STAGE_LABELS` key is `"plan audit"`, not `"plan audit (deep)"`. `_norm` (`models.py:85-86`) runs `re.sub(r"\([^)]*\)", "", cell)` before lowercasing, so the row's first cell `plan audit (deep)` normalizes to `plan audit` — the same mechanism that already maps `plan review (verdict + grade)` to `plan review`.

- [ ] **Step 4: Branch model validation on mechanism**

In the row parser near `models.py:103-126`, the model cell is currently validated against `MODEL_ALIASES`/`MODEL_ID_RE` unconditionally. Make it depend on the row's mechanism:

```python
    if mech not in MECHANISMS:
        warnings.append(
            f"model-profile: skipping row {rownum} (unknown mechanism {raw_mech!r})"
        )
        return
    if mech == "reviewer":
        if model not in REVIEWER_TOKENS:
            warnings.append(
                f"model-profile: skipping row {rownum} — '{model}' is not a reviewer "
                f"token (expected one of {', '.join(sorted(REVIEWER_TOKENS))})"
            )
            return
    elif model not in MODEL_ALIASES and not MODEL_ID_RE.match(model):
        warnings.append(
            f"model-profile: skipping row {rownum} (unknown model {model!r})"
        )
        return
    stages[key] = {"stage": key, "model": model, "effort": effort, "mechanism": mech}
```

Read the surrounding lines first and preserve the existing warning wording and control flow; the block above shows the shape of the change, not a verbatim replacement.

- [ ] **Step 5: Add the row to the template**

In `skills/managing-planboard/templates/model-profile.md`, add the row to the table and update the prose. The table becomes:

```
| stage | model | effort | mechanism |
|---|---|---|---|
| plan (co-authoring) | opus | max | nudge |
| execute (analysis) | sonnet | — | nudge |
| sync | inherit | — | nudge |
| plan review (verdict + grade) | opus | medium | agent |
| results validation | opus | low | agent |
| board reviewer panel | opus | low | agent |
| plan audit (deep) | codex-sol | xhigh | reviewer |
```

Change the opening sentence from "How each planboard stage picks a Claude model" to "How each planboard stage picks its model or reviewer", and add a third mechanism to the list after **agent**:

> **reviewer**: this stage runs an independent auditor rather than a Claude model. The model cell holds a reviewer token (`codex-sol`, `codex-terra`, `codex-luna`, or `subagent`), and the effort cell applies to whichever reviewer runs.

Add to the "Why these defaults" paragraph:

> The plan audit is the one stage deliberately run by a different model family. Its whole value is that an independent auditor sees what the model that wrote the plan cannot, so it defaults to Codex at `xhigh`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `python3 -m unittest tests.test_models -v`
Expected: PASS, including the 8 new tests and all 65 pre-existing ones

- [ ] **Step 7: Commit**

```bash
git add skills/managing-planboard/scripts/models.py skills/managing-planboard/templates/model-profile.md tests/test_models.py
git commit -m "models: add the plan-audit stage and the reviewer mechanism"
```

---

### Task 3: Generate `pb-plan-auditor`

The spec says the audit's subagent and fallback path must NOT reuse `pb-board-reviewer`, which caps at five comments and requires a verbatim quote on every finding. Reusing it would re-impose both the cap the audit removes and the anchor rule that deletes the entire `gaps` class, producing a fallback that structurally cannot report a missing missingness rule.

**Resolving a spec incoherence:** the spec says `pb-plan-auditor` "is generated from the audit row", but `generate()` refuses any row whose mechanism is not `agent` (`models.py:435`), and when the token is `codex-sol` the row's model cell holds no Claude model to render into the agent's frontmatter. Resolution implemented here: the agent's **model is fixed at `opus`**, because the row's model cell is spent naming the primary reviewer; its **effort comes from the audit row**, because both scales are identical (`low`..`max`). Setting the token to `subagent` makes this same agent the primary auditor.

**Files:**
- Create: `skills/managing-planboard/templates/agents/pb-plan-auditor.md`
- Modify: `skills/managing-planboard/scripts/models.py:36-47` (`AGENT_STAGES`) and the generation loop at `models.py:426-456`
- Test: `tests/test_models.py` (new class)

**Interfaces:**
- Consumes: `STAGE_LABELS`, `EXPECTED_MECHANISM`, `REVIEWER_TOKENS` from Task 2.
- Produces: `.claude/agents/pb-plan-auditor.md` in an initialized project, carrying the section 2 audit contract. Task 11 dispatches it by name on the fallback path.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_models.py`:

```python
class TestPlanAuditorGeneration(unittest.TestCase):
    def test_auditor_is_generated_from_a_reviewer_row(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            models.main(["--root", str(root), "generate"])
            agent = root / ".claude" / "agents" / "pb-plan-auditor.md"
            self.assertTrue(agent.is_file())

    def test_auditor_model_is_opus_and_effort_comes_from_the_row(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            models.main(["--root", str(root), "generate"])
            text = (root / ".claude" / "agents" / "pb-plan-auditor.md").read_text()
            self.assertIn("model: opus", text)
            self.assertIn("effort: xhigh", text)
            self.assertNotIn("codex-sol", text)

    def test_auditor_contract_admits_gaps_and_has_no_cap(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            models.main(["--root", str(root), "generate"])
            text = (root / ".claude" / "agents" / "pb-plan-auditor.md").read_text()
            self.assertIn("gaps", text)
            self.assertIn("evidence", text)
            self.assertNotIn("at most 5", text)

    def test_three_existing_agents_still_generate(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            models.main(["--root", str(root), "generate"])
            for name in ("pb-plan-reviewer", "pb-results-validator", "pb-board-reviewer"):
                self.assertTrue((root / ".claude" / "agents" / f"{name}.md").is_file(), name)

    def test_flipped_mechanism_removes_the_marked_auditor(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            models.main(["--root", str(root), "generate"])
            agent = root / ".claude" / "agents" / "pb-plan-auditor.md"
            self.assertTrue(agent.is_file())
            profile = (root / "plans" / "model-profile.md").read_text()
            (root / "plans" / "model-profile.md").write_text(
                profile.replace(
                    "| plan audit (deep) | codex-sol | xhigh | reviewer |",
                    "| plan audit (deep) | opus | xhigh | agent |",
                )
            )
            models.main(["--root", str(root), "generate"])
            self.assertFalse(agent.is_file())
```

- [ ] **Step 2: Run the tests to verify they fail**

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

**`anchored` versus `gaps`.** A finding about text that IS in the plan goes in `anchored` with a short verbatim quote, markdown stripped (no `**`, backticks, or `[]()`), so it matches the rendered text a reader sees. A finding about something the plan NEVER says goes in `gaps` and carries no quote. The gaps bucket exists because omissions are where plans and outputs diverge, and a quote-anchored contract cannot express them. Do not force a gap into an anchor by quoting a nearby line.

**There is no cap on findings.** Return every material finding. Two requirements replace a cap:

1. **Predicted failure.** Every comment must name the concrete failure it predicts at execution time. "Consider handling missingness" is not a finding. "Step 4 will silently drop the 2019 wave because no missingness rule is stated and the script defaults to listwise deletion" is. Drop any finding you cannot attach a consequence to.
2. **Repository evidence.** Every finding carries an `evidence` object naming a path you actually opened, what you found there, and `"kind": "direct"` when you read it or `"kind": "inferred"` when you are reasoning past what you read. Never assert what you have not checked. A finding with no evidence path does not belong in the output.

**Severity.** Begin each comment with exactly one tag: `[blocker]` (invalidates a finding or decision — must be resolved before acting on the work), `[major]` (materially changes the work if acted on), `[minor]` (worth fixing, not blocking). Order most severe first within each bucket.

**Dig deeper before finalizing.** Hunt the second-order failures a surface read misses: steps whose failure would be silent, data assumptions the plan never checks, empty states, joins that can drop rows, outputs a later step assumes exist, and paths the plan names that do not exist in the repository.

**Verify before returning.** Re-check each finding: is it material, does it name a concrete execution failure, and is its evidence something you actually read? Drop what fails. A short grounded audit beats a long speculative one.
```

- [ ] **Step 4: Wire generation**

In `models.py`, add the auditor to `AGENT_STAGES` and its legacy map neighbour stays untouched (there is no pre-rename `rp-plan-auditor`):

```python
AGENT_STAGES = {
    "plan-review": "pb-plan-reviewer",
    "results-validation": "pb-results-validator",
    "board-reviewer": "pb-board-reviewer",
    "plan-audit": "pb-plan-auditor",
}
# A `reviewer` row's model cell names WHO audits (a Codex token or `subagent`),
# so it holds no Claude model for the generated agent. The agent that backs the
# subagent and fallback paths is therefore pinned here; the row's effort cell
# still reaches it, because the Codex and Claude effort scales are identical.
AGENT_MODEL_OVERRIDE = {"plan-audit": "opus"}
```

In the generation loop (`models.py:426-456`), replace the hardcoded mechanism guard and the model argument:

```python
        if row["mechanism"] != EXPECTED_MECHANISM[key]:
            stderr.append(
                f"model-profile: '{key}' row has mechanism '{row['mechanism']}' — {agent}.md not regenerated"
            )
            outcome = _remove_if_marked(target, rel, key, stdout)
            results.append({"agent": agent, "stage": key, "outcome": outcome})
            continue
```

and further down, where the template is rendered:

```python
            model = AGENT_MODEL_OVERRIDE.get(key, row["model"])
            rendered = _render(template, model, row["effort"], checksum)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python3 -m unittest tests.test_models -v`
Expected: PASS.

Two pre-existing tests may need updating, and both should be updated rather than weakened:
- `TestCheckTemplateDrift` — if it enumerates the template directory, add `pb-plan-auditor` to its expected set.
- `TestGenerate.test_default_profile_writes_three_marked_agents` (`tests/test_models.py:192`) — it asserts three named agents exist, which still passes, but the name is now wrong. Rename it to `test_default_profile_writes_four_marked_agents` and add `pb-plan-auditor` to its loop.

- [ ] **Step 6: Commit**

```bash
git add skills/managing-planboard/templates/agents/pb-plan-auditor.md skills/managing-planboard/scripts/models.py tests/test_models.py
git commit -m "models: generate pb-plan-auditor with the gaps-admitting audit contract"
```

---

### Task 4: Self-healing profile migration

Adding a seventh stage makes every existing six-row profile non-canonical, which silently turns the board's Models view read-only. Worse, `cmd_check` only inspects stages that generate agents in the project, so an upgraded project can reach a mandatory audit with no row at all.

**Files:**
- Modify: `skills/managing-planboard/scripts/models.py` (new function + `cmd_check` and `cmd_generate` call sites)
- Test: `tests/test_models.py` (new class)

**Interfaces:**
- Consumes: `STAGE_LABELS`, `EXPECTED_MECHANISM` (Task 2), `atomic_write` (`models.py:311`), `locate_table` (`models.py:186`).
- Produces: `ensure_audit_stage(root) -> dict` — `{"changed": bool, "reason": str}`. Task 6 calls it before every audit lookup.

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
            result = models.ensure_audit_stage(root)
            self.assertTrue(result["changed"])
            text = (root / "plans" / "model-profile.md").read_text()
            self.assertIn("| plan audit (deep) | codex-sol | xhigh | reviewer |", text)

    def test_migrated_profile_is_canonical(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=SIX_ROW_PROFILE)
            models.ensure_audit_stage(root)
            text = (root / "plans" / "model-profile.md").read_text()
            stages, warnings = models.parse_profile(text)
            self.assertTrue(models.profile_canonical(stages, warnings))

    def test_surrounding_bytes_are_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=SIX_ROW_PROFILE)
            models.ensure_audit_stage(root)
            text = (root / "plans" / "model-profile.md").read_text()
            self.assertIn("Prose that must survive the splice.", text)
            self.assertIn("Trailing prose that must also survive.", text)
            self.assertIn("| plan (co-authoring) | opus | max | nudge |", text)

    def test_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=SIX_ROW_PROFILE)
            models.ensure_audit_stage(root)
            first = (root / "plans" / "model-profile.md").read_text()
            second_result = models.ensure_audit_stage(root)
            self.assertFalse(second_result["changed"])
            self.assertEqual(first, (root / "plans" / "model-profile.md").read_text())

    def test_refuses_a_duplicated_audit_row(self):
        dupe = SIX_ROW_PROFILE.replace(
            "| board reviewer panel | opus | low | agent |",
            "| board reviewer panel | opus | low | agent |\n"
            "| plan audit (deep) | codex-sol | xhigh | reviewer |\n"
            "| plan audit (deep) | codex-luna | low | reviewer |",
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=dupe)
            before = (root / "plans" / "model-profile.md").read_text()
            result = models.ensure_audit_stage(root)
            self.assertFalse(result["changed"])
            self.assertIn("ambiguous", result["reason"])
            self.assertEqual(before, (root / "plans" / "model-profile.md").read_text())

    def test_refuses_a_profile_with_no_table(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile="# Model profile\n\nNo table here.\n")
            result = models.ensure_audit_stage(root)
            self.assertFalse(result["changed"])
            self.assertIn("no", result["reason"].lower())

    def test_missing_profile_file_is_not_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=None)
            result = models.ensure_audit_stage(root)
            self.assertFalse(result["changed"])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest tests.test_models.TestEnsureAuditStage -v`
Expected: FAIL with `AttributeError: module 'models' has no attribute 'ensure_audit_stage'`

- [ ] **Step 3: Write the implementation**

Add to `models.py`, next to the other profile-writing helpers:

```python
AUDIT_ROW = "| plan audit (deep) | codex-sol | xhigh | reviewer |"


def ensure_audit_stage(root):
    """Splice the plan-audit row into a pre-audit profile, atomically.

    Adding a seventh stage makes every existing six-row profile non-canonical,
    which silently downgrades the board's Models view to read-only, and
    cmd_check cannot report a missing reviewer-only row before its agent exists
    in the project. So this runs from every audit lookup, not only from
    /planboard:models: an upgraded project must not be able to reach a
    mandatory audit with no reviewer row.

    Splices ONLY the missing row and preserves every surrounding byte. Refuses
    to touch an ambiguous file rather than guessing.
    """
    path = Path(root) / "plans" / "model-profile.md"
    if not path.is_file():
        return {"changed": False, "reason": "no model-profile.md"}
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        return {"changed": False, "reason": "unreadable model-profile.md (%s)" % e}

    lines = text.splitlines(keepends=True)
    audit_rows = [
        i for i, ln in enumerate(lines)
        if _norm(ln.split("|")[1]) == "plan audit" if ln.count("|") >= 4
    ]
    if len(audit_rows) > 1:
        return {"changed": False, "reason": "ambiguous: %d plan-audit rows" % len(audit_rows)}
    if len(audit_rows) == 1:
        return {"changed": False, "reason": "already present"}

    span = locate_table(text)
    if span is None:
        return {"changed": False, "reason": "no stage/model/effort/mechanism table found"}
    # locate_table returns (header_idx, first_data_idx, last_data_idx) as
    # indices into splitlines(keepends=True), INCLUSIVE of the data range
    # (models.py:183-187), so the insertion point is one past the last row.
    _header, _first, last_data = span

    newline = "\r\n" if lines and lines[0].endswith("\r\n") else "\n"
    lines.insert(last_data + 1, AUDIT_ROW + newline)
    atomic_write(path, "".join(lines))
    return {"changed": True, "reason": "inserted the plan-audit row"}
```

- [ ] **Step 4: Call it from the CLI paths**

In `cmd_generate` and `cmd_check`, call `ensure_audit_stage(root)` before parsing the profile, and append its `reason` to stdout when `changed` is true:

```python
    migration = ensure_audit_stage(root)
    if migration["changed"]:
        stdout.append("model-profile: %s" % migration["reason"])
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python3 -m unittest tests.test_models -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add skills/managing-planboard/scripts/models.py tests/test_models.py
git commit -m "models: self-healing plan-audit row migration for pre-audit profiles"
```

---

### Task 5: Locked, atomic audit artifact writes

**Files:**
- Modify: `skills/managing-planboard/scripts/audit.py`
- Modify: `tests/test_audit.py`

**Interfaces:**
- Consumes: `audit_plan_hash`, `context_identity` (Task 1).
- Produces:
  - `audit_path(root, component, version) -> Path` — `plans/reviews/<component>-v<N>-audit.md`
  - `write_audit(root, component, version, payload) -> Path` — atomic, lock-held, validated.
  - `read_audit(root, component, version) -> dict|None` — the parsed fence, or None.
  - `is_current(audit, plan_text, root) -> bool`
  - `AuditLocked` — raised when the per-component lock is held.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_audit.py`:

```python
SCHEMA = {
    "schemaVersion": 1,
    "component": "03-attrition",
    "planVersion": 2,
    "planPath": "plans/execution/03-attrition/.draft-v2.md",
    "date": "2026-07-25",
    "reviewer": {"token": "codex-sol", "effort": "xhigh"},
    "overall": "Reads sound; two gaps.",
    "anchored": [],
    "gaps": [],
    "dispositions": [],
}


def _project(tmp):
    root = Path(tmp)
    (root / "plans" / "reviews").mkdir(parents=True)
    (root / "plans" / "execution" / "03-attrition").mkdir(parents=True)
    return root


class TestWriteAudit(unittest.TestCase):
    def test_writes_a_parseable_fence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _project(tmp)
            p = audit.write_audit(root, "03-attrition", 2, dict(SCHEMA))
            self.assertTrue(p.is_file())
            self.assertEqual(p.name, "03-attrition-v2-audit.md")
            back = audit.read_audit(root, "03-attrition", 2)
            self.assertEqual(back["component"], "03-attrition")

    def test_write_is_atomic_no_partial_file_on_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _project(tmp)
            audit.write_audit(root, "03-attrition", 2, dict(SCHEMA))
            good = audit.audit_path(root, "03-attrition", 2).read_text()
            bad = dict(SCHEMA)
            bad["anchored"] = {"not": "a list"}
            with self.assertRaises(ValueError):
                audit.write_audit(root, "03-attrition", 2, bad)
            self.assertEqual(good, audit.audit_path(root, "03-attrition", 2).read_text())

    def test_rejects_a_payload_missing_required_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _project(tmp)
            bad = dict(SCHEMA)
            del bad["overall"]
            with self.assertRaises(ValueError):
                audit.write_audit(root, "03-attrition", 2, bad)

    def test_refuses_to_clobber_an_audit_carrying_dispositions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _project(tmp)
            first = dict(SCHEMA)
            first["auditPlanHash"] = "a" * 64
            first["dispositions"] = [{"finding": "f1", "status": "accepted", "reason": "known"}]
            audit.write_audit(root, "03-attrition", 2, first)
            same = dict(SCHEMA)
            same["auditPlanHash"] = "a" * 64
            with self.assertRaises(audit.AuditLocked):
                audit.write_audit(root, "03-attrition", 2, same)

    def test_replaces_an_audit_with_a_different_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _project(tmp)
            first = dict(SCHEMA)
            first["auditPlanHash"] = "a" * 64
            first["dispositions"] = [{"finding": "f1", "status": "accepted", "reason": "known"}]
            audit.write_audit(root, "03-attrition", 2, first)
            newer = dict(SCHEMA)
            newer["auditPlanHash"] = "b" * 64
            audit.write_audit(root, "03-attrition", 2, newer)
            self.assertEqual(audit.read_audit(root, "03-attrition", 2)["auditPlanHash"], "b" * 64)

    def test_read_audit_returns_none_when_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _project(tmp)
            self.assertIsNone(audit.read_audit(root, "03-attrition", 2))


class TestIsCurrent(unittest.TestCase):
    def test_matching_hash_and_context_is_current(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _project(tmp)
            rec = dict(SCHEMA)
            rec["auditPlanHash"] = audit.audit_plan_hash(PLAN)
            rec["contextIdentity"] = audit.context_identity(root, [])
            self.assertTrue(audit.is_current(rec, PLAN, root))

    def test_changed_plan_text_is_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _project(tmp)
            rec = dict(SCHEMA)
            rec["auditPlanHash"] = audit.audit_plan_hash(PLAN)
            rec["contextIdentity"] = audit.context_identity(root, [])
            self.assertFalse(audit.is_current(rec, PLAN + "\nExtra step.\n", root))

    def test_moved_evidence_is_stale_even_when_plan_is_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _project(tmp)
            (root / "analysis").mkdir()
            (root / "analysis" / "load.py").write_text("print('load')\n")
            rec = dict(SCHEMA)
            rec["auditPlanHash"] = audit.audit_plan_hash(PLAN)
            rec["contextIdentity"] = audit.context_identity(root, ["analysis/load.py"])
            (root / "analysis" / "load.py").unlink()
            self.assertFalse(audit.is_current(rec, PLAN, root))
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest tests.test_audit -v`
Expected: FAIL with `AttributeError: module 'audit' has no attribute 'write_audit'`

- [ ] **Step 3: Write the implementation**

Append to `skills/managing-planboard/scripts/audit.py`:

```python
import json
import os
import stat
import tempfile

SCHEMA_VERSION = 1
REQUIRED_KEYS = (
    "schemaVersion", "component", "planVersion", "planPath", "date",
    "reviewer", "overall", "anchored", "gaps", "dispositions",
)


class AuditLocked(Exception):
    """Raised when a write would clobber a current audit that carries
    dispositions, or when another audit run holds this component's lock."""


def audit_path(root, component, version):
    return Path(root) / "plans" / "reviews" / ("%s-v%d-audit.md" % (component, version))


def _validate(payload):
    missing = [k for k in REQUIRED_KEYS if k not in payload]
    if missing:
        raise ValueError("audit payload missing keys: %s" % ", ".join(missing))
    for bucket in ("anchored", "gaps", "dispositions"):
        if not isinstance(payload[bucket], list):
            raise ValueError("audit payload '%s' must be a list" % bucket)
    for finding in list(payload["anchored"]) + list(payload["gaps"]):
        if not isinstance(finding, dict) or "comment" not in finding:
            raise ValueError("every finding needs a 'comment'")
        tag = finding["comment"].split("]")[0] + "]"
        if tag not in ("[blocker]", "[major]", "[minor]"):
            raise ValueError("finding has no valid severity tag: %r" % finding["comment"][:60])


def render_audit(payload):
    """The artifact: prose a human reads, then the fence the board parses."""
    counts = {"blocker": 0, "major": 0, "minor": 0}
    for finding in list(payload["anchored"]) + list(payload["gaps"]):
        for sev in counts:
            if finding["comment"].startswith("[%s]" % sev):
                counts[sev] += 1
    lines = [
        "# Audit — %s v%s" % (payload["component"], payload["planVersion"]),
        "",
        "Plan: [%s](%s) · Reviewer: **%s** · Date: %s"
        % (payload["planPath"].rsplit("/", 1)[-1],
           "../../" + payload["planPath"].split("plans/", 1)[-1],
           payload["reviewer"].get("token", "?"), payload["date"]),
        "Findings: **%d blocker · %d major · %d minor**"
        % (counts["blocker"], counts["major"], counts["minor"]),
        "",
        "## Overall",
        "",
        payload["overall"],
        "",
        "## Findings",
        "",
    ]
    for label, bucket in (("Anchored", "anchored"), ("Gaps", "gaps")):
        lines.append("### %s" % label)
        lines.append("")
        if not payload[bucket]:
            lines.append("None.")
            lines.append("")
            continue
        for finding in payload[bucket]:
            ev = finding.get("evidence") or {}
            lines.append("- %s" % finding["comment"])
            if finding.get("quote"):
                lines.append('  - quote: "%s"' % finding["quote"])
            if ev.get("path"):
                lines.append("  - evidence: `%s` (%s) — %s"
                             % (ev["path"], ev.get("kind", "direct"), ev.get("detail", "")))
        lines.append("")
    lines.append("## Data")
    lines.append("")
    lines.append("```json board-audit")
    lines.append(json.dumps(payload, indent=1, sort_keys=True))
    lines.append("```")
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
    """Validate, then atomically replace this component-version's audit.

    Validation runs BEFORE any file is touched, so a malformed payload can
    never leave a partial fence on disk for the gate to read. An existing audit
    with the SAME plan hash that already carries dispositions is never
    replaced: those dispositions were made about exactly this text, and a
    background run returning late must not silently discard them.
    """
    payload.setdefault("schemaVersion", SCHEMA_VERSION)
    _validate(payload)
    target = audit_path(root, component, version)
    target.parent.mkdir(parents=True, exist_ok=True)
    existing = read_audit(root, component, version)
    if (
        existing
        and existing.get("dispositions")
        and existing.get("auditPlanHash")
        and existing.get("auditPlanHash") == payload.get("auditPlanHash")
    ):
        raise AuditLocked(
            "audit for %s v%s already carries dispositions at this plan hash" % (component, version)
        )
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
    start = raw.find("```json board-audit")
    if start < 0:
        return None
    body = raw[start + len("```json board-audit"):]
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
    confirmed a path exists goes wrong when that path is renamed, with the plan
    untouched."""
    if not audit_record:
        return False
    if audit_record.get("auditPlanHash") != audit_plan_hash(plan_text):
        return False
    recorded = audit_record.get("contextIdentity") or {"head": None, "paths": {}}
    fresh = context_identity(root, list((recorded.get("paths") or {}).keys()))
    return recorded.get("paths") == fresh["paths"]
```

Move the `import json`, `import os`, `import stat`, `import tempfile` lines to the module's existing import block rather than leaving them mid-file.

Note `is_current` compares only the `paths` map, not `head`. HEAD moves on every commit, including commits that touch nothing the audit cited, and invalidating on that would defeat the scoping decision. `head` is recorded for forensics.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m unittest tests.test_audit -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add skills/managing-planboard/scripts/audit.py tests/test_audit.py
git commit -m "audit: validated atomic artifact writes with disposition protection"
```

---

### Task 6: Codex dispatch and fallback signalling

The runner lives in Python so the trigger commands need no new Bash permission beyond the `Bash(python3:*)` they already carry. When Codex cannot run, the runner reports that fact rather than silently degrading; the caller dispatches `pb-plan-auditor` (Task 11).

**Files:**
- Modify: `skills/managing-planboard/scripts/audit.py`
- Modify: `tests/test_audit.py`

**Interfaces:**
- Consumes: everything from Tasks 1 and 5; `models.ensure_audit_stage` (Task 4).
- Produces:
  - `build_prompt(plan_text, plan_path, root, contract) -> str`
  - `parse_reviewer_json(text) -> dict` — the LAST balanced JSON object in the output.
  - `run_codex_audit(root, token, effort, prompt_path, out_path) -> dict` — `{"ok": bool, "reason": str, "payload": dict|None}`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_audit.py`:

```python
class TestParseReviewerJson(unittest.TestCase):
    def test_takes_the_last_balanced_object(self):
        text = (
            'Some preamble {"not": "it"} more text\n'
            '{"overall": "ok", "anchored": [], "gaps": []}\n'
            "trailing chatter\n"
        )
        got = audit.parse_reviewer_json(text)
        self.assertEqual(got["overall"], "ok")

    def test_handles_braces_inside_strings(self):
        text = '{"overall": "a } brace in a string", "anchored": [], "gaps": []}'
        self.assertEqual(audit.parse_reviewer_json(text)["overall"], "a } brace in a string")

    def test_returns_none_on_no_json(self):
        self.assertIsNone(audit.parse_reviewer_json("no json at all"))

    def test_returns_none_on_malformed_json(self):
        self.assertIsNone(audit.parse_reviewer_json("{broken"))


class TestBuildPrompt(unittest.TestCase):
    def test_prompt_carries_plan_path_root_and_contract(self):
        p = audit.build_prompt("PLAN BODY", "plans/execution/03-x/.draft-v2.md", "/repo", "CONTRACT")
        self.assertIn("PLAN BODY", p)
        self.assertIn("plans/execution/03-x/.draft-v2.md", p)
        self.assertIn("/repo", p)
        self.assertIn("CONTRACT", p)

    def test_plan_text_is_not_shell_interpolated(self):
        # A plan containing backticks or $(...) must survive verbatim; the
        # prompt is written to a FILE and never interpolated into a command.
        hostile = "Step 1: run `rm -rf /` and $(whoami)\n"
        p = audit.build_prompt(hostile, "x.md", "/repo", "C")
        self.assertIn("`rm -rf /`", p)
        self.assertIn("$(whoami)", p)


class TestRunCodexAudit(unittest.TestCase):
    def test_missing_executable_reports_fallback_not_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _project(tmp)
            prompt = root / "prompt.txt"
            prompt.write_text("audit this")
            result = audit.run_codex_audit(
                root, "codex-sol", "xhigh", prompt, root / "out.txt",
                _which=lambda name: None,
            )
            self.assertFalse(result["ok"])
            self.assertIn("not available", result["reason"])
            self.assertIsNone(result["payload"])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest tests.test_audit -v`
Expected: FAIL with `AttributeError: module 'audit' has no attribute 'parse_reviewer_json'`

- [ ] **Step 3: Write the implementation**

Append to `audit.py`:

```python
import shutil

CODEX_MODELS = {
    "codex-sol": "gpt-5.6-sol",
    "codex-terra": "gpt-5.6-terra",
    "codex-luna": "gpt-5.6-luna",
}


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


def parse_reviewer_json(text):
    """The LAST balanced JSON object in reviewer output.

    Reviewers wrap their answer in prose, so a greedy or first-match scan picks
    up the wrong object. Scans backward from the last closing brace, tracking
    string state so a brace inside a string never changes depth.
    """
    end = text.rfind("}")
    while end != -1:
        depth = 0
        in_str = False
        esc = False
        for i in range(end, -1, -1):
            ch = text[i]
            if esc:
                esc = False
                continue
            if in_str:
                if ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "}":
                depth += 1
            elif ch == "{":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[i:end + 1])
                    except ValueError:
                        break
        end = text.rfind("}", 0, end)
    return None
```

The backward scan's escape handling is approximate for pathological inputs; `json.loads` is the real validator and a wrong split simply falls through to the next candidate.

```python
def run_codex_audit(root, token, effort, prompt_path, out_path, _which=None, _run=None):
    """Dispatch Codex read-only. Returns ok=False with a reason on every
    failure mode — missing executable, nonzero exit, timeout, or unparseable
    output — so the caller can fall back to pb-plan-auditor. The audit is never
    silently skipped: a skipped audit reads as a clean bill of health."""
    which = _which or shutil.which
    runner = _run or subprocess.run
    if which("codex") is None:
        return {"ok": False, "reason": "codex is not available on PATH", "payload": None}
    model = CODEX_MODELS.get(token)
    if model is None:
        return {"ok": False, "reason": "unknown reviewer token %r" % token, "payload": None}
    cmd = [
        "codex", "exec", "--sandbox", "read-only",
        "-m", model,
        "-c", "model_reasoning_effort=%s" % effort,
        "-o", str(out_path),
        prompt_path.read_text(encoding="utf-8"),
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
        return {"ok": False, "reason": "could not read codex output (%s)" % e, "payload": None}
    payload = parse_reviewer_json(text)
    if payload is None:
        return {"ok": False, "reason": "codex output had no parseable JSON object", "payload": None}
    return {"ok": True, "reason": "", "payload": payload}
```

`stdin=subprocess.DEVNULL` is load-bearing. Codex launched from an agent harness with an inherited stdin hangs indefinitely at 0% CPU with no output.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m unittest tests.test_audit -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add skills/managing-planboard/scripts/audit.py tests/test_audit.py
git commit -m "audit: codex dispatch, last-balanced-JSON parsing, explicit fallback reasons"
```

---

### Task 7: The `run` CLI entry point

One command the trigger commands call, so the orchestration lives in Python rather than in prose.

**Files:**
- Modify: `skills/managing-planboard/scripts/audit.py`
- Modify: `tests/test_audit.py`

**Interfaces:**
- Consumes: Tasks 1, 4, 5, 6.
- Produces: `python3 audit.py run --component <NN-slug> --version <N> --plan <path>`, printing one status line and exiting 0 on success, 3 when a subagent fallback is required, and 1 on error.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_audit.py`:

```python
class TestRunCli(unittest.TestCase):
    def test_skips_when_a_current_audit_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _project(tmp)
            plan = root / "plans" / "execution" / "03-attrition" / ".draft-v2.md"
            plan.write_text(PLAN)
            rec = dict(SCHEMA)
            rec["auditPlanHash"] = audit.audit_plan_hash(PLAN)
            rec["contextIdentity"] = audit.context_identity(root, [])
            audit.write_audit(root, "03-attrition", 2, rec)
            out = []
            code = audit.main(
                ["run", "--component", "03-attrition", "--version", "2",
                 "--plan", str(plan)],
                root=root, stdout=out,
            )
            self.assertEqual(code, 0)
            self.assertIn("current", " ".join(out))

    def test_signals_fallback_when_codex_is_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _project(tmp)
            plan = root / "plans" / "execution" / "03-attrition" / ".draft-v2.md"
            plan.write_text(PLAN)
            out = []
            code = audit.main(
                ["run", "--component", "03-attrition", "--version", "2",
                 "--plan", str(plan)],
                root=root, stdout=out, _which=lambda n: None,
            )
            self.assertEqual(code, 3)
            self.assertIn("fallback", " ".join(out).lower())

    def test_missing_plan_file_is_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _project(tmp)
            out = []
            code = audit.main(
                ["run", "--component", "03-attrition", "--version", "2",
                 "--plan", str(root / "nope.md")],
                root=root, stdout=out,
            )
            self.assertEqual(code, 1)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest tests.test_audit.TestRunCli -v`
Expected: FAIL with `AttributeError: module 'audit' has no attribute 'main'`

- [ ] **Step 3: Write the implementation**

Append to `audit.py`:

```python
import argparse
import datetime

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_FALLBACK = 3  # caller must dispatch pb-plan-auditor via Task


def _contract_text():
    """The output contract, kept identical to pb-plan-auditor's so both
    reviewers return the same shape."""
    return (
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


def main(argv=None, root=None, stdout=None, _which=None, _run=None):
    import models  # local import: audit.py is usable without a profile

    out = stdout if stdout is not None else []
    parser = argparse.ArgumentParser(prog="audit.py")
    sub = parser.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run")
    run.add_argument("--component", required=True)
    run.add_argument("--version", type=int, required=True)
    run.add_argument("--plan", required=True)
    args = parser.parse_args(argv)

    root = Path(root) if root else Path.cwd()
    plan_file = Path(args.plan)
    if not plan_file.is_file():
        out.append("audit: plan not found: %s" % args.plan)
        _flush(out, stdout)
        return EXIT_ERROR
    plan_text = plan_file.read_text(encoding="utf-8")

    models.ensure_audit_stage(root)
    stages, _warnings = models.parse_profile(
        (root / "plans" / "model-profile.md").read_text(encoding="utf-8")
    )
    row = stages.get("plan-audit") or {"model": "codex-sol", "effort": "xhigh"}

    existing = read_audit(root, args.component, args.version)
    if existing and is_current(existing, plan_text, root):
        out.append("audit: current for %s v%d — no reviewer run"
                   % (args.component, args.version))
        _flush(out, stdout)
        return EXIT_OK

    if row["model"] == "subagent":
        out.append("audit: profile selects subagent — fallback dispatch required")
        _flush(out, stdout)
        return EXIT_FALLBACK

    prompt_path = root / "plans" / (".pb-audit-%s-v%d.txt" % (args.component, args.version))
    out_path = root / "plans" / (".pb-audit-out-%s-v%d.txt" % (args.component, args.version))
    prompt_path.write_text(
        build_prompt(plan_text, str(plan_file.relative_to(root)), str(root), _contract_text()),
        encoding="utf-8",
    )
    try:
        result = run_codex_audit(root, row["model"], row["effort"],
                                 prompt_path, out_path, _which=_which, _run=_run)
        if not result["ok"]:
            out.append("audit: %s — fallback dispatch required" % result["reason"])
            _flush(out, stdout)
            return EXIT_FALLBACK
        payload = result["payload"]
        evidence_paths = sorted({
            (f.get("evidence") or {}).get("path")
            for f in list(payload.get("anchored") or []) + list(payload.get("gaps") or [])
            if (f.get("evidence") or {}).get("path")
        })
        payload.update({
            "component": args.component,
            "planVersion": args.version,
            "planPath": str(plan_file.relative_to(root)),
            "date": datetime.date.today().isoformat(),
            "reviewer": {"token": row["model"], "effort": row["effort"]},
            "auditPlanHash": audit_plan_hash(plan_text),
            "contextIdentity": context_identity(root, evidence_paths),
            "supersedes": (existing or {}).get("auditPlanHash"),
            "dispositions": [],
        })
        payload.setdefault("anchored", [])
        payload.setdefault("gaps", [])
        try:
            write_audit(root, args.component, args.version, payload)
        except (ValueError, AuditLocked) as e:
            out.append("audit: not written (%s)" % e)
            _flush(out, stdout)
            return EXIT_ERROR
        n = len(payload["anchored"]) + len(payload["gaps"])
        out.append("audit: wrote %s v%d — %d findings"
                   % (args.component, args.version, n))
        _flush(out, stdout)
        return EXIT_OK
    finally:
        for p in (prompt_path, out_path):
            try:
                p.unlink()
            except OSError:
                pass


def _flush(out, stdout):
    if stdout is None:
        for line in out:
            print(line)


if __name__ == "__main__":
    raise SystemExit(main())
```

Add `plans/.pb-audit-*` to the repository's `.gitignore` alongside the existing `plans/.pb-review-*` entry if one exists; add both if not.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m unittest tests.test_audit -v`
Expected: PASS

- [ ] **Step 5: Run the full Python suite**

Run: `python3 -m unittest discover -s tests -v 2>&1 | tail -5`
Expected: no new failures

- [ ] **Step 6: Commit**

```bash
git add skills/managing-planboard/scripts/audit.py tests/test_audit.py .gitignore
git commit -m "audit: run CLI with currency skip and explicit fallback exit code"
```

---

### Task 8: Board types and the `board-audit` parser

**Files:**
- Modify: `board/src/lib/types.ts` (append the audit types)
- Modify: `board/src/lib/parse.ts` (append `parseAudit` beside `parseScorecard` at line 376)
- Test: `board/src/lib/parse.audit.test.ts`

**Interfaces:**
- Consumes: the fence written by Task 5's `render_audit`.
- Produces: `parseAudit(raw: string): Audit | null`, and the `Audit`, `AuditFinding`, `AuditEvidence`, `AuditSeverity` types. Tasks 9 and 10 import them.

**Warning:** `board/src/lib/parse.ts` contains a raw NUL byte at line 451, so `grep` treats the whole file as binary and silently returns nothing. Use the Read tool on it, not grep.

- [ ] **Step 1: Write the failing test**

Create `board/src/lib/parse.audit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseAudit } from "./parse";

const fence = (obj: unknown) =>
  `# Audit\n\nprose\n\n## Data\n\n\`\`\`json board-audit\n${JSON.stringify(obj)}\n\`\`\`\n`;

const VALID = {
  schemaVersion: 1,
  component: "03-attrition",
  planVersion: 2,
  planPath: "plans/execution/03-attrition/v2.md",
  date: "2026-07-25",
  reviewer: { token: "codex-sol", effort: "xhigh" },
  auditPlanHash: "a".repeat(64),
  overall: "Two gaps.",
  anchored: [
    {
      section: "Steps",
      quote: "Run the model",
      evidence: { path: "analysis/fit.R", kind: "direct", detail: "no seed set" },
      comment: "[blocker] No random seed. At execution: results are irreproducible.",
    },
  ],
  gaps: [
    {
      section: "",
      evidence: { path: "data/wave3.csv", kind: "direct", detail: "12% missing" },
      comment: "[major] No missingness rule. At execution: listwise drops the 2019 wave.",
    },
  ],
  dispositions: [],
};

describe("parseAudit", () => {
  it("parses a valid fence", () => {
    const a = parseAudit(fence(VALID));
    expect(a).not.toBeNull();
    expect(a!.component).toBe("03-attrition");
    expect(a!.anchored).toHaveLength(1);
    expect(a!.gaps).toHaveLength(1);
  });

  it("exposes severity counts", () => {
    const a = parseAudit(fence(VALID))!;
    expect(a.counts).toEqual({ blocker: 1, major: 1, minor: 0 });
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

  it("tolerates a finding with no evidence", () => {
    const noEv = { ...VALID, gaps: [{ section: "", comment: "[minor] Small thing. At execution: nothing breaks." }] };
    expect(parseAudit(fence(noEv))!.gaps[0].evidence).toBeUndefined();
  });

  it("drops a finding with no valid severity tag", () => {
    const bad = { ...VALID, gaps: [{ section: "", comment: "no tag here" }] };
    expect(parseAudit(fence(bad))!.gaps).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `board/`): `npx vitest run src/lib/parse.audit.test.ts`
Expected: FAIL — `parseAudit` is not exported from `./parse`

- [ ] **Step 3: Add the types**

Append to `board/src/lib/types.ts`:

```ts
export type AuditSeverity = "blocker" | "major" | "minor";

export type AuditEvidence = {
  path: string;
  kind: "direct" | "inferred";
  detail?: string;
};

export type AuditFinding = {
  section: string;
  quote?: string;
  evidence?: AuditEvidence;
  comment: string;
  severity: AuditSeverity;
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
  dispositions: unknown[];
  counts: Record<AuditSeverity, number>;
};
```

- [ ] **Step 4: Add the parser**

Append to `board/src/lib/parse.ts`, directly after `parseScorecard`:

```ts
const SEVERITIES: AuditSeverity[] = ["blocker", "major", "minor"];

function toFinding(raw: unknown): AuditFinding | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.comment !== "string") return null;
  const severity = SEVERITIES.find((s) => (r.comment as string).startsWith(`[${s}]`));
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
    const anchored = parsed.anchored.map(toFinding).filter(Boolean) as AuditFinding[];
    const gaps = parsed.gaps.map(toFinding).filter(Boolean) as AuditFinding[];
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

Add `Audit`, `AuditFinding`, `AuditSeverity` to the existing `import type { ... } from "./types"` line at the top of `parse.ts`.

- [ ] **Step 5: Run the test and the type check**

Run (from `board/`): `npx vitest run src/lib/parse.audit.test.ts && npx tsc --noEmit`
Expected: PASS, 8 tests, no type errors

- [ ] **Step 6: Commit**

```bash
git add board/src/lib/types.ts board/src/lib/parse.ts board/src/lib/parse.audit.test.ts
git commit -m "board: parse the board-audit fence into a typed Audit"
```

---

### Task 9: The `AuditPanel` component

**Files:**
- Create: `board/src/components/AuditPanel.tsx`
- Test: `board/src/components/AuditPanel.test.tsx`

**Interfaces:**
- Consumes: `Audit`, `AuditFinding`, `AuditSeverity` (Task 8).
- Produces: `<AuditPanel audit={audit} />`, a collapsed severity strip that expands to the findings list. Task 10 renders it.

- [ ] **Step 1: Write the failing test**

Create `board/src/components/AuditPanel.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AuditPanel from "./AuditPanel";
import type { Audit } from "../lib/types";

const audit = (over: Partial<Audit> = {}): Audit => ({
  schemaVersion: 1,
  component: "03-attrition",
  planVersion: 2,
  planPath: "plans/execution/03-attrition/v2.md",
  date: "2026-07-25",
  reviewer: { token: "codex-sol", effort: "xhigh" },
  overall: "Two material gaps.",
  anchored: [
    {
      section: "Steps",
      quote: "Run the model",
      evidence: { path: "analysis/fit.R", kind: "direct", detail: "no seed set" },
      comment: "[blocker] No random seed. At execution: results are irreproducible.",
      severity: "blocker",
    },
  ],
  gaps: [
    {
      section: "",
      evidence: { path: "data/wave3.csv", kind: "direct", detail: "12% missing" },
      comment: "[major] No missingness rule. At execution: listwise drops the 2019 wave.",
      severity: "major",
    },
  ],
  dispositions: [],
  counts: { blocker: 1, major: 1, minor: 0 },
  ...over,
});

describe("AuditPanel", () => {
  it("shows the severity strip collapsed", () => {
    render(<AuditPanel audit={audit()} />);
    expect(screen.getByText(/1 blocker/)).toBeTruthy();
    expect(screen.getByText(/1 major/)).toBeTruthy();
    expect(screen.queryByText(/No random seed/)).toBeNull();
  });

  it("expands to show findings", () => {
    render(<AuditPanel audit={audit()} />);
    fireEvent.click(screen.getByRole("button", { name: /audit/i }));
    expect(screen.getByText(/No random seed/)).toBeTruthy();
    expect(screen.getByText(/No missingness rule/)).toBeTruthy();
  });

  it("shows the evidence path for a finding", () => {
    render(<AuditPanel audit={audit()} />);
    fireEvent.click(screen.getByRole("button", { name: /audit/i }));
    expect(screen.getByText(/analysis\/fit\.R/)).toBeTruthy();
  });

  it("labels gaps distinctly from anchored findings", () => {
    render(<AuditPanel audit={audit()} />);
    fireEvent.click(screen.getByRole("button", { name: /audit/i }));
    expect(screen.getByText(/Not stated in the plan/i)).toBeTruthy();
  });

  it("reads clean when there are no findings", () => {
    render(<AuditPanel audit={audit({ anchored: [], gaps: [], counts: { blocker: 0, major: 0, minor: 0 } })} />);
    expect(screen.getByText(/no findings/i)).toBeTruthy();
  });

  it("names the reviewer that produced it", () => {
    render(<AuditPanel audit={audit()} />);
    fireEvent.click(screen.getByRole("button", { name: /audit/i }));
    expect(screen.getByText(/codex-sol/)).toBeTruthy();
  });

  it("surfaces a fallback reviewer", () => {
    render(
      <AuditPanel
        audit={audit({ reviewer: { token: "subagent", reviewerFallback: "codex is not available on PATH" } })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /audit/i }));
    expect(screen.getByText(/not available on PATH/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `board/`): `npx vitest run src/components/AuditPanel.test.tsx`
Expected: FAIL — cannot resolve `./AuditPanel`

- [ ] **Step 3: Write the component**

Create `board/src/components/AuditPanel.tsx`:

```tsx
import { useState } from "react";
import type { Audit, AuditFinding, AuditSeverity } from "../lib/types";

const SEV_CLASS: Record<AuditSeverity, string> = {
  blocker:
    "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300",
  major:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  minor:
    "border-stone-300 bg-stone-50 text-stone-600 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-400",
};

function Finding({ finding, gap }: { finding: AuditFinding; gap: boolean }) {
  return (
    <li className="border-t border-stone-200 py-2 text-xs dark:border-stone-700">
      <div className="flex items-baseline gap-2">
        <span className={`rounded border px-1.5 py-0.5 font-medium ${SEV_CLASS[finding.severity]}`}>
          {finding.severity}
        </span>
        {gap ? (
          <span className="text-stone-500 dark:text-stone-400">Not stated in the plan</span>
        ) : (
          finding.section && <span className="text-stone-500 dark:text-stone-400">{finding.section}</span>
        )}
      </div>
      <p className="mt-1 text-stone-700 dark:text-stone-300">{finding.comment}</p>
      {finding.quote && (
        <p className="mt-1 border-l-2 border-stone-300 pl-2 italic text-stone-500 dark:border-stone-600">
          {finding.quote}
        </p>
      )}
      {finding.evidence && (
        <p className="mt-1 text-stone-500 dark:text-stone-400">
          <code>{finding.evidence.path}</code>
          {finding.evidence.kind === "inferred" && " (inferred)"}
          {finding.evidence.detail && ` — ${finding.evidence.detail}`}
        </p>
      )}
    </li>
  );
}

/**
 * The plan-header audit: a severity strip that expands to the findings list.
 * Read-only, and deliberately separate from the rubric score beside it — the
 * score asks whether the plan is a checkable contract, this asks whether it
 * will actually work. "15/15 with two blockers" is a coherent state.
 */
export default function AuditPanel({ audit }: { audit: Audit }) {
  const [open, setOpen] = useState(false);
  const { blocker, major, minor } = audit.counts;
  const total = blocker + major + minor;
  const label = total === 0 ? "no findings" : `${blocker} blocker · ${major} major · ${minor} minor`;
  const tone = blocker > 0 ? SEV_CLASS.blocker : major > 0 ? SEV_CLASS.major : SEV_CLASS.minor;

  return (
    <span className="relative inline-block">
      <button
        aria-label="audit findings"
        className={`rounded border px-2 py-0.5 text-xs font-medium ${tone}`}
        onClick={() => setOpen((o) => !o)}
      >
        audit: {label}
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-96 rounded-lg border border-stone-300 bg-white p-3 shadow-lg dark:border-stone-600 dark:bg-stone-900">
          <p className="text-xs text-stone-700 dark:text-stone-300">{audit.overall}</p>
          <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
            {audit.reviewer.token}
            {audit.reviewer.effort ? ` · ${audit.reviewer.effort}` : ""} · {audit.date}
          </p>
          {audit.reviewer.reviewerFallback && (
            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
              fell back: {audit.reviewer.reviewerFallback}
            </p>
          )}
          <ul className="mt-2">
            {audit.anchored.map((f, i) => (
              <Finding key={`a${i}`} finding={f} gap={false} />
            ))}
            {audit.gaps.map((f, i) => (
              <Finding key={`g${i}`} finding={f} gap />
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}
```

- [ ] **Step 4: Run the test and type check**

Run (from `board/`): `npx vitest run src/components/AuditPanel.test.tsx && npx tsc --noEmit`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add board/src/components/AuditPanel.tsx board/src/components/AuditPanel.test.tsx
git commit -m "board: AuditPanel — severity strip expanding to grounded findings"
```

---

### Task 10: Render the audit strip in `PlanReader`

**Files:**
- Modify: `board/src/views/PlanReader.tsx:308-319` (add the audit memo) and `:386` (render beside `ScorePanel`)
- Test: `board/src/views/PlanReader.audit.test.tsx`

**Interfaces:**
- Consumes: `parseAudit` (Task 8), `AuditPanel` (Task 9).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test**

Create `board/src/views/PlanReader.audit.test.tsx`. The fixture below mirrors `PlanReader.score.test.tsx:22-57` deliberately — that file keeps its `data()`/`draw()` builders local rather than exporting them, so this test carries its own copy of the same shape instead of extracting a shared module for two callers.

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import PlanReader from "./PlanReader";
import type { BoardData } from "../lib/types";

afterEach(cleanup);

const SIGNED_PATH = "plans/execution/01-x/v1.md";
const noop = () => {};

function auditFence(planPath: string): string {
  return `# Audit\n\n\`\`\`json board-audit
${JSON.stringify({
  schemaVersion: 1,
  component: "01-x",
  planVersion: 1,
  planPath,
  date: "2026-07-25",
  reviewer: { token: "codex-sol", effort: "xhigh" },
  overall: "One blocker.",
  anchored: [],
  gaps: [
    {
      section: "",
      evidence: { path: "data/wave3.csv", kind: "direct", detail: "12% missing" },
      comment: "[blocker] No missingness rule. At execution: listwise drops the 2019 wave.",
    },
  ],
  dispositions: [],
})}
\`\`\`
`;
}

const SCORECARD = `\`\`\`json board-scorecard
{"schemaVersion":3,"status":"scored","component":"01-x","planVersion":1,"planPath":"${SIGNED_PATH}","rubricVersion":"0.4","date":"2026-07-25","channels":[{"id":"goal","score":3},{"id":"decisions","score":3},{"id":"steps","score":3},{"id":"validation","score":3},{"id":"boundaries","score":3}],"total":15,"max":15,"profile":"G3·D3·S3·V3·B3"}
\`\`\``;

function data(reviews: { path: string; content: string }[]): BoardData {
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
    draw(data([{ path: "plans/reviews/01-x-v1-audit.md", content: auditFence(SIGNED_PATH) }]));
    expect(screen.getByText(/audit: 1 blocker/)).toBeTruthy();
  });

  it("renders nothing when the audit belongs to another version", () => {
    draw(
      data([
        { path: "plans/reviews/01-x-v9-audit.md", content: auditFence("plans/execution/01-x/v9.md") },
      ]),
    );
    expect(screen.queryByText(/audit:/)).toBeNull();
  });

  it("renders nothing when there is no audit", () => {
    draw(data([]));
    expect(screen.queryByText(/audit:/)).toBeNull();
  });

  it("shows nothing when two audits claim the same plan path", () => {
    const content = auditFence(SIGNED_PATH);
    draw(
      data([
        { path: "plans/reviews/a-audit.md", content },
        { path: "plans/reviews/b-audit.md", content },
      ]),
    );
    expect(screen.queryByText(/audit:/)).toBeNull();
  });

  it("still renders the score strip alongside", () => {
    draw(
      data([
        { path: "plans/reviews/01-x-v1-audit.md", content: auditFence(SIGNED_PATH) },
        { path: "plans/reviews/01-x-v1.md", content: SCORECARD },
      ]),
    );
    expect(screen.getByText(/audit: 1 blocker/)).toBeTruthy();
    expect(screen.getByTitle("Plan score — click for the full diagnosis")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `board/`): `npx vitest run src/views/PlanReader.audit.test.tsx`
Expected: FAIL — no audit strip rendered

- [ ] **Step 3: Add the memo**

In `PlanReader.tsx`, directly after the `scorecard` memo at lines 313-319:

```tsx
  // The audit for THIS document, matched the same way the scorecard is: by
  // exact planPath. A duplicate match is ambiguous — show nothing rather than
  // the wrong audit.
  const auditRecord = useMemo(() => {
    if (!doc || (doc.docKind !== "signed" && doc.docKind !== "workingDraft")) return null;
    const matches = data.files.reviews
      .map((r) => parseAudit(r.content))
      .filter((a) => a && a.planPath === doc.path);
    return matches.length === 1 ? matches[0] : null;
  }, [doc, data.files.reviews]);
```

- [ ] **Step 4: Render it**

At `PlanReader.tsx:386`, beside the existing score strip:

```tsx
            {scorecard && <ScorePanel scorecard={scorecard} />}
            {auditRecord && <AuditPanel audit={auditRecord} />}
```

Add the two imports: `parseAudit` to the existing `../lib/parse` import, and `AuditPanel` from `../components/AuditPanel`.

- [ ] **Step 5: Run the tests and type check**

Run (from `board/`): `npx vitest run src/views/ && npx tsc --noEmit`
Expected: PASS, including every pre-existing PlanReader test

- [ ] **Step 6: Run the whole board suite**

Run (from `board/`): `npm test`
Expected: PASS, no regressions

- [ ] **Step 7: Commit**

```bash
git add board/src/views/PlanReader.tsx board/src/views/PlanReader.audit.test.tsx
git commit -m "board: render the audit strip beside the score strip in PlanReader"
```

---

### Task 11: Trigger the audit from `/planboard:plan`

**Files:**
- Modify: `commands/plan.md:4` (frontmatter) and step 6
- Modify: `skills/managing-planboard/references/planning-doctrine.md` (one paragraph on the two channels)
- Test: `tests/test_command_docs.py` (extend the existing checks)

**Interfaces:**
- Consumes: `audit.py run` (Task 7), `pb-plan-auditor` (Task 3).
- Produces: nothing downstream. Seam 2 adds the gate paths.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_command_docs.py`:

```python
class TestAuditWiring(unittest.TestCase):
    def _cmd(self, name):
        return (ROOT / "commands" / name).read_text(encoding="utf-8")

    def test_plan_command_can_dispatch_the_fallback_subagent(self):
        head = self._cmd("plan.md").split("---")[1]
        self.assertIn("Task", head)

    def test_plan_command_runs_the_audit(self):
        body = self._cmd("plan.md")
        self.assertIn("audit.py", body)
        self.assertIn("pb-plan-auditor", body)

    def test_plan_command_documents_the_fallback_exit_code(self):
        self.assertIn("exit 3", self._cmd("plan.md"))
```

Read the top of `tests/test_command_docs.py` first and reuse its existing `ROOT` constant and helper style rather than redefining them.

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m unittest tests.test_command_docs.TestAuditWiring -v`
Expected: FAIL — `Task` is not in `plan.md`'s frontmatter

- [ ] **Step 3: Add `Task` to the frontmatter**

`commands/plan.md` line 4 becomes:

```
allowed-tools: Read, Write, Edit, Glob, Grep, AskUserQuestion, Task, Bash(python3:*), Bash(git:*), Bash(ls:*), Bash(date:*), Bash(mkdir:*)
```

`Task` is the only addition. Codex runs inside `audit.py`, which `Bash(python3:*)` already permits, so no external-command permission is needed. `Task` covers the fallback dispatch.

- [ ] **Step 4: Add the audit to step 6**

In `commands/plan.md` step 6, after the sentence that runs the review workflow, add:

> **Dispatch the audit.** Immediately after the review workflow, run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/managing-planboard/scripts/audit.py run --component <NN-slug> --version <N> --plan <the draft path>` **in the background** and continue without waiting — the reviewer takes minutes and the live board picks the artifact up on auto-refresh. Tell the researcher the audit is running. **Exit 0** means the audit was written or an existing one was still current. **Exit 3** means a fallback is required: dispatch one `pb-plan-auditor` Task with the draft's full content, its on-disk path, the repository root, and the same output contract, then write its JSON through `audit.py` rather than by hand, and relay the fallback reason to the researcher. **Exit 1** is an error: report it and continue — a failed audit never blocks authoring. Never report an audit as clean when it did not run; a silently skipped audit reads as a clean bill of health.
>
> The audit answers a different question from the scorecard. The score says whether the plan is a checkable contract; the audit says whether it will work against this repository and data. A plan can score 15/15 and carry blockers, and that is a coherent state, not a contradiction. Report both, and never merge them into one judgment.

- [ ] **Step 5: Document the two channels in the doctrine**

Add to `skills/managing-planboard/references/planning-doctrine.md` a short section titled "Two review channels" carrying the same distinction: the rubric scores control and reads only the plan; the audit checks correctness and reads the repository; neither substitutes for the other; a high score predicts more audit findings, not fewer, because a specific plan is a falsifiable one.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `python3 -m unittest tests.test_command_docs -v`
Expected: PASS

- [ ] **Step 7: Run both full suites**

Run: `python3 -m unittest discover -s tests -v 2>&1 | tail -5`
Run (from `board/`): `npm test && npx tsc --noEmit`
Expected: PASS on both, no regressions

- [ ] **Step 8: Commit**

```bash
git add commands/plan.md skills/managing-planboard/references/planning-doctrine.md tests/test_command_docs.py
git commit -m "plan: dispatch the audit at draft time with a pb-plan-auditor fallback"
```

---

### Task 12: The Models view tolerates a reviewer row

Without this, a migrated profile breaks the Models tab: `ModelProfileRow.mechanism` is typed `"nudge" | "agent"` (`board/src/lib/types.ts:60`), so the seventh row arrives as a value the union does not admit.

**Files:**
- Modify: `board/src/lib/types.ts:55-61`
- Modify: `board/src/views/Models.tsx` (row rendering and the per-row edit gate)
- Test: `board/src/views/Models.reviewer.test.tsx`

**Interfaces:**
- Consumes: the profile shape the server sends from Task 2's parser.
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test**

Create `board/src/views/Models.reviewer.test.tsx`. Read `board/src/views/Models.test.tsx` first and mirror its existing `BoardData` + `ModelProfile` fixture shape exactly, adding a seventh row:

```tsx
{ stage: "plan-audit", label: "plan audit (deep)", model: "codex-sol", effort: "xhigh", mechanism: "reviewer" }
```

Assert four behaviours:

```tsx
it("renders the reviewer row", () => {
  // the row's label and its model token both appear
  expect(screen.getByText("plan audit (deep)")).toBeTruthy();
  expect(screen.getByText("codex-sol")).toBeTruthy();
});

it("renders the reviewer row's model as static text, not an editable control", () => {
  // the six Claude rows expose a model control; this row does not
  expect(screen.queryByLabelText("model for plan audit (deep)")).toBeNull();
});

it("explains why the row is not editable", () => {
  expect(screen.getByTitle(/edited with \/planboard:models/i)).toBeTruthy();
});

it("still lets the six Claude rows be edited", () => {
  expect(screen.getByLabelText("model for plan (co-authoring)")).toBeTruthy();
});
```

Use whatever accessible name the existing Models editor actually gives its model controls — read `Models.tsx:326-359` and match it rather than inventing `aria-label`s. If the controls have no accessible name today, add one as part of this task; a control a test cannot name is a control a screen reader cannot name either.

- [ ] **Step 2: Run the test to verify it fails**

Run (from `board/`): `npx vitest run src/views/Models.reviewer.test.tsx`
Expected: FAIL

- [ ] **Step 3: Widen the type**

`board/src/lib/types.ts:60` becomes:

```ts
  // `reviewer` rows name an auditor token (codex-sol | codex-terra |
  // codex-luna | subagent) rather than a Claude model, so the board renders
  // them read-only: its editor's vocabulary is Claude aliases only.
  mechanism: "nudge" | "agent" | "reviewer";
```

Update the `stage` comment on line 56 to include `plan-audit`.

- [ ] **Step 4: Render reviewer rows read-only**

In `Models.tsx`, gate the per-row editability on the mechanism as well as the existing `canEdit`:

```tsx
const rowEditable = canEdit && row.mechanism !== "reviewer";
```

Render a reviewer row's model and effort as static text carrying `title="Reviewer rows are edited with /planboard:models — the board's editor only knows Claude models."`. Leave `canEdit`, the save path, and the 409 rebase untouched: this is a per-row render gate, not a new permission concept.

- [ ] **Step 5: Run the tests and type check**

Run (from `board/`): `npx vitest run src/views/Models.reviewer.test.tsx src/views/Models.test.tsx && npx tsc --noEmit`
Expected: PASS, no regressions in the existing Models tests

- [ ] **Step 6: Commit**

```bash
git add board/src/lib/types.ts board/src/views/Models.tsx board/src/views/Models.reviewer.test.tsx
git commit -m "board: render the plan-audit reviewer row read-only in the Models view"
```

---

### Task 13: Repoint the manual Codex reviewer at the profile row

The spec's originating complaint: the board's *Review with Codex* is pinned to `gpt-5.5` at default effort while the local `/codex` habit runs `gpt-5.6-sol` at `xhigh`. The menu keeps all four choices; only the Codex choice's model and effort now come from the profile.

**Files:**
- Modify: `commands/board.md` step 5 (the `codex` dispatch bullet)
- Test: `tests/test_command_docs.py`

**Interfaces:**
- Consumes: the `plan-audit` row (Task 2), `_contract_text` equivalence (Task 7).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test**

Append to the `TestAuditWiring` class from Task 11:

```python
    def test_board_codex_is_not_pinned_to_a_stale_model(self):
        body = self._cmd("board.md")
        self.assertNotIn("-m gpt-5.5", body)

    def test_board_codex_reads_the_profile_row(self):
        body = self._cmd("board.md")
        self.assertIn("plan-audit", body)

    def test_plan_scope_codex_uses_the_gaps_contract(self):
        body = self._cmd("board.md")
        self.assertIn("gaps", body)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m unittest tests.test_command_docs.TestAuditWiring -v`
Expected: FAIL — `-m gpt-5.5` is still present

- [ ] **Step 3: Rewrite the codex dispatch bullet**

In `commands/board.md` step 5, the `codex` bullet becomes:

> **`codex`** — resolve the model and effort from the profile's audit row (`python3 ${CLAUDE_PLUGIN_ROOT}/skills/managing-planboard/scripts/models.py stage plan-audit`), mapping the token to its model id (`codex-sol` → `gpt-5.6-sol`, `codex-terra` → `gpt-5.6-terra`, `codex-luna` → `gpt-5.6-luna`) and falling back to `codex-sol` at `xhigh` when the row is absent or names `subagent`. Then run `codex exec --sandbox read-only -m <model> -c model_reasoning_effort=<effort> -o plans/.pb-review-out.txt "$(cat plans/.pb-review-<slug>.txt)" < /dev/null` — **read-only** (a review must not mutate the repo), the prompt passed via a shell-safe substitution, the final message saved with `-o`. Parse the LAST balanced JSON object from `plans/.pb-review-out.txt`.

Then add, immediately after the shared output-contract paragraph:

> **Plan scope uses the audit contract.** When `reviewRequest.scope` is `plan` and the chosen agent is `codex` or `subagent`, the reviewer returns `{"overall", "anchored", "gaps"}` instead of `{"overall", "comments"}` — identical to the audit channel's contract, including the requirement that every finding name the concrete execution failure it predicts and carry an `evidence` object naming a path the reviewer actually opened. `anchored` findings seed as annotations exactly as `comments` do today; `gaps` carry no quote and are relayed to the researcher in session rather than seeded. `gemini` and `panel` keep the single-bucket `comments` contract: the Gemini path is given no repository access, and the panel's per-seat caps contradict the audit's no-cap rule.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m unittest tests.test_command_docs -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add commands/board.md tests/test_command_docs.py
git commit -m "board: manual Codex reviewer follows the profile's audit row"
```

---

## After this plan

The board template is NOT rebuilt by any task here, so a live board still serves the old bundle. Rebuilding (`npm run build`, which rewrites the tracked 460KB `board-template.html`) belongs to the release that ships this, together with seam 2.

Seam 2, a separate plan: the currency pre-flight in `/sign`, the `/execute` gate and `/sync`; revalidation inside `sign_lock` immediately before `write_ticket`; blocker dispositions with reasons; `resolved` recorded from the supersedes pointer; decision-log entries attributing the finding to the reviewer and the decision to the researcher; and the `Task` permission on `/sign` and `/sync`.
