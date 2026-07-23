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

    def test_refuses_when_agents_md_aliases_claude_md(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            claude = root / "CLAUDE.md"
            (root / "AGENTS.md").symlink_to(claude)
            before = claude.read_text()
            code, out, err = run_generate(root)
            self.assertEqual(code, 2)
            self.assertIn("same file as CLAUDE.md", err)
            self.assertEqual(claude.read_text(), before)


if __name__ == "__main__":
    unittest.main()
