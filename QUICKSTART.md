# Quickstart

This is the short path from install to your first plan-execute-sync loop. It assumes Claude Code is installed and you have a research project (new or ongoing) in a folder, ideally a git repository.

## 1. Install the plugin

In any Claude Code session:

```
/plugin marketplace add letitbk/research-plans
/plugin install research-plans@research-plans
```

Restart Claude Code. Type `/research-plans` and the eight commands should appear in the menu. Use the full namespaced names (`/research-plans:init`, not `/init`, which is a different built-in command).

## 2. Initialize your project

Open Claude Code in your project folder and run:

```
/research-plans:init
```

Claude will ask a few questions, starting with your research questions (they become a numbered list in the master plan), then data and constraints. It derives the components from your research design, with each one naming the questions it serves, and looks at what already exists in the folder only to set honest statuses. Adopting mid-project is fine: work you have already done gets marked `done` or `in progress`, and nothing is invented about the past. You can also run init mid-session, after an hour of exploring with Claude: what the session established goes into the plan's context and reasons, and the decision log starts at init, never backfilled. Then it creates `plans/master-plan.md`, `plans/decision-log.md`, and a marked section in your `CLAUDE.md`. Commit when it looks right.

## 3. Plan your first component

```
/research-plans:plan
```

Claude proposes the next component (or name one: `/research-plans:plan data cleaning`). Expect a dialogue, not a generated document. It will walk through the substantive choices one dimension at a time and ask for your reason on each. That is deliberate: the reasons are what make the plan yours. If the data has not been explored yet, it will offer a short read-only look first, which makes for much better scope decisions.

When the plan is ready to sign, your browser opens automatically: this is the sign-off gate. The proposed version is rendered with its diff, and you either approve it (one click; the file is written exactly as shown) or request changes with comments (Claude revises and the gate reopens). The result is `plans/execution/01-data-cleaning/v1.md` with your sign-off, and the tracker updated.

## 4. Execute, then sync

Work normally under the plan in the same or later sessions. Claude should surface interpretive choices before acting and add entries to the decision log as things happen. When a work session ends, or whenever you want a checkpoint:

```
/research-plans:sync
```

This updates the tracker, asks you about any decisions that went unlogged (they get an explicit `late-captured` label), and, if the work genuinely deviated from the plan, drafts a `v2.md` for your approval. `v1.md` is never edited. Revising the plan is the process working, not a failure.

## 5. Capture and verify results

When a component's analysis has run, capture what it produced:

```
/research-plans:results data cleaning
```

Claude proposes the artifacts (figures, tables, key numbers) it can trace to the work, you confirm titles and captions, and it writes an immutable bundle at `plans/execution/<component>/results/r1/` — a brief report, snapshot copies of the files, and the exact scripts that produced them. Then open the board on it: the Results view shows the report, the numbers as tiles, the figure/table gallery, and a click-through to each producing script. Press **Accept** and the verdict is recorded in the decision log and the tracker flips to `done (verified)`; press **Request changes** with comments and Claude fixes the scripts, re-runs, and captures `r2` — `r1` stays exactly as you reviewed it.

Started using the plugin mid-project? `/research-plans:results --adopt` scans your output folders and brings existing figures and tables under verification, marked `retrofit`.

## 6. Optional: review a plan before executing

```
/research-plans:review
```

The review runs in two stages. First a threshold: is this a plan at all? Nine pass or fail checks (a goal with success criteria, reasoned scope decisions, executable steps, a named verification plan, readability, prospectivity, recorded revisions). A document that fails gets told exactly why, in plain terms ("no success criteria: a task list, not a plan yet"), with the fixes. Only a plan that passes gets the second stage: a quality grade on eight items with quoted evidence and the three revisions that would help most. The bands: below 50 percent, revise before executing; 50 to 75 percent, fine to execute but address the flags; above 75 percent, strong. The rubric is a draft; disagreements with it are useful feedback.

## 7. See the whole project on the board

```
/research-plans:board
```

This opens a dashboard in your browser: the tracker as a status board, every plan version with diffs, the decision log as a timeline, and saved review scorecards. It is also where reviewing a plan feels best: select any text to attach a comment, add general comments on any view, then press "Send to Claude". Your comments come back to the session, where Claude walks through them with you, proposes plan revisions where you approved changes, and records the exchange in the decision log.

To share the project state with someone who does not use Claude Code:

```
/research-plans:board --export
```

This writes `plans/board.html`, one self-contained file that opens in any browser, offline, read-only (result figures are embedded). One caution, same as committing plans: the file contains everything under `plans/` — including result figures, tables, and script snapshots — so sharing it is publishing your plans and results.

To get feedback from a collaborator who does not use Claude Code, `/research-plans:board --share` emails just as easily — they annotate in their browser and send back a feedback file that `/research-plans:board --collect <file>` routes into your session with attribution.

## FAQ

**My project is not a git repository.** Everything works, but the plugin loses git-based evidence (commit timing, staleness checks) and will say so. A git repository is strongly recommended since the version history is part of the point.

**I already did half the work before adopting this.** Mid-session and mid-project adoption is supported: prior work informs the plan (context, research questions, statuses, scope reasons), never the decision log. The log starts at initialization and is never backfilled. For substantial already-done work, `/research-plans:adopt` goes further — it decomposes the work into components, drafts a full **retrospective** plan for each (honestly labeled, reviewed together in one board batch), and reconstructs the pre-adoption decisions into `plans/history.md`, kept out of the real-time log.

**I use Claude Code's plan mode.** Fine. If a plan gets approved through plan mode, Claude copies it into the component's next version slot so the repository record stays complete.

**My project is small.** Use fewer, larger components, and let the Scope decisions be a short list instead of a table. If maintaining the structure feels like more work than the project, that is real feedback; please report it.

**What about sensitive material?** `plans/` is designed to be committed and eventually shared. Keep participant details, IRB specifics, and anything else sensitive out of the plans, or in a gitignored appendix.

**Claude stopped logging decisions mid-session.** It happens; the CLAUDE.md section makes it likely but not guaranteed. `/research-plans:sync` exists exactly for this. Late captures are labeled so the log stays honest.

**What is this hook the plugin installs?** One PreToolUse hook, the sign-off gate. It runs a small local python script on Claude's file writes; for anything that is not a plan-version write in an initialized project it does nothing (a few milliseconds). For plan-version writes it opens the browser approval described above, and it always denies edits to already-signed versions. The script is plain readable python in the plugin repo.

**I work over SSH or run headless tests.** Set `RESEARCH_PLANS_NO_GATE=1` in that environment. The bypass prints a notice into the transcript so it is never silent. An unanswered gate times out and denies; nothing is written without approval.

## Feedback

Friction, confusion, rubric disagreements, ideas: please open an issue at https://github.com/letitbk/research-plans/issues. Notes on where the workflow felt constraining or freeing are especially useful.
