# Changelog

## 0.6.3 (2026-07-06)

- **Reproducibility-first results capture**: when a component has runnable
  producing code, `/research-plans:results` regenerates the real
  figures/tables/numbers by re-running it and bundles those, instead of
  scavenging whatever files happen to be on disk. Recorded recipes auto-run
  without a prompt only when the script is repo-contained and its source hash
  matches the approved recipe; otherwise the command shows the exact command and
  asks. Runs are logged, use `pipefail`, and stop the capture on a non-zero exit
  or missing/stale expected outputs (design cross-model reviewed, Codex GPT-5.5).
- **Summary-only board notice**: a bundle with a report but no reproducible
  figures/tables now shows an explicit "summary only" notice on the board
  instead of a silently blank gallery. Fresh components with no code produce no
  bundle at all.
- **Broader discovery**: `results.py discover` scans more default output dirs
  (`plots`, `viz`, `visuals`, `graphics`) and takes a repeatable, repo-relative
  `--dir` for non-standard layouts (absolute / `..` / symlink escapes rejected).

## 0.6.2 (2026-07-06)

- **Board: select-to-comment everywhere** — the Plans gesture now works on the
  Tracker (component rows, RQs, context/sequencing prose), Timeline (individual
  event cards), and Reviews (threshold, rubric items, top revisions, split)
  views. Comments arrive labeled with the exact element ("row 3: …",
  "Decision 2026-07-06 16:24", "item G3: …").
- **Results uses the same gesture**: metric tiles and artifact cards no longer
  pop a `window.prompt` on click — drag-select there like everywhere else;
  comments keep their structured metric/artifact/report targets.
- **Scoped anchors**: highlights are anchored inside the stamped element
  (stable `data-annot-scope` ids), so short repeated strings can't repaint on
  the wrong row and timeline filtering can't corrupt or mis-flag comments
  (found in cross-model review, Codex GPT-5.5).
- Highlight styling applies outside rendered markdown (table cells, cards);
  sign-off gate "request changes" now sends the same client-assembled feedback
  document as every other path.

## 0.6.1 (2026-07-03)

- **Reconcile mode**: `/research-plans:results` with no argument walks the
  tracker for components that are done without a bundle (or whose verified
  sources have drifted, or with interrupted staging dirs) and backfills them
  one interview at a time — component-first, plan-Verification-anchored,
  never silent bulk capture.
- **`late: true`** manifest flag + "captured late" board chip for plan-governed
  work captured after the fact (the results analogue of the decision log's
  late-captured label); reports must state it. Adopt (`--adopt`) stays the
  route for work no plan governed.
- Mid-session capture guidance: candidate matching via plan-promised outputs,
  slug/number filename heuristics, and script git history when session
  context is thin.

## 0.6.0 (2026-07-03)

- **Results layer**: versioned, immutable result bundles per component
  (`plans/execution/<slug>/results/rN/` — report, figure/table snapshots with
  sha256 provenance, script snapshots, key metrics). Capture via
  `/research-plans:results` (or `--adopt` for pre-existing artifacts;
  `provenance: retrofit`), staging-then-atomic-rename via `results.py`.
- **Board: fifth view (Results)** — version strip with plan tags and verdict
  badges, verdict banner (Accept / Request changes), metric tiles, figure/table
  gallery (tables via a whitelist-sanitizing renderer), per-artifact
  "produced by" script drawer with line-anchored comments.
- **Verdicts are recorded acts, not gates**: accept/request-changes flows back
  as an action block; the session applies it (`results.py verdict`), logs it,
  and marks the tracker `done (verified)`. verdict.json is written once.
- Sign-off hook now also enforces bundle immutability (synchronous policy;
  never opens a browser; one-time verdict.json creation allowed).
- `/sync` offers capture when components hit done or sources drift;
  `/status` flags unverified done components and drifted verified results.
  Payload schemaVersion 2. Design doc: `docs/specs/2026-07-03-results-layer-design.md`.

## 0.5.0 (unreleased)

- **Remote plan review**: `/research-plans:board --share [component]` exports a self-contained, annotatable board file (`plans/board-share.html`, gitignored) to email to collaborators — no accounts, no hosting, browser-only. Collaborators annotate, enter their name, and download a `board-feedback-*.txt` file to send back; `/research-plans:board --collect <file>` routes it through the normal feedback pipeline with reviewer attribution and a staleness check (Python-side `shareHash`). Focused shares (`--focus`) embed only that component's plans plus the master plan (always visible by design). Remote gate approval is explicitly out of scope — sign-off stays local. Design doc: `docs/specs/2026-07-03-remote-plan-review-design.md`.

## 0.4.0 (2026-07-02)

- **Adds a PreToolUse hook** (the sign-off gate): writing a signed plan version (`plans/execution/<component>/vN.md`) in an initialized project now blocks until the researcher approves the rendered plan in their browser; requesting changes returns the feedback to Claude and the gate reopens. The hook also mechanically denies edits to, or overwrites of, existing signed versions. Scope: Claude's Write/Edit tools, dual-marker projects only. Bypass for headless work: `RESEARCH_PLANS_NO_GATE=1` (leaves a stderr trace). This is the plugin's first hook — review `hooks/hooks.json` and `skills/managing-research-plans/scripts/signoff_gate.py` before updating if that matters to you.
- Board gains a gate mode (Approve / Request changes; Approve disabled while unsent comments exist).
- plan/sync sign-off steps reframed around the gate; board preview during dialogue stays optional.

## 0.3.0 (2026-07-02)

- Research-question anchoring: numbered RQs in the master plan, a Serves column, components derived from the research design (repo scans set status only).
- Execution plans open with a constitutive "Goal and success criteria" section (with Serves line).
- Mid-session adoption made explicit: the session's history feeds the plan, never the log; `Initialized:` timestamp is the adoption cutoff.
- Rubric v0.2 ("What Counts as a Plan"): two-stage review — a 9-check pass/fail threshold with near-miss verdicts (PASS / UNDETERMINED / FAIL), then an 8-item engagement grade. Scorecards move to schemaVersion 2 with a threshold block.

## 0.2.0 (2026-07-02)

- The board: browser dashboard (tracker, plan reader with version diffs, decision timeline, review scorecards) with live text-anchored annotation feeding back into the session, and a static single-file export (`plans/board.html`).
- Unsigned drafts (`.draft-vN.md`, gitignored) enable pre-sign-off review; review can save scorecards.

## 0.1.0 (2026-07-02)

- Initial release: master plan with components tracker, versioned per-component execution plans (immutable, researcher-signed), append-only decision log, plan-quality rubric draft, split criteria, opt-in via dual markers, five commands and one ambient skill.
