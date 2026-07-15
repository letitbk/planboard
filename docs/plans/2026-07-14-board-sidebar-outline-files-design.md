# Board left sidebar: Outline + Files (global, consolidated)

Design date: 2026-07-14. Status: proposed (brainstormed + Codex-reviewed + corrected; not yet planned/implemented).

Revision note: this doc was rewritten after a Codex (gpt-5.6-sol, xhigh) review verified the design's claims against `board/src`. The first draft had factual errors and under-scoped the layout; this version is grounded in the actual code (file:line cited inline) and reflects three follow-up decisions (consolidate sidebars, logical navigator, full adapt-per-view).

## Goal

Give the board one **global, persistent, collapsible left panel** with two sub-tabs:

- **Outline** (primary) — jump-around navigation for the current view, *adapting per view*: heading TOC on document readers, and a semantic outline on structured views (Tracker → component rows, Timeline → decision dates, Reviews → items, Results → bundle sections, Models → sections).
- **Files** — a **logical navigator** of board artifacts scoped to `plans/`, organized by component; clicking a leaf routes into the board's existing view.

Crucially, this panel **consolidates the four left sidebars the document views already render**, rather than adding a fifth rail beside them.

## Decisions

| Question | Decision |
|---|---|
| Primary job | Jump around long docs (outline first) |
| File scope | `plans/` artifacts only |
| Surface | One global left panel with sub-tabs (Outline / Files) |
| Outline reach | **Full adapt-per-view** — every view contributes an outline |
| File click | Route to the artifact's existing board view (no raw file rendering) |
| Snapshot behavior | Full parity — works offline in export / share / web-publish |
| Files layout | By component (Master plan + Decision log at top; each component → Plans / Results / Reports / Reviews) |
| Files source | **Logical navigator** of board entities (not a literal file tree); zero added project payload |
| Sidebar model | **Consolidate** — replace the four existing per-view `w-56` asides with this one panel |
| Default state | Open, collapsible, state remembered in `localStorage` |

Not included: a "Versions" sub-tab (Plans already renders version diffs) and an "Archive" sub-tab (Archive is a top-nav tab).

## Ground truth about the board (verified against code)

These are the facts the design must build on. The first draft got several wrong.

- **Navigation is not a single `setNavRequest`.** Opening an artifact means setting three things together: `setTab(target.tab)`, `setSelectedComponent(target.component)`, then a bumped-token `setNavRequest({...target, token})` — see `openAnnotation` and `openReport` (`App.tsx:927-948`). `navRequest` is a **one-shot request** a view consumes; it is not authoritative route state, and it does not by itself switch tabs.
- **`NavTarget`** (`navTarget.ts:7`) has `tab: tracker|plans|results|timeline|reviews|archive|reports` (no `models`), plus `planPath` / `resultsVersion` / `scriptPath` / `archivePath` / `reviewPath` (**no `reportPath`** — reports route by `resultsVersion`), and annotation-only `annotationId` / `anchored`.
- **Each document view owns its own selection index locally:** PlanReader `docIdx` (`PlanReader.tsx:165`), Results bundle index (`Results.tsx:266`), Reports bundle index (`Reports.tsx:71`), Scorecard `idx` (`Scorecard.tsx:41`). `App` can't know the active leaf unless the view reports it up.
- **The four document views already render a `w-56` (224px) left `<aside>`:**
  - Plans, Reports, Results each render the **same "Components" picker** (`onSelectComponent`, with `pre-renewal` badges) — `PlanReader.tsx:254`, `Reports.tsx:157`, `Results.tsx:419`.
  - PlanReader **additionally** renders the doc's **section outline** ("Part 1 · for humans" / "Part 2 · for agents") wired to `scrollToSection(heading)`, which opens the collapsed Part-2 agent block before scrolling (`PlanReader.tsx:208,285-317`).
  - Scorecard renders a **"Saved reviews" picker** instead (`Scorecard.tsx:78-108`).
- **The payload is not a complete file inventory.** `types.ts` carries plan versions, result bundles, published-report markdown, and *raw* review files. But reviews are flat `BoardFile[]` parsed on demand by `parseScorecard` (`Scorecard.tsx:59`), PDF/DOCX reports are booleans, manifest-less result dirs are skipped (`board.py:260`), and files like `validation.md` aren't collected. `dev-data.ts` even has a review for `04-regression` with no matching execution group (`dev-data.ts:927-934`).
- **Results is a structured bundle view** (validation, metrics, artifacts, provenance — `Results.tsx:638`), not a markdown reader. Reports *is* a single rendered markdown body (`Reports.tsx:145`).
- **The annotation code does not expose an outline.** It computes one nearest-heading string during a text selection (`anchor.ts:34,57`); no heading list, levels, IDs, or nodes. So the Outline must come from each view, not from the anchoring layer.

## The consolidation insight

The existing asides already do the two jobs this panel formalizes, just per-view and duplicated:

- The repeated **"Components" list** (Plans/Reports/Results) and the **"Saved reviews" list** (Scorecard) are cross-entity navigation → this becomes the single global **Files** navigator.
- PlanReader's **section list** is a within-doc outline → this becomes the global **Outline** sub-tab, generalized to every view.

So consolidation removes three duplicate "Components" lists and one reviews list and unifies them. It is a net simplification, not additive weight — which is why a global panel is safer than a fifth rail.

## Architecture

### App-owned state (no pub/sub context)

With one normal view mounted at a time (`App.tsx:1130`), a subscription registry is overkill. Instead:

- `App` holds two new pieces of state: `activeRoute` (the authoritative current selection: tab + component + version/bundle/reviewPath) and `outline` (the current view's `OutlineEntry[]`).
- A shared **`applyRoute(target)`** helper generalizes `openReport`/`openAnnotation`: it sets tab + component + token + `navRequest`, and updates `activeRoute`. Every navigation (top nav, Files click, click-sync) goes through it, so `activeRoute` is always correct.
- The mounted view receives two stable callbacks: **`onOutlineChange(entries)`** (publishes its outline) and **`onActiveRouteChange(partial)`** (reports the exact leaf when the user switches version/bundle *inside* the view, so Files can highlight it). These replace the proposed `OutlineContext`/`useOutline` machinery.

`OutlineEntry = { id; label; level: 1|2|3; onSelect: () => void }`. The panel renders the list and calls `onSelect`.

### Outline (full adapt-per-view), reusing what exists

- **PlanReader** publishes `parsed.sections` and wires `onSelect` to its existing **`scrollToSection`** (which handles collapsed agent sections). In **diff mode** the body is `DiffView` with no doc headings (`PlanReader.tsx:511`) → publish an empty/"diff view" outline.
- **Reports** scans its single rendered markdown body for `h1/h2/h3` (scoped to the report container, not the whole view) and wires `onSelect` to `scrollIntoView`.
- **Results** publishes its structured sections (validation / metrics / artifacts / provenance) from the arrays it already has, each `onSelect` scrolling to that block.
- **Tracker** publishes one entry per component row; **Timeline** one per decision date (respecting the active filter); **Reviews** one per saved review (parsed label, with an "Unassigned reviews" bucket for malformed/legacy); **Models** its section anchors.

### Files (logical navigator, zero project payload)

- `lib/filesTree.ts` (pure, unit-tested) builds the by-component tree from `BoardData`:
  - top level: **Master plan**, **Decision log**, then one node per component (`NN · slug`) — with `pre-renewal` badges reused from the current asides;
  - each component expands to the groups that exist: **Plans** (`v1..vN`, latest marked), **Results** (`r1..rN`), **Reports**, **Reviews**; empty groups omitted;
  - **component union** = execution groups ∪ components referenced by results/reports/reviews (so a review whose component has no execution group still appears); reviews that don't parse to a component go under **Unassigned reviews**.
- Each leaf carries a `NavTarget`; clicking calls `applyRoute(target)` (same primitive as everything else). Component-level clicks call the existing `onSelectComponent` path.
- The in-pane version/bundle strips (Reports bundle picker, Results version strip) **stay** — they're contextual quick-switchers; Files provides the cross-component + drill navigation the asides used to.
- Explicitly out of scope for the logical navigator (documented, not silently dropped): working drafts, committed draft snapshots, raw scripts, individual artifacts, PDF/DOCX report variants, model-profile, history, archives. These remain reachable through their existing views; Files lists the primary artifact per node.

### Panel shell

- `components/Sidebar.tsx`: one global `w-56`-class left column (matching the removed asides' width) with the Outline | Files sub-tab switcher and a collapse toggle (« → thin rail). It scrolls independently, with a sticky-header offset so `scrollIntoView` lands below the top nav.
- The four views drop their own `<aside>` and render only their main pane; `App` lays out `[Sidebar][active view]`. On narrow/touch (`hosted` + coarse pointer) and near the 1024px breakpoint where `FeedbackPanel` docks (~380px, `FeedbackPanel.tsx:196`), the sidebar defaults collapsed to protect reading width.
- Persistence: collapse state + last sub-tab in `localStorage` keyed by **`projectId`** (stable), not the payload hash (which resets every content change) — mirroring the live-state keying at `App.tsx:152`.

## Data flow (corrected)

1. `App` renders `[Sidebar]` + the one active view, passing `onOutlineChange` / `onActiveRouteChange`.
2. Active view mounts → calls `onOutlineChange(entries)` → Outline sub-tab renders.
3. Outline entry click → `entry.onSelect()` scrolls/anchors within the current view.
4. Files leaf click → `applyRoute(target)` → `App` sets tab + component + token + request + `activeRoute`; the target view consumes its `navRequest` and resolves the doc/version/bundle.
5. User switches version *inside* a view → view calls `onActiveRouteChange(partial)` → Files highlights the right leaf.
6. On unmount/tab-switch the outgoing view clears its outline; the one-shot `navRequest` is consumed/cleared so returning to a tab after a local change doesn't re-apply a stale request.

## Edge cases (from the review)

- Component union incl. reviews with no execution group; "Unassigned reviews" bucket for unparseable scorecards.
- PlanReader **diff mode** → no heading outline; Results → structured outline not headings; Timeline honors the active filter; empty Models state.
- Missing/stale targets: today the view effects simply do nothing when a path/version isn't found (`PlanReader.tsx:169`, `Reports.tsx:84`) — keep that behavior (no invented fallback), just don't crash the panel.
- Duplicate heading text/IDs within a doc; sticky-header scroll offset; panel own-scroll and height; keyboard focus; narrow-screen + docked-feedback layout.
- Scroll-spy where a scroll container exists (`IntersectionObserver`); last-clicked highlight on short table views.

## Snapshot parity

- The **logical navigator adds no project payload** and works offline in export/share/web-publish; Outline is derived from what each view already renders.
- Honest caveat: the new React/CSS grows the compiled single-file board, which the build copies into the Python asset location (`board/package.json:7`). "Zero payload" means *no new `plans/` data serialized*, not zero bytes.
- `board.py` needs **no changes** (logical navigator only).

## Testing

- `filesTree.test.ts` — tree from representative `BoardData`: multi-component, missing groups, single version, review-without-execution-group → Unassigned, pre-renewal badge.
- Routing — each leaf kind builds a `NavTarget` that `applyRoute` maps to the right tab + selector; component click hits `onSelectComponent`.
- Outline — each view publishes correct entries (PlanReader sections incl. agent-part expansion; Reports scanned headings; Results structured; Tracker/Timeline/Reviews/Models semantic); diff-mode empty.
- Sidebar — collapse/sub-tab persistence under `projectId`; active-leaf highlight follows `onActiveRouteChange`; consumed-request doesn't re-fire.
- **Real export test** — build the single file and assert the panel renders + routes with no server (a component test alone doesn't prove Python injection + static routing).

## Over-engineering avoided / honest scope

- Dropped the `OutlineContext` pub/sub in favor of App-owned state + two callbacks (single-view mount makes a registry unnecessary).
- This is **not** a cheap additive layer. It touches: `App` (state + `applyRoute` + layout), all four document views (remove aside, publish outline, report active route), Tracker/Timeline/Models (publish outline), a new `Sidebar` + `lib/filesTree.ts`, and a small `NavTarget` change (make `annotationId`/`anchored` optional, or add an `openTarget` variant, so a Files open needs no fake annotation). It does **not** touch `board.py`, the payload format, or `plans/`.

## Open implementation choices (settle at plan time)

- Outline source for Reports: scoped DOM scan of the rendered body (recommended, follows the renderer) vs parsing `parsed.body` markdown (deterministic, second parser). PlanReader already answers this with `parsed.sections`; prefer reusing per-view parsed structure where it exists and DOM-scan only where it doesn't.
- Whether component-level and version-level clicks in Files both live in the tree, or components in the tree and versions via the retained in-pane strips.
- Exact `NavTarget` change: relax `annotationId`/`anchored` to optional vs a parallel `openTarget` type.
