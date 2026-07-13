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

import hashlib
import json
import os
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path

VERSION_RE = re.compile(r"^v(\d+)\.md$")
RESULTS_RE = re.compile(r"/plans/execution/([^/]+)/results/(r\d+)/")
MASTER_MARKER = "<!-- research-plans:master-plan -->"
CLAUDE_MARKER = "<!-- research-plans:start -->"
TICKET_PREFIX = ".import-approved-"
DEFAULT_TIMEOUT = 1500
MAX_REASON = 2000


def normalize_plan(text):
    """Canonical plan text for hashing, invariant to the sign-off trailer.

    A `.draft-vN.md` is unsigned; the final `vN.md` gets a `Signed off:` line (and
    a `---` rule) appended at write time. Stripping that trailer plus trailing
    whitespace makes normalize(draft) == normalize(signed), so a batch-approval
    ticket hashed over the draft authorizes the signed write. Board and gate MUST
    use this same function."""
    lines = [ln.rstrip() for ln in text.replace("\r\n", "\n").split("\n")]
    while lines and lines[-1] == "":
        lines.pop()
    if lines and lines[-1].startswith("Signed off:"):
        lines.pop()
        while lines and lines[-1] == "":
            lines.pop()
        if lines and lines[-1] == "---":
            lines.pop()
    while lines and lines[-1] == "":
        lines.pop()
    return "\n".join(lines) + "\n"


def check_ticket(ticket, slug, version, content):
    """Validate a batch-approval ticket for a new vN.md write. Returns
    (decision, reason). Never opens the interactive board — a present-but-invalid
    ticket fast-denies with a precise fix, so a bulk write loop cannot silently
    pop an unattended browser gate."""
    try:
        doc = json.loads(ticket.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return "deny", (
            "Approval ticket %s is unreadable or corrupt. Have the researcher "
            "re-approve %s v%d on the board — their Approve writes a fresh "
            "ticket (the draft must still exist at plans/execution/%s/"
            ".draft-v%d.md)." % (ticket.name, slug, version, slug, version))
    if doc.get("slug") != slug or doc.get("version") != version:
        return "deny", (
            "Batch ticket %s does not match %s v%d (slug/version mismatch). "
            "Re-approve this plan on the board." % (ticket.name, slug, version))
    exp = doc.get("expiry")
    if isinstance(exp, (int, float)) and time.time() > exp:
        return "deny", (
            "Approval for %s v%d has expired. Have the researcher re-approve "
            "the current draft on the board." % (slug, version))
    got = hashlib.sha256(normalize_plan(content).encode("utf-8")).hexdigest()
    if doc.get("contentHash") != got:
        return "deny", (
            "The draft for %s v%d changed since it was approved (content-hash "
            "mismatch). Have the researcher re-approve the current draft on "
            "the board." % (slug, version))
    return "allow", (
        "Batch-approved: %s v%d approved by %s in batch %s at %s (ticket %s; left "
        "in place — inert once v%d.md exists)." % (
            slug, version, doc.get("approver", "researcher"), doc.get("batchId", "?"),
            doc.get("approvedAt", "?"), ticket.name, version))


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

    # ---- Results-bundle immutability (synchronous file policy; NEVER opens
    # the board — a browser gate here would deadlock capture). ----
    res_m = RESULTS_RE.search(str(p))
    if res_m:
        if os.environ.get("RESEARCH_PLANS_NO_GATE", "") == "1":
            print(
                "research-plans: results immutability bypassed by "
                "RESEARCH_PLANS_NO_GATE for %s" % p.name,
                file=sys.stderr,
            )
            sys.exit(0)
        if find_project_root(p) is None:
            sys.exit(0)
        bundle_dir = Path(str(p)[: res_m.end()].rstrip("/"))
        if p.name == "verdict.json" and p.parent == bundle_dir:
            if tool_name == "Write" and not p.exists():
                allow(
                    "One-time verdict for %s %s. Prefer results.py verdict "
                    "(it stamps date and reviewer)." % (res_m.group(1), res_m.group(2))
                )
            deny(
                "verdict.json is written once and never edited. The verdict for "
                "%s %s is already recorded; a redo is a NEW bundle (results.py "
                "stage/finalize), not an edit." % (res_m.group(1), res_m.group(2))
            )
        if bundle_dir.is_dir():
            deny(
                "Finalized results bundles are immutable — %s %s already exists. "
                "Capture a new bundle instead: results.py stage --component %s, "
                "copy artifacts, write manifest.json and report.md in the staging "
                "dir, then results.py finalize."
                % (res_m.group(1), res_m.group(2), res_m.group(1))
            )
        deny(
            "Results bundles are created by results.py finalize (staging, "
            "validation, atomic rename), never by direct writes into %s. Use "
            "results.py stage --component %s and write into the .staging-* dir."
            % (res_m.group(2), res_m.group(1))
        )

    # ---- Archived master plans are immutable (the renewal record). Pure file
    # policy like the results branch — never opens a browser. Creation (the
    # renewal's own archive write) is allowed; edits and overwrites are denied. ----
    if p.parent.name == "archive" and p.parent.parent.name == "plans":
        if os.environ.get("RESEARCH_PLANS_NO_GATE", "") == "1":
            print(
                "research-plans: archive immutability bypassed by "
                "RESEARCH_PLANS_NO_GATE for %s" % p.name,
                file=sys.stderr,
            )
            sys.exit(0)
        if find_project_root(p) is None:
            sys.exit(0)
        if tool_name == "Edit" or p.exists():
            deny(
                "Archived master plans are immutable — %s is the record of a "
                "direction this project renewed away from. /research-plans:renew "
                "creates archives; nothing edits them." % p.name
            )
        sys.exit(0)

    # ---- Batch-approval ticket forgery guard. Tickets (.import-approved-*) are
    # written ONLY by board.py --gate-batch (a subprocess, outside the agent's
    # Write/Edit tools). A direct agent write here would forge sign-off — deny it
    # inside the gate's own enforcement domain. ----
    if (
        p.name.startswith(TICKET_PREFIX)
        and p.parent.name == "execution"
        and p.parent.parent.name == "plans"
    ):
        if find_project_root(p) is not None:
            deny(
                "Batch approval tickets (%s*) are created only by the board's "
                "batch sign-off flow (board.py --gate-batch), never written "
                "directly. Approve plans on the board; the ticket is written for "
                "you." % TICKET_PREFIX
            )
        sys.exit(0)

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

    # ---- Batch sign-off ticket: if the researcher pre-approved this exact plan
    # on the board's --gate-batch pass, the ticket authorizes the write without
    # reopening the browser. A present-but-invalid ticket fast-denies (never
    # opens the interactive gate); an absent ticket falls through to it. ----
    ticket = p.parent.parent / ("%s%s-v%d" % (TICKET_PREFIX, slug, version))
    if ticket.exists():
        decision, reason = check_ticket(ticket, slug, version, content)
        if decision == "allow":
            allow(reason)  # H3: leave the ticket; immutability blocks any re-use
        deny(reason)

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
        # Persist the proposal as the component's working draft so the
        # persistent board can display and approve it — a timed-out gate must
        # leave a durable recovery path (the in-board Approve mints a ticket
        # over this draft; normalize_plan makes it admit the signed write).
        draft = p.parent / (".draft-v%d.md" % version)
        saved = ""
        try:
            draft.write_text(content, encoding="utf-8")
            saved = (" The proposed plan has been saved as "
                     "plans/execution/%s/.draft-v%d.md." % (slug, version))
        except OSError:
            pass
        deny(
            "Sign-off gate timed out — no approval arrived within %ds.%s "
            "Do NOT bypass the gate and do NOT use --gate-batch. Instead, "
            "relaunch the board for this component via the "
            "/research-plans:board workflow and tell the researcher the draft "
            "awaits their Approve there. Approving mints a durable ticket, and "
            "the board workflow's routing then performs the ticketed v%d.md "
            "write — do not re-attempt the Write separately before that "
            "approval round-trip." % (timeout, saved, version)
        )
    else:
        deny(
            "Sign-off gate could not open the board (%s). If a board is already "
            "open, press 'Send to Claude' in that tab or close its server, then "
            "attempt the write again." % (err.splitlines()[-1] if err else "exit %d" % code)
        )


if __name__ == "__main__":
    main()
