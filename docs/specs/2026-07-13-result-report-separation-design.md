# Result / Report separation — design

Date: 2026-07-13 · Branch: `worktree-result-report-clarity` · Status: proposed (pre-implementation)

## Motivation

Two board bugs plus one conceptual muddle, reported together by the researcher:

1. **Diff view does not wrap.** In a plan's version diff, each changed line renders on one physical line that overflows the box, forcing horizontal scroll to read it.
2. **No Report column in the tracker.** The tracker shows a report affordance only as an inline `report` chip crammed into the Results column; the researcher asked for a first-class Report column.
3. **Result and Report tabs are not clearly distinguished.** They overlap (both show findings, validation, provenance), so the split reads as arbitrary. The researcher wants a crisp separation, with the Result tab carrying an always-present validation result and the Report tab being the comprehensive, shareable narrative — and an honest null-result behavior when there is nothing to report.

## Decisions (locked with the researcher)

- **Validation coverage:** every bundle gets an automatic, mechanical **integrity** check at capture; planned bundles additionally keep the existing plan-conformance agent. Retrofit bundles that used to read `not-applicable` now carry a real `integrity: passed`.
- **Tab split by purpose:** the **Result** tab is the reviewer surface — "did it check out?" — showing validation, metric tiles, the evidence gallery, and provenance, and **no prose**. The **Report** tab is the only home for the narrative — "what's the story?" — the comprehensive standalone document.
- **Null-result honesty:** when a bundle has **no substantive findings**, `/report` generates no file, and the Report tab and tracker column say so rather than inviting a generation that would produce an empty narrative.
- **Substantive-finding rule:** a metric is substantive when its `status` is `robust` or `marginal`, **or** it carries a `statement` (a claim sentence) whose `status` is not one of `descriptive`, `retracted`, `superseded`. Descriptive-only counts are not findings. This one rule drives both the report gate and the integrity "unsourced headline number" check.
- **Result-tab prose:** the Result tab drops the bundle's capture-note markdown entirely. Its content already flows into the Report's Data-and-methods section, so nothing is lost; the Result tab shows only structured evidence and validation.
- **Data model:** integrity is computed mechanically and **sealed into the immutable `manifest.integrity`** at finalize (so it flows to reports and exports); bundles finalized before this feature show "not recorded."

## The substantive-finding rule (shared contract)

Implemented twice and kept in sync (per the repo's Python/TypeScript duplication rule):

- Python: `is_substantive(metric)` / `has_substantive_findings(manifest)` in `results.py`.
- TypeScript: `isSubstantive(metric)` / `hasSubstantiveFindings(bundle)` in `board/src/lib/findings.ts`.

```
substantive(metric) :=
  metric.status in {robust, marginal}
  OR (metric.statement is nonempty
      AND metric.status not in {descriptive, retracted, superseded})
```

`status` may be absent; an absent status with a nonempty `statement` is substantive (a written claim counts), while a bare label/value with no statement and no robust/marginal status is not.

## Integrity block

New immutable manifest field, computed at finalize after `validate_staged` passes:

```jsonc
manifest.integrity = {
  "status": "passed" | "failed",        // failed if any check fails
  "checkedAt": "YYYY-MM-DD HH:MM",
  "checks": [
    { "name": "checksums",        "verdict": "pass" | "fail", "detail": "..." },
    { "name": "artifacts-present","verdict": "pass" | "fail", "detail": "..." },
    { "name": "artifact-refs",    "verdict": "pass" | "fail", "detail": "..." },
    { "name": "findings-sourced", "verdict": "pass" | "fail", "detail": "..." }
  ]
}
```

Checks map to the researcher's four:

- `checksums` — each artifact copy's sha256 matches its recorded source hash. Already hard-enforced by `validate_staged`, so it is `pass` by construction at finalize; recorded for transparency.
- `artifacts-present` — every non-oversized artifact with a `file` exists in the bundle. Also already hard-enforced; recorded.
- `artifact-refs` — every metric `artifactIds` entry references a real artifact id. Already hard-enforced; recorded.
- `findings-sourced` — **new, advisory.** Every substantive finding must name at least one `artifactId`. A substantive finding with no artifact is flagged (`fail`) with the offending labels in `detail`. This is the "no headline number without a source" check.

Integrity is **advisory**: a `failed` integrity never blocks finalize (consistent with the existing validation philosophy). The remedy for a `findings-sourced` failure is to attach an artifact or demote the metric's status to `descriptive` — both surfaced to the researcher. The board shows integrity prominently on the Result tab; a `failed` block is expanded by default.

`validate_staged` is extended to accept an `integrity` block when present (status enum, checks well-formed) so re-validation of a sealed manifest passes.

## Board changes

**Tracker (`Tracker.tsx`).** Add a dedicated **Report** column between Results and Outcome. Cell logic:

- a report exists on some bundle → `report` link targeting the latest bundle that has one (the current chip behavior, moved);
- else the latest bundle has results but no substantive findings → muted `no result` (honest null marker);
- else → `—`.

The inline `report` chip is removed from the Results column, which returns to just the `rN ✓/✕/●` link.

**Result tab (`Results.tsx`).**

- Validation area at the top now always renders: an **integrity** row (status chip + failed-check details) plus, when present, the existing plan-conformance `ValidationSection`. Pre-integrity bundles show "integrity — not recorded (captured before integrity checks)".
- The capture-note section (`bundle.report` markdown) is removed. Comment routing keeps its `report` fallback kind for safety but no longer has a report surface to paint.

**Report tab (`Reports.tsx`).** The no-report empty-state branches on the substantive-finding rule:

- bundle has substantive findings but no report → existing "No report generated yet" + Generate button;
- bundle has no substantive findings → "No report — this bundle has no substantive findings to report" with no Generate button.

## Command changes

**`commands/results.md`.** Step 6 gains the integrity check as an always-run mechanical pass (documented as advisory, sealed into the manifest) distinct from the planned-only plan-conformance agent. Step 7's report offer is gated: skip the offer when the bundle has no substantive findings.

**`commands/report.md`.** Before writing, if the bundle has no substantive findings, generate nothing and report why (the null-result rule), then stop. Document the rule so a standalone `/report` behaves the same as the results-chained and board-button paths.

## Out of scope

- No change to the verdict/sign-off machinery, hosted sharing, or the immutable-bundle guarantees.
- No retroactive integrity computation for old bundles (forward-only, as `validation` was introduced).
- No new agent: integrity is purely mechanical.

## Test plan

- `DiffView` wrap: a rendered long line's container carries the wrapping class; no `overflow` reliance for reading.
- Tracker: a Report column header exists; the report link targets the latest bundle with a report; `no result` shows for a substantive-less latest bundle; `—` otherwise.
- `findings.ts`: rule truth table (robust, marginal, descriptive, retracted, superseded, statement-without-status, bare metric).
- `results.py`: `compute_integrity` verdicts (all-pass; unsourced substantive finding → `findings-sourced` fail, status failed); `validate_staged` accepts a sealed integrity block; finalize seals it.
- Results tab: integrity renders at top; no capture-note prose; not-recorded fallback.
- Reports tab: null-result empty-state vs generate-able empty-state.
- Full board vitest + python pytest green; single-file template rebuilt.
