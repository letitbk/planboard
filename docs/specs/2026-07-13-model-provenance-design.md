# Model provenance + up-front model choice — design (codex-reviewed)

## Context

Extends the board Models tab:
- **R1** — ask up front which models to use (recommended defaults vs. customize), at `/research-plans:init` and in the board Models empty-state.
- **R2** — record and show, per part (plans, results, reports, plan-review + results-validation scorecards), **prescribed** (from the profile) and **reported** (best-effort, self-attested — never claimed as proven) model/effort.

All in `worktree-models-tab`. This spec incorporates the codex review (`scratchpad/codex_provenance_spec.md`): "actual" is unprovable, so it is renamed **reported**; results record the **capture** session, not the executor; the board-reviewer panel and a Tracker column are **deferred**.

## R2 — data model

```
modelUsage: {
  prescribed: { model: string, effort: string | null } | null,  // from model-profile.md at capture
  reported:   { model: string, effort: string | null } | null,  // session self-attest / agent pin; NOT proven
}
```
- **prescribed** — read from `plans/model-profile.md` for the artifact's governing stage (`models.py stage <key>`). `inherit` = no concrete prescription. Reliable.
- **reported** — best-effort, self-attested by the capturing session (its model id is in the environment) or the dispatched agent's pinned `model:`. `reported.effort` is usually `null` (reasoning effort isn't introspectable). Always displayed with a "reported" framing — never presented as verified runtime truth.
- Both optional; either may be `null`. Old artifacts have neither → **no chip**.

Governing stage per artifact: plan versions → `plan`; result bundles → `execute` (chip labeled **"captured by"** for the reported side); reports → none (reported only); plan-review scorecard → `plan-review`; results-validation block → `results-validation`.

## R2 — capture points

| Part | prescribed stage | Storage | Writers |
|---|---|---|---|
| Plan version | `plan` | `<!-- rp-model {json} -->` marker as the **first line of `.draft-vN.md`, written before preview/sign-off**, carried **unchanged** into `vN.md` and `vN-draft-K.md` | `plan.md`, `sync.md`, `adopt.md`, `board.md` |
| Result bundle | `execute` | `modelUsage` in `manifest.json` (reported = capture session) | `results.py finalize --reported-model <id>` (called by `results.md`) |
| Report | — | `modelUsage` in the `rp-report` marker JSON | `report.md` |
| plan-review scorecard | `plan-review` | `modelUsage` in the scorecard JSON | `review.md` (named agent's pin, or session on inline fallback) |
| results-validation | `results-validation` | `modelUsage` in the `ValidationBlock` | results validator (agent pin, or session on anonymous/skip → reported null) |

Rules from the review:
- The plan marker MUST exist in `.draft-vN.md` before the sign-off gate hashes it (the gate normalizes the draft and only strips the sign-off trailer; injecting the marker after approval breaks the ticket or writes unapproved bytes). So plan authoring writes the marker as it writes the draft.
- A plan version's `prescribed` is always the `plan` row (it's a plan artifact), regardless of whether `plan.md`/`sync.md`/`adopt.md`/`board.md` authored it; `reported` is that authoring session.
- Named-agent absent / inline fallback / skipped → `reported` = session model or `null`; never fabricate a pinned value.
- **Deferred**: board-reviewer panel provenance (its output is seeds/comments, not a scorecard) and a Tracker column.

## R2 — parsing (client-side, matching today's split)

- `board.py` keeps passing raw plan/review/report bytes and already parses `manifest.json` — so `manifest.modelUsage` flows through automatically; the others parse in the browser.
- Add `parsePlanModelMarker(raw)` in `board/src/lib/`: extracts + **strips** a leading `<!-- rp-model ... -->` line even when its JSON is invalid (so a malformed marker can never hide the plan body, mirroring `reportMarker.ts`), returns `modelUsage | null`.
- Extend `parseReport` + `ReportMarker` (they currently rebuild an object with only known fields → would drop `modelUsage`).
- Extend `Scorecard` + `ValidationBlock` types + their parsers.
- Every consumer takes `modelUsage` through a runtime guard (`isModelUsage`) so hand-edited artifacts can't crash a surface.

## R2 — display

A shared `ModelChip` renders `modelUsage`:
- prescribed present → `opus·max`; when `reported.model` is present and **not alias-equivalent** to prescribed → append `· reported sonnet` (alias/`claude-*` equivalence, `inherit` = no prescription so always show reported).
- results bundles → `captured by <reported.model>` framing.
- reported present, prescribed null (reports) → `reported <model>`.
- effort: show prescribed effort; if only reported model is known, show `effort unknown`.
- Old artifact (no `modelUsage`) → **omit the chip**. New artifact with prescribed but no reported → show prescribed + "reported: unavailable".
- Surfaces: `PlanReader` (per version), `Results` (per bundle), `Reports` (per report), `Scorecard` (per review + validation).

## R1 — up-front model choice

- **`/research-plans:init`**: ask "recommended defaults or customize?" **before** writing `model-profile.md` and generating agents (init currently writes then generates — asking after would double-write/regenerate). On customize, walk the six stages (reuse `/research-plans:models` step 2), then write once and generate once.
- **Board empty-state**: replace the lone "Create from defaults" with **Use recommended defaults** (POST `create:true`) and **Choose your models** (create from defaults, then drop into the editable table to adjust + Save). Reuses existing create/edit paths.

## Backward compatibility

Forward-only. Provenance is stamped at initial artifact creation, never injected later (retrofitting would stale plan/result comments and change `shareHash`/`payloadHash`). Report marker-only changes already don't stale report comments (their doc hash strips the `rp-report` line); add a test to confirm `modelUsage` preserves that. All new fields optional.

## Files

- **commands**: `init.md` (R1), `plan.md`, `sync.md`, `adopt.md`, `board.md`, `results.md`, `report.md`, `review.md`
- **scripts**: `results.py` (`finalize --reported-model`, manifest `modelUsage`), `board.py` (no marker parsing — stays client-side; manifest passthrough already works)
- **board**: `types.ts`, `lib/planModelMarker.ts` (+ guard), extend `lib/reportMarker.ts` + `Scorecard`/`ValidationBlock` parsers, `components/ModelChip.tsx`, `PlanReader`, `Results`, `Reports`, `Scorecard`, Models empty-state; rebuild `assets/board-template.html` (`npm run build`)
- **tests**: `tests/test_results.py`, `tests/test_board.py`, board vitest

## Sequencing (within this branch)

1. **R1** — init interview + board empty-state (small, self-contained).
2. **R2 capture** — plan-marker stamping (plan/sync/adopt/board) before sign-off; `results.py finalize --reported-model`; report/review/validation stamping.
3. **R2 display** — `parsePlanModelMarker` + guard, extend report/scorecard parsers, `ModelChip`, four surfaces, template rebuild.

Each step ships with tests; `/codex` on the diff before merge.
