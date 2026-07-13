# Reports Tab + Lean Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Before Task 1: reset `.superpowers/sdd/progress.md` — it is shared across plans and may hold a previous plan's state.**

**Goal:** Add a Reports tab to the board that renders each bundle's generated report (figures resolved from bundle assets, PDF/DOCX downloads on the local board), slim the Results view to a reviewing surface, make `/research-plans:results` offer report generation at capture end, and keep plan vN ↔ bundle rN ↔ report versioning visible everywhere.

**Architecture:** The report file `plans/reports/<NN-slug>-r<N>-report.md` is attached to its results bundle in the Python-collected payload (`publishedReport` + `reportFormats`), mirrored in the TS `allFiles` hash parity list, rendered by a new `Reports` view through a marker-stripping parser and an assets-resolving image renderer, and commented via the existing doc-comment machinery with a new `"reports"` view value on both sides of the Python↔TS boundary. Spec: `docs/specs/2026-07-10-reports-tab-design.md`. Codex review: `docs/specs/2026-07-10-codex-review-reports-tab.md`.

**Tech Stack:** Python 3 stdlib only (`board.py`), React + TypeScript + vitest + @testing-library/react (jsdom) in `board/`, markdown command files in `commands/`.

## Global Constraints

- Work happens in the worktree `.claude/worktrees/reports-tab` on branch `worktree-reports-tab` (spec already committed there as e567b8b).
- **No version bumps anywhere** — BK numbers at release cut. CHANGELOG entries go under `[Unreleased]`.
- Commit messages: conventional prefixes used in this repo (`fix(board):`, `feat(board):`, `docs:`, `test(board):`). **Never include `Co-Authored-By`.**
- Python test suite: `python3 -m unittest discover -s tests -v` (run from repo root). Board TS suite: `cd board && npm test` (vitest; do NOT pass Jest flags like `--runInBand`).
- `board.py` stays stdlib-only. All prose in `.md` files: one paragraph per line, no hard wrapping.
- Naming: the bundle's capture note stays `report` / `bundle.report`; the generated document is ALWAYS `publishedReport` (Python dict key and TS field). Do not mix them.
- The board template (`skills/managing-research-plans/assets/board-template.html`) is a committed build artifact — Task 13 rebuilds it; React changes are invisible in any board mode until then.
- Payload parity: any file added to Python `payload_files()` MUST be added to TS `allFiles()` in the same task (Tasks 3 and 7 together satisfy this; Task 7 must not land without Task 3's shape).

---

### Task 1: Fix pre-existing hosted `reopen` forgery gap

**Files:**
- Modify: `skills/managing-research-plans/scripts/board.py:1671-1678` (`_neutralized_annotation`)
- Test: `tests/test_board.py`

**Interfaces:**
- Consumes: `ACTION_KEYS = ("signoff", "verdict", "reviewRequest", "reportRequest", "reopen")` (board.py:1582).
- Produces: `_neutralized_annotation` strips every `ACTION_KEYS` member; later tasks (6) extend this same function.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_board.py` (append to the test class that already covers hosted assembly — search for existing `assemble_hosted_document` tests and add alongside; if none exist in a class, add a new class):

```python
class TestNeutralizedAnnotationActionKeys(unittest.TestCase):
    def test_every_action_key_is_stripped(self):
        a = {"type": "doc-comment", "view": "tracker", "docKey": "tracker",
             "quote": "q", "comment": "c",
             "verdict": {"x": 1}, "reviewRequest": {"x": 1},
             "reportRequest": {"x": 1}, "signoff": {"x": 1}, "reopen": {"x": 1}}
        out = board._neutralized_annotation(a)
        for key in board.ACTION_KEYS:
            self.assertNotIn(key, out)

    def test_hosted_document_fence_carries_no_reopen(self):
        a = {"type": "doc-comment", "view": "tracker", "docKey": "tracker",
             "quote": "q", "comment": "c", "reopen": {"component": "01-x", "resultsVersion": 1}}
        doc = board.assemble_hosted_document([a], {"sessionId": "s", "generatedAt": "",
                                                   "focus": None, "reviewer": "r", "shareHash": "h"})
        self.assertNotIn("reopen", doc)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest tests.test_board.TestNeutralizedAnnotationActionKeys -v`
Expected: FAIL — `reopen` survives (`AssertionError: 'reopen' unexpectedly found`).

- [ ] **Step 3: Fix the strip loop**

In `_neutralized_annotation` (board.py:1674-1678), replace:

```python
    a = dict(a)
    # signoff is a researcher-only action key from the board control surface
    # (v0.15 spec); stripped preemptively so hosted pulls can never forward it.
    for _k in ("verdict", "reviewRequest", "reportRequest", "signoff"):
        a.pop(_k, None)
```

with:

```python
    a = dict(a)
    # Researcher-only action keys can never ride a hosted pull. Iterate the
    # single source of truth — a second hand-maintained tuple is how `reopen`
    # slipped through when the control surface added it.
    for _k in ACTION_KEYS:
        a.pop(_k, None)
```

- [ ] **Step 4: Run tests to verify they pass, then the full Python suite**

Run: `python3 -m unittest tests.test_board.TestNeutralizedAnnotationActionKeys -v` → PASS.
Run: `python3 -m unittest discover -s tests -v` → all pass.

- [ ] **Step 5: Commit**

```bash
git add tests/test_board.py skills/managing-research-plans/scripts/board.py
git commit -m "fix(board): strip ALL action keys (incl. reopen) from hosted annotations"
```

---

### Task 2: Fix pre-existing summary-only notice missing in finding mode

**Files:**
- Modify: `board/src/views/Results.tsx:576-655` (finding-mode branch)
- Test: `board/src/views/Results.summary.test.tsx` (create)

**Interfaces:**
- Consumes: `findingMode` computation (Results.tsx:528-534), the existing "Summary only" notice JSX (Results.tsx:683-697).
- Produces: a local `SummaryOnlyNotice` component in Results.tsx, reused by both branches; Task 11 keeps it in place when reordering.

- [ ] **Step 1: Write the failing test**

Create `board/src/views/Results.summary.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Results from "./Results";
import type { BoardData } from "../lib/types";

afterEach(cleanup);

function summaryOnlyFindingData(): BoardData {
  return {
    schemaVersion: 1, generatedAt: "2026-07-10T00:00", mode: "live",
    focus: null, project: { name: "p" }, git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [{
        component: "01-x",
        versions: [{ version: 1, path: "plans/execution/01-x/v1.md", content: "# v1" }],
        results: [{
          resultsVersion: 1, dir: "plans/execution/01-x/results/r1",
          manifest: {
            schemaVersion: 1, component: "01-x", resultsVersion: 1, planVersion: 1,
            provenance: "planned", trigger: "initial", capturedAt: "2026-07-10 10:00",
            // statement puts the bundle in FINDING mode; zero artifacts = summary-only
            metrics: [{ label: "N", value: "10", statement: "The N is ten." }],
            artifacts: [],
          },
          manifestRaw: { path: "plans/execution/01-x/results/r1/manifest.json", content: "{}" },
          report: null, verdict: null, verdictRaw: null, scripts: [], assets: {},
          publishedReport: null, reportFormats: { pdf: false, docx: false },
        }],
      }],
      reviews: [],
    },
  } as BoardData;
}

const noop = () => {};
describe("summary-only notice", () => {
  it("renders in finding mode when the bundle has zero artifacts", () => {
    render(
      <Results data={summaryOnlyFindingData()} canAnnotate={false} canPost={false}
        selectedComponent="01-x" onSelectComponent={noop} annotations={[]}
        onAddResultComment={noop} onAddScriptComment={noop} onPaintResult={noop}
        onVerdict={noop} focusResults={null} navRequest={null} />,
    );
    expect(screen.getByText("Summary only")).toBeTruthy();
  });
});
```

Note: `publishedReport`/`reportFormats` fields land in Task 7; until then, drop those two lines from the fixture and add them back in Task 7's parity sweep — OR (simpler) run this task AFTER Task 7. **Execution order note: run Tasks 1, 3-6 (Python) first, then 7, then this task, then 8-12.** If executing strictly in order, omit the two fields here and Task 7 adds them.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd board && npx vitest run src/views/Results.summary.test.tsx`
Expected: FAIL — "Summary only" not found (finding mode renders no notice).

- [ ] **Step 3: Extract the notice and render it in both branches**

In `Results.tsx`, above `export default function Results(`, add:

```tsx
function SummaryOnlyNotice() {
  return (
    <div className="mb-4 rounded-lg border border-dashed border-stone-300 dark:border-stone-600 bg-stone-50 dark:bg-stone-800/50 p-5 text-sm text-stone-600 dark:text-stone-400">
      <div className="font-semibold text-stone-700 dark:text-stone-300">Summary only</div>
      <p className="mt-1">
        No figures or tables in this bundle. The report and metrics were
        captured, but the analysis outputs could not be reproduced (common for
        retrospective captures, where outputs were never saved to files). If a
        producing script exists, re-run it and capture again; otherwise run{" "}
        <code>/research-plans:results</code> and name the output file paths
        directly.
      </p>
    </div>
  );
}
```

In the non-finding branch (Results.tsx:683-697), replace the inline notice `<div className="mb-4 rounded-lg border border-dashed ...">…</div>` with `<SummaryOnlyNotice />` (keep the surrounding ternary). In the finding-mode branch, immediately after the `{m.metrics.map((metric) => { ... })}` block closes (after line 634) add:

```tsx
                  {m.artifacts.length === 0 && <SummaryOnlyNotice />}
```

- [ ] **Step 4: Run test to verify it passes, then the full board suite**

Run: `cd board && npx vitest run src/views/Results.summary.test.tsx` → PASS. Then `cd board && npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add board/src/views/Results.tsx board/src/views/Results.summary.test.tsx
git commit -m "fix(board): summary-only notice renders in finding mode too"
```

---

### Task 3: Python — collect `publishedReport` + `reportFormats` into bundles

**Files:**
- Modify: `skills/managing-research-plans/scripts/board.py:234-277` (`collect_results`), `:198-218` (`payload_files`), `:488-495` (`all_paths`)
- Test: `tests/test_board.py`

**Interfaces:**
- Consumes: `read_file(root, rel)` (board.py:193), bundle dict shape from `collect_results`.
- Produces: every bundle dict gains `"publishedReport": {path, content} | None` and `"reportFormats": {"pdf": bool, "docx": bool}`; `payload_files()` includes `publishedReport` when present; a test helper `add_report(root)`. Report file naming contract used repo-wide: `plans/reports/<component>-r<N>-report.<ext>`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_board.py` after `add_archive` (module level):

```python
def add_report(root: Path):
    """A generated report (md + pdf, no docx) for 01-data-prep r1."""
    rep = root / "plans" / "reports"
    rep.mkdir(parents=True, exist_ok=True)
    (rep / "01-data-prep-r1-report.md").write_text(
        '<!-- rp-report {"schemaVersion": 1, "component": "01-data-prep", "bundle": 1, '
        '"plan": 1, "verdict": "accepted", "generated": "2026-07-03T12:00"} -->\n'
        "# Data prep — Report (r1)\n\nFindings body.\n",
        encoding="utf-8",
    )
    (rep / "01-data-prep-r1-report.pdf").write_bytes(b"%PDF-1.4 stub")
    return rep
```

And a new test class:

```python
class TestPublishedReportCollection(unittest.TestCase):
    def _payload(self, root, mode="live"):
        return board.collect_payload(root, mode, None)

    def test_bundle_without_report_has_absent_shape(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); make_project(root)
            p = self._payload(root)
            b = p["files"]["executionPlans"][0]["results"][0]
            self.assertIsNone(b["publishedReport"])
            self.assertEqual(b["reportFormats"], {"pdf": False, "docx": False})

    def test_bundle_with_report_collects_content_and_formats(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); make_project(root); add_report(root)
            p = self._payload(root)
            b = p["files"]["executionPlans"][0]["results"][0]
            self.assertEqual(b["publishedReport"]["path"],
                             "plans/reports/01-data-prep-r1-report.md")
            self.assertIn("Findings body.", b["publishedReport"]["content"])
            self.assertEqual(b["reportFormats"], {"pdf": True, "docx": False})

    def test_payload_files_and_share_hash_cover_the_report(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); make_project(root)
            base = board.share_hash(board.payload_files(self._payload(root, "remote")))
            add_report(root)
            p2 = self._payload(root, "remote")
            paths = [f["path"] for f in board.payload_files(p2)]
            self.assertIn("plans/reports/01-data-prep-r1-report.md", paths)
            self.assertNotEqual(base, board.share_hash(board.payload_files(p2)))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest tests.test_board.TestPublishedReportCollection -v`
Expected: FAIL — `KeyError: 'publishedReport'`.

- [ ] **Step 3: Implement collection**

In `collect_results` (board.py), after the `sdir` scripts block (line 270-274) and before `bundles.append(bundle)`, add:

```python
        rep_name = "%s-r%d-report" % (comp_dir.name, int(m.group(1)))
        rep_dir = root / "plans" / "reports"
        rep_md = rep_dir / (rep_name + ".md")
        bundle["publishedReport"] = (
            read_file(root, str(rep_md.relative_to(root))) if rep_md.is_file() else None
        )
        bundle["reportFormats"] = {
            "pdf": (rep_dir / (rep_name + ".pdf")).is_file(),
            "docx": (rep_dir / (rep_name + ".docx")).is_file(),
        }
```

Also initialize both keys in the `bundle = {` literal (lines 250-260) so the shape is explicit: add `"publishedReport": None,` and `"reportFormats": {"pdf": False, "docx": False},` after `"assets": {},` — the block above then overwrites them. In `payload_files` (board.py:207-213), after the `report` lines:

```python
            if b.get("publishedReport"):
                out.append(b["publishedReport"])
```

In the `all_paths` block (board.py:488-495), after the manifestRaw line:

```python
        all_paths.extend(b["publishedReport"]["path"] for b in g.get("results", [])
                         if b.get("publishedReport"))
```

- [ ] **Step 4: Run tests, then full Python suite**

Run: `python3 -m unittest tests.test_board.TestPublishedReportCollection -v` → PASS. Then `python3 -m unittest discover -s tests -v` → all pass (if an existing test asserts an exact bundle key set or share hash, update it to include the two new keys — that is the parity net working).

- [ ] **Step 5: Commit**

```bash
git add tests/test_board.py skills/managing-research-plans/scripts/board.py
git commit -m "feat(board): collect publishedReport + reportFormats into results bundles"
```

---

### Task 4: Python — three-part focus grammar + `focusView`

**Files:**
- Modify: `skills/managing-research-plans/scripts/board.py:333-339` (`split_focus`), `:1084-1092` (`render_static_html`), `:1364-1367` (`share`), `:2048-2050` (live main branch)
- Test: `tests/test_board.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `split_focus(focus) -> (slug, resultsVersion, view)` where `view ∈ {None, "reports"}`; payload key `"focusView": "reports" | None` set alongside `"focusResults"` in all three callers. `meta`/collection `focus` stays the plain slug (unchanged — `collect_payload(root, mode, slug)` already receives only the slug).

- [ ] **Step 1: Write the failing tests**

```python
class TestSplitFocusThreePart(unittest.TestCase):
    def test_two_part_unchanged(self):
        self.assertEqual(board.split_focus("01-x:r2"), ("01-x", 2, None))
        self.assertEqual(board.split_focus("01-x"), ("01-x", None, None))
        self.assertEqual(board.split_focus(None), (None, None, None))

    def test_reports_suffix(self):
        self.assertEqual(board.split_focus("01-x:r2:reports"), ("01-x", 2, "reports"))

    def test_unknown_suffix_is_part_of_the_slug(self):
        # Only ':reports' is a view; anything else keeps today's fallback parse.
        self.assertEqual(board.split_focus("01-x:r2:bogus"), ("01-x:r2:bogus", None, None))

    def test_static_render_carries_focus_view(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); make_project(root)
            html = board.render_static_html(root, "01-data-prep:r1:reports")
            self.assertIn('"focusView": "reports"', html)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest tests.test_board.TestSplitFocusThreePart -v`
Expected: FAIL — `split_focus` returns 2-tuples.

- [ ] **Step 3: Implement**

Replace `split_focus` (board.py:333-339):

```python
def split_focus(focus):
    """--focus slug[:rN][:view] -> (slug, resultsVersion, view).
    view: only "reports" today; None means the default view for the target."""
    if not focus:
        return None, None, None
    m = re.fullmatch(r"(.+):r(\d+):(reports)", focus)
    if m:
        return m.group(1), int(m.group(2)), m.group(3)
    m = re.fullmatch(r"(.+):r(\d+)", focus)
    if m:
        return m.group(1), int(m.group(2)), None
    return focus, None, None
```

Update all three callers identically (`grep -n split_focus` must show exactly these plus the def):

```python
    slug, focus_results, focus_view = split_focus(focus)          # render_static_html; args.focus in share/main
    payload = collect_payload(root, "static", slug)               # mode varies per caller — keep each caller's mode
    payload["focusResults"] = focus_results
    payload["focusView"] = focus_view
```

(`render_static_html` board.py:1088-1090; `share` board.py:1365-1367; live `main` branch board.py:2048-2050 — each keeps its existing `collect_payload` mode argument and only gains the third tuple element plus the `focusView` line.)

- [ ] **Step 4: Run tests, then full Python suite**

Run: `python3 -m unittest tests.test_board.TestSplitFocusThreePart -v` → PASS. Then full suite → pass.

- [ ] **Step 5: Commit**

```bash
git add tests/test_board.py skills/managing-research-plans/scripts/board.py
git commit -m "feat(board): three-part --focus grammar (slug:rN:reports) + focusView payload"
```

---

### Task 5: Python — live `/report/` download routes

**Files:**
- Modify: `skills/managing-research-plans/scripts/board.py` (`report_map` new function next to `artifact_map` :320-330; `serve` where `amap = artifact_map(...)` is built; `do_GET` :841-854)
- Test: `tests/test_board.py`

**Interfaces:**
- Consumes: `iter_bundles(payload)` (board.py:286), `reportFormats` from Task 3.
- Produces: `report_map(root, payload) -> {"/report/<component>/r<N>.<ext>": Path}`; `do_GET` serves those routes with `Content-Disposition: attachment`. Non-live modes never build routes (the client gates on `data.mode`).

- [ ] **Step 1: Write the failing tests**

```python
class TestReportDownloadRoutes(unittest.TestCase):
    def test_report_map_routes_only_existing_formats(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); make_project(root); add_report(root)
            payload = board.collect_payload(root, "live", None)
            rmap = board.report_map(root, payload)
            self.assertIn("/report/01-data-prep/r1.pdf", rmap)
            self.assertNotIn("/report/01-data-prep/r1.docx", rmap)
            self.assertTrue(rmap["/report/01-data-prep/r1.pdf"].is_file())

    def test_report_map_empty_without_reports(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); make_project(root)
            payload = board.collect_payload(root, "live", None)
            self.assertEqual(board.report_map(root, payload), {})
```

For the served route, extend the existing live-server test pattern (search `test_board.py` for the test that starts `serve` in a thread and GETs `/artifact/...`; add alongside, reusing its port/server helper):

```python
    # inside the existing live-server test class, mirroring its /artifact/ test:
    def test_report_route_serves_pdf_as_attachment(self):
        # same server-boot boilerplate as the /artifact/ test in this class,
        # with add_report(root) called after make_project(root)
        req = urllib.request.Request(f"http://127.0.0.1:{port}/report/01-data-prep/r1.pdf")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            self.assertIn("attachment", resp.headers.get("Content-Disposition", ""))
            self.assertEqual(resp.read(), b"%PDF-1.4 stub")
        bad = urllib.request.Request(f"http://127.0.0.1:{port}/report/01-data-prep/r9.pdf")
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(bad)
        self.assertEqual(cm.exception.code, 404)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest tests.test_board.TestReportDownloadRoutes -v`
Expected: FAIL — `AttributeError: module 'board' has no attribute 'report_map'`.

- [ ] **Step 3: Implement**

After `artifact_map` (board.py:330), add:

```python
def report_map(root, payload):
    """Route path -> absolute file path for report PDF/DOCX downloads.
    Same exact-key contract as artifact_map: built ONLY from files on disk,
    looked up by exact key — no filesystem joins with client input."""
    rmap = {}
    for component, b in iter_bundles(payload):
        fmts = b.get("reportFormats") or {}
        for ext in ("pdf", "docx"):
            if not fmts.get(ext):
                continue
            p = (root / "plans" / "reports"
                 / ("%s-r%d-report.%s" % (component, b["resultsVersion"], ext)))
            if p.is_file():
                rmap["/report/%s/r%d.%s" % (component, b["resultsVersion"], ext)] = p
    return rmap
```

In `serve`, next to the line `amap = artifact_map(root, payload)` (grep for it), add `rmap = report_map(root, payload)`. In `do_GET`, after the `/artifact/` branch (board.py:841-854), add:

```python
            if self.path.startswith("/report/"):
                f = rmap.get(self.path)
                if f is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                data = f.read_bytes()
                mime = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Disposition",
                                 'attachment; filename="%s"' % f.name)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
```

- [ ] **Step 4: Run tests, then full Python suite** → PASS / all pass.

- [ ] **Step 5: Commit**

```bash
git add tests/test_board.py skills/managing-research-plans/scripts/board.py
git commit -m "feat(board): live /report/ download routes with Content-Disposition"
```

---

### Task 6: Python — FNV-1a port, docHash preservation, pull staleness tags, `_VIEW_LABEL`

**Files:**
- Modify: `skills/managing-research-plans/scripts/board.py` (`_VIEW_LABEL` :1662-1663; `_neutralized_annotation` :1671-1701; `assemble_hosted_document` :1704-1781; `pull` :1257-1261; new helpers near `share_hash`)
- Test: `tests/test_board.py`

**Interfaces:**
- Consumes: Task 1's ACTION_KEYS strip; the client's `hashContent` algorithm (FNV-1a over UTF-16 code units, `board/src/lib/hostedComments.ts:17-21`).
- Produces: `fnv1a_hex(s) -> str` (8 hex chars, exact `hashContent` port); `_strip_report_marker(content) -> str`; `_doc_stale(root, a) -> True|False|None`; `assemble_hosted_document(annotations, meta, root=None)` renders a per-comment staleness warning; `pull` passes `docHash` through and passes `root`. `_VIEW_LABEL` gains `"reports": "Reports"`. **Cross-language hash fixtures** shared with Task 7's TS test: `fnv1a_hex("plan body\n") == "8f0c73ed"` must equal the TS `hashContent` of the same string — Task 7 pins the same literal.

- [ ] **Step 1: Write the failing tests**

```python
class TestPullStaleness(unittest.TestCase):
    def test_fnv1a_matches_client_hashcontent(self):
        # Pinned vectors; Task 7 pins the SAME values against the TS hashContent.
        self.assertEqual(board.fnv1a_hex(""), "811c9dc5")
        self.assertEqual(board.fnv1a_hex("a"), "e40c292c")
        v = board.fnv1a_hex("plan body\n")
        self.assertEqual(len(v), 8)
        self.assertEqual(v, board.fnv1a_hex("plan body\n"))  # deterministic
        # non-ASCII goes through UTF-16 code units, not bytes
        self.assertNotEqual(board.fnv1a_hex("café"), board.fnv1a_hex("cafe"))

    def test_strip_report_marker(self):
        c = '<!-- rp-report {"schemaVersion": 1} -->\n# Body\n'
        self.assertEqual(board._strip_report_marker(c), "# Body\n")
        self.assertEqual(board._strip_report_marker("# Body\n"), "# Body\n")

    def test_dochash_survives_neutralization_when_hex(self):
        a = {"type": "plan-comment", "component": "01-x", "version": 1,
             "quote": "q", "comment": "c", "docHash": "deadbeef"}
        self.assertEqual(board._neutralized_annotation(a)["docHash"], "deadbeef")
        a["docHash"] = "<script>"
        self.assertNotIn("docHash", board._neutralized_annotation(a))

    def test_stale_plan_comment_is_tagged(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); make_project(root)
            content = (root / "plans" / "execution" / "01-data-prep" / "v1.md").read_text(encoding="utf-8")
            current = board.fnv1a_hex(content)
            fresh = {"type": "plan-comment", "component": "01-data-prep", "version": 1,
                     "quote": "q", "comment": "fresh", "docHash": current}
            stale = {"type": "plan-comment", "component": "01-data-prep", "version": 1,
                     "quote": "q", "comment": "stale", "docHash": "00000000"}
            doc = board.assemble_hosted_document([fresh, stale], {"sessionId": "s",
                "generatedAt": "", "focus": None, "reviewer": "r", "shareHash": "h"}, root=root)
            self.assertEqual(doc.count("may refer to an older version"), 1)
            self.assertLess(doc.index("fresh"), doc.index("may refer to an older version"))

    def test_stale_report_comment_hashes_body_without_marker(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); make_project(root); add_report(root)
            body = board._strip_report_marker(
                (root / "plans" / "reports" / "01-data-prep-r1-report.md").read_text(encoding="utf-8"))
            a = {"type": "doc-comment", "view": "reports",
                 "docKey": "plans/reports/01-data-prep-r1-report.md",
                 "quote": "q", "comment": "c", "docHash": board.fnv1a_hex(body)}
            doc = board.assemble_hosted_document([a], {"sessionId": "s", "generatedAt": "",
                "focus": None, "reviewer": "r", "shareHash": "h"}, root=root)
            self.assertNotIn("may refer to an older version", doc)
            self.assertIn("Reports", doc)  # _VIEW_LABEL entry

    def test_json_hashed_types_pass_through_untagged(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); make_project(root)
            a = {"type": "result-comment", "component": "01-data-prep", "resultsVersion": 1,
                 "target": {"kind": "report", "quote": "q"}, "comment": "c", "docHash": "12345678"}
            doc = board.assemble_hosted_document([a], {"sessionId": "s", "generatedAt": "",
                "focus": None, "reviewer": "r", "shareHash": "h"}, root=root)
            self.assertNotIn("may refer to an older version", doc)
```

Compute the two pinned vectors before writing them: `python3 -c "..."` is NOT needed — `811c9dc5` is the FNV offset basis (empty string) and `"a"` = 0x811c9dc5 ^ 0x61 = 0x811c9da4, * 0x01000193 mod 2^32 = 0xe40c292c. Verify at implementation time; if `e40c292c` disagrees with the implementation, recompute BOTH here and in Task 7 with `node -e` + `python3 -c` and keep them identical.

- [ ] **Step 2: Run tests to verify they fail** — `AttributeError: fnv1a_hex`.

- [ ] **Step 3: Implement**

Near `share_hash` (after board.py:231), add:

```python
def fnv1a_hex(s):
    """Exact port of the client's hashContent (hostedComments.ts): FNV-1a over
    UTF-16 code units. Do not change one side without the other — the pinned
    cross-language vectors live in tests/test_board.py and hostedComments.test.ts."""
    h = 0x811C9DC5
    b = s.encode("utf-16-le")
    for i in range(0, len(b), 2):
        h ^= b[i] | (b[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return format(h, "08x")


REPORT_MARKER_PREFIX = "<!-- rp-report"


def _strip_report_marker(content):
    """Drop the first line when it is (or tries to be) an rp-report marker."""
    first, sep, rest = content.partition("\n")
    if first.lstrip().startswith(REPORT_MARKER_PREFIX):
        return rest
    return content
```

In `_neutralized_annotation`, after the ACTION_KEYS pop loop, add:

```python
    dh = a.get("docHash")
    if dh is not None and not (isinstance(dh, str) and re.fullmatch(r"[0-9a-f]{8}", dh)):
        a.pop("docHash", None)
```

Before `assemble_hosted_document`, add:

```python
_REPORT_DOCKEY_RE = re.compile(r"plans/reports/[A-Za-z0-9._-]+-r\d+-report\.md")


def _doc_stale(root, a):
    """True/False when the comment's docHash is verifiable against a plain file
    on disk; None when not our job (no root, unsupported type, bad fields).
    JSON-serialization-hashed types (result/script comments) are NOT verifiable
    here — JSON.stringify is not byte-portable to Python."""
    dh = a.get("docHash")
    if root is None or not isinstance(dh, str) or not re.fullmatch(r"[0-9a-f]{8}", dh):
        return None
    t = a.get("type")
    if t == "plan-comment":
        comp, ver = a.get("component"), a.get("version")
        if (not isinstance(comp, str) or not re.fullmatch(r"[A-Za-z0-9._-]+", comp)
                or not isinstance(ver, int)):
            return None
        p = root / "plans" / "execution" / comp / ("v%d.md" % ver)
    elif t == "doc-comment" and a.get("view") == "reports":
        key = a.get("docKey")
        if not isinstance(key, str) or not _REPORT_DOCKEY_RE.fullmatch(key):
            return None
        p = root / key
    else:
        return None
    if not p.is_file():
        return True  # target gone — definitely not current
    content = p.read_text(encoding="utf-8", errors="replace")
    if t == "doc-comment":
        content = _strip_report_marker(content)
    return fnv1a_hex(content) != dh
```

Change the signature `def assemble_hosted_document(annotations, meta):` → `def assemble_hosted_document(annotations, meta, root=None):`, and in the annotation loop, after the `for ln in ... comment ... lines.append("> " + ln)` block (board.py:1767-1768) and before `lines.append("")`, add:

```python
        if _doc_stale(root, a):
            lines.append("")
            lines.append("⚠ This comment may refer to an older version of its target document.")
```

Update `_VIEW_LABEL` (board.py:1662-1663):

```python
_VIEW_LABEL = {"tracker": "Tracker", "timeline": "Timeline",
               "reviews": "Reviews", "archive": "Archive", "reports": "Reports"}
```

In `pull` (board.py:1257-1261), change the assembly call to carry docHash and root:

```python
    for (author, client), group in groups.items():
        meta = {"sessionId": client or author, "generatedAt": "",
                "focus": None, "reviewer": author,
                "shareHash": group[-1].get("shareHash")}
        doc = assemble_hosted_document(
            [dict(c["annotation"], docHash=c.get("docHash")) for c in group],
            meta, root=root)
```

- [ ] **Step 4: Run tests, then full Python suite** → PASS / all pass. Fix the pinned `"a"` vector if the implementation disagrees (recompute per Step 1 note).

- [ ] **Step 5: Commit**

```bash
git add tests/test_board.py skills/managing-research-plans/scripts/board.py
git commit -m "feat(board): pull-side per-comment staleness tags (FNV-1a port, docHash preserved)"
```

---

### Task 7: TS — types, `allFiles` parity, `reportMarker` lib

**Files:**
- Modify: `board/src/lib/types.ts` (BoardData :3-39, ResultsBundle :68-78, DocCommentAnnotation :364-378), `board/src/lib/parse.ts:379-417` (`allFiles`), `board/src/lib/feedback.ts:58-63` (`VIEW_LABEL`), `board/src/lib/navTarget.ts` (NavTarget :6-17, doc-comment switch :52-79), `board/src/dev-data.ts` (add the two bundle fields to its bundles so fixtures stay real-shaped)
- Create: `board/src/lib/reportMarker.ts`
- Test: `board/src/lib/reportMarker.test.ts`, extend `board/src/lib/parse.test.ts`, `board/src/lib/hostedComments.test.ts`

**Interfaces:**
- Consumes: Python payload shape from Tasks 3-4.
- Produces (used by Tasks 8-12):

```ts
// types.ts additions
//   BoardData: focusView?: "reports" | null;
//   ResultsBundle: publishedReport: BoardFile | null; reportFormats?: { pdf: boolean; docx: boolean };
//   DocCommentAnnotation.view: "tracker" | "timeline" | "reviews" | "archive" | "reports";
// navTarget.ts: NavTarget.tab gains "reports"; doc-comment view "reports" →
//   { tab: "reports", component, resultsVersion } parsed from docKey.
// reportMarker.ts:
export interface ReportMarker {
  schemaVersion: number;
  component: string;
  bundle: number;
  plan: number | null;
  verdict: "accepted" | "changes-requested" | "pending";
  generated: string;
}
export interface ParsedReport { marker: ReportMarker | null; malformed: boolean; body: string; }
export const MARKER_PREFIX = "<!-- rp-report";
export function parseReport(content: string): ParsedReport;
export function stripMarkerLine(content: string): string;
export const REPORT_DOCKEY_RE: RegExp; // /^plans\/reports\/(.+)-r(\d+)-report\.md$/
```

- [ ] **Step 1: Write the failing tests**

Create `board/src/lib/reportMarker.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseReport, stripMarkerLine } from "./reportMarker";

const MARKER = '<!-- rp-report {"schemaVersion": 1, "component": "01-x", "bundle": 2, "plan": 1, "verdict": "pending", "generated": "2026-07-10T14:30"} -->';

describe("parseReport", () => {
  it("parses a well-formed marker and returns the body without it", () => {
    const r = parseReport(`${MARKER}\n# Title\n\nBody.\n`);
    expect(r.marker).toEqual({ schemaVersion: 1, component: "01-x", bundle: 2,
      plan: 1, verdict: "pending", generated: "2026-07-10T14:30" });
    expect(r.malformed).toBe(false);
    expect(r.body).toBe("# Title\n\nBody.\n");
  });
  it("accepts plan null", () => {
    const r = parseReport('<!-- rp-report {"schemaVersion": 1, "component": "01-x", "bundle": 1, "plan": null, "verdict": "pending", "generated": "t"} -->\nB\n');
    expect(r.marker?.plan).toBeNull();
  });
  it("no marker: body is the whole content, not malformed", () => {
    const r = parseReport("# Title\nBody.\n");
    expect(r.marker).toBeNull();
    expect(r.malformed).toBe(false);
    expect(r.body).toBe("# Title\nBody.\n");
  });
  it("malformed marker (unclosed comment) still yields the full body", () => {
    const r = parseReport('<!-- rp-report {"broken": \n# Title\nBody.\n');
    expect(r.marker).toBeNull();
    expect(r.malformed).toBe(true);
    expect(r.body).toBe("# Title\nBody.\n"); // never a blank page
  });
  it("wrong field types are malformed", () => {
    const r = parseReport('<!-- rp-report {"schemaVersion": 1, "component": 5, "bundle": "x", "plan": 1, "verdict": "odd", "generated": "t"} -->\nB\n');
    expect(r.marker).toBeNull();
    expect(r.malformed).toBe(true);
  });
  it("stripMarkerLine is body-only", () => {
    expect(stripMarkerLine(`${MARKER}\nB\n`)).toBe("B\n");
    expect(stripMarkerLine("B\n")).toBe("B\n");
  });
});
```

Extend `parse.test.ts` inside the existing `it("allFiles includes results bundle text files", ...)` fixture (or a sibling `it`): add `publishedReport: { path: "plans/reports/01-x-r1-report.md", content: "R" }` to one bundle and `publishedReport: null` to another; assert paths include the report path exactly once. Extend `feedback.test.ts` with the new view label:

```ts
it("doc-comment on a report is labeled Reports", () => {
  const md = buildFeedbackMarkdown([
    { id: "1", type: "doc-comment", view: "reports",
      docKey: "plans/reports/01-x-r1-report.md", scope: "", quote: "the finding",
      prefix: "", suffix: "", sectionHeading: "", occurrenceIndex: 0,
      anchored: true, comment: "check this" },
  ], null);
  expect(md).toContain("[Reports]");
  expect(md).toContain('Feedback on: "the finding"');
});
``` Extend `hostedComments.test.ts` with the cross-language FNV pins — the module keeps `hashContent` private, so pin through `targetHash` in Task 10; **here** add only:

```ts
// hostedComments.test.ts — cross-language pin, mirrors tests/test_board.py
// TestPullStaleness. Task 10 wires targetHash; this documents the contract now.
```

(No TS hash assertion yet — `targetHash`'s reports branch arrives in Task 10; the Python pins in Task 6 are authoritative until then.)

- [ ] **Step 2: Run tests to verify they fail**

`cd board && npx vitest run src/lib/reportMarker.test.ts src/lib/parse.test.ts` — reportMarker module missing; parse type error on `publishedReport`.

- [ ] **Step 3: Implement**

Create `board/src/lib/reportMarker.ts`:

```ts
// The generated report's first line is a machine-readable identity marker:
// <!-- rp-report {"schemaVersion": 1, "component": "<NN-slug>", "bundle": N,
//      "plan": N|null, "verdict": "accepted|changes-requested|pending",
//      "generated": "<ISO>"} -->
// The board ALWAYS strips the first line before rendering when it starts with
// the prefix — Marked treats an unclosed comment as swallowing the whole
// document, so rendering must never see a malformed marker.
export interface ReportMarker {
  schemaVersion: number;
  component: string;
  bundle: number;
  plan: number | null;
  verdict: "accepted" | "changes-requested" | "pending";
  generated: string;
}

export interface ParsedReport {
  marker: ReportMarker | null;
  malformed: boolean; // first line claimed to be a marker but did not validate
  body: string; // always safe to render
}

export const MARKER_PREFIX = "<!-- rp-report";
export const REPORT_DOCKEY_RE = /^plans\/reports\/(.+)-r(\d+)-report\.md$/;

const VERDICTS = new Set(["accepted", "changes-requested", "pending"]);

export function parseReport(content: string): ParsedReport {
  const nl = content.indexOf("\n");
  const first = nl === -1 ? content : content.slice(0, nl);
  if (!first.trimStart().startsWith(MARKER_PREFIX)) {
    return { marker: null, malformed: false, body: content };
  }
  const body = nl === -1 ? "" : content.slice(nl + 1);
  const m = /^<!--\s*rp-report\s+(\{.*\})\s*-->\s*$/.exec(first.trim());
  if (!m) return { marker: null, malformed: true, body };
  try {
    const j = JSON.parse(m[1]) as Record<string, unknown>;
    if (
      typeof j.schemaVersion === "number" &&
      typeof j.component === "string" &&
      typeof j.bundle === "number" &&
      (typeof j.plan === "number" || j.plan === null) &&
      typeof j.verdict === "string" && VERDICTS.has(j.verdict) &&
      typeof j.generated === "string"
    ) {
      return {
        marker: {
          schemaVersion: j.schemaVersion, component: j.component,
          bundle: j.bundle, plan: j.plan as number | null,
          verdict: j.verdict as ReportMarker["verdict"], generated: j.generated,
        },
        malformed: false, body,
      };
    }
  } catch { /* fall through to malformed */ }
  return { marker: null, malformed: true, body };
}

export function stripMarkerLine(content: string): string {
  return parseReport(content).body;
}
```

`types.ts`: add `focusView?: "reports" | null;` after `focusResults` (line 8); add to `ResultsBundle` after `assets` (line 77): `publishedReport: BoardFile | null;` and `reportFormats?: { pdf: boolean; docx: boolean };`; extend `DocCommentAnnotation.view` (line 367) with `| "reports"`. `parse.ts` `allFiles`: extend the inline results type (line 387-392) with `publishedReport?: { path: string; content: string } | null;` and add after `if (b.verdictRaw) out.push(b.verdictRaw);` (line 407): `if (b.publishedReport) out.push(b.publishedReport);`. `feedback.ts` `VIEW_LABEL` (line 58-63): add `reports: "Reports",` (the exhaustive Record forces this once the union widens). `navTarget.ts`: widen `NavTarget.tab` (line 7) with `| "reports"`, and add to the doc-comment switch (after the `archive` case, line 78):

```ts
        case "reports": {
          const m = REPORT_DOCKEY_RE.exec(a.docKey);
          return {
            tab: "reports",
            component: m?.[1],
            resultsVersion: m ? Number(m[2]) : undefined,
            annotationId: a.id,
            anchored: a.anchored,
          };
        }
```

with `import { REPORT_DOCKEY_RE } from "./reportMarker";` at the top. `dev-data.ts`: add `publishedReport: null, reportFormats: { pdf: false, docx: false },` to every bundle object (grep `resultsVersion:` there). Then fix Task 2's fixture if the two fields were omitted (add them back).

- [ ] **Step 4: Run the full board suite + typecheck**

`cd board && npm test` → all pass, and `npx tsc --noEmit` (or the build's typecheck) → clean. The compiler surfacing every place the widened `view` union must be handled is this task's point.

- [ ] **Step 5: Commit**

```bash
git add board/src/lib/ board/src/dev-data.ts board/src/views/Results.summary.test.tsx
git commit -m "feat(board): publishedReport types, allFiles parity, reportMarker lib, reports view value"
```

---

### Task 8: TS — Markdown `assets` prop + safe image renderer

**Files:**
- Modify: `board/src/components/Markdown.tsx`
- Test: `board/src/components/Markdown.test.tsx` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: `<Markdown source={...} assets={Record<string, string>} />` — image hrefs resolve ONLY by basename against `assets` (mirroring `assetUrl`, `lib/artifactDisplay.ts:27-33`); unresolved images render as escaped alt text, never as an external fetch; no `assets` prop = today's behavior (no image renderer, imgs render via Marked defaults).

- [ ] **Step 1: Write the failing test**

Create `board/src/components/Markdown.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import Markdown from "./Markdown";

afterEach(cleanup);

describe("Markdown assets image resolution", () => {
  const assets = { "fig1.png": "data:image/png;base64,AAAA" };
  it("resolves a relative path by basename against assets", () => {
    const { container } = render(
      <Markdown source="![Fig one](../execution/01-x/results/r1/artifacts/fig1.png)" assets={assets} />,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(img?.getAttribute("alt")).toBe("Fig one");
  });
  it("never emits an external URL: unresolved images become alt text", () => {
    const { container } = render(
      <Markdown source="![evil](https://evil.example/x.png)" assets={assets} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("evil");
  });
  it("escapes attribute-breaking alt text", () => {
    const { container } = render(
      <Markdown source={'![a"><script>x</script>](fig1.png)'} assets={assets} />,
    );
    expect(container.querySelector("script")).toBeNull();
  });
  it("without assets prop, behavior is unchanged (img passes through Marked)", () => {
    const { container } = render(<Markdown source="![a](x.png)" />);
    expect(container.querySelector("img")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `assets` prop does not exist / unresolved image still renders an `<img>`.

- [ ] **Step 3: Implement**

Rework `Markdown.tsx` to build the Marked instance per-assets (memoized); keep the module-level instance for the no-assets path:

```tsx
import { useMemo } from "react";
import { Marked } from "marked";
import { unwrapSoftBreaks } from "../lib/markdownText";

// HTML policy: comments are stripped; any other raw HTML in artifacts is
// ESCAPED, never executed — a committed/shared board.html must be inert even
// if an artifact contains injected markup.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

// breaks: true — research plans and reports are written line-oriented
// (Serves:, Success:, sign-off lines); single newlines must render as breaks.
// Hard-wrapped paragraphs are soft-unwrapped BEFORE parsing (v0.11), so
// sentence continuations flow to the container width while the intentional
// line-oriented breaks above survive. See lib/markdownText.ts.
function makeMarked(assets?: Record<string, string>) {
  return new Marked({
    gfm: true,
    breaks: true,
    renderer: {
      html({ text }: { text: string }) {
        const t = text.trim();
        if (t.startsWith("<!--")) return "";
        return escapeHtml(text);
      },
      // Reports embed figures by repo-relative path; resolve ONLY against the
      // bundle's basename-keyed assets (same contract as artifactDisplay's
      // assetUrl). Anything unresolved renders as text — the board never
      // fetches an image URL the payload did not provide.
      ...(assets
        ? {
            image({ href, title, text }: { href: string; title: string | null; text: string }) {
              const resolved = assets[href.split("/").pop() ?? ""];
              if (!resolved) return escapeHtml(text || href);
              return `<img src="${escapeAttr(resolved)}" alt="${escapeAttr(text)}"${
                title ? ` title="${escapeAttr(title)}"` : ""
              } class="max-w-full" loading="lazy">`;
            },
          }
        : {}),
    },
  });
}

const defaultMarked = makeMarked();

export default function Markdown({
  source,
  className = "",
  assets,
}: {
  source: string;
  className?: string;
  assets?: Record<string, string>;
}) {
  const html = useMemo(() => {
    const m = assets ? makeMarked(assets) : defaultMarked;
    return m.parse(unwrapSoftBreaks(source)) as string;
  }, [source, assets]);
  return (
    <div
      className={`prose-md ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
```

- [ ] **Step 4: Run test + full board suite** → PASS / all pass.

- [ ] **Step 5: Commit**

```bash
git add board/src/components/Markdown.tsx board/src/components/Markdown.test.tsx
git commit -m "feat(board): Markdown assets prop — basename-resolved, never-external images"
```

---

### Task 9: TS — the Reports view

**Files:**
- Create: `board/src/views/Reports.tsx`
- Test: `board/src/views/Reports.test.tsx`

**Interfaces:**
- Consumes: `parseReport`/`ReportMarker` (Task 7), `Markdown` with `assets` (Task 8), `actionsVisible` (`lib/actions.ts`), `preRenewalSlugs` (`lib/parse.ts`), `AnnotationLayer` + `AnchoredSelection` (`components/AnnotationLayer.tsx`), `Notice` (`views/Tracker.tsx`), types from Task 7.
- Produces: `export default function Reports(props)` with props consumed by Task 10's App wiring:

```ts
{
  data: BoardData;
  canAnnotate: boolean;
  selectedComponent: string | null;
  onSelectComponent: (slug: string) => void;
  annotations: Annotation[];
  onAddDocComment: (a: Omit<DocCommentAnnotation, "id" | "type">) => void;
  onPaintResult: (painted: Set<string>, docKey: string, scopeAbsent: Set<string>) => void;
  onRequestReport?: (req: ReportRequest) => void;
  focusResults: number | null;
  navRequest?: { token: number; resultsVersion?: number } | null;
}
```

- [ ] **Step 1: Write the failing tests**

Create `board/src/views/Reports.test.tsx` (fixture builder mirrors Results.summary.test.tsx; abbreviating only repeated fixture literals — copy the full builder from Task 2 and parameterize):

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Reports from "./Reports";
import type { BoardData, ResultsBundle } from "../lib/types";

afterEach(cleanup);

const MARKER = '<!-- rp-report {"schemaVersion": 1, "component": "01-x", "bundle": 1, "plan": 1, "verdict": "pending", "generated": "2026-07-10T14:30"} -->';

function bundle(over: Partial<ResultsBundle>): ResultsBundle {
  return {
    resultsVersion: 1, dir: "plans/execution/01-x/results/r1",
    manifest: { schemaVersion: 1, component: "01-x", resultsVersion: 1, planVersion: 1,
      provenance: "planned", trigger: "initial", capturedAt: "t", metrics: [], artifacts: [] },
    manifestRaw: { path: "plans/execution/01-x/results/r1/manifest.json", content: "{}" },
    report: null, verdict: null, verdictRaw: null, scripts: [],
    assets: { "fig1.png": "data:image/png;base64,AAAA" },
    publishedReport: {
      path: "plans/reports/01-x-r1-report.md",
      content: `${MARKER}\n# Report\n\n![Fig](../execution/01-x/results/r1/artifacts/fig1.png)\n`,
    },
    reportFormats: { pdf: true, docx: false },
    ...over,
  };
}

function data(bundles: ResultsBundle[], mode: BoardData["mode"] = "live"): BoardData {
  return {
    schemaVersion: 1, generatedAt: "t", mode, focus: null,
    project: { name: "p" }, git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [{ component: "01-x",
        versions: [{ version: 1, path: "plans/execution/01-x/v1.md", content: "# v1" }],
        results: bundles }],
      reviews: [],
    },
  } as BoardData;
}

const noop = () => {};
function draw(d: BoardData, over: Record<string, unknown> = {}) {
  return render(
    <Reports data={d} canAnnotate={false} selectedComponent="01-x"
      onSelectComponent={noop} annotations={[]} onAddDocComment={noop}
      onPaintResult={noop} focusResults={null} navRequest={null} {...over} />,
  );
}

describe("Reports view", () => {
  it("renders the report body with the marker stripped and figures resolved", () => {
    const { container } = draw(data([bundle({})]));
    expect(screen.getByText("Report")).toBeTruthy();
    expect(container.textContent).not.toContain("rp-report");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });
  it("labels the bundle picker rN · plan vN", () => {
    draw(data([bundle({})]));
    expect(screen.getByText(/r1 · plan v1/)).toBeTruthy();
  });
  it("flags a report whose marker verdict predates the current verdict", () => {
    const b = bundle({ verdict: { status: "accepted", date: "t", planVersion: 1, reviewer: "BK" } as never });
    draw(data([b]));
    expect(screen.getByText(/generated before the current verdict/i)).toBeTruthy();
  });
  it("flags a marker naming a different bundle as wrong file", () => {
    const wrong = MARKER.replace('"bundle": 1', '"bundle": 9');
    const b = bundle({ publishedReport: { path: "plans/reports/01-x-r1-report.md", content: `${wrong}\nB\n` } });
    draw(data([b]));
    expect(screen.getByText(/wrong file/i)).toBeTruthy();
  });
  it("soft-flags a marker-less legacy report and still renders it", () => {
    const b = bundle({ publishedReport: { path: "plans/reports/01-x-r1-report.md", content: "# Legacy\n" } });
    draw(data([b]));
    expect(screen.getByText("Legacy")).toBeTruthy();
    expect(screen.getByText(/before verdict tracking/i)).toBeTruthy();
  });
  it("malformed marker: body still renders with a soft flag", () => {
    const b = bundle({ publishedReport: { path: "plans/reports/01-x-r1-report.md", content: '<!-- rp-report {"broken":\n# Body\n' } });
    draw(data([b]));
    expect(screen.getByText("Body")).toBeTruthy();
    expect(screen.getByText(/marker unreadable/i)).toBeTruthy();
  });
  it("empty state without a report offers Generate report when actions available", () => {
    const b = bundle({ publishedReport: null, reportFormats: { pdf: false, docx: false } });
    draw(data([b]), { onRequestReport: vi.fn() });
    expect(screen.getByText(/No report generated/i)).toBeTruthy();
    expect(screen.getByText("Generate report")).toBeTruthy();
  });
  it("empty state notes orphaned pdf/docx", () => {
    const b = bundle({ publishedReport: null, reportFormats: { pdf: true, docx: false } });
    draw(data([b]));
    expect(screen.getByText(/markdown is missing/i)).toBeTruthy();
  });
  it("newer-bundle flag names the latest rN lacking a report", () => {
    const b2 = bundle({ resultsVersion: 2, dir: "plans/execution/01-x/results/r2",
      publishedReport: null, reportFormats: { pdf: false, docx: false } });
    draw(data([bundle({}), b2]), { navRequest: { token: 1, resultsVersion: 1 } });
    expect(screen.getByText(/r2 .*no report/i)).toBeTruthy();
  });
  it("downloads: live shows buttons for existing formats; static shows the repo note", () => {
    draw(data([bundle({})], "live"));
    expect(screen.getByText(/download pdf/i)).toBeTruthy();
    cleanup();
    draw(data([bundle({})], "static"));
    expect(screen.queryByText(/download pdf/i)).toBeNull();
    expect(screen.getByText(/plans\/reports\//)).toBeTruthy();
  });
  it("top-level empty state when no component has bundles", () => {
    draw(data([]));
    expect(screen.getByText(/No reports yet/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — module `./Reports` does not exist.

- [ ] **Step 3: Implement `board/src/views/Reports.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "../components/Markdown";
import AnnotationLayer, {
  type AnchoredSelection,
} from "../components/AnnotationLayer";
import { Notice } from "./Tracker";
import { preRenewalSlugs } from "../lib/parse";
import { actionsVisible } from "../lib/actions";
import { parseReport } from "../lib/reportMarker";
import type {
  Annotation,
  BoardData,
  DocCommentAnnotation,
  ReportRequest,
  ResultsBundle,
} from "../lib/types";

function verdictState(b: ResultsBundle): "accepted" | "changes-requested" | "pending" {
  return b.verdict?.status ?? "pending";
}

function GenerateButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="rounded-full border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:border-emerald-500 dark:hover:border-emerald-400"
      onClick={onClick}
      title="Assemble the shareable report for this bundle (md + pdf/docx) — sends the request and ends this board session"
    >
      Generate report
    </button>
  );
}

export default function Reports({
  data,
  canAnnotate,
  selectedComponent,
  onSelectComponent,
  annotations,
  onAddDocComment,
  onPaintResult,
  onRequestReport,
  focusResults,
  navRequest,
}: {
  data: BoardData;
  canAnnotate: boolean;
  selectedComponent: string | null;
  onSelectComponent: (slug: string) => void;
  annotations: Annotation[];
  onAddDocComment: (a: Omit<DocCommentAnnotation, "id" | "type">) => void;
  onPaintResult: (
    painted: Set<string>,
    docKey: string,
    scopeAbsent: Set<string>,
  ) => void;
  onRequestReport?: (req: ReportRequest) => void;
  focusResults: number | null;
  navRequest?: { token: number; resultsVersion?: number } | null;
}) {
  const groups = data.files.executionPlans.filter(
    (g) => (g.results ?? []).length > 0,
  );
  const preRenewal = preRenewalSlugs(data);
  const group =
    groups.find((g) => g.component === selectedComponent) ?? groups[0] ?? null;
  const bundles = useMemo(() => group?.results ?? [], [group]);

  const [idx, setIdx] = useState(() => {
    if (focusResults !== null) {
      const i = bundles.findIndex((b) => b.resultsVersion === focusResults);
      if (i !== -1) return i;
    }
    return Math.max(0, bundles.length - 1);
  });
  const lastComponent = useRef(group?.component);
  useEffect(() => {
    if (lastComponent.current === group?.component) return;
    lastComponent.current = group?.component;
    setIdx(Math.max(0, bundles.length - 1));
  }, [group?.component, bundles.length]);
  useEffect(() => {
    if (!navRequest || navRequest.resultsVersion === undefined) return;
    const i = bundles.findIndex(
      (b) => b.resultsVersion === navRequest.resultsVersion,
    );
    if (i >= 0) setIdx(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRequest?.token]);
  const bundle = bundles[Math.min(idx, bundles.length - 1)] ?? null;

  if (!group || !bundle) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-10 text-center text-sm text-stone-500">
        No reports yet — generate one from a results bundle: capture with{" "}
        <code>/research-plans:results</code>, then use its report offer or the
        Generate report button.
      </div>
    );
  }

  const rep = bundle.publishedReport;
  const parsed = rep ? parseReport(rep.content) : null;
  const marker = parsed?.marker ?? null;
  const fmts = bundle.reportFormats ?? { pdf: false, docx: false };
  const anyFormat = fmts.pdf || fmts.docx;
  const latest = bundles[bundles.length - 1];
  const actions = actionsVisible(data) && onRequestReport;
  const generate = () =>
    onRequestReport?.({
      component: group.component,
      resultsVersion: bundle.resultsVersion,
    });

  const paintable = annotations
    .filter(
      (a): a is DocCommentAnnotation =>
        a.type === "doc-comment" &&
        a.view === "reports" &&
        a.docKey === (rep?.path ?? "") &&
        Boolean(a.quote),
    )
    .map((a) => ({
      id: a.id,
      quote: a.quote,
      occurrenceIndex: a.occurrenceIndex,
      scope: a.scope,
    }));

  const addSelectionComment = (partial: AnchoredSelection) => {
    if (!rep) return;
    onAddDocComment({
      view: "reports",
      docKey: rep.path,
      scope: partial.scope,
      quote: partial.quote,
      prefix: "",
      suffix: "",
      sectionHeading: "",
      occurrenceIndex: partial.occurrenceIndex,
      anchored: true,
      comment: partial.comment,
    });
  };

  const reportBody = rep && parsed && (
    <section
      className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-6"
      data-annot-scope="published-report"
      data-annot-section="published report"
    >
      <Markdown source={parsed.body} assets={bundle.assets} />
    </section>
  );

  return (
    <div className="flex gap-5">
      <aside className="w-56 shrink-0">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
          Components
        </h2>
        <ul className="space-y-1">
          {groups.map((g) => (
            <li key={g.component}>
              <button
                className={`w-full rounded-md px-2.5 py-1.5 text-left text-sm ${
                  g.component === group.component
                    ? "bg-stone-900 dark:bg-stone-200 font-medium text-white dark:text-stone-900"
                    : "text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800"
                }`}
                onClick={() => onSelectComponent(g.component)}
              >
                {g.component}
                {preRenewal.has(g.component) && (
                  <span className="ml-1 rounded bg-stone-200 dark:bg-stone-700 px-1 py-0.5 text-[10px] text-stone-600 dark:text-stone-400">
                    pre-renewal
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="min-w-0 flex-1">
        {/* bundle picker — rN · plan vN */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {bundles.map((b, i) => (
            <button
              key={b.dir}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                i === Math.min(idx, bundles.length - 1)
                  ? "border-stone-900 bg-stone-900 dark:bg-stone-200 text-white dark:text-stone-900"
                  : "border-stone-300 dark:border-stone-600 bg-white text-stone-600 hover:border-stone-500 dark:hover:border-stone-400"
              }`}
              onClick={() => setIdx(i)}
            >
              r{b.resultsVersion}
              {b.manifest
                ? b.manifest.planVersion != null
                  ? ` · plan v${b.manifest.planVersion}`
                  : " · no plan"
                : ""}
              {b.publishedReport ? "" : " ∅"}
            </button>
          ))}
          {actions && rep && (
            <div className="ml-auto">
              <GenerateButton onClick={generate} />
            </div>
          )}
        </div>

        {/* header: component, verdict state, chips */}
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-stone-800 dark:text-stone-200">
            {group.component} r{bundle.resultsVersion} — report
          </span>
          <span className="rounded-full border border-stone-200 dark:border-stone-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-stone-500">
            {verdictState(bundle)}
          </span>
          {!bundle.manifest && (
            <span className="rounded-full border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-2 py-0.5 text-[10px] text-amber-800 dark:text-amber-300">
              manifest unreadable — plan version unknown
            </span>
          )}
          {preRenewal.has(group.component) && (
            <span className="rounded bg-stone-200 dark:bg-stone-700 px-1.5 py-0.5 text-[10px] text-stone-600 dark:text-stone-400">
              pre-renewal
            </span>
          )}
        </div>

        {/* stale / identity flags */}
        {latest && !latest.publishedReport && (
          <Notice
            text={`r${latest.resultsVersion} has no report yet — generate one to keep the record current.`}
          />
        )}
        {rep && marker && (marker.component !== group.component || marker.bundle !== bundle.resultsVersion) && (
          <Notice text={`Wrong file? This report's marker names ${marker.component} r${marker.bundle}, but it sits in ${group.component} r${bundle.resultsVersion}'s slot.`} />
        )}
        {rep && marker && marker.verdict !== verdictState(bundle) && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
            <span>
              This report was generated before the current verdict (it says
              “{marker.verdict}”, the bundle is “{verdictState(bundle)}”) —
              regenerate to refresh.
            </span>
            {actions && <GenerateButton onClick={generate} />}
          </div>
        )}
        {rep && parsed && !marker && (
          <Notice
            text={
              parsed.malformed
                ? "This report's marker is unreadable (marker unreadable — regenerate to refresh); showing the report body."
                : "This report was generated before verdict tracking — regenerate to refresh its header."
            }
          />
        )}

        {/* body / empty states */}
        {rep ? (
          canAnnotate ? (
            <AnnotationLayer
              docKey={rep.path}
              annotations={paintable}
              onPaintResult={onPaintResult}
              onAdd={addSelectionComment}
            >
              {reportBody}
            </AnnotationLayer>
          ) : (
            reportBody
          )
        ) : (
          <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-10 text-center text-sm text-stone-500">
            <p className="mb-3">
              No report generated for r{bundle.resultsVersion}
              {anyFormat
                ? " — converted files (PDF/DOCX) exist but the markdown is missing; regenerate to restore it."
                : "."}
            </p>
            {actions && bundle.manifest && <GenerateButton onClick={generate} />}
          </div>
        )}

        {/* downloads */}
        {rep && anyFormat && (
          <div className="mt-3 flex items-center gap-2 text-xs text-stone-500">
            {data.mode === "live" ? (
              <>
                {fmts.pdf && (
                  <a
                    className="rounded-md border border-stone-300 dark:border-stone-600 px-3 py-1.5 font-medium text-stone-700 dark:text-stone-300 hover:border-stone-500 dark:hover:border-stone-400"
                    href={`/report/${group.component}/r${bundle.resultsVersion}.pdf`}
                    download
                  >
                    Download PDF
                  </a>
                )}
                {fmts.docx && (
                  <a
                    className="rounded-md border border-stone-300 dark:border-stone-600 px-3 py-1.5 font-medium text-stone-700 dark:text-stone-300 hover:border-stone-500 dark:hover:border-stone-400"
                    href={`/report/${group.component}/r${bundle.resultsVersion}.docx`}
                    download
                  >
                    Download DOCX
                  </a>
                )}
              </>
            ) : (
              <span>
                PDF/DOCX available in <code>plans/reports/</code> in the repo.
              </span>
            )}
          </div>
        )}

        {canAnnotate && rep && (
          <p className="mt-3 text-xs text-stone-400 dark:text-stone-500">
            Select any report text to attach a comment.
          </p>
        )}
      </div>
    </div>
  );
}
```

Adjust `AnchoredSelection` field mapping if the type carries `prefix`/`suffix` (check `components/AnnotationLayer.tsx:27-36` and mirror the Tracker view's `onAdd` handler exactly).

- [ ] **Step 4: Run tests + full board suite** → PASS / all pass.

- [ ] **Step 5: Commit**

```bash
git add board/src/views/Reports.tsx board/src/views/Reports.test.tsx
git commit -m "feat(board): Reports view — rendered report, version chips, stale flags, downloads"
```

---

### Task 10: TS — App wiring + `targetHash` reports branch

**Files:**
- Modify: `board/src/App.tsx` (Tab :52, TABS :54-60, initial tab :161-169, remote banner :1067-1068, view blocks after :1206, `openReport` helper near :918, Tracker/Archive props :1104-1127/:1166-1184), `board/src/lib/hostedComments.ts:28-43` (`targetHash`)
- Test: `board/src/lib/hostedComments.test.ts`, `board/src/lib/navTarget.test.ts`

**Interfaces:**
- Consumes: `Reports` view (Task 9), `REPORT_DOCKEY_RE`/`stripMarkerLine` (Task 7).
- Produces: tab id `"reports"` (label "Reports", static TABS entry after `results`); `openReport(slug: string, resultsVersion: number)` passed to Tracker/Archive/PlanReader as `onOpenReport` (Task 12 consumes); `targetHash` returns the marker-stripped report hash for reports doc-comments.

- [ ] **Step 1: Write the failing tests**

In `hostedComments.test.ts` add (reusing that file's existing data-builder style):

```ts
import { stripMarkerLine } from "./reportMarker";
// inside describe("targetHash")
it("reports doc-comment hashes the report body without the marker line", () => {
  const d = dataWithReport(); // bundle.publishedReport.content = `${MARKER}\n# R\n`
  const a = { id: "1", type: "doc-comment", view: "reports",
    docKey: "plans/reports/01-x-r1-report.md", scope: "", quote: "q", prefix: "",
    suffix: "", sectionHeading: "", occurrenceIndex: 0, anchored: true, comment: "c" } as const;
  const h1 = targetHash(d, a);
  expect(h1).not.toBeNull();
  // regenerating with ONLY a new marker timestamp must not invalidate comments
  const d2 = structuredClone(d);
  d2.files.executionPlans[0].results![0].publishedReport!.content =
    d.files.executionPlans[0].results![0].publishedReport!.content.replace("14:30", "15:00");
  expect(targetHash(d2, a)).toBe(h1);
  // a body change DOES invalidate
  const d3 = structuredClone(d);
  d3.files.executionPlans[0].results![0].publishedReport!.content += "\nmore";
  expect(targetHash(d3, a)).not.toBe(h1);
});
it("cross-language FNV pins match tests/test_board.py TestPullStaleness", () => {
  // targetHash(plan-comment) is hashContent(plan content); pin via a known content.
  const d = planData("plan body\n"); // v1 content exactly "plan body\n"
  const a = { id: "1", type: "plan-comment", component: "01-x", version: 1,
    planPath: "plans/execution/01-x/v1.md", isDraft: false, scope: "", quote: "q",
    prefix: "", suffix: "", sectionHeading: "", occurrenceIndex: 0, anchored: true,
    comment: "c" } as const;
  expect(targetHash(d, a)).toBe("<PIN>"); // fill with the value Python's
  // board.fnv1a_hex("plan body\n") prints; assert the SAME literal in test_board.py
});
```

In `navTarget.test.ts` add:

```ts
it("reports doc-comment navigates to the reports tab with component + bundle", () => {
  const t = navTargetFor({ id: "1", type: "doc-comment", view: "reports",
    docKey: "plans/reports/05-hetero-r3-report.md", scope: "", quote: "q", prefix: "",
    suffix: "", sectionHeading: "", occurrenceIndex: 0, anchored: true, comment: "c" }, data());
  expect(t).toMatchObject({ tab: "reports", component: "05-hetero", resultsVersion: 3 });
});
```

Fill `<PIN>` by running `python3 -c "import sys; sys.path.insert(0, 'skills/managing-research-plans/scripts'); import board; print(board.fnv1a_hex('plan body\n'))"` and add the same assertion to `TestPullStaleness.test_fnv1a_matches_client_hashcontent`.

- [ ] **Step 2: Run tests to verify they fail** — no reports branch in `targetHash`; navTarget falls to the doc-comment `break` fallback.

- [ ] **Step 3: Implement**

`hostedComments.ts` — in `targetHash`, before the final fallback comment (line 41-42), add:

```ts
  if (a.type === "doc-comment" && a.view === "reports") {
    const m = REPORT_DOCKEY_RE.exec(a.docKey);
    if (!m) return null;
    const g = findExecGroup(data, m[1]);
    const rv = g?.results?.find((r) => r.resultsVersion === Number(m[2]));
    // Marker-stripped: regeneration that only restamps the marker must not
    // stale every comment on an unchanged report body.
    return rv?.publishedReport
      ? hashContent(stripMarkerLine(rv.publishedReport.content))
      : null;
  }
```

with `import { REPORT_DOCKEY_RE, stripMarkerLine } from "./reportMarker";`.

`App.tsx`:
1. Line 52: `type Tab = "tracker" | "plans" | "results" | "reports" | "timeline" | "reviews" | "archive";`
2. TABS (54-60): insert `{ id: "reports", label: "Reports" },` after the `results` entry.
3. Initial tab (161-169):

```tsx
  const [tab, setTab] = useState<Tab>(
    gate
      ? "plans"
      : data.focusView === "reports"
        ? "reports"
        : data.focusResults != null
          ? "results"
          : data.focus
            ? "plans"
            : "tracker",
  );
```

4. After `openAnnotation` (near line 929), add:

```tsx
  const openReport = (slug: string, resultsVersion: number) => {
    setSelectedComponent(slug);
    setTab("reports");
    navTokenRef.current += 1;
    setNavRequest({
      tab: "reports",
      resultsVersion,
      annotationId: "",
      anchored: false,
      token: navTokenRef.current,
    });
  };
```

5. Remote banner (1067-1068): change "plans, tracker rows, timeline entries, results, and reviews all take them." → "plans, tracker rows, timeline entries, results, reports, and reviews all take them."
6. View block after the archive block (line 1184):

```tsx
        {tab === "reports" && (
          <Reports
            data={data}
            canAnnotate={canAnnotate}
            selectedComponent={selectedComponent}
            onSelectComponent={setSelectedComponent}
            annotations={annotations}
            onAddDocComment={addDocComment}
            onPaintResult={onPaintResult}
            onRequestReport={guardConn(requestReport)}
            focusResults={data.focusView === "reports" ? (data.focusResults ?? null) : null}
            navRequest={
              navRequest?.tab === "reports"
                ? { token: navRequest.token, resultsVersion: navRequest.resultsVersion }
                : null
            }
          />
        )}
```

with `import Reports from "./views/Reports";` at the top. 7. Pass `onOpenReport={openReport}` to `Tracker` (in the 1104-1127 block) and `Archive` (1166-1184 block) — the props land in Task 12's view signatures; add them here in Task 12 if the compiler objects to unknown props now (do both sides in Task 12 in that case; leave a `// Task 12 wires onOpenReport` note ONLY if executing tasks strictly in order — remove it in Task 12).

- [ ] **Step 4: Run tests + full board suite + typecheck** → PASS / all pass / clean.

- [ ] **Step 5: Commit**

```bash
git add board/src/App.tsx board/src/lib/hostedComments.ts board/src/lib/hostedComments.test.ts board/src/lib/navTarget.test.ts tests/test_board.py
git commit -m "feat(board): Reports tab wiring — focusView, nav, targetHash marker-stripped hashing"
```

---

### Task 11: TS — lean Results

**Files:**
- Modify: `board/src/views/Results.tsx:549-728` (bundle body)
- Test: `board/src/views/Results.lean.test.tsx` (create)

**Interfaces:**
- Consumes: `SummaryOnlyNotice` (Task 2).
- Produces: new body order validation → capture note → key claims (compact, no inline artifact grids) → evidence gallery (ALL artifacts) → provenance; scripts drawer and verdict UI unchanged.

- [ ] **Step 1: Write the failing test**

Create `board/src/views/Results.lean.test.tsx` (reuse Task 2's fixture builder, with a finding-mode manifest that has `metrics: [{ label: "N", value: "10", statement: "Ten.", artifactIds: ["fig"] }]` and `artifacts: [{ id: "fig", kind: "figure", title: "Fig 1", caption: "", file: "artifacts/fig1.png", source: { path: "o/fig1.png", sha256: "0".repeat(64), bytes: 1, oversized: false }, producedBy: null }]`, `assets: { "fig1.png": "data:image/png;base64,AAAA" }`, and `manifest.validation = { status: "conforms", steps: [], criteria: [] }`):

```tsx
describe("lean Results", () => {
  it("renders validation before the finding tiles and no inline artifact grid", () => {
    const { container } = renderLeanFixture();
    const validation = container.querySelector('[data-annot-scope="validation"]');
    const tile = container.querySelector('[data-annot-scope="metric:N"]');
    expect(validation).toBeTruthy();
    expect(tile).toBeTruthy();
    // validation section precedes the finding tile in document order
    expect(
      validation!.compareDocumentPosition(tile!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // the tile no longer embeds ArtifactCards
    expect(tile!.querySelector("img")).toBeNull();
    // the artifact appears exactly once, in the Evidence gallery
    expect(container.querySelectorAll("img").length).toBe(1);
    expect(screen.getByText("Evidence")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — tile embeds the ArtifactCard; heading says "Additional evidence"; provenance precedes validation.

- [ ] **Step 3: Implement the reorder**

Inside the body IIFE (Results.tsx:549+), reorder `bundleBody` to:

```tsx
          const bundleBody = (
            <>
              {/* plan-vs-execution validation (v0.10) — promoted to the top:
                  Results is the reviewing surface (reports-tab spec §7) */}
              {m?.validation && <ValidationSection v={m.validation} />}

              {/* capture note — the bundle's brief report.md */}
              {bundle.report && (
                <section
                  className="mb-4 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5"
                  data-annot-scope="report"
                  data-annot-section="report"
                >
                  <Markdown source={bundle.report.content} />
                </section>
              )}

              {m && findingMode ? (
                <>
                  {/* key claims — compact tiles; figures live in the Evidence
                      gallery below and, in context, on the Reports tab */}
                  {m.metrics.map((metric) => (
                    <section
                      key={metric.label}
                      data-annot-scope={`metric:${metric.label}`}
                      data-annot-section={`metric ${metric.label}`}
                      className="mb-4 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5"
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        {metric.status && (
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              STATUS_CLS[metric.status] ?? STATUS_CLS.descriptive
                            }`}
                          >
                            {metric.status}
                          </span>
                        )}
                        <span className="text-[11px] font-medium uppercase tracking-wide text-stone-500">
                          {metric.label}
                        </span>
                      </div>
                      {metric.statement && (
                        <p className="mb-1 font-serif text-lg leading-snug text-stone-900 dark:text-stone-100">
                          {metric.statement}
                        </p>
                      )}
                      <div className="text-base font-bold text-stone-900 dark:text-stone-100">
                        {metric.value}
                      </div>
                      {metric.note && (
                        <div className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">
                          {metric.note}
                        </div>
                      )}
                    </section>
                  ))}

                  {m.artifacts.length === 0 && <SummaryOnlyNotice />}
                  {m.artifacts.length > 0 && (
                    <section className="mb-4">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                        Evidence
                      </h3>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {m.artifacts.map((art) => (
                          <ArtifactCard
                            key={art.id}
                            art={art}
                            bundle={bundle}
                            openScript={openScript}
                            setOpenScript={setOpenScript}
                            onZoom={onZoom}
                          />
                        ))}
                      </div>
                    </section>
                  )}
                </>
              ) : (
                /* backward-compat branch: UNCHANGED — keep the existing
                   metric tiles + SummaryOnlyNotice + full gallery code here */
              )}

              {/* provenance flow diagram (v0.11) — now closes the review read */}
              {m && (
                <ProvenanceFlow
                  bundle={bundle}
                  planGoal={planGoal}
                  onOpenScript={setOpenScript}
                  onZoom={onZoom}
                />
              )}
            </>
          );
```

Deletions this implies: the `arts` per-metric computation (old lines 580-582), the per-tile embedded grid (old 618-631), the `referenced`/`orphanArtifacts` computation (535-540 — no longer used; remove and drop the unused `ResultArtifact` import only if nothing else uses it). The non-finding branch stays byte-identical (with Task 2's `<SummaryOnlyNotice />`).

- [ ] **Step 4: Run tests + full board suite** → PASS; update any existing Results tests that asserted the old order or the embedded grids (assert the new contract, not the old).

- [ ] **Step 5: Commit**

```bash
git add board/src/views/Results.tsx board/src/views/Results.lean.test.tsx
git commit -m "feat(board): lean Results — validation first, compact claims, single Evidence gallery"
```

---

### Task 12: TS — report chips in Tracker, Archive, PlanReader

**Files:**
- Modify: `board/src/views/Tracker.tsx` (props :50-67, results cell :479-504), `board/src/views/Archive.tsx` (props :38-52, results cell :~200), `board/src/views/PlanReader.tsx` (props + bundle buttons :391-412), `board/src/App.tsx` (pass `onOpenReport={openReport}` to all three)
- Test: `board/src/views/Tracker.reportchip.test.tsx` (create)

**Interfaces:**
- Consumes: `openReport(slug, resultsVersion)` from Task 10.
- Produces: optional prop `onOpenReport?: (slug: string, resultsVersion: number) => void` on Tracker, Archive, and PlanReader; a "report" chip appears only when a bundle has `publishedReport`. Tracker/Archive chip targets the LATEST bundle WITH a report; PlanReader chips are per-bundle.

- [ ] **Step 1: Write the failing test**

Create `board/src/views/Tracker.reportchip.test.tsx` (fixture: one component whose r1 has `publishedReport` set, r2 has `publishedReport: null`; master plan content must produce a tracker row linking the component — copy the master-plan fixture from an existing Tracker/dev-data test):

```tsx
it("tracker row shows a report chip targeting the latest bundle WITH a report", () => {
  const onOpenReport = vi.fn();
  renderTrackerFixture({ onOpenReport });
  fireEvent.click(screen.getByText("report"));
  expect(onOpenReport).toHaveBeenCalledWith("01-x", 1); // r2 exists but has no report
});
it("no chip when no bundle has a report", () => {
  renderTrackerFixtureWithoutReports();
  expect(screen.queryByText("report")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails** — no chip rendered.

- [ ] **Step 3: Implement**

Tracker: add `onOpenReport?: (slug: string, resultsVersion: number) => void;` to the props type (:60-66 area) and destructure it (:43-49 area). In the results cell IIFE (:480-503), after the existing `r{latest} {mark}` button `return`, restructure to render both:

```tsx
                    {(() => {
                      const g = slug
                        ? data.files.executionPlans.find(
                            (x) => x.component === slug,
                          )
                        : null;
                      const latest = g?.results?.[g.results.length - 1];
                      if (!latest)
                        return <span className="text-xs text-stone-400 dark:text-stone-500">—</span>;
                      const mark =
                        latest.verdict?.status === "accepted"
                          ? "✓"
                          : latest.verdict?.status === "changes-requested"
                            ? "✕"
                            : "●";
                      const withReport = [...(g!.results ?? [])]
                        .reverse()
                        .find((b) => b.publishedReport);
                      return (
                        <span className="inline-flex items-center gap-2">
                          <button
                            className="text-xs font-medium text-blue-700 dark:text-blue-400 underline hover:text-blue-900 dark:hover:text-blue-300"
                            onClick={() => onOpenResults(slug!)}
                          >
                            r{latest.resultsVersion} {mark}
                          </button>
                          {withReport && onOpenReport && (
                            <button
                              className="text-xs font-medium text-emerald-700 dark:text-emerald-400 underline hover:text-emerald-900 dark:hover:text-emerald-300"
                              onClick={() =>
                                onOpenReport(slug!, withReport.resultsVersion)
                              }
                            >
                              report
                            </button>
                          )}
                        </span>
                      );
                    })()}
```

Archive: same prop + the same `withReport` chip beside its `r{latest.resultsVersion}` button (:200-203 area, same pattern). PlanReader: add the prop, and inside the per-bundle buttons map (:396-411), after each `r{b.resultsVersion}` button add:

```tsx
                {b.publishedReport && onOpenReport && (
                  <button
                    key={`${b.dir}-report`}
                    className="rounded-full border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-stone-900 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-400 hover:border-emerald-500"
                    onClick={() => onOpenReport(group.component, b.resultsVersion)}
                  >
                    report
                  </button>
                )}
```

App: pass `onOpenReport={openReport}` in the Tracker (:1104-1127), Archive (:1166-1184), and PlanReader (:1128-1146) blocks; remove any Task-10 placeholder note.

- [ ] **Step 4: Run tests + full board suite** → PASS / all pass.

- [ ] **Step 5: Commit**

```bash
git add board/src/views/Tracker.tsx board/src/views/Archive.tsx board/src/views/PlanReader.tsx board/src/App.tsx board/src/views/Tracker.reportchip.test.tsx
git commit -m "feat(board): report chips — tracker, archive, and per-bundle plan-reader links"
```

---

### Task 13: Rebuild the committed board template + export smoke test

**Files:**
- Modify: `skills/managing-research-plans/assets/board-template.html` (generated by the build)
- Test: `tests/test_board.py`

**Interfaces:**
- Consumes: every React change (Tasks 2, 7-12).
- Produces: the template all board modes actually serve.

- [ ] **Step 1: Write the failing smoke test**

```python
class TestExportSmoke(unittest.TestCase):
    def test_static_export_embeds_published_report(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); make_project(root); add_report(root)
            html = board.render_static_html(root, None)
            self.assertIn("publishedReport", html)
            self.assertIn("Findings body.", html)
            self.assertIn("reportFormats", html)

    def test_hosted_render_embeds_published_report(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); make_project(root); add_report(root)
            html = board.render_hosted_html(root)
            self.assertIn("publishedReport", html)
            self.assertIn("Findings body.", html)
```

Run: `python3 -m unittest tests.test_board.TestExportSmoke -v` → should already PASS (payload embeds regardless of template). It guards the Python→template integration; keep it.

- [ ] **Step 2: Rebuild the template**

Run: `cd board && npm run build`
Expected: vite build succeeds and the script copies the output into `skills/managing-research-plans/assets/board-template.html`. Verify the new view shipped: `grep -c "Reports" skills/managing-research-plans/assets/board-template.html` → ≥ 1 (minified, so grep the tab label string `label:"Reports"` or just non-zero count).

- [ ] **Step 3: Run BOTH full suites** — `python3 -m unittest discover -s tests -v` and `cd board && npm test` → all pass.

- [ ] **Step 4: Commit**

```bash
git add skills/managing-research-plans/assets/board-template.html tests/test_board.py
git commit -m "feat(board): rebuild template with Reports tab + export smoke test"
```

---

### Task 14: Command files — results.md, report.md, board.md, sync.md

**Files:**
- Modify: `commands/results.md` (step 7 :23, step 10 :34), `commands/report.md` (intro :7, step 2 :11-20, step 4 :24, frontmatter :2), `commands/board.md` (description :2, step 3 :13, step 5 report bullet :56, step 5 verdict bullet), `commands/sync.md` (step 7 :32)
- Test: manual re-read (command files have no automated tests)

**Interfaces:**
- Consumes: marker format from Task 7, focus grammar from Task 4.
- Produces: the researcher-facing flow. Keep every file's existing voice; one paragraph per line (no hard wrap).

- [ ] **Step 1: results.md — report offer + log-before-board**

In step 7, after the sentence ending "verify the printed `rN` path exists on disk before reporting." insert:

```
Then **offer the shareable report** (one AskUserQuestion, before anything else): generate `plans/reports/<NN-slug>-r<N>-report.md` for this bundle now? Default to yes when the component's previous bundle already has a report — regeneration continuity. On yes, proceed into the full `/research-plans:report <NN-slug> r<N>` workflow now (it writes the files and returns; its board-reopen offer does not apply — this flow opens the board itself next). When several bundles were captured in one pass, ask once at the end with a multi-select over all captured bundles instead of per-bundle. Next, append the step-10 decision-log entry now — the log is written **before** the board opens, so a persistent board session never runs ahead of the capture record. Only then open the board
```

(joining into the existing "Then open the board on the bundle by proceeding into..." sentence — rewrite that sentence to start "Only then open the board on the bundle by proceeding into the full `/research-plans:board <NN-slug>:r<N>` workflow — **not** a bare `board.py` launch:", preserving the rest verbatim). Rewrite step 10 to:

```
10. **Log.** The decision-log entry (real timestamp) recording what was captured, any report generated, and why, per the standard format — written in step 7 **before** the board opened; this step is only a checkpoint that it happened.
```

- [ ] **Step 2: report.md — marker, planless shape, figures under findings, caller owns reopen**

1. Frontmatter `description` (line 2): replace "plan context, findings, embedded figures/tables, validation, provenance" with "plan context, findings with their figures/tables embedded under each, validation, provenance".
2. Step 2, before the Header-block bullet, add a new first bullet:

```
   - **Marker line (the file's very first line, exactly one line):** `<!-- rp-report {"schemaVersion": 1, "component": "<NN-slug>", "bundle": <N>, "plan": <N or null>, "verdict": "<accepted|changes-requested|pending>", "generated": "<YYYY-MM-DDTHH:MM>"} -->` — valid JSON on one line, closed with `-->`. The board parses this to flag stale reports; verdict is the bundle's CURRENT verdict state at generation time.
```

3. In the Header-block bullet, after "plan v<N>" add: "— or **No governing plan** when `manifest.planVersion` is null (retrofit/adopted work)". In bullet 1 (Background and goal) append: "For a planless bundle (`planVersion` null), the background comes from the master-plan tracker row and the bundle's capture note instead of plan Goal/Context."
4. Replace bullets 3 and 4 with:

```
   - **3. Findings** — each manifest metric: the `statement` as a lead sentence, then `label`, `value`, `note`, `status`, then **that finding's figures and tables embedded directly beneath it** (the artifacts its `artifactIds` names): `![<title>](../execution/<NN-slug>/results/r<N>/artifacts/<file>)` with the caption on the next line — paths RELATIVE to `plans/reports/` so the markdown renders on GitHub and in editors. Tables embed their `.png` render; note `.tex` availability in the caption line when present. Artifacts no finding references follow in an **Additional evidence** section after the last finding. When no metric has `artifactIds`, keep a single standalone **Figures and tables** section instead (the pre-reports-tab layout).
   - **4. Validation summary** — the manifest.validation status plus its steps/criteria as a compact table; "not validated" when absent.
   - **5. Provenance appendix** — scripts with repo paths and sha256s from the manifest, source-drift state (`python3 ${CLAUDE_PLUGIN_ROOT}/skills/managing-research-plans/scripts/results.py changed --component <NN-slug>`), and the related decision-log entries (timestamps plus a one-line gist).
```

(old bullets 5 and 6 are absorbed as the new 4 and 5 — delete the originals.)
5. Step 4 wrap-up: replace the reopen sentence with:

```
Reopening belongs to the caller: when this run was chained from `/research-plans:results`, just return — results owns the single board open. When triggered from the board's Generate report button, relaunch per `/research-plans:board` (it refocuses with `--focus <NN-slug>:r<N>:reports`). Only a standalone `/report` run offers to open the board (`/research-plans:board <NN-slug>:r<N>:reports`).
```

- [ ] **Step 3: board.md — description, focus grammar, report/verdict routing**

1. Description (line 2): after "decision timeline," insert "generated reports,".
2. Step 3 (Resolve the mode, line 13): add the sentence: "`--focus` accepts `slug`, `slug:rN`, or `slug:rN:reports` — the third form opens the Reports tab pinned to that bundle."
3. Step 5 report-request bullet (line 56): change the relaunch instruction from "`--focus <component>:r<resultsVersion>`, same port" to "`--focus <component>:r<resultsVersion>:reports`, same port — landing on the Reports tab showing the fresh report".
4. Step 5 verdict bullet: locate the bullet that applies a verdict (`results.py verdict --status ...`) and append: "After applying the verdict, when the bundle has a generated report whose marker verdict no longer matches (the Reports tab flags this), offer one-click regeneration: on yes, proceed into `/research-plans:report <component> r<resultsVersion>` and relaunch with `--focus <component>:r<resultsVersion>:reports`."

- [ ] **Step 4: sync.md** — in step 7 (line 32), extend the sentence "`/research-plans:results` opens the board once at the end for the verdict pass, so do not open a second board here." to "`/research-plans:results` offers the bundle's shareable report and opens the board once at the end for the verdict pass, so do not open a second board here."

- [ ] **Step 5: Re-read all four files end-to-end** — check no contradiction survives (the once-only board rule, the log-before-board ordering, reopen ownership). Fix inline.

- [ ] **Step 6: Commit**

```bash
git add commands/results.md commands/report.md commands/board.md commands/sync.md
git commit -m "docs(commands): capture-end report offer, marker line, findings-embedded figures, reports focus"
```

---

### Task 15: Docs — README, QUICKSTART, SKILL.md, CHANGELOG

**Files:**
- Modify: `README.md` (:80, :87, :89, :105, :139 region), `QUICKSTART.md` (:54, :72), `skills/managing-research-plans/SKILL.md` (:42, :75, :88, :91), `CHANGELOG.md` (`[Unreleased]`)

- [ ] **Step 1: README.md**

- Line 87: "in **five views** — six after a renewal" → "in **six views** — seven after a renewal"; extend the view list after the **Results** clause with: "a **Reports** view that renders each bundle's generated report — figures in context, `rN · plan vN` version chips, stale-report flags, and PDF/DOCX downloads on the local board;".
- Line 89 (Results/provenance description): adjust to note Results is the reviewing surface (validation first, compact claim tiles) and the narrative reading surface is the Reports view.
- Line 105: extend the Generate-report sentence: "…under `plans/reports/`, with each figure embedded under the finding it supports and a first-line marker the board uses to flag stale reports; `/research-plans:results` offers the same generation at capture end."
- Line 80 command-table row for `/research-plans:report`: append "; offered automatically at capture end".
- Line ~139 dir tree: keep, and verify the `02-analysis-r1-report.md` line still reads correctly (naming unchanged).

- [ ] **Step 2: QUICKSTART.md** — extend both view enumerations (:54, :72) with "generated reports" (e.g., "…the decision log as a timeline, generated reports with version chips, and saved review scorecards").

- [ ] **Step 3: SKILL.md**

- Results-bundles paragraph (:42): append "A bundle's generated report (`plans/reports/<NN-slug>-rN-report.md`, one per bundle) is a derived document keyed 1:1 to the bundle; its first line is an `rp-report` JSON marker recording component/bundle/plan/verdict/date."
- Reports quick-reference row (:75): note "figures embedded under findings; first-line rp-report marker".
- `/research-plans:report` command row (:88): append "; offered at capture end by /results; board Reports tab renders it".
- `/research-plans:board` row (:91): "tracker (with drift flags), plans + diffs, results, reports, timeline, scorecards".

- [ ] **Step 4: CHANGELOG.md** — add under `[Unreleased]`:

```markdown
### Added
- Board **Reports** tab: renders each bundle's generated report with figures resolved from bundle assets, `rN · plan vN` version chips, stale-report and wrong-file flags (first-line `rp-report` JSON marker), PDF/DOCX downloads on the local board, drag-select commenting, and report chips on Tracker/Archive rows and PlanReader bundles (`--focus slug:rN:reports`).
- `/research-plans:results` offers report generation at capture end; the board's verdict routing offers one-click report regeneration when the report's recorded verdict goes stale.
- `/research-plans:report` embeds figures under the finding each supports (via `artifactIds`) and defines the planless (retrofit) report shape.
- Hosted pull: per-comment staleness tags for plan and report comments (client FNV-1a hash ported to Python); `docHash` now survives the pull.

### Changed
- Results view is now the reviewing surface: validation promoted to the top, finding tiles compact (figures live in one Evidence gallery and on the Reports tab).

### Fixed
- Hosted pulls now strip the `reopen` action key (researcher-only) from collaborator annotations.
- Summary-only bundles show their notice in finding mode too.
```

- [ ] **Step 5: Commit**

```bash
git add README.md QUICKSTART.md skills/managing-research-plans/SKILL.md CHANGELOG.md
git commit -m "docs: Reports tab — README/QUICKSTART/SKILL view lists + changelog"
```

---

## Final verification (after all tasks)

- [ ] `python3 -m unittest discover -s tests -v` — all pass.
- [ ] `cd board && npm test` — all pass; `npx tsc --noEmit` clean.
- [ ] Manual walkthrough on a scratch project (`python3 scripts/new-walkthrough.py`, or reuse an existing scratch): capture a bundle → accept the report offer → open the board → Reports tab renders with chips → drag-select comment → verdict → regen offer appears → relaunch with `--focus <slug>:r1:reports` and confirm the board lands on the Reports tab pinned to r1 → `--export` and confirm the Reports tab works in the static file.
- [ ] Whole-branch review (repo convention): a fresh-context reviewer over the full diff vs main — the per-task reviews structurally miss cross-task seams (this caught real bugs in v0.13 and v0.14).
