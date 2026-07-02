#!/usr/bin/env python3
"""research-plans sign-off gate (PreToolUse hook for Write|Edit).

Blocks the write of a signed plan version (plans/execution/<slug>/vN.md in an
initialized project) until the researcher approves it on the board in their
browser. Also mechanically enforces version immutability (no edits to, or
overwrites of, an existing vN.md).

Contract: ALL decisions are exit 0 + PreToolUse decision JSON on stdout.
Exit 0 with no output = not gated (normal permission flow).
Escape hatch: RESEARCH_PLANS_NO_GATE=1. Wait ceiling: RESEARCH_PLANS_GATE_TIMEOUT
(seconds, clamped to [30, 1500]; default 1500 — always below the 1800s hook
timeout in hooks.json, because timeout-exceeded hook behavior is undocumented).

Stdlib only, Python 3.9+.
"""

import json
import os
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path

VERSION_RE = re.compile(r"^v(\d+)\.md$")
MASTER_MARKER = "<!-- research-plans:master-plan -->"
CLAUDE_MARKER = "<!-- research-plans:start -->"
DEFAULT_TIMEOUT = 1500
MAX_REASON = 2000


def decide(decision, reason):
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": decision,
                    "permissionDecisionReason": reason,
                }
            }
        )
    )
    sys.exit(0)


def allow(reason):
    decide("allow", reason)


def deny(reason):
    decide("deny", reason)


def gate_timeout():
    raw = os.environ.get("RESEARCH_PLANS_GATE_TIMEOUT", "")
    try:
        val = int(raw)
    except ValueError:
        return DEFAULT_TIMEOUT
    return max(30, min(val, DEFAULT_TIMEOUT))


def find_project_root(path):
    """Walk up from the target file looking for the dual opt-in markers."""
    for parent in path.parents:
        mp = parent / "plans" / "master-plan.md"
        if mp.is_file():
            try:
                if MASTER_MARKER not in mp.read_text(encoding="utf-8", errors="replace"):
                    return None
                cm = parent / "CLAUDE.md"
                if cm.is_file() and CLAUDE_MARKER in cm.read_text(
                    encoding="utf-8", errors="replace"
                ):
                    return parent
            except OSError:
                return None
            return None
    return None


def main():
    raw = sys.stdin.read()
    try:
        event = json.loads(raw)
        tool_name = event.get("tool_name", "")
        tool_input = event.get("tool_input") or {}
        file_path = tool_input.get("file_path", "")
        cwd = event.get("cwd") or os.getcwd()
    except Exception:
        if "/plans/execution/" in raw:
            print(
                "research-plans gate: unparseable hook payload, write not gated",
                file=sys.stderr,
            )
        sys.exit(0)

    if tool_name not in ("Write", "Edit") or not file_path:
        sys.exit(0)

    p = Path(file_path)
    if not p.is_absolute():
        p = Path(cwd) / p
    p = Path(os.path.realpath(str(p)))

    m = VERSION_RE.fullmatch(p.name)
    if (
        m is None
        or p.parent.parent.name != "execution"
        or p.parent.parent.parent.name != "plans"
    ):
        sys.exit(0)
    version = int(m.group(1))
    slug = p.parent.name

    if os.environ.get("RESEARCH_PLANS_NO_GATE", "") == "1":
        print(
            "research-plans: sign-off gate bypassed by RESEARCH_PLANS_NO_GATE for %s"
            % p.name,
            file=sys.stderr,
        )
        sys.exit(0)

    root = find_project_root(p)
    if root is None:
        sys.exit(0)

    # Mechanical immutability: never edit a signed version; never overwrite one.
    if tool_name == "Edit" or (tool_name == "Write" and p.exists()):
        deny(
            "Signed plan versions are immutable — %s already exists. A revision "
            "is a new version: write v%d.md with a 'Supersedes: v%d — <trigger and "
            "change>' line (the amendment record). Never edit or overwrite a "
            "signed version." % (p.name, version + 1, version)
        )

    # The gate: Write to a NEW vN.md.
    content = tool_input.get("file_text")
    if content is None:
        content = tool_input.get("content")
    if content is None:
        deny(
            "Sign-off gate could not read the proposed plan content from the "
            "Write payload. Re-attempt the write; if this persists, set "
            "RESEARCH_PLANS_NO_GATE=1 and report the issue."
        )

    timeout = gate_timeout()
    gate_file = p.parent / (".gate-v%d.md" % version)
    nonce = uuid.uuid4().hex[:12]
    header = "<!-- gate %s -->\n" % json.dumps(
        {"pid": os.getpid(), "nonce": nonce, "ts": time.time()}
    )

    # O_EXCL reservation; stale (older than the gate timeout) files are taken over.
    p.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(str(gate_file), os.O_WRONLY | os.O_CREAT | os.O_EXCL)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(header + content)
    except FileExistsError:
        try:
            age = time.time() - gate_file.stat().st_mtime
        except OSError:
            age = 0
        if age < timeout:
            deny(
                "Another sign-off for %s v%d is already in progress (a gate "
                "opened %ds ago). Wait for it to finish, then re-attempt the "
                "write." % (slug, version, int(age))
            )
        gate_file.write_text(header + content, encoding="utf-8")

    board = Path(__file__).resolve().parent / "board.py"
    try:
        proc = subprocess.run(
            [
                sys.executable,
                str(board),
                "--gate",
                "%s/v%d" % (slug, version),
                "--timeout",
                str(timeout),
            ],
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=timeout + 60,
        )
        code = proc.returncode
        out = (proc.stdout or "").strip()
        err = (proc.stderr or "").strip()
    except subprocess.TimeoutExpired:
        code, out, err = 2, "", "board process exceeded its own timeout"
    finally:
        # Owner-verified cleanup: only remove a reservation this process made.
        try:
            first = gate_file.read_text(encoding="utf-8").split("\n", 1)[0]
            if nonce in first:
                gate_file.unlink()
        except OSError:
            pass

    if code == 0:
        if p.exists():
            deny(
                "%s was created while the sign-off gate was open — that approval "
                "no longer applies. Write v%d.md instead (with a Supersedes "
                "line)." % (p.name, version + 1)
            )
        allow(
            "Researcher approved %s v%d on the board. %s"
            % (slug, version, out.splitlines()[-1] if out else "")
        )
    elif code == 3:
        summary = out.strip()
        if len(summary) > MAX_REASON:
            summary = summary[:MAX_REASON] + "\n[...truncated...]"
        deny(
            "SIGN-OFF NOT APPROVED. The researcher reviewed %s v%d on the board "
            "and requests changes:\n\n%s\n\nFull feedback is saved at "
            "plans/.board-feedback.md — read it before revising. Revise the "
            "draft to address ALL feedback, then attempt the SAME Write again — "
            "the gate will reopen. Do not write the file via shell redirection "
            "or any other path." % (slug, version, summary)
        )
    elif code == 2:
        deny(
            "Sign-off gate timed out — the researcher did not respond in the "
            "browser within %ds. Re-attempt the write when they are ready (the "
            "gate will reopen), or set RESEARCH_PLANS_NO_GATE=1 for headless "
            "work." % timeout
        )
    else:
        deny(
            "Sign-off gate could not open the board (%s). If a board is already "
            "open, press 'Send to Claude' in that tab or close its server, then "
            "attempt the write again." % (err.splitlines()[-1] if err else "exit %d" % code)
        )


if __name__ == "__main__":
    main()
