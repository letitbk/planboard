# research-plans

A Claude Code plugin for plan-based research workflows in the social sciences.

The idea is simple. A research project keeps two kinds of plans. A **master plan** is a lightweight roadmap: what the components of the project are, what state each one is in, and where its plan lives. An **execution plan** is a focused, written plan for one component (data cleaning, one analysis, a simulation), co-authored with the AI, signed by the researcher, and revised in tracked versions when execution teaches you something. A separate **decision log** records researcher and AI decisions as they happen. The AI carries the bookkeeping so the researcher can think about the research.

Plans are organized around the research project and its questions. The master plan carries numbered research questions (RQ1, RQ2, ...) and every component names which questions it serves. Components are research activities, never a history of what happened in the repository.

This turns AI assistance into something inspectable. The plan says what the work will do, why, and how you will judge whether it succeeded. The version history shows how your thinking changed. The log shows who decided what. A coauthor or reviewer can read all three.

## Install

In Claude Code:

```
/plugin marketplace add letitbk/research-plans
/plugin install research-plans@research-plans
```

Then restart Claude Code. See [QUICKSTART.md](QUICKSTART.md) for a walkthrough.

## Commands

| Command | What it does |
|---------|--------------|
| `/research-plans:init` | Opt a project in. Interview, seed the components list, create the artifacts. |
| `/research-plans:plan` | Scope the next component and co-author its execution plan. |
| `/research-plans:sync` | Post-execution checkpoint. Update the tracker, catch unlogged decisions, version the plan if execution deviated. |
| `/research-plans:review` | Two-stage review: first a pass/fail threshold (is this a plan at all: goal and success criteria, reasoned scope decisions, executable steps, a named verification plan, prospectivity, recorded revisions), then a quality grade if it passes. Always includes a split assessment. |
| `/research-plans:status` | Show the tracker and flag drift. |
| `/research-plans:board` | Open the board: a browser dashboard over everything, with live annotation or a shareable snapshot. |

Everything is opt-in. The plugin does nothing in projects you have not initialized.

## The board

The board renders the whole project in your browser, in four views: the **Tracker** (components as a status board, with drift flags), the **Plan reader** (any version of any plan, with v1 to v2 diffs and the reason each revision was made), the **Timeline** (decisions, plan versions, and reviews in one stream), and **Reviews** (saved rubric scorecards).

It runs in two modes. **Live**: `/research-plans:board` starts a small local server (python3 only, nothing to install), opens your browser, and waits. Select text in a plan to attach a comment, or leave general comments on any view, then press "Send to Claude" — the feedback lands back in your session, drives plan revisions, and is recorded in the decision log. **Snapshot**: `/research-plans:board --export` writes a single self-contained `plans/board.html` that anyone can open without Claude Code or an internet connection. Snapshots are read-only. Treat the file like publishing your plans: it contains everything under `plans/`.

## The sign-off gate

Signing a plan is enforced, not offered. The plugin ships a PreToolUse hook: whenever Claude tries to write a signed version file (`plans/execution/<component>/vN.md`) in an initialized project, the write is blocked while the proposed plan opens in your browser — rendered, with the diff against the previous version. You either approve (the version is written exactly as shown) or request changes with comments (the write is denied, your feedback goes back to Claude, and the gate reopens on the next attempt). The same hook mechanically enforces immutability: edits to or overwrites of an existing signed version are always denied.

Scope and honesty: the gate covers Claude's file tools (Write and Edit). Shell redirection is not interceptable; the immutability convention and the review's revisability check cover after-the-fact edits. The gate only ever activates in projects that opted in (both markers present). For headless or CI work, set `RESEARCH_PLANS_NO_GATE=1` — the bypass leaves a visible trace in the transcript. The wait ceiling is 25 minutes (`RESEARCH_PLANS_GATE_TIMEOUT`, clamped); an unanswered gate denies safely.

## What it creates in your project

```
plans/
├── master-plan.md              roadmap + components tracker
├── decision-log.md             append-only, timestamped
├── board.html                  optional shareable snapshot (regenerate, never edit)
├── reviews/
│   └── 02-analysis-v1.md       saved rubric scorecards
└── execution/
    └── 01-data-cleaning/
        ├── v1.md               the signed plan
        └── v2.md               a revision; v1 is never edited
```

Plus a short marked section in your project's `CLAUDE.md` so every future session follows the conventions. Unsigned working drafts (`.draft-vN.md`) and board bookkeeping files are gitignored automatically.

## Principles

- Plans are written before the work and govern it. A plan is a contract with a built-in amendment process, not a preregistration: a recorded revision is an amendment, legitimate and expected; only a silent deviation is a breach.
- Plan versions are immutable. Revisions are new files that say what changed and why.
- The decision log is written as decisions happen, never backfilled.
- The researcher decides and signs. The AI asks, drafts, and keeps the books.

The workflow comes out of a methods paper on plan-based human-AI research partnerships (reference to follow). The quality rubric bundled with the plugin (`skills/managing-research-plans/references/plan-rubric.md`) is a working draft.

## Developing the board

The board UI is a React app in `board/`, built once into a single committed HTML template at `skills/managing-research-plans/assets/board-template.html`. Researchers never need node; `board.py` only injects data into the prebuilt template. To change the UI:

```
cd board
npm install
npm run dev      # develop against sample data
npm test         # contract-parser tests (drift alarm for the artifact formats)
npm run build    # regenerates the committed template
```

If you change any artifact format (templates or the commands that write them), the parser tests in `board/src/lib/parse.test.ts` are the alarm that the board needs updating.

## License

MIT
