# Board doc-comments — design (anchored comments on Tracker, Timeline, Reviews)

**Date:** 2026-07-06
**Target release:** v0.6.2
**Status:** approved by BK (brainstorming session, 2026-07-06); revised same day
after cross-model review (Codex GPT-5.5) — amendments marked inline where they
changed the design

## Problem

The board's select-to-comment gesture exists only on the Plans view (and inside
Results bundles: report text, artifacts, metrics, script lines). On Tracker,
Timeline, and Reviews the only affordance is a view-level "general comment" box,
so feedback like "this component's status is wrong" or "this log entry
contradicts what we decided" arrives untargeted, and the session has to guess
the referent. The researcher asked for direct comments on all board sections.

A latent bug makes this worse than untargeted: the anchor code labels a
selection with the nearest *preceding* h1–h3 in the DOM, so a selection in the
Tracker's components table (which has no heading of its own) would be labeled
"Research questions" — the last heading of the previous section.

## Decisions (settled with the researcher)

1. **Gesture: text selection everywhere, same as Plans.** Drag-select any text
   in Tracker, Timeline, or Reviews — a table cell, an RQ, a sentence of a log
   entry — and the existing Comment bubble appears. No per-element comment
   buttons (option considered and declined, 2026-07-06 17:14).
2. **One new annotation type, `doc-comment`.** Plan, result, script, and
   general comment types are untouched. `board.py` passes the client-assembled
   feedback document through, so there are **no server or payload changes**
   (payload schema unchanged — it is at schemaVersion 2 today; the original
   spec text said 1, copied from a stale comment in `types.ts`. Codex
   amendment.)
3. **Element-aware anchors, not just labels.** Views stamp their elements with
   both a stable machine id (`data-annot-scope`: `row:3`, `evt:…`, `item:G3`)
   and a human label (`data-annot-section`: "row 3: Platform reach", "Decision
   2026-07-06 16:24", "item G3: Measurable outcomes"). The anchor stores both;
   the occurrence index is counted **within the scoped element**, and
   repainting searches that element first. (Codex amendment: the original
   design stamped only labels, leaving anchor matching view-wide — short
   repeated strings like "planned" could repaint on the wrong row.)
4. **Timeline comments are filter-invariant.** Because anchors are scoped to
   an event card, filtering or searching cannot corrupt them: commenting while
   filtered is safe and allowed, and hidden events simply don't paint. The
   anchored flag updates only for annotations whose scope is present in the
   DOM. (Codex amendment: replaces the original "#filtered sentinel" that
   suppressed all flag updates while filtered and would have mis-anchored
   comments created in a filtered view.)
5. **Consumer rules follow artifact mutability.** Tracker comments may lead to
   master-plan edits (it is a living document). Decision-log entries are
   append-only: a comment on one is discussed or answered by a *new* entry,
   never by rewriting. Saved reviews are records of a past review: never
   edited; comments feed a re-review or a plan revision.
6. **Results joins the same gesture.** (Originally out of scope; the
   researcher checked and reported that Results "pops up whenever I click any
   part" — 2026-07-06 17:39.) Metric tiles and artifact cards lose their
   click-to-`window.prompt` affordances; instead they are stamped scopes
   inside one AnnotationLayer covering metrics + report + artifact gallery,
   so drag-select works uniformly. Comments keep their existing structured
   `result-comment` targets (`metric:<label>` / `artifact:<id>` scopes map
   back to `target.kind` metric/artifact; the report keeps kind report), so
   the feedback format and `commands/board.md` consumer rules for result
   comments are unchanged. The artifact "comment" button is removed rather
   than converted (flagged interpretive call): titles and captions are
   selectable, and one gesture everywhere is the researcher's stated intent.
   Script line-comments keep their click-line gesture (different content, not
   part of the complaint). The verdict banner (with its input and buttons) and
   the version strip stay outside the layer.

## Annotation shape

Client-side only (localStorage + feedback document), never in the payload:

```json
{
  "id": "ann-…",
  "type": "doc-comment",
  "view": "tracker",
  "docKey": "tracker",
  "scope": "row:3",
  "quote": "Platform reach",
  "prefix": "…32 chars before…",
  "suffix": "…32 chars after…",
  "sectionHeading": "row 3: Platform reach",
  "occurrenceIndex": 0,
  "anchored": true,
  "comment": "…"
}
```

- `view` — `"tracker" | "timeline" | "reviews"`; names the tab in the drawer
  and feedback markdown.
- `docKey` — repaint scope, mirroring `planPath` on plan comments:
  `"tracker"`, `"timeline"`, or the review file's payload path (Reviews shows
  one file at a time, like plan versions).
- `scope` — the stable machine id of the stamped element the selection started
  in (`""` when the selection was outside any stamp). `occurrenceIndex` is
  counted within this element's text, not the whole view. (Codex amendment.)
- `sectionHeading` — carries the human element label. One field, not two: the
  approved design sketch had a separate `label`, but since the stamp *replaces*
  the heading walk there is never a second value to keep. Drawer and markdown
  render `[Tracker — row 3: Platform reach]`.
- Remaining fields are the standard quote anchor, identical semantics to plan
  comments: unmatched anchors are kept and shown "unanchored", never dropped.

## Element stamps (`data-annot-scope` + `data-annot-section`)

`anchorFromSelection` gains one step: walk up from the selection start; if an
ancestor carries the stamps, use `data-annot-section` as `sectionHeading`
(skipping the heading walk), record `data-annot-scope` as `scope`, and count
the occurrence index within that element. `paintHighlights` resolves an anchor
with a `scope` by locating the matching `[data-annot-scope]` element and
searching only inside it; anchors without a scope (all plan comments, and
selections outside any stamp) keep today's container-wide behavior — Plans is
unaffected.

Stamps per view (scope id → label):

- **Tracker:** `context` → "Project context"; `sequencing` → "Sequencing
  notes"; `rq:2` → "RQ2"; `row:3` → "row 3: Platform reach"; `chips` →
  "status summary"; `drift` → "drift notice".
- **Timeline:** each event card gets `evt:<kind>:<sortKey>:<title>` → kind
  label + timestamp + title, e.g. `Decision 2026-07-06 16:24`,
  `Plan version 2026-07-04 — 03-x v2`, `Results 2026-07-05 — 03-x r1`.
- **Reviews:** `threshold` → "threshold"; `score` → "score"; `item:G3` →
  "item G3: <name>"; `revisions` → "Top revisions"; `split` → "Split
  assessment". Reviews without a scorecard block render raw markdown — no
  stamps; the heading walk labels those selections, falling back to the review
  filename when no heading precedes the selection (Codex amendment: avoids
  blank labels).

## Wiring

- **AnnotationLayer** is reused as-is mechanically; its `onAdd` partial type
  generalizes from `Omit<PlanCommentAnnotation, …>` to the anchor fields +
  comment (structurally identical — callers already spread in their own
  identity fields).
- **Tracker** wraps its whole rendered content (title through sequencing
  notes) in one AnnotationLayer, `docKey="tracker"`. The parse-failure
  fallback (raw master plan) is wrapped too.
- **Timeline** wraps the event list only — not the filter chips or search
  input. Anchors are scoped to event cards, so filtering cannot corrupt them
  (decision 4); the paint pass reports which scopes were present so hidden
  events' comments keep their anchored flag.
- **Reviews** wraps the main pane (scorecard or raw markdown), `docKey` = the
  selected review's path. The sidebar list is outside the layer.
- **App.tsx**: new `addDocComment` callback; `onPaintResult` generalizes to
  update `anchored` for both `plan-comment` (keyed on `planPath`) and
  `doc-comment` (keyed on `docKey`, and only when the annotation's scope was
  present in the searched DOM); the feedback drawer renders
  `[Tracker — row 3: Platform reach]` + quote + comment with delete, like plan
  comments. Drawer and markdown builder branch on annotation type with an
  exhaustive switch so a future sixth type cannot silently fall through to the
  general-comment branch (Codex amendment). `GeneralCommentBox` stays on all
  three views.
- **Gate deny** (`gateDeny` in App.tsx) starts sending the client-assembled
  `feedbackDocument` like every other path, retiring the server-side assembly
  fallback for current clients; `board.py`'s fallback stays for older static
  exports (Codex amendment: one assembly code path).
- **Highlight styling**: the `mark[data-annotation]` CSS rule is currently
  scoped under `.prose-md` (rendered markdown only), so marks painted in table
  cells and cards would be unstyled; the selector is generalized to apply
  everywhere (implementation find, post-review).
- **Hint text**: the remote-mode banner ("Select text in any plan…") and the
  drawer empty state ("Select text in a plan or…") change to "Select text in
  any view…"; each of the three views gains the Plans-style footer hint when
  annotation is enabled.

## Feedback output

Drawer and markdown share the format plan comments established:

```markdown
## 3. [Tracker — row 3: Platform reach]
Feedback on: "Windows launcher (`python3` not on PATH)"
> your comment
```

`buildFeedbackMarkdown` moves from `App.tsx` into `lib/feedback.ts` (pure
function, currently untested because it lives in the component file) and gets
unit tests covering all five annotation types plus the verdict block.

## Consumer rules (`commands/board.md`)

The feedback-handling section gains explicit dispositions (decision 5):

- **Tracker comments** — may result in master-plan edits (status, notes,
  Serves, context); normal tracker-update rules apply.
- **Timeline comments on decision-log entries** — the log is append-only;
  never rewrite an entry. Discuss; if the exchange changes anything, append a
  new entry.
- **Review comments on scorecards** — saved reviews are never edited; comments
  feed a discussion, a re-run of `/research-plans:review`, or a plan revision.
- Synthetic timeline cards (plan/result/verdict events) reference their
  underlying artifacts; comments on them follow those artifacts' rules.

## Results view mechanics (decision 6)

One AnnotationLayer wraps the metrics-to-gallery span of the selected
bundle's pane — concretely: metrics strip, report, artifact gallery — with
`docKey` = the bundle's `dir`. (Version strip, verdict banner, provenance
`<details>`, and the script drawer stay outside.) The report's own nested AnnotationLayer is
removed (nested layers would both react to one mouseup). Stamps: each metric
tile `metric:<label>` → "metric <label>"; each artifact card `artifact:<id>` →
"artifact <id>: <title>"; the report section `report` → "report". `onAdd`
routes by scope prefix to the existing `result-comment` targets (metric /
artifact / report — target's optional `quote`/`occurrenceIndex` fields are
already in the schema); selections outside any stamp fall back to kind
`report`. Painting passes only annotations that carry a quote (button-era
metric/artifact comments have none and must not paint empty marks), with scope
derived from the target the same way. Result comments still track no
`anchored` flag, as today.

## Out of scope

- Per-element comment buttons (removed from Results, not added elsewhere).
- `board.py`, payload schema, share/export paths, dev-data fixtures.
- Considered in cross-model review and declined: using stored `prefix`/`suffix`
  during repaint (redundant once anchors are scoped); excluding interactive
  controls ("open plan" buttons) from selection (harmless to allow); fixing the
  pre-existing plan-comment quirk where a paint pass that anchors *nothing*
  skips flag updates (`painted.size === 0` guard in App.tsx), so a document
  whose anchors all fail never shows "unanchored" — known issue, plan-comment
  behavior deliberately untouched here.

## Testing

- Unit: `lib/feedback.test.ts` extended for `buildFeedbackMarkdown` (all
  annotation types, verdict, empty case); anchor scope resolution unit-tested
  where it is pure; existing feedback/parse tests keep passing (`npm test` in
  `board/`).
- Manual (dev server on `dev-data.ts`): select-comment in every stamped region
  of each view; labels correct in drawer and markdown; highlights repaint on
  tab switch and page reload; comments created while the timeline is filtered
  anchor correctly once the filter clears; hidden events' comments keep their
  anchored flag; delete from drawer; live-mode POST body shape unchanged; gate
  deny delivers the client-assembled document.
- Build: `npm run build` regenerates
  `skills/managing-research-plans/assets/board-template.html`; CHANGELOG and
  version bump to v0.6.2.
