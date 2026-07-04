"""Tests for board.py remote-share features. Run:
    python3 -m unittest tests.test_board -v
"""
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = (
    Path(__file__).resolve().parents[1]
    / "skills" / "managing-research-plans" / "scripts"
)
BOARD = SCRIPTS / "board.py"
sys.path.insert(0, str(SCRIPTS))
import board  # noqa: E402


def make_project(root: Path):
    """Minimal initialized research-plans project with two components."""
    plans = root / "plans"
    (plans / "execution" / "01-data-prep").mkdir(parents=True)
    (plans / "execution" / "02-other").mkdir(parents=True)
    (plans / "reviews").mkdir()
    (plans / "master-plan.md").write_text(
        "<!-- research-plans:master-plan -->\n"
        "# Test Project — Master Plan\n\n"
        "## Components\n\n"
        "| # | Component | Status | Execution plan | Outcome / notes | Serves |\n"
        "|---|-----------|--------|----------------|-----------------|--------|\n"
        "| 1 | Data prep | in progress | — | — | — |\n"
        "| 2 | Other | planned | — | — | — |\n",
        encoding="utf-8",
    )
    (plans / "decision-log.md").write_text("# Decision Log\n\nSecret log entry.\n", encoding="utf-8")
    (plans / "execution" / "01-data-prep" / "v1.md").write_text(
        "# Data prep v1\n\nDo the thing.\n", encoding="utf-8")
    (plans / "execution" / "01-data-prep" / ".draft-v2.md").write_text(
        "# Data prep v2 draft\n\nDo it better.\n", encoding="utf-8")
    (plans / "execution" / "02-other" / "v1.md").write_text(
        "# Other v1\n\nSecret other plan.\n", encoding="utf-8")
    (plans / "reviews" / "review-01.md").write_text(
        "# Review\n\nSecret review.\n", encoding="utf-8")
    return plans


def run_board(cwd, *argv):
    return subprocess.run(
        [sys.executable, str(BOARD), *argv],
        capture_output=True, text=True, cwd=str(cwd), timeout=60,
    )


def extract_payload(html: str) -> dict:
    m = re.search(
        r'<script id="board-data" type="application/json">(.*?)</script>',
        html, re.DOTALL,
    )
    assert m, "no board-data slot in exported html"
    return json.loads(m.group(1))


class TestShareHash(unittest.TestCase):
    def test_deterministic_and_order_independent(self):
        a = [{"path": "b.md", "content": "B"}, {"path": "a.md", "content": "A"}]
        b = [{"path": "a.md", "content": "A"}, {"path": "b.md", "content": "B"}]
        self.assertEqual(board.share_hash(a), board.share_hash(b))
        self.assertEqual(len(board.share_hash(a)), 16)

    def test_content_change_changes_hash(self):
        a = [{"path": "a.md", "content": "A"}]
        b = [{"path": "a.md", "content": "changed"}]
        self.assertNotEqual(board.share_hash(a), board.share_hash(b))

    def test_payload_files_covers_all_embedded_files(self):
        payload = {"files": {
            "masterPlan": {"path": "plans/master-plan.md", "content": "m"},
            "decisionLog": {"path": "plans/decision-log.md", "content": "d"},
            "executionPlans": [{
                "component": "01-x",
                "versions": [{"path": "plans/execution/01-x/v1.md", "content": "v1"}],
                "draft": {"path": "plans/execution/01-x/.draft-v2.md", "content": "d2"},
            }],
            "reviews": [{"path": "plans/reviews/r.md", "content": "r"}],
        }}
        paths = [f["path"] for f in board.payload_files(payload)]
        self.assertEqual(sorted(paths), sorted([
            "plans/master-plan.md", "plans/decision-log.md",
            "plans/execution/01-x/v1.md", "plans/execution/01-x/.draft-v2.md",
            "plans/reviews/r.md",
        ]))


if __name__ == "__main__":
    unittest.main()
