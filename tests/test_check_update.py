"""Tests for check_update.py. Run:
    python3 -m unittest tests.test_check_update -v
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = (
    Path(__file__).resolve().parents[1]
    / "skills" / "managing-research-plans" / "scripts"
)
sys.path.insert(0, str(SCRIPTS))
import check_update as cu  # noqa: E402


class TestVersion(unittest.TestCase):
    def test_parse_strips_v_and_splits(self):
        self.assertEqual(cu.parse_version("v0.11.0"), (0, 11, 0))
        self.assertEqual(cu.parse_version("0.12.0"), (0, 12, 0))

    def test_parse_nonnumeric_part_is_zero(self):
        self.assertEqual(cu.parse_version("0.12.0-rc1"), (0, 12, 0))

    def test_is_newer(self):
        self.assertTrue(cu.is_newer("0.12.0", "0.11.0"))
        self.assertTrue(cu.is_newer("0.11.1", "0.11.0"))
        self.assertFalse(cu.is_newer("0.11.0", "0.11.0"))
        self.assertFalse(cu.is_newer("0.10.0", "0.11.0"))


class TestState(unittest.TestCase):
    def test_missing_file_returns_defaults(self):
        with tempfile.TemporaryDirectory() as d:
            state = cu.read_state(Path(d) / "nope.json")
            self.assertEqual(state, cu.DEFAULT_STATE)
            self.assertIsNot(state, cu.DEFAULT_STATE)  # a copy, not the shared dict

    def test_malformed_file_returns_defaults(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "update-check.json"
            p.write_text("{not json")
            self.assertEqual(cu.read_state(p), cu.DEFAULT_STATE)

    def test_write_then_read_roundtrips_and_creates_parents(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "sub" / "update-check.json"
            state = dict(cu.DEFAULT_STATE, lastNotifiedVersion="0.12.0")
            cu.write_state(p, state)
            self.assertTrue(p.exists())
            self.assertEqual(cu.read_state(p)["lastNotifiedVersion"], "0.12.0")

    def test_read_merges_over_defaults(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "update-check.json"
            p.write_text(json.dumps({"lastAttempt": 5}))
            state = cu.read_state(p)
            self.assertEqual(state["lastAttempt"], 5)
            self.assertEqual(state["lastNotifiedVersion"], "")  # default preserved


class TestThrottleAndCadence(unittest.TestCase):
    def test_should_check_true_when_stale(self):
        state = dict(cu.DEFAULT_STATE, lastAttempt=0.0)
        self.assertTrue(cu.should_check(state, now=100000.0))

    def test_should_check_false_when_recent(self):
        state = dict(cu.DEFAULT_STATE, lastAttempt=100000.0)
        self.assertFalse(cu.should_check(state, now=100000.0 + 3600))

    def test_should_notify_only_for_new_version(self):
        state = dict(cu.DEFAULT_STATE, lastNotifiedVersion="0.12.0")
        self.assertFalse(cu.should_notify(state, "0.12.0"))
        self.assertTrue(cu.should_notify(state, "0.13.0"))
