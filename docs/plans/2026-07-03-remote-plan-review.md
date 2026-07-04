# Remote Plan Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A researcher exports an annotatable, self-contained board HTML file (`--share`), emails it to a collaborator who annotates it in any browser and downloads a feedback `.txt` file, and the researcher ingests that file (`--collect <file>`) through the existing feedback-routing pipeline.

**Architecture:** A third board mode `"remote"` joins `"live"`/`"static"`. `board.py` gains `--share` (export with annotations enabled, focus pruning, and a Python-computed `shareHash` for staleness checks) and a path argument to `--collect` (validate + staleness note + print, never delete). The React app replaces its single `live` boolean with capability flags (`canAnnotate`, `canPost`, `remote`), assembles the feedback document client-side (shared by live POST and remote download), and adds a reviewer-name field, orientation banner, and Blob download. Spec: `docs/specs/2026-07-03-remote-plan-review-design.md`.

**Tech Stack:** Python 3.9+ stdlib only (`board.py`); React 19 + TypeScript + Vite single-file build (`board/`); `unittest` for Python tests, `vitest` for TS tests.

## Global Constraints

- `board.py` stays **Python 3.9+ stdlib only** — no pip dependencies, ever.
- The board app builds to **one self-contained HTML file**; no new runtime network requests, no new npm dependencies.
- The feedback document format is: markdown body + `\n\n```json board-feedback\n<JSON>\n```\n` fence. Existing consumers (`commands/board.md` step 5) parse this fence — never change the fence label or structure, only add keys.
- The exported feedback file extension is **`.txt`** (not `.md`) — mail clients inline `.md` and mangle the fence.
- Signed `vN.md` files are immutable; nothing in this plan writes to `plans/execution/`.
- Share exports must never contain `project.root` or a `gate` payload.
- Focused shares always include the full master plan (decided 2026-07-03; see spec Non-goals).
- Remote gate approval is a non-goal. Do not add gate serialization to the download path.
- Repo working directory for all commands: `~/github/research-plans` unless stated otherwise.
- macOS/zsh: there is no GNU `timeout` command; use the Bash tool's timeout parameter if needed.

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `skills/managing-research-plans/scripts/board.py` | Modify | `share_hash`/`payload_files` helpers, remote payload (drafts + pruning + hash), `share()`, `collect_file()`, `document_from_body()`, CLI dispatch, gitignore line |
| `tests/__init__.py` | Create | empty package marker |
| `tests/test_board.py` | Create | Python tests: hash, share export, pruning, collect roundtrip, staleness, pending regression |
| `board/src/lib/types.ts` | Modify | `mode` union gains `"remote"`; `shareHash?` field |
| `board/src/lib/feedback.ts` | Create | client document assembly, session id, filename sanitization |
| `board/src/lib/feedback.test.ts` | Create | vitest for feedback.ts |
| `board/src/App.tsx` | Modify | capability flags, reviewer state, remote banner, download button, clipboard fix, live POST gains `feedbackDocument` |
| `board/src/views/{Tracker,Timeline,Scorecard,PlanReader}.tsx` | Modify | prop rename `live` → `canAnnotate` |
| `skills/managing-research-plans/assets/board-template.html` | Rebuild | committed build artifact (`npm run build` copies it) |
| `commands/board.md` | Modify | `--share` and `--collect <file>` command steps |
| `CHANGELOG.md`, `README.md`, `QUICKSTART.md`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `board/package.json` | Modify | docs + version 0.5.0 |

---

### Task 1: Python hash helpers (`share_hash`, `payload_files`)

**Files:**
- Modify: `skills/managing-research-plans/scripts/board.py` (add after `read_file`, ~line 102)
- Create: `tests/__init__.py`, `tests/test_board.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `share_hash(files: list[dict]) -> str` — 16 lowercase hex chars, deterministic over sorted `(path, content)` pairs. `payload_files(payload: dict) -> list[dict]` — every embedded file dict (`{"path", "content", ...}`) in the payload: masterPlan, decisionLog, all versions, drafts, reviews. Tasks 2 and 4 call both.

- [ ] **Step 1: Create the test scaffolding and failing tests**

Create `tests/__init__.py` (empty file). Create `tests/test_board.py`:

```python
"""Tests for board.py remote-share features. Run:
    python3 -m unittest tests.test_board -v
"""
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = (
    Path(__file__).resolve().parents[1]
    / "skills" / "managing-research-plans" / "scripts"
)
BOARD = SCRIPTS / "board.py"
sys.path.insert(0, str(SCRIPTS))
import board  # noqa: E402


def make_project(root: Path):
    """Minimal initialized research-plans project with two components."""
    plans = root / "plans"
    (plans / "execution" / "01-data-prep").mkdir(parents=True)
    (plans / "execution" / "02-other").mkdir(parents=True)
    (plans / "reviews").mkdir()
    (plans / "master-plan.md").write_text(
        "<!-- research-plans:master-plan -->\n"
        "# Test Project — Master Plan\n\n"
        "## Components\n\n"
        "| # | Component | Status | Execution plan | Outcome / notes | Serves |\n"
        "|---|-----------|--------|----------------|-----------------|--------|\n"
        "| 1 | Data prep | in progress | — | — | — |\n"
        "| 2 | Other | planned | — | — | — |\n",
        encoding="utf-8",
    )
    (plans / "decision-log.md").write_text("# Decision Log\n\nSecret log entry.\n", encoding="utf-8")
    (plans / "execution" / "01-data-prep" / "v1.md").write_text(
        "# Data prep v1\n\nDo the thing.\n", encoding="utf-8")
    (plans / "execution" / "01-data-prep" / ".draft-v2.md").write_text(
        "# Data prep v2 draft\n\nDo it better.\n", encoding="utf-8")
    (plans / "execution" / "02-other" / "v1.md").write_text(
        "# Other v1\n\nSecret other plan.\n", encoding="utf-8")
    (plans / "reviews" / "review-01.md").write_text(
        "# Review\n\nSecret review.\n", encoding="utf-8")
    return plans


def run_board(cwd, *argv):
    return subprocess.run(
        [sys.executable, str(BOARD), *argv],
        capture_output=True, text=True, cwd=str(cwd), timeout=60,
    )


def extract_payload(html: str) -> dict:
    m = re.search(
        r'<script id="board-data" type="application/json">(.*?)</script>',
        html, re.DOTALL,
    )
    assert m, "no board-data slot in exported html"
    return json.loads(m.group(1))


class TestShareHash(unittest.TestCase):
    def test_deterministic_and_order_independent(self):
        a = [{"path": "b.md", "content": "B"}, {"path": "a.md", "content": "A"}]
        b = [{"path": "a.md", "content": "A"}, {"path": "b.md", "content": "B"}]
        self.assertEqual(board.share_hash(a), board.share_hash(b))
        self.assertEqual(len(board.share_hash(a)), 16)

    def test_content_change_changes_hash(self):
        a = [{"path": "a.md", "content": "A"}]
        b = [{"path": "a.md", "content": "changed"}]
        self.assertNotEqual(board.share_hash(a), board.share_hash(b))

    def test_payload_files_covers_all_embedded_files(self):
        payload = {"files": {
            "masterPlan": {"path": "plans/master-plan.md", "content": "m"},
            "decisionLog": {"path": "plans/decision-log.md", "content": "d"},
            "executionPlans": [{
                "component": "01-x",
                "versions": [{"path": "plans/execution/01-x/v1.md", "content": "v1"}],
                "draft": {"path": "plans/execution/01-x/.draft-v2.md", "content": "d2"},
            }],
            "reviews": [{"path": "plans/reviews/r.md", "content": "r"}],
        }}
        paths = [f["path"] for f in board.payload_files(payload)]
        self.assertEqual(sorted(paths), sorted([
            "plans/master-plan.md", "plans/decision-log.md",
            "plans/execution/01-x/v1.md", "plans/execution/01-x/.draft-v2.md",
            "plans/reviews/r.md",
        ]))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/github/research-plans && python3 -m unittest tests.test_board -v`
Expected: FAIL / ERROR with `AttributeError: module 'board' has no attribute 'share_hash'`

- [ ] **Step 3: Implement the helpers**

In `skills/managing-research-plans/scripts/board.py`: add `import hashlib` to the import block (alphabetical, after `import datetime`). Add after the `read_file` function (~line 102):

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/github/research-plans && python3 -m unittest tests.test_board -v`
Expected: `OK` (3 tests)

- [ ] **Step 5: Commit**

```bash
git add skills/managing-research-plans/scripts/board.py tests/__init__.py tests/test_board.py
git commit -m "board.py: share_hash + payload_files helpers for remote share staleness"
```

---

### Task 2: Remote payload in `collect_payload` (drafts, focus pruning, shareHash)

**Files:**
- Modify: `skills/managing-research-plans/scripts/board.py:104-169` (`collect_payload`)
- Test: `tests/test_board.py`

**Interfaces:**
- Consumes: `share_hash`, `payload_files` (Task 1).
- Produces: `collect_payload(root, "remote", focus)` returns a payload with `mode: "remote"`, top-level `shareHash` (16 hex), drafts included, **no** `project.root`; with `focus` set it contains only the focused execution group, `reviews: []`, and a placeholder decision log whose content contains the word `omitted`. Tasks 3 and 4 rely on exactly this.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_board.py`:

```python
class TestRemotePayload(unittest.TestCase):
    def test_remote_payload_shape(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            payload = board.collect_payload(root, "remote", None)
            self.assertEqual(payload["mode"], "remote")
            self.assertNotIn("root", payload["project"])
            self.assertRegex(payload["shareHash"], r"^[0-9a-f]{16}$")
            groups = {g["component"]: g for g in payload["files"]["executionPlans"]}
            self.assertIn("draft", groups["01-data-prep"])  # drafts included in remote
            self.assertEqual(groups["01-data-prep"]["draft"]["proposedVersion"], 2)

    def test_focused_remote_payload_prunes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            payload = board.collect_payload(root, "remote", "01-data-prep")
            comps = [g["component"] for g in payload["files"]["executionPlans"]]
            self.assertEqual(comps, ["01-data-prep"])
            self.assertEqual(payload["files"]["reviews"], [])
            self.assertIn("omitted", payload["files"]["decisionLog"]["content"])
            self.assertNotIn("Secret log entry", payload["files"]["decisionLog"]["content"])
            # master plan stays fully visible by design
            self.assertIn("Master Plan", payload["files"]["masterPlan"]["content"])

    def test_static_payload_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            payload = board.collect_payload(root, "static", None)
            self.assertNotIn("shareHash", payload)
            groups = {g["component"]: g for g in payload["files"]["executionPlans"]}
            self.assertNotIn("draft", groups["01-data-prep"])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest tests.test_board -v`
Expected: `test_remote_payload_shape` fails with `KeyError: 'shareHash'`; `test_focused_remote_payload_prunes` fails on the component-list assertion.

- [ ] **Step 3: Implement**

Three edits inside `collect_payload`:

(a) Line 123, drafts condition:
```python
            if mode in ("live", "remote"):
```
(was `if mode == "live":`)

(b) After the `decision_log = (...)` assignment (line 146) and before `all_paths = [...]` (line 148), insert:

```python
    if mode == "remote" and focus:
        exec_groups = [g for g in exec_groups if g["component"] == focus]
        if not exec_groups:
            die("no execution plans found for --focus %s" % focus)
        reviews = []
        decision_log = {
            "path": "plans/decision-log.md",
            "content": "# Decision Log\n\n(omitted from focused share)\n",
        }
```

(c) Replace the tail of the function (lines 167-169):

```python
    if mode == "live":
        payload["project"]["root"] = str(root)
    elif mode == "remote":
        payload["shareHash"] = share_hash(payload_files(payload))
    return payload
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest tests.test_board -v`
Expected: `OK` (6 tests)

- [ ] **Step 5: Commit**

```bash
git add skills/managing-research-plans/scripts/board.py tests/test_board.py
git commit -m "board.py: remote payload mode — drafts, focus pruning, shareHash"
```

---

### Task 3: `--share` CLI mode + gitignore line

**Files:**
- Modify: `skills/managing-research-plans/scripts/board.py` (GITIGNORE_LINES ~line 30; new `share()` after `export()` ~line 383; argparse + dispatch in `main()` ~lines 425-453)
- Test: `tests/test_board.py`

**Interfaces:**
- Consumes: `collect_payload(root, "remote", focus)` (Task 2), existing `inject`, `template_path`, `ensure_gitignore`.
- Produces: CLI `python3 board.py --share [PATH] [--focus NN-slug]` → writes annotatable HTML (default `plans/board-share.html`), prints the output path on stdout, privacy reminder on stderr, exit 0. `plans/.gitignore` gains `/board-share.html`. Task 10 and `commands/board.md` (Task 11) invoke exactly this.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_board.py`:

```python
class TestShareCli(unittest.TestCase):
    def test_share_writes_remote_board(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            r = run_board(root, "--share")
            self.assertEqual(r.returncode, 0, r.stderr)
            out = Path(r.stdout.strip())
            self.assertEqual(out, root / "plans" / "board-share.html")
            payload = extract_payload(out.read_text(encoding="utf-8"))
            self.assertEqual(payload["mode"], "remote")
            self.assertIn("shareHash", payload)
            self.assertNotIn("root", payload["project"])
            self.assertIn("publishes", r.stderr)
            gi = (root / "plans" / ".gitignore").read_text(encoding="utf-8")
            self.assertIn("/board-share.html", gi)

    def test_share_focus_and_custom_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            r = run_board(root, "--share", "out/custom.html", "--focus", "01-data-prep")
            self.assertEqual(r.returncode, 0, r.stderr)
            payload = extract_payload(
                (root / "out" / "custom.html").read_text(encoding="utf-8"))
            comps = [g["component"] for g in payload["files"]["executionPlans"]]
            self.assertEqual(comps, ["01-data-prep"])
            self.assertNotIn("Secret other plan", json.dumps(payload))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest tests.test_board -v`
Expected: both new tests fail — `--share` is an unrecognized argument (returncode 2).

- [ ] **Step 3: Implement**

(a) Add to `GITIGNORE_LINES` (line 30-35):
```python
GITIGNORE_LINES = [
    "/.board-feedback.md",
    "/.board.lock",
    "/board-share.html",
    "/execution/*/.draft-v*.md",
    "/execution/*/.gate-*.md",
]
```

(b) Add `share()` directly after `export()` (~line 383):

```python
def share(root, args):
    payload = collect_payload(root, "remote", args.focus)
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
```

(c) In `main()`, add the argument after `--export` (line 428):
```python
    ap.add_argument("--share", nargs="?", const="DEFAULT", default=None, metavar="PATH")
```
and extend the dispatch (lines 445-453):
```python
    if args.collect:
        collect_pending(root)
    elif args.share is not None:
        share(root, args)
    elif args.export is not None:
        export(root, args)
```
(the `else:` serve branch stays as is; Task 4 revises the `--collect` branch).

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest tests.test_board -v`
Expected: `OK` (8 tests)

- [ ] **Step 5: Commit**

```bash
git add skills/managing-research-plans/scripts/board.py tests/test_board.py
git commit -m "board.py: --share exports an annotatable remote board"
```

---

### Task 4: `--collect <file>` ingest with staleness note

**Files:**
- Modify: `skills/managing-research-plans/scripts/board.py` (new `parse_fence` + `collect_file` after `collect_pending` ~line 393; argparse `--collect` + dispatch in `main()`)
- Test: `tests/test_board.py`

**Interfaces:**
- Consumes: `collect_payload(root, "remote", focus)`, `share_hash`, `payload_files` (Tasks 1-2).
- Produces: CLI `python3 board.py --collect <file>` → prints the document verbatim to stdout, exit 0, source file untouched; stderr carries `STALE` when the recomputed hash differs, or a `no parseable` warning when the fence is corrupt. Bare `--collect` behavior (read+delete pending) is unchanged. `commands/board.md` (Task 11) relies on these exact stderr markers.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_board.py`:

```python
def make_feedback_doc(share_hash_value, focus=None, mode="remote"):
    meta = {
        "sessionId": "test-session", "generatedAt": "2026-07-03T12:00:00",
        "mode": mode, "focus": focus, "reviewer": "Candice",
        "payloadHash": "deadbeef", "shareHash": share_hash_value,
        "annotations": [],
    }
    return (
        "# Board Feedback\n\nLooks good overall.\n"
        + "\n```json board-feedback\n" + json.dumps(meta, indent=1) + "\n```\n"
    )


class TestCollectFile(unittest.TestCase):
    def test_collect_file_fresh(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            current = board.collect_payload(root, "remote", None)
            doc = make_feedback_doc(current["shareHash"])
            f = root / "feedback.txt"
            f.write_text(doc, encoding="utf-8")
            r = run_board(root, "--collect", str(f))
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(r.stdout.rstrip("\n"), doc.rstrip("\n"))
            self.assertNotIn("STALE", r.stderr)
            self.assertTrue(f.is_file())  # never deleted

    def test_collect_file_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            current = board.collect_payload(root, "remote", None)
            doc = make_feedback_doc(current["shareHash"])
            f = root / "feedback.txt"
            f.write_text(doc, encoding="utf-8")
            (root / "plans" / "execution" / "01-data-prep" / ".draft-v2.md").write_text(
                "# Data prep v2 draft\n\nRevised since export.\n", encoding="utf-8")
            r = run_board(root, "--collect", str(f))
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("STALE", r.stderr)

    def test_collect_file_without_fence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            f = root / "feedback.txt"
            f.write_text("# Board Feedback\n\nNo fence here.\n", encoding="utf-8")
            r = run_board(root, "--collect", str(f))
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("no parseable", r.stderr)
            self.assertIn("No fence here", r.stdout)

    def test_collect_pending_still_deletes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            pending = root / "plans" / ".board-feedback.md"
            pending.write_text("# Board Feedback\n\npending\n", encoding="utf-8")
            r = run_board(root, "--collect")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("pending", r.stdout)
            self.assertFalse(pending.is_file())
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest tests.test_board -v`
Expected: the three `collect_file` tests fail (path argument rejected or treated as noise); `test_collect_pending_still_deletes` passes.

- [ ] **Step 3: Implement**

(a) Add module-level regex near the top of `board.py` (after `GITIGNORE_LINES`):
```python
FENCE_RE = re.compile(r"```json board-feedback\n(.*?)\n```", re.DOTALL)
```

(b) Add after `collect_pending` (~line 393):

```python
def parse_fence(doc):
    m = FENCE_RE.search(doc)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except ValueError:
        return None


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
```

(c) In `main()`, replace `ap.add_argument("--collect", action="store_true")` with:
```python
    ap.add_argument("--collect", nargs="?", const="PENDING", default=None, metavar="FILE")
```
and update the dispatch:
```python
    if args.collect is not None:
        if args.collect == "PENDING":
            collect_pending(root)
        else:
            collect_file(root, args.collect)
    elif args.share is not None:
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest tests.test_board -v`
Expected: `OK` (12 tests)

- [ ] **Step 5: Commit**

```bash
git add skills/managing-research-plans/scripts/board.py tests/test_board.py
git commit -m "board.py: --collect <file> ingests remote feedback with staleness note"
```

---

### Task 5: Server accepts a client-assembled document (`document_from_body`)

**Files:**
- Modify: `skills/managing-research-plans/scripts/board.py` (new function after `build_feedback_document` ~line 245; two call sites in `serve()` at lines 292 and 324)
- Test: `tests/test_board.py`

**Interfaces:**
- Consumes: existing `build_feedback_document(body, payload)`.
- Produces: `document_from_body(body: dict, payload: dict) -> str` — returns `body["feedbackDocument"]` verbatim when it is a non-empty string, else falls back to `build_feedback_document`. The POST handlers for `/api/feedback` and `/api/deny` use it. Task 8's client sends `feedbackDocument` in the POST body.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_board.py`:

```python
class TestDocumentFromBody(unittest.TestCase):
    PAYLOAD = {"generatedAt": "2026-07-03T12:00:00", "mode": "live", "focus": None}

    def test_verbatim_when_client_assembled(self):
        body = {"feedbackDocument": "# Board Feedback\n\nclient built\n"}
        self.assertEqual(
            board.document_from_body(body, self.PAYLOAD),
            "# Board Feedback\n\nclient built\n",
        )

    def test_fallback_to_server_builder(self):
        body = {"feedbackMarkdown": "# Board Feedback\n\nlegacy", "annotations": []}
        doc = board.document_from_body(body, self.PAYLOAD)
        self.assertIn("legacy", doc)
        self.assertIn("```json board-feedback", doc)

    def test_empty_string_falls_back(self):
        body = {"feedbackDocument": "  ", "feedbackMarkdown": "# X", "annotations": []}
        self.assertIn("```json board-feedback", board.document_from_body(body, self.PAYLOAD))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest tests.test_board -v`
Expected: ERROR — `no attribute 'document_from_body'`

- [ ] **Step 3: Implement**

Add after `build_feedback_document` (~line 245):

```python
def document_from_body(body, payload):
    """Prefer the client-assembled feedback document (schemaVersion 1 clients
    send feedbackDocument); fall back to server-side assembly for older
    templates and the gate flow."""
    doc = body.get("feedbackDocument")
    if isinstance(doc, str) and doc.strip():
        return doc
    return build_feedback_document(body, payload)
```

In `serve()`, change both `doc = build_feedback_document(body, payload)` call sites (line 292 in `/api/feedback`, line 324 in `/api/deny`) to:
```python
                doc = document_from_body(body, payload)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest tests.test_board -v`
Expected: `OK` (15 tests)

- [ ] **Step 5: Commit**

```bash
git add skills/managing-research-plans/scripts/board.py tests/test_board.py
git commit -m "board.py: serve() prefers client-assembled feedback document"
```

---

### Task 6: TypeScript types + capability flags + view prop rename

**Files:**
- Modify: `board/src/lib/types.ts:6` (mode union), add `shareHash`
- Modify: `board/src/App.tsx` (flags; prop pass-through)
- Modify: `board/src/views/Tracker.tsx:22,27,240`, `board/src/views/Timeline.tsx:30,34,105`, `board/src/views/Scorecard.tsx:16,20,248`, `board/src/views/PlanReader.tsx:24,32,235,270`

**Interfaces:**
- Consumes: nothing new.
- Produces: `BoardData.mode: "live" | "static" | "remote"`; `BoardData.shareHash?: string`. In `App.tsx`: `const canAnnotate = data.mode === "live" || data.mode === "remote";`, `const canPost = data.mode === "live";`, `const remote = data.mode === "remote";`. All four views take a `canAnnotate: boolean` prop (renamed from `live`). Task 8 builds on these exact names.

This task is a mechanical refactor with **no behavior change** for live/static modes; the TypeScript compiler is the test.

- [ ] **Step 1: Update types.ts**

In `board/src/lib/types.ts`, replace lines 6-7:
```ts
  mode: "live" | "static" | "remote";
  focus: string | null;
```
and add after the `focus` line:
```ts
  shareHash?: string; // remote mode: Python-computed, echoed back in feedback
```

- [ ] **Step 2: Replace the `live` flag in App.tsx**

In `board/src/App.tsx` line 29, replace:
```ts
  const live = data.mode === "live";
```
with:
```ts
  const canAnnotate = data.mode === "live" || data.mode === "remote";
  const canPost = data.mode === "live";
  const remote = data.mode === "remote";
```
Then update every use of `live` in App.tsx (compiler will list them):
- line 41 `if (!live) return [];` → `if (!canAnnotate) return [];`
- line 55 `if (!live) return;` → `if (!canAnnotate) return;`
- line 61 dependency array `[annotations, live, storageKey]` → `[annotations, canAnnotate, storageKey]`
- line 238 `{live && (` (Feedback header button) → `{canAnnotate && (`
- line 247 `{!live && (` (read-only banner) → `{data.mode === "static" && (`
- lines 268, 279, 288, 291: `live={live}` → `canAnnotate={canAnnotate}` in the four view invocations
- line 295 `{live && drawerOpen && (` → `{canAnnotate && drawerOpen && (`

- [ ] **Step 3: Rename the prop in the four views**

Same three-line pattern in each file — destructured param, prop type, gate:

`board/src/views/Tracker.tsx`: line 22 `live,` → `canAnnotate,`; line 27 `live: boolean;` → `canAnnotate: boolean;`; line 240 `{live && <GeneralCommentBox ...` → `{canAnnotate && <GeneralCommentBox ...`.

`board/src/views/Timeline.tsx`: lines 30, 34, 105 — identical pattern.

`board/src/views/Scorecard.tsx`: lines 16, 20, 248 — identical pattern.

`board/src/views/PlanReader.tsx`: line 24 `live,` → `canAnnotate,`; line 32 `live: boolean;` → `canAnnotate: boolean;`; line 235 `{live ? (` → `{canAnnotate ? (`; line 270 `{live && (` → `{canAnnotate && (`.

- [ ] **Step 4: Typecheck and run existing tests**

Run: `cd board && npx tsc --noEmit && npx vitest run`
Expected: tsc clean (zero errors); existing `parse.test.ts` passes.

- [ ] **Step 5: Commit**

```bash
git add board/src/lib/types.ts board/src/App.tsx board/src/views/Tracker.tsx board/src/views/Timeline.tsx board/src/views/Scorecard.tsx board/src/views/PlanReader.tsx
git commit -m "board ui: remote mode type + capability flags (canAnnotate/canPost/remote)"
```

---

### Task 7: Client feedback-document module (`lib/feedback.ts`)

**Files:**
- Create: `board/src/lib/feedback.ts`
- Test: `board/src/lib/feedback.test.ts`

**Interfaces:**
- Consumes: `Annotation`, `BoardData` types from `./types`.
- Produces (Task 8 imports all four):
  - `newSessionId(): string`
  - `buildFeedbackDocument(feedbackMarkdown: string, meta: FeedbackMeta): string`
  - `sanitizeForFilename(s: string): string`
  - `feedbackFilename(project: string, reviewer: string | null, sessionId: string): string`
  - `interface FeedbackMeta { sessionId: string; generatedAt: string; mode: BoardData["mode"]; focus: string | null; reviewer: string | null; payloadHash: string; shareHash: string | null; annotations: Annotation[] }`

- [ ] **Step 1: Write the failing tests**

Create `board/src/lib/feedback.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildFeedbackDocument,
  feedbackFilename,
  newSessionId,
  sanitizeForFilename,
  type FeedbackMeta,
} from "./feedback";

const meta: FeedbackMeta = {
  sessionId: "abcdef12-3456-7890-abcd-ef1234567890",
  generatedAt: "2026-07-03T12:00:00",
  mode: "remote",
  focus: null,
  reviewer: "Candice",
  payloadHash: "deadbeef",
  shareHash: "0123456789abcdef",
  annotations: [],
};

describe("buildFeedbackDocument", () => {
  it("appends a parseable json board-feedback fence", () => {
    const doc = buildFeedbackDocument("# Board Feedback\n\nHi.\n", meta);
    const m = doc.match(/```json board-feedback\n([\s\S]*?)\n```\n$/);
    expect(m).not.toBeNull();
    const parsed = JSON.parse(m![1]);
    expect(parsed.reviewer).toBe("Candice");
    expect(parsed.shareHash).toBe("0123456789abcdef");
    expect(parsed.mode).toBe("remote");
  });

  it("keeps the markdown body intact above the fence", () => {
    const doc = buildFeedbackDocument("# Board Feedback\n\nBody text.", meta);
    expect(doc.startsWith("# Board Feedback\n\nBody text.\n\n```json")).toBe(true);
  });
});

describe("sanitizeForFilename", () => {
  it("strips unsafe characters", () => {
    expect(sanitizeForFilename("Candice Ó Brien!")).toBe("Candice-O-Brien");
  });
  it("falls back to anonymous when nothing survives", () => {
    expect(sanitizeForFilename("!!!")).toBe("anonymous");
  });
});

describe("feedbackFilename", () => {
  it("builds a .txt name with sanitized parts and short session id", () => {
    const name = feedbackFilename("My Project", "Candice", meta.sessionId);
    expect(name).toMatch(
      /^board-feedback-My-Project-Candice-\d{4}-\d{2}-\d{2}-abcdef12\.txt$/,
    );
  });
});

describe("newSessionId", () => {
  it("returns a uuid or 32-hex fallback", () => {
    expect(newSessionId()).toMatch(/^[0-9a-f-]{32,36}$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd board && npx vitest run src/lib/feedback.test.ts`
Expected: FAIL — cannot resolve `./feedback`.

- [ ] **Step 3: Implement**

Create `board/src/lib/feedback.ts`:

```ts
// Client-side feedback document assembly — the single source of the
// markdown + ```json board-feedback``` fence format. Live mode POSTs the
// assembled document; remote mode downloads it as a .txt file.
import type { Annotation, BoardData } from "./types";

export interface FeedbackMeta {
  sessionId: string;
  generatedAt: string;
  mode: BoardData["mode"];
  focus: string | null;
  reviewer: string | null;
  payloadHash: string;
  shareHash: string | null;
  annotations: Annotation[];
}

export function newSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  let hex = "";
  for (let i = 0; i < 32; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return hex;
}

export function buildFeedbackDocument(
  feedbackMarkdown: string,
  meta: FeedbackMeta,
): string {
  return (
    feedbackMarkdown.trimEnd() +
    "\n\n```json board-feedback\n" +
    JSON.stringify(meta, null, 1) +
    "\n```\n"
  );
}

export function sanitizeForFilename(s: string): string {
  const cleaned = s
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || "anonymous";
}

export function feedbackFilename(
  project: string,
  reviewer: string | null,
  sessionId: string,
): string {
  const date = new Date().toISOString().slice(0, 10);
  return [
    "board-feedback",
    sanitizeForFilename(project),
    sanitizeForFilename(reviewer || "anonymous"),
    date,
    sessionId.replace(/-/g, "").slice(0, 8),
  ].join("-") + ".txt";
}
```

Note: `feedbackFilename` joins with `-` and the test expects `abcdef12` — the session id's first 8 chars after removing dashes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd board && npx vitest run src/lib/feedback.test.ts`
Expected: PASS (6 tests). Then `npx tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add board/src/lib/feedback.ts board/src/lib/feedback.test.ts
git commit -m "board ui: client-side feedback document assembly (lib/feedback)"
```

---

### Task 8: Remote UI in App.tsx (reviewer field, banner, download, clipboard fix, live POST)

**Files:**
- Modify: `board/src/App.tsx`

**Interfaces:**
- Consumes: `buildFeedbackDocument`, `feedbackFilename`, `newSessionId`, `FeedbackMeta` (Task 7); capability flags (Task 6); `document_from_body` server behavior (Task 5).
- Produces: remote-mode UX — orientation banner, name field, "Download feedback file" button, `submitState` value `"downloaded"`. Live POST body gains `feedbackDocument`.

There is no component test infrastructure; verification is `tsc` + vitest (unchanged) + the Task 10 browser roundtrip. Make all edits, then typecheck.

- [ ] **Step 1: Imports, session id, reviewer state, document assembly**

In `board/src/App.tsx` add to the imports:
```ts
import {
  buildFeedbackDocument,
  feedbackFilename,
  newSessionId,
} from "./lib/feedback";
```

After the `storageKey` line (line 32), add:
```ts
  const sessionId = useMemo(() => newSessionId(), []);
```

After the `submitState` state (line 52), extend the union and add reviewer state:
```ts
  const [submitState, setSubmitState] = useState<
    "idle" | "sending" | "sent" | "approved" | "denied" | "failed" | "downloaded"
  >("idle");
  const [reviewer, setReviewer] = useState<string>(() => {
    if (!remote) return "";
    try {
      return localStorage.getItem(`${storageKey}:reviewer`) ?? "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    if (!remote) return;
    try {
      localStorage.setItem(`${storageKey}:reviewer`, reviewer);
    } catch {
      // storage unavailable — name still lives in memory
    }
  }, [reviewer, remote, storageKey]);
```
(Replace the existing `submitState` declaration rather than duplicating it.)

After the `feedbackMarkdown` memo (line 105), add:
```ts
  const feedbackDocument = useMemo(
    () =>
      buildFeedbackDocument(feedbackMarkdown, {
        sessionId,
        generatedAt: data.generatedAt,
        mode: data.mode,
        focus: data.focus,
        reviewer: remote ? reviewer.trim() || "anonymous reviewer" : null,
        payloadHash,
        shareHash: data.shareHash ?? null,
        annotations,
      }),
    [feedbackMarkdown, sessionId, data, remote, reviewer, payloadHash, annotations],
  );
```

- [ ] **Step 2: Live POST gains the document; download handler; clipboard fix**

In `submit()` (line 110), extend the POST body:
```ts
        body: JSON.stringify({
          annotations,
          feedbackMarkdown,
          payloadHash,
          feedbackDocument,
        }),
```

Add a download handler after `submit`:
```ts
  const download = () => {
    const blob = new Blob([feedbackDocument], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = feedbackFilename(
      data.project.name,
      remote ? reviewer : null,
      sessionId,
    );
    a.click();
    URL.revokeObjectURL(url);
    setSubmitState("downloaded");
  };
```

In `copyFallback` (line 161), copy the full document:
```ts
  const copyFallback = async () => {
    try {
      await navigator.clipboard.writeText(feedbackDocument);
      alert("Feedback copied — paste it into your Claude Code session.");
    } catch {
      window.prompt("Copy the feedback below:", feedbackDocument);
    }
  };
```
Leave `gateDeny`/`gateApprove` untouched (gate payloads never reach remote mode).

- [ ] **Step 3: Remote orientation banner**

In the header, directly after the static read-only banner block (`{data.mode === "static" && (...)}` from Task 6), add:
```tsx
        {remote && (
          <div className="border-t border-blue-200 bg-blue-50 px-5 py-2 text-xs leading-relaxed text-blue-900">
            <span className="font-medium">
              You’ve been asked to review this research plan.
            </span>{" "}
            Select text in any plan to attach a comment, or use the comment
            boxes on the other tabs. When you’re done, open Feedback and press
            “Download feedback file”, then email the downloaded file back to
            the researcher. Don’t move or rename this HTML file until you’ve
            downloaded your feedback — your comments are saved by this browser
            against this file’s location.
          </div>
        )}
```

- [ ] **Step 4: Drawer footer — download path for remote**

In the drawer footer (lines 365-396), the current structure is `{gate ? (...) : (<button ...Send to Claude...>)}`. Change it to a three-way branch:
```tsx
            {gate ? (
              <div className="space-y-2">
                {/* ...existing gate buttons block, unchanged... */}
              </div>
            ) : canPost ? (
              <button
                className="w-full rounded-md bg-stone-900 py-2 text-sm font-semibold text-white hover:bg-stone-700 disabled:opacity-40"
                disabled={annotations.length === 0 || submitState === "sending"}
                onClick={submit}
              >
                {submitState === "sending" ? "Sending…" : "Send to Claude"}
              </button>
            ) : (
              <div className="space-y-2">
                <input
                  className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
                  placeholder="Your name (for attribution)"
                  value={reviewer}
                  onChange={(e) => setReviewer(e.target.value)}
                />
                {submitState === "downloaded" && (
                  <p className="rounded-md border border-green-200 bg-green-50 p-2 text-[11px] text-green-800">
                    Feedback file downloaded — email it back to the researcher.
                    You can keep annotating and download again.
                  </p>
                )}
                <button
                  className="w-full rounded-md bg-stone-900 py-2 text-sm font-semibold text-white hover:bg-stone-700 disabled:opacity-40"
                  disabled={annotations.length === 0}
                  onClick={download}
                >
                  Download feedback file
                </button>
                <button
                  className="block w-full text-center text-[11px] text-stone-500 underline hover:text-stone-700"
                  onClick={copyFallback}
                >
                  or copy feedback to clipboard
                </button>
              </div>
            )}
```
Keep the existing gate block exactly as it is — only re-nest it.

Note: `"downloaded"` deliberately does NOT render the full-screen `"sent"` takeover and does NOT clear localStorage — the reviewer may keep annotating and re-download.

- [ ] **Step 5: Typecheck and test**

Run: `cd board && npx tsc --noEmit && npx vitest run`
Expected: clean; all vitest suites pass.

- [ ] **Step 6: Visual smoke check in dev mode (optional but recommended)**

`board/src/dev-data.ts` sets `mode: "live"`. Temporarily change it to `"remote"`, run `npm run dev`, open the URL, confirm: blue banner shows, name field + Download button in the drawer, no "Send to Claude". **Revert dev-data.ts before committing.**

- [ ] **Step 7: Commit**

```bash
git add board/src/App.tsx
git commit -m "board ui: remote mode — reviewer field, banner, feedback download"
```

---

### Task 9: Rebuild the committed template artifact

**Files:**
- Modify (generated): `skills/managing-research-plans/assets/board-template.html`, `board/dist/index.html`

**Interfaces:**
- Consumes: all TS changes (Tasks 6-8).
- Produces: the template `board.py` injects payloads into. Tasks 10+ use it.

- [ ] **Step 1: Build**

Run: `cd board && npm run build`
Expected: vite build succeeds; the `cp` in the build script updates `../skills/managing-research-plans/assets/board-template.html`.

- [ ] **Step 2: Verify the artifact**

```bash
cd ~/github/research-plans
grep -c 'script id="board-data"' skills/managing-research-plans/assets/board-template.html   # expect: 1
! grep -q "RP_BOARD_DEV_DATA" skills/managing-research-plans/assets/board-template.html && echo "dev data tree-shaken: OK"
grep -q "Download feedback file" skills/managing-research-plans/assets/board-template.html && echo "remote UI present: OK"
```
Expected: `1`, `dev data tree-shaken: OK`, `remote UI present: OK`. If the sentinel grep fails, dev-data was not reverted in Task 8 Step 6 — fix and rebuild.

- [ ] **Step 3: Run the full Python suite against the new template**

Run: `python3 -m unittest tests.test_board -v`
Expected: `OK` (15 tests) — the share tests inject into the real rebuilt template.

- [ ] **Step 4: Commit**

```bash
git add skills/managing-research-plans/assets/board-template.html board/dist/index.html
git commit -m "board: rebuild template with remote mode"
```

---

### Task 10: End-to-end browser roundtrip

**Files:** none created in-repo (scratch dir + Playwright session). This is a verification task; a failure here reopens Tasks 6-9.

**Interfaces:**
- Consumes: the full stack — `--share` (Task 3), the rebuilt template (Task 9), `--collect <file>` (Task 4).

- [ ] **Step 1: Create a scratch fixture project**

```bash
SCRATCH=$(mktemp -d)
python3 - "$SCRATCH" <<'EOF'
import sys
sys.path.insert(0, "tests")
from pathlib import Path
from test_board import make_project
make_project(Path(sys.argv[1]))
EOF
cd "$SCRATCH" && python3 ~/github/research-plans/skills/managing-research-plans/scripts/board.py --share
```
Expected: prints `<scratch>/plans/board-share.html`.

- [ ] **Step 2: Serve it over localhost**

Playwright blocks `file://` URLs (napkin, 2026-07-02), so serve:
```bash
cd "$SCRATCH/plans" && python3 -m http.server 8931
```
(run in background)

- [ ] **Step 3: Browser roundtrip with Playwright**

Using the playwright tooling (`playwright` skill / plugin MCP), against `http://localhost:8931/board-share.html`:

1. Assert the blue orientation banner is visible ("You've been asked to review this research plan").
2. Assert there is **no** "Send to Claude" button anywhere.
3. On the Tracker tab, use the general comment box: type "Timeline looks tight for July." and add it.
4. Open the Plans tab, confirm the draft (v2 proposal) is visible.
5. Open the Feedback drawer; type reviewer name "Test Reviewer"; click "Download feedback file"; capture the download (configure the Playwright download path to the scratch dir). Assert the confirmation line "Feedback file downloaded" appears.
6. If download capture is unavailable in the driver, fall back: click "or copy feedback to clipboard" and read it via `navigator.clipboard.readText()` in an evaluate call, writing the result to `$SCRATCH/feedback.txt`.
7. Reload the page. Assert the annotation and the reviewer name survived (localStorage restore).

- [ ] **Step 4: Ingest the downloaded file**

```bash
cd "$SCRATCH" && python3 ~/github/research-plans/skills/managing-research-plans/scripts/board.py --collect board-feedback-*.txt
```
Expected: document printed with the comment and a fence whose `reviewer` is "Test Reviewer" and `mode` is "remote"; no `STALE` on stderr. Then modify the draft:
```bash
echo "changed" >> plans/execution/01-data-prep/.draft-v2.md
python3 ~/github/research-plans/skills/managing-research-plans/scripts/board.py --collect board-feedback-*.txt 2>&1 >/dev/null | grep STALE
```
Expected: one `STALE` line.

- [ ] **Step 5: Live-mode + gate regression**

In the scratch project, run the live board (`board.py` with no mode flag, `--no-open`, short `--timeout`), fetch `http://127.0.0.1:<port>/` and confirm it renders with the Feedback button and **no** name field or banner (Playwright or curl + grep for "Your name" absent in served HTML is insufficient since it's client-rendered — use Playwright). POST a minimal body to `/api/feedback` with `feedbackDocument` set and confirm the printed document is verbatim. The gate flow itself is exercised by the plugin's existing sign-off usage; confirm `signoff_gate.py` still imports (`cd skills/managing-research-plans/scripts && python3 -c "import signoff_gate"`).

- [ ] **Step 6: Kill the background server, clean up the scratch dir**

---

### Task 11: Command contract, docs, and version 0.5.0

**Files:**
- Modify: `commands/board.md`, `CHANGELOG.md`, `README.md`, `QUICKSTART.md`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `board/package.json`

**Interfaces:**
- Consumes: CLI behavior from Tasks 3-4 (exact flags, stderr markers).
- Produces: the researcher-facing contract.

- [ ] **Step 1: Update `commands/board.md`**

Frontmatter: extend `argument-hint` to:
```
argument-hint: [component name/number | --export | --share [component] | --collect <file>]
```

Step 3 (Resolve the mode) becomes:
```
3. **Resolve the mode.** If `$ARGUMENTS` contains `--export`, go to step 7. If it contains `--share`, go to step 8. If it contains `--collect` with a file path, go to step 9. If it names a component (name or number), resolve it to its `NN-slug` from the master plan for `--focus`.
```

Append two new steps after step 7:

```
8. **Share mode.** Resolve any named component to its `NN-slug`, then run `python3 <script> --share [--focus NN-slug]`. Report the output path and state the privacy reminder in publishing terms: emailing this file IS publishing its embedded plan content to that person — an unfocused share embeds everything under `plans/`; a focused share embeds that component's plans plus the full master plan (always visible by design). Practical notes for the researcher: some mail providers flag `.html` attachments — zip the file or use a Dropbox/Drive link if delivery fails; the collaborator needs only a browser, and sends back a `board-feedback-*.txt` file.

9. **Ingest mode.** Run `python3 <script> --collect <file>`. If stderr contains a `STALE` line, relay it to the researcher before routing anything — never route stale feedback silently; signed versions are immutable so anchors on a signed vN still resolve, but drafts may have moved on. Then route the printed document through step 5 unchanged, with one addition: when the JSON fence has `"mode": "remote"`, attribute decision-log entries as "Board feedback from <reviewer> (remote)" using the fence's `reviewer` field; never add "(remote)" otherwise. Multiple files route one at a time, in the order the researcher chooses. The source file is never deleted by the script; leave it where it is.
```

Renumber nothing else; step 7 (export) stays as is.

- [ ] **Step 2: CHANGELOG entry**

Prepend to `CHANGELOG.md` after the `# Changelog` line:

```markdown
## 0.5.0 (unreleased)

- **Remote plan review**: `/research-plans:board --share [component]` exports a self-contained, annotatable board file (`plans/board-share.html`, gitignored) to email to collaborators — no accounts, no hosting, browser-only. Collaborators annotate, enter their name, and download a `board-feedback-*.txt` file to send back; `/research-plans:board --collect <file>` routes it through the normal feedback pipeline with reviewer attribution and a staleness check (Python-side `shareHash`). Focused shares (`--focus`) embed only that component's plans plus the master plan (always visible by design). Remote gate approval is explicitly out of scope — sign-off stays local. Design doc: `docs/specs/2026-07-03-remote-plan-review-design.md`.
```

- [ ] **Step 3: Version bumps**

- `.claude-plugin/plugin.json` line 3: `"version": "0.5.0",`
- `.claude-plugin/marketplace.json` line 13: `"version": "0.5.0",`
- `board/package.json`: `"version": "0.5.0",`

- [ ] **Step 4: README + QUICKSTART**

In `README.md`, find the board feature section (`grep -n "board" README.md`) and add one bullet:
```markdown
- **Share with collaborators**: `--share` exports an annotatable board file you can email; collaborators comment in their browser and send back a feedback file that `--collect <file>` routes with attribution.
```
In `QUICKSTART.md`, add the same capability in one sentence wherever the board is introduced.

- [ ] **Step 5: Validate the plugin and run everything**

```bash
claude plugin validate ~/github/research-plans --strict
python3 -m unittest tests.test_board -v
cd board && npx tsc --noEmit && npx vitest run
```
Expected: validation passes; 15 Python tests OK; TS clean.

- [ ] **Step 6: Commit**

```bash
git add commands/board.md CHANGELOG.md README.md QUICKSTART.md .claude-plugin/plugin.json .claude-plugin/marketplace.json board/package.json
git commit -m "v0.5.0: remote plan review — share/collect command contract + docs"
```

---

## After the plan

- Update the installed plugin: `claude plugin update research-plans@<marketplace>` (plain `install` will NOT pick up the new version — napkin, 2026-07-02).
- Dogfood: one real email roundtrip (e.g., with Candice) before announcing the release.
