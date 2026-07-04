#!/usr/bin/env python3
"""research-plans board: serve or export the project board.

Stdlib only, Python 3.9+. Modes:
  (default)          serve the live board; block until feedback; print it to stdout
  --export [PATH]    write a static read-only snapshot (default plans/board.html)
  --collect          print and delete pending feedback from an interrupted session

Exit codes: 0 feedback delivered / export written / pending collected;
1 usage or environment error; 2 timeout with no feedback; 3 nothing to collect;
130 cancelled.
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import threading
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SLOT = '<script id="board-data" type="application/json">{}</script>'
SLOT_OPEN = '<script id="board-data" type="application/json">'
GITIGNORE_LINES = [
    "/.board-feedback.md",
    "/.board.lock",
    "/execution/*/.draft-v*.md",
    "/execution/*/.gate-*.md",
]


def die(msg, code=1):
    print("board: %s" % msg, file=sys.stderr)
    sys.exit(code)


def find_root():
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=10,
        )
        if out.returncode == 0 and out.stdout.strip():
            return Path(out.stdout.strip())
    except Exception:
        pass
    return Path.cwd()


def git_info(root, paths):
    info = {"available": False}
    try:
        head = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, cwd=str(root), timeout=10,
        )
        if head.returncode != 0:
            return info
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, cwd=str(root), timeout=10,
        )
        info = {
            "available": True,
            "head": head.stdout.strip(),
            "branch": branch.stdout.strip() if branch.returncode == 0 else "",
            "fileDates": {},
        }
        for rel in paths:
            try:
                last = subprocess.run(
                    ["git", "log", "-1", "--format=%cI", "--", rel],
                    capture_output=True, text=True, cwd=str(root), timeout=10,
                )
                first = subprocess.run(
                    ["git", "log", "--reverse", "--format=%cI", "--", rel],
                    capture_output=True, text=True, cwd=str(root), timeout=10,
                )
                dates = {}
                if last.returncode == 0 and last.stdout.strip():
                    dates["lastCommit"] = last.stdout.strip()
                if first.returncode == 0 and first.stdout.strip():
                    dates["firstCommit"] = first.stdout.strip().splitlines()[0]
                if dates:
                    info["fileDates"][rel] = dates
            except Exception:
                continue
    except Exception:
        return {"available": False}
    return info


def read_file(root, rel):
    p = root / rel
    return {"path": rel, "content": p.read_text(encoding="utf-8", errors="replace")}


def payload_files(payload):
    """Every embedded plan file in the payload, mirroring the client's allFiles()."""
    f = payload["files"]
    out = [f["masterPlan"], f["decisionLog"]]
    for g in f["executionPlans"]:
        out.extend(g["versions"])
        if g.get("draft"):
            out.append(g["draft"])
    out.extend(f["reviews"])
    return out


def share_hash(files):
    """sha256 over sorted (path, content) pairs; first 16 hex chars.
    Python-only contract: --share stamps it, --collect recomputes it.
    The client never computes this hash, it only echoes it back."""
    h = hashlib.sha256()
    for f in sorted(files, key=lambda x: x["path"]):
        h.update(f["path"].encode("utf-8"))
        h.update(b"\x00")
        h.update(f["content"].encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()[:16]


def collect_payload(root, mode, focus):
    plans = root / "plans"
    if not (plans / "master-plan.md").is_file():
        die("no plans/master-plan.md under %s — run /research-plans:init first" % root)

    exec_groups = []
    exec_dir = plans / "execution"
    if exec_dir.is_dir():
        for comp_dir in sorted(p for p in exec_dir.iterdir() if p.is_dir()):
            versions = []
            for f in sorted(comp_dir.glob("v*.md")):
                m = re.fullmatch(r"v(\d+)\.md", f.name)
                if not m:
                    continue
                entry = read_file(root, str(f.relative_to(root)))
                entry["version"] = int(m.group(1))
                versions.append(entry)
            versions.sort(key=lambda v: v["version"])
            group = {"component": comp_dir.name, "versions": versions}
            if mode == "live":
                drafts = sorted(comp_dir.glob(".draft-v*.md"))
                if drafts:
                    d = drafts[-1]
                    m = re.fullmatch(r"\.draft-v(\d+)\.md", d.name)
                    entry = read_file(root, str(d.relative_to(root)))
                    entry["proposedVersion"] = int(m.group(1)) if m else (
                        (versions[-1]["version"] + 1) if versions else 1
                    )
                    group["draft"] = entry
            if versions or group.get("draft"):
                exec_groups.append(group)

    reviews = []
    reviews_dir = plans / "reviews"
    if reviews_dir.is_dir():
        for f in sorted(reviews_dir.glob("*.md")):
            reviews.append(read_file(root, str(f.relative_to(root))))

    decision_log = (
        read_file(root, "plans/decision-log.md")
        if (plans / "decision-log.md").is_file()
        else {"path": "plans/decision-log.md", "content": "# Decision Log\n"}
    )

    all_paths = ["plans/master-plan.md", "plans/decision-log.md"]
    for g in exec_groups:
        all_paths.extend(v["path"] for v in g["versions"])
    all_paths.extend(r["path"] for r in reviews)

    payload = {
        "schemaVersion": 1,
        "generatedAt": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "mode": mode,
        "focus": focus,
        "project": {"name": root.name},
        "git": git_info(root, all_paths),
        "files": {
            "masterPlan": read_file(root, "plans/master-plan.md"),
            "decisionLog": decision_log,
            "executionPlans": exec_groups,
            "reviews": reviews,
        },
    }
    if mode == "live":
        payload["project"]["root"] = str(root)
    return payload


def inject(template, payload):
    if template.count(SLOT) != 1:
        if template.count(SLOT_OPEN) == 1:
            # Slot present but non-empty (shouldn't happen with our build);
            # replace between the open tag and the next </script>.
            start = template.index(SLOT_OPEN) + len(SLOT_OPEN)
            end = template.index("</script>", start)
            blob = json.dumps(payload).replace("<", "\\u003c")
            return template[:start] + blob + template[end:]
        die("board template is corrupt: expected exactly one data slot")
    blob = json.dumps(payload).replace("<", "\\u003c")
    return template.replace(SLOT, SLOT_OPEN + blob + "</script>")


def template_path():
    p = Path(__file__).resolve().parent.parent / "assets" / "board-template.html"
    if not p.is_file():
        die("board template missing at %s — reinstall the research-plans plugin" % p)
    return p


def ensure_gitignore(plans_dir):
    gi = plans_dir / ".gitignore"
    existing = gi.read_text(encoding="utf-8").splitlines() if gi.is_file() else []
    missing = [l for l in GITIGNORE_LINES if l not in existing]
    if missing:
        content = existing + missing
        gi.write_text("\n".join(content).strip() + "\n", encoding="utf-8")


def acquire_lock(plans_dir, force):
    lock = plans_dir / ".board.lock"
    if lock.is_file():
        try:
            pid = int(lock.read_text().strip())
        except Exception:
            pid = None
        alive = False
        if pid is not None:
            try:
                os.kill(pid, 0)
                alive = True
            except ProcessLookupError:
                alive = False
            except PermissionError:
                alive = True
            except OSError:
                alive = False
        if alive and not force:
            die(
                "another board is open (PID %s); close it or pass --force" % pid,
                code=1,
            )
    lock.write_text(str(os.getpid()), encoding="utf-8")
    return lock


def build_feedback_document(body, payload):
    feedback_md = body.get("feedbackMarkdown") or "# Board Feedback\n\n(no markdown)"
    meta = {
        "sessionId": str(uuid.uuid4()),
        "generatedAt": payload["generatedAt"],
        "mode": payload["mode"],
        "focus": payload["focus"],
        "payloadHash": body.get("payloadHash", ""),
        "annotations": body.get("annotations", []),
    }
    return (
        feedback_md.rstrip()
        + "\n\n```json board-feedback\n"
        + json.dumps(meta, indent=1)
        + "\n```\n"
    )


def serve(root, payload, args):
    plans_dir = root / "plans"
    ensure_gitignore(plans_dir)
    lock = acquire_lock(plans_dir, args.force)

    gate_mode = payload.get("gate") is not None
    html = inject(template_path().read_text(encoding="utf-8"), payload)
    html_bytes = html.encode("utf-8")
    done = threading.Event()
    result = {}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):  # quiet
            pass

        def _json(self, code, obj):
            blob = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(blob)))
            self.end_headers()
            self.wfile.write(blob)

        def do_GET(self):
            if self.path == "/api/health":
                self._json(200, {"ok": True, "app": "research-plans-board"})
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html_bytes)))
            self.end_headers()
            self.wfile.write(html_bytes)

        def _read_body(self):
            length = int(self.headers.get("Content-Length", "0"))
            return json.loads(self.rfile.read(length).decode("utf-8")) if length else {}

        def do_POST(self):
            if self.path == "/api/feedback" and not gate_mode:
                try:
                    body = self._read_body()
                except Exception:
                    self.send_response(400)
                    self.end_headers()
                    return
                doc = build_feedback_document(body, payload)
                # File FIRST (survives a dead parent bash call), then unblock.
                (plans_dir / ".board-feedback.md").write_text(doc, encoding="utf-8")
                result["doc"] = doc
                result["exit"] = 0
                self._json(200, {"ok": True})
                done.set()
                return
            if self.path == "/api/approve" and gate_mode:
                try:
                    body = self._read_body()
                except Exception:
                    body = {}
                comment = (body.get("comment") or "").strip()
                doc = "APPROVED: %s v%d" % (
                    payload["gate"]["component"],
                    payload["gate"]["proposedVersion"],
                )
                if comment:
                    doc += "\nResearcher comment: %s" % comment
                result["doc"] = doc
                result["exit"] = 0
                self._json(200, {"ok": True})
                done.set()
                return
            if self.path == "/api/deny" and gate_mode:
                try:
                    body = self._read_body()
                except Exception:
                    self.send_response(400)
                    self.end_headers()
                    return
                doc = build_feedback_document(body, payload)
                (plans_dir / ".board-feedback.md").write_text(doc, encoding="utf-8")
                result["doc"] = doc
                result["exit"] = 3
                self._json(200, {"ok": True})
                done.set()
                return
            self.send_response(404)
            self.end_headers()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    url = "http://127.0.0.1:%d" % port
    print("Board: %s" % url, file=sys.stderr)
    if not args.no_open:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    signal.signal(signal.SIGTERM, lambda *a: (_ for _ in ()).throw(SystemExit(130)))

    try:
        got = done.wait(timeout=args.timeout)
        server.shutdown()
        if not got:
            print("board: no feedback received within %ds" % args.timeout, file=sys.stderr)
            sys.exit(2)
        print(result["doc"])
        sys.exit(result.get("exit", 0))
    except KeyboardInterrupt:
        server.shutdown()
        sys.exit(130)
    finally:
        try:
            lock.unlink()
        except OSError:
            pass


def export(root, args):
    payload = collect_payload(root, "static", args.focus)
    html = inject(template_path().read_text(encoding="utf-8"), payload)
    out = Path(args.export) if args.export != "DEFAULT" else root / "plans" / "board.html"
    if not out.is_absolute():
        out = root / out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    ensure_gitignore(root / "plans")
    print(str(out))
    print(
        "Reminder: this file snapshots everything under plans/ — sharing or "
        "committing it is publishing those contents.",
        file=sys.stderr,
    )
    sys.exit(0)


def collect_pending(root):
    pending = root / "plans" / ".board-feedback.md"
    if not pending.is_file():
        print("No pending feedback.", file=sys.stderr)
        sys.exit(3)
    print(pending.read_text(encoding="utf-8"))
    pending.unlink()
    sys.exit(0)


def apply_gate(root, payload, gate_spec):
    """gate_spec is '<slug>/vN'. Reads the proposal from .gate-vN.md (skipping
    the reservation header comment) and injects it as the component's draft."""
    m = re.fullmatch(r"(.+)/v(\d+)", gate_spec)
    if not m:
        die("--gate expects <component-slug>/vN")
    slug, version = m.group(1), int(m.group(2))
    gate_file = root / "plans" / "execution" / slug / (".gate-v%d.md" % version)
    if not gate_file.is_file():
        die("gate proposal missing at %s" % gate_file)
    lines = gate_file.read_text(encoding="utf-8").split("\n")
    if lines and lines[0].startswith("<!-- gate"):
        lines = lines[1:]
    content = "\n".join(lines)

    payload["gate"] = {"component": slug, "proposedVersion": version}
    payload["focus"] = slug
    groups = payload["files"]["executionPlans"]
    group = next((g for g in groups if g["component"] == slug), None)
    if group is None:
        group = {"component": slug, "versions": []}
        groups.append(group)
    group["draft"] = {
        "proposedVersion": version,
        "path": "plans/execution/%s/.gate-v%d.md" % (slug, version),
        "content": content,
    }
    return payload


def main():
    ap = argparse.ArgumentParser(description="research-plans board")
    ap.add_argument("--focus", default=None, metavar="NN-slug")
    ap.add_argument("--export", nargs="?", const="DEFAULT", default=None, metavar="PATH")
    ap.add_argument("--collect", action="store_true")
    ap.add_argument("--gate", default=None, metavar="SLUG/vN")
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--timeout", type=int, default=3600, metavar="SECONDS")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    root = find_root()
    if not (root / "plans" / "master-plan.md").is_file():
        # find_root may have picked a git root above a non-initialized cwd
        if (Path.cwd() / "plans" / "master-plan.md").is_file():
            root = Path.cwd()
        else:
            die("no plans/master-plan.md found — run /research-plans:init first")

    if args.collect:
        collect_pending(root)
    elif args.export is not None:
        export(root, args)
    else:
        payload = collect_payload(root, "live", args.focus)
        if args.gate:
            payload = apply_gate(root, payload, args.gate)
        serve(root, payload, args)


if __name__ == "__main__":
    main()
