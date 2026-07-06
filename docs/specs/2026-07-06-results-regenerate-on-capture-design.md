# Reproducibility-first results capture (regenerate-on-capture) — design

**Date:** 2026-07-06
**Target release:** v0.6.3 (after the in-flight v0.6.2 board doc-comments work; re-sequenceable)
**Status:** approved by BK (brainstorming session, 2026-07-06); revised same day
after cross-model review (Codex GPT-5.5) — amendments marked inline where they
changed the design

## Problem

The board's Results view renders exactly what a bundle contains: report, metric
tiles, then an artifact gallery (figures as `<img>`, tables via `SafeTable`).
When a bundle has **no artifact files**, the gallery grid
(`Results.tsx:374-462`) renders nothing and only the report + metrics remain, so
the section reads as "a summary of what's been done" rather than results. The
researcher hit exactly this and asked why Results shows a summary instead of the
figures/tables.

The cause is in **capture, not rendering**. `/results` captures *passively*: it
scans for pre-existing output files (`results.py cmd_discover`, over a fixed set
of directories — `output, outputs, figures, figs, tables, results, reports`) and
bundles whatever is found plus whatever the researcher names. So a bundle is
summary-only whenever the analysis outputs are not sitting on disk in a scanned
location. This is the common case for:

- **retrospective / backfill capture** (`--adopt`, reconcile, `late: true`) —
  the run happened earlier and its figures may never have been written to files;
- **outputs shown inline** (a notebook cell, an RStudio plot pane, `print()`ed
  tables) that were never saved;
- **figures saved to a non-standard directory** that `discover` does not scan.

The researcher's framing (2026-07-06): when a component **has producing code and
is being used mid-session, `/results` should re-run that code to reproduce the
figures / tables / numbers and display them on the board**. When a component is
**fresh — no code has been run** — an empty gallery is legitimate and expected,
and no bundle is created at all.

## Decisions (settled with the researcher)

1. **Reproducibility-first capture is the core change.** When a component has a
   runnable producing recipe (see below), `/results` regenerates the real
   outputs by running it, then captures the freshly produced
   figures/tables/numbers. Passive `discover` becomes the fallback and remains
   the path for `--adopt` (artifacts produced outside any plan, which by
   definition have no recipe to run).

2. **Trigger rule: presence of a runnable producing *recipe*, not just a script
   path.** (Codex amendment: `producedBy` today records a script but no cwd,
   args, or expected outputs, so "is there a script?" is not enough to decide
   "can we reproduce?".) If the component has a runnable recipe — identified from
   plan/session context, the latest bundle's manifest on a re-capture, or the
   researcher — → regenerate. If there is no recipe at all → regeneration is
   skipped. A **missing or unsupported recipe is prompt/stop, never silently
   treated as "no code"** (Codex amendment): the researcher is asked for the run
   command or told capture cannot reproduce, rather than the tool quietly
   producing a summary-only bundle.

3. **Run behavior: auto-run recorded recipes without a prompt — but only when the
   recipe is trusted.** (Codex amendment to the researcher's "auto-run, no
   approval" choice, accepted by BK 2026-07-06.) No-prompt auto-run applies only
   when the producing script is **repo-relative, path-normalized (resolved,
   inside the repo, no symlink escape), and its current source hash matches the
   recipe's recorded `approvedHash`**. Otherwise `/results` shows the exact
   command it would run and asks first. The interpreter is inferred from the
   script extension: `.R` → `Rscript`, `.py` → `python3` (fall back to
   `python`), `.sh` → `bash`. **Unsupported interpreters** (e.g. Stata `.do`) are
   treated as "no safe recipe" → prompt/stop, not silent summary-only (open
   question resolved, 2026-07-06). Never guess a producing script;
   `producedBy: null` still records honestly.

4. **Guardrails on auto-run.** Auto-running analysis code is a real,
   side-effecting action, so:
   - Auto-run is limited to the producing recipes of the component being
     captured; `/results` never runs unrelated code.
   - Every run is logged to
     `logs/YYYY-MM-DD_HH-MM-SS_results-regenerate-<slug>.log` (matches the
     researcher's global "reproducible evidence" rule; `logs/` is git-ignored).
   - Runs capture the real exit status: `set -o pipefail` (or an explicit status
     capture) so a `… | tee log` pipeline cannot mask a non-zero exit (Codex
     amendment).
   - A **run-start timestamp** is recorded before execution; each of the recipe's
     `expectedOutputs` must exist **and** be created/modified after run-start,
     else capture stops (Codex amendment — without this baseline a successful
     no-op run would bundle stale files). A non-zero exit likewise stops the
     capture with the run log cited. Capture never silently yields an empty or
     partial bundle.
   - Determinism and side-effect safety are the researcher's responsibility; this
     is the same assumption the component's reproducibility success criterion
     already makes.

5. **Board notice — for a retrospective bundle that has a report but no
   reproducible figures.** (Codex amendment + BK's ruling, 2026-07-06.) The
   notice's audience is a **finalized bundle that carries a report (and possibly
   metrics) but zero artifacts** — which arises on retrospective / `--adopt` /
   late capture where the figures could not be reproduced (no runnable recipe, or
   the source files are gone). A **fresh component with no code** produces **no
   bundle at all** and the board simply shows its existing top-level "No results
   captured yet" state — the notice is not for that case. When a finalized bundle
   has `manifest.artifacts.length === 0`, `Results.tsx` renders, in place of the
   empty gallery grid:

   > **Summary only** — No figures or tables in this bundle. The report and
   > metrics were captured, but the analysis outputs could not be reproduced
   > (common for retrospective captures, where outputs were never saved to
   > files). If a producing script exists, re-run it and capture again;
   > otherwise run `/results` and name the output file paths directly.

   (Copy softened from "re-run the producing script" per Codex nit — a producing
   script may not exist.) Only the `artifacts.length === 0` case gets this
   treatment; the oversized-stub and unresolved-file per-card states are
   unchanged.

6. **Broaden `discover`, with containment.** Widen the default `SCAN_DIRS` to an
   **exact** list (Codex nit — no vague "one level such as…"):
   `output, outputs, figures, figs, plots, viz, visuals, graphics, tables,
   results, reports`. Add an optional repeatable `--dir DIR` for project-specific
   layouts. `--dir` is **repo-relative only**: absolute paths, `..`, and symlink
   escapes are rejected after `resolve()` and checked against the repo root
   (Codex amendment — `cmd_discover` relies on `relative_to(root)` and `cmd_copy`
   accepts absolute paths without containment, so a naïve `--dir /tmp/out` would
   crash or later copy outside-repo files). The `plans/` exclusion, dot-dir skip,
   extension filter, `SKIP_DIRS` guard, and 200-item cap are unchanged.

## The run recipe

Regeneration needs more than a script path. `producedBy` is extended (additive;
older bundles simply lack the new fields and are treated as "no runnable recipe"
→ prompt/stop):

```jsonc
"producedBy": {
  "script": "02_clean.R",              // snapshot filename (existing)
  "sourcePath": "scripts/02_clean.R",  // repo-relative source (existing)
  "command": ["Rscript", "02_clean.R"],// inferred from extension; researcher-confirmable
  "cwd": "scripts",                    // repo-relative; default = repo root
  "args": [],                          // optional
  "expectedOutputs": ["figures/fig-support.svg"], // repo-relative; drives the freshness check
  "approvedHash": "<sha256 of sourcePath at approval>" // gates no-prompt auto-run (decision 3)
}
```

`command`, `cwd`, `args`, and `expectedOutputs` are the minimum needed to run the
recipe correctly and verify it produced fresh files; `approvedHash` is the trust
gate. This is deliberately small — no environment capture, no dependency graph
(YAGNI).

## Where each piece lives

The existing split is preserved: **`results.py` stays stdlib-pure mechanics with
no analysis side effects; the command (agent) orchestrates.** Regeneration is an
agent behavior in `commands/results.md`, not new code in `results.py` — the agent
runs the recipes via `Bash`, logs them, then proceeds into the existing stage →
copy → finalize path against the fresh files. `results.py` gains only the
`discover` changes (decision 6).

### `commands/results.md` (capture flow)

The flow gains a recipe step **before** discovery (Codex amendment — the current
interview runs *after* discovery, so when outputs were never generated, discovery
finds nothing to interview over and the recipe is never learned; regeneration
must come first):

1. **Identify the producing recipe(s)** for the component from plan Verification
   context, session context, the latest bundle's manifest on a re-capture, or by
   asking the researcher. Assemble the recipe set.
2. **If the set is non-empty:** for each recipe, resolve and containment-check the
   script, verify `approvedHash` (decision 3) — auto-run silently on a match,
   else show the command and ask. Record run-start, run from the recipe's `cwd`
   (default repo root) teeing to the run log with `pipefail` (decision 4). On
   non-zero exit or any `expectedOutput` missing/not-fresh, stop and report. Then
   run `discover` (broadened) and proceed. Key numbers surfaced as `metrics` are
   read from the fresh run output / regenerated tables and **remain
   researcher-confirmed** (open question resolved — source-linking metrics to
   logs is a later enhancement).
3. **If the set is empty (no recipe):** no regeneration. This splits by mode:
   - **initial/planned capture of a fresh component** → nothing to reproduce and
     nothing on disk → **report and stop without creating a bundle** (the
     existing "zero qualifying artifacts" rule at `commands/results.md:13`
     stands); the board shows its top-level empty state.
   - **retrospective / `--adopt` / reconcile** where the researcher has a report
     to record but figures cannot be reproduced → finalizing a **report-only
     bundle is allowed but requires explicit researcher confirmation** (Codex
     amendment — today `commands/results.md:13,30` say "report and stop" / "never
     an empty bundle"; those rules are rewritten to carve out this confirmed
     case). This is the bundle the decision-5 notice explains.
4. `--adopt` still captures pre-existing, outside-a-plan artifacts by discovery,
   never regenerated.

`allowed-tools` widens from `Bash(python3:*), Bash(git:*), Bash(ls:*),
Bash(date:*)` to also permit the interpreters and run logging:
`Bash(python:*), Bash(Rscript:*), Bash(bash:*), Bash(tee:*), Bash(mkdir:*)`.
The `late`/session-context labeling rules are unchanged: a capture that *did*
regenerate this session is not `late`; a retrospective bundle that reused old
files (or is report-only) stays `late: true`.

### `results.py` (discover only)

- Extend default `SCAN_DIRS` to the exact list in decision 6.
- Add `discover --dir DIR` (repeatable), **repo-relative only** with the
  containment checks in decision 6; scanned roots are the defaults plus the
  validated extras.
- No change to the extension filter, `plans/` exclusion, dot-dir skip, or the
  200-item cap. (`cmd_copy`'s absolute-path handling is left as-is; `--dir`
  containment is enforced at discover, and copy sources still come from
  discover/interview output.)

### `board/src/views/Results.tsx` (notice render)

- Replace the artifact-gallery block so that when `m && m.artifacts.length === 0`
  it renders the decision-5 notice using the existing `Notice`-style box, instead
  of an empty `grid`. When `m.artifacts.length > 0`, the gallery is exactly as
  today.
- Purely client-side: `manifest.artifacts` is already in the payload, so no
  `board.py`, payload-schema, or share/export change.

## Out of scope

- The oversized-stub and unresolved-file per-card states (researcher's Q3: only
  `artifacts.length === 0`).
- Interpreters beyond R / Python / shell — unsupported code is prompt/stop
  (decision 3), not built out now.
- Environment/dependency capture in the recipe; drift detection by diffing
  regenerated outputs against a prior bundle's recorded `sha256` (YAGNI).
- Making `results.py` validation *require* `metrics` — it is board-assumed
  (`Results.tsx:307`, `m.metrics.length`) but optional in the mechanics; a
  pre-existing gap, flagged, left untouched here.
- `verdict` flow, payload schema, `board.py`, adopt-mode's passive discovery.

## Testing

- **Python (`tests/test_results.py`):** broadened `SCAN_DIRS` finds outputs in a
  new-default dir (`plots/`, `viz/`); `discover --dir sub` picks up an extra
  repo-relative root; `--dir /abs`, `--dir ../escape`, and a symlink-escape
  `--dir` are all rejected; `plans/` and dot-dirs still excluded.
- **Board (`board/` vitest + manual on `dev-data.ts`):** add a report-only
  (zero-artifact) fixture bundle → Results renders the "Summary only" notice, not
  a blank gallery; a normal bundle still renders figures/tables; `npm run build`
  regenerates `skills/managing-research-plans/assets/board-template.html`.
- **Manual capture loop:** (a) mid-session component with an `.R`/`.py` recipe
  whose source hash matches → `/results` auto-runs it silently, the run is
  logged, regenerated figures appear on the board; (b) the same recipe after the
  source changed (hash mismatch) → `/results` shows the command and asks; (c) a
  recipe that exits non-zero, or whose `expectedOutputs` are not freshly created
  → capture stops with the run log cited, no bundle; (d) fresh component, no
  recipe → report-and-stop, no bundle, board shows the top-level empty state; (e)
  retrospective capture, report but no reproducible figures → confirmed
  report-only bundle, board shows the notice.
- **Regression:** `python3 -m pytest tests/` and the board vitest suite green;
  CHANGELOG and version bump to v0.6.3.
