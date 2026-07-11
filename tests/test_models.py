"""Tests for models.py. Run:
    python3 -m unittest tests.test_models -v
"""
import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = (
    Path(__file__).resolve().parents[1]
    / "skills" / "managing-research-plans" / "scripts"
)
sys.path.insert(0, str(SCRIPTS))
import models  # noqa: E402

TEMPLATES = SCRIPTS.parent / "templates"
DEFAULT_PROFILE = (TEMPLATES / "model-profile.md").read_text(encoding="utf-8")


def make_project(tmp, profile=DEFAULT_PROFILE):
    root = Path(tmp)
    (root / "plans").mkdir(parents=True, exist_ok=True)
    (root / "plans" / "master-plan.md").write_text("<!-- research-plans:master-plan -->\n")
    if profile is not None:
        (root / "plans" / "model-profile.md").write_text(profile, encoding="utf-8")
    return root


class TestParseProfile(unittest.TestCase):
    def test_default_template_parses_all_six_stages(self):
        stages, warnings = models.parse_profile(DEFAULT_PROFILE)
        self.assertEqual(warnings, [])
        self.assertEqual(
            set(stages),
            {"plan", "execute", "sync", "plan-review", "results-validation", "board-reviewer"},
        )
        self.assertEqual(
            stages["plan"],
            {"stage": "plan", "model": "opus", "effort": "max", "mechanism": "nudge"},
        )
        self.assertEqual(
            stages["execute"],
            {"stage": "execute", "model": "sonnet", "effort": None, "mechanism": "nudge"},
        )
        self.assertEqual(stages["sync"]["model"], "inherit")
        self.assertEqual(stages["plan-review"], {"stage": "plan-review", "model": "opus", "effort": "medium", "mechanism": "agent"})
        self.assertEqual(stages["results-validation"]["effort"], "low")
        self.assertEqual(stages["board-reviewer"]["mechanism"], "agent")

    def test_stage_label_parenthetical_and_case_insensitive(self):
        text = "| stage | model | effort | mechanism |\n|---|---|---|---|\n| Plan (whatever text) | opus | max | nudge |\n"
        stages, warnings = models.parse_profile(text)
        self.assertIn("plan", stages)
        self.assertEqual(warnings, [])

    def test_full_model_id_accepted(self):
        text = "| stage | model | effort | mechanism |\n|---|---|---|---|\n| sync | claude-sonnet-5 | — | nudge |\n"
        stages, warnings = models.parse_profile(text)
        self.assertEqual(stages["sync"]["model"], "claude-sonnet-5")
        self.assertEqual(warnings, [])

    def test_unknown_stage_warned_and_skipped(self):
        text = "| stage | model | effort | mechanism |\n|---|---|---|---|\n| deploy | opus | max | nudge |\n"
        stages, warnings = models.parse_profile(text)
        self.assertEqual(stages, {})
        self.assertEqual(len(warnings), 1)
        self.assertIn("unknown stage", warnings[0])

    def test_unknown_model_warned_and_skipped(self):
        text = "| stage | model | effort | mechanism |\n|---|---|---|---|\n| sync | gpt-5.5 | — | nudge |\n"
        stages, warnings = models.parse_profile(text)
        self.assertEqual(stages, {})
        self.assertIn("unknown model", warnings[0])

    def test_unknown_effort_warned_and_skipped(self):
        text = "| stage | model | effort | mechanism |\n|---|---|---|---|\n| sync | opus | turbo | nudge |\n"
        stages, warnings = models.parse_profile(text)
        self.assertEqual(stages, {})
        self.assertIn("unknown effort", warnings[0])

    def test_unknown_mechanism_warned_and_skipped(self):
        text = "| stage | model | effort | mechanism |\n|---|---|---|---|\n| sync | opus | — | pinned |\n"
        stages, warnings = models.parse_profile(text)
        self.assertEqual(stages, {})
        self.assertIn("unknown mechanism", warnings[0])

    def test_duplicate_stage_first_wins_later_warned(self):
        text = (
            "| stage | model | effort | mechanism |\n|---|---|---|---|\n"
            "| sync | opus | — | nudge |\n| sync | sonnet | — | nudge |\n"
        )
        stages, warnings = models.parse_profile(text)
        self.assertEqual(stages["sync"]["model"], "opus")
        self.assertIn("duplicate stage", warnings[0])

    def test_wrong_cell_count_warned_and_skipped(self):
        text = "| stage | model | effort | mechanism |\n|---|---|---|---|\n| sync | opus | nudge |\n"
        stages, warnings = models.parse_profile(text)
        self.assertEqual(stages, {})
        self.assertIn("4 cells", warnings[0])

    def test_no_table_at_all_warns(self):
        stages, warnings = models.parse_profile("# nothing here\n\njust prose\n")
        self.assertEqual(stages, {})
        self.assertEqual(len(warnings), 1)

    def test_effort_variants_mean_unset(self):
        for dash in ("—", "-", "–", ""):
            text = f"| stage | model | effort | mechanism |\n|---|---|---|---|\n| sync | opus | {dash} | nudge |\n"
            stages, warnings = models.parse_profile(text)
            self.assertIsNone(stages["sync"]["effort"], repr(dash))
            self.assertEqual(warnings, [])

    def test_all_effort_levels_accepted(self):
        for level in ("low", "medium", "high", "xhigh", "max"):
            text = f"| stage | model | effort | mechanism |\n|---|---|---|---|\n| sync | opus | {level} | nudge |\n"
            stages, _ = models.parse_profile(text)
            self.assertEqual(stages["sync"]["effort"], level)


class TestStageCommand(unittest.TestCase):
    def _run(self, root, key):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = models.main(["--root", str(root), "stage", key])
        return code, out.getvalue(), err.getvalue()

    def test_no_profile_is_total_silence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=None)
            code, out, err = self._run(root, "plan")
            self.assertEqual((code, out, err), (0, "", ""))

    def test_valid_row_prints_json(self):
        import json
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            code, out, err = self._run(root, "plan")
            self.assertEqual(code, 0)
            self.assertEqual(err, "")
            self.assertEqual(
                json.loads(out),
                {"stage": "plan", "model": "opus", "effort": "max", "mechanism": "nudge"},
            )

    def test_malformed_target_row_empty_stdout_warning_on_stderr(self):
        bad = "| stage | model | effort | mechanism |\n|---|---|---|---|\n| plan (co-authoring) | gpt-5.5 | max | nudge |\n"
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=bad)
            code, out, err = self._run(root, "plan")
            self.assertEqual(code, 0)
            self.assertEqual(out, "")
            self.assertIn("unknown model", err)

    def test_unreadable_profile_warns_and_exits_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=None)
            (root / "plans" / "model-profile.md").write_bytes(b"\xff\xfe broken")
            code, out, err = self._run(root, "plan")
            self.assertEqual(code, 0)
            self.assertEqual(out, "")
            self.assertIn("unreadable", err)


class TestFindRoot(unittest.TestCase):
    def test_walks_up_to_master_plan(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            sub = root / "analysis" / "deep"
            sub.mkdir(parents=True)
            self.assertEqual(models.find_root(sub), root.resolve())

    def test_no_marker_returns_start(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "loose"
            p.mkdir()
            self.assertEqual(models.find_root(p), p.resolve())


class TestGenerate(unittest.TestCase):
    def _generate(self, root):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = models.main(["--root", str(root), "generate"])
        return code, out.getvalue(), err.getvalue()

    def test_default_profile_writes_three_marked_agents(self):
        import hashlib
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            code, out, err = self._generate(root)
            self.assertEqual(code, 0)
            sha = hashlib.sha256((root / "plans" / "model-profile.md").read_bytes()).hexdigest()
            for name in ("rp-plan-reviewer", "rp-results-validator", "rp-board-reviewer"):
                path = root / ".claude" / "agents" / f"{name}.md"
                self.assertTrue(path.exists(), name)
                text = path.read_text(encoding="utf-8")
                self.assertIn(f"name: {name}", text)
                self.assertIn("model: opus", text)
                m = models.MARKER_RE.search(text)
                self.assertIsNotNone(m, name)
                self.assertEqual(m.group(1), sha)
                self.assertNotIn("{{", text, name)  # no unsubstituted placeholders
                self.assertIn(f"wrote .claude/agents/{name}.md", out)
            self.assertIn("effort: medium", (root / ".claude" / "agents" / "rp-plan-reviewer.md").read_text())
            self.assertIn("effort: low", (root / ".claude" / "agents" / "rp-results-validator.md").read_text())
            self.assertIn("tools: Read, Grep, Glob, Bash", (root / ".claude" / "agents" / "rp-plan-reviewer.md").read_text())
            self.assertIn("tools: Read, Grep, Glob\n", (root / ".claude" / "agents" / "rp-board-reviewer.md").read_text())
            self.assertIn("note: .claude/agents/ was just created", out)

    def test_unset_effort_drops_the_line(self):
        profile = DEFAULT_PROFILE.replace(
            "| results validation | opus | low | agent |",
            "| results validation | opus | — | agent |",
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=profile)
            self._generate(root)
            text = (root / ".claude" / "agents" / "rp-results-validator.md").read_text()
            self.assertNotIn("effort:", text)
            self.assertIn("model: opus", text)

    def test_refuses_unmarked_user_owned_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            agents = root / ".claude" / "agents"
            agents.mkdir(parents=True)
            mine = agents / "rp-plan-reviewer.md"
            mine.write_text("---\nname: rp-plan-reviewer\n---\nmy own agent\n")
            code, out, err = self._generate(root)
            self.assertEqual(code, 0)
            self.assertEqual(mine.read_text(), "---\nname: rp-plan-reviewer\n---\nmy own agent\n")
            self.assertIn("refused (user-owned, no marker)", out)
            self.assertTrue((agents / "rp-results-validator.md").exists())
            self.assertNotIn("note: .claude/agents/ was just created", out)

    def test_marked_file_is_regenerated(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            self._generate(root)
            target = root / ".claude" / "agents" / "rp-plan-reviewer.md"
            first = target.read_text()
            profile_path = root / "plans" / "model-profile.md"
            profile_path.write_text(DEFAULT_PROFILE.replace(
                "| plan review (verdict + grade) | opus | medium | agent |",
                "| plan review (verdict + grade) | sonnet | high | agent |",
            ), encoding="utf-8")
            self._generate(root)
            second = target.read_text()
            self.assertNotEqual(first, second)
            self.assertIn("model: sonnet", second)
            self.assertIn("effort: high", second)

    def test_missing_agent_row_skips_that_agent_only(self):
        profile = DEFAULT_PROFILE.replace("| board reviewer panel | opus | low | agent |\n", "")
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=profile)
            code, out, err = self._generate(root)
            self.assertFalse((root / ".claude" / "agents" / "rp-board-reviewer.md").exists())
            self.assertTrue((root / ".claude" / "agents" / "rp-plan-reviewer.md").exists())
            self.assertIn("board-reviewer", err)

    def test_no_profile_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=None)
            code, out, err = self._generate(root)
            self.assertEqual(code, 1)
            self.assertIn("nothing to generate", err)


class TestCheck(unittest.TestCase):
    def _run(self, root, cmd):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = models.main(["--root", str(root), cmd])
        return code, out.getvalue(), err.getvalue()

    def test_fresh_generation_is_silent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            self._run(root, "generate")
            code, out, err = self._run(root, "check")
            self.assertEqual((code, out), (0, ""))

    def test_edited_profile_prints_hint_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            self._run(root, "generate")
            (root / "plans" / "model-profile.md").write_text(
                DEFAULT_PROFILE + "\nan extra line\n", encoding="utf-8"
            )
            code, out, err = self._run(root, "check")
            self.assertEqual(code, 0)
            self.assertEqual(out.strip(), models.MISMATCH_HINT)
            self.assertEqual(out.count(models.MISMATCH_HINT), 1)

    def test_no_profile_or_no_agents_is_silent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=None)
            self.assertEqual(self._run(root, "check")[1], "")
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)  # profile, no agents
            self.assertEqual(self._run(root, "check")[1], "")

    def test_unmarked_files_are_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            agents = root / ".claude" / "agents"
            agents.mkdir(parents=True)
            (agents / "rp-plan-reviewer.md").write_text("---\nname: rp-plan-reviewer\n---\nmine\n")
            self.assertEqual(self._run(root, "check")[1], "")


class TestOrphanRemovalAndGuards(unittest.TestCase):
    def _run(self, root, cmd):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = models.main(["--root", str(root), cmd])
        return code, out.getvalue(), err.getvalue()

    def test_removed_row_removes_marked_agent_and_clears_hint(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            self._run(root, "generate")
            profile = root / "plans" / "model-profile.md"
            profile.write_text(DEFAULT_PROFILE.replace("| board reviewer panel | opus | low | agent |\n", ""), encoding="utf-8")
            code, out, err = self._run(root, "generate")
            self.assertEqual(code, 0)
            self.assertFalse((root / ".claude" / "agents" / "rp-board-reviewer.md").exists())
            self.assertIn("removed stale .claude/agents/rp-board-reviewer.md", out)
            code, out, err = self._run(root, "check")
            self.assertEqual(out, "")

    def test_mechanism_flip_removes_marked_agent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            self._run(root, "generate")
            profile = root / "plans" / "model-profile.md"
            profile.write_text(DEFAULT_PROFILE.replace("| plan review (verdict + grade) | opus | medium | agent |", "| plan review (verdict + grade) | opus | medium | nudge |"), encoding="utf-8")
            code, out, err = self._run(root, "generate")
            self.assertFalse((root / ".claude" / "agents" / "rp-plan-reviewer.md").exists())
            self.assertIn("removed stale .claude/agents/rp-plan-reviewer.md", out)

    def test_user_owned_file_never_removed_on_missing_row(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=DEFAULT_PROFILE.replace("| board reviewer panel | opus | low | agent |\n", ""))
            agents = root / ".claude" / "agents"
            agents.mkdir(parents=True)
            mine = agents / "rp-board-reviewer.md"
            mine.write_text("---\nname: rp-board-reviewer\n---\nmine\n")
            code, out, err = self._run(root, "generate")
            self.assertTrue(mine.exists())
            self.assertEqual(mine.read_text(), "---\nname: rp-board-reviewer\n---\nmine\n")
            self.assertNotIn("removed stale", out)

    def test_unreadable_profile_bails_without_touching_agents(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            self._run(root, "generate")
            before = sorted(p.name for p in (root / ".claude" / "agents").iterdir())
            (root / "plans" / "model-profile.md").write_bytes(b"\xff\xfe broken")
            code, out, err = self._run(root, "generate")
            self.assertEqual(code, 1)
            self.assertIn("unreadable", err)
            after = sorted(p.name for p in (root / ".claude" / "agents").iterdir())
            self.assertEqual(before, after)

    def test_check_skips_unreadable_agent_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            self._run(root, "generate")
            (root / ".claude" / "agents" / "rp-plan-reviewer.md").write_bytes(b"\xff\xfe broken")
            code, out, err = self._run(root, "check")
            self.assertEqual((code, out), (0, ""))


if __name__ == "__main__":
    unittest.main()
