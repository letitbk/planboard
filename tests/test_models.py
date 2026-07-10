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


if __name__ == "__main__":
    unittest.main()
