<!-- research-plans:master-plan -->
# <Project name> — Master Plan

Last updated: <YYYY-MM-DD>
Initialized: <YYYY-MM-DD HH:MM>
<!-- Initialized is the adoption cutoff: nothing before it is loggable, and nothing before it counts as a deviation — no plan governed that work. Never edit it. -->

## Project context

<Two or three paragraphs: what this research project is about and what it is trying to find out — the questions, the data, key constraints. This is the project's frame, not a history of what has happened in the repository. Written once at init; edit only when the project itself changes direction.>

### Research questions

1. RQ1: <the first research question, phrased as a question>
2. RQ2: <the second, if any — delete unused lines>

## Components

| # | Component | Status | Execution plan | Outcome / notes | Serves |
|---|-----------|--------|----------------|-----------------|--------|
| 1 | <e.g., data preparation> | not started | — | — | — |
| 2 | <e.g., descriptive analysis> | not started | — | — | RQ1 |

Statuses: `not started` / `planned` / `in progress` / `done` / `dropped`.

Components are **research activities in service of the research questions**; the Serves column names which (`RQ1`, `RQ1, RQ2`, or `—` for genuine infrastructure such as data acquisition). Components are never a chronology of repository actions: what already exists in the repo informs **Status**, never the component structure.

Keep **Outcome / notes to one line per component**. Detail belongs in that component's execution plan and in `decision-log.md`, not here.

**Numbering.** The `#` is a **stable identifier**: assigned once, never changed, never reused (a `dropped` component keeps its number). It is not a sequence — the **table row order is the work sequence**, and rows may be reordered freely to reflect how the work actually ran, so numbers can sit out of order down the column. A component's number and slug never move: its execution plan (`execution/<NN-slug>/`) and any finalized results bundle are addressed by that slug forever. To show a late-adopted component in its true place, move its row — never renumber it.

## Sequencing notes

<Optional. Use only when dependencies are non-linear. Delete this section otherwise.>
