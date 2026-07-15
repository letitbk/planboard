# research-plans — reference

Complete technical reference. For what the plugin is and why you'd use it, start with the [README](../README.md).

- [Commands](#commands)
- [The board](#the-board)
- [Share the board privately (Vercel)](#share-the-board-privately-vercel)
- [Results](#results)
- [Model profiles](#model-profiles)
- [The sign-off gate](#the-sign-off-gate)
- [What it creates in your project](#what-it-creates-in-your-project)
- [Install, updating, and pinning](#install-updating-and-pinning)
- [Developing the board](#developing-the-board)

## Commands

| Command | What it does |
|---------|--------------|
| `/research-plans:init` | Opt a project in. Interview, seed the components list, create the artifacts. |
| `/research-plans:adopt` | Retrospectively decompose already-done work into components, each with a full retrospective plan (reviewed in one board batch); reconstruct pre-adoption history. |
| `/research-plans:renew` | Change the project's direction: archive the master plan, write a fresh one over the existing work. Numbering continues, carried components keep their plans and results, the rest stay browsable in the archive. Preferred over adopt when starting the workflow in an exploratory repo you want to take somewhere new. |
| `/research-plans:plan` | Scope the next component and co-author its execution plan. |
| `/research-plans:sync` | Post-execution checkpoint. Update the tracker, catch unlogged decisions, version the plan if execution deviated. |
| `/research-plans:review` | Score the plan against the five-channel rubric (goal & success, decisions & reasons, steps, validation, boundaries; 0–3 each). Reports a profile, the biggest leak, and the forks to fix — a diagnosis, not a pass/fail. Includes a split assessment. |
| `/research-plans:models` | View or edit the per-stage model profile; regenerates the project's `rp-*` review agents. |
| `/research-plans:results` | Capture a versioned results bundle for a component — brief report, figure/table snapshots, key numbers, script snapshots, and an automatic plan-vs-execution validation. `--adopt` brings pre-existing artifacts under verification. |
| `/research-plans:report` | Generate a shareable report for a bundle (markdown always; PDF/DOCX via pandoc) into `plans/reports/` — also available as the board's Generate report button; offered automatically at capture end. |
| `/research-plans:board` | Open the board: a browser dashboard over everything, with drift flags, live annotation, a shareable snapshot, or `--publish-web` to a private, password-protected link for collaborators. |

Everything is opt-in. The plugin does nothing in projects you have not initialized.

## The board

The board renders the whole project in your browser, in six views — seven after a renewal:

- **Tracker** — components as a status board, with drift flags, per-row results badges, and a separate report column.
- **Plan reader** — any version of any plan, with each version's five-channel score in the header (hover a chip for the evidence, click for the full diagnosis), v1→v2 diffs (wrapped to the pane), and the reason each revision was made. The plan reads as one narrative; a project-set detail level controls how much shows by default, and low-level agent detail collapses inline.
- **Results** — the reviewing surface (see [Results](#results) below): validation first, then a mechanical integrity check, compact claim tiles, a figure/table gallery, and a per-artifact "produced by" script drawer with line-anchored comments. A provenance flow diagram maps each producing script to its artifacts — click a script to read the snapshot line by line (and comment on lines), click an artifact to zoom or jump to its card.
- **Reports** — renders each bundle's generated report, figures in context, with `rN · plan vN` version chips, stale-report flags, and PDF/DOCX downloads on the local board.
- **Timeline** — decisions, plan versions, results captures, verdicts, and review scores in one stream.
- **Models** — the per-stage [model profile](#model-profiles): read-only in every mode, and editable inline when the board is served live from your project (see below).
- **Archive** — after a renewal, renders each archived master plan as it was, its component rows still linking to their plans and results. Pre-renewal components carry a quiet badge everywhere instead of drift flags.

Each plan version, results bundle, report, and review also carries a small model-provenance chip — which model it used, both *prescribed* (from the profile) and *reported* (self-attested by the session, shown honestly as reported, never as verified runtime truth).

The board follows your OS light/dark preference, with a header toggle to override it (exports and shares carry the toggle too).

### Two modes

**Live** — `/research-plans:board` starts a small local server (`python3` only, nothing to install) on a stable per-project port. Bookmark the URL; it stays valid for the whole session. The live board is a control surface: your feedback panel docks side by side with the content, and approve / request-changes / review buttons are always on hand in the Tracker, Plan, and Results views. Select text to attach a comment, act on a plan, or press "Send to Claude" — your session applies each action and the board refreshes itself with the updated state. After an idle hour it goes to sleep; `/research-plans:board` wakes it at the same URL.

Or let an agent do the reviewing: the **Review with** button on any plan version, the master plan, or a results bundle runs Codex, Gemini, a Claude subagent, or a three-lens subagent panel and seeds its section-anchored comments onto the board — attributed to the reviewer — for you to curate before they route the same way.

**Snapshot** — `/research-plans:board --export` writes a single self-contained `plans/board.html` that anyone can open without Claude Code or an internet connection (figures are inlined). Snapshots are read-only. Treat the file like publishing your plans: it contains everything under `plans/`, including result figures, tables, and script snapshots.

### Share with collaborators (offline file)

`/research-plans:board --share` exports an annotatable board file you can email. Collaborators comment in their browser and send back a feedback file that `/research-plans:board --collect <file>` routes into your session with attribution and a stale-hash warning if the board moved on.

## Share the board privately (Vercel)

For collaborators who only have a browser, `/research-plans:board --publish-web` publishes the full board to a private, password-protected URL on Vercel: they read it and comment from their own browser, and their comments flow back into your session on request. One-time setup takes about 20 minutes and needs Node.js in addition to `python3`; every publish after that is one click. The full walkthrough, including a copy-paste collaborator invitation you can send as-is, lives in [`docs/hosting-the-board.md`](hosting-the-board.md).

**If you used the old GitHub Pages publish:** earlier versions used `/research-plans:board --publish` to push the board to a public GitHub Pages URL with no password and no access control — anyone who found the link could read it, indefinitely. If that applies to you, take it down: delete the `gh-pages` branch (`git push origin --delete gh-pages`), or disable it in the repo's Settings → Pages (set Source to None). Deleting the branch is the more complete cleanup; a disabled-but-present `gh-pages` branch can be quietly re-enabled by anyone with repo-settings access.

## Results

Plans say what the work will do; results bundles show what it did. `/research-plans:results` captures a **versioned, immutable bundle** per component at `plans/execution/<component>/results/rN/`: a brief agent-drafted report, snapshot copies of the figures and tables (sha256-verified against their sources; files over 5 MB are recorded by path + checksum instead of copied), the exact scripts that produced them, and the key numbers as metric tiles. Capture goes through a staging directory and an atomic rename, so a bundle either exists complete and validated or not at all. Re-running an analysis can never silently change what you verified — a redo is the next `rN`.

Bundles are journal-first: the project's CLAUDE.md carries output conventions with a target journal, so analysis deliverables are journal-ready figures (vector PDF + PNG) and typeset tables (a `.png` render with its `.tex` source and estimates CSV attached) — a CSV is click-to-open data, never dumped inline on the board. Every planned capture also runs an automatic **validation**: an independent subagent compares the signed plan against the staged scripts, artifacts, and decision log, and its per-step verdict (conforms / conforms-with-amendments / deviations-found) is sealed into the bundle and rendered on the board. Capture also seals a mechanical **integrity check** into the manifest — artifact checksums match, references resolve, and every substantive finding is sourced to an artifact. Both are advisory, never a gate — an unrecorded deviation is flagged, and the remedy is a plan revision.

On the board's Results view you review a bundle — its validation audit, integrity check, stat tiles, figure/table gallery, and a per-artifact "produced by" script drawer with line-anchored comments — and issue a **verdict**: Accept, or Request changes with comments. The narrative report lives on the separate **Reports** view; a **Generate report** button (also offered by `/research-plans:results` at capture end) assembles the bundle into a standalone shareable report (markdown plus PDF/DOCX via pandoc) under `plans/reports/`, with each figure embedded under the finding it supports and a first-line marker the board uses to flag stale reports. A bundle with no substantive findings gets no report — `/research-plans:report` refuses, and the board shows a null-result state instead of an empty document. The verdict flows back to your session, which records it (`verdict.json`, written once), logs it in the decision log, and marks the tracker `done (verified)` on accept. On request-changes, your comments drive script fixes and a re-run, captured as the next bundle. Verdicts are recorded acts, not gates: nothing blocks the tracker on unverified results, but the Tracker flags them.

**Adopting the workflow mid-project?** `/research-plans:results --adopt` scans your output folders, lets you pick which existing figures/tables matter, and files them as bundles marked `retrofit` — honest that no plan governed their production, reviewable and verifiable all the same.

**Plans ran ahead of your results record?** `/research-plans:results` with **no argument** is reconcile mode: it walks the tracker for components that are done but bundle-less (or whose verified sources have drifted), and backfills them one interview at a time. Work that a signed plan governed but was captured after the fact is marked `late` — the same honesty rule as the decision log's late-captured entries: backfilling is fine, unlabeled backfilling is not.

## Model profiles

Different stages deserve different models: planning is where quality compounds (strongest model, max effort), execution is interactive and iterative (a fast cheap model stretches subscription quota), and review or validation are short judgment tasks where a smarter prior beats longer thinking. `/research-plans:init` asks whether to use the recommended per-stage defaults or choose your own, then writes a per-project profile at `plans/model-profile.md` (committed). You can edit it later with `/research-plans:models`, or inline on the board's **Models** tab when it's served live — the board rewrites `plans/model-profile.md` and regenerates the `rp-*` review agents itself (nudge-stage edits apply immediately; agent-stage edits are flagged for a session restart).

Two mechanisms, named in the profile's mechanism column:

- **nudge** — interactive stages (`/plan`, `/sync`, execution) print one line when your session model differs from the profile's, suggesting `/model <model>` (switching mid-conversation is safe — nothing is lost); you decide.
- **agent** — delegated stages (plan review, results validation, the board's subagent reviews) run in generated project agents at `.claude/agents/rp-*.md` (committed, ownership-marked: `/models` never overwrites a same-named agent you wrote yourself), whose frontmatter pins the profile's model and effort. The pin is a request, not a guarantee — an organization model allowlist, `CLAUDE_CODE_SUBAGENT_MODEL`, or a per-invocation override supersedes it silently.

Projects without a profile behave exactly as before. Model profiles need a current Claude Code (verified on Claude Code 2.1.206) for agent `effort:` frontmatter — older builds run the agents on their default model resolution and ignore the effort request.

## The sign-off gate

Signing a plan is enforced, not offered. The plugin ships a PreToolUse hook: whenever Claude tries to write a signed version file (`plans/execution/<component>/vN.md`) in an initialized project, the write is blocked while the proposed plan opens in your browser — rendered, with the diff against the previous version. You either approve (the version is written exactly as shown) or request changes with comments (the write is denied, your feedback goes back to Claude, and the gate reopens on the next attempt). The same hook mechanically enforces immutability: edits to or overwrites of an existing signed version are always denied.

**Scope and honesty:** the gate covers Claude's file tools (Write and Edit). Shell redirection is not interceptable; the immutability convention and the review's revisability check cover after-the-fact edits. The gate only ever activates in projects that opted in (both markers present). For headless or CI work, set `RESEARCH_PLANS_NO_GATE=1` — the bypass leaves a visible trace in the transcript. The wait ceiling is 25 minutes (`RESEARCH_PLANS_GATE_TIMEOUT`, clamped); an unanswered gate denies safely.

The same hook also enforces **results-bundle immutability**: writes inside an existing `results/rN/` are denied (the one exception is one-time creation of `verdict.json`). This branch is pure file policy — it never opens a browser, so results capture can't deadlock on it. There is deliberately no verdict gate.

## What it creates in your project

```
plans/
├── master-plan.md              roadmap + components tracker
├── decision-log.md             append-only, timestamped
├── board.html                  optional shareable snapshot (regenerate, never edit)
├── archive/
│   └── master-plan-<date>.md   archived by /renew; immutable renewal record
├── reports/
│   └── 02-analysis-r1-report.md (+ .pdf/.docx)   shareable, regeneratable
├── reviews/
│   └── 02-analysis-v1.md       saved rubric scorecards
└── execution/
    └── 01-data-cleaning/
        ├── v1.md               the signed plan
        ├── v2.md               a revision; v1 is never edited
        └── results/
            ├── r1/             an immutable results bundle
            │   ├── manifest.json   what's here, plan version, provenance, metrics, validation
            │   ├── report.md       brief agent-drafted report
            │   ├── validation.md   plan-vs-execution audit (independent subagent)
            │   ├── verdict.json    your accept/request-changes, written once
            │   ├── artifacts/      figure/table snapshots (sha256-verified)
            │   └── scripts/        the code that produced them
            └── r2/             a redo; r1 is never edited
```

Plus a short marked section in your project's `CLAUDE.md` so every future session follows the conventions. Unsigned working drafts (`.draft-vN.md`), results staging directories (`.staging-*`), and board bookkeeping files are gitignored automatically.

## Install, updating, and pinning

### Install

In Claude Code:

```
/plugin marketplace add letitbk/research-plans
/plugin install research-plans@research-plans
```

Then restart Claude Code. See [QUICKSTART.md](../QUICKSTART.md) for a walkthrough.

### Updating

When a new version ships, a one-time notice appears at session start naming the exact command. To update:

```
/plugin update research-plans@research-plans
/reload-plugins
```

(then restart Claude Code if a component doesn't pick up).

To update automatically instead, enable auto-update once: open `/plugin`, go to **Marketplaces**, select **research-plans**, and turn on auto-update. Claude Code then updates the plugin at startup and prompts you to run `/reload-plugins`.

To silence the update notice (e.g. on an intentionally pinned install), set `RESEARCH_PLANS_NO_UPDATE_CHECK=1` in the `env` block of `~/.claude/settings.json` (not `.zshrc` — a hook launched by Claude Code may not source your shell profile):

```
{ "env": { "RESEARCH_PLANS_NO_UPDATE_CHECK": "1" } }
```

### Installing a specific version

Every release is a git tag (`v0.1.0` … `v0.18.0`). To pin an older version, add a local marketplace file whose entry pins the tag, then install from it.

Create `rp-pinned/.claude-plugin/marketplace.json`:

```
{
  "name": "research-plans-pinned",
  "plugins": [
    {
      "name": "research-plans",
      "source": { "source": "github", "repo": "letitbk/research-plans", "ref": "v0.9.0" }
    }
  ]
}
```

Then:

```
/plugin marketplace add ./rp-pinned
/plugin install research-plans@research-plans-pinned
```

If your Claude Code build prefers it, the equivalent fallback is to check out the tag locally (`git checkout v0.9.0`) and `/plugin marketplace add` the repo's local path. On a pinned install, set `RESEARCH_PLANS_NO_UPDATE_CHECK=1` (see [Updating](#updating)) so you aren't reminded about newer releases you deliberately skipped.

## Developing the board

The board UI is a React app in `board/`, built once into a single committed HTML template at `skills/managing-research-plans/assets/board-template.html`. The core plan-execute-sync workflow needs only `python3` — `board.py` just injects data into the prebuilt template; web sharing (`--publish-web` and friends) additionally needs Node.js, for the Vercel CLI. Changing the UI itself also needs Node, to rebuild that template:

```
cd board
npm install
npm run dev      # develop against sample data
npm test         # contract-parser tests (drift alarm for the artifact formats)
npm run build    # regenerates the committed template
```

If you change any artifact format (templates or the commands that write them), the parser tests in `board/src/lib/parse.test.ts` are the alarm that the board needs updating.
