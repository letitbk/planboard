# Output & Validation Implementation Plan

> **For agentic workers:** Execute task-by-task with the per-task TDD cycle and one commit per task. If the superpowers plugin's subagent-driven-development or executing-plans skills are available they structure this well — optional, never required (this plan is self-contained). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four-feature train from `docs/specs/2026-07-18-output-validation-reviewers-planning-design.md` (rev 3): rename the Results tab to "Output & Validation" (labels only), seal a mechanical F·A·I score into every finalized bundle and display it, upgrade the three rp-* reviewer prompts with codex-style discipline, and make `/plan` carry the planning doctrine standalone.

**Architecture:** `results.py` gains a pure `compute_score` sealed at finalize beside `integrity`; the board reads it through a new typed `coerceOutputScore` guard into an `OutputScorePanel` (sibling of `ScorePanel`, shared chip ramp). Prompt work is template/command prose with contracts untouched; `models.py cmd_check` learns template drift so upgrades announce themselves. Planning independence is a new `references/planning-doctrine.md` + two CLAUDE.md rules + a default grounding pass in `plan.md`.

**Tech Stack:** Python 3 stdlib (`results.py`, `models.py`, unittest), React + TypeScript + vitest (board), markdown command/skill prose.

**Rev 2 (2026-07-18):** codex plan review (sol·xhigh, `docs/specs/2026-07-18-codex-review-output-validation-plan.md` — 1 P0, 5 P1, 5 P2) folded in full: the report-regen shareHash claim was FALSE (reports are hashed into shareHash by design — spec corrected, test dropped, targetHash-side invariance kept); integrity basis carries count/deduped names/first detail; coerceOutputScore validates schemaVersion/names/basis/computedAt; `sections.integrity` is always true; Archive gets its own score test file (no extendable fixture exists); Tracker uses `Tracker.state.test.tsx`; commands/results.md + report.md carry singular "Result tab" (sweep pattern fixed); hosted-payload + tsc + header-pin + extra edge tests added; superpowers header made optional; update-mode gitignore executes before the skip; doctrine drops the unwired `/adopt` mention; full blocker definition in board.md.

## Global Constraints

- Execute on a feature branch in a worktree (EnterWorktree at execution start). Start EVERY bash command with an explicit `cd` to the worktree; run `git rev-parse --abbrev-ref HEAD` before each commit and stop if it prints `main`.
- `git add` explicit paths only — never `git add .`, `-A`, or `commit -a`.
- Do NOT run `npm run build` until Task 12 — it overwrites the shipped `skills/managing-research-plans/assets/board-template.html`.
- Board tests: `cd <worktree>/board && ./node_modules/.bin/vitest run <file>` (never bare `npx vitest` — the global npx cache vitest lacks jsdom).
- `board/src/lib/parse.ts` trips grep binary detection (embedded null byte) — use `rg -a` when searching it.
- If you run `./node_modules/.bin/tsc -b`, delete `board/tsconfig.tsbuildinfo` afterwards (untracked cache; must not enter commits).
- Never modify `scripts/signoff_gate.py`, the version fields (`.claude-plugin/plugin.json`, `board/package.json`), or any existing `plans/execution/**/vN.md`.
- IDs and tokens never change: tab id `results`, scope `results`, anchors `results-*`, the `--focus slug[:rN][:reports]` grammar, localStorage key shapes. Labels only.
- JSON contracts stay byte-compatible: reviewer comment shape `{overall, comments:[{section,quote,comment}]}`, scorecard schemaVersion 3, validator `{steps,criteria,notes}`. Prompt text may grow; shapes may not.
- Commit messages: repo conventional style, no Co-Authored-By trailer.
- Markdown prose: one line per paragraph (no hard wrap); match each file's existing style.
- Full suites at the end of every task that touches code: py `cd <worktree> && python3 -m unittest discover -s tests -v 2>&1 | tail -3`; board `cd <worktree>/board && ./node_modules/.bin/vitest run 2>&1 | tail -5`.

---

### Task 1: `compute_score` in results.py, sealed at finalize

**Files:**
- Modify: `skills/managing-research-plans/scripts/results.py` (insert after `compute_integrity`, which ends ~line 260; hook into `cmd_finalize` after line 372 `manifest["integrity"] = ...`)
- Test: `tests/test_results.py` (new `TestOutputScore` class after `TestIntegrity`, which ends ~line 660)

**Interfaces:**
- Consumes: `compute_integrity` output shape (`{status, checkedAt, checks:[{name, verdict, detail}]}`), `ValidationBlock` dict shape (`{status, steps:[{planStep, verdict}], criteria:[{criterion, verdict}]}`).
- Produces: `results.compute_score(validation, integrity, now=None) -> dict` returning `{"schemaVersion": 1, "channels": [{"id","name","score","basis"}×3 fixed order fidelity/attainment/integrity], "profile": "F3·A2·I3" (– for null), "total": int|None, "max": 9, "computedAt": str}`. `cmd_finalize` seals it as `manifest["score"]`. Tasks 2–5 rely on this exact shape.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_results.py` (helpers reuse the module's existing `make_project`, `run_cli`, `manifest_for`):

```python
class TestOutputScore(unittest.TestCase):
    def _steps(self, *verdicts):
        return [{"planStep": "s%d" % i, "verdict": v} for i, v in enumerate(verdicts)]

    def _criteria(self, *verdicts):
        return [{"criterion": "c%d" % i, "verdict": v} for i, v in enumerate(verdicts)]

    def _validation(self, status="conforms", steps=None, criteria=None):
        v = {"status": status}
        if steps is not None:
            v["steps"] = steps
        if criteria is not None:
            v["criteria"] = criteria
        return v

    def _integrity(self, *fail_names, **kw):
        names = ["checksums", "artifacts-present", "artifact-refs", "findings-sourced"]
        checks = [{"name": n, "verdict": "fail" if n in fail_names else "pass",
                   "detail": ""} for n in names]
        return {"status": kw.get("status") or ("failed" if fail_names else "passed"),
                "checkedAt": "t", "checks": checks}

    def test_all_clean_scores_3_3_3(self):
        sc = results.compute_score(
            self._validation(steps=self._steps("followed", "followed"),
                             criteria=self._criteria("met")),
            self._integrity(), now="2026-07-18 12:00")
        self.assertEqual([c["score"] for c in sc["channels"]], [3, 3, 3])
        self.assertEqual([c["id"] for c in sc["channels"]],
                         ["fidelity", "attainment", "integrity"])
        self.assertEqual(sc["profile"], "F3·A3·I3")
        self.assertEqual(sc["total"], 9)
        self.assertEqual(sc["max"], 9)
        self.assertEqual(sc["schemaVersion"], 1)
        self.assertEqual(sc["computedAt"], "2026-07-18 12:00")

    def test_fidelity_tiers_worst_wins(self):
        for verdicts, want in [(("followed", "amended"), 2),
                               (("amended", "unverifiable"), 1),
                               (("unverifiable", "deviated-unrecorded"), 0),
                               (("followed", "not-executed"), 0)]:
            sc = results.compute_score(
                self._validation(steps=self._steps(*verdicts),
                                 criteria=self._criteria("met")),
                self._integrity(), now="t")
            self.assertEqual(sc["channels"][0]["score"], want, verdicts)

    def test_attainment_tiers_worst_wins(self):
        for verdicts, want in [(("met", "met"), 3), (("met", "partial"), 2),
                               (("partial", "unverifiable"), 1),
                               (("unverifiable", "not-met"), 0)]:
            sc = results.compute_score(
                self._validation(steps=self._steps("followed"),
                                 criteria=self._criteria(*verdicts)),
                self._integrity(), now="t")
            self.assertEqual(sc["channels"][1]["score"], want, verdicts)

    def test_integrity_rank_worst_failure_wins(self):
        for fails, want in [((), 3), (("findings-sourced",), 2),
                            (("artifact-refs",), 1),
                            (("artifact-refs", "checksums"), 0),
                            (("artifacts-present",), 0)]:
            sc = results.compute_score(
                self._validation(steps=self._steps("followed"),
                                 criteria=self._criteria("met")),
                self._integrity(*fails), now="t")
            self.assertEqual(sc["channels"][2]["score"], want, fails)

    def test_not_applicable_and_skipped_null_fa_even_with_arrays(self):
        for status in ("not-applicable", "skipped"):
            sc = results.compute_score(
                self._validation(status=status, steps=self._steps("followed"),
                                 criteria=self._criteria("met")),
                self._integrity(), now="t")
            self.assertIsNone(sc["channels"][0]["score"])
            self.assertIsNone(sc["channels"][1]["score"])
            self.assertEqual(sc["channels"][2]["score"], 3)
            self.assertEqual(sc["profile"], "F–·A–·I3")
            self.assertIsNone(sc["total"])

    def test_missing_validation_block_nulls_fa(self):
        sc = results.compute_score(None, self._integrity(), now="t")
        self.assertEqual(sc["profile"], "F–·A–·I3")
        self.assertIsNone(sc["total"])

    def test_empty_or_missing_verdict_lists_null_not_3(self):
        sc = results.compute_score(self._validation(steps=[], criteria=None),
                                   self._integrity(), now="t")
        self.assertIsNone(sc["channels"][0]["score"])
        self.assertIsNone(sc["channels"][1]["score"])

    def test_unverifiable_status_without_arrays_nulls_fa(self):
        sc = results.compute_score({"status": "unverifiable", "reason": "x"},
                                   self._integrity(), now="t")
        self.assertIsNone(sc["channels"][0]["score"])
        self.assertIsNone(sc["channels"][1]["score"])

    def test_unknown_verdicts_ignored_and_noted(self):
        sc = results.compute_score(
            self._validation(steps=self._steps("followed", "bogus"),
                             criteria=self._criteria("met")),
            self._integrity(), now="t")
        self.assertEqual(sc["channels"][0]["score"], 3)
        self.assertIn("bogus", sc["channels"][0]["basis"])

    def test_unknown_check_names_ignored_and_noted(self):
        integ = self._integrity()
        integ["checks"].append({"name": "mystery", "verdict": "fail"})
        sc = results.compute_score(
            self._validation(steps=self._steps("followed"),
                             criteria=self._criteria("met")), integ, now="t")
        self.assertEqual(sc["channels"][2]["score"], 3)
        self.assertIn("mystery", sc["channels"][2]["basis"])

    def test_status_vs_checks_disagreement_noted(self):
        integ = self._integrity(status="passed")
        integ["checks"][0]["verdict"] = "fail"
        sc = results.compute_score(
            self._validation(steps=self._steps("followed"),
                             criteria=self._criteria("met")), integ, now="t")
        self.assertEqual(sc["channels"][2]["score"], 0)
        self.assertIn("disagrees", sc["channels"][2]["basis"])

    def test_missing_integrity_nulls_channel(self):
        sc = results.compute_score(
            self._validation(steps=self._steps("followed"),
                             criteria=self._criteria("met")), None, now="t")
        self.assertIsNone(sc["channels"][2]["score"])

    def test_basis_counts_worst_tier_and_names_first(self):
        sc = results.compute_score(
            self._validation(
                steps=self._steps("deviated-unrecorded", "deviated-unrecorded",
                                  "followed"),
                criteria=self._criteria("met")),
            self._integrity(), now="t")
        self.assertIn("2", sc["channels"][0]["basis"])
        self.assertIn("s0", sc["channels"][0]["basis"])

    def test_deterministic_with_fixed_now(self):
        args = (self._validation(steps=self._steps("followed"),
                                 criteria=self._criteria("met")),
                self._integrity())
        self.assertEqual(results.compute_score(*args, now="t"),
                         results.compute_score(*args, now="t"))

    def test_non_list_steps_null(self):
        sc = results.compute_score(
            self._validation(steps="oops", criteria=self._criteria("met")),
            self._integrity(), now="t")
        self.assertIsNone(sc["channels"][0]["score"])

    def test_empty_integrity_checks_null(self):
        sc = results.compute_score(
            self._validation(steps=self._steps("followed"),
                             criteria=self._criteria("met")),
            {"status": "passed", "checkedAt": "t", "checks": []}, now="t")
        self.assertIsNone(sc["channels"][2]["score"])

    def test_unverifiable_status_with_arrays_derives_normally(self):
        sc = results.compute_score(
            self._validation(status="unverifiable",
                             steps=self._steps("unverifiable"),
                             criteria=self._criteria("unverifiable")),
            self._integrity(), now="t")
        self.assertEqual(sc["channels"][0]["score"], 1)
        self.assertEqual(sc["channels"][1]["score"], 1)

    def test_duplicate_check_names_worst_instance_deduped_basis_with_detail(self):
        integ = self._integrity()
        integ["checks"].append({"name": "checksums", "verdict": "fail",
                                "detail": "copy differs"})
        integ["checks"].append({"name": "checksums", "verdict": "fail",
                                "detail": "second"})
        sc = results.compute_score(
            self._validation(steps=self._steps("followed"),
                             criteria=self._criteria("met")), integ, now="t")
        self.assertEqual(sc["channels"][2]["score"], 0)
        basis = sc["channels"][2]["basis"]
        self.assertIn("2 check(s) failed", basis)
        self.assertIn("checksums", basis)
        self.assertNotIn("checksums, checksums", basis)
        self.assertIn("copy differs", basis)

    def test_finalize_seals_score_and_overwrites_staged(self):
        # Staging construction: copy the exact setup used by
        # test_finalize_seals_integrity_into_manifest (this file, ~line 643) —
        # make_project + a staging dir with report.md + manifest_for — then:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            make_project(root)
            comp = root / "plans" / "execution" / "02-analysis"
            staging = comp / "results" / ".staging"
            staging.mkdir(parents=True)
            (staging / "report.md").write_text("r", encoding="utf-8")
            man = manifest_for(staging)
            man["validation"] = {
                "status": "conforms",
                "steps": [{"planStep": "s", "verdict": "followed"}],
                "criteria": [{"criterion": "c", "verdict": "met"}],
            }
            man["score"] = {"schemaVersion": 99, "bogus": True}  # must be replaced
            (staging / "manifest.json").write_text(json.dumps(man),
                                                   encoding="utf-8")
            (staging / "validation.md").write_text("v", encoding="utf-8")
            r = run_cli(root, "finalize", "--staging", str(staging))
            self.assertEqual(r.returncode, 0, r.stderr)
            sealed = json.loads((comp / "results" / "r1" / "manifest.json")
                                .read_text(encoding="utf-8"))
            sc = sealed["score"]
            self.assertEqual(sc["schemaVersion"], 1)
            self.assertEqual([c["score"] for c in sc["channels"]], [3, 3, 3])
            self.assertEqual(sc["total"], 9)
```

If `manifest_for`'s defaults require artifact files on disk (read its body at the top of the file), reuse exactly what the existing finalize tests do to satisfy `validate_staged` — adapt the staging setup, not the assertions.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd <worktree> && python3 -m unittest tests.test_results.TestOutputScore -v 2>&1 | tail -5`
Expected: FAIL/ERROR with `AttributeError: module 'results' has no attribute 'compute_score'`

- [ ] **Step 3: Implement `compute_score`**

Insert into `skills/managing-research-plans/scripts/results.py` directly after `compute_integrity` (after line 260):

```python
# Verdict tiers for the mechanical F/A channels, worst first. Unknown verdicts
# are ignored for ranking and noted in the basis.
_STEP_TIERS = (
    (("deviated-unrecorded", "not-executed"), 0),
    (("unverifiable",), 1),
    (("amended",), 2),
)
_CRITERION_TIERS = (
    (("not-met",), 0),
    (("unverifiable",), 1),
    (("partial",), 2),
)
# Integrity check severity: worst failing check sets the score directly.
_INTEGRITY_RANK = {"checksums": 0, "artifacts-present": 0,
                   "artifact-refs": 1, "findings-sourced": 2}


def _verdict_channel(items, label_key, tiers, best_verdict, noun):
    """Score one verdict-list channel. Returns (score-or-None, basis)."""
    if not isinstance(items, list) or not items:
        return None, "no %s recorded" % noun
    recognized = {best_verdict} | {v for vs, _ in tiers for v in vs}
    unknown = sorted({str(it.get("verdict")) for it in items
                      if it.get("verdict") not in recognized})
    scored = [it for it in items if it.get("verdict") in recognized]
    note = ("; ignored unknown verdicts: %s" % ", ".join(unknown)) if unknown else ""
    if not scored:
        return None, "no recognizable verdicts%s" % note
    for verdicts, score in tiers:
        hits = [it for it in scored if it.get("verdict") in verdicts]
        if hits:
            first = str(hits[0].get(label_key) or "?")
            return score, "%d %s %s, first: '%s'%s" % (
                len(hits), noun, "/".join(verdicts), first, note)
    return 3, "all %d %s %s%s" % (len(scored), noun, best_verdict, note)


def _integrity_channel(integrity):
    if not isinstance(integrity, dict):
        return None, "no integrity block"
    checks = integrity.get("checks")
    if not isinstance(checks, list) or not checks:
        return None, "no integrity checks recorded"
    fails = [c for c in checks if c.get("verdict") == "fail"]
    known_fails = [c for c in fails if c.get("name") in _INTEGRITY_RANK]
    unknown = sorted({str(c.get("name")) for c in checks
                      if c.get("name") not in _INTEGRITY_RANK})
    note = ("; ignored unknown checks: %s" % ", ".join(unknown)) if unknown else ""
    status = integrity.get("status")
    expected = "failed" if fails else "passed"
    disagree = ("; note: recorded status '%s' disagrees with the checks" % status
                if status in ("passed", "failed") and status != expected else "")
    if not known_fails:
        base = ("all %d checks pass" % len(checks) if not fails
                else "no recognized check failed")
        return 3, base + note + disagree
    score = min(_INTEGRITY_RANK[c.get("name")] for c in known_fails)
    worst = [c for c in known_fails if _INTEGRITY_RANK[c.get("name")] == score]
    names = ", ".join(sorted({str(c.get("name")) for c in worst}))
    first_detail = str(worst[0].get("detail") or "").strip()
    detail = " — %s" % first_detail if first_detail else ""
    return score, "%d check(s) failed: %s%s%s%s" % (
        len(worst), names, detail, note, disagree)


def compute_score(validation, integrity, now=None):
    """Mechanical F·A·I output score sealed into the manifest at finalize.
    Pure arithmetic over the sealed validation verdicts and integrity checks —
    no additional agent call (the verdicts themselves come from the validator
    that ran at capture). Advisory: never blocks finalize. Deterministic given
    `now` (same injection pattern as compute_integrity)."""
    val = validation if isinstance(validation, dict) else None
    status = val.get("status") if val else None
    if val is None:
        f = a = (None, "no validation block")
    elif status in ("not-applicable", "skipped"):
        reason = "retrofit" if status == "not-applicable" else "skipped"
        f = a = (None, "no plan validation (%s)" % reason)
    else:
        f = _verdict_channel(val.get("steps"), "planStep", _STEP_TIERS,
                             "followed", "steps")
        a = _verdict_channel(val.get("criteria"), "criterion", _CRITERION_TIERS,
                             "met", "criteria")
    i = _integrity_channel(integrity)
    channels = [
        {"id": "fidelity", "name": "Fidelity", "score": f[0], "basis": f[1]},
        {"id": "attainment", "name": "Attainment", "score": a[0], "basis": a[1]},
        {"id": "integrity", "name": "Integrity", "score": i[0], "basis": i[1]},
    ]
    scores = [c["score"] for c in channels]
    total = sum(scores) if all(isinstance(s, int) for s in scores) else None
    profile = "·".join("%s%s" % (letter, s if s is not None else "–")
                       for letter, s in zip("FAI", scores))
    return {"schemaVersion": 1, "channels": channels, "profile": profile,
            "total": total, "max": 9,
            "computedAt": now or datetime.datetime.now().strftime("%Y-%m-%d %H:%M")}
```

In `cmd_finalize`, directly after `manifest["integrity"] = compute_integrity(manifest, staging)` (line 372), add:

```python
    # Seal the mechanical F·A·I output score, derived from the validation
    # verdicts and the integrity checks just sealed. Diagnostic, never a gate;
    # any stale staged `score` is replaced unconditionally.
    manifest["score"] = compute_score(manifest.get("validation"),
                                      manifest["integrity"])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd <worktree> && python3 -m unittest tests.test_results -v 2>&1 | tail -3`
Expected: OK (all classes, including the new one)

- [ ] **Step 5: Commit**

```bash
git add skills/managing-research-plans/scripts/results.py tests/test_results.py
git commit -m "feat(results): mechanical F·A·I output score sealed at finalize"
```

---

### Task 2: score delivery regression tests (payload, shareHash, export)

**Files:**
- Test: `tests/test_board.py` (extend the results-payload/export test classes — `TestResultsPayload` ~line 571, `TestExportResults` ~line 680)

**Interfaces:**
- Consumes: `manifest.score` block shape from Task 1; existing `make_project`-style helpers and export machinery already in `tests/test_board.py`.
- Produces: pinned facts later tasks and releases rely on — score flows to the payload verbatim, perturbs `shareHash`, and reaches static export; a derived report file changes neither. No production code (board.py passes manifests through verbatim).

- [ ] **Step 1: Write the tests (expected to pass — they pin existing pass-through behavior plus Task 1's block)**

Model the fixture on how the existing results-payload tests write `rN/manifest.json`, adding a `"score"` block (any valid Task 1 shape, e.g. the 3·3·3 one). Three tests:

```python
    def test_score_block_reaches_payload(self):
        # fixture: bundle whose manifest.json contains "score": {...}
        # assert payload["files"]["executionPlans"][0]["results"][0]["manifest"]["score"]["profile"] == "F3·A3·I3"

    def test_score_perturbs_share_hash(self):
        # collect payload twice: once with the score block, once with the same
        # manifest minus "score"; assert the two shareHash values differ

    def test_score_survives_hosted_payload(self):
        # reuse TestCollaboratorFacingPayload's fixture idiom (tests/test_board.py:369);
        # assert the collaborator-facing/hosted payload's bundle manifest carries "score"

    # NOTE (plan-review P0): report files ARE hashed into shareHash
    # (board.py payload_files + collect_payload; pinned by TestShareHash,
    # tests/test_board.py:319) — a share going stale when its report changes is
    # correct existing behavior. Do NOT write a report-regen shareHash-invariance
    # test; the report-regen invariance that IS true (result targetHash) is
    # pinned on the TS side in Task 3.

    def test_score_survives_export(self):
        # run the export path the TestExportResults class already uses;
        # extract the embedded JSON payload; assert "F3·A3·I3" present

    def test_score_survives_focused_remote_share(self):
        # collect a payload in remote mode with --focus <slug>:r1 (reuse the
        # focused-share fixture the existing remote/focus tests build);
        # assert the focused bundle's manifest still carries "score"
```

Write them as real tests by copying the exact fixture/collect/export calls the neighboring tests in each class use — the comments above state the assertions; the setup must be the class's own idiom (these classes already construct projects and parse exported payloads).

- [ ] **Step 2: Run**

Run: `cd <worktree> && python3 -m unittest tests.test_board -v 2>&1 | tail -3`
Expected: OK. If `test_score_perturbs_share_hash` fails, STOP — that breaks the spec's seam claim and needs investigation, not test deletion.

- [ ] **Step 3: Commit**

```bash
git add tests/test_board.py
git commit -m "test(board): pin score delivery — payload pass-through, shareHash sensitivity, export"
```

---

### Task 3: board types + `coerceOutputScore` + targetHash pin

**Files:**
- Modify: `board/src/lib/types.ts` (insert after `IntegrityBlock`, ends line 189; add `score?: OutputScore` to `ResultsManifest` after line 175)
- Create: `board/src/lib/outputScore.ts`
- Test: `board/src/lib/outputScore.test.ts`, extend `board/src/lib/hostedComments.test.ts`

**Interfaces:**
- Consumes: Task 1's sealed block shape.
- Produces: `OutputScore`/`OutputScoreChannel`/`OutputScoreChannelId` types; `coerceOutputScore(raw: unknown): OutputScore | null`. Tasks 4–5 import both.

- [ ] **Step 1: Write the failing tests**

`board/src/lib/outputScore.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { coerceOutputScore } from "./outputScore";

const good = {
  schemaVersion: 1,
  channels: [
    { id: "fidelity", name: "Fidelity", score: 3, basis: "all 2 steps followed" },
    { id: "attainment", name: "Attainment", score: 2, basis: "1 criteria partial, first: 'c0'" },
    { id: "integrity", name: "Integrity", score: 3, basis: "all 4 checks pass" },
  ],
  profile: "F3·A2·I3",
  total: 8,
  max: 9,
  computedAt: "2026-07-18 12:00",
};

describe("coerceOutputScore", () => {
  it("accepts a well-formed block", () => {
    expect(coerceOutputScore(good)).not.toBeNull();
  });
  it("accepts null channels with null total and – profile", () => {
    const s = {
      ...good,
      channels: [
        { id: "fidelity", name: "Fidelity", score: null, basis: "no plan validation (retrofit)" },
        { id: "attainment", name: "Attainment", score: null, basis: "no plan validation (retrofit)" },
        { id: "integrity", name: "Integrity", score: 3, basis: "all 4 checks pass" },
      ],
      profile: "F–·A–·I3",
      total: null,
    };
    expect(coerceOutputScore(s)).not.toBeNull();
  });
  it.each([
    ["missing", null],
    ["non-object", 7],
    ["wrong channel count", { ...good, channels: good.channels.slice(0, 2) }],
    ["wrong channel order", { ...good, channels: [good.channels[1], good.channels[0], good.channels[2]] }],
    ["out-of-range score", { ...good, channels: [{ ...good.channels[0], score: 4 }, good.channels[1], good.channels[2]] }],
    ["non-integer score", { ...good, channels: [{ ...good.channels[0], score: 2.5 }, good.channels[1], good.channels[2]] }],
    ["inconsistent total", { ...good, total: 9 }],
    ["non-null total with null channel", { ...good, channels: [{ ...good.channels[0], score: null }, good.channels[1], good.channels[2]], profile: "F–·A2·I3" }],
    ["wrong max", { ...good, max: 15 }],
    ["profile mismatch", { ...good, profile: "F3·A3·I3" }],
    ["wrong schemaVersion", { ...good, schemaVersion: 2 }],
    ["wrong channel name", { ...good, channels: [{ ...good.channels[0], name: "F" }, good.channels[1], good.channels[2]] }],
    ["non-string basis", { ...good, channels: [{ ...good.channels[0], basis: 7 }, good.channels[1], good.channels[2]] }],
    ["non-string computedAt", { ...good, computedAt: 42 }],
  ])("rejects %s", (_name, raw) => {
    expect(coerceOutputScore(raw)).toBeNull();
  });
});
```

Extend `board/src/lib/hostedComments.test.ts` (reuse the file's existing results-scoped fixture, ~line 140):

```ts
it("result targetHash changes with manifest.score but not with publishedReport", () => {
  // Build the fixture bundle twice: base vs base+manifest.score → hashes differ.
  // Build base vs base+publishedReport file → hashes equal (publishedReport is
  // excluded from the hash source). Use the same targetHash helper the
  // neighboring staleness tests call.
});
```

Fill the body with the file's own fixture idiom; the two assertions are the contract.

- [ ] **Step 2: Run to verify failure**

Run: `cd <worktree>/board && ./node_modules/.bin/vitest run src/lib/outputScore.test.ts 2>&1 | tail -5`
Expected: FAIL — `Cannot find module './outputScore'`

- [ ] **Step 3: Implement**

`board/src/lib/types.ts`, after `IntegrityBlock` (line 189):

```ts
// Mechanical F·A·I output score sealed by results.py at finalize — derived
// from the validation verdicts and integrity checks, not an independent
// measurement. Absent on bundles finalized before this feature. Diagnostic,
// never a gate. Channels are fixed: fidelity, attainment, integrity.
export type OutputScoreChannelId = "fidelity" | "attainment" | "integrity";

export interface OutputScoreChannel {
  id: OutputScoreChannelId;
  name: string;
  score: number | null; // integer 0–3, or null when underivable
  basis?: string;
}

export interface OutputScore {
  schemaVersion: number;
  channels: OutputScoreChannel[];
  profile: string; // e.g. "F3·A2·I3", "–" for null channels
  total: number | null;
  max: number;
  computedAt?: string;
}
```

Add to `ResultsManifest` after `integrity?: IntegrityBlock;`:

```ts
  score?: OutputScore; // mechanical F·A·I score, sealed at finalize
```

`board/src/lib/outputScore.ts`:

```ts
import type { OutputScore, OutputScoreChannelId } from "./types";

const CHANNEL_IDS: OutputScoreChannelId[] = ["fidelity", "attainment", "integrity"];
const CHANNEL_NAMES = ["Fidelity", "Attainment", "Integrity"];
const LETTERS = ["F", "A", "I"];

/** Runtime guard for the sealed manifest.score block. Returns the typed block
 * only when it matches what results.py seals — schemaVersion 1, exactly three
 * ordered/named channels with scores null|0–3, string basis/computedAt, and a
 * consistent profile/total/max — anything else is treated as absent. */
export function coerceOutputScore(raw: unknown): OutputScore | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (s.schemaVersion !== 1) return null;
  if (s.computedAt !== undefined && typeof s.computedAt !== "string") return null;
  const ch = s.channels;
  if (!Array.isArray(ch) || ch.length !== 3) return null;
  const scores: (number | null)[] = [];
  for (let i = 0; i < 3; i++) {
    const c = ch[i] as Record<string, unknown> | null;
    if (!c || typeof c !== "object" || c.id !== CHANNEL_IDS[i]) return null;
    if (c.name !== CHANNEL_NAMES[i]) return null;
    if (c.basis !== undefined && typeof c.basis !== "string") return null;
    const sc = c.score;
    if (sc === null) {
      scores.push(null);
    } else if (typeof sc === "number" && Number.isInteger(sc) && sc >= 0 && sc <= 3) {
      scores.push(sc);
    } else {
      return null;
    }
  }
  const allInt = scores.every((v): v is number => typeof v === "number");
  if (allInt) {
    if (s.total !== scores.reduce((x, y) => x + y, 0)) return null;
  } else if (s.total !== null) {
    return null;
  }
  if (s.max !== 9) return null;
  const expectedProfile = scores
    .map((v, i) => LETTERS[i] + (v === null ? "–" : String(v)))
    .join("·");
  if (s.profile !== expectedProfile) return null;
  return raw as OutputScore;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd <worktree>/board && ./node_modules/.bin/vitest run src/lib/outputScore.test.ts src/lib/hostedComments.test.ts 2>&1 | tail -5`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add board/src/lib/types.ts board/src/lib/outputScore.ts board/src/lib/outputScore.test.ts board/src/lib/hostedComments.test.ts
git commit -m "feat(board): OutputScore types + coerceOutputScore guard, targetHash pin"
```

---

### Task 4: shared chip ramp + OutputScorePanel + banner wiring

**Files:**
- Create: `board/src/components/scoreChip.ts`, `board/src/components/OutputScorePanel.tsx`
- Modify: `board/src/components/ScorePanel.tsx` (delete local `chipClass` lines 15-25, import shared), `board/src/views/Results.tsx` (banner, ~line 497)
- Test: `board/src/components/OutputScorePanel.test.tsx`

**Interfaces:**
- Consumes: `coerceOutputScore`, `OutputScore` (Task 3).
- Produces: `chipClass(score: number | null): string` from `components/scoreChip.ts` (ScorePanel keeps passing numbers); `<OutputScorePanel score={OutputScore} sections={{validation: boolean; integrity: boolean}} />`. Task 5 reuses nothing from here (it uses `coerceOutputScore` directly).

- [ ] **Step 1: Write the failing component test**

`board/src/components/OutputScorePanel.test.tsx` — mirror the imports/setup of an existing component test (open `board/src/views/Results.integrity.test.tsx` and copy its harness idiom; assertions below stay the same):

```tsx
// render <OutputScorePanel score={good} sections={{ validation: true, integrity: true }} />
// assert: text "F3", "A2", "I3" present; text "8/9" present
// assert: the F chip's title attribute contains its basis ("all 2 steps followed")
// click the chips button → popover appears: basis text "all 4 checks pass" visible,
//   caption contains "derived from", buttons/links for validation + integrity present
// re-render with sections={{ validation: false, integrity: true }} → no validation link
// render with the null-channel fixture (profile "F–·A–·I3", total null)
//   → assert text "F–" present and "–/9" present
```

Use the `good` fixture shape from Task 3's test (copy it in — tests must not import each other's fixtures).

Also create `board/src/views/Results.score.test.tsx`, modeled on `Results.integrity.test.tsx`'s harness (its render/fixture idiom, `Results.integrity.test.tsx:9`): a bundle whose manifest carries the valid `good` score → the banner shows `F3` and `8/9`; a bundle whose manifest carries a malformed score (`{ max: 15 }`) → neither appears (coercion treats it as absent).

- [ ] **Step 2: Run to verify failure**

Run: `cd <worktree>/board && ./node_modules/.bin/vitest run src/components/OutputScorePanel.test.tsx 2>&1 | tail -5`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`board/src/components/scoreChip.ts`:

```ts
// 0..3 colour ramp shared by ScorePanel (plan scorecards) and OutputScorePanel
// (bundle F·A·I score). A 0 reads as a hard gap and gets the alarm colour;
// null (underivable channel) is muted, not alarming.
export function chipClass(score: number | null): string {
  if (score === null)
    return "border-stone-300 bg-stone-50 text-stone-400 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-500";
  if (score <= 0)
    return "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300";
  if (score === 1)
    return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300";
  if (score === 2)
    return "border-lime-300 bg-lime-50 text-lime-800 dark:border-lime-800 dark:bg-lime-950 dark:text-lime-300";
  return "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300";
}
```

`board/src/components/ScorePanel.tsx`: delete the local `chipClass` function (lines 15-25) and add `import { chipClass } from "./scoreChip";`. No other change.

`board/src/components/OutputScorePanel.tsx`:

```tsx
import { useState } from "react";
import { chipClass } from "./scoreChip";
import type { OutputScore } from "../lib/types";

const LETTERS = ["F", "A", "I"];

/** The bundle-header output score: three F·A·I chips with the derivation basis
 * on hover, expandable to the full derivation table. Mechanical — the caption
 * says so, so it is never mistaken for an independent measurement. */
export default function OutputScorePanel({
  score,
  sections,
}: {
  score: OutputScore;
  sections: { validation: boolean; integrity: boolean };
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Output score — derived from validation verdicts and integrity checks; click for the derivation"
        className="inline-flex items-center gap-0.5 rounded hover:bg-stone-100 dark:hover:bg-stone-800"
      >
        {score.channels.map((c, i) => (
          <span
            key={c.id}
            className={`rounded border px-1 py-0.5 text-[11px] font-semibold tabular-nums ${chipClass(c.score)}`}
            title={`${c.name}: ${c.score ?? "–"}/3${c.basis ? ` — ${c.basis}` : ""}`}
          >
            {LETTERS[i]}
            {c.score ?? "–"}
          </span>
        ))}
        <span className="ml-0.5 text-[11px] tabular-nums opacity-70">
          {score.total ?? "–"}/{score.max}
        </span>
      </button>
      {open && (
        <OutputScoreDetail score={score} sections={sections} onClose={() => setOpen(false)} />
      )}
    </span>
  );
}

function OutputScoreDetail({
  score,
  sections,
  onClose,
}: {
  score: OutputScore;
  sections: { validation: boolean; integrity: boolean };
  onClose: () => void;
}) {
  const jump = (id: string) => () => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    onClose();
  };
  return (
    <div className="absolute left-0 top-full z-20 mt-1 w-96 max-w-[90vw] rounded-lg border border-stone-200 bg-white p-3 text-left text-xs text-stone-700 shadow-lg dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-semibold">{score.profile} · output score</span>
        <button
          type="button"
          onClick={onClose}
          className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <p className="mb-2 text-stone-500">
        Derived from the bundle's validation verdicts and integrity checks — mechanical, not an independent measurement.
      </p>
      <table className="w-full border-collapse">
        <tbody>
          {score.channels.map((c) => (
            <tr key={c.id} className="border-t border-stone-100 dark:border-stone-800 align-top">
              <td className="py-1 pr-2 font-medium whitespace-nowrap">{c.name}</td>
              <td className="py-1 pr-2">
                <span className={`rounded border px-1 text-[11px] font-semibold ${chipClass(c.score)}`}>
                  {c.score ?? "–"}
                </span>
              </td>
              <td className="py-1 text-stone-500">{c.basis ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-stone-500">
        {score.computedAt && <span>computed {score.computedAt}</span>}
        {sections.validation && (
          <button type="button" className="underline" onClick={jump("results-validation")}>
            validation details
          </button>
        )}
        {sections.integrity && (
          <button type="button" className="underline" onClick={jump("results-integrity")}>
            integrity details
          </button>
        )}
      </p>
    </div>
  );
}
```

`board/src/views/Results.tsx`: add imports (`OutputScorePanel`, `coerceOutputScore`). The early return (`if (!group || !bundle)`) is at line 362 and `const m = bundle.manifest; const badge = bundleStateBadge(bundle);` follow it at lines 371-372 — directly after `badge`, add (plain computation, not a hook — it must stay legal after the early return):

```tsx
  const outputScore = m?.score ? coerceOutputScore(m.score) : null;
```

In the banner (line 497 block), directly after the `<span className="text-sm font-semibold">…{badge.label}</span>` element, add:

```tsx
          {outputScore && (
            <OutputScorePanel
              score={outputScore}
              sections={{ validation: !!m?.validation, integrity: true }}
            />
          )}
```

(`integrity: true` because the `#results-integrity` jump target renders whenever the manifest exists — including the "not recorded" state, `Results.tsx:600-604` — and a displayed score implies the manifest exists. The `#results-validation` target renders only when `m.validation` does.)

- [ ] **Step 4: Run to verify pass + full board suite**

Run: `cd <worktree>/board && ./node_modules/.bin/vitest run 2>&1 | tail -5`
Expected: PASS all files (ScorePanel tests must still pass after the ramp extraction)

- [ ] **Step 5: Commit**

```bash
git add board/src/components/scoreChip.ts board/src/components/OutputScorePanel.tsx board/src/components/OutputScorePanel.test.tsx board/src/components/ScorePanel.tsx board/src/views/Results.tsx
git commit -m "feat(board): OutputScorePanel chips in the bundle banner, shared chip ramp"
```

---

### Task 5: compact profile in Tracker and Archive rows

**Files:**
- Modify: `board/src/views/Tracker.tsx` (results cell, lines 539-553), `board/src/views/Archive.tsx` (results cell, lines 211-219)
- Test: extend `board/src/views/Tracker.state.test.tsx` (it already has a typed manifest-bearing result bundle, `Tracker.state.test.tsx:14`); create `board/src/views/Archive.score.test.tsx` — the only existing Archive test (`Archive.outline.test.tsx`) has an empty `executionPlans` array and no plan-linked component, so it has no bundle to extend; the new file copies its harness but builds a master-plan row whose `planLink` resolves to an execution group carrying one bundle with a manifest

**Interfaces:**
- Consumes: `coerceOutputScore` (Task 3); `latestResult.manifest?.score` / `latest.manifest?.score`.
- Produces: visible profile text `F3·A2·I3` beside the Tracker state mark and beside the Archive `rN` link. Nothing downstream consumes it.

- [ ] **Step 1: Write the failing tests**

In `Tracker.state.test.tsx`, extend its fixture bundle's manifest with a valid `score` block (copy the `good` shape from Task 4's test) and assert the rendered row contains `F3·A2·I3`; add a malformed-score fixture (e.g. `{ max: 15 }`) asserting the profile text is absent. In the new `Archive.score.test.tsx`, build the linked-group fixture described under Files and make the same two assertions. Follow the existing render idiom in each source file.

- [ ] **Step 2: Run to verify failure**

Run: `cd <worktree>/board && ./node_modules/.bin/vitest run <tracker test file> <archive test file> 2>&1 | tail -5`
Expected: FAIL on the new assertions

- [ ] **Step 3: Implement**

`Tracker.tsx` — replace the results-cell IIFE body (lines 540-552) with:

```tsx
                    {(() => {
                      if (!latestResult)
                        return <span className="text-xs text-stone-400 dark:text-stone-500">—</span>;
                      const mark = bundleStateMark(latestResult).trim();
                      const sc = latestResult.manifest?.score
                        ? coerceOutputScore(latestResult.manifest.score)
                        : null;
                      return (
                        <span className="inline-flex items-center gap-1.5">
                          <button
                            className="text-xs font-medium text-blue-700 dark:text-blue-400 underline hover:text-blue-900 dark:hover:text-blue-300"
                            onClick={() => onOpenResults(slug!)}
                          >
                            r{latestResult.resultsVersion} {mark}
                          </button>
                          {sc && (
                            <span
                              className="text-[11px] text-stone-500 tabular-nums"
                              title={`output score ${sc.total ?? "–"}/${sc.max}`}
                            >
                              {sc.profile}
                            </span>
                          )}
                        </span>
                      );
                    })()}
```

`Archive.tsx` — inside the `slug && latest` span (lines 213-219), after the `r{latest.resultsVersion}` button, add:

```tsx
                            {(() => {
                              const sc = latest.manifest?.score
                                ? coerceOutputScore(latest.manifest.score)
                                : null;
                              return sc ? (
                                <span
                                  className="text-[11px] text-stone-500 tabular-nums"
                                  title={`output score ${sc.total ?? "–"}/${sc.max}`}
                                >
                                  {sc.profile}
                                </span>
                              ) : null;
                            })()}
```

Add `import { coerceOutputScore } from "../lib/outputScore";` to both files.

- [ ] **Step 4: Run full board suite**

Run: `cd <worktree>/board && ./node_modules/.bin/vitest run 2>&1 | tail -5`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add board/src/views/Tracker.tsx board/src/views/Archive.tsx board/src/views/Tracker.state.test.tsx board/src/views/Archive.score.test.tsx
git commit -m "feat(board): compact F·A·I profile in Tracker and Archive rows"
```

---

### Task 6: the rename — labels, in-UI prose, docs

**Files:**
- Modify: `board/src/App.tsx:57-66`, `board/src/views/Tracker.tsx:415`, `board/src/views/Archive.tsx:155`, `board/src/views/Timeline.tsx:32`, `board/src/lib/filesTree.ts:80`, `board/src/views/Reports.tsx:305`
- Modify: `docs/reference.md` (lines 8, 41, 53, 69, 75), `README.md:45`, `commands/results.md` ("Result tab" at line 21), `commands/report.md` ("Result tab" at line 11), `commands/board.md` (any board-surface "Results/Result tab/view" prose; backticked `results` tokens stay)
- Test: create `board/src/App.tabs.test.ts`; extend `board/src/views/Tracker.state.test.tsx` and `board/src/views/Archive.score.test.tsx` (from Task 5) with an `Output` column-header assertion each

**Interfaces:**
- Consumes: nothing.
- Produces: `TABS` becomes a named export of `App.tsx` (`export const TABS`), pinned by the new test. IDs/tokens unchanged everywhere (Global Constraints).

- [ ] **Step 1: Write the failing test**

`board/src/App.tabs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TABS } from "./App";

describe("tab labels", () => {
  it("results tab is labeled Output & Validation with a stable id", () => {
    const t = TABS.find((t) => t.id === "results");
    expect(t?.label).toBe("Output & Validation");
  });
});
```

(If importing `./App` outside jsdom fails on DOM globals, add the same env pragma/setup the other `App.*.test.tsx` files use.)

- [ ] **Step 2: Run to verify failure**

Run: `cd <worktree>/board && ./node_modules/.bin/vitest run src/App.tabs.test.ts 2>&1 | tail -5`
Expected: FAIL (`TABS` not exported / label mismatch)

- [ ] **Step 3: Implement the label changes**

- `App.tsx:59` — `const TABS` → `export const TABS`; line 62 → `{ id: "results", label: "Output & Validation" },`
- `Tracker.tsx:415` — `<th className="px-4 py-2">Results</th>` → `<th className="px-4 py-2">Output</th>`
- `Archive.tsx:155` — same header change → `Output`
- `Timeline.tsx:32` — `result: { dot: "bg-emerald-500", label: "Results" },` → `label: "Output"` (the filter at line 133 renders `label + "s"` → "Outputs", consistent with "Decisions"/"Reviews" and fixing today's "Resultss")
- `filesTree.ts:80` — `label: "Results",` → `label: "Output",`
- `Reports.tsx:305` — in the sentence `…validation are on the Results tab; there is nothing to narrate…` replace `Results tab` → `Output & Validation tab`
- `commands/results.md:21` and `commands/report.md:11` — both say `Result tab` (singular!) → `Output & Validation tab`
- Sweep for leftovers: `cd <worktree> && rg -n "Results? tab|Results? view|Results? section" board/src commands docs/reference.md README.md` — update any user-facing hit that refers to the board surface (backticked `results` tokens and code identifiers stay). Note the singular `Result` form in the pattern — the two known hits above use it.
- Header pins: in `Tracker.state.test.tsx` and `Archive.score.test.tsx`, assert the rendered table contains an `Output` column header (and no `Results` header).

Docs:
- `docs/reference.md:8` — `- [Results](#results)` → `- [Output & Validation](#output--validation)`
- `docs/reference.md:41` — `**Results** — the reviewing surface (see [Results](#results) below): validation first, …` → `**Output & Validation** — the reviewing surface (see [Output & Validation](#output--validation) below): the F·A·I output score, validation first, …` (keep the rest of the sentence)
- `docs/reference.md:53` — `Tracker, Plan, and Results views` → `Tracker, Plan, and Output & Validation views`
- `docs/reference.md:69` — `## Results` → `## Output & Validation`
- `docs/reference.md:75` — `On the board's Results view you review a bundle — its validation audit, integrity check, stat tiles, …` → `On the board's Output & Validation view you review a bundle — its mechanical F·A·I output score (fidelity · attainment · integrity, 0–3 each, derived at finalize from the validation verdicts and integrity checks; diagnostic, never a gate), its validation audit, integrity check, stat tiles, …` (keep the rest)
- `README.md:45` — image alt `The Results view showing…` → `The Output & Validation view showing…`

- [ ] **Step 4: Run the full board suite — fix any label assertions that pinned the old strings**

Run: `cd <worktree>/board && ./node_modules/.bin/vitest run 2>&1 | tail -8`
Expected: PASS after updating any failing label assertions (`filesTree`/`Sidebar` tests may pin the "Results" group label — update the expected string, nothing else).

- [ ] **Step 5: Commit**

```bash
git add board/src/App.tsx board/src/App.tabs.test.ts board/src/views/Tracker.tsx board/src/views/Archive.tsx board/src/views/Timeline.tsx board/src/lib/filesTree.ts board/src/views/Reports.tsx board/src/views/Tracker.state.test.tsx board/src/views/Archive.score.test.tsx docs/reference.md README.md commands/results.md commands/report.md commands/board.md <any other updated test files>
git commit -m "feat(board): rename Results tab to Output & Validation (labels only, ids stable)"
```

---

### Task 7: reviewer template upgrades (three rp-* templates)

**Files:**
- Modify: `skills/managing-research-plans/templates/agents/rp-board-reviewer.md` (body rewrite), `rp-plan-reviewer.md` (two rules added), `rp-results-validator.md` (two rules added)
- Test: `tests/test_models.py` (one new pin test)

**Interfaces:**
- Consumes: nothing.
- Produces: upgraded template bodies; frontmatter (`name`/`model: {{MODEL}}`/`effort: {{EFFORT}}`/`tools`) and the generation marker line stay byte-identical; every JSON output contract stays byte-identical. Task 8's drift detection makes these reach existing projects.

- [ ] **Step 1: Write the failing pin test**

Append to `tests/test_models.py` (reuse its existing path constants for the templates dir; add one if none exists):

```python
class TestReviewDiscipline(unittest.TestCase):
    def test_templates_carry_review_discipline(self):
        tdir = SCRIPTS.parent / "templates" / "agents"
        board = (tdir / "rp-board-reviewer.md").read_text(encoding="utf-8")
        for marker in ("[blocker]", "[major]", "[minor]",
                       "Ground every claim", "Verify before returning"):
            self.assertIn(marker, board)
        for name in ("rp-plan-reviewer.md", "rp-results-validator.md"):
            text = (tdir / name).read_text(encoding="utf-8")
            self.assertIn("Verify before returning", text)
```

(`SCRIPTS` — mirror however `tests/test_models.py` already locates the scripts dir; it imports `models`, so a constant exists.)

- [ ] **Step 2: Run to verify failure**

Run: `cd <worktree> && python3 -m unittest tests.test_models.TestReviewDiscipline -v 2>&1 | tail -3`
Expected: FAIL (markers absent)

- [ ] **Step 3: Rewrite `rp-board-reviewer.md`**

Keep frontmatter lines 1-7 and the marker line 8 byte-identical. Replace the body (everything after the marker line) with:

```markdown
You review ONE target document for the research-plans board. The dispatching command gives you: the target's full content, its on-disk path(s) and the repository root, the scope's review guidance, and — when you are one seat of the three-lens panel — the single lens to apply (correctness, methodological rigor, or feasibility). Apply only your assigned lens when one is given. Review only; never modify anything.

**Return only material comments — at most 5.** A comment earns its place only if acting on it would materially improve the work; a curated few beats a long list. Exclude style, wording, formatting, and "consider adding" polish. If nothing material stands out, return fewer comments (or none) — do not pad to reach five.

What counts as material depends on the scope:
- **A plan** — the comment names a place the plan lets the agent improvise outside the human's awareness, mapped to a rubric channel: a consequential decision left to a default or resting on a shallow/goal-disconnected reason (Decisions), an implicit success criterion (Goal & success), a step too vague to check (Steps), a missing test of goal-accomplishment (Validation), or an unbounded scope (Boundaries). Name the channel in the comment.
- **The master plan** — the decomposition is unsound, a component is not independently completable, the sequencing is wrong, or a research question is not answerable as posed.
- **A results bundle** — the numbers or artifacts do not support a stated finding, an internal inconsistency, or a load-bearing check that is missing.

**Ground every claim.** When the target cites files, artifacts, numbers, or scripts, read the actual repository evidence with your tools before asserting a problem — a comment about a table must have looked at the artifact behind it; use the provided paths. State the evidence inside the comment ("Table 2 in artifacts/t2.png shows N=1,204, but the text claims 1,402"). Label inference explicitly as inference — "likely", "cannot verify from the bundle" — never assert what you have not checked. Do not invent problems the evidence does not support.

**Dig deeper before finalizing.** Hunt the second-order failures a surface read misses, per scope — a results bundle: silent N drops between steps, join/merge errors, construction or train/test leakage, artifacts stale relative to their scripts, totals inconsistent across tables; a plan: second-order failure modes of the chosen design, empty states and edge cases, steps whose failure would be silent; the master plan: sequencing dependencies and components whose outputs later components silently assume.

**Severity.** Begin each comment with exactly one tag: `[blocker]` (invalidates a finding or decision — must be resolved before acting on the work), `[major]` (materially changes the work if acted on), or `[minor]` (worth fixing, not blocking). Order comments most severe first.

**Verify before returning.** Re-check each comment: is it material (acting on it changes the work), actionable, and grounded in evidence you actually examined? Drop what fails — fewer well-grounded comments beat five padded ones.

Comment rules:
- "section" is the exact heading text the comment belongs under, or "" for a document-wide point.
- "quote" is a short verbatim span from the target with markdown stripped — no **, backticks, or []() — so it matches the RENDERED text a reader sees.
- "comment" is the substance: specific and actionable, one point per comment, severity tag first.

Your final message is consumed by the dispatching session, not read by a person. Return ONLY one JSON object, no prose around it:

{"overall": "<your top-level judgment in 2-4 sentences>", "comments": [{"section": "<exact heading or empty>", "quote": "<verbatim span — markdown stripped, no **, backticks, or []()>", "comment": "<the point>"}]}
```

- [ ] **Step 4: Add the two rules to the other templates**

`rp-plan-reviewer.md` — append to its `Rules:` list (after the draft-targets rule, line 18):

```markdown
- **Ground the evidence.** Every quoted evidence span must come from text you actually read in the plan file; never reconstruct from memory. Bash output is the only source for the integrity flags — label anything beyond it as inference.
- **Verify before returning.** Re-check each channel score against its quoted evidence and the rubric's anchors, and each suggested move for actionability; fix or drop what fails. Then emit the JSON.
```

`rp-results-validator.md` — insert before the "Never pick an overall status" line:

```markdown
- **Ground every verdict.** Each evidence line must cite a file, output, log line, or commit you actually inspected with your tools, or that appears in the pasted git window — take that window as given and never speculate beyond it. When the evidence cannot support a verdict, use "unverifiable" rather than guessing.
- **Verify before returning.** Re-check that every Build step and every success criterion got exactly one verdict and each verdict's evidence actually supports it. Then emit the JSON.
```

(The validator's body is prose paragraphs, not a bulleted rules list — if inserting bullets reads badly, add them as a two-bullet list under a `Rules:` line; content verbatim.)

- [ ] **Step 5: Run tests**

Run: `cd <worktree> && python3 -m unittest tests.test_models -v 2>&1 | tail -3`
Expected: OK (generation tests still pass — frontmatter/marker untouched)

- [ ] **Step 6: Commit**

```bash
git add skills/managing-research-plans/templates/agents/rp-board-reviewer.md skills/managing-research-plans/templates/agents/rp-plan-reviewer.md skills/managing-research-plans/templates/agents/rp-results-validator.md tests/test_models.py
git commit -m "feat(agents): codex-style review discipline — grounding, dig-deeper, severity, verification loop"
```

---

### Task 8: `cmd_check` template-drift detection + generic hint

**Files:**
- Modify: `skills/managing-research-plans/scripts/models.py` (`MISMATCH_HINT` ~line 55, `cmd_check` lines 436-456)
- Test: `tests/test_models.py`

**Interfaces:**
- Consumes: `parse_profile`, `_templates_dir`, `_render`, `_strip_marker`, `AGENT_STAGES`, `MARKER_RE` — all existing.
- Produces: `cmd_check` prints the (reworded) hint when a marked agent's body drifts from the currently shipped template, mirroring `generate`'s row resolution; still exits 0 always.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_models.py` (adapt helper names to the file's idiom; it imports `models` and has profile fixtures):

```python
class TestCheckTemplateDrift(unittest.TestCase):
    def _project(self, td):
        root = Path(td)
        (root / "plans").mkdir()
        (root / "plans" / "master-plan.md").write_text(
            "<!-- research-plans:master-plan -->\n", encoding="utf-8")
        (root / "plans" / "model-profile.md").write_text(
            DEFAULT_PROFILE, encoding="utf-8")
        models.generate(root)
        return root

    def _check_stdout(self, root):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            models.cmd_check(root)
        return out.getvalue()

    def test_freshly_generated_agents_are_silent(self):
        with tempfile.TemporaryDirectory() as td:
            self.assertEqual(self._check_stdout(self._project(td)), "")

    def test_template_drift_prints_hint(self):
        with tempfile.TemporaryDirectory() as td:
            root = self._project(td)
            with tempfile.TemporaryDirectory() as tpl:
                src = models._templates_dir()
                for f in src.iterdir():
                    (Path(tpl) / f.name).write_text(
                        f.read_text(encoding="utf-8") + "\nNEW RULE.\n",
                        encoding="utf-8")
                orig = models._templates_dir
                models._templates_dir = lambda: Path(tpl)
                try:
                    self.assertIn("out of date", self._check_stdout(root))
                finally:
                    models._templates_dir = orig

    def test_profile_mismatch_still_hints(self):
        with tempfile.TemporaryDirectory() as td:
            root = self._project(td)
            prof = root / "plans" / "model-profile.md"
            prof.write_text(prof.read_text(encoding="utf-8") + "\n",
                            encoding="utf-8")
            self.assertIn("out of date", self._check_stdout(root))

    def test_row_removed_marked_agent_hints_without_crash(self):
        with tempfile.TemporaryDirectory() as td:
            root = self._project(td)
            prof = root / "plans" / "model-profile.md"
            text = prof.read_text(encoding="utf-8").replace(
                "plan review", "plan review DISABLED")
            prof.write_text(text, encoding="utf-8")
            new_sum = hashlib.sha256(prof.read_bytes()).hexdigest()
            agent = root / ".claude" / "agents" / "rp-plan-reviewer.md"
            agent.write_text(
                re.sub(r"sha256:[0-9a-f]{64}", "sha256:" + new_sum,
                       agent.read_text(encoding="utf-8")),
                encoding="utf-8")
            self.assertIn("out of date", self._check_stdout(root))

    def test_user_owned_agent_stays_silent(self):
        with tempfile.TemporaryDirectory() as td:
            root = self._project(td)
            agent = root / ".claude" / "agents" / "rp-plan-reviewer.md"
            agent.write_text("my own reviewer, no marker\n", encoding="utf-8")
            self.assertEqual(self._check_stdout(root), "")
```

(`plan review` is the profile row's label cell — check the exact label in `templates/model-profile.md` and use a replacement that invalidates the `plan-review` row.) Add `import io, contextlib, hashlib, re` to the test file's imports if absent. Existing tests asserting the old `MISMATCH_HINT` string must be updated to the new wording in Step 3.

- [ ] **Step 2: Run to verify failure**

Run: `cd <worktree> && python3 -m unittest tests.test_models.TestCheckTemplateDrift -v 2>&1 | tail -5`
Expected: `test_template_drift_prints_hint` and `test_row_removed_marked_agent_hints_without_crash` FAIL; the others may pass.

- [ ] **Step 3: Implement**

`MISMATCH_HINT` (models.py:55) becomes:

```python
MISMATCH_HINT = (
    "review agents are out of date with the installed plugin or profile — "
    "run /research-plans:models and regenerate"
)
```

Replace `cmd_check` (lines 436-456) with:

```python
def cmd_check(root):
    path = root / PROFILE_REL
    if not path.exists():
        return 0
    try:
        data = path.read_bytes()
    except OSError:
        return 0
    checksum = hashlib.sha256(data).hexdigest()
    try:
        stages, _ = parse_profile(data.decode("utf-8"))
    except UnicodeDecodeError:
        stages = {}
    for key, agent in AGENT_STAGES.items():
        target = root / ".claude" / "agents" / f"{agent}.md"
        if not target.exists():
            continue
        try:
            text = target.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        m = MARKER_RE.search(text)
        if not m:
            continue  # user-owned — never hint about files we don't manage
        if m.group(1) != checksum:
            print(MISMATCH_HINT)
            return 0
        row = stages.get(key)
        if row is None or row["mechanism"] != "agent":
            # generate() would REMOVE this marked agent — that is drift too.
            # Report it without rendering a template for a nonexistent row.
            print(MISMATCH_HINT)
            return 0
        try:
            template = (_templates_dir() / f"{agent}.md").read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        rendered = _render(template, row["model"], row["effort"], checksum)
        if _strip_marker(text) != _strip_marker(rendered):
            # The shipped template changed since this agent was generated —
            # the profile checksum alone cannot see this.
            print(MISMATCH_HINT)
            return 0
    return 0
```

Update any existing test asserting the old hint string.

- [ ] **Step 4: Run to verify pass**

Run: `cd <worktree> && python3 -m unittest tests.test_models -v 2>&1 | tail -3`
Expected: OK

- [ ] **Step 5: Commit**

```bash
git add skills/managing-research-plans/scripts/models.py tests/test_models.py
git commit -m "feat(models): cmd_check detects template drift, generic regenerate hint"
```

---

### Task 9: board.md step 5 — shared reviewer contract

**Files:**
- Modify: `commands/board.md` (the review-request step; contract sentence ~line 43, dispatch bullets ~lines 44-47)

**Interfaces:**
- Consumes: the severity enum + definitions from Task 7 (identical wording).
- Produces: all four reviewer paths (subagent, panel, codex, gemini) share the severity convention; dispatch prompts carry target paths; gemini gets the pasted-evidence grounding variant.

- [ ] **Step 1: Apply the four edits**

1. Contract sentence — after `…quotes short and copy-paste so they match the RENDERED text of the target.` insert:

```
Every comment's text begins with exactly one severity tag — `[blocker]` (invalidates a finding or decision — must be resolved before acting on the work), `[major]` (materially changes the work if acted on), `[minor]` (worth fixing, not blocking) — and comments are ordered most severe first; validate the tag on every returned comment and repair once (re-prompt) when it is absent or invalid.
```

2. External-reviewer temp-file parenthetical — replace `(fixed instructions + the target's content + the scope's guidance + the contract)` with:

```
(fixed instructions + the target's content + its on-disk path(s) and the repository root + the scope's guidance + the contract; the fixed instructions carry the grounding and verify-before-returning rules — codex grounds claims in the repository read-only, while gemini is instructed to ground claims ONLY in the supplied material and to say so when it cannot support a judgment)
```

3. Subagent/panel dispatch — in the `subagent` bullet and the `panel` bullet, add to the "given the target content + the scope's guidance + contract" phrasing: `+ the target's on-disk path(s) and the repository root` (read the exact bullets at lines 44-47 and splice the phrase where the inputs are enumerated).

4. Panel merge sentence — replace:

```
Collect all three JSON results and merge their `comments`, then **rank by materiality and keep the top ~5–7 across the whole panel** — drop true duplicates (same anchor AND substantively the same point) and the least material overflow; two lenses flagging one span for *different* reasons may both survive if both are material.
```

with:

```
Collect all three JSON results and merge their `comments`: deduplicate first (same anchor AND substantively the same point — keep the copy with the highest justified severity), then **rank `[blocker]` > `[major]` > `[minor]`, by materiality within a tier, and keep the top ~5–7 across the whole panel** (each seat's own cap stays 5); two lenses flagging one span for *different* reasons may both survive if both are material.
```

- [ ] **Step 2: Verify no contract-shape drift and no test breakage**

Run: `cd <worktree> && rg -n '"overall"' commands/board.md` — the JSON shape line must be unchanged.
Run: `cd <worktree> && python3 -m unittest discover -s tests -v 2>&1 | tail -3`
Expected: OK

- [ ] **Step 3: Commit**

```bash
git add commands/board.md
git commit -m "feat(board.md): shared reviewer severity contract, per-reviewer grounding access, target paths"
```

---

### Task 10: CLAUDE.md rules 9-10 + init.md gitignore/marker hardening

**Files:**
- Modify: `skills/managing-research-plans/templates/claude-md-section.md` (after rule 8, line 16), `commands/init.md` (update-mode list line 14, step 5 line 29, step 6 lines 31-35)
- Test: `tests/` — run the full py suite; update any template-contract test that pins the rule list

**Interfaces:**
- Consumes: nothing.
- Produces: rules 9-10 in every newly initialized/upgraded project; `logs/` in root `.gitignore` on both init paths; marker-validation stop-and-ask rule. Task 11's doctrine references rule 9 by number.

- [ ] **Step 1: claude-md-section.md — append after rule 8**

```markdown
9. Evidence before claims. Run substantive analysis with output captured to `logs/` (e.g. `2>&1 | tee logs/<date>_<step>.log`; `logs/` stays gitignored). Never report a result — in chat, a results bundle, or a report — without the log, notebook output, or artifact that shows the code actually ran. Logs are local, temporary evidence: never write row-level personal data, credentials, or secrets into them.
10. Assumptions and restraint. State working assumptions before acting on them; when an instruction has multiple readings, present them rather than picking silently. Keep changes minimal and surgical — nothing beyond what the current plan step needs.
```

- [ ] **Step 2: init.md — three edits**

1. Step 5, add a bullet after the `plans/execution/.gitkeep` bullet:

```markdown
   - Root `.gitignore` — ensure it contains a `logs/` line (create the file if missing, append the line if absent; never rewrite existing content). Rule 9's evidence logs must never be committable.
```

2. Update-mode list (line 14): after offer (e) insert `(f) ensure the root .gitignore carries the logs/ line — an accepted offer performs the step-5 append operation immediately, before this mode's "skip steps 3–5" takes effect (rule 9's evidence discipline reaches existing projects only with it), and` — then re-letter the existing renew hand-off offer to (g). (Read the sentence and keep its grammar intact; the point is that update mode executes the append itself, never deferring to a skipped step.)

3. Step 6, add a final bullet:

```markdown
   - **Malformed markers:** if the file has a start marker without its end marker, an end marker without a start, markers in reverse order, or more than one marker pair, stop and show the researcher what was found — never guess a replacement range over unrelated CLAUDE.md content.
```

- [ ] **Step 3: Run the py suite; update any pinned template-contract expectations**

Run: `cd <worktree> && python3 -m unittest discover -s tests -v 2>&1 | tail -3`
Expected: OK (fix expected-string updates only if a test pins the section's content).

- [ ] **Step 4: Commit**

```bash
git add skills/managing-research-plans/templates/claude-md-section.md commands/init.md <any updated test file>
git commit -m "feat(init): evidence + assumptions rules in CLAUDE.md section, logs/ gitignore on both paths, marker validation"
```

---

### Task 11: planning doctrine + plan.md grounding + execution-loop line + SKILL.md + companions note

**Files:**
- Create: `skills/managing-research-plans/references/planning-doctrine.md`
- Modify: `commands/plan.md` (intro line 7, step 3, step 4 first bullet), `skills/managing-research-plans/references/execution-loop.md` (During execution, line 17), `skills/managing-research-plans/SKILL.md` (results-bundle paragraph ~line 42, references list ~line 94), `README.md`, `docs/reference.md` (companions note)

**Interfaces:**
- Consumes: rule-9 numbering from Task 10.
- Produces: the doctrine file `/plan` loads; nothing downstream consumes signatures.

- [ ] **Step 1: Create `references/planning-doctrine.md`**

```markdown
# Planning doctrine — how an execution plan gets authored

Referenced by `/research-plans:plan` (steps 3–5). The rubric (`plan-rubric.md`) grades the artifact; this file governs the authoring, so a plan authored here works as well standalone as one authored inside a heavyweight personal setup.

## Research first — plan from the repo's reality, not from memory of it

Before any authoring dialogue, run a short read-only grounding pass: repo structure, data presence and rough shape, prior components' outputs, existing scripts touching this component's area. Bound it: roughly a dozen files and a few read-only commands (`ls`, `head`, `git log`, quick greps) — minutes, not tens of minutes. "Read-only" permits writing a gitignored evidence log when the deeper data exploration (`explore-before-planning.md`) warrants one. Say what was found in two or three sentences before the first question. The researcher can decline with "skip exploration".

## Surface assumptions — a default is a claim about the world

Every proposed default rests on an assumption. When presenting options for a consequential fork, name what the default assumes ("listwise deletion assumes missingness is ignorable here"). When the researcher waves a high-stakes choice through, say what the default assumes and ask whether it holds. When an instruction has multiple readings, present them — never pick silently.

## Evidence discipline — write success criteria that capture can test

At capture time the bundle's validation audits the plan's success criteria against artifacts, and the sealed F·A·I score derives from those verdicts. So criteria must be checkable against evidence that will exist: named outputs, thresholds, tests a third party could run. A criterion validation cannot test is a criterion the plan does not really have (rubric channel 4 scores this). The Verification section is the bridge: it says what artifact or check will show each criterion was met, and CLAUDE.md rule 9's `logs/` capture is where run evidence lands along the way.

## Simplicity and surgical scope

Plan the minimum that answers the research question — no analyses, robustness sweeps, or infrastructure beyond what the goal needs (add them when the data pushes back, by revision). Boundaries name both what is out of scope and what not to touch; execution stays inside them, and the tail's deviation stop catches drift.

## The revision loop — the review room is the approval dialog

Authoring ends in the review room: the draft is scored, the researcher annotates, and Approve or Request changes closes the pass. "Keep planning" is Request changes — revise the draft and return; several passes are normal. A signed plan changes only by a new version with a `Supersedes` line; the sign-off gate enforces it.

## Compatibility with other skills

General process skills active in a researcher's setup (brainstorming, test-driven development, worktree discipline) are welcome for the work itself. The plan documents, their locations, their versioning, and their approval flow always follow THIS plugin's template and rubric contract — external planning skills' artifacts (checkbox task plans, other save locations, separate approval flows) are not substitutes for `plans/execution/<NN-slug>/vN.md` and the review room.
```

- [ ] **Step 2: plan.md — three edits**

1. Intro (line 7), after the skill-context sentence, add: `Load ${CLAUDE_PLUGIN_ROOT}/skills/managing-research-plans/references/planning-doctrine.md now — it is the authoring standard steps 3–5 follow.`

2. Replace step 3 entirely:

```markdown
3. **Ground before authoring (read-only, default).** Follow the doctrine's research-first pass: repo structure, data presence and rough shape, prior components' outputs, existing scripts in this component's area — bounded (roughly a dozen files, a few read-only commands), findings summarized in 2–3 sentences before the first question. The researcher can decline with "skip exploration". If the component is data-facing and the data has not been explored, offer the deeper pass per `${CLAUDE_PLUGIN_ROOT}/skills/managing-research-plans/references/explore-before-planning.md`. Findings feed the Scope decisions table; surprises go to the decision log.
```

3. Step 4 first bullet: `- present the live options with trade-offs,` → `- present the live options with trade-offs and the assumption each default rests on,`

- [ ] **Step 3: execution-loop.md — During execution (line 17), append to the paragraph:**

```
Capture the output of substantive analysis commands to `logs/` (`2>&1 | tee logs/<date>_<step>.log`, gitignored) — rule 9's run evidence; local and temporary, never row-level personal data, credentials, or secrets.
```

- [ ] **Step 4: SKILL.md — two edits**

1. Results-bundle paragraph (~line 42): after the validation-block parenthetical closes (`…advisory, never a gate)`), insert `, a sealed mechanical `score` block (F·A·I — fidelity · attainment · integrity, 0–3 each, derived at finalize from the validation verdicts and integrity checks; diagnostic, never a gate)`.
2. References list (~line 94): `…`explore-before-planning.md` (bounded data exploration before authoring).` → `…`explore-before-planning.md` (bounded data exploration before authoring), `planning-doctrine.md` (the authoring standard behind `/plan`).`

- [ ] **Step 5: Companions note (README.md + docs/reference.md)**

Add to `README.md` at the end of the main body (before any closing/license section), and to `docs/reference.md` as a short closing section:

```markdown
**Works well with.** The workflow is self-contained, but pairs well with general process plugins — e.g. superpowers (TDD and worktree discipline for code-heavy components) or plannotator (in-browser plan annotation). Optional: nothing here depends on them, and plan documents always follow this plugin's own template and review flow.
```

- [ ] **Step 6: Verify + commit**

Run: `cd <worktree> && python3 -m unittest discover -s tests -v 2>&1 | tail -3`
Expected: OK

```bash
git add skills/managing-research-plans/references/planning-doctrine.md commands/plan.md skills/managing-research-plans/references/execution-loop.md skills/managing-research-plans/SKILL.md README.md docs/reference.md
git commit -m "feat(plan): planning doctrine — default grounding pass, assumptions, evidence discipline, companions note"
```

---

### Task 12: CHANGELOG, template rebuild, full verification

**Files:**
- Modify: `CHANGELOG.md` (create-or-merge `## [Unreleased]` at the top, below the header)
- Regenerate: `skills/managing-research-plans/assets/board-template.html` (via `npm run build` — first and only build in this plan)

**Interfaces:** none — closeout.

- [ ] **Step 1: CHANGELOG entry** (create `## [Unreleased]` if absent; merge if present)

```markdown
## [Unreleased]

### Added
- Mechanical F·A·I output score (fidelity · attainment · integrity, 0–3 each) sealed into every finalized bundle's manifest, displayed as chips in the Output & Validation banner with a derivation popover, and as a compact profile in Tracker/Archive rows. Diagnostic, never a gate.
- `references/planning-doctrine.md` — the authoring standard `/plan` now loads; `/plan` grounds in the repo by default before the dialogue.
- CLAUDE.md rules 9 (evidence before claims — `logs/` capture) and 10 (assumptions and restraint); init ensures `logs/` is gitignored on both fresh and update paths.

### Changed
- The board's Results tab is now **Output & Validation** ("Output" in table columns, the timeline chip, and the sidebar); all internal ids, tokens, and deep links are unchanged.
- The three rp-* reviewer agents carry codex-style discipline: grounding rules, per-scope dig-deeper nudges, a verify-before-returning pass, and `[blocker]`/`[major]`/`[minor]` severity ordering shared by all reviewer paths (subagent, panel, codex, gemini). Existing projects: run `/research-plans:models` and regenerate — `models.py check` now detects template drift and says so.
```

- [ ] **Step 2: Rebuild the shipped template**

Run: `cd <worktree>/board && npm run build`
Expected: build succeeds; `git status` shows `skills/managing-research-plans/assets/board-template.html` modified and nothing else unexpected. Delete `board/tsconfig.tsbuildinfo` if present.

- [ ] **Step 3: Full verification**

Run: `cd <worktree> && python3 -m unittest discover -s tests -v 2>&1 | tail -3` — Expected: OK
Run: `cd <worktree>/board && ./node_modules/.bin/vitest run 2>&1 | tail -5` — Expected: all files pass
Run: `cd <worktree>/board && ./node_modules/.bin/tsc -b && rm -f tsconfig.tsbuildinfo` — Expected: no output (typecheck clean; the cache file must not linger)
Run: `cd <worktree>/board && rg -a "Output & Validation" ../skills/managing-research-plans/assets/board-template.html | head -1` — Expected: at least one hit (the rename shipped into the template)

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md skills/managing-research-plans/assets/board-template.html
git commit -m "chore: changelog + rebuilt board template for the output-validation train"
```

---

## Post-plan (not tasks): BK's live eyeball list

Version fields stay untouched — BK numbers the release. Live checks that only a real session shows: the Output & Validation tab label and chips on a real project's board; a full `/execute` run sealing a score; a board review request returning severity-tagged comments; `/plan`'s grounding pass feel; `models.py check` hinting in a pre-upgrade project.
