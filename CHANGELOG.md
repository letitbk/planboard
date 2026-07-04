# Changelog

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
