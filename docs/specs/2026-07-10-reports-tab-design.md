# Reports tab + lean Results — design

Date: 2026-07-10. Status: revised after Codex review (see Revision history). Version label: intentionally unassigned — BK numbers at release cut (next in line after v0.14.0). All file:line anchors verified against main @ 8a6afc8 (by three Explore agents, re-verified by the Codex grounded review).

## 1. Summary and motivation

The board's Results view currently carries two jobs at once: reviewing an execution (validation, verdict) and communicating its findings (narrative, figures, interpretation). Meanwhile `/research-plans:report` (v0.10) already generates a shareable per-bundle report into `plans/reports/`, but those reports are invisible on the board and report generation is a manual afterthought.

This design separates the two goals:

- **Results tab = the reviewing surface.** Validation results promoted to the top, key claims as compact tiles, evidence gallery, provenance, scripts, verdict actions. "Did the execution do what the plan said, and what are the headline numbers?"
- **Reports tab (new) = the reading surface.** The generated narrative report rendered with its figures in context, downloads, and the same drag-select commenting as every other view. "What did we find and what does it mean?"

Version correspondence is made visible everywhere: every report is 1:1 with a results bundle rN, every bundle records its governing plan vN (`manifest.planVersion`, nullable), and the board labels reports "rN · plan vN" (or "rN · no plan") so plan version ↔ results version ↔ report version is one traceable chain.

## 2. Decisions locked (researcher answers, 2026-07-10; verdict-loop and scope answers added post-Codex)

1. **Tab split:** lean Results + rich Reports (as above). Verdict stays on Results.
2. **Trigger:** `/research-plans:results` offers report generation at capture end; `/report` command and the board's Generate-report button remain for regeneration and backfill.
3. **Versioning:** one report per bundle rN (`plans/reports/<NN-slug>-r<N>-report.md`), labeled "rN · plan vN" on the board. Plan v2 governing bundles r3 and r4 yields two reports. Regenerating overwrites only that bundle's report (reports stay derived documents; the bundle is the immutable record).
4. **Payload:** lean. The report markdown renders with figures in every mode (figures resolve to the bundle assets already in the payload — no duplication). PDF/DOCX download buttons only on the local live board; share/hosted modes show a "PDF/DOCX in plans/reports/" note when those files exist. Binaries are never base64-embedded.
5. **Extras (all in):** tracker-row report chip, stale-report flag, and `/report` embeds figures under the finding each supports (via `artifactIds`) instead of a separate figures section.
6. **Verdict loop:** capture-end reports record `verdict: pending`; recording a verdict on the board flags the mismatch and the board session offers one-click regeneration (§8). Reports always state the verdict they were generated under.
7. **Hosted pull staleness:** minimal fix now — `docHash` survives the pull and file-content-hashed comment types get a staleness tag in the pulled feedback doc (§9).
8. **Archive links:** archived (pre-renewal) rows link to their reports like live tracker rows; the Reports tab shows the pre-renewal badge Results already uses.

## 3. Pre-existing defects fixed on this branch first

Two bugs on main surfaced during review; both are prerequisites, fixed and tested before the feature work:

1. **Hosted `reopen` forgery gap (security).** `_neutralized_annotation` (board.py:1677-1678) strips only `verdict`/`reviewRequest`/`reportRequest`/`signoff` from hosted collaborator annotations, but `ACTION_KEYS` (board.py:1582) also contains `reopen` — a nested `reopen` object survives into the pulled feedback fence (hosted validation accepts extra annotation fields, web-template/lib/validate.ts:36; pull assembles without the hand-delivered strip path, board.py:1257). Fix: strip by iterating `ACTION_KEYS` itself — no second hand-maintained tuple. Test: a hosted annotation carrying every action key arrives with none.
2. **Summary-only bundles in finding mode.** A metric with a `statement` puts the bundle into finding mode (Results.tsx:527-534), but the "Summary only" notice exists only in the non-finding branch (Results.tsx:683-697) — a summary-only bundle whose metrics carry statements shows no notice. Fix: render the notice in both branches.

## 4. Data model and collection (Python, `board.py`)

**Attach the report to its bundle**, not as a top-level sibling — the Reports tab needs the bundle's plan version, verdict, and assets anyway.

- `collect_results` (board.py:234-277) gains: for each bundle rN, look up `plans/reports/<NN-slug>-r<N>-report.md`; `bundle["publishedReport"]` = its BoardFile, or `null` when absent (name avoids colliding with `bundle["report"]`, the capture note at board.py:261-262). `bundle["reportFormats"] = {"pdf": bool, "docx": bool}` from disk existence of the sibling files; both false when absent. TS `ResultsBundle` gains the same two fields with the same absent shape.
- **Hash parity (the drift trap):** append `publishedReport` to `payload_files` (board.py:198-218, bundle block 207-213) *and* to the client's `allFiles` (board/src/lib/parse.ts:379-417, bundle loop 404-409) in the same change — these two lists must stay mirrored or share-hash/staleness drifts. Add the report path to `all_paths` (board.py:488-495) for git file dates. **`reportFormats` deliberately participates in neither hash surface** — PDF appearance/removal does not invalidate comments; documented limitation (a general comment about download availability can outlive the availability).
- **No gitignore change:** `plans/reports/` is committed (GITIGNORE_LINES board.py:83-96 untouched; signoff_gate.py does not match `plans/reports/` paths — verified, no gate interaction).
- **No `build_assets` change for figures:** report figures live in the bundle's `artifacts/` dir, which `build_assets` (board.py:292-317) already embeds (data URLs in non-live modes) or routes (`/artifact/...` in live). The report markdown reuses them by basename (§6). PDFs/DOCX are deliberately *not* added to assets in any mode.

## 5. Local downloads (live board only)

New GET routes on the local server, following the traversal-safe `artifact_map` pattern (exact-key dict lookup, board.py:320-330 + do_GET 841-854): build a `report_map` of `"/report/<component>/r<N>.<ext>" → Path` entries for existing `.pdf`/`.docx` files (the markdown already rides the payload — no route needed). `do_GET` gains one lookup branch; unknown key → 404; responses carry `Content-Disposition: attachment` so PDFs download instead of opening in-tab. No filesystem joins with client input. Non-live modes get no routes — the client uses `data.mode` to decide buttons vs the pointer note.

## 6. Reports tab (React, `board/src/`)

- **Tab:** id `"reports"`, label "Reports" — added to the `Tab` type (App.tsx:52) and the static `TABS` list (App.tsx:54-60). Always visible, like Results: an empty project shows a top-level empty state ("No reports yet — generate one from a results bundle"), not a hidden tab.
- **Layout mirrors Results:** component sidebar (components with ≥1 bundle), per-bundle picker labeled **"r3 · plan v2"** ("r3 · no plan" when `manifest.planVersion` is null). Header row: component name, verdict badge (from the bundle), provenance/late chips, the pre-renewal badge Results uses, stale flags (§8).
- **Body:** the report markdown — minus its first marker line (§8) — rendered via `Markdown` with a new optional `assets` prop. The image renderer override resolves `href` **only** by basename against `bundle.assets` (mirroring `assetUrl`, lib/artifactDisplay.ts:27-33); an unresolved path renders as its alt text, never as an external URL fetch, and the resolved token goes through Marked's default image renderer so the existing HTML-escaping policy (Markdown.tsx:5,24) is not bypassed. Today `Markdown.tsx` has no image renderer at all (verified), so relative paths would otherwise 404.
- **Downloads row:** `data.mode === "live"` → buttons hitting the `/report/...` routes for the formats `reportFormats` marks true; other modes with any format true → text note "PDF/DOCX available in plans/reports/ in the repo".
- **State matrix (explicit):**
  - Bundle without a report, actions available → empty state + **Generate report** button (same `ReportRequest` channel, gated by `actionsVisible` like its Results twin at board/src/views/Results.tsx:381-396); collaborators see the empty state without the button.
  - Bundle without a report but with orphaned `.pdf`/`.docx` on disk → empty state notes "converted files exist but the markdown is missing — regenerate".
  - Stale report (§8) → the flag itself carries the same Generate-report button (regeneration remedy, not just for missing reports).
  - Invalid/missing manifest → the bundle renders the report if one exists, with a "manifest unreadable — plan version unknown" chip; no Generate button (the command could not complete a coherent order).
  - Marker identifies a different component/bundle than the file location implies → prominent "wrong file?" warning; still rendered.
  - Several later bundles missing reports → the newer-bundle flag names the latest rN only.
- **Navigation (bundle-aware everywhere):** all report navigation carries the bundle number — `onOpenReport(slug, resultsVersion)` wired in App to select component, set tab, and pin the bundle via the Reports view's own one-shot `navRequest` prop (pattern: Results navRequest, App.tsx:1147-1165). Callers: tracker chip (§7), Archive rows (§7), PlanReader's per-bundle buttons (PlanReader.tsx:391-399, which currently pass only the component), and `navTargetFor` — whose `NavTarget["tab"]` union gains `"reports"`.
- **Focus grammar (three-part):** `--focus <slug>[:rN][:view]` — `split_focus` (board.py:333) returns `(slug, resultsVersion, view)` with `view ∈ {results, reports}` defaulting to today's behavior; all callers updated (static board.py:1088, share board.py:1365, live board.py:2048). The payload gains `focusView` alongside `focusResults` (types.ts:7); App's initial-tab branch (App.tsx:161-169) honors it. **Share collection keeps `meta.focus` as the plain slug** so remote hash recomputation is unaffected. App's remote-review banner view enumeration (App.tsx:1067) gains Reports.

## 7. Lean Results, tracker chip, archive links

**Lean Results** (board/src/views/Results.tsx) — precise delta, keeping verdict UI (413-521), ProvenanceFlow (553-560), scripts drawer (737-765), and the capture-note overview (562-571 — it *is* the "brief summary", already brief by design):

- **Promote `ValidationSection`** (573-574) to the top of the bundle body. New body order: validation → capture note (report.md) → key claims → evidence gallery → provenance → scripts.
- **Compact the finding tiles:** keep the tile chrome (status badge / label / statement / value / note, 590-617) but **remove the inline embedded `ArtifactCard` grids** (618-631, and the `arts` computation 580-582). All artifacts — referenced and orphan — render once in the gallery below (the "Additional evidence" section 636-654 becomes the single "Evidence" gallery in finding mode; non-finding mode 656-713 unchanged). Summary-only notice renders in both branches (§3.2).
- Finding tiles keep their `metric:<label>` annot-scopes; claims remain individually commentable.

**Tracker chip:** rows whose component has at least one bundle **with a report** get a small report chip beside the existing r{N} results link (Tracker.tsx:479-504), calling `onOpenReport(slug, resultsVersion of the latest bundle with a report)`. No chip when no report exists.

**Archive:** archived pre-renewal rows gain the same chip (Archive view currently links only to Results); the Reports tab renders the pre-renewal badge for those components (slug mapping via `preRenewalSlugs`, as Results does).

## 8. Report marker and stale-report flags

`/report` writes a machine-readable **first line** into every generated report — one-line JSON, ISO timestamp, nullable plan:

`<!-- rp-report {"schemaVersion": 1, "component": "<NN-slug>", "bundle": <N>, "plan": <N|null>, "verdict": "accepted|changes-requested|pending", "generated": "<YYYY-MM-DDTHH:MM>"} -->`

- **The client strips the first line before passing the body to `Markdown`** whenever it starts with the `<!-- rp-report` prefix — well-formed or not. Codex verified that an unclosed `-->` makes Marked treat the rest of the document as one comment token, which the renderer then strips entirely; removing the line first means a malformed marker degrades to a soft flag plus a fully rendered report, never a blank page.
- Marker fields `component`/`bundle` are validated against the file's location (mismatch → "wrong file?" warning, §6); `verdict` drives flag 1; `plan` is display-only.
- Reports predating this change have no marker: "unknown vintage" soft flag ("generated before verdict tracking — regenerate to refresh").
- No marker parsing in Python; client-only.

Two advisory flags on the Reports tab, each carrying the Generate-report button as the remedy:

1. **Report predates verdict:** marker `verdict` ≠ current bundle verdict state → "This report was generated before the current verdict — regenerate." Per decision 6 this is the *designed* lifecycle: capture-end reports say `pending`, and the board session's verdict routing (board.md step 5) offers one-click regeneration right after a verdict is recorded on a bundle whose report verdict mismatches — so accepting a bundle immediately offers to refresh its report header.
2. **Newer bundle without a report:** viewing any bundle while the latest rN in the component lacks a report → "r4 exists without a report — generate."

## 9. Annotations, feedback parity, hosted staleness

Report comments reuse the existing **doc-comment** machinery — no new annotation type (the cheapest path with full anchor/paint/nav plumbing, and `KNOWN_COMMENT_TYPES` in Python already admits `doc-comment`):

- `DocCommentAnnotation.view` union (types.ts:367) gains `"reports"`; `docKey` = the report's repo path (`plans/reports/<NN-slug>-r<N>-report.md`), which uniquely keys component + bundle.
- TS `VIEW_LABEL` (feedback.ts:58-63, exhaustive Record — compiler forces the entry) and Python `_VIEW_LABEL` (board.py:1662-1663) both gain `"reports": "Reports"` so live and hosted feedback docs label these comments identically.
- The Reports tab wraps its body in its own `AnnotationLayer` (docKey = report path) with a single `data-annot-scope="published-report"` stamp — same single-scope pattern as the Results capture-note block. One gesture everywhere: drag-select → comment; no new buttons.
- `onPaintResult`'s doc-comment branch (App.tsx:409-417) already keys by docKey; `navTargetFor` (lib/navTarget.ts:52-79) gains a `"reports"` case that parses `<NN-slug>` and `r<N>` from the docKey filename to set tab + component + bundle.
- **Browser-side staleness:** `targetHash` (hostedComments.ts:28-43) gains a branch: doc-comment with view `"reports"` → hash of the matching bundle's `publishedReport.content` **excluding the marker line** (find bundle via docKey) — so regenerating with only a new timestamp does not invalidate comments on an unchanged report body.
- **Pull-side staleness (minimal fix, all hosted comment types):** `_neutralized_annotation` (board.py:1671-1701) preserves `docHash` instead of dropping it. Python gains a port of the client's FNV-1a `hashContent`, and at pull time `assemble_hosted_document` tags comments whose recorded `docHash` mismatches the recomputed hash of their target — for the comment types whose hash source is a plain file string (plan-comments → plan version content; report doc-comments → report body sans marker): "⚠ may refer to an older version of this document". Types hashed from client-side JSON serialization (result/script comments, `JSON.stringify` of the bundle — not portable byte-for-byte to Python) pass `docHash` through untagged; documented boundary. A hash-parity test pins the Python FNV-1a to the TS output on shared fixtures.
- Hosted pulls: nothing new to strip for doc-comments beyond §3.1's `ACTION_KEYS` fix; `assemble_hosted_document`'s doc-comment render branch (board.py:1753-1761) works as is once `_VIEW_LABEL` has the entry.

## 10. Command changes

**`commands/results.md`** — step 7 gains, after finalize verification and *before* the single board open: offer report generation for the just-finalized bundle (one question; default yes when the previous bundle of this component has a report — regeneration continuity). On yes, proceed into the `/research-plans:report` workflow for that bundle, then continue to the board open. Reconcile/chained mode: offer once at the end for all captured bundles (multi-select), generate the accepted ones, then the one board session. **The decision-log entry (currently step 10) moves before the board open** so a persistent board session cannot start ahead of the capture/report log entry. The once-only board rule and sync.md's "do not open a second board here" (sync.md step 7, line 32) are untouched because generation happens before the board opens. `sync.md` needs no new step (it delegates to `/results`); update its one sentence describing what `/results` does at the end.

**`commands/report.md`** —
- Step 2: the `rp-report` marker line (§8) becomes the file's first line. **Planless shape defined:** when the bundle's `planVersion` is null (retrofit/adopted work), the header says "No governing plan", section 1's background comes from the master-plan tracker row and the bundle's capture note instead of plan Goal/Context, and the marker records `"plan": null`.
- Section 3 (Findings) absorbs section 4: each metric's figures/tables (via `artifactIds`) embed directly under that finding — statement lead, then `label`/`value`/`note`/`status`, then its `![title](...)` embeds with captions (table `.png` embed + `.tex` availability note migrate here). Artifacts referenced by no finding render in an "Additional evidence" section after the findings, mirroring the board's finding mode (Results.tsx:576-654). When no metric has `artifactIds` (non-finding bundles), keep the old standalone figures section as the fallback. Sections renumber (validation summary → 4, provenance appendix → 5); frontmatter description updated.
- Step 4 wrap-up: **reopening belongs to the caller.** Called from `/results` → results owns the single board open; triggered from the board's button → board.md relaunches (as today, board.md:56); standalone `/report` run → offer to open the board with `--focus <NN-slug>:r<N>:reports`.

**`commands/board.md`** — description gains the Reports view; step 3 focus parsing documents the three-part grammar; step 5's report-request bullet (line 56) relaunches with `--focus <component>:r<resultsVersion>:reports` after generation; step 5's **verdict routing** additionally offers one-click report regeneration when the verdicted bundle has a report whose marker verdict now mismatches (decision 6). The researcher-only authority rule for `reportRequest` (step 5 preamble, line 25) is unchanged.

## 11. Build and docs

- **Template rebuild (release-critical):** the board serves the committed `skills/managing-research-plans/assets/board-template.html` (board.py:543), not the React source — every React change here requires `cd board && npm run build` (package.json:9 copies the Vite output into the template) and committing the rebuilt template, or nothing ships in any mode.
- `README.md:87` view count/list ("five views — six after a renewal" → six/seven, add Reports), `:89` Results/provenance description, `:105` Generate-report description (figures under findings, marker), `:80` command-table row.
- `QUICKSTART.md:54,72` view enumerations.
- `SKILL.md`: board row (line 91) gains Reports; report row (line 88) notes finding-grouped figures + marker; Results-bundles paragraph (line 42) names the report↔bundle 1:1 mapping.
- `CHANGELOG.md` `[Unreleased]` entry.

## 12. Testing

- **Python:** §3.1 strip test (annotation with every ACTION_KEY arrives with none); `collect_results` picks up `publishedReport` + `reportFormats` (and their absent shapes); `payload_files` includes the report; live `report_map` serves a PDF with `Content-Disposition: attachment` and 404s unknown keys; non-live payloads carry no routes/binaries; three-part `split_focus` (old two-part inputs keep working) across static/share/live callers; `meta.focus` stays the plain slug in share collection; FNV-1a `hashContent` parity against TS fixtures; pull-side staleness tag on a mismatched plan/report comment and passthrough on JSON-hashed types; `_VIEW_LABEL` renders a hosted `reports` doc-comment; e2e smoke via the tests' `make_project` helpers → `board.py --export` → assert `publishedReport` in the extracted payload JSON.
- **TS:** allFiles↔payload_files parity fixture includes a report; Reports view state matrix (render with basename-resolved images from a real-shaped `assets` record — no `as unknown as`; empty states with/without actions; orphaned pdf-without-md; both stale flags; marker-less legacy; malformed marker still renders body; marker identity mismatch warning; pre-renewal badge; downloads row per mode); marker stripped before render; image renderer never emits external URLs and preserves HTML escaping; lean-Results regression (validation first, no inline artifact grids, gallery intact, summary-only notice in finding mode); feedback emission + FeedbackPanel labeling for view `reports`; `targetHash` report branch ignores the marker line; Tracker/Archive/PlanReader navigation carries the bundle number; `focusView` initial-tab.
- **Mode matrix (integration):** live, focused share (`:reports`), export, Pages publish, hosted materialization + republish, remote collect, hosted pull — each asserts the report document and comment round-trip behave per mode.
- **Manual:** one walkthrough on a scratch project (`scripts/new-walkthrough.py`) covering capture-end offer → report → board Reports tab → comment → verdict → regen offer → pull.

## 13. Out of scope / risks

- No report immutability or append-only report history (bundle stays the immutable record — decision 3).
- No PDF embedding in share/hosted payloads (decision 4); collaborators there read the rendered markdown.
- `reportFormats` participates in no hash surface (§4) — download-availability changes never invalidate comments; accepted.
- `/report` is prompt-driven, not a deterministic generator: marker spelling and section structure depend on the agent following the command. Mitigation: the board tolerates absent/malformed markers (soft flags, §8) and the marker grammar is one JSON line — trivial to follow; a future round could move marker stamping into `results.py`.
- Result/script hosted comments keep passing `docHash` untagged through pull (JSON-serialization hashes aren't portable) — documented boundary of decision 7.
- The `publishedReport`/`report` naming distinction (published report vs capture note) must be kept consistent across Python dict keys, TS types, and prose — called out because the words are near-collisions.
- Payload growth is one markdown file per bundle (tens of KB, unenforced convention); figures add zero new weight (asset reuse).

## Revision history

- 2026-07-10 — initial draft from brainstorming session (5 locked decisions) + 3-agent code-anchor exploration (board.py / board React / commands+docs).
- 2026-07-10 — revised per Codex review (gpt-5.6-sol @ xhigh, grounded; saved as `docs/specs/2026-07-10-codex-review-reports-tab.md`): pre-existing reopen-strip + summary-only fixes pulled in as §3; template rebuild step; three-part focus + bundle-aware navigation; JSON marker stripped client-side before render; planless report shape; full UI state matrix; command ordering (log before board open, caller owns reopen); image-renderer safety contract + Content-Disposition; reportFormats hash exclusion documented; hosted pull docHash preservation + partial staleness tagging; mode-matrix tests. Researcher decisions 6-8 added (verdict loop = flag + one-click regen; pull staleness = minimal fix; archive links = in).
