"""Audit identity, artifact writing, and reviewer dispatch for the planboard
audit channel. Standard library only.

The audit channel answers "will this plan actually work?" against the
repository, separately from the rubric scorecard, which answers "is this a
checkable contract?" from the plan text alone. See
docs/specs/2026-07-24-plan-audit-channel-design.md.
"""
import hashlib
import subprocess
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
