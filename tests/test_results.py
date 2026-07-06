# tests/test_results.py
"""Tests for results.py bundle mechanics. Run:
    python3 -m unittest tests.test_results -v
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = (
    Path(__file__).resolve().parents[1]
    / "skills" / "managing-research-plans" / "scripts"
)
RESULTS = SCRIPTS / "results.py"
sys.path.insert(0, str(SCRIPTS))
import results  # noqa: E402


def make_project(root: Path):
    plans = root / "plans"
    (plans / "execution" / "02-analysis").mkdir(parents=True)
    (plans / "master-plan.md").write_text(
        "<!-- research-plans:master-plan -->\n# T — Master Plan\n\n"
        "## Components\n\n"
        "| # | Component | Status | Execution plan | Outcome / notes | Serves |\n"
        "|---|-----------|--------|----------------|-----------------|--------|\n"
        "| 1 | Analysis | done | [v1](execution/02-analysis/v1.md) | — | — |\n",
        encoding="utf-8",
    )
    (plans / "execution" / "02-analysis" / "v1.md").write_text(
        "# Analysis — Execution Plan v1\n\n## Goal and success criteria\n\nG.\n",
        encoding="utf-8",
    )
    out = root / "output"
    out.mkdir()
    (out / "fig1.png").write_bytes(b"\x89PNG fake image bytes")
    (out / "table1.csv").write_text("a,b\n1,2\n", encoding="utf-8")
    code = root / "code"
    code.mkdir()
    (code / "03_model.R").write_text("lm(y ~ x)\n", encoding="utf-8")
    return plans


def run_cli(cwd, *argv):
    return subprocess.run(
        [sys.executable, str(RESULTS), *argv],
        capture_output=True, text=True, cwd=str(cwd), timeout=60,
    )


def manifest_for(staging: Path, component="02-analysis", version=1, entries=None):
    return {
        "schemaVersion": 1,
        "component": component,
        "resultsVersion": version,
        "planVersion": 1,
        "provenance": "planned",
        "trigger": "initial",
        "capturedAt": "2026-07-03 12:00",
        "summary": "test bundle",
        "metrics": [{"label": "N", "value": "10"}],
        "artifacts": entries or [],
    }


class TestStageCopyFinalize(unittest.TestCase):
    def _stage(self, root):
        p = run_cli(root, "stage", "--component", "02-analysis")
        self.assertEqual(p.returncode, 0, p.stderr)
        staging = Path(p.stdout.strip())
        self.assertTrue(staging.is_dir())
        self.assertTrue(staging.name.startswith(".staging-"))
        self.assertTrue((staging / "artifacts").is_dir())
        self.assertTrue((staging / "scripts").is_dir())
        return staging

    def test_stage_copy_finalize_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            staging = self._stage(root)
            p = run_cli(root, "copy", "--staging", str(staging),
                        "--into", "artifacts", "output/fig1.png", "output/table1.csv")
            self.assertEqual(p.returncode, 0, p.stderr)
            recs = json.loads(p.stdout)
            self.assertEqual(recs[0]["file"], "artifacts/fig1.png")
            self.assertFalse(recs[0]["oversized"])
            self.assertEqual(recs[0]["sha256"],
                             results.sha256_file(root / "output" / "fig1.png"))
            p2 = run_cli(root, "copy", "--staging", str(staging),
                         "--into", "scripts", "code/03_model.R")
            self.assertEqual(p2.returncode, 0, p2.stderr)
            arts = [
                {"id": "fig", "kind": "figure", "title": "F",
                 "file": "artifacts/fig1.png",
                 "source": {"path": "output/fig1.png",
                            "sha256": recs[0]["sha256"],
                            "bytes": recs[0]["bytes"], "oversized": False},
                 "producedBy": {"script": "scripts/03_model.R",
                                "sourcePath": "code/03_model.R", "lang": "r"}},
            ]
            (staging / "manifest.json").write_text(
                json.dumps(manifest_for(staging, entries=arts)), encoding="utf-8")
            (staging / "report.md").write_text("# Report\n\nDone.\n", encoding="utf-8")
            p3 = run_cli(root, "finalize", "--staging", str(staging))
            self.assertEqual(p3.returncode, 0, p3.stderr)
            out = json.loads(p3.stdout)
            self.assertEqual(out["resultsVersion"], 1)
            r1 = root / "plans" / "execution" / "02-analysis" / "results" / "r1"
            self.assertTrue((r1 / "manifest.json").is_file())
            self.assertTrue((r1 / "artifacts" / "fig1.png").is_file())
            self.assertFalse(staging.exists())

    def test_finalize_numbers_sequentially(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            for expected in (1, 2):
                staging = self._stage(root)
                (staging / "manifest.json").write_text(
                    json.dumps(manifest_for(staging, version=99)), encoding="utf-8")
                (staging / "report.md").write_text("# R\n", encoding="utf-8")
                p = run_cli(root, "finalize", "--staging", str(staging))
                self.assertEqual(p.returncode, 0, p.stderr)
                self.assertEqual(json.loads(p.stdout)["resultsVersion"], expected)
            # finalize rewrote the manifest's resultsVersion to the real number
            m = json.loads((root / "plans" / "execution" / "02-analysis" /
                            "results" / "r2" / "manifest.json").read_text())
            self.assertEqual(m["resultsVersion"], 2)

    def test_finalize_rejects_missing_artifact_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            staging = self._stage(root)
            arts = [{"id": "x", "kind": "figure", "title": "X",
                     "file": "artifacts/nope.png",
                     "source": {"path": "output/nope.png", "sha256": "0" * 64,
                                "bytes": 1, "oversized": False},
                     "producedBy": None}]
            (staging / "manifest.json").write_text(
                json.dumps(manifest_for(staging, entries=arts)), encoding="utf-8")
            (staging / "report.md").write_text("# R\n", encoding="utf-8")
            p = run_cli(root, "finalize", "--staging", str(staging))
            self.assertEqual(p.returncode, 1)
            self.assertIn("nope.png", p.stderr)

    def test_finalize_rejects_missing_manifest_or_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            staging = self._stage(root)
            p = run_cli(root, "finalize", "--staging", str(staging))
            self.assertEqual(p.returncode, 1)

    def test_copy_applies_size_cap(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            big = root / "output" / "big.png"
            big.write_bytes(b"\0" * (results.MAX_BYTES + 1))
            staging = self._stage(root)
            p = run_cli(root, "copy", "--staging", str(staging),
                        "--into", "artifacts", "output/big.png")
            rec = json.loads(p.stdout)[0]
            self.assertIsNone(rec["file"])
            self.assertTrue(rec["oversized"])
            self.assertFalse((staging / "artifacts" / "big.png").exists())


class TestDiscoverVerdictChanged(unittest.TestCase):
    def test_discover_lists_outputs_excludes_plans(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            r1 = root / "plans" / "execution" / "02-analysis" / "results" / "r1" / "artifacts"
            r1.mkdir(parents=True)
            (r1 / "old.png").write_bytes(b"x")
            p = run_cli(root, "discover")
            self.assertEqual(p.returncode, 0, p.stderr)
            paths = [e["path"] for e in json.loads(p.stdout)]
            self.assertIn("output/fig1.png", paths)
            self.assertIn("output/table1.csv", paths)
            self.assertFalse(any(x.startswith("plans/") for x in paths))

    def _finalized(self, root):
        p = run_cli(root, "stage", "--component", "02-analysis")
        staging = Path(p.stdout.strip())
        p = run_cli(root, "copy", "--staging", str(staging),
                    "--into", "artifacts", "output/fig1.png")
        rec = json.loads(p.stdout)[0]
        arts = [{"id": "fig", "kind": "figure", "title": "F",
                 "file": "artifacts/fig1.png",
                 "source": {"path": "output/fig1.png", "sha256": rec["sha256"],
                            "bytes": rec["bytes"], "oversized": False},
                 "producedBy": None}]
        (staging / "manifest.json").write_text(
            json.dumps(manifest_for(staging, entries=arts)), encoding="utf-8")
        (staging / "report.md").write_text("# R\n", encoding="utf-8")
        run_cli(root, "finalize", "--staging", str(staging))

    def test_verdict_written_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            self._finalized(root)
            p = run_cli(root, "verdict", "--component", "02-analysis",
                        "--version", "1", "--status", "accepted",
                        "--reviewer", "BK", "--plan-version", "1")
            self.assertEqual(p.returncode, 0, p.stderr)
            vp = (root / "plans" / "execution" / "02-analysis" / "results" /
                  "r1" / "verdict.json")
            doc = json.loads(vp.read_text())
            self.assertEqual(doc["status"], "accepted")
            self.assertEqual(doc["reviewer"], "BK")
            p2 = run_cli(root, "verdict", "--component", "02-analysis",
                         "--version", "1", "--status", "accepted",
                         "--reviewer", "BK")
            self.assertEqual(p2.returncode, 1)
            self.assertIn("once", p2.stderr)

    def test_changed_detects_source_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            self._finalized(root)
            p = run_cli(root, "changed", "--component", "02-analysis")
            self.assertEqual(json.loads(p.stdout)["changed"], [])
            (root / "output" / "fig1.png").write_bytes(b"different bytes")
            p2 = run_cli(root, "changed", "--component", "02-analysis")
            out = json.loads(p2.stdout)
            self.assertEqual(out["latest"], 1)
            self.assertEqual(out["changed"][0]["path"], "output/fig1.png")


class TestDiscoverBroaden(unittest.TestCase):
    def test_discover_finds_broadened_default_dirs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            (root / "plots").mkdir()
            (root / "plots" / "p.png").write_bytes(b"x")
            (root / "viz").mkdir()
            (root / "viz" / "v.svg").write_text("<svg/>", encoding="utf-8")
            p = run_cli(root, "discover")
            self.assertEqual(p.returncode, 0, p.stderr)
            paths = [e["path"] for e in json.loads(p.stdout)]
            self.assertIn("plots/p.png", paths)
            self.assertIn("viz/v.svg", paths)

    def test_discover_dir_adds_repo_relative_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            (root / "custom" / "sub").mkdir(parents=True)
            (root / "custom" / "sub" / "c.png").write_bytes(b"x")
            p0 = run_cli(root, "discover")
            self.assertNotIn("custom/sub/c.png",
                             [e["path"] for e in json.loads(p0.stdout)])
            p = run_cli(root, "discover", "--dir", "custom")
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertIn("custom/sub/c.png",
                          [e["path"] for e in json.loads(p.stdout)])

    def test_discover_dir_rejects_absolute(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            p = run_cli(root, "discover", "--dir", "/tmp")
            self.assertEqual(p.returncode, 1)
            self.assertIn("--dir", p.stderr)

    def test_discover_dir_rejects_parent_escape(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            p = run_cli(root, "discover", "--dir", "../escape")
            self.assertEqual(p.returncode, 1)

    def test_discover_dir_rejects_symlink_escape(self):
        with tempfile.TemporaryDirectory() as tmp, \
                tempfile.TemporaryDirectory() as outside:
            root = Path(tmp)
            make_project(root)
            target = Path(outside) / "secret"
            target.mkdir()
            (target / "s.png").write_bytes(b"x")
            (root / "link").symlink_to(target)
            p = run_cli(root, "discover", "--dir", "link")
            self.assertEqual(p.returncode, 1)


if __name__ == "__main__":
    unittest.main()
