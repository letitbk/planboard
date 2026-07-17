"""Route-level tests for displayed-content-bound batch approvals."""
import hashlib
import json
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from tests.test_board import (
    board,
    board_token_of,
    http_json,
    live_payload,
    make_project,
    serve_in_thread,
    spawn_board,
)


class TestBatchApprovalRoutes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        make_project(self.root)
        self.draft = (
            self.root / "plans" / "execution" / "01-data-prep" / ".draft-v2.md"
        )
        self.payload = board.apply_gate_batch(
            self.root, live_payload(self.root), allow_single=True)
        self.entry = self.payload["gateBatch"][0]
        self.url = None
        self.thread = None
        self.info = None

    def _start(self):
        self.url, self.info, self.thread = serve_in_thread(
            self.root, self.payload, timeout=15)
        self.addCleanup(self._finish)

    def _finish(self):
        if self.thread is None or not self.thread.is_alive():
            return
        try:
            http_json(self.url, "/api/batch/done", body={
                "boardToken": self.info["boardToken"],
            })
        except Exception:
            pass
        self.thread.join(timeout=5)

    def _approve(self, entry=None, content_hash=None):
        entry = entry or self.entry
        return http_json(self.url, "/api/batch/approve", body={
            "component": entry["component"],
            "proposedVersion": entry["proposedVersion"],
            "contentHash": content_hash or entry["contentHash"],
            "boardToken": self.info["boardToken"],
        })

    def _ticket(self, version=2):
        return (self.root / "plans" / "execution" /
                (".import-approved-01-data-prep-v%d" % version))

    def test_correct_displayed_hash_writes_one_atomic_ticket(self):
        self._start()
        with mock.patch.object(
                board.models, "atomic_write", wraps=board.models.atomic_write) as atomic:
            status, body, _ = self._approve()
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(atomic.call_count, 1)
        ticket = self._ticket()
        self.assertTrue(ticket.is_file())
        self.assertEqual(json.loads(ticket.read_text(encoding="utf-8"))["version"], 2)

    def test_rewritten_draft_refreshes_then_fresh_hash_approves(self):
        self._start()
        fresh_text = "# Data prep v2 draft\n\nChanged after boot.\n"
        self.draft.write_text(fresh_text, encoding="utf-8")

        status, body, _ = self._approve()
        self.assertEqual(status, 409)
        self.assertEqual(body["error"], "stale-draft")
        self.assertEqual(body["entry"]["content"], fresh_text)
        self.assertEqual(
            body["entry"]["contentHash"],
            hashlib.sha256(fresh_text.encode("utf-8")).hexdigest())
        self.assertFalse(self._ticket().exists())

        status, _, _ = self._approve(entry=body["entry"])
        self.assertEqual(status, 200)
        self.assertTrue(self._ticket().exists())

    def test_newer_draft_replaces_the_batch_entry(self):
        self._start()
        newer = self.draft.parent / ".draft-v3.md"
        newer.write_text("# Data prep v3 draft\n", encoding="utf-8")
        status, body, _ = self._approve()
        self.assertEqual(status, 409)
        self.assertEqual(body["error"], "newer-draft")
        self.assertEqual(body["entry"]["proposedVersion"], 3)
        self.assertEqual(body["entry"]["path"],
                         "plans/execution/01-data-prep/.draft-v3.md")
        self.assertFalse(self._ticket().exists())

    def test_deleted_draft_is_gone(self):
        self._start()
        self.draft.unlink()
        status, body, _ = self._approve()
        self.assertEqual(status, 410)
        self.assertEqual(body["error"], "draft-missing")
        self.assertFalse(self._ticket().exists())

    def test_trailer_in_draft_is_rejected(self):
        self._start()
        self.draft.write_text(
            "# Data prep v2 draft\n\nSigned off: sneaky\n", encoding="utf-8")
        status, body, _ = self._approve()
        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "trailer-in-draft")
        self.assertFalse(self._ticket().exists())

    def test_unrecognized_client_hash_requires_reload(self):
        self._start()
        status, body, _ = self._approve(content_hash="0" * 64)
        self.assertEqual(status, 409)
        self.assertEqual(body["error"], "hash-mismatch")
        self.assertFalse(self._ticket().exists())

    def test_ticketed_entries_seed_the_restart_summary(self):
        content = self.draft.read_text(encoding="utf-8")
        board.write_ticket(self.root, "01-data-prep", 2, content, "prior")
        other = self.root / "plans" / "execution" / "02-other" / ".draft-v2.md"
        other.write_text("# Other v2 draft\n", encoding="utf-8")
        payload = board.apply_gate_batch(
            self.root, live_payload(self.root), allow_single=True)
        resumed = next(e for e in payload["gateBatch"]
                       if e["component"] == "01-data-prep")
        self.assertTrue(resumed["ticketed"])

        proc, url = spawn_board(
            self.root, "--gate-batch", "--allow-single", timeout=20)
        try:
            token = board_token_of(url)
            status, _, _ = http_json(
                url, "/api/batch/done", body={"boardToken": token})
            self.assertEqual(status, 200)
            stdout, stderr = proc.communicate(timeout=10)
            self.assertEqual(proc.returncode, 0, stderr)
            self.assertIn("approved: 01-data-prep v2", stdout)
        finally:
            if proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=5)

    def test_reject_is_process_local_and_writes_no_ticket(self):
        self._start()
        status, body, _ = http_json(self.url, "/api/batch/reject", body={
            "component": self.entry["component"],
            "proposedVersion": self.entry["proposedVersion"],
            "comment": "change it",
            "boardToken": self.info["boardToken"],
        })
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertFalse(self._ticket().exists())
        self.assertTrue(self.draft.exists())

    def test_concurrent_approvals_are_serialized_and_leave_one_ticket(self):
        self._start()
        original = board.write_ticket
        active = 0
        max_active = 0
        guard = threading.Lock()

        def slow_write(*args, **kwargs):
            nonlocal active, max_active
            with guard:
                active += 1
                max_active = max(max_active, active)
            time.sleep(0.05)
            try:
                return original(*args, **kwargs)
            finally:
                with guard:
                    active -= 1

        responses = []
        barrier = threading.Barrier(3)

        def post():
            barrier.wait()
            responses.append(self._approve()[0])

        with mock.patch.object(board, "write_ticket", side_effect=slow_write):
            threads = [threading.Thread(target=post) for _ in range(2)]
            for thread in threads:
                thread.start()
            barrier.wait()
            for thread in threads:
                thread.join(timeout=5)

        self.assertEqual(responses, [200, 200])
        self.assertEqual(max_active, 1)
        tickets = list((self.root / "plans" / "execution").glob(
            ".import-approved-01-data-prep-v2"))
        self.assertEqual(len(tickets), 1)
        json.loads(tickets[0].read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
