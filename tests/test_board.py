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


class TestRemotePayload(unittest.TestCase):
    def test_remote_payload_shape(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            payload = board.collect_payload(root, "remote", None)
            self.assertEqual(payload["mode"], "remote")
            self.assertNotIn("root", payload["project"])
            self.assertRegex(payload["shareHash"], r"^[0-9a-f]{16}$")
            groups = {g["component"]: g for g in payload["files"]["executionPlans"]}
            self.assertIn("draft", groups["01-data-prep"])  # drafts included in remote
            self.assertEqual(groups["01-data-prep"]["draft"]["proposedVersion"], 2)

    def test_focused_remote_payload_prunes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            payload = board.collect_payload(root, "remote", "01-data-prep")
            comps = [g["component"] for g in payload["files"]["executionPlans"]]
            self.assertEqual(comps, ["01-data-prep"])
            self.assertEqual(payload["files"]["reviews"], [])
            self.assertIn("omitted", payload["files"]["decisionLog"]["content"])
            self.assertNotIn("Secret log entry", payload["files"]["decisionLog"]["content"])
            # master plan stays fully visible by design
            self.assertIn("Master Plan", payload["files"]["masterPlan"]["content"])

    def test_static_payload_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            payload = board.collect_payload(root, "static", None)
            self.assertNotIn("shareHash", payload)
            groups = {g["component"]: g for g in payload["files"]["executionPlans"]}
            self.assertNotIn("draft", groups["01-data-prep"])


class TestShareCli(unittest.TestCase):
    def test_share_writes_remote_board(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            r = run_board(root, "--share")
            self.assertEqual(r.returncode, 0, r.stderr)
            out = Path(r.stdout.strip()).resolve()
            self.assertEqual(out, (root / "plans" / "board-share.html").resolve())
            payload = extract_payload(out.read_text(encoding="utf-8"))
            self.assertEqual(payload["mode"], "remote")
            self.assertIn("shareHash", payload)
            self.assertNotIn("root", payload["project"])
            self.assertIn("publishes", r.stderr)
            gi = (root / "plans" / ".gitignore").read_text(encoding="utf-8")
            self.assertIn("/board-share.html", gi)

    def test_share_focus_and_custom_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            r = run_board(root, "--share", "out/custom.html", "--focus", "01-data-prep")
            self.assertEqual(r.returncode, 0, r.stderr)
            payload = extract_payload(
                (root / "out" / "custom.html").resolve().read_text(encoding="utf-8"))
            comps = [g["component"] for g in payload["files"]["executionPlans"]]
            self.assertEqual(comps, ["01-data-prep"])
            self.assertNotIn("Secret other plan", json.dumps(payload))


def make_feedback_doc(share_hash_value, focus=None, mode="remote"):
    meta = {
        "sessionId": "test-session", "generatedAt": "2026-07-03T12:00:00",
        "mode": mode, "focus": focus, "reviewer": "Candice",
        "payloadHash": "deadbeef", "shareHash": share_hash_value,
        "annotations": [],
    }
    return (
        "# Board Feedback\n\nLooks good overall.\n"
        + "\n```json board-feedback\n" + json.dumps(meta, indent=1) + "\n```\n"
    )


class TestCollectFile(unittest.TestCase):
    def test_collect_file_fresh(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            current = board.collect_payload(root, "remote", None)
            doc = make_feedback_doc(current["shareHash"])
            f = root / "feedback.txt"
            f.write_text(doc, encoding="utf-8")
            r = run_board(root, "--collect", str(f))
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(r.stdout.rstrip("\n"), doc.rstrip("\n"))
            self.assertNotIn("STALE", r.stderr)
            self.assertTrue(f.is_file())  # never deleted

    def test_collect_file_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            current = board.collect_payload(root, "remote", None)
            doc = make_feedback_doc(current["shareHash"])
            f = root / "feedback.txt"
            f.write_text(doc, encoding="utf-8")
            (root / "plans" / "execution" / "01-data-prep" / ".draft-v2.md").write_text(
                "# Data prep v2 draft\n\nRevised since export.\n", encoding="utf-8")
            r = run_board(root, "--collect", str(f))
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("STALE", r.stderr)

    def test_collect_file_without_fence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            f = root / "feedback.txt"
            f.write_text("# Board Feedback\n\nNo fence here.\n", encoding="utf-8")
            r = run_board(root, "--collect", str(f))
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("no parseable", r.stderr)
            self.assertIn("No fence here", r.stdout)

    def test_collect_pending_still_deletes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            pending = root / "plans" / ".board-feedback.md"
            pending.write_text("# Board Feedback\n\npending\n", encoding="utf-8")
            r = run_board(root, "--collect")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("pending", r.stdout)
            self.assertFalse(pending.is_file())


if __name__ == "__main__":
    unittest.main()
