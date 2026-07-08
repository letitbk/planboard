# Agent plan review — design (one-click review by Codex / Gemini / subagents, routed as anchored comments)

**Date:** 2026-07-08
**Target release:** v0.9
**Status:** approved by BK (brainstorming session, 2026-07-08); **revised same
day after cross-model review (Codex GPT-5.5 + agy Gemini 3.1 Pro)** — both found
the same load-bearing flaw: anchoring and pre-load must happen in the *browser*,
not the session. Corrections folded in below; the ⚠ markers flag what changed.

## Problem

Getting a plan reviewed by another model today is a manual, out-of-band chore:
the researcher leaves the board, invokes `/codex` or `/agy` by hand, reads the
output, and re-types the useful parts back as their own board comments. The
researcher wants to *not write the feedback themselves* — click a button on any
plan and have an agent produce the review, arriving in the same place and shape
as their own annotations so it flows through the existing discuss-revise-log
loop.

## Confirmed decisions (brainstorming, 2026-07-08)

- **Where the agent runs:** the board hands the request back to the researcher's
  Claude session, which runs the agent. Chosen over board.py shelling out
  because it works uniformly for external CLIs *and* Claude subagents.
- **Output form:** section-anchored comments that route like the researcher's own
  annotations — *not* a rubric scorecard. (The scorecard stays the job of
  `/research-plans:review`; this feature is orthogonal.)
- **Reviewers:** Codex (GPT-5.5), Gemini (agy), a single Claude subagent, and a
  Claude subagent panel (diverse lenses, synthesized).
- **Scope:** every execution-plan version (drafts especially), the master plan,
  and results bundles.

## The idea: agents as "virtual annotators"

The researcher's feedback loop is already: select text → comment → **Send to
Claude** → `board.py` returns the feedback document → `board.md` step 5 routes it
(discuss each comment, propose plan revisions, log the exchange). This feature
makes an agent emit those same anchored comments. Nothing downstream of the
comments changes; we add a *producer* of comments (the agent), a *browser-side
resolver* that turns the agent's plain quotes into real anchors, and an
*attribution* of who produced each.

## ⚠ The correction that reshaped the design

The first draft assumed the Claude session could anchor an agent's comment by
"reusing `anchor.ts`." Both reviewers flagged this as fatal: `anchor.ts` runs on
the live browser DOM (`window.getSelection`, `document.createTreeWalker`) and
cannot execute headlessly in a Python/Bash session. It also assumed the board
could be "reopened with pending comments," but no such seed path exists (the app
seeds annotations only from `localStorage`). So the revised architecture keeps
the session dumb — it only *carries* the agent's raw comments — and pushes both
anchoring and pre-loading into the browser, where the DOM lives.

## Flow (revised)

1. **Button.** Each reviewable document shows a `Review with ▾` control
   (Codex / Gemini / Subagent / Subagent panel).
2. **Request rides the feedback transport (no new server endpoint).** Clicking
   submits the feedback document with a new typed `reviewRequest` field (agent +
   target descriptor). `board.py` already writes the client-supplied
   `feedbackDocument` to `plans/.board-feedback.md` and returns it on stdout /
   `--collect`, so the *transport* is unchanged — but the feedback *schema* gains
   `reviewRequest` (⚠ not "no protocol change," as first written).
3. **One new routing branch in `board.md` step 5.** "A `reviewRequest` → run that
   agent." The session first routes any manual annotations submitted in the same
   document (so co-submitted human comments are never lost), deletes the pending
   request, then runs `codex exec` / `agy -p` (their skills) or spawns Task
   subagent(s) with the target's content **plus the relevant rubric as guidance**,
   requiring the strict output shape below.
4. **Session stays dumb; it does NOT anchor.** ⚠ The session collects the agent's
   raw `{section, quote, comment}` items, stamps each with the agent as `author`,
   writes them to a JSON file, and reopens the board via a **new
   `board.py --seed-annotations <file>`** arg that injects them into `BoardData`
   as `seededAnnotations`.
5. **Browser resolves + pre-loads.** ⚠ On mount, the React app reads
   `seededAnnotations` and, for each, runs a **new browser-side
   `anchorFromQuote(container, section, quote)`** that walks the rendered DOM
   (the tree-walk already inside `paintHighlights`), tolerant of markdown, to
   compute `scope` / `occurrenceIndex` / `prefix` / `suffix`, or marks
   `anchored: false` on a miss. These become *pending* annotations badged by
   author, seeded into React state alongside (and before) any `localStorage`
   comments.
6. **Curate-then-send.** The researcher skims the agent's pending comments, drops
   any they disagree with, optionally adds their own, then **Send to Claude** —
   routing them through step 5 exactly as today. The agent wrote the feedback;
   the researcher only curates and sends.

## Agent output contract

Each reviewer returns strict JSON:

```json
{
  "overall": "<one-paragraph verdict>",
  "comments": [
    { "section": "<exact section heading, or empty>",
      "quote": "<short span copied from the document, WITHOUT markdown syntax>",
      "comment": "<the critique or concrete suggestion>" }
  ]
}
```

⚠ The `quote` must match the **rendered** text, so the prompt instructs the agent
to strip markdown (`**`, `` ` ``, `[...]()`) when quoting — a raw-markdown quote
would fail the DOM matcher. Quotes stay short (a phrase or sentence). The session
validates the JSON and repairs/re-prompts once on malformed output. A quote the
browser cannot locate becomes an explicit **unanchored** comment (shown in the
drawer, not painted). The `overall` verdict becomes one view-level general
comment.

## Components — new vs reused (revised)

| Reused as-is | New |
|--------------|-----|
| `/api/feedback` POST → `.board-feedback.md` → stdout / `--collect` transport | `Review with ▾` control on the three doc types |
| Annotation model; the `paintHighlights` DOM tree-walk | ⚠ browser `anchorFromQuote(container, section, quote)` (quote → full anchor, markdown-tolerant) |
| `board.md` step-5 routing skeleton | ⚠ `board.py --seed-annotations <file>` → `seededAnnotations` in `BoardData` |
| Codex/agy skills; Task subagent tool | ⚠ React seed-ingestion: resolve `seededAnnotations` on mount into pending state |
| `references/plan-rubric.md` | ⚠ typed `reviewRequest` field in the feedback fence + its `board.md` routing branch |
| Payload/hash surfaces (`payload_files`/`allFiles`) — **untouched** (annotations live in the feedback doc, not the payload) | `author` field on comment annotations + drawer badges + feedback-markdown headings + decision-log attribution |

⚠ Correction to the first draft: `board.py` *does* change (the `--seed-annotations`
arg and payload field). What stays true is that **no new HTTP endpoint** is
needed and the **payload hash surfaces are untouched**.

## Anchoring fallback — make the miss explicit

`anchored` fields and unanchored badges exist for plan and doc comments, but
(per Codex) plan comments aren't currently marked unanchored when *nothing*
paints, and **result comments have no `anchored` field at all**. So the feature
must: set `anchored: false` at creation when `anchorFromQuote` misses, and add an
`anchored` status (with a drawer badge) to result comments — otherwise an agent
comment that fails to anchor silently vanishes on the Results view.

## Per-scope handling

The output contract is identical across scopes; only the target document, the
annotation type, and the review guidance differ:

- **Execution plan version** → plan-comment annotations; guidance =
  `plan-rubric.md`.
- **Master plan** → doc-comment annotations (view `tracker`); guidance = research
  design (answerable RQs, sound/independently-completable component decomposition,
  sequencing).
- **Results bundle** → result-comment annotations (report / metric / script
  targets); guidance = does the analysis support the stated findings, are numbers
  and artifacts consistent, what is missing.

## Reviewers

- **Codex** — `codex exec -m gpt-5.5`; parse JSON.
- **Gemini** — `agy -p`; same prompt; parse JSON.
- **Single subagent** — Task tool (general-purpose); fastest, no CLI.
- **Subagent panel** — several Task subagents through distinct lenses
  (correctness / methodological rigor / feasibility); the session dedupes and
  synthesizes.

⚠ `board.md`'s `allowed-tools` currently permits only `python3`/`git`/`ls`/`date`;
the routing branch must add `Bash(codex:*)`, `Bash(agy:*)`, and the Task/subagent
tool, or the reviewers cannot run.

## Sequencing (build order, de-risking first)

1. **Core loop** — the `reviewRequest` schema field + button on execution-plan
   versions + `board.py --seed-annotations` + browser `anchorFromQuote` +
   React seed-ingestion + `author` attribution + a **single Claude subagent**
   reviewer + the `board.md` routing branch. Proves the whole loop with the
   cheapest, no-CLI reviewer and lands the load-bearing browser plumbing first.
2. **External models** — add Codex and Gemini (skills + output-contract prompt +
   JSON repair + tool permissions). Re-run cross-model review on this diff.
3. **Subagent panel** — multi-lens synthesis (most novel, most token-hungry).
4. **More scopes** — extend the button to the master plan and results bundles
   with their per-scope guidance, and the result-comment `anchored` status.

## Risks

- **Anchoring misses** on paraphrased or markdown-laden quotes → unanchored
  comments. Mitigated by the markdown-stripping prompt and the browser
  `anchorFromQuote`; measure the anchor hit-rate on real plans.
- **Misanchoring repeated phrases** — `paintHighlights` falls back to the first
  match; `anchorFromQuote` must compute a genuine `occurrenceIndex`, not default
  to 0.
- **Ceremony:** Codex/agy take minutes and the board closes → agent runs → board
  reopens; accepted with the session-runs choice (the subagent path is faster).
- **Malformed agent JSON** → one repair/re-prompt, then degrade to an unanchored
  `overall` note rather than failing the action.
- **Attribution correctness** — decision-log entries must name the agent as the
  source; a researcher-edited agent comment must not be logged as the agent's
  verbatim view.
- **Token cost** of the panel — opt-in, built last.

## Open questions (from review)

- **Edit ownership:** if the researcher edits an agent's pending comment before
  sending, should the `author` badge be stripped (it becomes the researcher's) or
  marked `Codex (edited)`? Proposed default: **stripped to the researcher** —
  editing = taking ownership.
- **Panel attribution:** should `author` be a plain string, or structured, so a
  comment can read `Subagent panel (methodology lens)`? Proposed: a plain string
  carrying the lens, e.g. `"Subagent panel · methodology"`, to avoid a schema
  change.

## Out of scope (v1)

- Auto-triggering an agent review inside the F2 chain (the button is manual).
- Agents editing the plan directly — they only comment; revisions go through the
  normal signed-version + sign-off-gate flow.
- Rubric *scorecards* from external models — that remains `/research-plans:review`.
