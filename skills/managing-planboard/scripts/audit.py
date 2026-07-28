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
import shutil
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


CODEX_MODELS = {
    "codex-sol": "gpt-5.6-sol",
    "codex-terra": "gpt-5.6-terra",
    "codex-luna": "gpt-5.6-luna",
}
REPAIR_SUFFIX = (
    "\n\nYour previous reply could not be used. Reply with ONLY the JSON "
    "object described in the output contract — no prose before or after it, "
    "and every finding carrying its severity tag and evidence.\n"
)


def reviewer_payload_problem(payload):
    """None when a reviewer payload satisfies the three-key contract, else a
    short reason. Shares its rules with _validate so a payload that passes here
    cannot fail at write time — the reviewer gets a repair re-prompt instead of
    a lost audit."""
    if not isinstance(payload, dict):
        return "not an object"
    if not isinstance(payload.get("overall"), str) or not payload["overall"].strip():
        return "missing 'overall'"
    for bucket in ("anchored", "gaps"):
        if not isinstance(payload.get(bucket), list):
            return "'%s' is not a list" % bucket
        for finding in payload[bucket]:
            if not isinstance(finding, dict) or not isinstance(finding.get("comment"), str):
                return "a finding has no string 'comment'"
            if not any(finding["comment"].startswith(s) for s in SEVERITIES):
                return "a finding has no severity tag"
            ev = finding.get("evidence")
            if not isinstance(ev, dict) or not ev.get("path") or not ev.get("detail"):
                return "a finding has no evidence path and detail"
            if ev.get("kind") not in ("direct", "inferred"):
                return "a finding's evidence has no valid kind"
            if bucket == "anchored" and not finding.get("quote"):
                return "an anchored finding has no quote"
    return None


def build_prompt(plan_text, plan_path, root, contract):
    """The audit prompt. Written to a FILE by the caller and passed with a
    shell-safe substitution, never interpolated into a command line — a plan
    containing backticks or $(...) must not be shell-expanded."""
    return (
        "<task>\n"
        "Audit ONE execution plan for technical correctness against this repository.\n"
        "You are NOT scoring it. A separate reviewer scores it as a governance\n"
        "contract. Your question: executed as written, against this repository and\n"
        "this data, will this plan produce what it claims?\n\n"
        "Plan path: %s\n"
        "Repository root: %s\n"
        "</task>\n\n"
        "<plan>\n%s\n</plan>\n\n"
        "%s\n"
    ) % (plan_path, root, plan_text, contract)


def _scan_object(text, end):
    """Return the balanced object ending at `end`, or None. Scans FORWARD from
    each candidate start so string and escape state is tracked in the direction
    the grammar is written — a backward scan cannot tell an escaped quote from
    a real one."""
    start = text.rfind("{", 0, end + 1)
    while start != -1:
        depth = 0
        in_str = False
        esc = False
        for i in range(start, end + 1):
            ch = text[i]
            if esc:
                esc = False
            elif in_str:
                if ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    if i == end:
                        try:
                            return json.loads(text[start:end + 1])
                        except ValueError:
                            break
                    break
        start = text.rfind("{", 0, start)
    return None


def parse_reviewer_json(text):
    """The LAST balanced JSON object in reviewer output. Reviewers wrap their
    answer in prose, so a first-match scan picks up the wrong object."""
    end = text.rfind("}")
    while end != -1:
        got = _scan_object(text, end)
        if got is not None:
            return got
        end = text.rfind("}", 0, end)
    return None


def run_codex_audit(root, token, effort, prompt_path, out_path, _which=None, _run=None):
    """Dispatch Codex read-only, with exactly one repair re-prompt when the
    reply is unparseable OR violates the contract. Returns ok=False with a
    reason on every failure mode so the caller can fall back to
    pb-plan-auditor. The audit is never silently skipped: a skipped audit reads
    as a clean bill of health."""
    which = _which or shutil.which
    runner = _run or subprocess.run
    if which("codex") is None:
        return {"ok": False, "reason": "codex is not available on PATH", "payload": None}
    model = CODEX_MODELS.get(token)
    if model is None:
        return {"ok": False, "reason": "%r is not a codex reviewer token" % token,
                "payload": None}

    prompt = prompt_path.read_text(encoding="utf-8")
    last = "no parseable JSON object"
    for attempt in (0, 1):
        cmd = [
            "codex", "exec", "--sandbox", "read-only",
            "-m", model,
            "-c", "model_reasoning_effort=%s" % effort,
            "-o", str(out_path),
            prompt if attempt == 0 else prompt + REPAIR_SUFFIX,
        ]
        try:
            proc = runner(cmd, cwd=str(root), capture_output=True, text=True,
                          timeout=1800, stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            return {"ok": False, "reason": "codex timed out after 30 minutes",
                    "payload": None}
        except OSError as e:
            return {"ok": False, "reason": "could not launch codex (%s)" % e,
                    "payload": None}
        if proc.returncode != 0:
            return {"ok": False,
                    "reason": "codex exited %d: %s" % (proc.returncode,
                                                       (proc.stderr or "")[:200]),
                    "payload": None}
        try:
            text = Path(out_path).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as e:
            return {"ok": False, "reason": "could not read codex output (%s)" % e,
                    "payload": None}
        payload = parse_reviewer_json(text)
        # The repair must fire on a CONTRACT violation, not only on unparseable
        # text. A well-formed object missing `overall`, or carrying a finding
        # with no severity tag or no evidence, is exactly what one re-prompt is
        # meant to fix; returning ok=True here would surface it later as a
        # write failure and a lost audit.
        problem = None if payload is None else reviewer_payload_problem(payload)
        if payload is not None and problem is None:
            return {"ok": True, "reason": "", "payload": payload}
        last = problem or "no parseable JSON object"
    return {"ok": False,
            "reason": "codex output did not satisfy the contract after one repair (%s)" % last,
            "payload": None}
