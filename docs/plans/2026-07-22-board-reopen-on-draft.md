# Board reopen-on-draft (#4) Implementation Plan

> Executed inline (small prompt/doc change). Spec: `docs/specs/2026-07-22-board-reopen-on-draft-design.md`.

**Goal:** Make the `/research-plans:board` flow reopen the board on a component's new/refined draft after a request-change produces one — a third reopen trigger beside review-request and report-request.

**Approach:** Edit `commands/board.md` in three spots and add one guarding assertion to `tests/test_command_docs.py`. No React, no `board.py`, no bundle rebuild.

## Global Constraints
- On branch `add-features`. No `Co-Authored-By` in commits.
- Do NOT introduce any forbidden approval phrase ("Sign-off order", "clicked Approve", "Approve on the board", "board Approve", "review room", "gate-batch") — `test_command_docs.py` asserts their absence.
- The reopen reuses the stable port from `plans/.board.lock` and, unlike other reopens, **omits `--no-open`** so the draft appears as a fresh tab (the researcher's tab has auto-closed by reopen time).

---

### Task 1: Document the draft-reopen trigger in board.md (+ guard test)

**Files:**
- Modify: `commands/board.md` (exit-0 handling ~:18; draft-writing branch ~:26; close-the-loop ~:55)
- Test: `tests/test_command_docs.py` (add one assertion)

- [ ] **Step 1: Write the failing test**

Add to `tests/test_command_docs.py` (in the same TestCase class as the other board tests):

```python
    def test_board_reopens_on_a_produced_draft(self):
        command = (REPO / "commands" / "board.md").read_text(encoding="utf-8")
        # A produced/refined plan draft is a third reopen trigger beside review/report.
        self.assertIn("produced a new or refined plan draft", command)
        # ...and the reopen focuses that component's draft.
        self.assertIn("reopen the board focused on that component", command)
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `python3 -m pytest tests/test_command_docs.py::CommandDocs::test_board_reopens_on_a_produced_draft -q` (or `python3 -m unittest tests.test_command_docs -v`)
Expected: FAIL (phrases not yet in board.md).

- [ ] **Step 3: Edit board.md — exit-0 handling (~:18)**

Find the exit-0 clause ending "…that reopen is the payoff of the action, not the old refresh-after-everything." Change the exceptions sentence to add a third trigger. Replace:

> The two exceptions are a **review-request** and a **report-request** order — those reopen the board to show their result (with `--seed-annotations` / `--focus …:reports`), exactly as their step-5 handling describes; that reopen is the payoff of the action, not the old refresh-after-everything.

with:

> The exceptions that DO relaunch are a **review-request** and a **report-request** order — those reopen the board to show their result (with `--seed-annotations` / `--focus …:reports`) — and a **request-change whose routing produced a new or refined plan draft**, which reopens focused on that component's draft (step 5's draft branch describes it). Each reopen is the payoff of the action, not the old refresh-after-everything.

- [ ] **Step 4: Edit board.md — draft-writing branch (~:26)**

Find the anchored-comment branch sentence "…Run the review workflow on the draft. The board can show the canonical-to-draft diff, but it cannot sign the draft. Tell the researcher it is `pending — signs at /execute or /sign`. Never edit a canonical `vN.md`." Insert the reopen instruction right after the review-workflow sentence:

> Run the review workflow on the draft. Then **reopen the board focused on that component** to show the draft: reuse the stable port from `plans/.board.lock` and let the browser open — `python3 <script> --focus <NN-slug> --port <that port>` — omitting `--no-open` here (unlike other reopens) because the researcher's tab has auto-closed by now, so the draft must appear as a fresh tab; the board lands on the working draft with its diff and score. Acknowledge the order (`--ack`) only after this reopen, mirroring the review-request rule. The board can show the canonical-to-draft diff, but it cannot sign the draft. Tell the researcher it is `pending — signs at /execute or /sign`. Never edit a canonical `vN.md`.

- [ ] **Step 5: Edit board.md — close-the-loop (~:55)**

In step 6, replace "(and unless it was a review/report order that reopened to show its result)" with "(and unless it was a review/report order, or a request-change that produced a draft, that reopened to show its result)".

- [ ] **Step 6: Run the tests — expect PASS**

Run the whole doc-tests file so existing board assertions (no-approval-route, live-doctrine) still hold:
`python3 -m unittest tests.test_command_docs -v`
Expected: all pass, including the new `test_board_reopens_on_a_produced_draft`.

- [ ] **Step 7: Commit**

```bash
git add commands/board.md tests/test_command_docs.py
git commit -m "feat(board): reopen the board on a produced draft after a request-change"
```

## Self-Review
- **Spec coverage:** third reopen trigger (Steps 3–5) · reopen focused on draft, fresh tab, omit --no-open (Step 4) · ack-after-reopen (Step 4) · no-draft still closes (unchanged text at :55) · guard test (Steps 1–2). Covered.
- **Placeholders:** `<script>`, `<NN-slug>`, `<that port>` match board.md's existing placeholder style — not gaps.
- **No forbidden phrases** introduced; existing board assertions unaffected.
