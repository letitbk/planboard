# Lighter planboard — seam 1 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop planboard from governing every session in an initialized repository, so ordinary work outside a signed component is done rather than scoped, while governed work keeps exactly the discipline it has today.

**Architecture:** This seam is entirely prompt-layer. It changes what `SKILL.md`, the CLAUDE.md template, and the command documents instruct, and it removes the by-number coupling between the plugin and the researcher's CLAUDE.md block. No Python module changes, no board changes, no schema changes. The test surface is `tests/test_command_docs.py`, the repository's existing contract-test file for instructions that have no runtime module.

**Tech Stack:** Markdown instruction files; Python 3 standard library `unittest` for the contract tests.

**Spec:** `docs/specs/2026-08-30-lighter-planboard-design.md` (revised 2026-08-30 after a Codex sol/xhigh review).

## Scope

Seam 1 is spec **section 1's activation model** and **section 5's rule trim**, plus the dereferencing and migration work section 5 requires. Five tasks.

Deliberately **not** in this seam:

- **Section 1's governed-path index.** Condition 2 ships in *instruction* form only: the agent honors "work touching a signed component is governed", but nothing mechanically resolves a path to a component yet. Seam 2 builds the index.
- **Section 2, the amendment ledger.** Until it exists, a tweak inside a signed component takes the path it takes today: `/planboard:sync` records an amendment version. Governed work therefore costs exactly what it costs now.
- **Section 3, terminal sign-off**, and **section 4, the standing instruction.** Seam 3.

## Why the seam is cut here, and the one hazard it creates

Section 1 has two conditions and they have very different costs. Condition 1 — activation by command — is a pure instruction change with no new machinery. Condition 2 — governed paths — needs an index that does not exist: plans name files in free prose that nothing parses (`templates/execution-plan.md:60,73`), `board/src/lib/parse.ts:306` extracts section bodies rather than paths, and `results.py` never infers ownership (`:157`, and `producedBy` may be null per `commands/results.md:15`). Shipping condition 1 alone delivers most of the daily relief for a fraction of the work.

**The hazard:** between this seam and seam 2, condition 2 is honored by instruction and enforced by nothing. That is looser than today, where the ambient rules covered it. The mitigation is that governed work is not made *cheaper* in this seam — rule 2 of the new block still sends an in-plan change to a new version through `/sync` — so the only behavior that actually loosens is the enforcement of a rule the agent is still told to follow. Do not let a later task in this seam introduce the ledger as a shortcut; that is seam 2's job and it needs the manifest work that comes with it.

## Global Constraints

- **Python: standard library only.** Every script in `skills/managing-planboard/scripts/` is stdlib-only. This seam adds no script changes at all, and no dependencies.
- **No `board/src/` changes in this seam.** Nothing here touches the board, so `npm run build` must NOT be run and `skills/managing-planboard/assets/board-template.html` must NOT be regenerated. Rebuilding rewrites a tracked 460KB artifact and would pollute the commit.
- **Validation before any task is done** (`AGENTS.md`): `python3 -m pytest tests/ -q`. The board suites (`cd board && npm test && npx tsc --noEmit`) are unaffected but should stay green; run them once in Task 5.
- **Explicit `git add <paths>` on every commit.** Never `git add .`, `git add -A`, or `git commit -a`. The worktree may be dirty with unrelated work.
- **Legacy identifiers stay.** `research-plans`, `rp-*`, and `RESEARCH_PLANS_*` are intentional compatibility code (`AGENTS.md`). Do not remove them.
- **Rule names, not rule numbers.** After Task 3, no markdown file in `commands/` or `skills/` may refer to a CLAUDE.md rule by number. The one legitimate `rule N` that survives is `references/split-criteria.md:11`, which refers to split-criteria's *own* rule 1 and must not be touched.
- **The canonical rule names** introduced in Task 2 and used verbatim by every later reference: **Read the governing plan first**, **Plan versions are immutable**, **Log decisions in real time**, **Interpretive choices are the researcher's**, **Output conventions**, **Evidence before claims**, **Assumptions and restraint**.

---

### Task 1: The activation contract in `SKILL.md`

Replace the skill's all-or-nothing marker gate with the activation model, so the skill itself stops telling the agent that the workflow governs every session.

**Files:**
- Modify: `skills/managing-planboard/SKILL.md` — the YAML frontmatter `description:`, the `## When NOT to use (hard gate)` section, and the `**Session start.**` line in `## Core pattern`
- Test: `tests/test_command_docs.py` (new `TestActivationContract`)

**The frontmatter is the load-bearing part.** The skill's `description:` is what makes the harness load it, and it currently lists `when a session starts there` and `when executing analysis or data work` as triggers. Rewriting the body while leaving those in place would change what the skill *says* without changing *when it fires*, which is most of the problem. Step 3 handles it first for that reason.

**Interfaces:**
- Consumes: nothing.
- Produces: the activating-command list and the phrases `An activating command is running`, `do not activate`, `Artifact integrity is not activation`, and `governs nothing`. Task 2 mirrors this contract into the CLAUDE.md template; Task 4 relies on the same list.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_command_docs.py`:

```python
class TestActivationContract(unittest.TestCase):
    SKILL = REPO / "skills" / "managing-planboard" / "SKILL.md"

    def setUp(self):
        self.text = self.SKILL.read_text(encoding="utf-8")

    def test_both_markers_still_gate_applicability(self):
        self.assertIn("<!-- planboard:master-plan -->", self.text)
        self.assertIn("<!-- planboard:start -->", self.text)
        self.assertIn("legacy", self.text)

    def test_activating_commands_are_named(self):
        for cmd in ("/planboard:plan", "/planboard:execute", "/planboard:sign",
                    "/planboard:sync", "/planboard:results",
                    "/planboard:review", "/planboard:adopt",
                    "/planboard:renew"):
            self.assertIn(cmd, self.text, cmd)
        self.assertIn("An activating command is running", self.text)

    def test_read_only_commands_do_not_activate(self):
        self.assertIn("do not activate", self.text)
        for cmd in ("/planboard:board", "/planboard:report",
                    "/planboard:models"):
            self.assertIn(cmd, self.text, cmd)

    def test_activation_is_scoped_not_sticky(self):
        self.assertIn("does not persist for the rest of the session",
                      self.text)

    def test_an_unsigned_draft_governs_nothing(self):
        self.assertIn("governs nothing", self.text)

    def test_artifact_integrity_is_separate_from_activation(self):
        self.assertIn("Artifact integrity is not activation", self.text)
        self.assertIn("invoked or not", self.text)

    def test_the_ambient_session_start_rule_is_gone(self):
        self.assertNotIn("**Session start.** Read `plans/master-plan.md`",
                         self.text)

    def test_frontmatter_no_longer_triggers_on_session_start(self):
        frontmatter = self.text.split("---")[1]
        self.assertNotIn("when a session starts there", frontmatter)
        self.assertNotIn("when executing analysis or data work", frontmatter)
        self.assertIn("when a planboard command runs", frontmatter)
        self.assertIn("signed execution plan", frontmatter)
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `python3 -m unittest tests.test_command_docs.TestActivationContract -v`
Expected: FAIL. `test_activating_commands_are_named` fails on `An activating command is running`; `test_read_only_commands_do_not_activate`, `test_activation_is_scoped_not_sticky`, `test_an_unsigned_draft_governs_nothing` and `test_artifact_integrity_is_separate_from_activation` fail on their missing phrases; `test_the_ambient_session_start_rule_is_gone` fails because that line is still present; `test_frontmatter_no_longer_triggers_on_session_start` fails on `when a session starts there`.

- [ ] **Step 3: Rewrite the frontmatter description**

In `skills/managing-planboard/SKILL.md`, replace the `description:` value with:

```yaml
description: Use when working in a research repository initialized for the planboard workflow (plans/master-plan.md exists AND the repo's CLAUDE.md contains the planboard marker) — specifically when a planboard command runs (/planboard:plan, :execute, :sign, :sync, :results, :review, :adopt, :renew), when work touches a component that already has a signed execution plan, when the researcher asks to adopt the workflow mid-session after exploratory work has begun, or when the researcher mentions the master plan, an execution plan, or the decision log. Not on session start alone, not for ordinary work outside a signed component, not for software project planning, and not for repositories without both markers.
```

Two triggers are deliberately removed: `when a session starts there` and `when executing analysis or data work`. Those are what make the workflow ambient. Leaving them would change what the skill says without changing when it fires.

- [ ] **Step 4: Replace the hard-gate section**

In `skills/managing-planboard/SKILL.md`, replace the whole `## When NOT to use (hard gate)` section — heading and body — with:

```markdown
## When this applies

Two markers decide whether planboard **may** apply to a repository:

1. `plans/master-plan.md` containing `<!-- planboard:master-plan -->` (or the legacy `<!-- research-plans:master-plan -->`)
2. The repo's `CLAUDE.md` containing `<!-- planboard:start -->` (or the legacy `<!-- research-plans:start -->`)

If either is absent this workflow does not apply at all. Stay silent about it, never create `plans/` uninvited, and never suggest initializing unless the researcher asks. A stray copied `master-plan.md` without the CLAUDE.md marker does not count as opt-in. For software implementation plans, use superpowers writing-plans instead.

When both markers are present, the **planning and bookkeeping discipline** applies in exactly two situations:

- **An activating command is running.** `/planboard:plan`, `/planboard:execute`, `/planboard:sign`, `/planboard:sync`, `/planboard:results`, `/planboard:review`, `/planboard:adopt` and `/planboard:renew` activate it. `/planboard:board`, `/planboard:report` and `/planboard:models` **do not activate** it — reading a board, generating a report and editing a model profile are not governed work. Activation lasts while that command runs and reaches only the components it names; it does not persist for the rest of the session.
- **Work touches a component that already has a signed execution plan.** A component whose only plan is an unsigned `.draft-v<N>.md` **governs nothing** — a draft is what the researcher is still authoring, not a commitment that can be exceeded.

Outside both, work normally: do not open the master plan, do not ask the researcher to scope the request first, and do not tell them the work exceeds a plan.

**Artifact integrity is not activation.** Finalized results bundles, archived master plans and existing canonical plan versions stay immutable whenever the two markers exist, **invoked or not**. The hook enforces that as file policy and knows nothing about which command ran. Working normally never makes those writable.
```

- [ ] **Step 5: Narrow the session-start line**

In the `## Core pattern` section, replace the `**Session start.**` paragraph:

```markdown
**Session start.** Read `plans/master-plan.md`, then the latest version of the execution plan for whichever component the work touches (`plans/execution/<NN-slug>/`, highest `vN.md`).
```

with:

```markdown
**Before governed work.** When an activating command runs, or when the work touches a component that already has a signed plan, read `plans/master-plan.md` and then that component's latest `vN.md` in `plans/execution/<NN-slug>/` before changing anything. This is no longer a session-start ritual: a session that never touches governed work never reads them.
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `python3 -m unittest tests.test_command_docs.TestActivationContract -v`
Expected: PASS, 8 tests.

- [ ] **Step 7: Run the full Python suite**

Run: `python3 -m pytest tests/ -q`
Expected: PASS. `tests/test_rename_compat.py` asserts on the marker constants, not on the skill's description, so it is unaffected.

- [ ] **Step 8: Commit**

```bash
git add skills/managing-planboard/SKILL.md tests/test_command_docs.py
git commit -m "skill: the workflow activates on command or signed component, not every session"
```

---

### Task 2: The CLAUDE.md template — ten rules to seven

Rewrite the block `/planboard:init` installs, give every rule a stable name, and delete the three rules that duplicate machinery or live elsewhere.

**Files:**
- Modify: `skills/managing-planboard/templates/claude-md-section.md` (whole file)
- Test: `tests/test_command_docs.py` (new `TestClaudeMdBlock`)

**Interfaces:**
- Consumes: the activation contract's vocabulary from Task 1.
- Produces: the seven canonical rule names listed in Global Constraints. Task 3 references them verbatim; Task 5's migration notes depend on the block's shape.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_command_docs.py`:

```python
class TestClaudeMdBlock(unittest.TestCase):
    BLOCK = (REPO / "skills" / "managing-planboard" / "templates" /
             "claude-md-section.md")

    RULE_NAMES = (
        "Read the governing plan first",
        "Plan versions are immutable",
        "Log decisions in real time",
        "Interpretive choices are the researcher's",
        "Output conventions",
        "Evidence before claims",
        "Assumptions and restraint",
    )

    def setUp(self):
        self.text = self.BLOCK.read_text(encoding="utf-8")

    def test_markers_are_intact(self):
        self.assertTrue(self.text.startswith("<!-- planboard:start -->"))
        self.assertIn("<!-- planboard:end -->", self.text)

    def test_seven_named_rules_in_order(self):
        positions = []
        for name in self.RULE_NAMES:
            self.assertIn(name, self.text, name)
            positions.append(self.text.index(name))
        self.assertEqual(positions, sorted(positions))

    def test_exactly_seven_numbered_rules(self):
        import re
        numbered = re.findall(r"^(\d+)\. \*\*", self.text, re.MULTILINE)
        self.assertEqual(["1", "2", "3", "4", "5", "6", "7"], numbered)

    def test_the_ambient_preamble_is_gone(self):
        self.assertNotIn("These rules apply to every session in this "
                         "repository", self.text)

    def test_already_decided_clause_is_present(self):
        self.assertIn("already stated a decision", self.text)
        self.assertIn("rather than asking again", self.text)

    def test_pause_when_exceeding_the_plan_is_deleted(self):
        self.assertNotIn("about to exceed what the current execution plan "
                         "covers", self.text)

    def test_tracker_update_rule_is_deleted(self):
        self.assertNotIn("After execution work, update the Components table",
                         self.text)

    def test_plan_authoring_standard_is_deleted(self):
        self.assertNotIn("read cold by a coauthor", self.text)

    def test_target_journal_placeholder_survives(self):
        self.assertIn("<target journal>", self.text)
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `python3 -m unittest tests.test_command_docs.TestClaudeMdBlock -v`
Expected: FAIL on `test_seven_named_rules_in_order`, `test_exactly_seven_numbered_rules`, `test_the_ambient_preamble_is_gone`, `test_already_decided_clause_is_present`, `test_pause_when_exceeding_the_plan_is_deleted`, `test_tracker_update_rule_is_deleted` and `test_plan_authoring_standard_is_deleted`.

- [ ] **Step 3: Rewrite the template**

Replace the entire contents of `skills/managing-planboard/templates/claude-md-section.md` with:

```markdown
<!-- planboard:start -->
## Research plans workflow

This project uses the planboard workflow (https://github.com/letitbk/planboard). The rules below apply when a planboard command is running, or when work touches a component that already has a signed execution plan. Outside those, work normally. Finalized plan versions, results bundles and archived master plans stay immutable at all times regardless.

1. **Read the governing plan first.** Before changing anything in a component that has a signed execution plan, read `plans/master-plan.md` and that component's latest version (`plans/execution/<NN-slug>/`, highest `vN.md`).
2. **Plan versions are immutable.** Execution plans are versioned `v1.md, v2.md, ...` and are never overwritten or edited. A revision is a new file with a `Supersedes` line explaining what changed and why; `/planboard:sync` records one.
3. **Log decisions in real time.** Append entries to `plans/decision-log.md` **as decisions happen**: when you ask a clarifying question, when the researcher sets or changes scope, when you make a non-trivial interpretive call (flag it), or when a surprising result changes what happens next. Do not backfill at the end of a session.
4. **Interpretive choices are the researcher's.** Surface interpretive choices (variable selection, case exclusions, coding rules, model specification) to the researcher **before** acting on them. Do not decide research questions, analytical choices, or interpretation on their behalf. **When the researcher has already stated a decision, record it and act on it rather than asking again** — re-opening a settled choice is not diligence.
5. **Output conventions** — target journal: <target journal>. Analysis deliverables are journal-ready, not raw output:
   - Figures: vector PDF plus a PNG preview, sized to a journal column, grayscale-safe. Use the /journal-figures skill if available; otherwise export to the same spec with standard tooling.
   - Tables: a typeset table (.png preview plus .tex source, booktabs style). Use the /journal-tables skill if available; otherwise modelsummary/kableExtra/gt to the same formats. A CSV of estimates is an intermediate, never the deliverable.
   - Every figure and table carries a title and a one-line caption suitable for the manuscript.
6. **Evidence before claims.** Run substantive analysis with output captured to `logs/` (e.g. `2>&1 | tee logs/<date>_<step>.log`; `logs/` stays gitignored). Never report a result — in chat, a results bundle, or a report — without the log, notebook output, or artifact that shows the code actually ran. Logs are local, temporary evidence: never write row-level personal data, credentials, or secrets into them.
7. **Assumptions and restraint.** State working assumptions before acting on them; when an instruction has multiple readings, present them rather than picking silently. Keep changes minimal and surgical — nothing beyond what the current plan step needs.

The `managing-planboard` skill (from the planboard plugin) has these conventions in depth, including which commands activate this workflow. The primary loop is plan → draft review → execute gate → tail. If work happened outside that loop or mid-session logging was missed, `/planboard:sync` is the recovery checkpoint.
<!-- planboard:end -->
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `python3 -m unittest tests.test_command_docs.TestClaudeMdBlock -v`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the full Python suite**

Run: `python3 -m pytest tests/ -q`
Expected: PASS. `tests/test_handoff.py` and `tests/test_rename_compat.py` assert only on the markers, which are unchanged.

- [ ] **Step 6: Commit**

```bash
git add skills/managing-planboard/templates/claude-md-section.md tests/test_command_docs.py
git commit -m "template: ten standing rules to seven, each with a stable name"
```

---

### Task 3: Dereference the numbered rules across the plugin

Twelve places in eight files point at CLAUDE.md rules **by number**. Deleting three rules silently repoints every one of them, so the references must become names in the same change.

**Files:**
- Modify: `commands/init.md:14,21,37`
- Modify: `commands/renew.md:13,21`
- Modify: `commands/plan.md:19`
- Modify: `commands/results.md:15`
- Modify: `skills/managing-planboard/SKILL.md:53`
- Modify: `skills/managing-planboard/templates/execution-plan.md:67`
- Modify: `skills/managing-planboard/references/planning-doctrine.md:15`
- Modify: `skills/managing-planboard/references/execution-loop.md:17` (two references on one line)
- Test: `tests/test_command_docs.py` (new `TestRuleReferencesAreNamed`)

**Interfaces:**
- Consumes: the seven rule names from Task 2.
- Produces: a guard test that fails if any future edit reintroduces a numbered CLAUDE.md rule reference.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_command_docs.py`:

```python
class TestRuleReferencesAreNamed(unittest.TestCase):
    # split-criteria.md's "rule 1" is split-criteria's OWN rule, not a
    # CLAUDE.md rule. It is the only legitimate numbered rule reference.
    ALLOWED = {"skills/managing-planboard/references/split-criteria.md"}

    def test_no_markdown_refers_to_a_claude_md_rule_by_number(self):
        import re
        pattern = re.compile(r"rule \d+", re.IGNORECASE)
        offenders = []
        for root in (REPO / "commands", REPO / "skills"):
            for path in sorted(root.rglob("*.md")):
                rel = path.relative_to(REPO).as_posix()
                if rel in self.ALLOWED:
                    continue
                text = path.read_text(encoding="utf-8")
                for match in pattern.finditer(text):
                    start = max(0, match.start() - 50)
                    offenders.append("%s: ...%s..." %
                                     (rel, text[start:match.end() + 50]))
        self.assertEqual([], offenders)

    def test_the_named_references_landed(self):
        checks = {
            "commands/init.md": ["**Evidence before claims**",
                                 "**Output conventions**"],
            "commands/renew.md": ["**Output conventions**"],
            "commands/plan.md": ["**Output conventions**"],
            "commands/results.md": ["**Output conventions**"],
            "skills/managing-planboard/SKILL.md": ["**Output conventions**"],
            "skills/managing-planboard/templates/execution-plan.md":
                ["**Output conventions**"],
            "skills/managing-planboard/references/planning-doctrine.md":
                ["**Evidence before claims**"],
            "skills/managing-planboard/references/execution-loop.md":
                ["**Interpretive choices are the researcher's**",
                 "**Evidence before claims**"],
        }
        for rel, needles in checks.items():
            text = (REPO / rel).read_text(encoding="utf-8")
            for needle in needles:
                self.assertIn(needle, text, "%s: %s" % (rel, needle))

    def test_split_criteria_own_rule_is_untouched(self):
        text = (REPO / "skills" / "managing-planboard" / "references" /
                "split-criteria.md").read_text(encoding="utf-8")
        self.assertIn("a new component by rule 1", text)
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `python3 -m unittest tests.test_command_docs.TestRuleReferencesAreNamed -v`
Expected: FAIL. `test_no_markdown_refers_to_a_claude_md_rule_by_number` reports 12 offenders across 8 files; `test_the_named_references_landed` fails on the first missing name. `test_split_criteria_own_rule_is_untouched` passes already.

- [ ] **Step 3: Replace each reference, one file at a time**

Make exactly these substitutions. Change nothing else on the lines.

`commands/init.md:14` — `(rule 9's evidence discipline reaches existing projects only with it)` becomes `(the **Evidence before claims** rule reaches existing projects only with it)`

`commands/init.md:21` — `it fills rule 7 of the CLAUDE.md block (output conventions)` becomes `it fills the CLAUDE.md block's **Output conventions** rule`

`commands/init.md:37` — `The block's rule 7 carries a` becomes `The block's **Output conventions** rule carries a`

`commands/renew.md:13` — `it fills rule 7 of the CLAUDE.md block` becomes `it fills the CLAUDE.md block's **Output conventions** rule`

`commands/renew.md:21` — `including rule 7 with the journal answer from step 3` becomes `including the **Output conventions** rule with the journal answer from step 3`

`commands/plan.md:19` — `per CLAUDE.md rule 7's output conventions` becomes `per the CLAUDE.md **Output conventions** rule`

`commands/results.md:15` — `(CLAUDE.md rule 7)` becomes `(the CLAUDE.md **Output conventions** rule)`

`skills/managing-planboard/SKILL.md:53` — `CLAUDE.md rule 7 names the target journal` becomes `The CLAUDE.md **Output conventions** rule names the target journal`

`skills/managing-planboard/templates/execution-plan.md:67` — `(CLAUDE.md rule 7)` becomes `(the CLAUDE.md **Output conventions** rule)`

`skills/managing-planboard/references/planning-doctrine.md:15` — one reference, shown in full because it contains inline code:

```
before:  CLAUDE.md rule 9's `logs/` capture is where run evidence lands
after:   the CLAUDE.md **Evidence before claims** rule's `logs/` capture is where run evidence lands
```

`skills/managing-planboard/references/execution-loop.md:17` — two references on one line:

```
before:  ... before acting (CLAUDE.md rule 4), and decisions append to the log
after:   ... before acting (the CLAUDE.md **Interpretive choices are the researcher's** rule), and decisions append to the log

before:  (`2>&1 | tee logs/<date>_<step>.log`, gitignored) — rule 9's run evidence
after:   (`2>&1 | tee logs/<date>_<step>.log`, gitignored) — the **Evidence before claims** rule's run evidence
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `python3 -m unittest tests.test_command_docs.TestRuleReferencesAreNamed -v`
Expected: PASS, 3 tests. If `test_no_markdown_refers_to_a_claude_md_rule_by_number` still lists an offender, that file was missed — the failure message names it and quotes 100 characters of context.

- [ ] **Step 5: Run the full Python suite**

Run: `python3 -m pytest tests/ -q`
Expected: PASS. `tests/test_command_docs.py::TestAuditWiring` asserts on other strings in these same command files; none of the substituted spans overlap them.

- [ ] **Step 6: Commit**

```bash
git add commands/init.md commands/renew.md commands/plan.md commands/results.md \
        skills/managing-planboard/SKILL.md \
        skills/managing-planboard/templates/execution-plan.md \
        skills/managing-planboard/references/planning-doctrine.md \
        skills/managing-planboard/references/execution-loop.md \
        tests/test_command_docs.py
git commit -m "docs: reference CLAUDE.md rules by name, so the block can be renumbered"
```

---

### Task 4: Narrow `/planboard:plan`'s push-back to the planning dialogue

`commands/plan.md` step 4 tells the agent to push back on a bare pick. Inside plan authoring the researcher has opted into being questioned. Applied to an ordinary work request it produces the interruption this design exists to remove.

**Files:**
- Modify: `commands/plan.md:22` (the `push back on a bare pick` bullet)
- Test: `tests/test_command_docs.py` (new `TestPushBackIsScoped`)

**Interfaces:**
- Consumes: the activation vocabulary from Task 1.
- Produces: nothing later tasks read.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_command_docs.py`:

```python
class TestPushBackIsScoped(unittest.TestCase):
    def test_push_back_is_bounded_to_plan_authoring(self):
        text = (REPO / "commands" / "plan.md").read_text(encoding="utf-8")
        self.assertIn("push back on a bare pick on a consequential fork", text)
        self.assertIn("only while authoring a plan", text)
        self.assertIn("never to an ordinary work request", text)
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `python3 -m unittest tests.test_command_docs.TestPushBackIsScoped -v`
Expected: FAIL on `only while authoring a plan`.

- [ ] **Step 3: Scope the bullet**

In `commands/plan.md` step 4, replace:

```markdown
   - **push back on a bare pick on a consequential fork**: if the researcher waves a high-stakes choice through, say what the default assumes and ask if that assumption holds here. Draw the researcher's knowledge out; do not substitute your own.
```

with:

```markdown
   - **push back on a bare pick on a consequential fork**: if the researcher waves a high-stakes choice through, say what the default assumes and ask if that assumption holds here. Draw the researcher's knowledge out; do not substitute your own. This applies **only while authoring a plan**, where the researcher has opted into being questioned, and **never to an ordinary work request** — a stated decision outside this dialogue is recorded and acted on, not reopened.
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `python3 -m unittest tests.test_command_docs.TestPushBackIsScoped -v`
Expected: PASS, 1 test.

- [ ] **Step 5: Run the full Python suite**

Run: `python3 -m pytest tests/ -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add commands/plan.md tests/test_command_docs.py
git commit -m "plan: bound the bare-pick push-back to plan authoring"
```

---

### Task 5: Migration wording, changelog, and release

Existing repositories keep the old ten-rule block until someone re-runs `/planboard:init` **and accepts** the CLAUDE.md refresh, which is offered rather than automatic. Say so where a researcher will see it, then ship.

**Files:**
- Modify: `commands/init.md:14` (update-mode option (c))
- Modify: `CHANGELOG.md`
- Modify: `.claude-plugin/plugin.json:3`, `board/package.json:4`, `board/package-lock.json`
- Test: `tests/test_command_docs.py` (new `TestBlockRefreshIsAnnounced`)

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: version 1.3.0.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_command_docs.py`:

```python
class TestBlockRefreshIsAnnounced(unittest.TestCase):
    def test_update_mode_says_the_block_changed(self):
        text = (REPO / "commands" / "init.md").read_text(encoding="utf-8")
        self.assertIn("upgrade the CLAUDE.md section (step 6)", text)
        self.assertIn("the standing rules changed", text)
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `python3 -m unittest tests.test_command_docs.TestBlockRefreshIsAnnounced -v`
Expected: FAIL on `the standing rules changed`.

- [ ] **Step 3: Make the offer explicit**

In `commands/init.md:14`, replace `(c) upgrade the CLAUDE.md section (step 6) if the plugin has changed,` with:

```markdown
(c) upgrade the CLAUDE.md section (step 6) if the plugin has changed — say plainly that **the standing rules changed** in v1.3.0 and that declining leaves this project on the old ten-rule block, which no longer matches the plugin's own references,
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `python3 -m unittest tests.test_command_docs.TestBlockRefreshIsAnnounced -v`
Expected: PASS, 1 test.

- [ ] **Step 5: Add the changelog entry**

Insert as the first release entry in `CHANGELOG.md`:

```markdown
## [1.3.0] - 2026-08-30

### Changed
- The workflow no longer governs every session in an initialized repository. It applies while an activating command runs (`/plan`, `/execute`, `/sign`, `/sync`, `/results`, `/review`, `/adopt`, `/renew`) or when work touches a component with a signed execution plan. `/board`, `/report` and `/models` do not activate it. Activation reaches only the components the command names and does not persist for the rest of the session.
- The standing CLAUDE.md rules go from ten to seven. Removed: the post-execution tracker update (the execution loop and `/sync` already do it), the plan authoring standard (`/planboard:plan` carries it), and "pause when work exceeds the plan". Rule 4 gains: when the researcher has already stated a decision, record it and act on it rather than asking again.
- Rules are now referenced by name rather than by number throughout the plugin, so the block can be renumbered without silently repointing twelve references.
- `/planboard:plan`'s bare-pick push-back is bounded to plan authoring and no longer applies to ordinary work requests.

### Unchanged
- Immutability of finalized plan versions, results bundles and archived master plans is enforced whenever the project markers exist, invoked or not.
- Work inside a component with a signed plan is governed exactly as before: an in-plan change still takes an amendment version through `/planboard:sync`.

### Migration
- Existing projects keep the ten-rule block until `/planboard:init` is re-run **and** its CLAUDE.md refresh is accepted. The refresh is offered, not automatic.
```

- [ ] **Step 6: Bump the version**

Set `"version": "1.3.0"` in both `.claude-plugin/plugin.json` and `board/package.json`, then:

Run: `cd board && npm install --package-lock-only`

- [ ] **Step 7: Run every suite**

```sh
python3 -m pytest tests/ -q
(cd board && npm test && npx tsc --noEmit)
(cd skills/managing-planboard/assets/web-template && npm test)
```

Expected: all PASS. Do **not** run `npm run build`: no file under `board/src/` changed in this seam, and rebuilding would rewrite the tracked `board-template.html`.

- [ ] **Step 8: Confirm the board template is untouched**

Run: `git status --short skills/managing-planboard/assets/board-template.html`
Expected: empty output. If it shows as modified, the build was run by mistake — restore it with `git checkout -- skills/managing-planboard/assets/board-template.html`.

- [ ] **Step 9: Commit**

```bash
git add commands/init.md CHANGELOG.md .claude-plugin/plugin.json \
        board/package.json board/package-lock.json tests/test_command_docs.py
git commit -m "release: v1.3.0 — the workflow is invoked, not ambient"
```

---

## After this plan

Seam 1 leaves the workflow invoked rather than ambient, and governed work costing exactly what it costs today.

**Seam 2 — the governed-path index and the amendment ledger.** These need each other: the ledger is only reachable if something can decide which component owns an edited path, and the index is only worth building if a cheap record exists for what it catches. Spec sections 1 (condition 2) and 2. It carries the two structural blockers from the Codex review: results manifests must seal the ledger state that governed them, and the fold needs entry identity, a checkpoint, and crash recovery.

**Seam 3 — terminal sign-off and the standing instruction.** Spec sections 3 and 4. Section 3 needs the TTY refusal and the browser path's stale-hash checks; section 4 is agent-attested and may be dropped entirely without disturbing seams 1 or 2.

**Recorded in the spec but not planned:** the signed-versus-governing vocabulary conflict, `/init` not migrating the Codex `AGENTS.md` handoff, commands checking only the master-plan marker, and audit currency going stale when a ledger entry moves git HEAD.
