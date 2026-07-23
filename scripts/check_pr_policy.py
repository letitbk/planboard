#!/usr/bin/env python3
"""Check Planboard pull request version and changelog policy.

The checker reads both revisions from Git objects. It does not depend on which
revision is checked out, so the same command works in pull request and release
workflows.
"""

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path, PurePosixPath
from typing import Dict, Optional, Sequence, Tuple


REPO_ROOT = Path(__file__).resolve().parents[1]
SEMVER_RE = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
RELEASE_HEADING_RE = re.compile(
    r"^## \[(?P<version>[0-9]+\.[0-9]+\.[0-9]+)\] - "
    r"(?P<date>[0-9]{4}-[0-9]{2}-[0-9]{2})[ \t]*$",
    re.MULTILINE,
)
SECTION_RE = re.compile(
    r"^### (?P<name>Added|Changed|Deprecated|Removed|Fixed|Security)[ \t]*$",
    re.MULTILINE,
)
TEST_FILE_RE = re.compile(
    r"(?:^|/)[^/]+\.(?:test|spec)\.(?:js|jsx|ts|tsx)$",
    re.IGNORECASE,
)

MAINTENANCE_FILES = {
    ".gitignore",
    "AGENTS.md",
    "CHANGELOG.md",
    "LICENSE",
    "QUICKSTART.md",
    "README.md",
    "skills/managing-planboard/assets/web-template/.gitignore",
    "skills/managing-planboard/assets/web-template/package-lock.json",
}
VERSION_FILES = (
    ".claude-plugin/plugin.json",
    "board/package.json",
    "board/package-lock.json",
)


class PolicyError(RuntimeError):
    """A release policy condition was not met."""


@dataclass(frozen=True, order=True)
class Version:
    major: int
    minor: int
    patch: int

    @classmethod
    def parse(cls, value: str, label: str) -> "Version":
        match = SEMVER_RE.fullmatch(value)
        if not match:
            raise PolicyError(
                "%s has invalid version %r.\n"
                "Fix: use a plain semantic version such as 1.2.3." % (label, value)
            )
        return cls(*(int(part) for part in match.groups()))

    def __str__(self) -> str:
        return "%d.%d.%d" % (self.major, self.minor, self.patch)


@dataclass(frozen=True)
class PolicyResult:
    base_version: str
    head_version: str
    version_changed: bool
    shipped_paths: Tuple[str, ...]


@dataclass(frozen=True)
class ChangelogEntry:
    version: str
    release_date: str
    body: str


def _run_git(
    repo: Path,
    args: Sequence[str],
    check: bool = True,
) -> subprocess.CompletedProcess:
    process = subprocess.run(
        ["git"] + list(args),
        cwd=str(repo),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if check and process.returncode != 0:
        detail = process.stderr.decode("utf-8", errors="replace").strip()
        raise PolicyError(
            "Git command failed: git %s\n%s" % (" ".join(args), detail)
        )
    return process


def resolve_revision(repo: Path, revision: str) -> str:
    process = _run_git(
        repo,
        ["rev-parse", "--verify", "--end-of-options", revision + "^{commit}"],
    )
    resolved = process.stdout.decode("ascii", errors="strict").strip()
    if not re.fullmatch(r"[0-9a-fA-F]{40,64}", resolved):
        raise PolicyError("Git returned an invalid commit id for %r." % revision)
    return resolved


def git_text(repo: Path, revision: str, path: str) -> str:
    process = _run_git(repo, ["show", "%s:%s" % (revision, path)])
    try:
        return process.stdout.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise PolicyError(
            "%s is not valid UTF-8 at %s.\nFix: save the file as UTF-8."
            % (path, revision)
        ) from exc


def changed_paths(repo: Path, base: str, head: str) -> Tuple[str, ...]:
    process = _run_git(
        repo,
        [
            "diff",
            "--name-only",
            "-z",
            "--no-renames",
            "--diff-filter=ACDMRTUXB",
            "%s...%s" % (base, head),
            "--",
        ],
    )
    paths = process.stdout.decode("utf-8", errors="surrogateescape").split("\0")
    return tuple(sorted(path for path in paths if path))


def is_maintenance_path(path: str) -> bool:
    normalized = PurePosixPath(path).as_posix()
    if normalized in MAINTENANCE_FILES:
        return True
    if normalized == "scripts/check_pr_policy.py":
        return True
    if normalized.startswith(("docs/", ".github/", "tests/")):
        return True
    return TEST_FILE_RE.search(normalized) is not None


def _json_document(repo: Path, revision: str, path: str) -> object:
    try:
        return json.loads(git_text(repo, revision, path))
    except json.JSONDecodeError as exc:
        raise PolicyError(
            "%s is not valid JSON at %s.\nFix: repair the JSON before merging."
            % (path, revision)
        ) from exc


def version_fields(repo: Path, revision: str) -> Dict[str, str]:
    plugin = _json_document(repo, revision, VERSION_FILES[0])
    package = _json_document(repo, revision, VERSION_FILES[1])
    lockfile = _json_document(repo, revision, VERSION_FILES[2])
    try:
        fields = {
            ".claude-plugin/plugin.json:version": plugin["version"],
            "board/package.json:version": package["version"],
            "board/package-lock.json:version": lockfile["version"],
            'board/package-lock.json:packages[""]:version': (
                lockfile["packages"][""]["version"]
            ),
        }
    except (KeyError, TypeError) as exc:
        raise PolicyError(
            "A required version field is missing at %s.\n"
            "Fix: set the version in both manifests and both root lockfile fields."
            % revision
        ) from exc
    if any(not isinstance(value, str) for value in fields.values()):
        raise PolicyError(
            "A required version field is not a string at %s.\n"
            "Fix: use a quoted semantic version in every version field." % revision
        )
    return fields


def require_consistent_versions(fields: Dict[str, str], label: str) -> str:
    if len(set(fields.values())) != 1:
        details = "\n".join(
            "- %s = %s" % (path, value) for path, value in fields.items()
        )
        raise PolicyError(
            "Version files disagree at %s:\n%s\n"
            "Fix: set both manifests and both root lockfile fields to one version."
            % (label, details)
        )
    return next(iter(fields.values()))


def is_next_release(base: Version, head: Version) -> bool:
    next_patch = Version(base.major, base.minor, base.patch + 1)
    next_minor = Version(base.major, base.minor + 1, 0)
    return head in (next_patch, next_minor)


def first_changelog_entry(text: str) -> ChangelogEntry:
    match = RELEASE_HEADING_RE.search(text)
    if not match:
        raise PolicyError(
            "CHANGELOG.md has no release heading.\n"
            "Fix: add ## [X.Y.Z] - YYYY-MM-DD as the first release entry."
        )
    tail = text[match.end() :]
    next_heading = re.search(r"^## ", tail, re.MULTILINE)
    body = tail[: next_heading.start()] if next_heading else tail
    return ChangelogEntry(
        version=match.group("version"),
        release_date=match.group("date"),
        body=body.strip() + "\n",
    )


def validate_changelog(text: str, expected_version: str) -> ChangelogEntry:
    entry = first_changelog_entry(text)
    if entry.version != expected_version:
        raise PolicyError(
            "The first CHANGELOG.md release is %s, not %s.\n"
            "Fix: add %s as the first release entry."
            % (entry.version, expected_version, expected_version)
        )
    try:
        parsed_date = date.fromisoformat(entry.release_date)
    except ValueError as exc:
        raise PolicyError(
            "CHANGELOG.md has invalid release date %s.\n"
            "Fix: use a real date in YYYY-MM-DD form." % entry.release_date
        ) from exc
    if parsed_date.isoformat() != entry.release_date:
        raise PolicyError(
            "CHANGELOG.md has invalid release date %s.\n"
            "Fix: use a real date in YYYY-MM-DD form." % entry.release_date
        )

    section_has_bullet = False
    matches = list(SECTION_RE.finditer(entry.body))
    for section in matches:
        remaining = entry.body[section.end() :]
        next_heading = re.search(r"^### ", remaining, re.MULTILINE)
        end = (
            section.end() + next_heading.start()
            if next_heading
            else len(entry.body)
        )
        section_body = entry.body[section.end() : end]
        if re.search(r"^- .+", section_body, re.MULTILINE):
            section_has_bullet = True
            break
    if not section_has_bullet:
        raise PolicyError(
            "CHANGELOG.md release %s has no bullet under a standard section.\n"
            "Fix: add a bullet under Added, Changed, Fixed, Removed, Deprecated, "
            "or Security." % expected_version
        )
    return entry


def tag_exists(repo: Path, version: str) -> bool:
    process = _run_git(
        repo,
        ["show-ref", "--verify", "--quiet", "refs/tags/v" + version],
        check=False,
    )
    return process.returncode == 0


def check_policy(base_ref: str, head_ref: str, repo: Path = REPO_ROOT) -> PolicyResult:
    repo = repo.resolve()
    base = resolve_revision(repo, base_ref)
    head = resolve_revision(repo, head_ref)
    paths = changed_paths(repo, base, head)
    shipped = tuple(path for path in paths if not is_maintenance_path(path))

    base_fields = version_fields(repo, base)
    head_fields = version_fields(repo, head)
    base_value = require_consistent_versions(base_fields, "base revision")
    version_changed = base_fields != head_fields

    if shipped and not version_changed:
        listed = "\n".join("- " + path for path in shipped[:10])
        raise PolicyError(
            "Shipped code changed, but the version remains %s:\n%s\n"
            "Fix: use the next patch version, or the next minor version for a "
            "larger feature, and add its CHANGELOG.md entry."
            % (base_value, listed)
        )

    if not version_changed:
        head_value = require_consistent_versions(head_fields, "head revision")
        return PolicyResult(base_value, head_value, False, shipped)

    head_value = require_consistent_versions(head_fields, "head revision")
    base_version = Version.parse(base_value, "base revision")
    head_version = Version.parse(head_value, "head revision")
    if not is_next_release(base_version, head_version):
        raise PolicyError(
            "Version %s is not the next patch or next minor after %s.\n"
            "Fix: use %d.%d.%d for a patch or %d.%d.0 for a larger feature."
            % (
                head_version,
                base_version,
                base_version.major,
                base_version.minor,
                base_version.patch + 1,
                base_version.major,
                base_version.minor + 1,
            )
        )

    changelog = git_text(repo, head, "CHANGELOG.md")
    validate_changelog(changelog, head_value)
    if not tag_exists(repo, base_value):
        raise PolicyError(
            "Base version %s has no Git tag v%s.\n"
            "Fix: restore or create the base release tag before merging this release."
            % (base_value, base_value)
        )
    return PolicyResult(base_value, head_value, True, shipped)


def write_github_output(path: Path, result: PolicyResult) -> None:
    with path.open("a", encoding="utf-8") as output:
        output.write("version_changed=%s\n" % str(result.version_changed).lower())
        output.write("version=%s\n" % result.head_version)
        output.write("tag=v%s\n" % result.head_version)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check Planboard pull request version and changelog policy."
    )
    parser.add_argument("base", help="Base Git revision")
    parser.add_argument("head", help="Head Git revision")
    parser.add_argument(
        "--github-output",
        type=Path,
        help="Append release values to a GitHub Actions output file.",
    )
    parser.add_argument(
        "--notes-file",
        type=Path,
        help="Write the new release's changelog body to this file.",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    try:
        result = check_policy(args.base, args.head)
        if args.github_output:
            write_github_output(args.github_output, result)
        if args.notes_file and result.version_changed:
            head = resolve_revision(REPO_ROOT, args.head)
            entry = validate_changelog(
                git_text(REPO_ROOT, head, "CHANGELOG.md"), result.head_version
            )
            args.notes_file.write_text(entry.body, encoding="utf-8")
    except PolicyError as exc:
        print("Release policy failed.\n\n%s" % exc, file=sys.stderr)
        return 1

    if result.version_changed:
        print(
            "Release policy passed: %s -> %s."
            % (result.base_version, result.head_version)
        )
    else:
        print(
            "Release policy passed: maintenance change at %s."
            % result.head_version
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
