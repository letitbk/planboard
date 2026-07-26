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
            self.assertNotEqual(
                before["paths"], audit.context_identity(root, ["load.py"])["paths"])

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
