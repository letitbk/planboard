# Sign-at-Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move plan approval out of the persistent board into a slim one-shot sign session, sign plans at execution time instead of authoring time, and auto-record post-execution revisions as amendments — per docs/specs/2026-07-18-sign-at-execution-design.md rev 2 (all §-references below point there).

**Architecture:** One strict trailer grammar (Python in signoff_gate.py, mirrored in TS, pinned by shared fixtures) becomes the single source of signed/amended/malformed truth. board.py gains a `sign` payload mode (SignOffView replaces BatchGate) using the existing ticket transport, plus a token-authorized `/api/shutdown` lock handoff. signoff_gate.py gains one new allowed path (ungated amendment writes). Commands re-choreograph around a finalization transaction defined once in a new `references/sign-off.md`.

**Tech Stack:** Python 3 stdlib (board.py, signoff_gate.py, pytest via `python3 -m pytest`), React + TypeScript + vitest (board/), markdown command prompts.

## Global Constraints

- Work in a git worktree branched off main; EVERY bash command starts with `cd <abs-worktree-path> &&` and commits only after `git rev-parse --abbrev-ref HEAD` prints the feature branch. Stage with explicit `git add <paths>` — never `git add .`/`-A`/`commit -a`.
- Do NOT run `npm run build` before Task 12 (it copies dist/index.html into the shipped `skills/managing-research-plans/assets/board-template.html`); Task 12 rebuilds and commits the template as the ship step.
- Version-neutral: no version-field bumps; CHANGELOG entries go under `[Unreleased]`. BK numbers the release.
- Baselines that must stay green: `python3 -m pytest tests/ -q` (420 passing at branch point), `cd board && ./node_modules/.bin/vitest run` (450 passing; use the LOCAL binary, never bare `npx vitest`), `cd board && ./node_modules/.bin/tsc --noEmit`. Sandboxed environments may block ~60 socket-bound HTTP-harness tests with `PermissionError` at `_free_port()` — count those separately as env-blocked, never as failures.
- Canonical trailer forms (exact): signature `Signed off: <name>, <YYYY-MM-DD>` (grammar accepts any non-empty text after `Signed off: `); amendment `Amendment recorded, <YYYY-MM-DD>` (exact form, ISO date). These two regexes appear in exactly two implementations: `signoff_gate.py` and `board/src/lib/trailer.ts`.
- Prose in .md files: never hard-wrap; one paragraph per line.
- `rg -a` when grepping `board/src/lib/parse.ts` (a null byte trips binary detection).
- New/changed behavior must not touch: `plans/` (this repo has none), `.claude-plugin/`, version fields, `docs/specs/*` (read-only inputs).

---

### Task 1: Strict trailer grammar in Python + shared cross-language fixtures

**Files:**
- Modify: `skills/managing-research-plans/scripts/signoff_gate.py` (add after `normalize_plan`, ~line 57)
- Create: `board/src/lib/__fixtures__/trailer/` — fixture .md files + `expectations.json`
- Test: `tests/test_trailer_grammar.py` (new)

**Interfaces:**
- Produces: `parse_trailer(text: str) -> dict` returning `{"kind": "signed"|"amendment"|"none"|"malformed", "line": str|None, "violations": list[str]}`; module constants `TRAILER_SIGNED_RE`, `TRAILER_AMEND_RE`. board.py already imports from signoff_gate (`from signoff_gate import normalize_plan`, board.py:50) — later tasks extend that import.
- Fixture contract consumed by Task 5's TS mirror: each fixture file `board/src/lib/__fixtures__/trailer/<name>.md` has an entry in `expectations.json`: `{"<name>": {"kind": "...", "violations": <int count>}}`.

- [ ] **Step 1: Write fixtures.** Create these files (exact content matters; each is a minimal plan-shaped doc):
  - `signed-ok.md` — body lines then final line `Signed off: BK, 2026-07-18` → signed, 0 violations.
  - `amendment-ok.md` — body then final `Amendment recorded, 2026-07-18` → amendment, 0.
  - `draft-ok.md` — body only, no trailer → none, 0.
  - `interior-signature-attack.md` — a `Signed off: BK, 2026-07-18` line mid-body, ordinary final line → malformed, 1 (the P0-1 attack: an amendment-eligible doc that today's TS `/m` regex would badge signed).
  - `stacked-trailers.md` — `Signed off: BK, 2026-07-18` as second-to-last non-empty line, `Amendment recorded, 2026-07-18` final → malformed, 1.
  - `interior-amendment.md` — amendment line mid-body, `Signed off: BK, 2026-07-18` final → malformed, 1.
  - `legacy-placeholder-draft.md` — draft body ending with `---` then `Signed off: <researcher name>, <YYYY-MM-DD>` (the template placeholder verbatim) → signed, 0 violations (grammar-valid; it is the SIGN-MODE serve check and repair path, Task 4/8, that rejects placeholder drafts — grammar alone cannot distinguish a placeholder name).
  - `indented-interior-signature.md` — `  Signed off: BK, 2026-07-18` with leading spaces mid-body → malformed, 1 (lines are stripped before matching).
  - Write `expectations.json` mapping every name to `{kind, violations}`.
- [ ] **Step 2: Write the failing test** `tests/test_trailer_grammar.py`:

```python
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills" / "managing-research-plans" / "scripts"))
from signoff_gate import parse_trailer

FIXTURES = Path(__file__).resolve().parents[1] / "board" / "src" / "lib" / "__fixtures__" / "trailer"

def test_fixture_contract():
    expected = json.loads((FIXTURES / "expectations.json").read_text())
    assert len(expected) >= 8
    for name, exp in expected.items():
        got = parse_trailer((FIXTURES / f"{name}.md").read_text())
        assert got["kind"] == exp["kind"], name
        assert len(got["violations"]) == exp["violations"], name

def test_trailer_line_extracted():
    r = parse_trailer("# t\nbody\n\nSigned off: BK, 2026-07-18\n")
    assert r["kind"] == "signed" and r["line"] == "Signed off: BK, 2026-07-18"

def test_amendment_form_is_exact():
    assert parse_trailer("# t\nAmendment recorded, 2026-7-8\n")["kind"] == "none"  # non-ISO date: not a trailer at all
    assert parse_trailer("# t\nAmendment recorded after execution, 2026-07-18\n")["kind"] == "none"  # rev-1 wording is NOT canonical
```

- [ ] **Step 3: Run to verify failure.** `python3 -m pytest tests/test_trailer_grammar.py -q` → ImportError (`parse_trailer` undefined).
- [ ] **Step 4: Implement** in signoff_gate.py directly below `normalize_plan`:

```python
TRAILER_SIGNED_RE = re.compile(r"^Signed off: .+$")
TRAILER_AMEND_RE = re.compile(r"^Amendment recorded, \d{4}-\d{2}-\d{2}$")


def parse_trailer(text):
    """One strict trailer grammar (spec §3 rule 3), shared by the hook, board.py,
    and — mirrored byte-for-byte in board/src/lib/trailer.ts — the board UI.
    The LAST non-empty line may be exactly one canonical trailer; NO other line
    (stripped, code fences included) may match either pattern. Reject, not ignore."""
    lines = text.splitlines()
    idx = len(lines) - 1
    while idx >= 0 and not lines[idx].strip():
        idx -= 1
    final = lines[idx].strip() if idx >= 0 else ""
    kind = "none"
    if TRAILER_SIGNED_RE.match(final):
        kind = "signed"
    elif TRAILER_AMEND_RE.match(final):
        kind = "amendment"
    violations = []
    for i, ln in enumerate(lines):
        s = ln.strip()
        if i == idx and kind != "none":
            continue
        if TRAILER_SIGNED_RE.match(s) or TRAILER_AMEND_RE.match(s):
            violations.append("line %d: %s" % (i + 1, s))
    if violations:
        return {"kind": "malformed", "line": final if kind != "none" else None,
                "violations": violations}
    return {"kind": kind, "line": final if kind != "none" else None, "violations": []}
```

- [ ] **Step 5: Verify pass + full gate suite.** `python3 -m pytest tests/test_trailer_grammar.py tests/test_gate_explicitness.py tests/test_gate_results.py -q` → all pass.
- [ ] **Step 6: Commit.** `git add board/src/lib/__fixtures__/trailer tests/test_trailer_grammar.py skills/managing-research-plans/scripts/signoff_gate.py && git commit -m "feat(gate): strict shared trailer grammar with cross-language fixtures"`

### Task 2: Hook enforcement — grammar denial + ungated amendment path + message re-routing

**Files:**
- Modify: `skills/managing-research-plans/scripts/signoff_gate.py` — `main()` after the content read (:295-303), before the ticket check (:309); message strings in `check_ticket` (:66-102) and the interactive-gate area (~:400-430)
- Test: `tests/test_gate_amendments.py` (new); update assertions in `tests/test_gate_explicitness.py` that pin "board" recovery wording

**Interfaces:**
- Consumes: `parse_trailer` (Task 1).
- Produces: hook behavior later tasks rely on — amendment `v<N>.md` Writes pass unticketed iff create-only AND `v<N-1>.md` exists AND grammar-valid amendment; ANY grammar-malformed plan write is denied; researcher-facing recovery messages say `/research-plans:sign`, never "Approve on the board".

- [ ] **Step 1: Write failing tests** in `tests/test_gate_amendments.py`, reusing the in-process hook harness pattern from `tests/test_gate_explicitness.py` (importlib + fake stdin event JSON + captured exit/deny). Cases (each builds a tmp project with `plans/execution/03-slug/`):
  - `test_amendment_write_allowed`: v1.md exists (signed); Write v2.md with body + `Amendment recorded, 2026-07-18` final line → exit 0 allow, reason mentions "Amendment recorded".
  - `test_amendment_v1_denied`: no prior version; Write v1.md with amendment trailer → deny naming `/research-plans:sign`.
  - `test_amendment_gap_denied`: only v1.md exists; Write v3.md with amendment trailer → deny (v2.md missing).
  - `test_amendment_overwrite_denied`: v2.md exists; Write v2.md with amendment trailer → deny (immutability branch, pre-existing :286).
  - `test_interior_signature_denied`: v1.md exists; Write v2.md whose BODY contains `Signed off: BK, 2026-07-18` and final line is the amendment trailer → deny citing "trailer grammar".
  - `test_signed_write_with_interior_amendment_denied`: ticket present and valid for content, but content has an interior amendment line → deny citing grammar (grammar check precedes ticket allow).
  - `test_no_trailer_still_falls_through_to_gate`: content with no trailer, no ticket → reaches the interactive gate branch (assert via the patched-subprocess pattern the explicitness tests use).
- [ ] **Step 2: Run to verify failure.** `python3 -m pytest tests/test_gate_amendments.py -q` → failures (amendment writes currently fall into the interactive gate; interior signature currently NOT denied).
- [ ] **Step 3: Implement.** Insert into `main()` immediately after the `content is None` deny (:303) and BEFORE the ticket lookup (:309):

```python
    tr = parse_trailer(content)
    if tr["kind"] == "malformed":
        deny(
            "Plan trailer grammar violation for %s: 'Signed off:' / 'Amendment "
            "recorded,' lines may appear ONLY as the single final trailer. "
            "Offending — %s. Remove the interior line(s) and re-attempt."
            % (p.name, "; ".join(tr["violations"]))
        )
    if tr["kind"] == "amendment":
        prev = p.parent / ("v%d.md" % (version - 1))
        if version < 2 or not prev.exists():
            deny(
                "Amendment versions record revisions of an existing plan — "
                "v%d.md does not exist. A first or gap version needs a human "
                "sign-off: run /research-plans:sign %s." % (version - 1, slug)
            )
        allow(
            "Amendment recorded for %s v%d — ungated revision write. No "
            "human-approval claim is made; the board badges it 'amended'."
            % (slug, version)
        )
```

  Then sweep message strings: in `check_ticket` (:69-102) and the gate-timeout/error text (~:400-430), replace board-routed recovery ("re-approve ... on the board", "relaunch /research-plans:board") with "/research-plans:sign" equivalents. `rg -n "board" skills/managing-research-plans/scripts/signoff_gate.py` and rewrite each researcher-facing instruction; leave code comments alone.
- [ ] **Step 4: Verify.** `python3 -m pytest tests/test_gate_amendments.py tests/test_gate_explicitness.py tests/test_gate_results.py tests/test_trailer_grammar.py -q` → pass (update any explicitness-suite assertions that pinned the old wording — assert on the NEW wording, never delete a recovery-message test).
- [ ] **Step 5: Commit.** `git add skills/managing-research-plans/scripts/signoff_gate.py tests/test_gate_amendments.py tests/test_gate_explicitness.py && git commit -m "feat(gate): ungated amendment path, grammar denial, /sign-routed recovery messages"`

### Task 3: board.py `/api/shutdown` + lock handoff

**Files:**
- Modify: `skills/managing-research-plans/scripts/board.py` — `acquire_lock`/lock-write site (locate where the lock JSON gains `port` after bind; add a token there), `do_POST` route table (~:1280, alongside the other local mutation routes), `serve()` exit block (:1511-1536), and a new module-level helper near `read_lock` (~:920)
- Modify: `commands/board.md` — document exit 5
- Test: extend `tests/test_board.py` (HTTP-harness section, near the existing local-mutation 403 tests ~:2596)

**Interfaces:**
- Produces: `request_shutdown(plans_dir, wait=10.0) -> bool` (POSTs the tokened shutdown to a live board, polls for lock release); POST `/api/shutdown` body `{"token": <shutdownToken>}` → 200 `{"ok": true}` + clean `done.set()`; serve() exits **5** (new code, unused today — 0/2/3/4/130 are taken) printing `board: closed by sign-session handoff` when shutdown fired; lock JSON gains `shutdownToken` (hex, `secrets.token_hex(16)`).
- Consumed by: Task 4 (sign mode calls `request_shutdown` before `acquire_lock`) and signoff_gate's interactive launch path (board.py-side, same dispatch).

- [ ] **Step 1: Write failing tests** in `tests/test_board.py` (HTTP-harness pattern already in the file):
  - `test_shutdown_requires_token`: POST /api/shutdown with wrong/absent token → 403, server stays up.
  - `test_shutdown_clean_exit`: POST with the token read from `plans/.board.lock` → 200; serve() thread exits promptly; exit path yields code 5 (harness captures SystemExit).
  - `test_request_shutdown_roundtrip`: start a live board thread, call `request_shutdown(plans_dir)` → True, lock file gone.
  - `test_request_shutdown_no_board`: no lock → returns False without error.
- [ ] **Step 2: Verify failure.** `python3 -m pytest tests/test_board.py -q -k shutdown` → route missing (404-class failures).
- [ ] **Step 3: Implement.** (a) At the lock-write site that records `port`, add `"shutdownToken": secrets.token_hex(16)`. (b) Register `/api/shutdown` in `do_POST` with the SAME guard stack as the other local mutation routes (`local_request_ok` + object-body guard) but validating `body.get("token")` against the lock's `shutdownToken` (constant-time compare, `hmac.compare_digest`) INSTEAD of `boardToken` (the CLI never sees the per-boot board token); on success: `result["shutdown"] = True`, respond 200, `done.set()`. (c) In serve()'s exit block, before the batch branch: `if result.get("shutdown"): print("board: closed by sign-session handoff", file=sys.stderr); sys.exit(5)`. (d) Helper:

```python
def request_shutdown(plans_dir, wait=10.0):
    """Cleanly close a live board (spec §4 lock handoff): POST the tokened
    /api/shutdown, then poll for lock release. False when no live board."""
    info = read_lock(plans_dir)
    lock = plans_dir / ".board.lock"
    if not info or not info.get("port"):
        return False
    try:
        raw = json.loads(lock.read_text(encoding="utf-8"))
        token = raw.get("shutdownToken", "")
    except (OSError, ValueError):
        return False
    req = urllib.request.Request(
        "http://127.0.0.1:%d/api/shutdown" % info["port"],
        data=json.dumps({"token": token}).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        urllib.request.urlopen(req, timeout=5)
    except (urllib.error.URLError, OSError):
        return False
    deadline = time.time() + wait
    while time.time() < deadline:
        if not lock.is_file():
            return True
        time.sleep(0.2)
    return not lock.is_file()
```

  (e) commands/board.md exit-code list: add `5 — closed by a sign-session handoff: say so and STOP (no relaunch; the sign session owns the browser now).`
- [ ] **Step 4: Verify.** `python3 -m pytest tests/test_board.py -q` → green (socket-bound subset may be env-blocked; count separately).
- [ ] **Step 5: Commit.** `git add skills/managing-research-plans/scripts/board.py commands/board.md tests/test_board.py && git commit -m "feat(board): tokened /api/shutdown lock handoff, exit 5"`

### Task 4: board.py sign mode — payload, routes, durable feedback, batch removal

**Files:**
- Modify: `skills/managing-research-plans/scripts/board.py` — `parse_args` (~:2586: remove `--gate-batch`/`--allow-single`, add `--sign`), `apply_gate_batch` (~:2424: rename/rework to `apply_sign`), `do_POST` (`/api/batch/*` → `/api/sign/*`; DELETE the persistent-board approve routing inside `/api/feedback` ~:1280-1330 including the trailer-in-draft 400 at :1316 and its batch twin :1441), `serve()` (sign_mode wiring + exit summary), main dispatch (~:2683: `--sign` → handoff → apply_sign → serve; empty sign set → print + exit 0 without serving)
- Test: rework `tests/test_batch_routes.py` → sign routes; update `tests/test_gate_explicitness.py` CLI-pairing tests; extend `tests/test_board.py` for the /api/feedback approve-removal
- Modify: `tests/test_command_docs.py` if it pins `--gate-batch` strings

**Interfaces:**
- Consumes: `parse_trailer`, `request_shutdown`, existing `write_ticket` (:2359), `newest_draft`, `has_valid_ticket`.
- Produces: CLI `board.py --sign [NN-slug]`; payload key `sign` = `{"batchId": str, "items": [{"component", "version", "draftPath", "contentHash", "ticketed": bool}]}` (same item fields the gateBatch builder produces today, so Task 6's TS reuse is mechanical); POST `/api/sign/approve` `{component, version, contentHash}` → ticket written (grammar + disk-hash re-checked, mismatch → 409); POST `/api/sign/reject` `{component, version, note, annotations[]}` → durable `plans/execution/<slug>/.sign-feedback-v<N>.md` (models.atomic_write; overwritten per relaunch) + in-memory summary row; POST `/api/sign/done` → done.set(); serve() sign_mode: bounded wait (3600 default), ALWAYS exit 0 with the approved/changes-requested/undecided summary, Ctrl-C 130. Grammar-malformed drafts are EXCLUDED from items with a stderr repair line naming the file (spec §4 legacy repair; the /sign workflow repairs and relaunches).

- [ ] **Step 1: Write failing tests.** In `tests/test_batch_routes.py` (rename class content, keep the file): approve-writes-ticket, reject-writes-durable-feedback-file (assert file content includes note + annotation quote), disk-hash-mismatch-409, done-exits, timeout-exit-0-with-tickets-persisted, single-draft-works (no min-2 rule), zero-eligible-prints-and-exits-0, malformed-draft-excluded-with-stderr, `--sign 03-slug` scopes to one component, sign-with-live-board-performs-handoff (start a live board first; assert old lock released, sign session acquired). In `tests/test_board.py`: `test_feedback_approve_gone` — POST /api/feedback with `action: {"type":"signoff", ...}` decision payload → the approve/trailer routing no longer exists (assert 400/ignored per the surviving generic path, and NO ticket written).
- [ ] **Step 2: Verify failure.** `python3 -m pytest tests/test_batch_routes.py -q` → failures on the new route names/flags.
- [ ] **Step 3: Implement** per the Interfaces block. Key points: `--sign` uses `nargs="?", const="ALL"`; `apply_sign(root, payload, component=None)` = today's apply_gate_batch collection minus the `<2 refuses` rule, plus `if parse_trailer(content)["kind"] != "none": print repair line to stderr; continue` (a pending draft must be trailer-free; the placeholder fixture from Task 1 is the canonical excluded case); main dispatch: `if args.sign: request_shutdown(root / "plans")` before serving. Delete `--allow-single` and its `ap.error` pairing check; delete the `/api/feedback` signoff-decision branch (:1280-1330) and `/api/batch/*` handlers; keep the generic feedback/comment path intact.
- [ ] **Step 4: Verify all Python.** `python3 -m pytest tests/ -q` → green (explicitness tests that exercised `--gate-batch` CLI pairing now assert `--sign` behavior; keep the resumed-batch ticket-enumeration coverage by pointing it at sign mode).
- [ ] **Step 5: Commit.** `git add skills/managing-research-plans/scripts/board.py tests/test_batch_routes.py tests/test_board.py tests/test_gate_explicitness.py tests/test_command_docs.py && git commit -m "feat(board): sign mode with durable feedback replaces gate-batch and in-board approve"`

### Task 5: TS grammar mirror + dashboard badges + approve-action removal

**Files:**
- Create: `board/src/lib/trailer.ts`
- Modify: `board/src/lib/parse.ts` (signedOff at :335 area), `board/src/lib/actions.ts` (:16-54: strict trailer via trailer.ts; delete the `approve` action kind), `board/src/lib/types.ts` (plan version gains `trailerState: "signed" | "amendment" | "none" | "malformed"`; delete `SignoffRequest`), `board/src/views/PlanReader.tsx` (:641 badge area), `board/src/views/Tracker.tsx` (:500), `board/src/views/Timeline.tsx`, `board/src/components/FeedbackPanel.tsx` (approve affordance removal)
- Test: `board/src/lib/trailer.test.ts` (fixture-driven), update `parse.test.ts`, `actions.test.ts`, view tests

**Interfaces:**
- Consumes: Task 1's fixtures + expectations.json (import via vitest glob or fs read — follow the existing `__fixtures__` usage pattern in parse.test.ts).
- Produces: `parseTrailer(raw: string): { kind: TrailerKind; line: string | null; violations: string[] }` in trailer.ts; `trailerState` on parsed plan versions; badges `signed ✓` / `amended △` / `malformed trailer ⚠` (malformed NEVER renders as signed — the P0-1 pin); draft chip copy `pending — signs at /execute or /sign`.

- [ ] **Step 1: Failing tests.** `trailer.test.ts` iterates the shared fixture dir asserting kind + violation count per expectations.json (this pins TS to the Python grammar). `parse.test.ts` additions: interior-signature doc → `signedOff === null` + `trailerState === "malformed"`; amendment doc → `trailerState === "amendment"`, `signedOff === null`. `actions.test.ts`: `planActionState` no longer returns `kind: "approve"` for drafts (returns the pending/none state); an interior-signature latest version is NOT treated as signed.
- [ ] **Step 2: Verify failure.** `cd board && ./node_modules/.bin/vitest run src/lib/trailer.test.ts src/lib/parse.test.ts src/lib/actions.test.ts` → red.
- [ ] **Step 3: Implement.** trailer.ts is a line-for-line port of Task 1's function (same two regexes: `/^Signed off: .+$/` and `/^Amendment recorded, \d{4}-\d{2}-\d{2}$/`, strip each line, last-non-empty rule, violations array). parse.ts: replace the `/^Signed off:\s*(.+)$/m` extraction with `const tr = parseTrailer(raw)`, set `signedOff = tr.kind === "signed" ? tr.line!.replace(/^Signed off:\s*/, "") : null` and carry `trailerState`. actions.ts: same replacement for the :51 fallback; remove the approve branch from `planActionState` (draft → `{ kind: "pending", draftPath, version, blockedByComments: false }` — FeedbackPanel renders the pending chip, no button). Views: badge from `trailerState`; `⚠ malformed trailer` styled like the existing integrity warnings.
- [ ] **Step 4: Verify.** `cd board && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit` → green.
- [ ] **Step 5: Commit.** `git add board/src && git commit -m "feat(board-ui): strict trailer grammar, amended/malformed badges, approve action removed"`

### Task 6: SignOffView replaces BatchGate; PlanBody extraction

**Files:**
- Create: `board/src/components/PlanBody.tsx` (extracted verbatim from PlanReader.tsx:828 region — move, don't rewrite; PlanReader imports it)
- Create: `board/src/views/SignOffView.tsx`; Delete: `board/src/views/BatchGate.tsx`
- Modify: `board/src/App.tsx` (:187 `if (data.gateBatch) return <BatchGate…` → `if (data.sign) return <SignOffView data={data} />`), `board/src/lib/types.ts` (`SignPayload`/`SignItem` matching Task 4's payload; drop `gateBatch` types), `board/src/dev-data.ts` (sign-mode sample)
- Test: `board/src/views/SignOffView.test.tsx` (new, jsdom harness like the old BatchGate tests), update `App.test.tsx`

**Interfaces:**
- Consumes: Task 4's payload/routes (`data.sign.items`, POST `/api/sign/approve|reject|done`), Task 5's trailer/badges, extracted `PlanBody`, existing `DiffView`, `ScorePanel`, `AnnotationLayer`.
- Produces: the one-shot sign UI — item sidebar (component + version + score chips + ticketed/decided state), per-item PlanBody with AnnotationLayer, diff-vs-last-canonical toggle (reuse DiffView with the previous `v<N-1>.md` from the payload's executionPlans group when present), **Approve disabled while the item has unsent annotations** (title says why — the actions.ts:35 semantic, now per item), Request changes (sends note + the item's annotations), done screen summarizing decisions. Empty states (spec §11): no eligible plans / all already ticketed / component is archived / amendment-only component.

- [ ] **Step 1: Failing tests.** SignOffView.test.tsx: renders items; approve POSTs `/api/sign/approve` with contentHash and marks item decided; approve BLOCKED (disabled + reason) while a pending annotation exists for the item; request-changes POSTs annotations+note; per-item decisions independent; done POSTs `/api/sign/done`; each empty state renders its message. App.test.tsx: `data.sign` payload → SignOffView, no tabs mounted.
- [ ] **Step 2: Verify failure.** `cd board && ./node_modules/.bin/vitest run src/views/SignOffView.test.tsx` → red.
- [ ] **Step 3: Implement.** Extraction first (PlanBody move + PlanReader import — run the full vitest suite to prove zero behavior change before writing SignOffView), then SignOffView modeled on BatchGate's fetch/health scaffolding (BatchGate.tsx:35-160) with the per-item wizard replacing the single textarea.
- [ ] **Step 4: Verify.** `cd board && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit` → green.
- [ ] **Step 5: Commit.** `git add board/src && git commit -m "feat(board-ui): SignOffView one-shot sign session replaces BatchGate"`

### Task 7: Finalization transaction reference + plan.md + sync.md

**Files:**
- Create: `skills/managing-research-plans/references/sign-off.md`
- Modify: `commands/plan.md` (step 6, :30), `commands/sync.md` (step 6, :30)
- Test: `python3 -m pytest tests/test_command_docs.py -q` (update pinned strings)

**Interfaces:**
- Produces: `references/sign-off.md` with named sections other files cite (no step numbers): **"The finalization transaction"** (per approved item: copy exact approved draft bytes → append `Signed off: <name>, <YYYY-MM-DD>` → Write `v<N>.md` (the hook validates the ticket) → delete `.draft-v<N>.md`, keep `v<N>-draft-K.md` snapshots → run the /research-plans:review workflow (draft→signed scorecard migration, same version) → update tracker plan link → status per caller (plan-time: stays `planned`; execute: proceeds to the execute prompt which sets `in progress`; adopt: status untouched; never regress) → decision-log entry); **"Launching a sign session"** (repair placeholder-trailer drafts first — delete the trailing `---` + `Signed off:` placeholder lines from the mutable draft with a visible note; then `python3 ${CLAUDE_PLUGIN_ROOT}/skills/managing-research-plans/scripts/board.py --sign [NN-slug] --no-open` background-bash as board.md does; after exit ENUMERATE tickets + `.sign-feedback-v*.md` on disk — the durable record; never trust stdout alone); **"Recovery"** (interrupted session → rerun /research-plans:sign; outstanding valid tickets get their transaction completed; exit 130/timeout lose nothing).

- [ ] **Step 1: Write references/sign-off.md** per the contract above (spec §5 verbatim where it defines the transaction).
- [ ] **Step 2: Rewrite plan.md step 6** — replace the entire board-choreography step (:30) with the post-draft chain: write `.draft-v1.md` (no trailer, provenance marker line 1 unchanged per step-5 rules), run the review workflow on the draft, set the tracker row `planned` with the plan link at the DRAFT path, then say: `draft ready — it signs at /research-plans:execute, or run /research-plans:sign <component> to commit it now`, and offer execution (routing into /research-plans:execute). Board open becomes optional read/annotate. Batch-finalize paragraph: replaced by one sentence citing sign-off.md's "Launching a sign session". Delete the modal-gate-fallback and gate-timeout-relaunch-board sentences (recovery cites sign-off.md "Recovery").
- [ ] **Step 3: Rewrite sync.md step 6** — keep the draft-building mechanics (Supersedes line, marker, snapshots, review scoring) verbatim; replace approve choreography with: append `Amendment recorded, <YYYY-MM-DD>` as the final line and Write `v<N+1>.md` directly (the hook's amendment path admits it — no ticket, no click, no board), delete the ephemeral draft, keep snapshots, tracker status unchanged; note the board badges it `amended △` and that re-execution will gate it (cite sign-off.md). Replace "gets a new signed version" doctrine wording with "gets a new recorded version" (the amendment/breach sentence itself survives).
- [ ] **Step 4: Verify.** `python3 -m pytest tests/test_command_docs.py -q` green after updating pinned phrases; `rg -n "gate-batch|Approve on the board|review room" commands/plan.md commands/sync.md` → no hits (except intentional historical references, expected none).
- [ ] **Step 5: Commit.** `git add skills/managing-research-plans/references/sign-off.md commands/plan.md commands/sync.md tests/test_command_docs.py && git commit -m "feat(commands): finalization transaction reference; plan/sync re-choreographed"`

### Task 8: sign.md (new command) + execute.md + adopt.md + board.md + execution-loop.md

**Files:**
- Create: `commands/sign.md`
- Modify: `commands/execute.md` (:2 description, :9 entry checks), `commands/adopt.md` (:7, :22), `commands/board.md` (:15, :25, :31-32 — approve choreography out, exit-5 in, copy), `skills/managing-research-plans/references/execution-loop.md` (:9 commit consent wording survives; :40 deviation rebinding → "governing plan version")
- Test: `tests/test_command_docs.py`

**Interfaces:**
- Consumes: sign-off.md sections (Task 7), board.py `--sign` (Task 4).
- Produces: `commands/sign.md` frontmatter description "Sign pending plans — one slim session, tickets, then the finalization transaction"; body implements spec §5's resolver contract: current-tracker components only (pre-renewal/archived excluded, permanently browse-only); default scope = pending drafts (newest `.draft-v<N>`) + outstanding-ticket recovery (valid unexpired ticket, `v<N>.md` absent → complete the transaction, no browser); explicit `/sign <component>` additionally offers an amendment-latest component by MATERIALIZING `.draft-v<N+1>.md` (copy amendment, title version bump, `Supersedes: v<N> — re-commitment for re-execution`, rp-model marker reported side updated, review-score it) then including it as an ordinary draft; runs sign-off.md's "Launching a sign session" + "The finalization transaction"; owns the decision-log entry; ends suggesting `/research-plans:execute` for newly signed planned components (message only).

- [ ] **Step 1: Write sign.md** per the contract. **Step 2: execute.md** — description drops "signed" gatekeeping tone → "Execute plans — signs pending drafts at the gate, then the loop runs to results, validation, and report"; entry check :9 rewrite: latest version signed → proceed; pending draft → sign session (cite sign-off.md; on request-changes revise and relaunch; on timeout/undecided skip the component naming /sign); amendment-latest → materialize the re-commitment candidate exactly as sign.md does, then sign-session it; "no signed plan" error text now names BOTH `/research-plans:plan` (no draft at all) and the gate (draft exists). No-argument resolution: unchanged text (first `planned` row) — works because plan.md now sets `planned` at draft time. **Step 3: adopt.md** — :7 mechanics line drops `--gate-batch`; :22 batch review paragraph → one sign session over the adopted drafts (any count; cite sign-off.md; unapproved drafts stay drafts, signable later via /sign; tracker status of adopted rows never reset). **Step 4: board.md** — remove Approve/Request-changes routing + trailer-in-draft + stale-approve-exit-4 relaunch choreography; keep annotate/collect, reopen, verdict, review, models; exit-code list gains 5 (Task 3 already added — verify), drops the approve-order codes; pending-draft copy: `pending — signs at /execute or /sign`. **Step 5: execution-loop.md** — :40 deviation stop rebinding sentence: bundle binds to the **governing plan version** (latest canonical, signed or amendment); commit-consent wording at :9 unchanged.
- [ ] **Step 6: Verify + commit.** `python3 -m pytest tests/test_command_docs.py -q`; `rg -n "gate-batch|allow-single" commands/ skills/` → zero hits. `git add commands/sign.md commands/execute.md commands/adopt.md commands/board.md skills/managing-research-plans/references/execution-loop.md tests/test_command_docs.py && git commit -m "feat(commands): /sign command; execute-gates; adopt via sign session; board approve retired"`

### Task 9: review/results/report + doctrine sweep

**Files:**
- Modify: `commands/review.md` (:9 target resolution — re-commitment candidates are ordinary drafts; :15 trigger list → "after a sign-off (by /sign, the /execute gate, /adopt) or an amendment finalize (/sync)"), `commands/results.md` (:19 `manifest.planVersion` + :21 conformance eligibility → **governing plan version** = latest canonical signed-or-amendment; human approval never gates validation eligibility), `skills/managing-research-plans/templates/agents/rp-results-validator.md` (:3 signed-plan requirement → governing-version wording), `commands/report.md` (verify-only: resolves from manifest.planVersion, no signature requirement — expect zero edits), `skills/managing-research-plans/SKILL.md` (:38 primary loop, :46 approval doctrine + NO_GATE note scoped per spec §3), `skills/managing-research-plans/references/planning-doctrine.md` (:21 "review room is the approval dialog" → sign session), `skills/managing-research-plans/references/explore-before-planning.md` (:18 "under a signed plan" → "under a signed or recorded plan (see sign-off.md)"), `skills/managing-research-plans/references/results-adopt.md` (:21), `skills/managing-research-plans/templates/claude-md-section.md` (:20), `skills/managing-research-plans/templates/review-scorecard.md` (:3 path contract mentions re-commitment drafts)
- Test: `tests/test_command_docs.py`; `python3 -m pytest tests/ -q`

- [ ] **Step 1** Apply each edit above (one file at a time; every replacement is a targeted sentence rewrite, never a reflow — these files are one-paragraph-per-line). **Step 2** Sweep: `rg -n "Approve on the board|board Approve|review room|gate-batch" commands/ skills/ docs/reference.md README.md` and fix every remaining live-instruction hit in the files this task owns (README/reference.md hits belong to Task 11 — leave them). **Step 3** `python3 -m pytest tests/ -q` green. **Step 4** Commit: `git add commands/review.md commands/results.md commands/report.md skills/managing-research-plans && git commit -m "feat(commands): governing-version binding; doctrine swept to sign sessions"`

### Task 10: Template trailer removal + dev-data amendments

**Files:**
- Modify: `skills/managing-research-plans/templates/execution-plan.md` (delete the final `---` + `Signed off: <researcher name>, <YYYY-MM-DD>` placeholder lines; update the guidance comment (:8) and trailer wording (:85) to: trailers are appended only by the finalization transaction — signature by a sign session, amendment by /sync)
- Modify: `board/src/dev-data.ts` (:95/:906 region — add to the sample project: one amendment version (v3 with `Amendment recorded, …` trailer) on an executed component and one amendment-awaiting-recommitment component)
- Test: template contract tests (they read the template directly — locate via `rg -l "execution-plan.md" board/src tests`), `parse.test.ts` dev-data assertions

- [ ] **Step 1** Failing check first: `rg -n "Signed off" skills/managing-research-plans/templates/execution-plan.md` → shows the placeholder; template contract test updated to assert NO trailer-pattern line exists in the template (add this assertion — it is the regression pin for the p2p bug). **Step 2** Apply both edits; run `python3 -m pytest tests/ -q` and `cd board && ./node_modules/.bin/vitest run` → green (dev-data type errors surface here if SignItem/trailerState wiring is off). **Step 3** Commit: `git add skills/managing-research-plans/templates/execution-plan.md board/src/dev-data.ts tests board/src && git commit -m "fix(template): drop placeholder sign-off trailer; dev-data amendment fixtures"`

### Task 11: README + reference.md + CHANGELOG

**Files:**
- Modify: `README.md` (:33/:49 — authoring/execution/collaboration story: plans sign at execution; amendments recorded automatically; the board is the dashboard, approval happens in a slim sign session), `docs/reference.md` (:23 command table adds /sign; :33 primary loop; :96 gate section — invariant scoping per spec §3 rule 1, NO_GATE posture unchanged; :116 tree labels; exit-code table adds 5), `CHANGELOG.md` under `[Unreleased]`
- Test: `tests/test_command_docs.py` (if it pins reference.md command tables)

- [ ] **Step 1** Apply edits (no hard-wrapping; match each file's existing style). CHANGELOG [Unreleased] entries: Added — /research-plans:sign, sign sessions (SignOffView), amendment versions (`Amendment recorded,` trailer), strict trailer grammar with malformed badge, /api/shutdown handoff (exit 5); Changed — plans sign at /execute (lazy policy), /sync auto-finalizes amendments, /adopt uses sign sessions, tracker `planned` at draft time; Removed — in-board Approve, `--gate-batch`/`--allow-single`, template placeholder trailer. **Step 2** `python3 -m pytest tests/test_command_docs.py -q`. **Step 3** Commit: `git add README.md docs/reference.md CHANGELOG.md && git commit -m "docs: sign-at-execution story in README/reference; changelog"`

### Task 12: Adversarial pins, template rebuild, full-suite + export smoke (SHIP STEP)

**Files:**
- Test additions: `tests/test_board.py` (ingress sanitizer retention: `strip_action_keys_from_document` still strips `signoff` + heading demotion — assert the EXISTING tests at :2723 area survived Tasks 4-5 untouched, and add one test feeding a hostile hand-delivered doc with a signoff action through `--collect` ingress asserting strip), `tests/test_gate_results.py` (:190 area — full amendment→recommitment round trip: signed v1 → amendment v2 (hook allows) → materialized .draft-v3 candidate → sign-mode ticket over v3 → signed v3 write passes check_ticket)
- Build: `cd board && npm run build` → commits the regenerated `skills/managing-research-plans/assets/board-template.html`

- [ ] **Step 1** Write the two test additions; run them red where new, green after any fix. **Step 2** Full verification: `python3 -m pytest tests/ -q` AND `cd board && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit` → all green; record counts vs baselines (420 py / 450 vitest — both should GROW). **Step 3** `cd board && npm run build`; `git status` must show ONLY `board-template.html` changed; verify the built template serves sign mode: `rg -c "sign" skills/managing-research-plans/assets/board-template.html` > 0 and the string `malformed trailer` appears in it. **Step 4** Export smoke: build a synthetic project via the tests' make_project helpers (pattern: napkin "End-to-end smoke"), give one component a signed v1 + amendment v2, run `board.py --export`, assert the embedded JSON payload carries `trailerState: "amendment"` and NO `sign` key (export is not a sign session). **Step 5** Commit: `git add tests skills/managing-research-plans/assets/board-template.html && git commit -m "test: adversarial trailer pins, amendment round trip; rebuild board template"`

---

## Self-review record

- Spec coverage: §3 rules 1-4 → Tasks 1/2/5 (+ SKILL.md scoping in Task 9); §4 slim gate → Tasks 3/4/6; §5 flows incl. finalization transaction, /sign contract, governing version → Tasks 7/8/9; §6 board changes → Tasks 4/5; §7 enforcement → Tasks 1/2; §8 scoring triggers → Task 9; §9 template → Task 10; §11 ledger (README/reference/fixtures/tests) → Tasks 10/11/12; §12 forks: fork 1 (materialized candidate) → Tasks 8 (execute/sign materialization) + 12 (round-trip test); fork 2 (trailer wording) → Task 1 regexes; fork 3 (shutdown handoff) → Task 3.
- Known deliberate scope cuts: no per-project policy setting, no plannotator dependency, hosted/share flows untouched (spec §13). The `/api/sign/*` route names are new (not `/api/batch/*` aliases) because BatchGate is deleted in the same release — no compatibility window needed.
- Type consistency: payload key `sign` (Python apply_sign ↔ TS `data.sign` ↔ `SignPayload`); `parse_trailer`/`parseTrailer` return shape identical; ticket schema unchanged (write_ticket untouched); exit code 5 defined once (Task 3) and cited by board.md (Task 3) and reference.md (Task 11).
