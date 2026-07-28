"""Audit identity, artifact writing, and reviewer dispatch for the planboard
audit channel. Standard library only.

The audit channel answers "will this plan actually work?" against the
repository, separately from the rubric scorecard, which answers "is this a
checkable contract?" from the plan text alone. See
docs/specs/2026-07-24-plan-audit-channel-design.md.
"""
import errno
import hashlib
import json
import os
import stat
import subprocess
import tempfile
import time
from pathlib import Path

from signoff_gate import normalize_plan, strip_trailer


def audit_plan_hash(text):
    """The audit's plan identity.

    Composes strip_trailer with normalize_plan so the hash is invariant across
    BOTH canonical trailers. normalize_plan alone strips only `Signed off:`, so
    an audit taken on a draft would go stale the moment /sync appends
    `Amendment recorded`. Composing them means one audit survives sign-off AND
    the amendment write.
    """
    return hashlib.sha256(
        normalize_plan(strip_trailer(text)).encode("utf-8")
    ).hexdigest()


def _git_head(root):
    """Current HEAD sha, or None outside a git repo or in one with no commits."""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(root), capture_output=True, text=True, timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def context_identity(root, evidence_paths):
    """Identity of the repository state an audit's findings rest on.

    Scoped to the paths the audit's own evidence cites, NOT a whole-worktree
    fingerprint: during active work the tree is always dirty, so a broad
    fingerprint would invalidate every audit immediately and the cache would
    buy nothing. A missing path hashes to None, which is a real observation
    (the audit saw it absent), not a failure.
    """
    root = Path(root).resolve()
    paths = {}
    for rel in evidence_paths:
        p = (root / rel).resolve()
        if p != root and root not in p.parents:
            raise ValueError("evidence path escapes the repository: %s" % rel)
        paths[rel] = hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None
    return {"head": _git_head(root), "paths": paths}


SCHEMA_VERSION = 1
REQUIRED_KEYS = (
    "schemaVersion", "component", "planVersion", "planPath", "date", "reviewer",
    "auditPlanHash", "contextIdentity", "supersedes",
    "overall", "anchored", "gaps", "dispositions",
)
SEVERITIES = ("[blocker]", "[major]", "[minor]")


class AuditLocked(Exception):
    """Raised when another audit run holds this component-version's lock, or
    when a write would clobber a current audit that already carries
    dispositions."""


def audit_path(root, component, version):
    return Path(root) / "plans" / "reviews" / ("%s-v%d-audit.md" % (component, version))


class audit_lock:
    """Exclusive per-component-and-version lock, so two runs for the same plan
    cannot interleave their writes. O_CREAT|O_EXCL is atomic on every platform
    the board already supports.

    A crashed writer must not lock the component out forever, so an existing
    lock is reclaimed when its owner is gone: os.kill(pid, 0) to test the
    process, plus an age ceiling for a stale file whose pid has been recycled.
    """

    STALE_AFTER = 3600  # a reviewer run is capped at 30 minutes

    def __init__(self, root, component, version):
        self.path = Path(root) / "plans" / "reviews" / (
            ".%s-v%d-audit.lock" % (component, version))

    def _owner_is_gone(self):
        try:
            pid_s, ts_s = self.path.read_text(encoding="utf-8").split()
            pid, ts = int(pid_s), float(ts_s)
        except (OSError, ValueError):
            return True  # unreadable or truncated — treat as abandoned
        if time.time() - ts > self.STALE_AFTER:
            return True
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        except PermissionError:
            return False  # alive, owned by another user
        except OSError:
            return False
        return False

    def _acquire(self):
        fd = os.open(str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        with os.fdopen(fd, "w") as f:
            f.write("%d %f\n" % (os.getpid(), time.time()))

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self._acquire()
        except OSError as e:
            if e.errno != errno.EEXIST:
                raise
            if not self._owner_is_gone():
                raise AuditLocked("another audit run holds %s" % self.path.name)
            try:
                self.path.unlink()
                self._acquire()
            except OSError:
                # Another process reclaimed it first — it is live, not stale.
                raise AuditLocked("another audit run holds %s" % self.path.name)
        return self

    def __exit__(self, *exc):
        try:
            self.path.unlink()
        except OSError:
            pass
        return False


def _validate(payload):
    missing = [k for k in REQUIRED_KEYS if k not in payload]
    if missing:
        raise ValueError("audit payload missing keys: %s" % ", ".join(missing))
    for bucket in ("anchored", "gaps", "dispositions"):
        if not isinstance(payload[bucket], list):
            raise ValueError("audit payload '%s' must be a list" % bucket)
    for bucket in ("anchored", "gaps"):
        for finding in payload[bucket]:
            if not isinstance(finding, dict) or not isinstance(finding.get("comment"), str):
                raise ValueError("every finding needs a string 'comment'")
            if not any(finding["comment"].startswith(s) for s in SEVERITIES):
                raise ValueError("finding has no severity tag: %r" % finding["comment"][:60])
            ev = finding.get("evidence")
            if not isinstance(ev, dict) or not ev.get("path"):
                raise ValueError(
                    "finding has no evidence path: %r" % finding["comment"][:60])
            if ev.get("kind") not in ("direct", "inferred"):
                # Defaulting a missing kind to "direct" would render an
                # unverified claim as one the reviewer confirmed by reading.
                raise ValueError(
                    "finding evidence has no valid kind: %r" % finding["comment"][:60])
            if not ev.get("detail"):
                raise ValueError(
                    "finding evidence has no detail: %r" % finding["comment"][:60])
            if bucket == "anchored" and not finding.get("quote"):
                raise ValueError(
                    "anchored finding has no quote: %r" % finding["comment"][:60])


def _counts(payload):
    counts = {"blocker": 0, "major": 0, "minor": 0}
    for finding in list(payload["anchored"]) + list(payload["gaps"]):
        for sev in counts:
            if finding["comment"].startswith("[%s]" % sev):
                counts[sev] += 1
    return counts


def _severity_key(finding):
    for i, s in enumerate(SEVERITIES):
        if finding["comment"].startswith(s):
            return i
    return len(SEVERITIES)


def render_audit(payload):
    """The artifact: prose a human reads, then the fence the board parses."""
    counts = _counts(payload)
    # The plan lives at plans/execution/<component>/<file>; this artifact lives
    # at plans/reviews/, so the link is ../execution/... — matching
    # templates/review-scorecard.md.
    plan_file = payload["planPath"].rsplit("/", 1)[-1]
    link = "../execution/%s/%s" % (payload["component"], plan_file)
    lines = [
        "# Audit — %s v%s" % (payload["component"], payload["planVersion"]),
        "",
        "Plan: [%s](%s) · Reviewer: **%s** · Date: %s"
        % (plan_file, link, payload["reviewer"].get("token", "?"), payload["date"]),
        "Findings: **%d blocker · %d major · %d minor**"
        % (counts["blocker"], counts["major"], counts["minor"]),
        "",
        "## Overall",
        "",
        payload["overall"],
        "",
    ]
    for label, bucket in (("Anchored", "anchored"), ("Gaps", "gaps")):
        lines += ["## %s" % label, ""]
        if not payload[bucket]:
            lines += ["None.", ""]
            continue
        for finding in sorted(payload[bucket], key=_severity_key):
            ev = finding.get("evidence") or {}
            lines.append("- %s" % finding["comment"])
            if finding.get("quote"):
                lines.append('  - quote: "%s"' % finding["quote"])
            lines.append("  - evidence: `%s` (%s) — %s"
                         % (ev.get("path", ""), ev.get("kind", "direct"),
                            ev.get("detail", "")))
        lines.append("")
    lines += ["## Data", "", "```json board-audit",
              json.dumps(payload, indent=1, sort_keys=True), "```"]
    return "\n".join(lines) + "\n"


def _atomic_write(target, text):
    mode = stat.S_IMODE(target.stat().st_mode) if target.exists() else 0o644
    fd, tmpname = tempfile.mkstemp(dir=str(target.parent), prefix=target.name + ".",
                                   suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        os.chmod(tmpname, mode)
        os.replace(tmpname, target)
    except BaseException:
        try:
            os.unlink(tmpname)
        except OSError:
            pass
        raise


def write_audit(root, component, version, payload):
    """Validate, then atomically replace this component-version's audit under
    the per-component lock.

    Validation runs BEFORE any file is touched, so a malformed payload can
    never leave a partial fence for a reader. An existing audit with the same
    FULL identity — plan hash AND context identity — that already carries
    dispositions is never replaced: those dispositions were made about exactly
    this text against exactly this repository state, and a background run
    returning late must not silently discard them. Comparing the plan hash
    alone would wrongly refuse a genuinely newer audit taken at a new HEAD.

    `supersedes` is stamped from the read INSIDE the lock, so it always names
    the artifact this write actually replaces.
    """
    payload.setdefault("schemaVersion", SCHEMA_VERSION)
    _validate(payload)
    target = audit_path(root, component, version)
    target.parent.mkdir(parents=True, exist_ok=True)
    with audit_lock(root, component, version):
        existing = read_audit(root, component, version)
        if existing and existing.get("dispositions"):
            same_identity = (
                existing.get("auditPlanHash") == payload.get("auditPlanHash")
                and existing.get("contextIdentity") == payload.get("contextIdentity")
            )
            if same_identity:
                raise AuditLocked(
                    "audit for %s v%s already carries dispositions at this identity"
                    % (component, version))
        payload["supersedes"] = (existing or {}).get("auditPlanHash")
        _atomic_write(target, render_audit(payload))
    return target


def read_audit(root, component, version):
    p = audit_path(root, component, version)
    if not p.is_file():
        return None
    try:
        raw = p.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    marker = "```json board-audit"
    start = raw.find(marker)
    if start < 0:
        return None
    body = raw[start + len(marker):]
    end = body.find("```")
    if end < 0:
        return None
    try:
        return json.loads(body[:end])
    except ValueError:
        return None


def is_current(audit_record, plan_text, root):
    """Current iff BOTH identities match: the plan text AND the repository
    state the findings rest on. Plan text alone is not enough — an audit that
    confirmed a path exists goes wrong when that path is renamed with the plan
    untouched."""
    if not audit_record:
        return False
    if audit_record.get("auditPlanHash") != audit_plan_hash(plan_text):
        return False
    recorded = audit_record.get("contextIdentity") or {}
    fresh = context_identity(root, list((recorded.get("paths") or {}).keys()))
    return ((recorded.get("paths") or {}) == fresh["paths"]
            and recorded.get("head") == fresh["head"])
