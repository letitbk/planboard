# Friction log — walkthrough harness (component 01)

The running record of walkthrough friction: what using the plugin surfaced and what was done about it. One section per run, appended when a run's findings are compiled. Every finding carries a disposition: **fixed** (commit hash) or **deferred** (entry exists in `docs/ROADMAP.md`). (Originally created under a plans-workflow evaluation that BK retired on 2026-07-06; run entries below may reference its artifacts, which no longer exist in the repo.)

Entry template:

```markdown
## Run N — YYYY-MM-DD

Plugin commit: <hash> · Scratch project: wt-<timestamp>
Loop coverage: init · plan · analysis · sync · results · board  (strike what was not reached)

| # | Surface | Finding | Disposition |
|---|---------|---------|-------------|
| N.1 | <command/board view/gate/...> | <what broke or felt wrong> | fixed `<hash>` / deferred → ROADMAP |

Researcher ruling: <what BK decided about this run's findings, and whether the loop continues>
```

<!-- Runs go below, newest last. -->

## Run 0 (pre-harness) — 2026-07-06

Plugin commit: `88fc02d` · Scratch project: none — direct review of the plugin's own board Results surface, not a scaffolded loop run. Logged here because it is a genuine walkthrough finding and feeds components 2/3 the same way; the numbered scratch-project runs begin separately.
Loop coverage: ~~init~~ · ~~plan~~ · ~~analysis~~ · ~~sync~~ · results · board

| # | Surface | Finding | Disposition |
|---|---------|---------|-------------|
| 0.1 | Results view (board) + `/results` capture | The Results section shows only the report summary + metric tiles when a bundle has no artifact files — the gallery renders silently blank, so it reads as "a summary of what's been done" rather than the figures/tables. Root cause is **passive capture**: `/results` only bundles pre-existing output files that `discover` finds in a fixed set of dirs, so retrospective/backfill captures (and components whose outputs were never saved to disk) yield summary-only bundles. Reframed with BK into **reproducibility-first capture**: when a component has producing code, `/results` auto-runs it to regenerate the real figures/tables/numbers and captures those; summary-only is legitimate only for a fresh component with no code, where the board shows an actionable, retrospective-aware notice instead of a blank gallery. Also broadens `discover`'s scan dirs. | fix specced → `docs/specs/2026-07-06-results-regenerate-on-capture-design.md` (v0.6.3), cross-model reviewed (Codex), **built + verified** (Python 43/43, board tsc + vitest green, notice live-verified on the dev board); commit pending — `fixed <hash>` on commit |

Researcher ruling: BK confirmed the reframing — regenerate-on-capture, auto-run recorded producing scripts, trigger on presence of producing code, notice only for genuinely-empty bundles — and asked for the finding logged and the fix specced + run past Codex before any build. Build not yet started; the harness loop continues.

## Run 1 — 2026-07-06

Plugin commit: `f36bb03` at start, `d33f9f6` at close (v0.6.2 landed mid-run from a parallel session) · Scratch project: `wt-20260706-174113`
Loop coverage: init · plan · analysis · sync · ~~results~~ · ~~board~~ (stopped early — researcher interrupt: "it's been taking long time")
Mode: Claude-driven headless preflight (researcher-directed variation, decision log 17:40) — `claude -p` per stage, `RESEARCH_PLANS_NO_GATE=1` where needed. Interactive surfaces deliberately unexercised. Stage logs: `logs/2026-07-06_17-4*_run1-*.log`, `17-5*`.

| # | Surface | Finding | Disposition |
|---|---------|---------|-------------|
| 1.1 | `/research-plans:init` (headless) | Bare init in `-p` mode interviews into the void: AskUserQuestion falls back to plain text, the session prints four questions and exits — zero artifacts, no signal that nothing was created. A headless/scripted user hits a dead end unless they know to re-run with scope seeded in the command args plus "do not wait." Recovery worked (stage 1b: seeded init created everything first-try), but nothing documents it; NO_GATE gives the gate a headless story, the interviews have none. | pending ruling |
| 1.2 | Whole-loop ceremony | Each loop stage is its own multi-minute session; the five stages run here took ~15 min wall-clock even scripted, and the researcher interrupted before results/board. First adoption-cost data point for RQ3; also a harness-process finding — sequential foreground driving forces the researcher to watch. | pending ruling |
| 1.3 | Headless output noise | Every stage printed the same non-plugin distractions: superpowers napkin write denied on `.claude/` under acceptEdits, and the ANTHROPIC_API_KEY connectors warning. Not plugin-owned, but a headless-docs candidate ("expect these; they are harmless"). | pending ruling |
| 1.4 | Stages 1b–4 (positive) | Worked first-try with honest reporting: seeded init created all artifacts; plan ran bounded exploration (real missing-data counts), flagged its own interpretive call, logged in real time, gate bypass traced; execution matched the plan with 15/15 verification checks and evidence logs; sync was an accurate no-op that fabricated nothing and deferred what it couldn't confirm headless. | no fix needed |

Researcher ruling: pending — review presented 2026-07-06; results + board stages remain unexercised (candidates for run 2 or a targeted follow-up).

## Run 2 (plugin checkup — clean-room) — 2026-07-15

Plugin commit: `60eaede` (v0.18.0, installed from a local marketplace pinned to the snapshot worktree) · Scratch project: `scratchpad/cleanroom/proj` (empty temp dir) · Config: fresh `CLAUDE_CONFIG_DIR` (none of the author's setup), `--permission-mode dontAsk`, headless `claude -p`.
Loop coverage: **targeted** — isolation · install-lifecycle · init · ~~plan~~ · ~~analysis~~ · ~~sync~~ · ~~results~~ · ~~board~~ (the full 7-stage loop was deprioritized: Run 1 already showed the *seeded* loop works stage-by-stage; this run targets the new-user friction Run 1 flagged plus install + token data).

| # | Surface | Finding | Disposition |
|---|---------|---------|-------------|
| 2.1 | Isolation (fresh CLAUDE_CONFIG_DIR) | **Isolation works.** A fresh config strips ALL of the author's setup — no global `CLAUDE.md`, no user rules, no plugins, none of the custom skills (no superpowers/napkin/journal/plain-writing); only Claude Code built-ins remain. So the audit's "random user" baseline is real: a stranger sees none of the author's environment. | no fix — validates the clean-room method |
| 2.2 | Install lifecycle (INST) | **Clean.** `claude plugin marketplace add <local-worktree>` → `install research-plans@research-plans` → commands immediately available **with no restart in headless mode** → `update` is a clean no-op at the same version → `uninstall` removes it. Installed exactly `0.18.0 @ 60eaede`. (Note: interactive sessions still need a restart per the docs; headless `-p` reads the fresh config each launch, so it doesn't.) | no fix — install path is frictionless |
| 2.3 | `/research-plans:init` headless (POR-2 / S11) | **Dead-end CONFIRMED.** Headless `/init` reports "AskUserQuestion isn't available… I'll ask directly in text," asks the project-root + interview questions, and **exits creating no `plans/` dir at all** — zero artifacts, and no "nothing was created; re-run non-interactively with seeded args" signal. A scripted/walk-away user gets nothing. (The plugin is partially honest — it explains the missing tool — but doesn't surface the recovery path or create anything.) | **P1 → finding POR-2**; fix candidate: detect non-interactive + emit a clear no-artifacts-created message with the seeded-args recovery |
| 2.4 | Always-on token footprint | **Measured.** Paired plugin-on-vs-baseline (same trivial prompt, same-size fresh config): total system-prompt tokens 20,647 (plugin) vs 19,893 (baseline) = **~750-token delta** — the plugin's always-on cost per session, everywhere. About 40% above the bytes/4 static estimate (524), confirming that estimate is a floor. (Single paired run — caching split varies; order of magnitude is solid, an exact figure needs a few runs.) | measurement → anchors TOK-1 |

Researcher ruling: pending — clean-room confirmed the `/init` dead-end (POR-2) as a real new-user P1, validated isolation + a frictionless install path, and empirically anchored the always-on token cost at ~750/session. The full multi-stage loop was a deliberate skip (Run 1 covered the seeded happy path; diminishing returns vs. cost).
