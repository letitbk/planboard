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
    r1 = plans / "execution" / "01-data-prep" / "results" / "r1"
    (r1 / "artifacts").mkdir(parents=True)
    (r1 / "scripts").mkdir()
    (r1 / "artifacts" / "fig1.png").write_bytes(b"\x89PNG r1 fig")
    (r1 / "scripts" / "clean.R").write_text("x <- 1\n", encoding="utf-8")
    (r1 / "report.md").write_text("# Results r1\n\nAll good.\n", encoding="utf-8")
    (r1 / "manifest.json").write_text(json.dumps({
        "schemaVersion": 1, "component": "01-data-prep", "resultsVersion": 1,
        "planVersion": 1, "provenance": "planned", "trigger": "initial",
        "capturedAt": "2026-07-03 10:00", "summary": "r1",
        "metrics": [{"label": "N", "value": "100"}],
        "artifacts": [{"id": "fig", "kind": "figure", "title": "Fig 1",
                       "file": "artifacts/fig1.png",
                       "source": {"path": "output/fig1.png", "sha256": "0" * 64,
                                  "bytes": 11, "oversized": False},
                       "producedBy": {"script": "scripts/clean.R",
                                      "sourcePath": "code/clean.R", "lang": "r"}}],
    }), encoding="utf-8")
    (r1 / "verdict.json").write_text(json.dumps({
        "status": "accepted", "date": "2026-07-03 11:00",
        "planVersion": 1, "reviewer": "BK"}), encoding="utf-8")
    # a results-only component: no vN.md, only a bundle (retrofit case)
    r_only = plans / "execution" / "03-retrofit" / "results" / "r1"
    (r_only / "artifacts").mkdir(parents=True)
    (r_only / "report.md").write_text("# Retrofit r1\n", encoding="utf-8")
    (r_only / "manifest.json").write_text(json.dumps({
        "schemaVersion": 1, "component": "03-retrofit", "resultsVersion": 1,
        "planVersion": None, "provenance": "retrofit", "trigger": "initial",
        "capturedAt": "2026-07-02 09:00", "metrics": [], "artifacts": []}),
        encoding="utf-8")
    # a stale staging dir that must NOT appear in the payload
    (plans / "execution" / "01-data-prep" / "results" / ".staging-zz").mkdir()
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
                "draftSnapshots": [
                    {"path": "plans/execution/01-x/v1-draft-1.md", "content": "s1",
                     "version": 1, "iteration": 1},
                ],
                "draft": {"path": "plans/execution/01-x/.draft-v2.md", "content": "d2"},
            }],
            "reviews": [{"path": "plans/reviews/r.md", "content": "r"}],
        }}
        paths = [f["path"] for f in board.payload_files(payload)]
        self.assertEqual(sorted(paths), sorted([
            "plans/master-plan.md", "plans/decision-log.md",
            "plans/execution/01-x/v1.md",
            "plans/execution/01-x/v1-draft-1.md",
            "plans/execution/01-x/.draft-v2.md",
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

    def test_draft_snapshots_collected_in_all_modes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            comp = root / "plans" / "execution" / "01-data-prep"
            (comp / "v1-draft-1.md").write_text("# v1 draft 1\n", encoding="utf-8")
            (comp / "v1-draft-2.md").write_text("# v1 draft 2\n", encoding="utf-8")
            # Committed snapshots ride in every mode (unlike the ephemeral draft,
            # which static/export omit).
            for mode in ("static", "remote", "live"):
                payload = board.collect_payload(root, mode, None)
                groups = {g["component"]: g for g in payload["files"]["executionPlans"]}
                snaps = groups["01-data-prep"].get("draftSnapshots")
                self.assertIsNotNone(snaps, "snapshots missing in %s mode" % mode)
                self.assertEqual(
                    [(s["version"], s["iteration"]) for s in snaps], [(1, 1), (1, 2)])
                paths = [f["path"] for f in board.payload_files(payload)]
                self.assertIn("plans/execution/01-data-prep/v1-draft-1.md", paths)
            # The sign-off version regex ignores vN-draft-K names, so a snapshot
            # never leaks into the signed versions list.
            payload = board.collect_payload(root, "static", None)
            groups = {g["component"]: g for g in payload["files"]["executionPlans"]}
            vpaths = [v["path"] for v in groups["01-data-prep"]["versions"]]
            self.assertNotIn("plans/execution/01-data-prep/v1-draft-1.md", vpaths)


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

    def test_collect_file_non_dict_fence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            f = root / "feedback.txt"
            f.write_text(
                "# Board Feedback\n\nBody.\n\n```json board-feedback\n[1, 2, 3]\n```\n",
                encoding="utf-8",
            )
            r = run_board(root, "--collect", str(f))
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("no parseable", r.stderr)
            self.assertIn("Body.", r.stdout)

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


class TestResultsPayload(unittest.TestCase):
    def test_bundles_collected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            payload = board.collect_payload(root, "live", None)
            self.assertEqual(payload["schemaVersion"], 2)
            groups = {g["component"]: g for g in payload["files"]["executionPlans"]}
            b = groups["01-data-prep"]["results"][0]
            self.assertEqual(b["resultsVersion"], 1)
            self.assertEqual(b["manifest"]["provenance"], "planned")
            self.assertEqual(b["verdict"]["status"], "accepted")
            self.assertEqual(b["report"]["content"].splitlines()[0], "# Results r1")
            self.assertEqual(b["scripts"][0]["path"],
                             "plans/execution/01-data-prep/results/r1/scripts/clean.R")

    def test_results_only_component_emitted(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            payload = board.collect_payload(root, "live", None)
            comps = [g["component"] for g in payload["files"]["executionPlans"]]
            self.assertIn("03-retrofit", comps)
            g = next(g for g in payload["files"]["executionPlans"]
                     if g["component"] == "03-retrofit")
            self.assertEqual(g["versions"], [])
            self.assertIsNone(g["results"][0]["manifest"]["planVersion"])

    def test_payload_files_include_results(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            payload = board.collect_payload(root, "live", None)
            paths = [f["path"] for f in board.payload_files(payload)]
            self.assertIn("plans/execution/01-data-prep/results/r1/manifest.json", paths)
            self.assertIn("plans/execution/01-data-prep/results/r1/report.md", paths)
            self.assertIn("plans/execution/01-data-prep/results/r1/verdict.json", paths)
            self.assertIn("plans/execution/01-data-prep/results/r1/scripts/clean.R", paths)

    def test_staging_dirs_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            payload = board.collect_payload(root, "live", None)
            g = next(g for g in payload["files"]["executionPlans"]
                     if g["component"] == "01-data-prep")
            self.assertEqual(len(g["results"]), 1)


class TestAssets(unittest.TestCase):
    def _bundle(self, payload):
        g = next(g for g in payload["files"]["executionPlans"]
                 if g["component"] == "01-data-prep")
        return g["results"][0]

    def test_live_assets_are_routes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            payload = board.collect_payload(root, "live", None)
            board.build_assets(root, payload)
            b = self._bundle(payload)
            self.assertEqual(b["assets"]["fig1.png"],
                             "/artifact/01-data-prep/r1/fig1.png")

    def test_static_assets_are_data_uris(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            payload = board.collect_payload(root, "static", None)
            board.build_assets(root, payload)
            b = self._bundle(payload)
            self.assertTrue(b["assets"]["fig1.png"].startswith("data:image/png;base64,"))

    def test_artifact_map_and_export_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            payload = board.collect_payload(root, "live", None)
            board.build_assets(root, payload)
            amap = board.artifact_map(root, payload)
            key = "/artifact/01-data-prep/r1/fig1.png"
            self.assertIn(key, amap)
            self.assertTrue(amap[key].is_file())
            self.assertNotIn("/artifact/01-data-prep/r1/../secret", amap)

    def test_focus_results_parsing(self):
        self.assertEqual(board.split_focus("02-x:r3"), ("02-x", 3))
        self.assertEqual(board.split_focus("02-x"), ("02-x", None))
        self.assertEqual(board.split_focus(None), (None, None))


class TestExportResults(unittest.TestCase):
    def test_export_embeds_bundles_and_data_uris(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            p = run_board(root, "--export")
            self.assertEqual(p.returncode, 0, p.stderr)
            payload = extract_payload((root / "plans" / "board.html").read_text())
            g = next(g for g in payload["files"]["executionPlans"]
                     if g["component"] == "01-data-prep")
            self.assertTrue(
                g["results"][0]["assets"]["fig1.png"].startswith("data:image/png;base64,"))


class TestDocumentFromBody(unittest.TestCase):
    PAYLOAD = {"generatedAt": "2026-07-03T12:00:00", "mode": "live", "focus": None}

    def test_verbatim_when_client_assembled(self):
        body = {"feedbackDocument": "# Board Feedback\n\nclient built\n"}
        self.assertEqual(
            board.document_from_body(body, self.PAYLOAD),
            "# Board Feedback\n\nclient built\n",
        )

    def test_fallback_to_server_builder(self):
        body = {"feedbackMarkdown": "# Board Feedback\n\nlegacy", "annotations": []}
        doc = board.document_from_body(body, self.PAYLOAD)
        self.assertIn("legacy", doc)
        self.assertIn("```json board-feedback", doc)

    def test_empty_string_falls_back(self):
        body = {"feedbackDocument": "  ", "feedbackMarkdown": "# X", "annotations": []}
        self.assertIn("```json board-feedback", board.document_from_body(body, self.PAYLOAD))


def _init_git(root):
    subprocess.run(["git", "init", str(root)], check=True, capture_output=True)
    for k, v in (("user.email", "t@example.com"), ("user.name", "Test")):
        subprocess.run(["git", "-C", str(root), "config", k, v], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(root), "add", "-A"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(root), "commit", "-m", "init", "--allow-empty"],
                   check=True, capture_output=True)


class TestPublish(unittest.TestCase):
    def test_render_static_html_is_pure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            html = board.render_static_html(root, None)
            self.assertIn('id="board-data"', html)
            # pure: writes no file, touches no gitignore
            self.assertFalse((root / "plans" / "board.html").exists())
            self.assertFalse((root / "plans" / ".gitignore").exists())

    def test_parse_github_remote_forms(self):
        self.assertEqual(board.parse_github_remote("git@github.com:o/r.git"), ("o", "r"))
        self.assertEqual(board.parse_github_remote("https://github.com/o/r.git"), ("o", "r"))
        self.assertEqual(board.parse_github_remote("https://github.com/o/r"), ("o", "r"))
        self.assertEqual(board.parse_github_remote("ssh://git@github.com/o/r.git"), ("o", "r"))
        self.assertEqual(board.parse_github_remote("https://user@github.com/o/r.git"), ("o", "r"))
        self.assertIsNone(board.parse_github_remote("https://gitlab.com/o/r.git"))
        # github.com must be the HOST, not merely present in the path
        self.assertIsNone(board.parse_github_remote("https://git.example.com/github.com/o/r.git"))
        self.assertIsNone(board.parse_github_remote("https://github.com.evil.com/o/r.git"))
        self.assertIsNone(board.parse_github_remote(""))
        self.assertIsNone(board.parse_github_remote(None))

    def test_publish_dedupes_generatedat_only_change(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmpd = Path(tmp)
            origin = tmpd / "origin.git"
            work = tmpd / "work"
            subprocess.run(["git", "init", "--bare", str(origin)], check=True, capture_output=True)
            work.mkdir()
            make_project(work)
            _init_git(work)
            subprocess.run(["git", "-C", str(work), "remote", "add", "origin", str(origin)],
                           check=True, capture_output=True)
            v1 = '<script id="board-data">{"generatedAt":"2026-07-08T10:00:00","x":1}</script>'
            v2 = '<script id="board-data">{"generatedAt":"2026-07-08T23:59:59","x":1}</script>'
            v3 = '<script id="board-data">{"generatedAt":"2026-07-08T23:59:59","x":2}</script>'
            self.assertEqual(board.publish_to_branch(work, {"board.html": v1}, "gh-pages", "p1"), "pushed")
            # only the timestamp changed → no new publish
            self.assertEqual(board.publish_to_branch(work, {"board.html": v2}, "gh-pages", "p2"), "unchanged")
            # real content change → pushed
            self.assertEqual(board.publish_to_branch(work, {"board.html": v3}, "gh-pages", "p3"), "pushed")

    def test_publish_rejects_non_git(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)  # plans/ tree but NOT a git repo
            with self.assertRaises(SystemExit):
                board.publish_pages(root, None)

    def test_publish_rejects_non_github_origin(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            _init_git(root)
            subprocess.run(["git", "-C", str(root), "remote", "add", "origin",
                            "https://gitlab.com/o/r.git"], check=True, capture_output=True)
            with self.assertRaises(SystemExit):
                board.publish_pages(root, None)

    def test_publish_to_branch_push_dedupe_and_isolation(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmpd = Path(tmp)
            origin = tmpd / "origin.git"
            work = tmpd / "work"
            subprocess.run(["git", "init", "--bare", str(origin)], check=True, capture_output=True)
            work.mkdir()
            make_project(work)
            _init_git(work)
            subprocess.run(["git", "-C", str(work), "remote", "add", "origin", str(origin)],
                           check=True, capture_output=True)
            head_before = subprocess.run(
                ["git", "-C", str(work), "rev-parse", "HEAD"],
                capture_output=True, text=True).stdout.strip()

            # first publish → orphan gh-pages carrying both files
            self.assertEqual(
                board.publish_to_branch(work, {"board.html": "<h1>v1</h1>", "index.html": "i"},
                                        "gh-pages", "p1"), "pushed")
            tree = subprocess.run(["git", "-C", str(origin), "ls-tree", "-r", "--name-only",
                                   "gh-pages"], capture_output=True, text=True).stdout
            self.assertIn("board.html", tree)
            self.assertIn("index.html", tree)

            # the working tree and current branch are untouched
            self.assertEqual(
                subprocess.run(["git", "-C", str(work), "rev-parse", "HEAD"],
                               capture_output=True, text=True).stdout.strip(), head_before)
            self.assertFalse((work / "board.html").exists())
            self.assertNotIn(board.TMP_BRANCH_PREFIX,
                             subprocess.run(["git", "-C", str(work), "branch"],
                                            capture_output=True, text=True).stdout)

            # identical content → unchanged; changed content → pushed again
            self.assertEqual(
                board.publish_to_branch(work, {"board.html": "<h1>v1</h1>", "index.html": "i"},
                                        "gh-pages", "p2"), "unchanged")
            self.assertEqual(
                board.publish_to_branch(work, {"board.html": "<h1>v2</h1>", "index.html": "i"},
                                        "gh-pages", "p3"), "pushed")


class TestDrift(unittest.TestCase):
    def test_collect_drift_flags(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)  # seeds a .staging-zz dir and a bundle whose source is absent
            drift = board.collect_payload(root, "static", None)["drift"]
            self.assertIn("01-data-prep", drift["leftoverStaging"])
            self.assertIn("01-data-prep", drift["sourceDrift"])
            self.assertIsNone(drift["staleBoardHtml"])  # no board.html yet

    def test_stale_board_html(self):
        import os
        import time
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            bh = root / "plans" / "board.html"
            bh.write_text("<html></html>", encoding="utf-8")
            future = time.time() + 100
            os.utime(root / "plans" / "master-plan.md", (future, future))
            self.assertTrue(
                board.collect_payload(root, "static", None)["drift"]["staleBoardHtml"])
            os.utime(bh, (future + 200, future + 200))
            self.assertFalse(
                board.collect_payload(root, "static", None)["drift"]["staleBoardHtml"])

    def test_drift_omitted_from_remote_share(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            self.assertNotIn("drift", board.collect_payload(root, "remote", None))


if __name__ == "__main__":
    unittest.main()
