"""Tests for the pull request release policy checker."""

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "check_pr_policy", REPO / "scripts" / "check_pr_policy.py"
)
policy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(policy)


class TemporaryPolicyRepo:
    def __init__(self):
        self._temp = tempfile.TemporaryDirectory()
        self.root = Path(self._temp.name)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Planboard Tests")
        self.git("config", "user.email", "tests@example.com")
        self.git("config", "commit.gpgsign", "false")
        self.git("config", "tag.gpgsign", "false")
        self.set_versions("1.0.0")
        self.write(
            "CHANGELOG.md",
            "# Changelog\n\n"
            "## [1.0.0] - 2026-07-23\n\n"
            "### Changed\n"
            "- Initial release.\n",
        )
        self.write("src/app.py", "print('base')\n")
        self.base = self.commit("base")
        self.git("tag", "-a", "v1.0.0", "-m", "v1.0.0")

    def cleanup(self):
        self._temp.cleanup()

    def git(self, *args):
        process = subprocess.run(
            ["git"] + list(args),
            cwd=str(self.root),
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        return process.stdout.strip()

    def write(self, relative, content):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def write_json(self, relative, value):
        self.write(relative, json.dumps(value, indent=2) + "\n")

    def set_versions(self, version, plugin=None, package=None, lock=None, root=None):
        self.write_json(
            ".claude-plugin/plugin.json",
            {"name": "planboard", "version": plugin or version},
        )
        self.write_json(
            "board/package.json",
            {"name": "planboard-board", "version": package or version},
        )
        self.write_json(
            "board/package-lock.json",
            {
                "name": "planboard-board",
                "version": lock or version,
                "lockfileVersion": 3,
                "packages": {
                    "": {
                        "name": "planboard-board",
                        "version": root or version,
                    }
                },
            },
        )

    def add_release(self, version, release_date="2026-07-23", body=None):
        old = (self.root / "CHANGELOG.md").read_text(encoding="utf-8")
        body = body or "### Fixed\n- A shipped change.\n"
        entry = "## [%s] - %s\n\n%s\n" % (version, release_date, body)
        self.write("CHANGELOG.md", "# Changelog\n\n" + entry + old.split("\n\n", 1)[1])

    def commit(self, message):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message)
        return self.git("rev-parse", "HEAD")

    def make_release(self, version, source="print('changed')\n"):
        self.set_versions(version)
        self.add_release(version)
        self.write("src/app.py", source)
        return self.commit("release " + version)


class CheckPullRequestPolicy(unittest.TestCase):
    def setUp(self):
        self.repo = TemporaryPolicyRepo()
        self.addCleanup(self.repo.cleanup)

    def check(self, head):
        return policy.check_policy(self.repo.base, head, self.repo.root)

    def test_documentation_only_change_keeps_version(self):
        self.repo.write("docs/note.md", "Documentation only.\n")
        result = self.check(self.repo.commit("docs"))
        self.assertFalse(result.version_changed)
        self.assertEqual(result.shipped_paths, ())

    def test_test_only_change_keeps_version(self):
        self.repo.write("board/src/app.test.ts", "export {};\n")
        result = self.check(self.repo.commit("test"))
        self.assertFalse(result.version_changed)
        self.assertEqual(result.shipped_paths, ())

    def test_hosted_board_lockfile_refresh_keeps_version(self):
        self.repo.write(
            "skills/managing-planboard/assets/web-template/.gitignore",
            "node_modules/\n",
        )
        self.repo.write(
            "skills/managing-planboard/assets/web-template/package-lock.json",
            "{}\n",
        )
        result = self.check(self.repo.commit("hosted board lockfile"))
        self.assertFalse(result.version_changed)
        self.assertEqual(result.shipped_paths, ())

    def test_next_patch_release_passes(self):
        result = self.check(self.repo.make_release("1.0.1"))
        self.assertTrue(result.version_changed)
        self.assertEqual(result.head_version, "1.0.1")
        self.assertIn("src/app.py", result.shipped_paths)

    def test_next_minor_release_passes(self):
        result = self.check(self.repo.make_release("1.1.0"))
        self.assertTrue(result.version_changed)
        self.assertEqual(result.head_version, "1.1.0")

    def test_shipped_change_without_bump_fails(self):
        self.repo.write("src/app.py", "print('collision')\n")
        head = self.repo.commit("code without release")
        with self.assertRaisesRegex(policy.PolicyError, "Shipped code changed"):
            self.check(head)

    def test_skipped_version_fails(self):
        head = self.repo.make_release("1.0.2")
        with self.assertRaisesRegex(policy.PolicyError, "next patch or next minor"):
            self.check(head)

    def test_mismatched_version_files_fail(self):
        self.repo.set_versions("1.0.1", package="1.0.0")
        self.repo.add_release("1.0.1")
        self.repo.write("src/app.py", "print('mismatch')\n")
        head = self.repo.commit("mismatch")
        with self.assertRaisesRegex(policy.PolicyError, "Version files disagree"):
            self.check(head)

    def test_missing_base_tag_fails(self):
        self.repo.git("tag", "-d", "v1.0.0")
        head = self.repo.make_release("1.0.1")
        with self.assertRaisesRegex(policy.PolicyError, "has no Git tag"):
            self.check(head)

    def test_missing_new_changelog_entry_fails(self):
        self.repo.set_versions("1.0.1")
        self.repo.write("src/app.py", "print('missing notes')\n")
        head = self.repo.commit("missing changelog")
        with self.assertRaisesRegex(policy.PolicyError, "first CHANGELOG.md release"):
            self.check(head)

    def test_malformed_changelog_date_fails(self):
        self.repo.set_versions("1.0.1")
        self.repo.add_release("1.0.1", release_date="2026-99-99")
        self.repo.write("src/app.py", "print('bad date')\n")
        head = self.repo.commit("bad date")
        with self.assertRaisesRegex(policy.PolicyError, "invalid release date"):
            self.check(head)

    def test_changelog_requires_a_standard_section_with_a_bullet(self):
        self.repo.set_versions("1.0.1")
        self.repo.add_release("1.0.1", body="A paragraph with no section.\n")
        self.repo.write("src/app.py", "print('no bullet')\n")
        head = self.repo.commit("no changelog bullet")
        with self.assertRaisesRegex(policy.PolicyError, "no bullet"):
            self.check(head)

    def test_bullet_under_another_heading_does_not_count(self):
        self.repo.set_versions("1.0.1")
        self.repo.add_release(
            "1.0.1",
            body="### Fixed\nNo release bullet.\n\n### Notes\n- Not a release section.\n",
        )
        self.repo.write("src/app.py", "print('wrong section')\n")
        head = self.repo.commit("wrong changelog section")
        with self.assertRaisesRegex(policy.PolicyError, "no bullet"):
            self.check(head)

    def test_maintenance_release_bump_uses_full_release_rules(self):
        self.repo.set_versions("1.0.1")
        self.repo.add_release("1.0.1")
        self.repo.write("docs/note.md", "Release note correction.\n")
        result = self.check(self.repo.commit("maintenance release"))
        self.assertTrue(result.version_changed)
        self.assertNotIn("docs/note.md", result.shipped_paths)
        self.assertIn(".claude-plugin/plugin.json", result.shipped_paths)

    def test_release_notes_are_the_first_entry_body(self):
        head = self.repo.make_release("1.0.1")
        result = self.check(head)
        resolved = policy.resolve_revision(self.repo.root, head)
        entry = policy.validate_changelog(
            policy.git_text(self.repo.root, resolved, "CHANGELOG.md"),
            result.head_version,
        )
        self.assertEqual(entry.body, "### Fixed\n- A shipped change.\n")

    def test_github_outputs_include_release_state(self):
        result = self.check(self.repo.make_release("1.0.1"))
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "github-output"
            policy.write_github_output(output, result)
            self.assertEqual(
                output.read_text(encoding="utf-8"),
                "version_changed=true\nversion=1.0.1\ntag=v1.0.1\n",
            )


if __name__ == "__main__":
    unittest.main()
