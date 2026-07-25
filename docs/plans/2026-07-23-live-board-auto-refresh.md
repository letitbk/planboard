# Live Board Auto-Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The plain live board picks up plan changes written to disk while it is open: a browser refresh always serves current disk state, and an open tab reloads itself within about 6 seconds of a change, guarded so open comment editors are never destroyed.

**Architecture:** The server keeps an immutable snapshot (payload, generation, html bytes, artifact/report maps, fingerprint) swapped by reference under a lock. A cheap stat-walk fingerprint over `plans/` plus git HEAD/index gates a full payload rebuild through one canonical builder shared with boot. `/api/health` reports the current disk generation; the client compares it to the page's own `data.generation` in a pure helper, debounced two polls, suppressed outside the `online` conn phase, and held while any `[data-reload-guard]` editor is open. Spec: `docs/specs/2026-07-23-live-board-auto-refresh-design.md` (codex review folded; also commit `docs/specs/2026-07-23-live-board-auto-refresh-codex-review.md`).

**Tech Stack:** Python 3 stdlib (`board.py`, `ThreadingHTTPServer`), React + TypeScript + vitest (board/), pytest for `tests/test_board.py`.

## Global Constraints

- Work in a git worktree created via the using-git-worktrees skill from `main`; branch name `live-board-auto-refresh`. Both spec docs above are UNTRACKED in the primary checkout at `/Users/bk/github/research-plans` — Task 1 copies them in and commits them.
- EVERY bash command starts with an explicit `cd <absolute worktree path>` (or `cd <worktree>/board`). Run `git rev-parse --abbrev-ref HEAD` and confirm `live-board-auto-refresh` before EVERY commit.
- `git add` explicit paths only. Never `git add .`, `git add -A`, or `git commit -a`.
- Never include `Co-Authored-By` in commit messages.
- Do NOT run `npm run build` until Task 11 (it regenerates the 460KB template; earlier builds pollute diffs).
- Board tests: `cd <worktree>/board && ./node_modules/.bin/vitest run <file>` — the LOCAL binary, never bare `npx vitest` (a global npx vitest lacks jsdom). If `board/node_modules` is missing in the worktree, symlink it from the primary checkout: `ln -s /Users/bk/github/research-plans/board/node_modules <worktree>/board/node_modules`.
- Python tests: `cd <worktree> && python3 -m pytest tests/test_board.py -q` (loopback binding works on this machine; the HTTP-harness tests must pass).
- `board/src/lib/parse.ts` contains a null byte — use `rg -a` if you ever need to grep it (not modified here).
- The refresh machinery is enabled ONLY when `not sign_mode` (a `sign` payload absent). Gate and ticket-sign boards also have `mode == "live"` — never key the enablement on `payload["mode"]`.
- Prose in .md files: never hard-wrap; one paragraph per line.

---

### Task 1: Commit specs; `payload_generation` exclusions

**Files:**
- Create: `docs/specs/2026-07-23-live-board-auto-refresh-design.md` (copy from primary checkout)
- Create: `docs/specs/2026-07-23-live-board-auto-refresh-codex-review.md` (copy from primary checkout)
- Modify: `skills/managing-planboard/scripts/board.py:1063-1069` (`payload_generation`)
- Test: `tests/test_board.py` (extend the existing `payload_generation` tests near line 2132)

**Interfaces:**
- Consumes: nothing.
- Produces: `payload_generation(payload)` now excludes `generatedAt` and `generation` in addition to the tokens. Every later task relies on: recomputing an unchanged project's payload yields the SAME generation.

- [ ] **Step 1: Copy and commit the spec docs**

```bash
cd <worktree>
cp /Users/bk/github/research-plans/docs/specs/2026-07-23-live-board-auto-refresh-design.md docs/specs/
cp /Users/bk/github/research-plans/docs/specs/2026-07-23-live-board-auto-refresh-codex-review.md docs/specs/
git add docs/specs/2026-07-23-live-board-auto-refresh-design.md docs/specs/2026-07-23-live-board-auto-refresh-codex-review.md
git commit -m "docs(spec): live board auto-refresh design + codex review"
```

- [ ] **Step 2: Write the failing tests**

In `tests/test_board.py`, next to `test_payload_generation_excludes_boot_id` (line 2132), add:

```python
    def test_payload_generation_excludes_generated_at(self):
        base = {"files": {"x": 1}, "generatedAt": "2026-07-23T10:00:00+00:00"}
        later = {"files": {"x": 1}, "generatedAt": "2026-07-23T11:11:11+00:00"}
        self.assertEqual(
            board.payload_generation(base), board.payload_generation(later))

    def test_payload_generation_excludes_self_stamp(self):
        base = {"files": {"x": 1}}
        stamped = {"files": {"x": 1}, "generation": "f" * 64}
        self.assertEqual(
            board.payload_generation(base), board.payload_generation(stamped))
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd <worktree> && python3 -m pytest tests/test_board.py -q -k "generated_at or self_stamp"`
Expected: 2 FAIL (generations differ).

- [ ] **Step 4: Implement**

In `board.py`, change `payload_generation`:

```python
def payload_generation(payload):
    """Content identity of the served payload, excluding per-boot secrets and
    volatile stamps (generatedAt is wall-clock; generation is this hash itself,
    stamped back into the payload for the client)."""
    trimmed = {k: v for k, v in payload.items()
               if k not in ("publishToken", "boardToken", "bootId",
                            "generatedAt", "generation")}
    return hashlib.sha256(
        json.dumps(trimmed, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd <worktree> && python3 -m pytest tests/test_board.py -q -k "payload_generation or generation_stable"`
Expected: all PASS (including the pre-existing exclusion tests).

- [ ] **Step 6: Commit**

```bash
cd <worktree>
git add skills/managing-planboard/scripts/board.py tests/test_board.py
git commit -m "board: exclude generatedAt and the self stamp from payload_generation"
```

---

### Task 2: Canonical live payload builder

**Files:**
- Modify: `skills/managing-planboard/scripts/board.py` (new function after `split_focus`, ~line 438; `cmd_serve` boot at 2936-2946)
- Modify: `tests/test_board.py:1834` (`live_payload` harness helper)
- Test: `tests/test_board.py` (new `TestBuildLivePayload` class)

**Interfaces:**
- Consumes: `collect_payload`, `build_assets`, `split_focus` (existing).
- Produces: `build_live_payload(root, slug, focus_results, focus_view, seeds) -> dict` — the ONLY way a live payload is prepared, at boot and at regeneration. `slug`/`focus_results`/`focus_view` are `split_focus` outputs; `seeds` is the loaded seed-annotation list or None.

- [ ] **Step 1: Write the failing tests**

```python
class TestBuildLivePayload(unittest.TestCase):
    def test_builder_prepares_boot_equivalent_payload(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            p = board.build_live_payload(root, None, None, None, None)
            self.assertEqual(p["mode"], "live")
            self.assertIn("focusResults", p)
            self.assertIn("focusView", p)
            self.assertNotIn("seededAnnotations", p)
            # build_assets ran: the r1 bundle has a live artifact URL
            b = p["files"]["executionPlans"][0]["results"][0]
            self.assertEqual(b["assets"]["fig1.png"],
                             "/artifact/01-data-prep/r1/fig1.png")

    def test_builder_attaches_seeds_and_focus(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            seeds = [{"planPath": "plans/execution/01-data-prep/v1.md",
                      "quote": "thing", "comment": "hm", "author": "rev"}]
            p = board.build_live_payload(root, "01-data-prep", 1, "reports", seeds)
            self.assertEqual(p["focus"], "01-data-prep")
            self.assertEqual(p["focusResults"], 1)
            self.assertEqual(p["focusView"], "reports")
            self.assertEqual(p["seededAnnotations"], seeds)

    def test_builder_generation_is_stable_across_calls(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            g1 = board.payload_generation(board.build_live_payload(root, None, None, None, None))
            g2 = board.payload_generation(board.build_live_payload(root, None, None, None, None))
            self.assertEqual(g1, g2)
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd <worktree> && python3 -m pytest tests/test_board.py -q -k TestBuildLivePayload`
Expected: FAIL with `AttributeError: module 'board' has no attribute 'build_live_payload'`.

- [ ] **Step 3: Implement the builder and use it at boot**

After `split_focus` in `board.py` add:

```python
def build_live_payload(root, slug, focus_results, focus_view, seeds):
    """Canonical live-board payload: exactly the preparation cmd_serve does at
    boot, so a regeneration hashes comparably to the served payload. Any step
    added to live boot preparation MUST be added here, never inline."""
    payload = collect_payload(root, "live", slug)
    payload["focusResults"] = focus_results
    payload["focusView"] = focus_view
    build_assets(root, payload)
    if seeds:
        payload["seededAnnotations"] = seeds
    return payload
```

In `cmd_serve` (lines 2936-2946), replace:

```python
        slug, focus_results, focus_view = split_focus(args.focus)
        payload = collect_payload(root, "live", slug)
        payload["focusResults"] = focus_results
        payload["focusView"] = focus_view
        build_assets(root, payload)
        if args.seed_annotations:
            # Agent plan review (v0.9): reviewer-produced comments, seeded as
            # pending annotations for the researcher to curate and Send to Claude.
            seeds = load_seed_annotations(args.seed_annotations)
            if seeds:
                payload["seededAnnotations"] = seeds
```

with:

```python
        slug, focus_results, focus_view = split_focus(args.focus)
        # Agent plan review (v0.9): reviewer-produced comments, seeded as
        # pending annotations for the researcher to curate and Send to Claude.
        seeds = (load_seed_annotations(args.seed_annotations)
                 if args.seed_annotations else None)
        payload = build_live_payload(root, slug, focus_results, focus_view,
                                     seeds or None)
```

In `tests/test_board.py:1834`, change the harness helper:

```python
def live_payload(root):
    return board.build_live_payload(root, None, None, None, None)
```

- [ ] **Step 4: Run tests**

Run: `cd <worktree> && python3 -m pytest tests/test_board.py -q`
Expected: full file PASS (the harness change touches many tests — everything must stay green).

- [ ] **Step 5: Commit**

```bash
cd <worktree>
git add skills/managing-planboard/scripts/board.py tests/test_board.py
git commit -m "board: factor build_live_payload as the one canonical live payload builder"
```

---

### Task 3: Fingerprint and git-dir resolution

**Files:**
- Modify: `skills/managing-planboard/scripts/board.py` (new module functions after `project_id`, ~line 885)
- Test: `tests/test_board.py` (new `TestPlansFingerprint` class)

**Interfaces:**
- Consumes: nothing new.
- Produces: `fingerprint_excluded(name) -> bool`; `resolve_git_paths(root) -> list[Path]` (HEAD and index in the REAL git dir, `[]` when git unavailable); `plans_fingerprint(root, git_paths) -> tuple` (hashable, compared by equality).

- [ ] **Step 1: Write the failing tests**

```python
class TestPlansFingerprint(unittest.TestCase):
    def _fp(self, root):
        return board.plans_fingerprint(root, [])

    def test_draft_write_changes_fingerprint(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            f1 = self._fp(root)
            (root / "plans" / "execution" / "02-other" / ".draft-v2.md"
             ).write_text("# v2\n", encoding="utf-8")
            self.assertNotEqual(f1, self._fp(root))

    def test_bookkeeping_writes_do_not_change_fingerprint(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            plans = make_project(root)
            f1 = self._fp(root)
            (plans / ".board.lock").write_text("{}", encoding="utf-8")
            (plans / ".board-feedback.md").write_text("x", encoding="utf-8")
            (plans / ".board-feedback.md.tmp").write_text("x", encoding="utf-8")
            (plans / ".import-approved-01-data-prep-v2").write_text("h", encoding="utf-8")
            (plans / "execution" / "01-data-prep" / ".sign-feedback-v2.md"
             ).write_text("no", encoding="utf-8")
            self.assertEqual(f1, self._fp(root))

    def test_new_empty_directory_changes_fingerprint(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            f1 = self._fp(root)
            (root / "plans" / "execution" / "02-other" / "results" / ".staging-a"
             ).mkdir(parents=True)
            self.assertNotEqual(f1, self._fp(root))

    def test_git_paths_resolve_in_linked_worktree(self):
        with tempfile.TemporaryDirectory() as d:
            main = Path(d) / "main"
            main.mkdir()
            subprocess.run(["git", "init", "-q"], cwd=main, check=True)
            subprocess.run(["git", "-C", str(main), "commit", "-q",
                            "--allow-empty", "-m", "x"], check=True,
                           env={**os.environ, "GIT_AUTHOR_NAME": "t",
                                "GIT_AUTHOR_EMAIL": "t@t",
                                "GIT_COMMITTER_NAME": "t",
                                "GIT_COMMITTER_EMAIL": "t@t"})
            wt = Path(d) / "wt"
            subprocess.run(["git", "-C", str(main), "worktree", "add", "-q",
                            str(wt)], check=True)
            paths = board.resolve_git_paths(wt)
            self.assertTrue(paths, "expected git paths in a linked worktree")
            self.assertTrue(paths[0].name == "HEAD" and paths[0].is_file())

    def test_git_paths_empty_outside_repo(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(board.resolve_git_paths(Path(d)), [])
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd <worktree> && python3 -m pytest tests/test_board.py -q -k TestPlansFingerprint`
Expected: FAIL with `AttributeError` (functions missing).

- [ ] **Step 3: Implement**

After `project_id` in `board.py`:

```python
_FP_EXACT = {".board.lock", ".board-feedback.md", ".board-feedback.md.tmp",
             ".board-web"}


def fingerprint_excluded(name):
    """Bookkeeping the board machinery itself writes during a session. Draft
    files (.draft-vN.md) are dotfiles and MUST be fingerprinted, so this is a
    list of specific server-written names, never 'all dotfiles'."""
    return (name in _FP_EXACT
            or name.startswith(".import-approved-")
            or (name.startswith(".sign-feedback-v") and name.endswith(".md")))


def resolve_git_paths(root):
    """HEAD and index inside the repository's REAL git directory ([] when git
    is unavailable). Resolved via rev-parse because in a linked worktree .git
    is a file, not a directory."""
    try:
        r = subprocess.run(["git", "rev-parse", "--absolute-git-dir"],
                           capture_output=True, text=True, cwd=str(root),
                           timeout=10)
    except Exception:
        return []
    if r.returncode != 0:
        return []
    gd = Path(r.stdout.strip())
    return [gd / "HEAD", gd / "index"]


def plans_fingerprint(root, git_paths):
    """Cheap disk-change detector for the live board: stat entries for every
    file and directory under plans/ (minus server bookkeeping) plus git
    HEAD/index mtimes. Equality means 'no rebuild needed'; any difference
    triggers a full payload rebuild whose generation decides staleness."""
    entries = []
    plans = str(root / "plans")
    for dirpath, dirnames, filenames in os.walk(plans):
        dirnames.sort()
        rel = os.path.relpath(dirpath, plans)
        for dname in dirnames:
            entries.append(("d", os.path.join(rel, dname)))
        for fn in sorted(filenames):
            if fingerprint_excluded(fn):
                continue
            try:
                st = os.stat(os.path.join(dirpath, fn))
            except OSError:
                continue
            entries.append(("f", os.path.join(rel, fn),
                            st.st_mtime_ns, st.st_size))
    for gp in git_paths:
        try:
            entries.append(("g", str(gp), gp.stat().st_mtime_ns))
        except OSError:
            entries.append(("g", str(gp), None))
    return tuple(entries)
```

- [ ] **Step 4: Run tests**

Run: `cd <worktree> && python3 -m pytest tests/test_board.py -q -k TestPlansFingerprint`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
cd <worktree>
git add skills/managing-planboard/scripts/board.py tests/test_board.py
git commit -m "board: plans fingerprint + worktree-safe git paths for live refresh"
```

---

### Task 4: Snapshot machinery — refresh on GET, report on health

**Files:**
- Modify: `skills/managing-planboard/scripts/board.py` `serve()` (boot block 1297-1309; handlers: `/api/health` 1392-1396, `/artifact/` 1404-1420, `/report/` 1421-1436, root GET 1437-1444, `/api/feedback` 1502-1505, `/api/deny` 1542-1545)
- Test: `tests/test_board.py` (new `TestLiveRefreshHTTP` class)

**Interfaces:**
- Consumes: `build_live_payload` (Task 2), `plans_fingerprint`/`resolve_git_paths` (Task 3), `payload_generation` (Task 1).
- Produces: inside `serve()`: `prepare_snapshot(p, fp) -> dict` with keys `payload, generation, html, amap, rmap, fingerprint`; `current_snapshot() -> dict`; `disk_snapshot(promote=False) -> dict`. `/api/health` JSON `generation` is now the CURRENT DISK generation; root GET swaps and serves fresh bytes; the served payload carries `payload["generation"]`.

- [ ] **Step 1: Write the failing tests**

```python
class TestLiveRefreshHTTP(unittest.TestCase):
    def _health(self, url):
        with urllib.request.urlopen(url + "/api/health", timeout=5) as r:
            return json.loads(r.read())

    def _root_html(self, url):
        with urllib.request.urlopen(url, timeout=5) as r:
            return r.read().decode("utf-8")

    def test_health_reports_new_generation_after_draft_write(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            url, info, t = serve_in_thread(root)
            g1 = self._health(url)["generation"]
            (root / "plans" / "execution" / "02-other" / ".draft-v2.md"
             ).write_text("# Other v2 draft\n\nNew direction.\n", encoding="utf-8")
            g2 = self._health(url)["generation"]
            self.assertNotEqual(g1, g2)
            self.assertEqual(self._health(url)["generation"], g2)  # stable now

    def test_health_generation_stable_when_nothing_changes(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            url, info, t = serve_in_thread(root)
            self.assertEqual(self._health(url)["generation"],
                             self._health(url)["generation"])

    def test_root_get_serves_fresh_content_with_same_boot_identity(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            url, info, t = serve_in_thread(root)
            h1 = self._health(url)
            payload1 = extract_payload(self._root_html(url))
            (root / "plans" / "execution" / "02-other" / ".draft-v2.md"
             ).write_text("# Other v2 draft\n\nFRESH-MARKER-XYZ\n", encoding="utf-8")
            html2 = self._root_html(url)
            payload2 = extract_payload(html2)
            self.assertIn("FRESH-MARKER-XYZ", html2)
            self.assertEqual(payload1["bootId"], payload2["bootId"])
            self.assertEqual(payload1["boardToken"], payload2["boardToken"])
            self.assertNotEqual(payload1["generation"], payload2["generation"])
            self.assertEqual(self._health(url)["bootId"], h1["bootId"])

    def test_post_token_still_valid_after_swap(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            url, info, t = serve_in_thread(root)
            (root / "plans" / "execution" / "02-other" / ".draft-v2.md"
             ).write_text("# v2\n", encoding="utf-8")
            self._root_html(url)  # forces the swap
            status, body, _ = http_json(url, "/api/feedback", body={
                "boardToken": info["boardToken"],
                "feedbackDocument": "# Feedback\n\nfine\n",
                "annotations": [],
            })
            self.assertEqual(status, 200)

    def test_new_artifact_served_after_regeneration(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            url, info, t = serve_in_thread(root)
            adir = (root / "plans" / "execution" / "01-data-prep"
                    / "results" / "r1" / "artifacts")
            (adir / "fig2.png").write_bytes(b"\x89PNG r1 fig2")
            html = self._root_html(url)
            self.assertIn("/artifact/01-data-prep/r1/fig2.png", html)
            with urllib.request.urlopen(
                    url + "/artifact/01-data-prep/r1/fig2.png", timeout=5) as r:
                self.assertEqual(r.status, 200)

    def test_deleted_artifact_returns_404(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            url, info, t = serve_in_thread(root)
            (root / "plans" / "execution" / "01-data-prep" / "results" / "r1"
             / "artifacts" / "fig1.png").unlink()
            try:
                urllib.request.urlopen(
                    url + "/artifact/01-data-prep/r1/fig1.png", timeout=5)
                self.fail("expected HTTPError")
            except urllib.error.HTTPError as e:
                self.assertEqual(e.code, 404)
```

Note on the 404 test: deleting the file also changes the fingerprint, so the artifact may vanish from the fresh map (404 via lookup) or, if the request races ahead of a root GET, hit the old map and fail at `read_bytes()` — the handler must return 404 on BOTH paths.

- [ ] **Step 2: Run to verify they fail**

Run: `cd <worktree> && python3 -m pytest tests/test_board.py -q -k TestLiveRefreshHTTP`
Expected: FAIL (health generation never changes; fresh marker absent; KeyError `generation` in payload).

- [ ] **Step 3: Implement the snapshot machinery**

In `serve()`, replace lines 1297-1309 in full (from `boot_id = uuid.uuid4().hex` through `html_bytes = html.encode("utf-8")` — the whole boot-identity/inject block; token and id stamping moves inside `prepare_snapshot`) with:

```python
    boot_id = uuid.uuid4().hex
    publish_token = hashlib.sha256(os.urandom(32)).hexdigest()
    board_token = hashlib.sha256(os.urandom(32)).hexdigest()
    proj_id = project_id(root)
    template_text = template_path().read_text(encoding="utf-8")
    refreshable = not sign_mode
    git_paths = resolve_git_paths(root) if refreshable else []
    boot_focus = payload.get("focus")
    boot_focus_results = payload.get("focusResults")
    boot_focus_view = payload.get("focusView")
    boot_seeds = payload.get("seededAnnotations")

    def prepare_snapshot(p, fp):
        """Stamp process identity into a prepared live payload, inject, and
        derive the routing maps. Snapshots are immutable by convention: swapped
        by reference under state_lock, never edited in place."""
        p["publishToken"] = publish_token
        p["projectId"] = proj_id
        p["boardToken"] = board_token
        p["bootId"] = boot_id
        gen = payload_generation(p)
        p["generation"] = gen
        return {
            "payload": p,
            "generation": gen,
            "html": inject(template_text, p).encode("utf-8"),
            "amap": artifact_map(root, p),
            "rmap": report_map(root, p),
            "fingerprint": fp,
        }

    state_lock = threading.Lock()    # guards the state["snap"] reference only
    refresh_lock = threading.Lock()  # serializes fingerprint + rebuild;
                                     # ordering: refresh_lock -> state_lock
    state = {"snap": prepare_snapshot(
        payload, plans_fingerprint(root, git_paths) if refreshable else None)}
    candidate = {"fp": None, "snap": None}  # built-but-unpromoted; refresh_lock

    def current_snapshot():
        with state_lock:
            return state["snap"]

    def disk_snapshot(promote=False):
        """The snapshot matching current disk state. Never raises: any failure
        while rebuilding keeps the served snapshot and is NOT cached, so the
        next call retries. promote=True (root GET) swaps a differing snapshot
        in as the served one; health reads without promoting."""
        if not refreshable:
            return current_snapshot()
        with refresh_lock:
            snap = current_snapshot()
            try:
                fp = plans_fingerprint(root, git_paths)
            except OSError:
                return snap
            if fp == snap["fingerprint"]:
                return snap
            if candidate["fp"] == fp and candidate["snap"] is not None:
                cand = candidate["snap"]
            else:
                try:
                    cand = prepare_snapshot(build_live_payload(
                        root, boot_focus, boot_focus_results,
                        boot_focus_view, boot_seeds), fp)
                except BaseException:  # SystemExit from die() included
                    return snap
            if cand["generation"] == snap["generation"]:
                # Content-identical (fingerprint false positive, e.g. a touch):
                # adopt the fingerprint so this cadence stops rebuilding.
                adopted = dict(snap)
                adopted["fingerprint"] = fp
                with state_lock:
                    state["snap"] = adopted
                candidate["fp"] = candidate["snap"] = None
                return adopted
            if promote:
                with state_lock:
                    state["snap"] = cand
                candidate["fp"] = candidate["snap"] = None
            else:
                candidate["fp"], candidate["snap"] = fp, cand
            return cand
```

Nothing from the replaced block survives elsewhere: `amap`, `rmap`, `generation`, `html`, and `html_bytes` were only read by the handlers rewired in Step 4, and the token/id variables are re-declared inside the new block. Keep `draft_map = draft_map_from_payload(payload)` and everything else in `serve()` as is.

- [ ] **Step 4: Rewire the handlers**

`/api/health` (was 1392-1396):

```python
            if self.path == "/api/health":
                snap = disk_snapshot()
                self._json(200, {"ok": True, "app": "planboard-board",
                                 "bootId": boot_id,
                                 "generation": snap["generation"],
                                 "projectId": proj_id}, no_store=True)
                return
```

`/artifact/` (was 1404-1420) — snapshot map + deletion hardening:

```python
            if self.path.startswith("/artifact/"):
                f = current_snapshot()["amap"].get(self.path)
                if f is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                try:
                    data = f.read_bytes()
                except OSError:
                    self.send_response(404)
                    self.end_headers()
                    return
                mime, dispo = artifact_headers(f.name)
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Disposition", dispo)
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Content-Security-Policy", "sandbox")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
```

`/report/` (was 1421-1436): same pattern — `f = current_snapshot()["rmap"].get(self.path)` and `try/except OSError` around `f.read_bytes()` returning 404.

Root GET (was 1437-1444):

```python
            snap = disk_snapshot(promote=True)
            body = snap["html"]
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Content-Security-Policy", "frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(body)
```

`/api/feedback` (1502-1505) and `/api/deny` (1542-1545): replace the captured `payload` in the lambdas with the served one:

```python
                    lambda aid: document_from_body(
                        body, current_snapshot()["payload"], action_id=aid),
```

- [ ] **Step 5: Run the new tests, then the whole file**

Run: `cd <worktree> && python3 -m pytest tests/test_board.py -q -k TestLiveRefreshHTTP`
Expected: 6 PASS.
Run: `cd <worktree> && python3 -m pytest tests/test_board.py -q`
Expected: full PASS — the existing health/serve/sign/gate tests must not regress.

- [ ] **Step 6: Commit**

```bash
cd <worktree>
git add skills/managing-planboard/scripts/board.py tests/test_board.py
git commit -m "board: live board serves current disk state (snapshot swap on GET, fresh generation on health)"
```

---

### Task 5: Hardening — frozen modes, failure retry, boot-field survival, concurrency

**Files:**
- Modify: `skills/managing-planboard/scripts/board.py` (only if a test exposes a gap — the Task 4 code is designed to pass these)
- Test: `tests/test_board.py` (extend `TestLiveRefreshHTTP`)

**Interfaces:**
- Consumes: Task 4's `serve()` behavior.
- Produces: proven invariants later tasks and reviewers rely on; no new API.

- [ ] **Step 1: Write the tests**

```python
    def test_sign_modes_never_regenerate(self):
        for transport in ("hook", "ticket"):
            with tempfile.TemporaryDirectory() as d:
                root = Path(d)
                make_project(root)
                payload = live_payload(root)
                item = {"component": "01-data-prep", "proposedVersion": 2,
                        "path": "plans/execution/01-data-prep/.draft-v2.md",
                        "content": "# Data prep v2 draft\n\nDo it better.\n",
                        "contentHash": hashlib.sha256(
                            "# Data prep v2 draft\n\nDo it better.\n"
                            .encode("utf-8")).hexdigest(),
                        "ticketed": False}
                payload["sign"] = {"batchId": "t1", "transport": transport,
                                   "items": [item]}
                url, info, t = serve_in_thread(root, payload=payload)
                g1 = self._health(url)["generation"]
                (root / "plans" / "execution" / "02-other" / ".draft-v2.md"
                 ).write_text("# v2\n", encoding="utf-8")
                self.assertEqual(self._health(url)["generation"], g1,
                                 "transport %s regenerated" % transport)

    def test_build_failure_keeps_serving_then_recovers(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            url, info, t = serve_in_thread(root)
            g1 = self._health(url)["generation"]
            mp = root / "plans" / "master-plan.md"
            saved = mp.read_text(encoding="utf-8")
            mp.unlink()  # collect_payload die()s without a master plan
            self.assertEqual(self._health(url)["generation"], g1)
            self.assertIn("bootId", extract_payload(self._root_html(url)))
            mp.write_text(saved + "\nRECOVERED\n", encoding="utf-8")
            self.assertNotEqual(self._health(url)["generation"], g1,
                                "failed fingerprint must not be cached")

    def test_boot_fields_survive_regeneration(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            seeds = [{"planPath": "plans/execution/01-data-prep/v1.md",
                      "quote": "thing", "comment": "hm", "author": "rev"}]
            payload = board.build_live_payload(
                root, "01-data-prep", 1, "reports", seeds)
            url, info, t = serve_in_thread(root, payload=payload)
            (root / "plans" / "execution" / "02-other" / ".draft-v2.md"
             ).write_text("# v2\n", encoding="utf-8")
            fresh = extract_payload(self._root_html(url))
            self.assertEqual(fresh["focus"], "01-data-prep")
            self.assertEqual(fresh["focusResults"], 1)
            self.assertEqual(fresh["focusView"], "reports")
            self.assertEqual(fresh["seededAnnotations"], seeds)
            self.assertEqual(fresh["projectId"], board.project_id(root))

    def test_concurrent_gets_and_health_stay_coherent(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            url, info, t = serve_in_thread(root)
            g1 = self._health(url)["generation"]
            (root / "plans" / "execution" / "02-other" / ".draft-v2.md"
             ).write_text("# v2\n", encoding="utf-8")
            results, errors = [], []

            def hit(i):
                try:
                    if i % 2:
                        results.append(self._health(url)["generation"])
                    else:
                        p = extract_payload(self._root_html(url))
                        # a served page is internally coherent
                        results.append(p["generation"])
                except Exception as e:  # noqa: BLE001
                    errors.append(e)

            threads = [threading.Thread(target=hit, args=(i,)) for i in range(8)]
            for th in threads:
                th.start()
            for th in threads:
                th.join()
            self.assertEqual(errors, [])
            g2 = self._health(url)["generation"]
            self.assertNotEqual(g1, g2)
            self.assertTrue(set(results) <= {g1, g2}, results)
```

- [ ] **Step 2: Run**

Run: `cd <worktree> && python3 -m pytest tests/test_board.py -q -k TestLiveRefreshHTTP`
Expected: all PASS. If `test_sign_modes_never_regenerate` fails, the `refreshable` flag leaked into a sign path; if `test_build_failure_keeps_serving_then_recovers` fails on the last assert, a failed build cached its fingerprint — fix in `disk_snapshot` (failure must `return snap` BEFORE any caching).

- [ ] **Step 3: Run the full Python suite**

Run: `cd <worktree> && python3 -m pytest tests/test_board.py -q`
Expected: full PASS.

- [ ] **Step 4: Commit**

```bash
cd <worktree>
git add tests/test_board.py skills/managing-planboard/scripts/board.py
git commit -m "board: live-refresh hardening tests (frozen sign modes, failure retry, boot fields, concurrency)"
```

---

### Task 6: Model-profile save returns the fresh disk generation

**Files:**
- Modify: `skills/managing-planboard/scripts/board.py:1656-1660` (`/api/model-profile` POST)
- Test: `tests/test_board.py` (extend the existing model-profile HTTP tests, near line 3033)

**Interfaces:**
- Consumes: `disk_snapshot` (Task 4).
- Produces: the 200 response of `/api/model-profile` gains `payloadGeneration: <64-hex>` — the disk generation AFTER the save. NOTE: the response already has a `generation` key (agent regeneration results) — do not touch it; the new key is `payloadGeneration`.

- [ ] **Step 1: Write the failing test**

Add next to the existing model-profile POST tests (find them with `grep -n "api/model-profile" tests/test_board.py`; they use `serve_in_thread` + a POST helper — mirror the file's existing request pattern):

```python
    def test_profile_save_returns_fresh_payload_generation(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            url, info, t = serve_in_thread(root)
            _, boot_health, _ = http_json(url, "/api/health")
            status, out, _ = http_json(url, "/api/model-profile", body={
                "boardToken": info["boardToken"], "create": True})
            self.assertEqual(status, 200)
            self.assertEqual(len(out.get("payloadGeneration", "")), 64)
            self.assertNotEqual(out["payloadGeneration"], boot_health["generation"])
            _, health, _ = http_json(url, "/api/health")
            self.assertEqual(out["payloadGeneration"], health["generation"])
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd <worktree> && python3 -m pytest tests/test_board.py -q -k "profile_save_returns"`
Expected: FAIL (`payloadGeneration` absent).

- [ ] **Step 3: Implement**

At `board.py:1656-1660`, inside the handler:

```python
            if self.path == "/api/model-profile" and not sign_mode:
                with profile_lock:
                    status, out = apply_model_profile(root, body)
                # Saving wrote plans/model-profile.md: hand the saving tab the
                # post-save disk generation so it advances its baseline instead
                # of self-reloading ~6s later. (profile_lock -> refresh_lock is
                # the one-way lock order; nothing acquires them reversed.)
                if status == 200:
                    out["payloadGeneration"] = disk_snapshot()["generation"]
                self._json(status, out)
                return
```

(Adjust to the file's actual surrounding code — keep the existing `profile_lock` usage and `_json` call; only add the `payloadGeneration` line.)

- [ ] **Step 4: Run tests**

Run: `cd <worktree> && python3 -m pytest tests/test_board.py -q -k "profile"`
Expected: PASS, including all pre-existing profile tests.

- [ ] **Step 5: Commit**

```bash
cd <worktree>
git add skills/managing-planboard/scripts/board.py tests/test_board.py
git commit -m "board: model-profile save response carries the fresh payloadGeneration"
```

---

### Task 7: `staleness.ts` pure helper

**Files:**
- Create: `board/src/lib/staleness.ts`
- Test: `board/src/lib/staleness.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, like `reconnect.ts`).
- Produces: `StaleState { seen: string | null; count: number }`, `initialStale`, `STALE_POLLS_TO_FIRE = 2`, `reduceStale(s, health, page, phaseKind) -> StaleState`, `shouldStaleReload(s) -> boolean`, `reloadGuardHeld(doc: Document) -> boolean`.

- [ ] **Step 1: Write the failing tests**

`board/src/lib/staleness.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  initialStale,
  reduceStale,
  reloadGuardHeld,
  shouldStaleReload,
} from "./staleness";

const PAGE = { generation: "g-page", projectId: "p1" };
const h = (generation: string, projectId = "p1") => ({ generation, projectId });

describe("reduceStale", () => {
  it("fires after two consecutive polls of the same foreign generation", () => {
    let s = reduceStale(initialStale, h("g-new"), PAGE, "online");
    expect(shouldStaleReload(s)).toBe(false);
    s = reduceStale(s, h("g-new"), PAGE, "online");
    expect(shouldStaleReload(s)).toBe(true);
  });

  it("resets on a matching poll", () => {
    let s = reduceStale(initialStale, h("g-new"), PAGE, "online");
    s = reduceStale(s, h("g-page"), PAGE, "online");
    expect(s).toEqual(initialStale);
  });

  it("restarts the count when the mismatching generation changes", () => {
    let s = reduceStale(initialStale, h("g-a"), PAGE, "online");
    s = reduceStale(s, h("g-b"), PAGE, "online");
    expect(shouldStaleReload(s)).toBe(false);
    s = reduceStale(s, h("g-b"), PAGE, "online");
    expect(shouldStaleReload(s)).toBe(true);
  });

  it("ignores foreign projects", () => {
    let s = reduceStale(initialStale, h("g-new", "OTHER"), PAGE, "online");
    s = reduceStale(s, h("g-new", "OTHER"), PAGE, "online");
    expect(shouldStaleReload(s)).toBe(false);
  });

  it("suppresses in every non-online phase", () => {
    for (const phase of ["submitting", "accepted", "applying", "stalled", "sleeping"]) {
      let s = reduceStale(initialStale, h("g-new"), PAGE, phase);
      s = reduceStale(s, h("g-new"), PAGE, phase);
      expect(shouldStaleReload(s)).toBe(false);
    }
  });

  it("does nothing without a page generation (pre-refresh servers)", () => {
    const page = { generation: null, projectId: "p1" };
    let s = reduceStale(initialStale, h("g-new"), page, "online");
    s = reduceStale(s, h("g-new"), page, "online");
    expect(shouldStaleReload(s)).toBe(false);
  });
});

describe("reloadGuardHeld", () => {
  it("holds while a data-reload-guard element exists", () => {
    const el = document.createElement("div");
    el.setAttribute("data-reload-guard", "");
    document.body.appendChild(el);
    expect(reloadGuardHeld(document)).toBe(true);
    el.remove();
    expect(reloadGuardHeld(document)).toBe(false);
  });

  it("holds while a textarea is focused", () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    expect(reloadGuardHeld(document)).toBe(true);
    ta.blur();
    ta.remove();
    expect(reloadGuardHeld(document)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd <worktree>/board && ./node_modules/.bin/vitest run src/lib/staleness.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`board/src/lib/staleness.ts`:

```ts
// Content-staleness tracker for the live board: compares the page's own
// payload generation (data.generation) against /api/health's current disk
// generation. Pure and framework-free, like reconnect.ts. Process identity
// (bootId) reloads live in reconnect.ts and take precedence; this module only
// handles same-boot content drift.

export const STALE_POLLS_TO_FIRE = 2;

export interface StaleState {
  seen: string | null; // the mismatching generation observed last poll
  count: number; // consecutive polls that saw exactly `seen`
}

export const initialStale: StaleState = { seen: null, count: 0 };

export function reduceStale(
  s: StaleState,
  health: { generation?: string; projectId: string },
  page: { generation: string | null; projectId: string },
  phaseKind: string,
): StaleState {
  if (phaseKind !== "online") return initialStale;
  if (!page.generation || !health.generation) return initialStale;
  if (health.projectId !== page.projectId) return initialStale;
  if (health.generation === page.generation) return initialStale;
  if (health.generation === s.seen) return { seen: s.seen, count: s.count + 1 };
  return { seen: health.generation, count: 1 };
}

export function shouldStaleReload(s: StaleState): boolean {
  return s.count >= STALE_POLLS_TO_FIRE;
}

/** True while reloading would destroy transient text: any open editor marked
 * data-reload-guard, or a focused free-text field (fallback for fields that
 * predate the convention). */
export function reloadGuardHeld(doc: Document): boolean {
  if (doc.querySelector("[data-reload-guard]")) return true;
  const ae = doc.activeElement;
  if (!ae) return false;
  const tag = ae.tagName.toLowerCase();
  return (
    tag === "textarea" ||
    (tag === "input" && (ae as HTMLInputElement).type === "text")
  );
}
```

- [ ] **Step 4: Run tests**

Run: `cd <worktree>/board && ./node_modules/.bin/vitest run src/lib/staleness.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd <worktree>
git add board/src/lib/staleness.ts board/src/lib/staleness.test.ts
git commit -m "board: pure staleness helper (generation compare, debounce, reload guard)"
```

---

### Task 8: App wiring — compare, reload, held notice

**Files:**
- Modify: `board/src/lib/types.ts:3-42` (`BoardData`)
- Modify: `board/src/App.tsx` (poll effect 744-763; notice render ~1000)
- Test: `board/src/App.staleness.test.tsx` (new)

**Interfaces:**
- Consumes: `staleness.ts` (Task 7); server behavior (Tasks 4-5).
- Produces: `BoardData.generation?: string`; App state `pageGenRef` (advanced by Task 10) and `setStaleHeld`; the persistent notice UI with a "Refresh now" button.

- [ ] **Step 1: Write the failing tests**

`board/src/App.staleness.test.tsx` (mirror `App.recovery.test.tsx`'s fixture/mocking style; use `vi.useFakeTimers` like `autoClose.test.tsx`):

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import App from "./App";
import type { BoardData } from "./lib/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

function liveFixture(): BoardData {
  return {
    schemaVersion: 2, generatedAt: "2026-07-23T00:00", mode: "live",
    focus: null, projectId: "p1", bootId: "b1", boardToken: "token",
    generation: "g-page",
    project: { name: "p" }, git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [],
      reviews: [],
    },
  } as BoardData;
}

function stubHealth(generation: string) {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, bootId: "b1", projectId: "p1", generation }),
  })) as unknown as typeof fetch);
}

function stubReload() {
  const reload = vi.fn();
  const orig = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...orig, reload },
  });
  return reload;
}

async function polls(n: number) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
  }
}

describe("generation staleness wiring", () => {
  it("reloads after two mismatching polls", async () => {
    stubHealth("g-disk");
    const reload = stubReload();
    render(<App data={liveFixture()} />);
    await polls(2);
    expect(reload).toHaveBeenCalled();
  });

  it("holds with a guard element open, shows the notice, refreshes on demand", async () => {
    stubHealth("g-disk");
    const reload = stubReload();
    const guard = document.createElement("div");
    guard.setAttribute("data-reload-guard", "");
    document.body.appendChild(guard);
    render(<App data={liveFixture()} />);
    await polls(2);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText(/Plans changed on disk/)).toBeTruthy();
    screen.getByText("Refresh now").click();
    expect(reload).toHaveBeenCalled();
    guard.remove();
  });

  it("clears the notice when disk returns to the page generation", async () => {
    const reload = stubReload();
    const guard = document.createElement("div");
    guard.setAttribute("data-reload-guard", "");
    document.body.appendChild(guard);
    stubHealth("g-disk");
    render(<App data={liveFixture()} />);
    await polls(2);
    expect(screen.getByText(/Plans changed on disk/)).toBeTruthy();
    stubHealth("g-page");
    await polls(1);
    expect(screen.queryByText(/Plans changed on disk/)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
    guard.remove();
  });

  it("never fires on a matching generation", async () => {
    stubHealth("g-page");
    const reload = stubReload();
    render(<App data={liveFixture()} />);
    await polls(4);
    expect(reload).not.toHaveBeenCalled();
  });
});
```

If `render(<App data={...} />)` does not match `App.recovery.test.tsx`'s actual mounting call, copy that file's exact mounting pattern instead — the assertions stay the same.

- [ ] **Step 2: Run to verify they fail**

Run: `cd <worktree>/board && ./node_modules/.bin/vitest run src/App.staleness.test.tsx`
Expected: FAIL (no reload; no notice; `generation` not in BoardData type — tsc error is also a valid failure signal).

- [ ] **Step 3: Implement**

`types.ts` — after the `bootId?` line (~22):

```ts
  generation?: string; // live: content identity of this served payload; compared against /api/health for auto-refresh
```

`App.tsx` — imports:

```ts
import {
  initialStale,
  reduceStale,
  reloadGuardHeld,
  shouldStaleReload,
  type StaleState,
} from "./lib/staleness";
```

State, next to the conn state (~733):

```ts
  // Content staleness (auto-refresh): the page's generation baseline is a ref
  // because a model-profile save advances it without any re-render need.
  const pageGenRef = useRef<string | null>(data.generation ?? null);
  const staleRef = useRef<StaleState>(initialStale);
  const [staleHeld, setStaleHeld] = useState(false);
  const pollBusy = useRef(false);
```

Replace the poll effect body (744-763) with:

```ts
  useEffect(() => {
    if (!canPost) return;
    const t = setInterval(async () => {
      if (pollBusy.current) return; // a slow collect must not overlap polls
      pollBusy.current = true;
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        if (!r.ok) throw new Error("bad health");
        const h = (await r.json()) as {
          bootId: string;
          projectId: string;
          generation?: string;
        };
        if (shouldReload(connRef.current, h)) {
          location.reload();
          return;
        }
        dispatchConn({ type: "health", bootId: h.bootId,
                       projectId: h.projectId, now: Date.now() });
        staleRef.current = reduceStale(
          staleRef.current,
          h,
          { generation: pageGenRef.current, projectId: data.projectId ?? "" },
          connRef.current.phase.kind,
        );
        if (shouldStaleReload(staleRef.current)) {
          if (reloadGuardHeld(document)) {
            setStaleHeld(true);
          } else {
            location.reload();
            return;
          }
        } else {
          setStaleHeld(false);
        }
      } catch {
        dispatchConn({ type: "health-miss", now: Date.now() });
      } finally {
        pollBusy.current = false;
      }
    }, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPost]);
```

Notice UI — insert directly after the `syncNotice` block (App.tsx ~1000-1004):

```tsx
      {canPost && staleHeld && (
        <div className="fixed bottom-12 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-3 py-1.5 text-xs text-stone-700 dark:text-stone-200 shadow-lg">
          <span>Plans changed on disk. The board will refresh when you finish.</span>
          <button
            className="rounded bg-stone-900 dark:bg-stone-200 px-2 py-0.5 text-[11px] font-medium text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-400"
            onClick={() => location.reload()}
          >
            Refresh now
          </button>
        </div>
      )}
```

- [ ] **Step 4: Run the new tests, then the whole board suite**

Run: `cd <worktree>/board && ./node_modules/.bin/vitest run src/App.staleness.test.tsx`
Expected: 4 PASS.
Run: `cd <worktree>/board && ./node_modules/.bin/vitest run`
Expected: full PASS (the reconnect/recovery tests must not regress — the bootId path is untouched).

- [ ] **Step 5: Commit**

```bash
cd <worktree>
git add board/src/lib/types.ts board/src/App.tsx board/src/App.staleness.test.tsx
git commit -m "board: auto-reload the live tab on generation drift, held while editors are open"
```

---

### Task 9: `data-reload-guard` on every transient editor

**Files:**
- Modify: `board/src/components/AnnotationLayer.tsx:160` (composer) and `:225` (GeneralCommentBox open state)
- Modify: `board/src/views/PlanReader.tsx:415` (global comment box)
- Modify: `board/src/components/ScriptViewer.tsx:135` (line-comment box)
- Modify: `board/src/components/FeedbackPanel.tsx:184` (card edit form)
- Test: extend `board/src/components/AnnotationLayer.test.tsx`, `board/src/components/ScriptViewer.test.tsx`, `board/src/components/FeedbackPanel.edit.test.tsx`, and a PlanReader test file (e.g. `board/src/views/PlanReader.body.test.tsx`)

**Interfaces:**
- Consumes: the attribute contract from Task 7 (`reloadGuardHeld` checks `[data-reload-guard]` presence).
- Produces: every open transient editor renders a container with `data-reload-guard=""`.

- [ ] **Step 1: Add the attribute to each open-editor container**

Each is a one-attribute addition to the JSX element cited above. Example, AnnotationLayer composer (line 160):

```tsx
      {pending && composing && (
        <div
          data-reload-guard=""
          className="absolute z-20 w-72 -translate-x-1/2 rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-2 shadow-xl"
          style={{ left: Math.max(150, pending.x), top: pending.y }}
        >
```

Apply identically to: the GeneralCommentBox open-state `<div className="mt-6 rounded-lg border...">` (AnnotationLayer.tsx:225), PlanReader's `<div className="mb-3 rounded-lg border...">` global-comment box (PlanReader.tsx:415), ScriptViewer's `<div className="border-t border-stone-200...">` comment box (ScriptViewer.tsx:135), and FeedbackPanel's editing `<div onClick={(e) => e.stopPropagation()}...>` wrapper (FeedbackPanel.tsx:184). The attribute must be on the container that exists exactly while the editor is OPEN (all five cited elements already render conditionally).

- [ ] **Step 2: Write the tests**

In each of the four test files, add one test using that file's existing render helpers and fixtures (they already open these editors in existing tests — reuse the same setup). The assertion in every case:

```ts
    expect(container.querySelector("[data-reload-guard]")).toBeTruthy();
```

and for the closed state (where the file's helpers make it easy):

```ts
    expect(container.querySelector("[data-reload-guard]")).toBeNull();
```

Concretely: AnnotationLayer — render, drag-select via the file's existing selection helper, click "Comment", assert present; before opening, assert null. GeneralCommentBox — render `<GeneralCommentBox view="tracker" onAdd={vi.fn()} />`, assert null, click "+ General comment on this view", assert present. ScriptViewer — use the existing line-click test setup, then assert present. FeedbackPanel — use the existing edit-mode test setup from `FeedbackPanel.edit.test.tsx`, assert present while editing. PlanReader — open the global comment box the way its existing tests exercise the annotate UI, assert present.

- [ ] **Step 3: Run**

Run: `cd <worktree>/board && ./node_modules/.bin/vitest run src/components/AnnotationLayer.test.tsx src/components/ScriptViewer.test.tsx src/components/FeedbackPanel.edit.test.tsx src/views/PlanReader.body.test.tsx`
Expected: PASS including the new assertions.

- [ ] **Step 4: Commit**

```bash
cd <worktree>
git add board/src/components/AnnotationLayer.tsx board/src/views/PlanReader.tsx board/src/components/ScriptViewer.tsx board/src/components/FeedbackPanel.tsx board/src/components/AnnotationLayer.test.tsx board/src/components/ScriptViewer.test.tsx board/src/components/FeedbackPanel.edit.test.tsx board/src/views/PlanReader.body.test.tsx
git commit -m "board: mark every transient editor with data-reload-guard"
```

---

### Task 10: Models save advances the page generation baseline

**Files:**
- Modify: `board/src/lib/types.ts:97` (`ModelProfileSaveResult`)
- Modify: `board/src/views/Models.tsx` (props + `post()` 200 branch, ~line 199)
- Modify: `board/src/App.tsx:1261` (pass the callback)
- Test: extend `board/src/views/Models.test.tsx`

**Interfaces:**
- Consumes: server `payloadGeneration` (Task 6); `pageGenRef`/`staleRef`/`setStaleHeld` (Task 8).
- Produces: `ModelProfileSaveResult.payloadGeneration?: string`; Models prop `onPayloadGeneration?: (g: string) => void`.

- [ ] **Step 1: Write the failing test**

In `Models.test.tsx`, next to the existing save test (reuse its fetch mock and fixtures), add:

```tsx
  it("reports the fresh payloadGeneration after a save", async () => {
    const onPayloadGeneration = vi.fn();
    // reuse the file's existing 200-response fetch stub, adding
    // payloadGeneration: "f".repeat(64) to the JSON body, and the file's
    // existing render helper, adding onPayloadGeneration={onPayloadGeneration}
    // ... click Save exactly like the existing save test ...
    await waitFor(() =>
      expect(onPayloadGeneration).toHaveBeenCalledWith("f".repeat(64)));
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd <worktree>/board && ./node_modules/.bin/vitest run src/views/Models.test.tsx`
Expected: FAIL (prop unknown / callback never called).

- [ ] **Step 3: Implement**

`types.ts:97` — add to `ModelProfileSaveResult`:

```ts
  payloadGeneration?: string; // disk generation after the save (auto-refresh baseline)
```

`Models.tsx` — add `onPayloadGeneration?: (g: string) => void` to the component props, and in the 200 branch of `post()` (after `onProfileChange(result.modelProfile);`):

```ts
        if (result.payloadGeneration) onPayloadGeneration?.(result.payloadGeneration);
```

`App.tsx:1261` — extend the Models render:

```tsx
            onProfileChange={setModelProfile}
            onPayloadGeneration={(g) => {
              pageGenRef.current = g;
              staleRef.current = initialStale;
              setStaleHeld(false);
            }}
```

- [ ] **Step 4: Run tests**

Run: `cd <worktree>/board && ./node_modules/.bin/vitest run src/views/Models.test.tsx src/App.staleness.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd <worktree>
git add board/src/lib/types.ts board/src/views/Models.tsx board/src/App.tsx board/src/views/Models.test.tsx
git commit -m "board: profile save advances the tab's generation baseline (no self-reload)"
```

---

### Task 11: Docs, version, template rebuild, full verification

**Files:**
- Modify: `CHANGELOG.md`, `.claude-plugin/plugin.json`, `board/package.json`, `board/package-lock.json`
- Modify: `commands/board.md`, `docs/reference.md` (one-line behavior notes)
- Modify: `skills/managing-planboard/assets/board-template.html` (rebuilt)

**Interfaces:**
- Consumes: everything above.
- Produces: a releasable branch per the release policy (version + notes in the PR).

- [ ] **Step 1: Version bump and CHANGELOG**

Patch bump: set the version in `.claude-plugin/plugin.json` AND `board/package.json` to the next patch above the branch's base version (base `1.1.0` → `1.1.1`; if another release lands on main first, renumber at PR resolution). Then sync the lockfile:

```bash
cd <worktree>/board && npm install --package-lock-only
```

CHANGELOG entry above the previous release heading:

```markdown
## [1.1.1] - 2026-07-23

The live board now follows the plans directory: a change written by another session (a new draft, a results bundle, a commit) shows up on its own within a few seconds, and a browser refresh always serves current disk state. Previously the board froze its content at launch and only a process restart picked up changes.

### Fixed
- **Stale live board.** The board server re-reads `plans/` when it changes (cheap fingerprint gate, full rebuild only on a real change) and the open tab reloads itself after the change settles, same as it already did after a relaunch. A reload never fires while a comment editor is open: a notice with a "Refresh now" button appears instead, and unsent drawer comments survive reloads as before. Sign-off, gate, and batch sessions keep their frozen transactional snapshots. Saving the model profile no longer counts as foreign disk change for the saving tab.
```

- [ ] **Step 2: Docs one-liners**

In `commands/board.md`, in the section describing the live board's behavior, add one line: `The live board follows the plans directory: plan or results changes written while it is open appear on their own within a few seconds (a reload is held while a comment editor is open).` In `docs/reference.md`, add the equivalent line where the board's live mode is documented.

- [ ] **Step 3: Rebuild the template and verify the marker**

```bash
cd <worktree>/board && npm run build
grep -c "Plans changed on disk" <worktree>/skills/managing-planboard/assets/board-template.html
```

Expected: count ≥ 1 (user-facing strings survive minification; source comments do not).

- [ ] **Step 4: Full verification**

```bash
cd <worktree> && python3 -m pytest tests/ -q
cd <worktree>/board && ./node_modules/.bin/vitest run
```

Expected: both suites fully green (baseline: ~500 Python, ~480 board). Log evidence per house rule:

```bash
cd <worktree> && mkdir -p logs && python3 -m pytest tests/ -q 2>&1 | tee logs/$(date +%Y-%m-%d_%H-%M-%S)_auto-refresh-final-pytest.log
cd <worktree>/board && ./node_modules/.bin/vitest run 2>&1 | tee ../logs/$(date +%Y-%m-%d_%H-%M-%S)_auto-refresh-final-vitest.log
```

- [ ] **Step 5: Live smoke (manual, in the worktree)**

Create a scratch project with `python3 <worktree>/scripts/new-walkthrough.py` (the repo's synthetic-project tool; if its usage differs, run it with `--help` first). From the scratch project, launch `python3 <worktree>/skills/managing-planboard/scripts/board.py --port 41999 --no-open`, open `http://127.0.0.1:41999` in a browser, then write a `.draft-v2.md` into a component from another terminal. Confirm: (a) the tab reloads within ~6s and shows the draft; (b) with a comment composer open the notice appears instead and "Refresh now" works; (c) a manual browser refresh alone also shows the draft. This is BK's eyeball checklist — record the outcome in the PR body.

- [ ] **Step 6: Commit**

```bash
cd <worktree>
git add CHANGELOG.md .claude-plugin/plugin.json board/package.json board/package-lock.json commands/board.md docs/reference.md skills/managing-planboard/assets/board-template.html
git commit -m "release: v1.1.1 — live board auto-refresh on disk changes"
```
