# Board control surface 1/3 — Python backend (rev 2, codex round folded) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-side foundations for the persistent control surface: correct test harnesses, stable pinned port, boot identity, durable server-identified orders with a single slot, displayed-payload-bound sign-off tickets, canonical action documents, and hardened hand-delivered ingress.

**Architecture:** All board.py. One-shot request core unchanged. `signoff_gate.py` untouched EXCEPT the main-thread signal guard is in board.py (not the gate). Token ENFORCEMENT is deliberately NOT here — plan 2 Task 6 lands enforcement + every client sender + template rebuild atomically (codex blocker: no dead-board window). Gate approve keeps today's stdout-only protocol. Recovery becomes peek + acknowledge (`--collect` stops deleting; new `--ack`).

**Tech Stack:** Python 3 stdlib; stdlib `unittest` (`python3 -m unittest tests.test_board -v` / `python3 -m pytest tests/ -q`).

**Spec:** `docs/specs/2026-07-09-board-control-surface-design.md` §3–§5. Anchors at `0d01a90`. Codex plan-review dispositions approved by BK 2026-07-10.

## Global Constraints

- Python stdlib only. One-shot core unchanged. `signoff_gate.py` not modified.
- Gate (`--gate`) approve/deny protocol byte-compatible with today (approve: stdout only, no pending file; deny: pending file, exit 3).
- Batch routes keep multi-accept; no slot for them.
- Suites green after EVERY task: `python3 -m pytest tests/ -q` (179 at base) — a task may not leave a later task's fix pending.
- `collect_payload` signature is `collect_payload(root, mode, focus)` (`board.py:382`) — live payload = `collect_payload(root, "live", None)`.

---

### Task 0: Test harnesses + signal guard + fixture marker

**Files:**
- Modify: `skills/managing-research-plans/scripts/board.py` (signal install :804), `tests/test_board.py` (imports, helpers)

**Interfaces (produced — every later task consumes these):**
- board.py: SIGTERM handler installed only on the main thread — `if threading.current_thread() is threading.main_thread(): signal.signal(signal.SIGTERM, ...)` replacing the bare install at :804. Behavior identical for real runs (serve always main-thread there).
- tests/test_board.py top-of-file imports gain: `argparse`, `contextlib`, `io`, `os`, `socket`, `threading`, `time`, `urllib.request`, `urllib.error`, `hashlib` (verify each against the existing import block :4-12; add only the missing).
- `live_payload(root)` helper → `p = board.collect_payload(root, "live", None); return p`.
- `serve_in_thread(root, payload=None, **argkw) -> (url: str, info: dict, thread)` — in-process handler-level harness: builds `argparse.Namespace(port=0, timeout=30, no_open=True, force=False)`, overrides from argkw, runs `board.serve(root, payload or live_payload(root), args)` in a daemon thread catching `SystemExit`, polls `board.read_lock(root / "plans")` (Task 1) for the port — until Task 1 lands it polls a module-level fallback: retries reading the `Board: http://…` line the thread writes via a captured `io.StringIO` redirect are NOT reliable cross-thread, so Task 0 only defines the helper with the lock-poll and a `pytest.skip`-free guard: `if board.read_lock is missing → poll for lock file text`. Simplest: Task 0 writes the helper to poll for the lock FILE's existence and parse it leniently (int or JSON) so it works both before and after Task 1.
- `spawn_board(root, *argv, timeout=30) -> (proc: subprocess.Popen, url: str)` — subprocess harness for e2e: `Popen([sys.executable, str(BOARD), "--no-open", "--timeout", str(timeout), *argv], cwd=root, stdout=PIPE, stderr=PIPE, text=True)`; reads stderr lines until `Board: <url>` (printed at :797); returns. Callers `proc.terminate()`/`wait()` in finally.
- `http_json(url, path, body=None, headers=None) -> (status, json_body, headers)` — urllib wrapper; on `HTTPError` returns its code/body; always sends `Content-Type: application/json` and `Host: 127.0.0.1`.
- Gate-e2e fixture marker: a `gate_project(root)` helper = `make_project(root)` + write the `CLAUDE.md` containing the exact marker `find_project_root` requires — read `signoff_gate.py` around :124 first and copy the literal marker string it greps for into the helper.

- [ ] **Step 1: Write a canary test** proving the harness runs a real server in-process and the subprocess harness round-trips:

```python
class TestHarness(unittest.TestCase):
    def test_serve_in_thread_answers_health(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); make_project(root)
            url, info, t = serve_in_thread(root)
            status, body, _ = http_json(url, "/api/health")
            self.assertEqual(status, 200)
            self.assertTrue(body["ok"])

    def test_spawn_board_prints_url_and_times_out_clean(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); make_project(root)
            proc, url = spawn_board(root, "--timeout", "2")
            try:
                status, body, _ = http_json(url, "/api/health")
                self.assertEqual(status, 200)
                self.assertEqual(proc.wait(timeout=15), 2)  # idle exit
            finally:
                proc.terminate()
```

- [ ] **Step 2: Run** `python3 -m unittest tests.test_board.TestHarness -v` — Expected: FAIL (`ValueError: signal only works in main thread` from the in-thread case; helpers missing).
- [ ] **Step 3: Implement** the signal guard in board.py (:804) and the four helpers + imports in tests.
- [ ] **Step 4: Run** the canary + full suite (`python3 -m pytest tests/ -q`) — all green.
- [ ] **Step 5: Commit** `git add skills/managing-research-plans/scripts/board.py tests/test_board.py && git commit -m "test(board): real-server harnesses (in-thread + subprocess) and main-thread signal guard"`

---

### Task 1: Derived port, bind-with-retry, lock metadata

**Files:**
- Modify: `skills/managing-research-plans/scripts/board.py` (`acquire_lock` :554-578, server construction :791-792, `parse_args` :1659)
- Test: `tests/test_board.py`

**Interfaces:**
- `derive_port(root) -> int` — `41000 + int(sha256(canonical root).hexdigest(), 16) % 1000`.
- `bind_server(root, requested, handler_cls) -> ThreadingHTTPServer` — bind-with-retry, NOT check-then-bind (codex: race): if `requested` → retry binding that exact port up to 10× with 0.2s sleeps (pinned-relaunch case: prior socket may still be closing), then `die("port %d busy")`; else try `derive_port(root)`..`+9` each once (construct `ThreadingHTTPServer`, catch `OSError`), fall back to port 0.
- `read_lock(plans_dir) -> {"pid", "port", "bootId"} | None` (legacy int → port 0, bootId ""); `acquire_lock(plans_dir, force, meta=None)` writes JSON.
- `serve()` rewrites the lock with `{"pid", "port", "bootId"}` after binding.
- `server_close()` on EVERY exit path: add `server.server_close()` immediately after each `server.shutdown()` AND in the `finally` block next to the lock unlink (:828-832) guarded by a `closed` flag (double-close is harmless but keep it tidy).

- [ ] **Step 1: Failing tests** — `TestPortDerivation` (deterministic, 41000-41999, canonical-path invariance), `TestBindRetry` (a blocker socket on the derived port → `bind_server(root, 0, ...)` lands on derived+1..+9; `bind_server(root, blocked_port, ...)` with a blocker that closes after 0.5s in a timer thread → succeeds on the pinned port), `TestLockMeta` (JSON round-trip; legacy plain-PID read). Use plain `ThreadingHTTPServer` with `BaseHTTPRequestHandler` as the handler_cls in bind tests.
- [ ] **Step 2: Run** — FAIL (names missing).
- [ ] **Step 3: Implement** the three functions; wire `serve()`: `server = bind_server(root, args.port, Handler)`; lock rewrite after `port = server.server_address[1]`; `server_close()` placement per interface.
- [ ] **Step 4: Run** new classes + full suite — green (serve_in_thread now reads real lock metadata).
- [ ] **Step 5: Commit** `git add ... && git commit -m "feat(board): derived pinned port with bind-retry, JSON lock metadata, server_close on all exits"`

---

### Task 2: Boot identity, health payload, no-store, GET hardening

**Files/Interfaces:** as rev-1 Task 2 with three corrections:
- `payload["projectId"] = project_id(root)` is ALSO injected in `serve()` (client storage keys consume it — plan 2 Task 2), alongside `boot_id`/`generation` computation.
- All payload constructions in tests use `live_payload(root)` (correct 3-arg `collect_payload`).
- Tests use the Task-0 harness verbatim; no stop()-function claims.

Health → `{"ok", "app", "bootId" (32-hex), "generation" (64-hex), "projectId" (16-hex)}` with `Cache-Control: no-store`; HTML GET adds `no-store`, `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`; `do_GET` first line rejects non-local `Host` (reuse `_host_is_local` :51-55) with 403. `payload_generation(payload)` excludes volatile keys `publishToken`, `boardToken`, and (new) `projectId`? — NO: projectId is stable, include it; exclude only the two per-boot tokens.

- [ ] **Step 1: Failing tests** — as rev-1 (`test_health_carries_identity_and_no_store`, `test_html_get_has_frame_denial_and_no_store`, `test_get_with_evil_host_is_403`, `test_generation_stable_across_volatile_tokens`) plus `test_payload_carries_project_id` (extract payload from a `--export` HTML via the existing `extract_payload` helper :123-129? export payloads are mode "static" — assert instead on the served live payload: GET `/` and regex the injected `board-data` JSON for `"projectId"`).
- [ ] **Steps 2-4:** fail → implement (`project_id`, `payload_generation`, `boot_id`, header work, `_json(..., no_store=True)`) → green.
- [ ] **Step 5: Commit** `git commit -m "feat(board): boot identity + projectId on health and payload, no-store, GET Host/frame hardening"`

---

### Task 3: boardToken plumbing (NOT enforced)

**Files:** board.py (`serve()` payload injection area :626-627), tests.

**Interfaces:**
- `payload["boardToken"] = hashlib.sha256(os.urandom(32)).hexdigest()` injected in `serve()`; captured as `board_token` local.
- `token_ok(body, expected) -> bool` module function using `hmac.compare_digest(str(body.get("boardToken", "")), expected)` (add `import hmac`).
- do_POST does NOT enforce yet (codex blocker #3): enforcement + all client senders + template rebuild land atomically in plan 2 Task 6, which flips a single line here.

- [ ] **Step 1: Failing tests** — `token_ok` truth table (match, mismatch, missing, non-str); served payload contains a 64-hex `boardToken`; POST `/api/feedback` WITHOUT token still succeeds (pins the not-yet-enforced contract so plan-2 Task 6 consciously flips this exact test).
- [ ] **Steps 2-4:** fail → implement → green.  **Step 5: Commit** `git commit -m "feat(board): per-boot boardToken plumbing (enforcement lands with the client senders)"`

---

### Task 4: Durable server-identified orders + single slot (all live routes)

**Files:** board.py do_POST (:673-789) + serve() locals; tests.

**Interfaces:**
- `accept_order(build_doc: callable[[str], str] | None, exit_code: int, write_file: bool) -> str | None` defined ONCE in callable form (no mid-plan restructure — codex finding): under `slot_lock`, reserve `slot["actionId"] = uuid.uuid4().hex`; `doc = build_doc(aid)` when build_doc else None; when `write_file` and doc: atomic tmp + `os.replace` to `plans/.board-feedback.md`; set `result["doc"]`/`result["exit"]`; return aid. Second call → None.
- Route behavior (live): `/api/feedback` → `accept_order(lambda aid: document_from_body(body, payload, action_id=aid), 0, write_file=True)`. Gate `/api/approve` → `accept_order(lambda aid: "APPROVED: …" (existing synthesized doc :717-733), 0, write_file=False)` — stdout-only, NO pending file (today's protocol, codex high #5). Gate `/api/deny` → callable over `document_from_body(...)`, exit 3, `write_file=True` (today's behavior :734-747). All three reply `{"ok": True, "actionId", "bootId", "projectId"}` on accept, `409 {"error": "already-accepted", "actionId": slot["actionId"]}` when the slot is taken. Batch routes untouched (no slot, no actionId).
- `document_from_body(body, payload, action=None, action_id=None)`: when `action_id` set and the client doc is used verbatim, the fence is REWRITTEN to carry `"actionId"` — new helper `inject_fence_key(doc, key, value) -> str` (parse via `parse_fence` :1320-1337; set key; re-serialize the single fence in place preserving surrounding text; if no fence, append a minimal `json board-feedback` fence `{"actionId": ...}`). Every durable live order therefore has a server actionId (codex blocker #4).

- [ ] **Step 1: Failing tests** — handler-level determinism: two direct `accept_order` calls → second None (build a minimal serve context via `serve_in_thread` + two sequential HTTP posts, asserting `{200, one of 409/URLError}` with the durability invariant: `.board-feedback.md` contains the FIRST body's marker and never the second — codex race note baked into the assertion); verbatim client doc gains `actionId` in its fence (`parse_fence` on the written file); fence-less client doc gains an appended fence; gate approve leaves NO `.board-feedback.md` (spawn `--gate` via `spawn_board(root, "--gate", "01-data-prep/v2")` after seeding a draft, POST `/api/approve`, assert exit 0 + stdout has `APPROVED:` + no pending file); gate deny writes the file and exits 3.
- [ ] **Steps 2-4:** fail → implement → green (full suite).
- [ ] **Step 5: Commit** `git commit -m "feat(board): durable single-slot orders with server actionId on every live route; gate approve stays stdout-only"`

---

### Task 5: Sign-off eligibility from the DISPLAYED payload + ticket issuance

**Files:** board.py (payload build in main() :1730-1745, serve()); tests.

**Interfaces:**
- `collect_draft_map(root) -> dict[(slug, int), {"path": str, "hash": str}]` — the SAME glob `apply_gate_batch` uses (:1544-1555), hash = `sha256(normalize_plan(text))`. Called ONCE in `main()`'s serve branch AT payload-build time and passed into `serve(root, payload, args, draft_map=...)` — eligibility is what the payload displays, captured atomically with it (codex: no serve-time re-glob, no TOCTOU).
- `validate_signoff_action(action, draft_map)` → `(slug, ver, decision, reason)` or `ValueError("bad-action")`; approve-specific rules at POST time: re-read `draft_map[(slug,ver)]["path"]` from disk; `ValueError("stale-draft")` when missing or `sha256(normalize_plan(now)) != captured hash`; `ValueError("trailer-in-draft")` when the draft ALREADY contains a `Signed off:` line (`normalize_plan` ignores trailers so the hash cannot distinguish them — refuse instead; codex finding). Distinct HTTP mapping: bad-action → 400; stale-draft → `409 {"error": "stale-draft"}` AND the server then sets `result["exit"] = 4; done.set()` — exit code 4 = "payload stale, relaunch me" (the loop relaunches with a fresh payload; client treats it as applying — BK-approved disposition); trailer-in-draft → 400 `{"error": "trailer-in-draft"}`.
- On validated approve, AFTER `accept_order` succeeds: `write_ticket(root, slug, ver, disk_text, aid)` (:1517-1533 — actionId lands in the ticket's `batchId` audit field). request-changes: no ticket ever.
- Hash-binding note recorded in board.py as a comment at the validation site: the ticket binds the plan BODY (normalize_plan strips the trailer) — trailer identity is outside the hash BY DESIGN, matching the existing gate (`signoff_gate.py:37-56`).

- [ ] **Step 1: Failing tests** — approve writes a ticket whose `contentHash` equals the normalize_plan hash of the draft on disk and whose filename the gate expects; stale (draft edited after boot) → 409 + server exits 4 + no ticket; deleted draft → same; trailer-in-draft → 400 + no ticket; multi-draft: add a second component draft to the fixture and assert each (slug, ver) validates independently and an (slug, ver) NOT in the map → 400; request-changes → 200 + no ticket; **gate-admission e2e**: `gate_project` fixture (Task 0 marker), approve over HTTP → then feed a `Write` of the signed `vN.md` to `signoff_gate.py` as a subprocess (copy `run_gate`'s event shape, `tests/test_gate_results.py:33-41`) → decision allow.
- [ ] **Steps 2-4:** fail → implement → green.
- [ ] **Step 5: Commit** `git commit -m "feat(board): displayed-payload-bound signoff — stale exit 4, trailer refusal, ticket via existing gate mechanism"`

---

### Task 6: Server-authored documents for action posts

**Files:** board.py (`build_feedback_document` :581-596, `document_from_body` :607-614); tests.

**Interfaces:**
- `document_from_body(body, payload, action=None, action_id=None)`: `action` set → IGNORE client `feedbackDocument`; return `build_feedback_document(body, payload, action=action, action_id=action_id)`. `action` None → today's verbatim preference, then `inject_fence_key(doc, "actionId", action_id)` (Task 4).
- `build_feedback_document` gains `action`/`action_id`: fence meta adds `"actionId"` and `"signoff": {"component", "version", "decision", "reason"?}` built ONLY from the validated tuple; prose gains a leading `## SIGNOFF: <slug> v<N> — <decision>` section with the reason blockquoted.

- [ ] **Step 1: Failing tests** — action post with a spoofed `feedbackDocument` → written order contains no spoof text, fence has server signoff + actionId (extend `TestDocumentFromBody` :667 + an HTTP case in `TestSignoffAction`); plain post keeps verbatim doc (existing `test_verbatim_when_client_assembled` :670-675 still green) but now with injected actionId.
- [ ] **Steps 2-4:** fail → implement → green.  **Step 5: Commit** `git commit -m "feat(board): server-authored SIGNOFF documents; client doc ignored for action posts"`

---

### Task 7: Hand-delivered ingress — strip keys AND neutralize headings; peek/ack recovery

**Files:** board.py (`collect_file` :1507-1514, `collect_pending` :1310, `parse_args` :1648-1671, `main()` dispatch :1697-1745); tests.

**Interfaces:**
- `ACTION_KEYS = ("signoff", "verdict", "reviewRequest", "reportRequest", "reopen")` — reopen INCLUDED (BK-approved disposition; a collaborator's reopen survives as an ordinary comment).
- `strip_action_keys_from_document(doc) -> (doc2, stripped: list[str])` — pops ACTION_KEYS from fence top level and per annotation; re-serializes the fence in place (respect `parse_fence`'s :1320-1337 contract and `FENCE_RE`'s exact span).
- `neutralize_action_headings(doc) -> (doc2, n: int)` — every line matching `^##\s+(SIGNOFF|VERDICT|REVIEW REQUEST|REPORT REQUEST|REOPEN REQUEST)\s*:` gets a `> ` prefix (demoted to a quote — board.md routes by heading too, codex security #2).
- `collect_file` applies BOTH before `inspect_feedback_document`, printing one stderr warning naming what was stripped/demoted.
- Recovery split (codex blocker #1): `collect_pending` becomes NON-destructive (prints, keeps the file). New argparse action `--ack` (added to `_ACTION_FLAGS` :1674 + exclusivity :1689 + dispatch :1709 area): deletes `plans/.board-feedback.md` if present, prints `board: acknowledged`, exit 0 (exit 3 when nothing to ack — matching the existing "nothing to collect" convention :14-16). Existing tests that assert collect deletes the file: UPDATE them to the new contract (grep `collect` assertions in tests first; adjust deliberately, they are the pinned old behavior).
- LIVE pending files (server-written, `--collect` with no args) are NOT stripped/demoted — only `collect_file(path)` (hand-delivered) sanitizes.

- [ ] **Step 1: Failing tests** — poisoned hand-delivered file: all five keys stripped (incl. `reopen`), `## SIGNOFF:`/`## REOPEN REQUEST:` headings demoted to quotes, sanitized doc printed; server-written pending doc keeps `signoff` + heading intact through `--collect`; `--collect` leaves the pending file on disk; `--ack` deletes it (exit 0) and exits 3 when absent; catch `SystemExit` around `collect_pending` in-process calls (codex: it exits).
- [ ] **Steps 2-4:** fail → implement → green (update the old delete-on-collect assertions in the same commit).
- [ ] **Step 5: Commit** `git commit -m "fix(board): hand-delivered ingress strips all action keys (incl. reopen) + demotes action headings; --collect peeks, --ack acknowledges"`

---

## Self-review notes

- Codex blockers addressed here: harness/signal (Task 0), token dead-window (Task 3 defers enforcement to plan-2 Task 6), actionId-for-all-orders (Task 4), gate-approve protocol preserved (Task 4), recovery peek/ack (Task 7), displayed-payload binding + TOCTOU + trailer + multi-draft (Task 5), bind-retry + server_close (Task 1), reopen strip + heading demotion (Task 7).
- Stale-draft exit 4 is a NEW serve exit code — documented in the module docstring (:14-16) in Task 5 and consumed by plan 3 Task 1.
- `collect_payload(root, "live", None)` everywhere; imports enumerated in Task 0.
