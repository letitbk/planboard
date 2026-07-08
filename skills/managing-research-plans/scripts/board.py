#!/usr/bin/env python3
"""research-plans board: serve or export the project board.

Stdlib only, Python 3.9+. Modes:
  (default)          serve the live board; block until feedback; print it to stdout
  --export [PATH]    write a static read-only snapshot (default plans/board.html)
  --share [PATH]     write an annotatable remote board for collaborators
                     (default plans/board-share.html; --focus prunes to one component)
  --publish          push the static board to the repo's GitHub Pages (gh-pages)
  --collect          print and delete pending feedback from an interrupted session
  --collect FILE     print a collaborator's feedback file (never deletes it;
                     stderr notes STALE if plans changed since the share)

Exit codes: 0 feedback delivered / export or share written / feedback collected;
1 usage or environment error; 2 timeout with no feedback; 3 nothing to collect;
130 cancelled.
"""

import argparse
import base64
import datetime
import hashlib
import json
import mimetypes
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Share the gate's plan normalization so a batch ticket's hash (over the unsigned
# draft) matches the gate's hash (over the signed vN.md write). Must not drift.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from signoff_gate import normalize_plan  # noqa: E402

TICKET_TTL = 7 * 24 * 3600  # 7 days — sized to a resumable multi-session adoption

SLOT = '<script id="board-data" type="application/json">{}</script>'
SLOT_OPEN = '<script id="board-data" type="application/json">'
GITIGNORE_LINES = [
    "/.board-feedback.md",
    "/.board.lock",
    "/board-share.html",
    "/execution/*/.draft-v*.md",
    "/execution/*/.gate-*.md",
    "/execution/.import-approved-*",
    "/execution/*/results/.staging-*/",
]

FENCE_RE = re.compile(r"```json board-feedback\n(.*?)\n```", re.DOTALL)


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
        out.extend(g.get("draftSnapshots", []))
        if g.get("draft"):
            out.append(g["draft"])
        for b in g.get("results", []):
            out.append(b["manifestRaw"])
            if b.get("report"):
                out.append(b["report"])
            if b.get("verdictRaw"):
                out.append(b["verdictRaw"])
            out.extend(b.get("scripts", []))
    out.extend(f["reviews"])
    if f.get("history"):
        out.append(f["history"])
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


def collect_results(root, comp_dir):
    bundles = []
    res_dir = comp_dir / "results"
    if not res_dir.is_dir():
        return bundles
    for rdir in sorted(res_dir.iterdir()):
        m = re.fullmatch(r"r(\d+)", rdir.name)
        if not m or not rdir.is_dir():
            continue
        manifest_p = rdir / "manifest.json"
        if not manifest_p.is_file():
            continue
        try:
            manifest = json.loads(manifest_p.read_text(encoding="utf-8"))
        except ValueError:
            manifest = None
        bundle = {
            "resultsVersion": int(m.group(1)),
            "dir": str(rdir.relative_to(root)),
            "manifest": manifest,
            "manifestRaw": read_file(root, str(manifest_p.relative_to(root))),
            "report": None,
            "verdict": None,
            "verdictRaw": None,
            "scripts": [],
            "assets": {},
        }
        if (rdir / "report.md").is_file():
            bundle["report"] = read_file(root, str((rdir / "report.md").relative_to(root)))
        vp = rdir / "verdict.json"
        if vp.is_file():
            bundle["verdictRaw"] = read_file(root, str(vp.relative_to(root)))
            try:
                bundle["verdict"] = json.loads(bundle["verdictRaw"]["content"])
            except ValueError:
                bundle["verdict"] = None
        sdir = rdir / "scripts"
        if sdir.is_dir():
            for sf in sorted(sdir.iterdir()):
                if sf.is_file():
                    bundle["scripts"].append(read_file(root, str(sf.relative_to(root))))
        bundles.append(bundle)
    bundles.sort(key=lambda b: b["resultsVersion"])
    return bundles


TEXT_INLINE_EXTS = {".csv", ".md", ".html", ".txt", ".tsv", ".tex", ".json"}
TEXT_INLINE_MAX = 200 * 1024


def iter_bundles(payload):
    for g in payload["files"]["executionPlans"]:
        for b in g.get("results", []):
            yield g["component"], b


def build_assets(root, payload):
    """Fill bundle['assets'] (basename -> URL) and artifact inlineText."""
    live = payload["mode"] == "live"
    for component, b in iter_bundles(payload):
        adir = root / b["dir"] / "artifacts"
        if not adir.is_dir():
            continue
        for f in sorted(adir.iterdir()):
            if not f.is_file():
                continue
            if live:
                b["assets"][f.name] = "/artifact/%s/r%d/%s" % (
                    component, b["resultsVersion"], f.name)
            else:
                mime = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
                data = base64.b64encode(f.read_bytes()).decode("ascii")
                b["assets"][f.name] = "data:%s;base64,%s" % (mime, data)
        if b.get("manifest") and isinstance(b["manifest"].get("artifacts"), list):
            for art in b["manifest"]["artifacts"]:
                fp = art.get("file")
                if not fp:
                    continue
                p = root / b["dir"] / fp
                if (p.is_file() and p.suffix.lower() in TEXT_INLINE_EXTS
                        and p.stat().st_size <= TEXT_INLINE_MAX):
                    art["inlineText"] = p.read_text(encoding="utf-8", errors="replace")


def artifact_map(root, payload):
    """Route path -> absolute file path, built ONLY from files on disk."""
    amap = {}
    for component, b in iter_bundles(payload):
        adir = root / b["dir"] / "artifacts"
        if not adir.is_dir():
            continue
        for f in sorted(adir.iterdir()):
            if f.is_file():
                amap["/artifact/%s/r%d/%s" % (component, b["resultsVersion"], f.name)] = f
    return amap


def split_focus(focus):
    if not focus:
        return None, None
    m = re.fullmatch(r"(.+):r(\d+)", focus)
    if m:
        return m.group(1), int(m.group(2))
    return focus, None


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
            if mode in ("live", "remote"):
                drafts = sorted(comp_dir.glob(".draft-v*.md"))
                if drafts:
                    d = drafts[-1]
                    m = re.fullmatch(r"\.draft-v(\d+)\.md", d.name)
                    entry = read_file(root, str(d.relative_to(root)))
                    entry["proposedVersion"] = int(m.group(1)) if m else (
                        (versions[-1]["version"] + 1) if versions else 1
                    )
                    group["draft"] = entry
            # Committed within-version draft iterations (feature #1). Unlike the
            # ephemeral working draft above, these are real history and ride in
            # every mode. Named vN-draft-K.md — never matched by the sign-off
            # gate's version regex, so they stay plain committed files.
            snapshots = []
            for f in sorted(comp_dir.glob("v*-draft-*.md")):
                m = re.fullmatch(r"v(\d+)-draft-(\d+)\.md", f.name)
                if not m:
                    continue
                entry = read_file(root, str(f.relative_to(root)))
                entry["version"] = int(m.group(1))
                entry["iteration"] = int(m.group(2))
                snapshots.append(entry)
            snapshots.sort(key=lambda s: (s["version"], s["iteration"]))
            if snapshots:
                group["draftSnapshots"] = snapshots
            group["results"] = collect_results(root, comp_dir)
            if (
                versions
                or group.get("draft")
                or group.get("draftSnapshots")
                or group["results"]
            ):
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
    # Reconstructed pre-adoption history — present only when the project has one,
    # so a project without it keeps a byte-identical payload/share hash.
    history = (
        read_file(root, "plans/history.md")
        if (plans / "history.md").is_file()
        else None
    )

    if mode == "remote" and focus:
        exec_groups = [g for g in exec_groups if g["component"] == focus]
        if not exec_groups:
            die("no execution plans found for --focus %s" % focus)
        reviews = []
        decision_log = {
            "path": "plans/decision-log.md",
            "content": "# Decision Log\n\n(omitted from focused share)\n",
        }
        # history is whole-project material — withhold it from a focused share,
        # exactly like the decision log.
        if history is not None:
            history = {
                "path": "plans/history.md",
                "content": "# Reconstructed History\n\n(omitted from focused share)\n",
            }

    all_paths = ["plans/master-plan.md", "plans/decision-log.md"]
    for g in exec_groups:
        all_paths.extend(v["path"] for v in g["versions"])
        all_paths.extend(s["path"] for s in g.get("draftSnapshots", []))
        all_paths.extend(b["manifestRaw"]["path"] for b in g.get("results", []))
    all_paths.extend(r["path"] for r in reviews)
    if history is not None:
        all_paths.append("plans/history.md")

    payload = {
        "schemaVersion": 2,
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
            **({"history": history} if history is not None else {}),
        },
    }
    if mode == "live":
        payload["project"]["root"] = str(root)
    elif mode == "remote":
        payload["shareHash"] = share_hash(payload_files(payload))
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


def document_from_body(body, payload):
    """Prefer the client-assembled feedback document (schemaVersion 1 clients
    send feedbackDocument); fall back to server-side assembly for older
    templates and the gate flow."""
    doc = body.get("feedbackDocument")
    if isinstance(doc, str) and doc.strip():
        return doc
    return build_feedback_document(body, payload)


def serve(root, payload, args):
    plans_dir = root / "plans"
    ensure_gitignore(plans_dir)
    lock = acquire_lock(plans_dir, args.force)

    gate_mode = payload.get("gate") is not None
    batch_mode = payload.get("gateBatch") is not None
    batch_id = uuid.uuid4().hex[:8]
    amap = artifact_map(root, payload)
    html = inject(template_path().read_text(encoding="utf-8"), payload)
    html_bytes = html.encode("utf-8")
    done = threading.Event()
    result = {"approved": [], "rejected": []}

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
            if self.path.startswith("/artifact/"):
                f = amap.get(self.path)
                if f is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                data = f.read_bytes()
                mime = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
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
                doc = document_from_body(body, payload)
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
                doc = document_from_body(body, payload)
                (plans_dir / ".board-feedback.md").write_text(doc, encoding="utf-8")
                result["doc"] = doc
                result["exit"] = 3
                self._json(200, {"ok": True})
                done.set()
                return
            # ---- Batch sign-off wizard: each approval writes its ticket NOW
            # (incremental persistence); the session ends only on /api/batch/done. ----
            if self.path == "/api/batch/approve" and batch_mode:
                try:
                    body = self._read_body()
                except Exception:
                    self.send_response(400)
                    self.end_headers()
                    return
                comp, ver = body.get("component"), body.get("proposedVersion")
                entry = next(
                    (e for e in payload["gateBatch"]
                     if e["component"] == comp and e["proposedVersion"] == ver),
                    None,
                )
                if entry is None:
                    self._json(404, {"ok": False, "error": "unknown plan"})
                    return
                write_ticket(root, comp, int(ver), entry["content"], batch_id)
                if [comp, ver] not in result["approved"]:
                    result["approved"].append([comp, ver])
                self._json(200, {"ok": True, "approved": len(result["approved"])})
                return
            if self.path == "/api/batch/reject" and batch_mode:
                try:
                    body = self._read_body()
                except Exception:
                    self.send_response(400)
                    self.end_headers()
                    return
                result["rejected"].append(
                    [body.get("component"), body.get("proposedVersion"),
                     (body.get("comment") or "").strip()])
                self._json(200, {"ok": True})
                return
            if self.path == "/api/batch/done" and batch_mode:
                result["exit"] = 0
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
        if batch_mode:
            appr, rej = result["approved"], result["rejected"]
            print("Batch sign-off: %d approved, %d changes-requested%s."
                  % (len(appr), len(rej),
                     "" if got else " (session timed out; approvals were saved)"))
            for c, v in appr:
                print("  approved: %s v%s" % (c, v))
            for c, v, cm in rej:
                print("  changes-requested: %s v%s%s"
                      % (c, v, " — %s" % cm if cm else ""))
            sys.exit(0)  # approvals are persisted tickets; a timeout loses nothing
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


def render_static_html(root, focus=None):
    """The self-contained static board as a string. Pure: writes no file and
    touches no gitignore. Shared by --export (which writes it to disk) and
    --publish (which pushes it to the gh-pages branch)."""
    slug, focus_results = split_focus(focus)
    payload = collect_payload(root, "static", slug)
    payload["focusResults"] = focus_results
    build_assets(root, payload)
    return inject(template_path().read_text(encoding="utf-8"), payload)


def export(root, args):
    html = render_static_html(root, args.focus)
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


def share(root, args):
    slug, focus_results = split_focus(args.focus)
    payload = collect_payload(root, "remote", slug)
    payload["focusResults"] = focus_results
    build_assets(root, payload)
    html = inject(template_path().read_text(encoding="utf-8"), payload)
    out = (
        Path(args.share) if args.share != "DEFAULT"
        else root / "plans" / "board-share.html"
    )
    if not out.is_absolute():
        out = root / out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    ensure_gitignore(root / "plans")
    print(str(out))
    if args.focus:
        print(
            "Reminder: emailing this file publishes the focused component's "
            "plans plus the full master plan to the recipient.",
            file=sys.stderr,
        )
    else:
        print(
            "Reminder: emailing this file publishes everything under plans/ "
            "to the recipient. Use --focus NN-slug to share one component.",
            file=sys.stderr,
        )
    sys.exit(0)


# --- GitHub Pages publish (feature #4) ---

TMP_BRANCH_PREFIX = "_rp_pages_"  # per-run throwaway branch backing the publish worktree
# github.com must be the HOST (right after an optional scheme and userinfo), not
# merely appear somewhere in the URL/path — so git.example.com/github.com/... is rejected.
GITHUB_RE = re.compile(
    r"^(?:\w+://)?(?:[^@/]+@)?github\.com[:/]([^/]+?)/(.+?)(?:\.git)?/?$"
)
_VOLATILE_RE = re.compile(r'"generatedAt":\s*"[^"]*"')
INDEX_REDIRECT = (
    '<!doctype html>\n<meta charset="utf-8">\n'
    "<title>research-plans board</title>\n"
    '<meta http-equiv="refresh" content="0; url=board.html">\n'
    '<a href="board.html">Open the board</a>\n'
)


def parse_github_remote(url):
    """(owner, repo) from a GitHub remote URL (ssh or https, with or without a
    trailing .git), or None when it is not a github.com remote."""
    if not url:
        return None
    m = GITHUB_RE.search(url.strip())
    return (m.group(1), m.group(2)) if m else None


def _git(cwd, argv, check=True, timeout=120):
    r = subprocess.run(["git", *argv], cwd=str(cwd),
                       capture_output=True, text=True, timeout=timeout)
    if check and r.returncode != 0:
        die("git %s failed:\n%s" % (" ".join(argv), (r.stderr or r.stdout).strip()))
    return r


def _publish_noop(files, worktree):
    """True when every file already matches the current branch content once the
    board's only volatile field (generatedAt) is masked — a timestamp-only diff
    that is not worth a new commit."""
    for name, content in files.items():
        existing = worktree / name
        if not existing.is_file():
            return False
        a = _VOLATILE_RE.sub('"generatedAt":""', content)
        b = _VOLATILE_RE.sub('"generatedAt":""', existing.read_text(encoding="utf-8"))
        if a != b:
            return False
    return True


def publish_to_branch(root, files, branch, message):
    """Push {name: content} to `branch` on origin through a throwaway git
    worktree, so the working tree and current branch are never touched. Builds
    on origin/<branch> when it already exists (preserving any other files there),
    otherwise creates an orphan branch. Returns 'pushed' or 'unchanged'."""
    _git(root, ["worktree", "prune"], check=False)
    tmp_branch = TMP_BRANCH_PREFIX + uuid.uuid4().hex[:8]  # unique — never clobbers a user ref
    _git(root, ["fetch", "origin", branch], check=False)  # branch may not exist yet
    has_remote = _git(
        root, ["show-ref", "--verify", "--quiet", "refs/remotes/origin/%s" % branch],
        check=False,
    ).returncode == 0
    tmp = tempfile.mkdtemp(prefix="rp-pages-")
    try:
        if has_remote:
            _git(root, ["worktree", "add", "-B", tmp_branch, tmp, "origin/%s" % branch])
        else:
            _git(root, ["worktree", "add", "--detach", tmp])
            _git(tmp, ["checkout", "--orphan", tmp_branch])
            _git(tmp, ["rm", "-rf", "."], check=False)  # clear the inherited tree
        if _publish_noop(files, Path(tmp)):
            return "unchanged"
        for name, content in files.items():
            (Path(tmp) / name).write_text(content, encoding="utf-8")
        _git(tmp, ["add", "-A"])
        _git(tmp, ["commit", "-m", message])
        push = _git(tmp, ["push", "origin", "HEAD:%s" % branch], check=False)
        if push.returncode != 0:
            die("push to %s failed:\n%s\nIf the branch is protected or has diverged, "
                "resolve it and retry." % (branch, (push.stderr or push.stdout).strip()))
        return "pushed"
    finally:
        _git(root, ["worktree", "remove", "--force", tmp], check=False)
        _git(root, ["branch", "-D", tmp_branch], check=False)
        shutil.rmtree(tmp, ignore_errors=True)


def _gh(argv):
    """Run a gh command, best-effort: return None if gh is missing or the call
    errors or times out (never raises), else the CompletedProcess."""
    if shutil.which("gh") is None:
        return None
    try:
        return subprocess.run(["gh", *argv], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None


def _pages_enabled(owner, repo):
    """Best-effort: make sure GitHub Pages serves gh-pages/. True if enabled (or
    newly enabled), False if gh is missing/unauthenticated or the call fails."""
    got = _gh(["api", "repos/%s/%s/pages" % (owner, repo)])
    if got is None:
        return False
    if got.returncode == 0:
        return True  # already enabled
    created = _gh(["api", "--method", "POST", "repos/%s/%s/pages" % (owner, repo),
                   "-f", "source[branch]=gh-pages", "-f", "source[path]=/"])
    return created is not None and created.returncode == 0


def _repo_visibility(owner, repo):
    r = _gh(["repo", "view", "%s/%s" % (owner, repo),
             "--json", "visibility", "-q", ".visibility"])
    return r.stdout.strip().lower() if r is not None and r.returncode == 0 else None


def publish_pages(root, args):
    if _git(root, ["rev-parse", "--is-inside-work-tree"], check=False).returncode != 0:
        die("not a git repository — --publish needs a git repo with a GitHub 'origin' remote")
    remote = _git(root, ["remote", "get-url", "origin"], check=False)
    if remote.returncode != 0 or not remote.stdout.strip():
        die("no 'origin' remote — add your GitHub remote "
            "(git remote add origin git@github.com:you/repo.git) and retry")
    gh = parse_github_remote(remote.stdout.strip())
    if gh is None:
        die("origin is not a GitHub remote:\n  %s\n"
            "GitHub Pages publish needs a github.com origin." % remote.stdout.strip())
    owner, repo = gh
    html = render_static_html(root, None)  # v1 publishes the full board (no --focus)
    outcome = publish_to_branch(
        root, {"board.html": html, "index.html": INDEX_REDIRECT},
        "gh-pages", "Publish research-plans board",
    )
    url = "https://%s.github.io/%s/" % (owner, repo)
    enabled = _pages_enabled(owner, repo)
    vis = _repo_visibility(owner, repo)
    print(url)  # stdout: the shareable URL
    lines = []
    if outcome == "unchanged":
        lines.append("Board unchanged since the last publish — nothing new pushed.")
    lines.append(
        "Published the FULL board — every plan, result, and decision under plans/. "
        "Anyone who can reach the URL can read all of it."
    )
    if vis == "public":
        lines.append("This repo is PUBLIC, so the board is public.")
    elif vis == "private":
        lines.append("This repo is private; GitHub Pages for a private repo needs a paid "
                     "plan (Pro/Team/Enterprise) or the URL will 404.")
    else:
        lines.append("If this repo is public, the board is public to anyone with the link.")
    if not enabled:
        lines.append("Could not confirm Pages is enabled (gh missing or unauthenticated). "
                     "Enable it once: repo Settings > Pages > Branch gh-pages, folder / (root).")
    print("\n".join(lines), file=sys.stderr)
    sys.exit(0)


def collect_pending(root):
    pending = root / "plans" / ".board-feedback.md"
    if not pending.is_file():
        print("No pending feedback.", file=sys.stderr)
        sys.exit(3)
    print(pending.read_text(encoding="utf-8"))
    pending.unlink()
    sys.exit(0)


def parse_fence(doc):
    m = FENCE_RE.search(doc)
    if not m:
        return None
    try:
        meta = json.loads(m.group(1))
    except ValueError:
        return None
    return meta if isinstance(meta, dict) else None


def collect_file(root, path):
    p = Path(path)
    if not p.is_absolute():
        p = Path.cwd() / p
    if not p.is_file():
        die("no feedback file at %s" % p)
    doc = p.read_text(encoding="utf-8", errors="replace")
    meta = parse_fence(doc)
    if meta is None:
        print(
            "board: warning — no parseable ```json board-feedback``` fence; "
            "route from the markdown body.",
            file=sys.stderr,
        )
    elif meta.get("mode") == "remote" and meta.get("shareHash"):
        try:
            current = collect_payload(root, "remote", meta.get("focus"))
            fresh = current["shareHash"]
        except SystemExit:
            fresh = None  # e.g. focused component no longer exists
        if fresh != meta["shareHash"]:
            print(
                "board: STALE — plans changed since this share was exported "
                "(share %s, now %s). Relay this to the researcher before "
                "routing." % (meta["shareHash"], fresh or "unknown"),
                file=sys.stderr,
            )
    print(doc)
    sys.exit(0)


def write_ticket(root, slug, version, content, batch_id):
    """Write a batch-approval ticket that signoff_gate.check_ticket accepts.
    Hashed over the NORMALIZED draft (sign-off-trailer-invariant), so the later
    signed vN.md write matches and the gate allows it without reopening a browser."""
    doc = {
        "slug": slug,
        "version": version,
        "contentHash": hashlib.sha256(
            normalize_plan(content).encode("utf-8")).hexdigest(),
        "approver": os.environ.get("USER", "researcher"),
        "batchId": batch_id,
        "approvedAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "expiry": time.time() + TICKET_TTL,
    }
    tp = root / "plans" / "execution" / (".import-approved-%s-v%d" % (slug, version))
    tp.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    return tp


def apply_gate_batch(root, payload):
    """Collect every pending draft (.draft-vN.md) into payload['gateBatch'] for the
    one-at-a-time batch sign-off wizard. Each approval writes that plan's ticket
    immediately (incremental persistence), so an interrupted session keeps prior
    approvals."""
    batch = []
    exec_dir = root / "plans" / "execution"
    if exec_dir.is_dir():
        for comp_dir in sorted(p for p in exec_dir.iterdir() if p.is_dir()):
            drafts = sorted(comp_dir.glob(".draft-v*.md"))
            if not drafts:
                continue
            d = drafts[-1]
            m = re.fullmatch(r"\.draft-v(\d+)\.md", d.name)
            batch.append({
                "component": comp_dir.name,
                "proposedVersion": int(m.group(1)) if m else 1,
                "path": str(d.relative_to(root)),
                "content": d.read_text(encoding="utf-8"),
            })
    if not batch:
        die("no pending drafts (.draft-v*.md) to review — nothing to approve")
    payload["gateBatch"] = batch
    return payload


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
    ap.add_argument("--share", nargs="?", const="DEFAULT", default=None, metavar="PATH")
    ap.add_argument("--publish", action="store_true",
                    help="publish the static board to the repo's GitHub Pages (gh-pages branch)")
    ap.add_argument("--collect", nargs="?", const="PENDING", default=None, metavar="FILE")
    ap.add_argument("--gate", default=None, metavar="SLUG/vN")
    ap.add_argument("--gate-batch", action="store_true",
                    help="one-at-a-time sign-off over all pending drafts")
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

    if args.collect is not None:
        if args.collect == "PENDING":
            collect_pending(root)
        else:
            collect_file(root, args.collect)
    elif args.share is not None:
        share(root, args)
    elif args.export is not None:
        export(root, args)
    elif args.publish:
        publish_pages(root, args)
    else:
        slug, focus_results = split_focus(args.focus)
        payload = collect_payload(root, "live", slug)
        payload["focusResults"] = focus_results
        build_assets(root, payload)
        if args.gate:
            payload = apply_gate(root, payload, args.gate)
        elif args.gate_batch:
            payload = apply_gate_batch(root, payload)
        serve(root, payload, args)


if __name__ == "__main__":
    main()
