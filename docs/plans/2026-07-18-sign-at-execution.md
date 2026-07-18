# Sign-at-Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move plan approval out of the persistent board into a slim one-shot sign session, sign plans at execution time instead of authoring time, and auto-record post-execution revisions as amendments — per docs/specs/2026-07-18-sign-at-execution-design.md rev 2 (all §-references below point there). Plan rev 2: codex plan review folded (docs/specs/2026-07-18-codex-review-sign-at-execution-plan.md).

**Architecture:** One strict trailer grammar (Python in signoff_gate.py, mirrored in TS, pinned by shared fixtures) becomes the single source of signed/amended/malformed truth. board.py gains a `sign` payload mode with a **transport discriminator** (`"ticket"` for /sign sessions, `"hook"` for the blocking direct-write gate) so ONE SignOffView serves both transports; the persistent-board approve dies. A boardToken-authorized `/api/shutdown` provides the lock handoff. signoff_gate.py gains one new allowed path (ungated amendment writes). Commands re-choreograph around a finalization transaction defined once in a new `references/sign-off.md`.

**Tech Stack:** Python 3 stdlib (board.py, signoff_gate.py, pytest via `python3 -m pytest`), React + TypeScript + vitest (board/), markdown command prompts.

## Global Constraints

- Work in a git worktree branched off main; EVERY bash command starts with `cd <abs-worktree-path> &&` and commits only after `git rev-parse --abbrev-ref HEAD` prints the feature branch. Stage with explicit `git add <paths>` — never `git add .`/`-A`/`commit -a`/bare directory adds.
- Do NOT run `npm run build` before Task 12 (it copies dist/index.html into the shipped `skills/managing-research-plans/assets/board-template.html`); Task 12 rebuilds and commits the template. Task 12 is BRANCH COMPLETION, not a release — no version bumps, no tag; CHANGELOG under `[Unreleased]`; the release train is BK's (docs/RELEASING.md).
- Baselines (codex-verified at branch point): `python3 -m pytest tests/ -q` → 420 collected, 360 pass + exactly 60 socket-bound tests that fail ONLY in sandboxes denying loopback bind at `_free_port` (test_board.py:1826) — count env-blocked separately, never as failures; `cd board && ./node_modules/.bin/vitest run` → 450 pass (LOCAL binary, never bare `npx vitest`); `cd board && ./node_modules/.bin/tsc --noEmit` clean.
- Canonical trailer forms (exact): signature `Signed off: <name>, <YYYY-MM-DD>` (grammar accepts any non-empty text after `Signed off: `); amendment `Amendment recorded, <YYYY-MM-DD>` (exact form, ISO date). These two regexes appear in exactly two implementations: `signoff_gate.py` and `board/src/lib/trailer.ts`.
- Every `/api/*` POST body MUST carry `boardToken` — board.py's outer guard (board.py:1233, :1251) rejects mutations before routing without it. This includes `/api/shutdown` and all `/api/sign/*` bodies and tests.
- Mid-branch note: Task 4 removes the server side of the persistent-board Approve before Task 6 removes its UI. That interim inconsistency is deliberate (TS tests mock fetch, so suites stay green per task); Task 6 closes it.
- Prose in .md files: never hard-wrap; one paragraph per line. `rg -a` when grepping `board/src/lib/parse.ts` (null byte trips binary detection).

---

### Task 1: Strict trailer grammar in Python + shared cross-language fixtures

**Files:**
- Modify: `skills/managing-research-plans/scripts/signoff_gate.py` (add after `normalize_plan`, ~line 57)
- Create: `board/src/lib/__fixtures__/trailer/` — fixture .md files + `expectations.json`
- Test: `tests/test_trailer_grammar.py` (new)

**Interfaces:**
- Produces: `parse_trailer(text: str) -> dict` returning `{"kind": "signed"|"amendment"|"none"|"malformed", "line": str|None, "violations": list[str]}`; module constants `TRAILER_SIGNED_RE`, `TRAILER_AMEND_RE`; `strip_trailer(text: str) -> str` (removes exactly ONE canonical final trailer line plus an optional immediately-preceding `---` separator line and trailing blank lines; returns text unchanged when kind is none/malformed). board.py already imports from signoff_gate (`from signoff_gate import normalize_plan`, board.py:50) — later tasks extend that import.
- Fixture contract consumed by Task 5's TS mirror: each fixture file `board/src/lib/__fixtures__/trailer/<name>.md` has an entry in `expectations.json`: `{"<name>": {"kind": "...", "violations": <int count>}}`.

- [ ] **Step 1: Write fixtures.** Create these files (exact content matters; each is a minimal plan-shaped doc):
  - `signed-ok.md` — body lines then final line `Signed off: BK, 2026-07-18` → signed, 0 violations.
  - `amendment-ok.md` — body then final `Amendment recorded, 2026-07-18` → amendment, 0.
  - `draft-ok.md` — body only, no trailer → none, 0.
  - `interior-signature-attack.md` — a `Signed off: BK, 2026-07-18` line mid-body, ordinary final line → malformed, 1 (the P0-1 attack: today's TS `/m` regex would badge this signed).
  - `stacked-trailers.md` — `Signed off: BK, 2026-07-18` as second-to-last non-empty line, `Amendment recorded, 2026-07-18` final → malformed, 1.
  - `interior-amendment.md` — amendment line mid-body, `Signed off: BK, 2026-07-18` final → malformed, 1.
  - `legacy-placeholder-draft.md` — draft body ending with `---` then `Signed off: <researcher name>, <YYYY-MM-DD>` (the template placeholder verbatim) → signed, 0 violations (grammar-valid; the SIGN-MODE serve check and repair path, Tasks 4/7, reject placeholder drafts — grammar alone cannot distinguish a placeholder name).
  - `indented-interior-signature.md` — `  Signed off: BK, 2026-07-18` with leading spaces mid-body → malformed, 1 (lines are stripped before matching).
  - Write `expectations.json` mapping every name to `{kind, violations}`.
- [ ] **Step 2: Write the failing test** `tests/test_trailer_grammar.py`:

```python
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills" / "managing-research-plans" / "scripts"))
from signoff_gate import parse_trailer, strip_trailer

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

def test_strip_trailer_roundtrip():
    body = "# t\nbody\n"
    for trailer in ("Signed off: BK, 2026-07-18", "Amendment recorded, 2026-07-18"):
        assert strip_trailer(body + "\n---\n" + trailer + "\n") == body
        assert strip_trailer(body + trailer + "\n") == body
        assert parse_trailer(strip_trailer(body + trailer + "\n"))["kind"] == "none"
    assert strip_trailer(body) == body  # none: unchanged
```

- [ ] **Step 3: Run to verify failure.** `python3 -m pytest tests/test_trailer_grammar.py -q` → ImportError.
- [ ] **Step 4: Implement** in signoff_gate.py directly below `normalize_plan`:

```python
TRAILER_SIGNED_RE = re.compile(r"^Signed off: .+$")
TRAILER_AMEND_RE = re.compile(r"^Amendment recorded, \d{4}-\d{2}-\d{2}$")


def parse_trailer(text):
    """One strict trailer grammar (spec §3 rule 3), shared by the hook, board.py,
    and — mirrored line-for-line in board/src/lib/trailer.ts — the board UI.
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


def strip_trailer(text):
    """Remove exactly one canonical final trailer (plus an optional immediately
    preceding --- separator and trailing blanks). Unchanged for none/malformed."""
    tr = parse_trailer(text)
    if tr["kind"] not in ("signed", "amendment"):
        return text
    lines = text.splitlines()
    idx = len(lines) - 1
    while idx >= 0 and not lines[idx].strip():
        idx -= 1
    del lines[idx:]
    while lines and not lines[-1].strip():
        lines.pop()
    if lines and lines[-1].strip() == "---":
        lines.pop()
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines) + "\n"
```

- [ ] **Step 5: Verify pass + gate suites.** `python3 -m pytest tests/test_trailer_grammar.py tests/test_gate_explicitness.py tests/test_gate_results.py -q` → pass.
- [ ] **Step 6: Commit.** `git add board/src/lib/__fixtures__/trailer tests/test_trailer_grammar.py skills/managing-research-plans/scripts/signoff_gate.py && git commit -m "feat(gate): strict shared trailer grammar + strip helper with cross-language fixtures"`

### Task 2: Hook enforcement — grammar denial, amendment path, timeout-persist strip, message re-routing

**Files:**
- Modify: `skills/managing-research-plans/scripts/signoff_gate.py` — `main()` after the content read (:295-303) and before the ticket check (:309); the timeout-persistence site (~:395); message strings in `check_ticket` (:66-102) and the interactive-gate area (~:400-430)
- Test: `tests/test_gate_amendments.py` (new); update `tests/test_gate_explicitness.py` wording pins

**Interfaces:**
- Consumes: `parse_trailer`, `strip_trailer` (Task 1).
- Produces: amendment `v<N>.md` Writes pass unticketed iff create-only AND `v<N-1>.md` exists AND grammar-valid amendment; ANY grammar-malformed plan write denied; **gate-timeout persistence strips one canonical signature trailer before saving `.draft-v<N>.md`** (so recovered drafts parse `none` and sign mode accepts them); recovery messages say `/research-plans:sign`, never "Approve on the board".

- [ ] **Step 1: Write failing tests** in `tests/test_gate_amendments.py`, reusing the in-process hook harness from `tests/test_gate_explicitness.py` (importlib + fake stdin event + captured exit/deny):
  - `test_amendment_write_allowed`: v1.md exists; Write v2.md with body + `Amendment recorded, 2026-07-18` final line → allow, reason mentions "Amendment recorded".
  - `test_amendment_v1_denied`: no prior version; amendment v1.md → deny naming `/research-plans:sign`.
  - `test_amendment_gap_denied`: only v1.md; amendment v3.md → deny (v2.md missing).
  - `test_amendment_overwrite_denied`: v2.md exists; amendment v2.md → deny (pre-existing immutability :286).
  - `test_interior_signature_denied`: body contains `Signed off: BK, 2026-07-18`, final line amendment → deny citing "trailer grammar".
  - `test_signed_write_with_interior_amendment_denied`: valid ticket present but content has an interior amendment line → deny citing grammar (grammar check precedes ticket allow).
  - `test_no_trailer_still_falls_through_to_gate`: no trailer, no ticket → reaches the interactive gate branch (patched-subprocess pattern).
  - `test_timeout_persists_stripped_draft`: gate timeout on a signed-trailer write → persisted `.draft-v<N>.md` parses `none` (strip happened); recovery message names `/research-plans:sign`.
- [ ] **Step 2: Verify failure.** `python3 -m pytest tests/test_gate_amendments.py -q` → red.
- [ ] **Step 3: Implement.** Insert into `main()` after the `content is None` deny (:303), BEFORE the ticket lookup (:309):

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

  At the timeout-persistence site (~:395), wrap the saved content: `draft_path.write_text(strip_trailer(content), ...)` (locate the exact write; preserve surrounding messaging). Then sweep researcher-facing message strings in `check_ticket` (:69-102) and the timeout/error text (~:400-430): board-routed recovery → `/research-plans:sign`; leave code comments alone.
- [ ] **Step 4: Verify.** `python3 -m pytest tests/test_gate_amendments.py tests/test_gate_explicitness.py tests/test_gate_results.py tests/test_trailer_grammar.py -q` → pass (update wording pins to the NEW text; never delete a recovery-message test).
- [ ] **Step 5: Commit.** `git add skills/managing-research-plans/scripts/signoff_gate.py tests/test_gate_amendments.py tests/test_gate_explicitness.py && git commit -m "feat(gate): amendment path, grammar denial, stripped timeout drafts, /sign-routed messages"`

### Task 3: board.py `/api/shutdown` + lock handoff (boardToken transport)

**Files:**
- Modify: `skills/managing-research-plans/scripts/board.py` — the lock-write site that records `port` (store `boardToken` there too), `do_POST` route table (~:1280), `serve()` exit block (:1511-1536), new helper near `read_lock` (~:920)
- Modify: `commands/board.md` — exit-code list gains 5
- Test: extend `tests/test_board.py`

**Interfaces:**
- Produces: lock JSON gains `boardToken` (the per-boot token — already random per boot; writing it to the gitignored lock file keeps the trust domain: anyone who can read the lock can already `kill` the pid); POST `/api/shutdown` body `{"boardToken": <token>}` — it passes the EXISTING outer boardToken guard (board.py:1233/:1251) like every other mutation, no special-casing — → 200 `{"ok": true}`, `result["shutdown"] = True`, `done.set()`; serve() exits **5** (0/2/3/4/130 are taken) printing `board: closed by sign-session handoff` to stderr; `request_shutdown(plans_dir, wait=10.0) -> bool` reads port+boardToken from the lock, POSTs, polls for lock release.
- Consumed by: Task 4 (sign/gate dispatch calls `request_shutdown` before `acquire_lock`).

- [ ] **Step 1: Write failing tests** in `tests/test_board.py`:
  - `test_shutdown_requires_board_token`: POST /api/shutdown without/with wrong boardToken → rejected by the outer guard, server stays up (thread harness `serve_in_thread` is fine here — no exit-code assertion).
  - `test_shutdown_clean_exit_code_5`: use the **`spawn_board` subprocess harness** (test_board.py:1822/:1893 — the thread harness's `_swallow_exit` at :1838/:1873 DISCARDS SystemExit codes and cannot observe exit 5): live board via spawn_board → POST tokened shutdown → process exit code 5, stderr contains "sign-session handoff".
  - `test_request_shutdown_roundtrip`: live board (spawn_board) → `request_shutdown(plans_dir)` → True, lock gone.
  - `test_request_shutdown_no_board`: no lock → False, no exception.
- [ ] **Step 2: Verify failure.** `python3 -m pytest tests/test_board.py -q -k shutdown` → red.
- [ ] **Step 3: Implement** per Interfaces: (a) lock write gains `"boardToken": board_token`; (b) `/api/shutdown` handler after the outer guard: respond 200, `result["shutdown"] = True`, `done.set()`; (c) serve() exit block, before the batch branch: `if result.get("shutdown"): print("board: closed by sign-session handoff", file=sys.stderr); sys.exit(5)`; (d) `request_shutdown` — read lock JSON for port + boardToken, `urllib.request` POST `{"boardToken": token}` with 5s timeout, poll `plans/.board.lock` up to `wait` seconds, return released; False on any URLError/OSError/missing fields; (e) board.md exit list: `5 — closed by a sign-session handoff: say so and STOP (no relaunch; the sign session owns the browser now).`
- [ ] **Step 4: Verify.** `python3 -m pytest tests/test_board.py -q` (socket-bound subset env-blocked counts separately).
- [ ] **Step 5: Commit.** `git add skills/managing-research-plans/scripts/board.py commands/board.md tests/test_board.py && git commit -m "feat(board): boardToken /api/shutdown lock handoff, exit 5"`

### Task 4: board.py sign mode — both transports, tracker scoping, durable feedback, batch+approve removal

**Files:**
- Modify: `skills/managing-research-plans/scripts/board.py` — `parse_args` (~:2586: remove `--gate-batch`/`--allow-single`, add `--sign`), `apply_gate_batch` (~:2424) → `apply_sign`, `apply_gate` (~:2500) → emits the same `sign` payload with `transport: "hook"`, `do_POST` (`/api/batch/*` → `/api/sign/*`; `/api/approve`+`/api/deny` KEPT for the hook transport; DELETE ONLY the signoff-decision validation/ticketing inside `/api/feedback` (~:1284-1330 incl. the trailer-in-draft 400 at :1316) — the outer route, generic comment path, and `document_from_body`'s action-free path (:1054, :1337) survive), payload enrichment (executionPlans entries gain `trailerState` via `parse_trailer`, collection site ~:676), `GITIGNORE_LINES` (:84 area: add `.sign-feedback-v*.md`), serve() (sign_mode wiring + exit summary), main dispatch (~:2683)
- Test: rework `tests/test_batch_routes.py`; update `tests/test_gate_explicitness.py`; extend `tests/test_board.py`; `tests/test_command_docs.py` if it pins `--gate-batch`

**Interfaces:**
- Consumes: `parse_trailer`, `strip_trailer`, `request_shutdown`, `write_ticket` (:2359), `newest_draft`, `has_valid_ticket`.
- Produces: CLI `board.py --sign [NN-slug]` (nargs="?", const="ALL"). Payload key `sign` = `{"batchId": str, "transport": "ticket" | "hook", "items": [...]}` where items keep the EXACT current gateBatch field names — `{component, proposedVersion, path, content, contentHash, ticketed}` (board.py:2446, types.ts:115) — this is an intentional schema migration of the wrapper, not the items. `apply_sign(root, payload, component=None)`: candidates = newest `.draft-v<N>` per component, **filtered to components linked from the CURRENT master-plan tracker** (reuse the payload collection's component grouping; pre-renewal/archived and orphan execution dirs excluded — test with mixed current/archived/orphan dirs); grammar-non-`none` drafts EXCLUDED with a stderr repair line naming the file; any count ≥ 1 serves; zero eligible → CLI message + exit 0 WITHOUT serving (SignOffView never renders a no-eligible state). `apply_gate(root, payload, "SLUG/vN")` → single-item `sign` payload with `transport: "hook"` (replaces `payload["gate"]`; the gate_mode routes `/api/approve`/`/api/deny` (:1356/:1379) and their stdout/exit contract are UNCHANGED). Routes (all bodies include `boardToken`; mirror the current `/api/batch/*` body fields under the new names): POST `/api/sign/approve` → grammar + disk-hash re-check (mismatch 409) → `write_ticket`; POST `/api/sign/reject` `{boardToken, component, version, note, annotations[]}` → durable `plans/execution/<slug>/.sign-feedback-v<N>.md` (models.atomic_write; overwritten per relaunch; gitignored; deleted by the finalization transaction) + summary row; POST `/api/sign/done` → done.set(). serve(): sign_mode + transport=ticket → bounded wait (3600 default), ALWAYS exit 0 with approved/changes-requested/undecided summary; transport=hook keeps today's gate exits (0 authorize / 2 timeout); Ctrl-C 130. Dispatch: `--sign` (and the hook's `--gate` launch) call `request_shutdown(root / "plans")` before `acquire_lock`.

- [ ] **Step 1: Write failing tests.** In `tests/test_batch_routes.py` (reworked): approve-writes-ticket (body incl. boardToken), reject-writes-durable-feedback-file (assert note + annotation quote in the file), **feedback-survives-kill** (spawn_board, reject an item, SIGKILL the server → file still on disk with content), disk-hash-mismatch-409, done-exits-0-with-summary, timeout-exit-0-with-tickets, single-draft-works, zero-eligible-prints-and-exits-0-without-serving, malformed-draft-excluded-with-stderr, `--sign 03-slug` scopes, **archived-dir-excluded** (execution dir present, not in current tracker → not offered), sign-with-live-board-performs-handoff, **gate-transport-preserved** (`--gate SLUG/vN` → payload.sign.transport == "hook", /api/approve exits 0, /api/deny writes the feedback doc with today's exit), **payload-generation-pins-sign** (live `sign` payload participates in `payloadGeneration` (board.py:875) — pin deliberately; `payload_files`/shareHash untouched (:201)), **trailerState-enrichment** (payload executionPlans entries carry `trailerState`; an amendment file → "amendment"). In `tests/test_board.py`: `test_feedback_signoff_route_gone` — POST /api/feedback with the EXACT old wire shape `{boardToken, action: {"kind": "signoff", component, version, decision: "approve"}}` (board.py:1014, App.tsx:718): RED phase first proves it currently mints a ticket/order; GREEN asserts post-change neither exists and generic comment feedback still routes.
- [ ] **Step 2: Verify failure.** `python3 -m pytest tests/test_batch_routes.py -q` → red.
- [ ] **Step 3: Implement** per Interfaces. Deletion care: inside `/api/feedback` remove ONLY the signoff validation/ticket/trailer-in-draft block (:1284-1330); the batch twin (:1397-1461 incl. :1441) is replaced wholesale by `/api/sign/*`.
- [ ] **Step 4: Verify all Python.** `python3 -m pytest tests/ -q` → green (explicitness CLI-pairing tests now assert `--sign`; keep resumed-ticket-enumeration coverage pointed at sign mode).
- [ ] **Step 5: Commit.** `git add skills/managing-research-plans/scripts/board.py tests/test_batch_routes.py tests/test_board.py tests/test_gate_explicitness.py tests/test_command_docs.py && git commit -m "feat(board): sign mode (ticket+hook transports), tracker scoping, durable feedback; batch and in-board approve removed"`

### Task 5: TS grammar mirror + badges (dashboard display only — NO action/type removals here)

**Files:**
- Create: `board/src/lib/trailer.ts`
- Modify: `board/src/lib/parse.ts` (signedOff :335 → strict; plan versions gain `trailerState`), `board/src/lib/types.ts` (add `TrailerKind`/`trailerState` — `SignoffRequest` and gate types are Task 6's), `board/src/views/PlanReader.tsx` (:641 badges), `board/src/views/Tracker.tsx` (:500 badges; **:187 drift warning keys on `trailerState === "none" | "malformed"`, NOT `signedOff === null` — amendments must not false-fire it; regression test**), `board/src/views/Timeline.tsx`
- Test: `board/src/lib/trailer.test.ts` (fixture-driven), `parse.test.ts`, Tracker/PlanReader view tests

**Interfaces:**
- Consumes: Task 1's fixtures + expectations.json (fs read per the existing `__fixtures__` pattern in parse tests).
- Produces: `parseTrailer(raw: string): { kind: TrailerKind; line: string | null; violations: string[] }`; `trailerState` on parsed plan versions; badges `signed ✓` / `amended △` / `malformed trailer ⚠` (malformed NEVER renders signed — the P0-1 pin); draft chip copy `pending — signs at /execute or /sign`. actions.ts's approve kind and `/m` fallback remain UNTOUCHED until Task 6 (they feed the still-mounted FeedbackPanel; suites must stay green per task).

- [ ] **Step 1: Failing tests.** trailer.test.ts iterates the shared fixture dir (kind + violation count per expectations.json). parse.test.ts: interior-signature doc → `signedOff === null`, `trailerState === "malformed"`; amendment doc → `"amendment"`, `signedOff === null`. Tracker test: latest-version-is-amendment → NO drift warning; malformed → warning + `⚠` badge.
- [ ] **Step 2: Verify failure.** `cd board && ./node_modules/.bin/vitest run src/lib/trailer.test.ts src/lib/parse.test.ts` → red.
- [ ] **Step 3: Implement.** trailer.ts = line-for-line port of Task 1 (same regexes `/^Signed off: .+$/`, `/^Amendment recorded, \d{4}-\d{2}-\d{2}$/`, strip-per-line, last-non-empty, violations). parse.ts: `const tr = parseTrailer(raw)`; `signedOff = tr.kind === "signed" ? tr.line!.replace(/^Signed off:\s*/, "") : null`; carry `trailerState`. Badges + Tracker drift key change.
- [ ] **Step 4: Verify.** `cd board && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit` → green.
- [ ] **Step 5: Commit.** `git add board/src && git commit -m "feat(board-ui): strict trailer grammar, amended/malformed badges, amendment-safe drift warning"`

### Task 6: SignOffView (both transports) replaces BatchGate + ALL approve/gate UI removal

**Files:**
- Create: `board/src/components/PlanBody.tsx` — extraction is NOT just the :828 region: move `BodyParts`, `AgentDetailBlock`, `SectionBlock` (PlanReader.tsx:732+) and the legacy renderer below :864 together; PlanReader imports the new module. Run the FULL vitest suite after the move alone to prove zero behavior change before any new code.
- Create: `board/src/views/SignOffView.tsx`; Delete: `board/src/views/BatchGate.tsx`
- Modify: `board/src/App.tsx` — :187 early return → `if (data.sign) return <SignOffView data={data} />`; DELETE the gate/signoff machinery: `SignoffRequest` import (:43), signoff document build + POST (:693, :718), onSignoff callbacks to Tracker/PlanReader (:1273), gate terminal states/copy (:614, :1030, :1225)
- Modify: `board/src/lib/feedback.ts` (:4 import, :64 signoff serialization — delete), `board/src/lib/actions.ts` (approve kind removed from `planActionState` → draft yields `{kind: "pending", draftPath, version, blockedByComments: false}`; the `/m` fallback at :51 → `parseTrailer`), `board/src/lib/types.ts` (delete `SignoffRequest` (:540) + gateBatch types; add `SignPayload`/`SignItem` — items keep the existing field names per Task 4), `board/src/components/FeedbackPanel.tsx` (:287 gate buttons + approve affordances out; pending chip in), `board/src/components/ConnBanner.tsx` (:30 recovery copy → sign-session wording), `board/src/views/Models.tsx` (:101 gate wording), `board/src/dev-data.ts` (sign-mode sample, both transports)
- Test: `board/src/views/SignOffView.test.tsx` (new); REWORK `board/src/App.gate.test.tsx` + `board/src/App.recovery.test.tsx` (there is NO App.test.tsx) to the new UI; update FeedbackPanel/actions/feedback tests

**Interfaces:**
- Consumes: Task 4's payload (`data.sign.items`, `data.sign.transport`), routes `/api/sign/*` (ticket) and `/api/approve`/`/api/deny` (hook), Task 5's trailer/badges, extracted PlanBody, DiffView, ScorePanel, AnnotationLayer; BatchGate's fetch/health scaffolding pattern (BatchGate.tsx:35-160) including its boardToken-injecting `post` helper (:58).
- Produces: ONE sign UI for both transports. Item sidebar (component, version, score chips, ticketed/decided state); per-item PlanBody + AnnotationLayer; diff-vs-previous-canonical toggle (DiffView; previous version from the payload's executionPlans group when present); **Approve disabled while the item has unsent annotations** (reason in title — the actions.ts:35 semantic per item); Request changes sends note + the item's annotations. Transport wiring: `ticket` → `/api/sign/approve|reject|done`; `hook` → `/api/approve|deny` with today's response handling (exit contract server-side, unchanged). Empty/terminal states: only the REACHABLE ones — all-items-decided done screen (POSTs `/api/sign/done` in ticket mode), per-item already-ticketed state. No no-eligible state (the CLI never serves that).

- [ ] **Step 1: PlanBody extraction commit first.** Move, import, full suite green, `git add board/src && git commit -m "refactor(board-ui): extract PlanBody + section renderers from PlanReader"`.
- [ ] **Step 2: Failing tests.** SignOffView.test.tsx: renders items; ticket-approve POSTs `/api/sign/approve` with contentHash + boardToken and marks decided; approve BLOCKED while a pending annotation exists; request-changes POSTs annotations+note; per-item decisions independent; done screen POSTs `/api/sign/done`; hook transport: single item, Approve → `/api/approve`, Request changes → `/api/deny`; already-ticketed state renders. App.gate.test.tsx/App.recovery.test.tsx reworked: `data.sign` (hook transport) renders SignOffView, no tabs; recovery copy = ConnBanner's new wording. actions.test.ts: draft → `kind: "pending"`; interior-signature latest NOT signed.
- [ ] **Step 3: Verify red, implement, verify green.** `cd board && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit` (tsc green REQUIRES the App/feedback/types deletions to land together — that is why they are one task).
- [ ] **Step 4: Commit.** `git add board/src && git commit -m "feat(board-ui): SignOffView serves both sign transports; approve/gate UI retired"`

### Task 7: Finalization transaction reference + plan.md + sync.md

**Files:**
- Create: `skills/managing-research-plans/references/sign-off.md`
- Modify: `commands/plan.md` (step 6, :30), `commands/sync.md` (step 6, :30)
- Test: `python3 -m pytest tests/test_command_docs.py -q`

**Interfaces:**
- Produces: `references/sign-off.md` with NAMED sections (cited by name, never step number): **"The finalization transaction"** — per approved item: copy the exact approved draft bytes → append `Signed off: <name>, <YYYY-MM-DD>` → Write `v<N>.md` (hook validates the ticket) → delete `.draft-v<N>.md` (keep `v<N>-draft-K.md` snapshots) → delete the item's `.sign-feedback-v<N>.md` if present (consumed) → run the review workflow (draft→signed scorecard migration, same version) → update tracker plan link → status per caller (plan-time: stays `planned`; execute: the execute prompt sets `in progress`; adopt: untouched; NEVER regress) → decision-log entry. **"Launching a sign session"** — repair placeholder-trailer drafts first (delete the trailing `---` + `Signed off:` placeholder lines from the mutable draft, say so); `python3 ${CLAUDE_PLUGIN_ROOT}/skills/managing-research-plans/scripts/board.py --sign [NN-slug] --no-open` background-bash as board.md does; a live persistent board is closed automatically (shutdown handoff — if the researcher's board tab goes to sleep, that is expected); after exit ENUMERATE tickets + `.sign-feedback-v*.md` on disk — the durable record; never trust stdout alone. **"Recovery"** — interrupted/timeout/Ctrl-C lose nothing; rerun `/research-plans:sign`; valid outstanding tickets get their transaction completed without a browser.

- [ ] **Step 1** Write references/sign-off.md per the contract (spec §5).
- [ ] **Step 2** Rewrite plan.md step 6 (:30): write `.draft-v1.md` (no trailer; provenance marker line 1 per step-5 rules), run the review workflow on the draft, set the tracker row `planned` with the plan link at the DRAFT path (`planned` = "has a plan, draft or signed" — keeps no-argument `/execute` proposing the row), say `draft ready — it signs at /research-plans:execute, or run /research-plans:sign <component> to commit it now`, offer execution (routes into /research-plans:execute). Board open = optional read/annotate. Batch finalize → one sentence citing "Launching a sign session". Delete modal-gate-fallback and gate-timeout-board-relaunch sentences (recovery cites "Recovery").
- [ ] **Step 3** Rewrite sync.md step 6 (:30): draft-building mechanics verbatim (Supersedes, marker, snapshots, review scoring); then append `Amendment recorded, <YYYY-MM-DD>` as the final line and Write `v<N+1>.md` directly (the hook's amendment path admits it — no ticket, no click, no board), delete the ephemeral draft, keep snapshots, tracker unchanged; the board badges it `amended △`; re-execution gates it (cite sign-off.md). Doctrine sentence keeps amendment/breach wording; "new signed version" → "new recorded version".
- [ ] **Step 4** Verify: `python3 -m pytest tests/test_command_docs.py -q`; `rg -n "gate-batch|Approve on the board|review room" commands/plan.md commands/sync.md` → zero hits.
- [ ] **Step 5** Commit: `git add skills/managing-research-plans/references/sign-off.md commands/plan.md commands/sync.md tests/test_command_docs.py && git commit -m "feat(commands): finalization transaction reference; plan/sync re-choreographed"`

### Task 8: sign.md (new) + execute.md + adopt.md + board.md + execution-loop.md

**Files:**
- Create: `commands/sign.md`; Modify: `commands/execute.md` (:2, :9), `commands/adopt.md` (:7, :22), `commands/board.md` (:15, :25, :31-32), `skills/managing-research-plans/references/execution-loop.md` (:9 unchanged commit-consent; :40 governing-version rebinding)
- Test: `tests/test_command_docs.py` — **add `sign` to the command inventory tuple (test_command_docs.py:10)**

**Interfaces:**
- Produces: `commands/sign.md` (description: "Sign pending plans — one slim session, tickets, then the finalization transaction") implementing spec §5's resolver: current-tracker components only (pre-renewal/archived permanently browse-only); default scope = pending drafts + outstanding-ticket recovery (valid unexpired ticket, `v<N>.md` absent → complete the transaction, no browser); `/sign <component>` additionally offers an amendment-latest component by materializing the re-commitment candidate; owns the finalization transaction + decision-log entry; ends suggesting `/research-plans:execute` (message only). **Materialization recipe (used verbatim by sign.md and execute.md):** copy the amendment `v<N>.md` to `.draft-v<N+1>.md`, **strip exactly one canonical final amendment trailer plus its optional preceding `---` separator** (Task 1's strip semantics — the hook is not involved; the workflow performs the strip as part of authoring the candidate), update the title to `v<N+1>`, set `Supersedes: v<N> — re-commitment for re-execution`, update the rp-model marker's reported side, **verify the candidate now parses trailer-`none`** (if not, stop and repair), then review-score it and include it as an ordinary draft.

- [ ] **Step 1** Write sign.md per the contract. **Step 2** execute.md: description → "Execute plans — signs pending drafts at the gate, then the loop runs to results, validation, and report"; entry check (:9): latest signed → proceed; pending draft → sign session (cite sign-off.md; request-changes → revise → relaunch; timeout/undecided → skip naming /sign); amendment-latest → materialization recipe, then sign-session; no-plan error names `/research-plans:plan`. **Step 3** adopt.md: :7 drops `--gate-batch`; :22 → one sign session over adopted drafts (any count; unapproved stay drafts; tracker status never reset). **Step 4** board.md: approve routing/choreography out (:25, :31-32); annotate/collect, reopen, verdict, review, models stay; pending-draft copy `pending — signs at /execute or /sign` (exit-5 line landed in Task 3 — verify). **Step 5** execution-loop.md :40: bundle binds to the **governing plan version** (latest canonical, signed or amendment).
- [ ] **Step 6** Verify + commit: `python3 -m pytest tests/test_command_docs.py -q`; `rg -n "gate-batch|allow-single" commands/ skills/` → zero. `git add commands/sign.md commands/execute.md commands/adopt.md commands/board.md skills/managing-research-plans/references/execution-loop.md tests/test_command_docs.py && git commit -m "feat(commands): /sign command; execute gates; adopt via sign session; board approve retired"`

### Task 9: review/results/report + doctrine sweep

**Files:**
- Modify: `commands/review.md` (:9 re-commitment candidates are ordinary drafts; :15 triggers → "after a sign-off (by /sign, the /execute gate, /adopt) or an amendment finalize (/sync)"), `commands/results.md` (:19/:21 → **governing plan version** = latest canonical signed-or-amendment; approval never gates validation eligibility), `skills/managing-research-plans/templates/agents/rp-results-validator.md` (:3 governing-version wording), `commands/report.md` (verify-only: resolves from manifest.planVersion — expect zero edits), `skills/managing-research-plans/SKILL.md` (:38 loop, :46 doctrine + NO_GATE scoping per spec §3 rule 1), `skills/managing-research-plans/references/planning-doctrine.md` (:21), `skills/managing-research-plans/references/explore-before-planning.md` (:18 → "under a signed or recorded plan (see sign-off.md)"), `skills/managing-research-plans/references/results-adopt.md` (:21), `skills/managing-research-plans/templates/claude-md-section.md` (:20), `skills/managing-research-plans/templates/review-scorecard.md` (:3 mentions re-commitment drafts)
- Test: `tests/test_command_docs.py`; full `python3 -m pytest tests/ -q`

- [ ] **Step 1** Apply each targeted sentence rewrite (one file at a time; never reflow). **Step 2** Sweep `rg -n "Approve on the board|board Approve|review room|gate-batch" commands/ skills/` and fix remaining live-instruction hits owned here (README/reference.md hits are Task 11's). **Step 3** Suites green. **Step 4** Commit: `git add commands/review.md commands/results.md commands/report.md skills/managing-research-plans && git commit -m "feat(commands): governing-version binding; doctrine swept to sign sessions"`

### Task 10: Template trailer removal + dev-data amendments

**Files:**
- Modify: `skills/managing-research-plans/templates/execution-plan.md` (delete the final `---` + `Signed off: <researcher name>, <YYYY-MM-DD>` placeholder (:85-86); guidance comment (:8) → trailers are appended only by the finalization transaction — signature by a sign session, amendment by /sync), `board/src/dev-data.ts` (:95/:906 — add one amendment version (`Amendment recorded, …` trailer) on an executed component and one amendment-awaiting-recommitment component)
- Test: template contract tests (locate via `rg -l "execution-plan.md" board/src tests`) — ADD the regression pin: no line in the template matches either trailer regex (the p2p-bug pin); `parse.test.ts` dev-data assertions

- [ ] **Step 1** Red: the new template-contract assertion fails against the current template. **Step 2** Apply both edits; `python3 -m pytest tests/ -q` + `cd board && ./node_modules/.bin/vitest run` green. **Step 3** Commit: `git add skills/managing-research-plans/templates/execution-plan.md board/src/dev-data.ts tests board/src/lib && git commit -m "fix(template): drop placeholder sign-off trailer; dev-data amendment fixtures"` (adjust the staged test paths to the exact files touched).

### Task 11: README + reference.md + CHANGELOG

**Files:**
- Modify: `README.md` (:33/:49 — plans sign at execution; amendments recorded automatically; board = dashboard, approval = slim sign session), `docs/reference.md` (:23 command table + /sign; :33 primary loop; :96 gate section — invariant scoping per spec §3 rule 1, NO_GATE posture unchanged; :116 tree labels; exit-code table + 5), `CHANGELOG.md` under `[Unreleased]`: Added — /research-plans:sign, sign sessions (SignOffView, both transports), amendment versions (`Amendment recorded,` trailer), strict trailer grammar + malformed badge, /api/shutdown handoff (exit 5), payload `trailerState`; Changed — plans sign at /execute, /sync auto-finalizes amendments, /adopt uses sign sessions, tracker `planned` at draft time, Tracker drift warning keys on trailer state; Removed — in-board Approve, `--gate-batch`/`--allow-single`, template placeholder trailer.
- Test: `tests/test_command_docs.py` (if it pins reference.md tables)

- [ ] **Step 1** Apply edits (no hard-wrap; match file style). **Step 2** `python3 -m pytest tests/test_command_docs.py -q`. **Step 3** Commit: `git add README.md docs/reference.md CHANGELOG.md && git commit -m "docs: sign-at-execution story; changelog"`

### Task 12: Adversarial pins, amendment round trip, template rebuild (BRANCH COMPLETION — not a release)

**Files:**
- Test: `tests/test_gate_results.py` (:190 area) — **full round trip**: signed v1 → amendment v2 (hook allows) → materialize `.draft-v3` via the Task-8 recipe INCLUDING the trailer strip (assert candidate parses `none`) → `--sign` ticket over the candidate → signed v3 write passes `check_ticket` (hash over the exact candidate bytes + signature trailer). `tests/test_board.py` — VERIFY (do not duplicate) the existing hostile `--collect` ingress test (:2614) and the nested-annotation sanitizer test (:2723) still pass with `signoff` retained in the strip list; add an assertion only if a gap is found.
- Build: `cd board && npm run build` → commit the regenerated `skills/managing-research-plans/assets/board-template.html`

- [ ] **Step 1** Write the round-trip test; red where new; fix; green.
- [ ] **Step 2** Full verification: `python3 -m pytest tests/ -q` AND `cd board && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit` → green; record counts vs baselines (420 py collected / 450 vitest — both should GROW).
- [ ] **Step 3** Commit the test work with exact paths: `git add tests/test_gate_results.py tests/test_board.py && git commit -m "test: amendment re-commitment round trip; ingress sanitizer retention verified"`.
- [ ] **Step 4** Export smoke: synthetic project via the tests' make_project helpers; one component with signed v1 + amendment v2; `board.py --export`; assert the embedded JSON carries `trailerState: "amendment"` and NO `sign` key.
- [ ] **Step 5** `cd board && npm run build`; `git status --short` must show ONLY `skills/managing-research-plans/assets/board-template.html`; grep the built template for a unique SignOffView copy marker (e.g. the done-screen heading string chosen in Task 6) and for `malformed trailer`; `git add skills/managing-research-plans/assets/board-template.html && git commit -m "build(board): template with SignOffView"`; run `npm run build` AGAIN and require `git status --short` empty (reproducibility).

---

## Self-review record

- Spec coverage: §3 rules → Tasks 1/2/5 (+SKILL.md scoping Task 9); §4 slim gate incl. hook transport + lock handoff + legacy repair → Tasks 3/4/6/7; §5 flows → Tasks 7/8/9; §6 board → Tasks 4/5/6; §7 enforcement → Tasks 1/2; §8 scoring → Task 9; §9 template → Task 10; §11 ledger → Tasks 10/11/12; §12 forks: fork 1 → Task 8 recipe + Task 12 round trip; fork 2 → Task 1 regexes; fork 3 → Task 3.
- Codex plan-review fold (rev 2): P0-1 hook transport (Tasks 4/6); P0-2 trailer strip in materialization (Tasks 1 `strip_trailer`, 8, 12); P1 boardToken transport (Task 3, Global Constraints); P1 tracker scoping (Task 4); P1 Python trailerState (Task 4); P1 SignoffRequest consumers + real test-file names (Task 6); P1 timeout-persist strip (Task 2); P1 old wire shape `action.kind` (Task 4); P1 spawn_board for exit 5 (Task 3); P2 Tracker drift key (Task 5); P2 reachable-only empty states (Tasks 4/6); P2 item schema = existing gateBatch fields (Tasks 4/6); P2 Task-12 ordering/staging fixed. Open-question defaults folded: transport discriminator on the payload; `.sign-feedback` gitignored ephemeral, deleted by finalization; zero-eligible CLI-only; Task 12 = branch completion.
- Type consistency: payload `sign{batchId, transport, items}` with items `{component, proposedVersion, path, content, contentHash, ticketed}` (Python apply_sign/apply_gate ↔ TS SignPayload/SignItem); `parse_trailer`/`parseTrailer` identical shape; `strip_trailer` semantics cited by Tasks 2/8/12; ticket schema untouched; exit 5 defined once (Task 3), cited by board.md and reference.md.

## Revision history

- rev 1 (2026-07-18): initial 12-task plan from spec rev 2.
- rev 2 (2026-07-18): codex sol/xhigh plan review folded (2 P0, 7 P1, 4 P2). Structural change: Task 5 is display-only; ALL approve/gate UI removal consolidated into Task 6 with SignOffView so no task strands the gate UI; `--gate` now emits the sign payload with `transport: "hook"` and keeps `/api/approve|deny` + exit contract; `strip_trailer` added to Task 1 and used by the hook's timeout persistence (Task 2) and the re-commitment materialization (Tasks 8/12); shutdown auth switched to the existing boardToken stored in the lock; apply_sign scoped to current-tracker components; Python payload enriched with `trailerState`; test harness corrections (spawn_board for exit codes, App.gate/App.recovery instead of nonexistent App.test.tsx, exact old wire shape, existing ingress test verified not duplicated); Task 12 restaged (exact paths, double-build reproducibility) and renamed branch completion.
