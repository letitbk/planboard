# Codex Handoff + Automatic Execute Nudge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the model-profile nudge fire deterministically (drop the self-identity gate), and add a `/planboard:handoff` command that writes a marked, path-resolved planboard block into a project's `AGENTS.md` so a cooperative codex can run the plan→execute→results loop.

**Architecture:** Two independent units. (1) Prose-only de-gating across four command/skill files. (2) A stdlib generator `handoff.py` that reuses `signoff_gate.py`'s dual-marker opt-in, renders a reviewable template `agents-md-section.md` with the plugin's absolute install path baked in, and splices it into `AGENTS.md` between `<!-- planboard:start -->`…`<!-- planboard:end -->` markers (append to a marker-less file, refresh an existing block, refuse malformed markers), plus a thin command file and the release mechanics.

**Tech Stack:** Python 3 stdlib only (no pip); `unittest` (run via `python3 -m unittest`); markdown command/skill/template files. No board/TypeScript changes.

## Global Constraints

- **Threat model = cooperative codex.** The sign hook is `Write|Edit`-only and Claude-only; it does not gate codex. Post-sign codex integrity is git audit + convention, not structural enforcement. Never write "closes the forgery gap" or "unconditional enforcement" into any artifact.
- **Design source of truth:** `docs/plans/2026-07-23-codex-handoff-and-auto-nudge-design.md` (revised, codex-reviewed).
- **Names:** current agents are `pb-*` (not `rp-*`). Product/command namespace is `planboard`.
- **Scripts:** python3 stdlib only, `#!/usr/bin/env python3`, module docstring, same conventions as `models.py`/`check_update.py`. Tests: `unittest`, one file per script under `tests/`, header comment naming the run command.
- **Dual-marker opt-in (reuse, do not re-derive):** `signoff_gate.MASTER_MARKERS = ("<!-- planboard:master-plan -->", "<!-- research-plans:master-plan -->")`, `signoff_gate.CLAUDE_MARKERS = ("<!-- planboard:start -->", "<!-- research-plans:start -->")`. Both required or even the Claude gate is inactive.
- **Prose:** never hard-wrap; one paragraph per line. No `Co-Authored-By` in commits. Conventional prefixes (`feat(...)`, `docs(...)`, `test(...)`).
- **Provenance:** the codex model id is supplied by the researcher / the command invocation — never self-inferred by codex.
- **Green suite before each commit:** `python3 -m unittest discover -s tests -v` (87 pre-existing Python tests + the new file must all pass).
- **Version:** this is shipped behavior → bump `.claude-plugin/plugin.json` and `board/package.json` `1.0.0 → 1.1.0` (minor; feature). `marketplace.json` is version-less. Sync `board/package-lock.json`. CHANGELOG + command docs required.
- **Verify-first (external runtime facts):** codex's `AGENTS.md` project-root loading and that codex lacks `${CLAUDE_PLUGIN_ROOT}` (Task 1) — these decide the write target and the whole absolute-path design.

## File Map

| File | Task | Role |
|---|---|---|
| (verification only) | 1 | Confirm codex `AGENTS.md` loading + no `${CLAUDE_PLUGIN_ROOT}` |
| `commands/plan.md`, `commands/sync.md`, `skills/managing-planboard/references/execution-loop.md`, `skills/managing-planboard/SKILL.md` | 2 | De-gate the nudge (prose) |
| `skills/managing-planboard/scripts/handoff.py` | 3 | Create — generator |
| `skills/managing-planboard/templates/agents-md-section.md` | 3 | Create — codex-facing block template |
| `tests/test_handoff.py` | 3 | Create — marker/gate/splice tests |
| `commands/handoff.md` | 4 | Create — the command |
| `.claude-plugin/plugin.json`, `board/package.json`, `board/package-lock.json`, `CHANGELOG.md`, `docs/reference.md`, `README.md` | 5 | Docs + release mechanics |

---

### Task 1: Verify external codex facts (gates the design)

**Files:** none (verification). Produces a go/adjust decision for Tasks 3–4's write target.

- [ ] **Step 1: Confirm AGENTS.md loading + env**

Use the `openai-docs` skill (or codex docs) to confirm: (a) codex auto-loads `AGENTS.md` from the project root (and, if nested rules exist, that a repo-root `AGENTS.md` is honored); (b) codex has no `${CLAUDE_PLUGIN_ROOT}` (so absolute paths baked at generation time are required). Record findings in one paragraph appended to the design doc's "Verify before implementation" section.

- [ ] **Step 2: Decide the write target**

Expected: target is `<project-root>/AGENTS.md`. If the docs say codex reads a different filename/location, update Tasks 3–4 to that path before proceeding (only the target path changes; the splice logic is identical).

- [ ] **Step 3: Commit the doc note**

```bash
git add docs/plans/2026-07-23-codex-handoff-and-auto-nudge-design.md
git commit -m "docs(handoff): record verified codex AGENTS.md loading facts"
```

---

### Task 2: De-gate the model nudge (prose-only, four files)

**Files:**
- Modify: `commands/plan.md` (the `**Model nudge**` paragraph)
- Modify: `commands/sync.md` (the `**Model nudge**` paragraph)
- Modify: `skills/managing-planboard/references/execution-loop.md` ("The execute prompt" → step 2)
- Modify: `skills/managing-planboard/SKILL.md` ("Model nudge (execution)" line)

**Interfaces:** Consumes `models.py stage <key>` output (unchanged). Produces no code symbols.

- [ ] **Step 1: `commands/plan.md` — remove the self-identity gate**

Replace the sentence beginning `Output is a JSON row; when its model is not \`inherit\` and differs from the model you are running as (you know your own identity), print exactly one line —` through its end (`…never repeat it later in the session.`) with:

```
Output is a JSON row; when its model is not `inherit`, print exactly one line — `Model profile: this stage is set to <model>. Switch with /model <model> if you're not already on it (safe mid-conversation — nothing is lost), or continue as-is.` — substituting the profile's model, and appending `, effort <level>` to the `/model` suggestion when the row names an effort and your build exposes a session effort control. Then proceed; never block on the nudge, never repeat it later in the session.
```

- [ ] **Step 2: `commands/sync.md` — same de-gate**

Replace the sentence beginning `Output is a JSON row; when its model is not \`inherit\` and differs from the model you are running as (you know your own identity), print exactly one line —` through `…substituting the profile's model and your current one.` with:

```
Output is a JSON row; when its model is not `inherit`, print exactly one line — `Model profile: this stage is set to <model>. Switch with /model <model> if you're not already on it (safe mid-conversation — nothing is lost), or continue as-is.` — substituting the profile's model.
```

- [ ] **Step 3: `execution-loop.md` — de-gate the execute prompt (step 2)**

Replace the whole `2. **Which model?**` bullet with:

```
2. **Which model?** Pre-select the profile's `execute` row (`models.py stage execute`) whenever it yields a usable non-`inherit` row — empty output (no profile or no usable row) means omit the pre-selection and say nothing. Offer the standard alternatives (opus / sonnet / haiku / a custom id). On any non-`inherit` selection, print the switch line and WAIT for the researcher to switch (this is the only place the nudge blocks) — never compare against your own identity. When the selection matches the profile row: `Model profile: this stage is set to <model>. Switch with /model <model> if you're not already on it, or continue as-is.` When the researcher overrides the row: `Execution choice: use <model> — switch with /model <model> if you're not already on it, or continue as-is.` If already on that model the switch is a harmless no-op.
```

- [ ] **Step 4: `SKILL.md` — de-gate the execution nudge line**

Replace `In the \`/planboard:execute\` prompt, pre-select that row; when the researcher chooses a different model from the one you are running as, print the standard one-line \`/model\` nudge and wait for the switch.` with:

```
In the `/planboard:execute` prompt, pre-select that row only when the stage yields a usable non-`inherit` row; on any non-`inherit` selection print the one-line `/model` nudge and wait for the switch — never compare against your own identity.
```

- [ ] **Step 5: Verify the gate is gone**

Run: `grep -rn "you know your own identity\|differs from the model you are running as" commands/ skills/`
Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add commands/plan.md commands/sync.md skills/managing-planboard/references/execution-loop.md skills/managing-planboard/SKILL.md
git commit -m "feat(models): fire the model nudge deterministically, drop the self-identity gate"
```

---

### Task 3: `handoff.py` generator + template + tests

**Files:**
- Create: `skills/managing-planboard/templates/agents-md-section.md`
- Create: `skills/managing-planboard/scripts/handoff.py`
- Test: `tests/test_handoff.py`

**Interfaces:**
- Consumes: `signoff_gate.MASTER_MARKERS`, `signoff_gate.CLAUDE_MARKERS`.
- Produces: `handoff.py` with `SKILL_DIR` (Path), `BLOCK_START`/`BLOCK_END` (str), `find_root(start=None)->Path`, `dual_markers_ok(root)->(bool,str)`, `render_block(codex_model)->str`, `splice(existing,block)->(str,str)` (raises `ValueError` on malformed markers), `cmd_generate(root,codex_model)->int`, `main(argv)->int` with subcommand `generate --codex-model <id>` and global `--root`. Task 4's command invokes `main` via `generate`.

- [ ] **Step 1: Write the block template**

Create `skills/managing-planboard/templates/agents-md-section.md` (placeholders `{{SKILL_DIR}}`, `{{CODEX_MODEL}}` are substituted by `render_block`; single-line paragraphs):

```markdown
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
```

- [ ] **Step 2: Write the failing tests**

Create `tests/test_handoff.py`:

```python
"""Tests for handoff.py. Run:
    python3 -m unittest tests.test_handoff -v
"""
import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "skills" / "managing-planboard" / "scripts"
sys.path.insert(0, str(SCRIPTS))
import handoff  # noqa: E402


def make_project(tmp, master_marker=True, claude_marker=True):
    root = Path(tmp)
    (root / "plans").mkdir(parents=True, exist_ok=True)
    mp = "<!-- planboard:master-plan -->\n# Master plan\n" if master_marker else "# Master plan\n"
    (root / "plans" / "master-plan.md").write_text(mp, encoding="utf-8")
    if claude_marker:
        (root / "CLAUDE.md").write_text(
            "# CLAUDE\n<!-- planboard:start -->\nx\n<!-- planboard:end -->\n", encoding="utf-8"
        )
    return root


def run_generate(root, model="gpt-5.6"):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = handoff.main(["--root", str(root), "generate", "--codex-model", model])
    return code, out.getvalue(), err.getvalue()


class TestDualMarkers(unittest.TestCase):
    def test_missing_claude_marker_refuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, claude_marker=False)
            code, out, err = run_generate(root)
            self.assertEqual(code, 2)
            self.assertFalse((root / "AGENTS.md").exists())
            self.assertIn("sign gate is inactive", err)

    def test_missing_master_marker_refuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, master_marker=False)
            code, out, err = run_generate(root)
            self.assertEqual(code, 2)
            self.assertIn("marker", err)


class TestGenerate(unittest.TestCase):
    def test_fresh_writes_marked_block_with_resolved_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            code, out, err = run_generate(root, "gpt-5.6")
            self.assertEqual(code, 0)
            text = (root / "AGENTS.md").read_text()
            self.assertIn(handoff.BLOCK_START, text)
            self.assertIn(handoff.BLOCK_END, text)
            self.assertIn(str(handoff.SKILL_DIR), text)
            self.assertIn("gpt-5.6", text)
            self.assertNotIn("{{", text)
            self.assertIn("wrote AGENTS.md", out)

    def test_appends_to_markerless_file_preserving_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            (root / "AGENTS.md").write_text("# My own codex rules\nkeep me\n", encoding="utf-8")
            code, out, err = run_generate(root)
            self.assertEqual(code, 0)
            text = (root / "AGENTS.md").read_text()
            self.assertIn("keep me", text)
            self.assertIn(handoff.BLOCK_START, text)
            self.assertIn("appended", out)

    def test_refreshes_existing_block_preserving_outside(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            run_generate(root, "gpt-5.6")
            existing = (root / "AGENTS.md").read_text()
            (root / "AGENTS.md").write_text("top\n" + existing + "bottom\n", encoding="utf-8")
            code, out, err = run_generate(root, "gpt-5.6-terra")
            self.assertEqual(code, 0)
            text = (root / "AGENTS.md").read_text()
            self.assertIn("top", text)
            self.assertIn("bottom", text)
            self.assertIn("gpt-5.6-terra", text)
            self.assertEqual(text.count(handoff.BLOCK_START), 1)
            self.assertIn("refreshed", out)

    def test_malformed_markers_stop_without_writing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            (root / "AGENTS.md").write_text(handoff.BLOCK_START + "\nno end\n", encoding="utf-8")
            code, out, err = run_generate(root)
            self.assertEqual(code, 2)
            self.assertIn("malformed", err)
            self.assertIn(handoff.BLOCK_START + "\nno end", (root / "AGENTS.md").read_text())


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python3 -m unittest tests.test_handoff -v`
Expected: FAIL at import — `ModuleNotFoundError: No module named 'handoff'`.

- [ ] **Step 4: Write `handoff.py`**

Create `skills/managing-planboard/scripts/handoff.py`:

```python
#!/usr/bin/env python3
"""planboard codex handoff — generate/refresh the marked planboard block in a
project's AGENTS.md so a cooperative codex can run the loop by reading the
plugin's shipped references and running its stdlib scripts by absolute path.
Stdlib only.

Subcommand:
    generate --codex-model <id>   write/refresh the planboard block in
                                  <root>/AGENTS.md. Requires the dual opt-in
                                  markers (a marked plans/master-plan.md AND a
                                  planboard marker in CLAUDE.md); without both,
                                  even the Claude sign gate is inactive, so this
                                  refuses (exit 2). A marker-less AGENTS.md is
                                  appended to; an existing block is refreshed;
                                  malformed markers stop the write untouched.
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import signoff_gate  # noqa: E402  (reuse the dual-marker opt-in constants)

SKILL_DIR = Path(__file__).resolve().parents[1]  # skills/managing-planboard
TEMPLATE = SKILL_DIR / "templates" / "agents-md-section.md"
BLOCK_START = "<!-- planboard:start -->"
BLOCK_END = "<!-- planboard:end -->"


def find_root(start=None):
    p = Path(start if start else Path.cwd()).resolve()
    for cand in (p, *p.parents):
        if (cand / "plans" / "master-plan.md").exists():
            return cand
    return p


def dual_markers_ok(root):
    """(ok, reason). Mirrors signoff_gate.find_project_root's opt-in: a marked
    plans/master-plan.md AND a planboard marker in CLAUDE.md."""
    mp = root / "plans" / "master-plan.md"
    if not mp.is_file():
        return False, "no plans/master-plan.md — run /planboard:init first"
    try:
        mtext = mp.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return False, "cannot read plans/master-plan.md (%s)" % e
    if not any(mk in mtext for mk in signoff_gate.MASTER_MARKERS):
        return False, "plans/master-plan.md is missing its planboard marker"
    cm = root / "CLAUDE.md"
    if not cm.is_file():
        return False, "no CLAUDE.md planboard block — the sign gate is inactive; run /planboard:init"
    try:
        ctext = cm.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return False, "cannot read CLAUDE.md (%s)" % e
    if not any(mk in ctext for mk in signoff_gate.CLAUDE_MARKERS):
        return False, "CLAUDE.md is missing its planboard block — the sign gate is inactive; run /planboard:init"
    return True, ""


def render_block(codex_model):
    stamp = "<!-- planboard:agents-handoff root %s model %s -->" % (SKILL_DIR, codex_model)
    body = TEMPLATE.read_text(encoding="utf-8")
    body = body.replace("{{SKILL_DIR}}", str(SKILL_DIR)).replace("{{CODEX_MODEL}}", codex_model)
    return "%s\n%s\n%s\n%s" % (BLOCK_START, stamp, body.rstrip("\n"), BLOCK_END)


def splice(existing, block):
    """(new_text, action). Raises ValueError on malformed markers."""
    n_start, n_end = existing.count(BLOCK_START), existing.count(BLOCK_END)
    if n_start == 0 and n_end == 0:
        sep = "" if existing == "" else ("\n" if existing.endswith("\n") else "\n\n")
        return existing + sep + block + "\n", "appended"
    if n_start != 1 or n_end != 1:
        raise ValueError(
            "AGENTS.md has malformed planboard markers (%d start, %d end)" % (n_start, n_end)
        )
    i, j = existing.index(BLOCK_START), existing.index(BLOCK_END)
    if j < i:
        raise ValueError("AGENTS.md planboard markers are in reverse order")
    return existing[:i] + block + existing[j + len(BLOCK_END):], "refreshed"


def _atomic_write(path, text):
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(str(tmp), str(path))


def cmd_generate(root, codex_model):
    ok, reason = dual_markers_ok(root)
    if not ok:
        print("handoff: %s" % reason, file=sys.stderr)
        return 2
    block = render_block(codex_model)
    target = root / "AGENTS.md"
    if not target.exists():
        _atomic_write(target, block + "\n")
        print("wrote AGENTS.md (planboard block, model %s)" % codex_model)
        return 0
    try:
        existing = target.read_text(encoding="utf-8")
    except OSError as e:
        print("handoff: cannot read AGENTS.md (%s)" % e, file=sys.stderr)
        return 2
    try:
        new_text, action = splice(existing, block)
    except ValueError as e:
        print("handoff: %s — fix or remove them, then rerun" % e, file=sys.stderr)
        return 2
    _atomic_write(target, new_text)
    print("%s AGENTS.md planboard block (model %s)" % (action, codex_model))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="planboard codex handoff")
    ap.add_argument("--root", default=None, help="project root (default: walk up to plans/master-plan.md)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate", help="write/refresh the planboard block in AGENTS.md")
    g.add_argument("--codex-model", required=True, help="the codex model id to record as provenance")
    args = ap.parse_args(argv)
    root = Path(args.root).resolve() if args.root else find_root()
    if args.cmd == "generate":
        return cmd_generate(root, args.codex_model)
    return 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m unittest tests.test_handoff -v`
Expected: all TestDualMarkers / TestGenerate tests PASS.

- [ ] **Step 6: Full suite, then commit**

Run: `python3 -m unittest discover -s tests -v` — all green.

```bash
git add skills/managing-planboard/scripts/handoff.py skills/managing-planboard/templates/agents-md-section.md tests/test_handoff.py
git commit -m "feat(handoff): AGENTS.md generator — dual-marker gate, marked-block splice, path-resolved codex loop"
```

---

### Task 4: `/planboard:handoff` command

**Files:**
- Create: `commands/handoff.md`

**Interfaces:** Consumes `handoff.py generate` (Task 3). Produces the command Task 5 documents.

- [ ] **Step 1: Write the command file**

Create `commands/handoff.md` with exactly:

```markdown
---
description: Write or refresh the codex handoff — a planboard AGENTS.md block so a cooperative codex can run the plan/execute/results loop
allowed-tools: Read, AskUserQuestion, Bash(python3:*), Bash(git:*), Bash(ls:*)
---

Generate the codex handoff for this project: a marked planboard block in `AGENTS.md` pointing a cooperative codex at the plugin's shipped references and stdlib scripts by absolute path. Script: `${CLAUDE_PLUGIN_ROOT}/skills/managing-planboard/scripts/handoff.py` (python3, stdlib only). Requires an initialized project with BOTH opt-in markers — a marked `plans/master-plan.md` and the planboard block in `CLAUDE.md`; without both, even the Claude sign gate is inactive, so the script refuses. If either is absent, say so and point to `/planboard:init`, then stop.

1. **Ask for the codex model id.** Use AskUserQuestion (one question): which codex model will author/execute — e.g. `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, or a custom id. This is recorded as self-attested provenance in the plan's `pb-model` marker; do not infer it yourself.

2. **Generate.** Run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/managing-planboard/scripts/handoff.py generate --codex-model <id>` and relay its output faithfully: `wrote/appended/refreshed AGENTS.md …` on success, or the exit-2 refusal reason (missing markers, unreadable or malformed-marker AGENTS.md) verbatim. A marker-less `AGENTS.md` is appended to; an existing planboard block is refreshed in place; nothing outside the markers is touched.

3. **Machine-local note.** The block bakes absolute plugin-cache paths, so it is machine- and version-specific. Run `git check-ignore -q AGENTS.md`; if it is NOT ignored, tell the researcher the file is machine-local and suggest gitignoring it (a collaborator regenerates with `/planboard:handoff` on their own machine), and that re-running this command refreshes the paths after a plugin upgrade. Codex is instructed to fail closed and ask for a rerun if any baked path is missing.
```

- [ ] **Step 2: Sanity-check referenced paths**

Run: `ls skills/managing-planboard/scripts/handoff.py skills/managing-planboard/templates/agents-md-section.md`
Expected: both exist (Task 3).

- [ ] **Step 3: Commit**

```bash
git add commands/handoff.md
git commit -m "feat(handoff): /planboard:handoff command — ask model id, generate AGENTS.md block"
```

---

### Task 5: Docs + release mechanics

**Files:**
- Modify: `docs/reference.md` (command table), `README.md` (if it lists commands)
- Modify: `CHANGELOG.md`
- Modify: `.claude-plugin/plugin.json`, `board/package.json`, `board/package-lock.json`

**Interfaces:** none downstream.

- [ ] **Step 1: Document the command**

Run: `grep -n "planboard:models\|planboard:sync\|| \`/planboard" docs/reference.md README.md`
Add a `/planboard:handoff` row to the command table in `docs/reference.md` (and `README.md` if it carries one), matching the existing row format, described as: "Write/refresh the codex handoff (`AGENTS.md` block) so a cooperative codex can run the plan/execute/results loop." Keep prose unwrapped.

- [ ] **Step 2: CHANGELOG entry**

Add a `## [1.1.0] - 2026-07-23` section to `CHANGELOG.md` (above the previous top entry) with two bullets: the deterministic model nudge (dropped the self-identity gate) and the new `/planboard:handoff` codex handoff (cooperative model — sign stays a Claude session).

- [ ] **Step 3: Version bump (2-file) + lockfile**

Edit `.claude-plugin/plugin.json` and `board/package.json`: `"version": "1.0.0"` → `"version": "1.1.0"`. Then sync the board lockfile:

```bash
cd board && npm install --package-lock-only && cd ..
git diff --stat board/package-lock.json
```

Expected: `board/package-lock.json` version fields advance to `1.1.0`, no dependency changes.

- [ ] **Step 4: Full suite green, then commit**

Run: `python3 -m unittest discover -s tests -v` — all green.

```bash
git add docs/reference.md README.md CHANGELOG.md .claude-plugin/plugin.json board/package.json board/package-lock.json
git commit -m "docs(handoff): document /planboard:handoff; release 1.1.0"
```

- [ ] **Step 5: Stop for BK**

Do not push, tag, or merge. Report the branch and the five commits; BK chooses the version number at cut (1.1.0 proposed; patch is his call) and runs the release/push per the planboard release policy.

---

## Self-Review

- **Spec coverage:** nudge de-gate (Task 2, all four files) ✓; thin-pointer AGENTS.md generator with dual-marker gate + marked-block ownership + foreign-file append + malformed-marker refusal + path stamp (Task 3) ✓; command with researcher-supplied model id + gitignore advisory (Task 4) ✓; provenance = no board code ✓ (nothing in the plan touches the board); release mechanics (Task 5) ✓; external-facts verification (Task 1) ✓. Deferred by design: tamper detection, init-mode offer, structural sandboxing — none appear as tasks (correct).
- **Placeholder scan:** template `{{SKILL_DIR}}`/`{{CODEX_MODEL}}` are intentional substitution tokens (asserted absent from output in the test); no plan-level TBDs.
- **Type consistency:** `BLOCK_START`/`BLOCK_END`/`SKILL_DIR`/`splice`/`dual_markers_ok`/`cmd_generate`/`render_block` names match between `handoff.py` (Step 4), the tests (Step 2), and the Interfaces block. `signoff_gate.MASTER_MARKERS`/`CLAUDE_MARKERS` match the verified constants.
