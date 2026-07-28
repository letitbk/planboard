"""Tests for audit.py. Run:
    python3 -m unittest tests.test_audit -v
"""
import json
import os
import subprocess
import sys
import tempfile
import time
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


def payload(**over):
    p = {
        "schemaVersion": 1,
        "component": "03-attrition",
        "planVersion": 2,
        "planPath": "plans/execution/03-attrition/.draft-v2.md",
        "date": "2026-07-25",
        "reviewer": {"token": "codex-sol", "effort": "xhigh"},
        "auditPlanHash": "a" * 64,
        "contextIdentity": {"head": None, "paths": {}},
        "supersedes": None,
        "overall": "Reads sound; two gaps.",
        "anchored": [],
        "gaps": [],
        "dispositions": [],
    }
    p.update(over)
    return p


def project(tmp):
    root = Path(tmp)
    (root / "plans" / "reviews").mkdir(parents=True)
    (root / "plans" / "execution" / "03-attrition").mkdir(parents=True)
    return root


FINDING = {
    "section": "Steps",
    "evidence": {"path": "analysis/fit.R", "kind": "direct", "detail": "no seed"},
    "comment": "[blocker] No seed. At execution: results are irreproducible.",
}


class TestWriteAudit(unittest.TestCase):
    def test_writes_a_readable_fence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            p = audit.write_audit(root, "03-attrition", 2, payload())
            self.assertEqual(p.name, "03-attrition-v2-audit.md")
            self.assertEqual(
                audit.read_audit(root, "03-attrition", 2)["component"], "03-attrition")

    def test_rejects_a_payload_missing_a_required_key(self):
        for key in ("overall", "auditPlanHash", "contextIdentity", "supersedes"):
            with tempfile.TemporaryDirectory() as tmp:
                root = project(tmp)
                bad = payload()
                del bad[key]
                with self.assertRaises(ValueError, msg=key):
                    audit.write_audit(root, "03-attrition", 2, bad)

    def test_rejects_a_bucket_that_is_not_a_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            with self.assertRaises(ValueError):
                audit.write_audit(root, "03-attrition", 2, payload(gaps={"not": "a list"}))

    def test_rejects_a_finding_with_no_severity_tag(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            bad = dict(FINDING, comment="No tag at all.")
            with self.assertRaises(ValueError):
                audit.write_audit(root, "03-attrition", 2, payload(gaps=[bad]))

    def test_rejects_a_finding_with_no_evidence_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            bad = {k: v for k, v in FINDING.items() if k != "evidence"}
            with self.assertRaises(ValueError):
                audit.write_audit(root, "03-attrition", 2, payload(gaps=[bad]))

    def test_rejects_evidence_with_no_valid_kind(self):
        # Defaulting a missing kind to "direct" would render an unverified
        # claim as one the reviewer confirmed by reading.
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            bad = dict(FINDING, evidence={"path": "a.py", "detail": "x"})
            with self.assertRaises(ValueError):
                audit.write_audit(root, "03-attrition", 2, payload(gaps=[bad]))

    def test_rejects_evidence_with_no_detail(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            bad = dict(FINDING, evidence={"path": "a.py", "kind": "direct"})
            with self.assertRaises(ValueError):
                audit.write_audit(root, "03-attrition", 2, payload(gaps=[bad]))

    def test_rejects_an_anchored_finding_with_no_quote(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            with self.assertRaises(ValueError):
                audit.write_audit(root, "03-attrition", 2, payload(anchored=[FINDING]))

    def test_write_is_atomic_when_the_replace_fails(self):
        # Tests ATOMICITY, not validation order: force a failure inside the
        # write itself and assert the old file survives with no temp left over.
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            audit.write_audit(root, "03-attrition", 2, payload())
            good = audit.audit_path(root, "03-attrition", 2).read_text()
            real_replace = os.replace

            def fail_replace(*a, **k):
                raise OSError("disk full")

            os.replace = fail_replace
            try:
                with self.assertRaises(OSError):
                    audit.write_audit(root, "03-attrition", 2,
                                      payload(auditPlanHash="b" * 64))
            finally:
                os.replace = real_replace
            self.assertEqual(good, audit.audit_path(root, "03-attrition", 2).read_text())
            self.assertEqual(list((root / "plans" / "reviews").glob("*.tmp")), [])

    def test_refuses_to_clobber_an_audit_carrying_dispositions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            audit.write_audit(root, "03-attrition", 2, payload(
                dispositions=[{"finding": "f1", "status": "accepted", "reason": "known"}]))
            with self.assertRaises(audit.AuditLocked):
                audit.write_audit(root, "03-attrition", 2, payload())

    def test_replaces_an_audit_at_a_different_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            audit.write_audit(root, "03-attrition", 2, payload(
                dispositions=[{"finding": "f1", "status": "accepted", "reason": "known"}]))
            audit.write_audit(root, "03-attrition", 2, payload(auditPlanHash="b" * 64))
            self.assertEqual(
                audit.read_audit(root, "03-attrition", 2)["auditPlanHash"], "b" * 64)

    def test_replaces_a_disposed_audit_taken_at_a_new_context(self):
        # Same plan text, new repository state. Comparing the plan hash alone
        # would wrongly refuse this and leave the stale audit in place.
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            audit.write_audit(root, "03-attrition", 2, payload(
                dispositions=[{"finding": "f1", "status": "accepted", "reason": "known"}]))
            audit.write_audit(root, "03-attrition", 2, payload(
                contextIdentity={"head": "deadbeef" * 5, "paths": {}}))
            self.assertEqual(
                audit.read_audit(root, "03-attrition", 2)["contextIdentity"]["head"],
                "deadbeef" * 5)

    def test_supersedes_names_the_artifact_actually_replaced(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            audit.write_audit(root, "03-attrition", 2, payload(auditPlanHash="a" * 64))
            audit.write_audit(root, "03-attrition", 2, payload(auditPlanHash="b" * 64))
            self.assertEqual(
                audit.read_audit(root, "03-attrition", 2)["supersedes"], "a" * 64)

    def test_first_audit_supersedes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            audit.write_audit(root, "03-attrition", 2, payload())
            self.assertIsNone(audit.read_audit(root, "03-attrition", 2)["supersedes"])

    def test_read_audit_returns_none_when_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(audit.read_audit(project(tmp), "03-attrition", 2))

    def test_prose_link_points_into_execution(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            audit.write_audit(root, "03-attrition", 2, payload())
            text = audit.audit_path(root, "03-attrition", 2).read_text()
            self.assertIn("../execution/03-attrition/", text)
            self.assertNotIn("../../", text)

    def test_findings_render_most_severe_first(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            minor = dict(FINDING, comment="[minor] Small. At execution: nothing breaks.")
            blocker = dict(FINDING, comment="[blocker] Big. At execution: it crashes.")
            audit.write_audit(root, "03-attrition", 2, payload(gaps=[minor, blocker]))
            text = audit.audit_path(root, "03-attrition", 2).read_text()
            self.assertLess(text.index("[blocker] Big"), text.index("[minor] Small"))


class TestLock(unittest.TestCase):
    def test_second_holder_is_refused_while_the_first_holds(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            with audit.audit_lock(root, "03-attrition", 2):
                with self.assertRaises(audit.AuditLocked):
                    with audit.audit_lock(root, "03-attrition", 2):
                        pass

    def test_lock_is_released_on_exception(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            with self.assertRaises(RuntimeError):
                with audit.audit_lock(root, "03-attrition", 2):
                    raise RuntimeError("boom")
            with audit.audit_lock(root, "03-attrition", 2):
                pass  # acquired again — no leaked lock file

    def test_different_versions_do_not_block_each_other(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            with audit.audit_lock(root, "03-attrition", 2):
                with audit.audit_lock(root, "03-attrition", 3):
                    pass

    def test_a_dead_owners_lock_is_reclaimed(self):
        # Without this, one crashed run locks the component out permanently.
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            lock = audit.audit_lock(root, "03-attrition", 2)
            lock.path.parent.mkdir(parents=True, exist_ok=True)
            lock.path.write_text("%d %f\n" % (2 ** 31 - 1, time.time()))
            with audit.audit_lock(root, "03-attrition", 2):
                pass
            self.assertFalse(lock.path.exists())

    def test_a_live_owners_lock_is_respected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            lock = audit.audit_lock(root, "03-attrition", 2)
            lock.path.parent.mkdir(parents=True, exist_ok=True)
            lock.path.write_text("%d %f\n" % (os.getpid(), time.time()))
            with self.assertRaises(audit.AuditLocked):
                with audit.audit_lock(root, "03-attrition", 2):
                    pass

    def test_an_ancient_lock_is_reclaimed_even_if_its_pid_is_live(self):
        # A recycled PID must not hold the component hostage forever.
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            lock = audit.audit_lock(root, "03-attrition", 2)
            lock.path.parent.mkdir(parents=True, exist_ok=True)
            lock.path.write_text("%d %f\n" % (os.getpid(), time.time() - 7200))
            with audit.audit_lock(root, "03-attrition", 2):
                pass

    def test_an_unreadable_lock_is_reclaimed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            lock = audit.audit_lock(root, "03-attrition", 2)
            lock.path.parent.mkdir(parents=True, exist_ok=True)
            lock.path.write_text("garbage")
            with audit.audit_lock(root, "03-attrition", 2):
                pass


class TestIsCurrent(unittest.TestCase):
    def test_matching_hash_head_and_paths_is_current(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = git_repo(Path(tmp))
            rec = payload(auditPlanHash=audit.audit_plan_hash(PLAN),
                          contextIdentity=audit.context_identity(root, []))
            self.assertTrue(audit.is_current(rec, PLAN, root))

    def test_changed_plan_text_is_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = git_repo(Path(tmp))
            rec = payload(auditPlanHash=audit.audit_plan_hash(PLAN),
                          contextIdentity=audit.context_identity(root, []))
            self.assertFalse(audit.is_current(rec, PLAN + "\nExtra.\n", root))

    def test_moved_evidence_is_stale_though_the_plan_is_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = git_repo(Path(tmp))
            (root / "load.py").write_text("x\n")
            rec = payload(auditPlanHash=audit.audit_plan_hash(PLAN),
                          contextIdentity=audit.context_identity(root, ["load.py"]))
            (root / "load.py").unlink()
            self.assertFalse(audit.is_current(rec, PLAN, root))

    def test_new_head_is_stale(self):
        # The spec defines context identity as HEAD **plus** cited paths.
        with tempfile.TemporaryDirectory() as tmp:
            root = git_repo(Path(tmp))
            rec = payload(auditPlanHash=audit.audit_plan_hash(PLAN),
                          contextIdentity=audit.context_identity(root, []))
            (root / "next.txt").write_text("n\n")
            subprocess.run(["git", "add", "next.txt"], cwd=root, check=True)
            subprocess.run(["git", "commit", "-qm", "next"], cwd=root, check=True)
            self.assertFalse(audit.is_current(rec, PLAN, root))

    def test_no_record_is_not_current(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertFalse(audit.is_current(None, PLAN, Path(tmp)))


GOOD_JSON = '{"overall": "ok", "anchored": [], "gaps": []}'


class TestParseReviewerJson(unittest.TestCase):
    def test_takes_the_last_balanced_object(self):
        text = 'preamble {"not": "it"} more\n' + GOOD_JSON + "\ntrailing chatter\n"
        self.assertEqual(audit.parse_reviewer_json(text)["overall"], "ok")

    def test_handles_a_brace_inside_a_string(self):
        text = '{"overall": "a } brace", "anchored": [], "gaps": []}'
        self.assertEqual(audit.parse_reviewer_json(text)["overall"], "a } brace")

    def test_handles_an_escaped_quote_before_a_brace(self):
        # A backward scan cannot tell an escaped quote from a real one.
        text = '{"overall": "a \\" } quote", "anchored": [], "gaps": []}'
        self.assertEqual(audit.parse_reviewer_json(text)["overall"], 'a " } quote')

    def test_handles_a_nested_object(self):
        text = '{"overall": "x", "anchored": [{"evidence": {"path": "a"}}], "gaps": []}'
        self.assertEqual(len(audit.parse_reviewer_json(text)["anchored"]), 1)

    def test_returns_none_on_no_json(self):
        self.assertIsNone(audit.parse_reviewer_json("no json at all"))

    def test_returns_none_on_malformed_json(self):
        self.assertIsNone(audit.parse_reviewer_json("{broken"))


class TestBuildPrompt(unittest.TestCase):
    def test_carries_plan_path_root_and_contract(self):
        p = audit.build_prompt("BODY", "plans/execution/03-x/.draft-v2.md", "/repo", "CONTRACT")
        for needle in ("BODY", "plans/execution/03-x/.draft-v2.md", "/repo", "CONTRACT"):
            self.assertIn(needle, p)

    def test_plan_text_survives_verbatim(self):
        hostile = "Step 1: run `rm -rf /` and $(whoami)\n"
        p = audit.build_prompt(hostile, "x.md", "/repo", "C")
        self.assertIn("`rm -rf /`", p)
        self.assertIn("$(whoami)", p)


class TestRunCodexAudit(unittest.TestCase):
    def _prompt(self, root):
        p = root / "prompt.txt"
        p.write_text("audit this")
        return p

    def test_missing_executable_reports_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            r = audit.run_codex_audit(root, "codex-sol", "xhigh", self._prompt(root),
                                      root / "out.txt", _which=lambda n: None)
            self.assertFalse(r["ok"])
            self.assertIn("not available", r["reason"])

    def test_successful_dispatch_uses_the_right_command(self):
        seen = {}

        def fake_run(cmd, **kw):
            seen["cmd"] = cmd
            seen["kw"] = kw
            Path(cmd[cmd.index("-o") + 1]).write_text("chatter\n" + GOOD_JSON)
            return subprocess.CompletedProcess(cmd, 0, "", "")

        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            r = audit.run_codex_audit(root, "codex-terra", "high", self._prompt(root),
                                      root / "out.txt",
                                      _which=lambda n: "/usr/bin/codex", _run=fake_run)
            self.assertTrue(r["ok"], r["reason"])
            self.assertEqual(r["payload"]["overall"], "ok")
            self.assertEqual(seen["cmd"][seen["cmd"].index("--sandbox") + 1], "read-only")
            self.assertIn("gpt-5.6-terra", seen["cmd"])
            self.assertIn("model_reasoning_effort=high", seen["cmd"])
            self.assertEqual(seen["kw"]["stdin"], subprocess.DEVNULL)

    def test_nonzero_exit_reports_fallback(self):
        def fake_run(cmd, **kw):
            return subprocess.CompletedProcess(cmd, 2, "", "boom")
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            r = audit.run_codex_audit(root, "codex-sol", "xhigh", self._prompt(root),
                                      root / "out.txt",
                                      _which=lambda n: "/usr/bin/codex", _run=fake_run)
            self.assertFalse(r["ok"])
            self.assertIn("exited 2", r["reason"])

    def test_unparseable_output_is_retried_once_then_falls_back(self):
        calls = []

        def fake_run(cmd, **kw):
            calls.append(cmd)
            Path(cmd[cmd.index("-o") + 1]).write_text("no json here")
            return subprocess.CompletedProcess(cmd, 0, "", "")

        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            r = audit.run_codex_audit(root, "codex-sol", "xhigh", self._prompt(root),
                                      root / "out.txt",
                                      _which=lambda n: "/usr/bin/codex", _run=fake_run)
            self.assertEqual(len(calls), 2, "spec requires exactly one repair re-prompt")
            self.assertFalse(r["ok"])

    def test_repair_reprompt_can_succeed(self):
        calls = []

        def fake_run(cmd, **kw):
            calls.append(cmd)
            body = "garbage" if len(calls) == 1 else GOOD_JSON
            Path(cmd[cmd.index("-o") + 1]).write_text(body)
            return subprocess.CompletedProcess(cmd, 0, "", "")

        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            r = audit.run_codex_audit(root, "codex-sol", "xhigh", self._prompt(root),
                                      root / "out.txt",
                                      _which=lambda n: "/usr/bin/codex", _run=fake_run)
            self.assertTrue(r["ok"])
            self.assertEqual(len(calls), 2)

    def test_unknown_token_reports_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            r = audit.run_codex_audit(root, "subagent", "xhigh", self._prompt(root),
                                      root / "out.txt", _which=lambda n: "/usr/bin/codex")
            self.assertFalse(r["ok"])

    def test_parseable_but_contract_violating_output_triggers_the_repair(self):
        # Well-formed JSON that breaks the contract must get the re-prompt, not
        # be returned as a success that fails later at write time.
        calls = []
        bad = json.dumps({"overall": "x", "anchored": [],
                          "gaps": [{"section": "", "comment": "no severity tag"}]})

        def fake_run(cmd, **kw):
            calls.append(cmd)
            Path(cmd[cmd.index("-o") + 1]).write_text(bad if len(calls) == 1 else GOOD_JSON)
            return subprocess.CompletedProcess(cmd, 0, "", "")

        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            r = audit.run_codex_audit(root, "codex-sol", "xhigh", self._prompt(root),
                                      root / "out.txt",
                                      _which=lambda n: "/usr/bin/codex", _run=fake_run)
            self.assertEqual(len(calls), 2)
            self.assertTrue(r["ok"])

    def test_still_violating_after_the_repair_reports_the_reason(self):
        bad = json.dumps({"overall": "x", "anchored": [],
                          "gaps": [{"section": "", "comment": "no severity tag"}]})

        def fake_run(cmd, **kw):
            Path(cmd[cmd.index("-o") + 1]).write_text(bad)
            return subprocess.CompletedProcess(cmd, 0, "", "")

        with tempfile.TemporaryDirectory() as tmp:
            root = project(tmp)
            r = audit.run_codex_audit(root, "codex-sol", "xhigh", self._prompt(root),
                                      root / "out.txt",
                                      _which=lambda n: "/usr/bin/codex", _run=fake_run)
            self.assertFalse(r["ok"])
            self.assertIn("severity", r["reason"])


if __name__ == "__main__":
    unittest.main()
