# Board doc-comments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the board's select-to-comment annotation from the Plans view to Tracker, Timeline, and Reviews, with scope-anchored highlights that name the exact row/entry/item; make Results use the same drag gesture (no click-anywhere `window.prompt` popups).

**Architecture:** One new client-side annotation type (`doc-comment`) flows through the existing `AnnotationLayer`. Views stamp elements with `data-annot-scope` (stable id) + `data-annot-section` (human label); anchors count quote occurrences *within* the stamped element and repaint by searching it first. No server (`board.py`) or payload changes.

**Tech Stack:** React 19 + TypeScript (strict), Tailwind 4, vitest; single-file build via vite → `skills/managing-research-plans/assets/board-template.html`.

**Spec:** `docs/specs/2026-07-06-board-doc-comments-design.md` (amended after Codex review — the amendments are binding).

## Global Constraints

- Work on branch `feature/board-doc-comments` off `main`.
- No new npm dependencies. No `board.py` changes. No payload/schema changes.
- All commands run in `board/` unless a path says otherwise. Typecheck with `npx tsc --noEmit` (vite build does NOT typecheck).
- Commit messages: conventional, no `Co-Authored-By` lines (user rule).
- NEVER `git add` these (a parallel session owns them): `plans/`, `CLAUDE.md`, `docs/ROADMAP.md`.
- Plans view behavior must not change: plan comments have no scope stamps and must anchor/paint exactly as before.
- UI copy is specified verbatim in the tasks — don't improvise wording.

---

### Task 1: `doc-comment` type + feedback markdown builder (TDD)

**Files:**
- Modify: `board/src/lib/types.ts` (annotations section, lines ~199–255)
- Modify: `board/src/lib/feedback.ts`
- Test: `board/src/lib/feedback.test.ts`
- Modify: `board/src/App.tsx` (delete local `buildFeedbackMarkdown`, import from lib; drawer branches)

**Interfaces:**
- Produces: `DocCommentAnnotation` (type `"doc-comment"`, fields below); `Annotation` union extended; `PlanCommentAnnotation` gains optional `scope?: string`; `buildFeedbackMarkdown(annotations: Annotation[], verdict: VerdictRequest | null): string` and `VIEW_LABEL: Record<DocCommentAnnotation["view"], string>` exported from `lib/feedback.ts`.

- [ ] **Step 1: Branch + baseline**

```bash
cd /Users/bk/github/research-plans && git checkout -b feature/board-doc-comments
cd board && npm test && npx tsc --noEmit
```
Expected: existing tests PASS, tsc clean. If not, STOP and report.

- [ ] **Step 2: Add the types**

In `board/src/lib/types.ts`, add `scope?: string;` to `PlanCommentAnnotation` (after `sectionHeading: string;`), then add before the `Annotation` union:

```ts
export interface DocCommentAnnotation {
  id: string;
  type: "doc-comment";
  view: "tracker" | "timeline" | "reviews";
  docKey: string; // "tracker" | "timeline" | review file payload path
  scope: string; // data-annot-scope id, "" when selection was outside stamps
  quote: string;
  prefix: string;
  suffix: string;
  sectionHeading: string;
  occurrenceIndex: number;
  anchored: boolean;
  comment: string;
}
```

Extend the union:

```ts
export type Annotation =
  | PlanCommentAnnotation
  | GeneralAnnotation
  | ResultCommentAnnotation
  | ScriptCommentAnnotation
  | DocCommentAnnotation;
```

- [ ] **Step 3: Write the failing tests**

Append to `board/src/lib/feedback.test.ts` (import `buildFeedbackMarkdown`, `VIEW_LABEL` from `./feedback` and `Annotation`, `VerdictRequest` from `./types`):

```ts
describe("buildFeedbackMarkdown", () => {
  const docComment: Annotation = {
    id: "a1", type: "doc-comment", view: "tracker", docKey: "tracker",
    scope: "row:3", quote: "Platform reach", prefix: "", suffix: "",
    sectionHeading: "row 3: Platform reach", occurrenceIndex: 0,
    anchored: true, comment: "status is wrong",
  };
  const planComment: Annotation = {
    id: "a2", type: "plan-comment", planPath: "plans/execution/03-x/v2.md",
    component: "03-x", version: 2, isDraft: false, quote: "the goal",
    prefix: "", suffix: "", sectionHeading: "Goal", occurrenceIndex: 0,
    anchored: true, comment: "tighten this",
  };
  const general: Annotation = {
    id: "a3", type: "general", view: "Timeline", comment: "looks sparse",
  };

  it("returns the no-feedback stub when empty", () => {
    expect(buildFeedbackMarkdown([], null)).toBe(
      "# Board Feedback\n\nNo feedback.",
    );
  });

  it("renders doc-comments with view label, section, and quote", () => {
    const md = buildFeedbackMarkdown([docComment], null);
    expect(md).toContain("## 1. [Tracker — row 3: Platform reach]");
    expect(md).toContain('Feedback on: "Platform reach"');
    expect(md).toContain("> status is wrong");
  });

  it("falls back to the bare view label when sectionHeading is empty", () => {
    const md = buildFeedbackMarkdown(
      [{ ...docComment, sectionHeading: "" } as Annotation],
      null,
    );
    expect(md).toContain("## 1. [Tracker]");
  });

  it("keeps plan-comment and general formats unchanged", () => {
    const md = buildFeedbackMarkdown([planComment, general], null);
    expect(md).toContain("## 1. [03-x v2 — Goal]");
    expect(md).toContain('Feedback on: "the goal"');
    expect(md).toContain("## 2. [Timeline — general]");
  });

  it("renders the verdict block with the apply command", () => {
    const verdict: VerdictRequest = {
      component: "03-x", resultsVersion: 1,
      status: "changes-requested", comment: "redo fig 2",
    };
    const md = buildFeedbackMarkdown([], verdict);
    expect(md).toContain("## VERDICT: CHANGES-REQUESTED — 03-x r1");
    expect(md).toContain("results.py verdict --component 03-x --version 1");
  });

  it("exposes display labels for every doc-comment view", () => {
    expect(VIEW_LABEL.tracker).toBe("Tracker");
    expect(VIEW_LABEL.timeline).toBe("Timeline");
    expect(VIEW_LABEL.reviews).toBe("Reviews");
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `buildFeedbackMarkdown` / `VIEW_LABEL` not exported from `./feedback`.

- [ ] **Step 5: Move and extend the builder**

Cut `buildFeedbackMarkdown` out of `board/src/App.tsx` (bottom of file) and add to `board/src/lib/feedback.ts` (adjust its imports to include `Annotation`, `VerdictRequest` — already imported there — plus `DocCommentAnnotation`):

```ts
export const VIEW_LABEL: Record<DocCommentAnnotation["view"], string> = {
  tracker: "Tracker",
  timeline: "Timeline",
  reviews: "Reviews",
};

export function buildFeedbackMarkdown(
  annotations: Annotation[],
  verdict: VerdictRequest | null,
): string {
  if (annotations.length === 0 && !verdict)
    return "# Board Feedback\n\nNo feedback.";
  const lines: string[] = ["# Board Feedback", ""];
  if (verdict) {
    lines.push(
      `## VERDICT: ${verdict.status.toUpperCase()} — ${verdict.component} r${verdict.resultsVersion}`,
    );
    if (verdict.comment) lines.push(`> ${verdict.comment}`);
    lines.push(
      "",
      "Apply via: results.py verdict --component " +
        `${verdict.component} --version ${verdict.resultsVersion} --status ${verdict.status}`,
      "",
    );
  }
  if (annotations.length > 0) {
    lines.push(
      `I've reviewed the board and have ${annotations.length} piece${annotations.length === 1 ? "" : "s"} of feedback:`,
      "",
    );
  }
  annotations.forEach((a, i) => {
    switch (a.type) {
      case "plan-comment": {
        const head = `${a.component} v${a.version}${a.isDraft ? " (draft)" : ""}${a.sectionHeading ? ` — ${a.sectionHeading}` : ""}`;
        lines.push(`## ${i + 1}. [${head}]`);
        lines.push(`Feedback on: "${a.quote}"`);
        break;
      }
      case "result-comment": {
        const t =
          a.target.kind === "artifact"
            ? `artifact ${a.target.artifactId}`
            : a.target.kind === "metric"
              ? `metric ${a.target.metricLabel}`
              : "report";
        lines.push(`## ${i + 1}. [${a.component} r${a.resultsVersion} — ${t}]`);
        if (a.target.quote) lines.push(`Feedback on: "${a.target.quote}"`);
        break;
      }
      case "script-comment": {
        lines.push(
          `## ${i + 1}. [${a.component} r${a.resultsVersion} — ${a.script.split("/").pop()} lines ${a.lineStart}-${a.lineEnd}]`,
        );
        lines.push("```", a.excerpt, "```");
        break;
      }
      case "doc-comment": {
        const head = `${VIEW_LABEL[a.view]}${a.sectionHeading ? ` — ${a.sectionHeading}` : ""}`;
        lines.push(`## ${i + 1}. [${head}]`);
        lines.push(`Feedback on: "${a.quote}"`);
        break;
      }
      case "general": {
        lines.push(`## ${i + 1}. [${a.view} — general]`);
        break;
      }
      default: {
        const _exhaustive: never = a;
        void _exhaustive;
      }
    }
    for (const ln of a.comment.split("\n")) lines.push(`> ${ln}`);
    lines.push("");
  });
  return lines.join("\n");
}
```

In `App.tsx`: add `buildFeedbackMarkdown` to the existing `./lib/feedback` import; remove the now-unused local function and, if now unused, the `Annotation`/`VerdictRequest` type-only imports it needed (they are still used elsewhere — verify with tsc).

- [ ] **Step 6: Drawer renders doc-comments**

In `App.tsx`'s drawer (`annotations.map(...)`), the meta line is an if/else chain ending in the general fallback. Insert a `doc-comment` branch before the general one (import `VIEW_LABEL` from `./lib/feedback`):

```tsx
) : a.type === "doc-comment" ? (
  <>
    <span className="font-medium text-stone-700">
      {VIEW_LABEL[a.view]}
    </span>
    {a.sectionHeading && <span>· {a.sectionHeading}</span>}
    {!a.anchored && (
      <span className="rounded bg-stone-100 px-1 py-0.5">
        unanchored
      </span>
    )}
  </>
) : (
```

And extend the quote block below it — change the plan-comment-only quote display condition to include doc-comments:

```tsx
{(a.type === "plan-comment" || a.type === "doc-comment") && (
  <div className="mb-1 line-clamp-2 rounded bg-amber-50 px-1.5 py-1 text-[11px] italic text-stone-500">
    “{a.quote}”
  </div>
)}
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all PASS, tsc clean.

- [ ] **Step 8: Commit**

```bash
cd /Users/bk/github/research-plans
git add board/src/lib/types.ts board/src/lib/feedback.ts board/src/lib/feedback.test.ts board/src/App.tsx
git commit -m "board: doc-comment annotation type + feedback markdown builder in lib with tests"
```

---

### Task 2: Scoped anchors — `anchor.ts`, `AnnotationLayer`, paint-flag logic

**Files:**
- Modify: `board/src/lib/anchor.ts`
- Modify: `board/src/components/AnnotationLayer.tsx`
- Modify: `board/src/App.tsx` (`onPaintResult`)
- Modify: `board/src/views/PlanReader.tsx`, `board/src/views/Results.tsx` (widen `onPaintResult` prop type only)

**Interfaces:**
- Consumes: `DocCommentAnnotation` from Task 1.
- Produces:
  - `SelectionAnchor` gains `scope: string`.
  - `paintHighlights(container, anchors: {id; quote; occurrenceIndex; scope?}[]): { painted: Set<string>; scopeAbsent: Set<string> }`.
  - `AnnotationLayer` prop `onPaintResult: (painted: Set<string>, docKey: string, scopeAbsent: Set<string>) => void`; prop `annotations: PaintableAnnotation[]` where `PaintableAnnotation` gains `scope?: string`; prop `onAdd: (a: AnchoredSelection) => void` with exported

    ```ts
    export interface AnchoredSelection {
      quote: string; prefix: string; suffix: string;
      sectionHeading: string; scope: string;
      occurrenceIndex: number; anchored: boolean; comment: string;
    }
    ```

- [ ] **Step 1: Scope capture in `anchorFromSelection`**

In `board/src/lib/anchor.ts`:

1. Add `scope: string;` to `SelectionAnchor`.
2. After the existing section-heading walk in `anchorFromSelection`, add a stamp walk + scoped occurrence counting. Replace the block that computes `full`/`positions`/`preRange` so it operates on the scope element when one contains the selection **and** contains the quote; otherwise fall back to the container (existing behavior):

```ts
  // Element stamps: nearest ancestor with data-annot-scope wins over the
  // heading walk, and occurrence is counted within that element.
  let scope = "";
  let scopeEl: HTMLElement | null = null;
  for (let e: Element | null = el; e && e !== container; e = e.parentElement) {
    const s = (e as HTMLElement).dataset?.annotScope;
    if (s !== undefined) {
      scope = s;
      scopeEl = e as HTMLElement;
      const label = (e as HTMLElement).dataset?.annotSection;
      if (label) sectionHeading = label;
      break;
    }
  }

  let root: HTMLElement = scopeEl ?? container;
  let full = normalizeWs(root.textContent ?? "");
  if (scopeEl && !full.includes(quote)) {
    // Selection spans outside the stamped element (e.g., across rows):
    // fall back to container-wide anchoring.
    scope = "";
    root = container;
    full = normalizeWs(container.textContent ?? "");
  }
```

Then change the two lines that previously used `container` for occurrence location to use `root`:

```ts
  const preRange = document.createRange();
  preRange.selectNodeContents(root);
```

(the `positions` loop already reads from `full`). Return `scope` in the result object:

```ts
  return { quote, prefix, suffix, sectionHeading, occurrenceIndex, scope };
```

3. Also honor `data-annot-section` for the *label* even when reached via the heading walk's `cur` loop — not needed; the stamp walk above runs regardless and overrides `sectionHeading` when a stamp exists. Leave the heading walk untouched.

- [ ] **Step 2: Scope resolution in `paintHighlights`**

Replace `paintHighlights` in `anchor.ts`:

```ts
export interface PaintOutcome {
  painted: Set<string>;
  scopeAbsent: Set<string>; // anchors whose scope element is not in the DOM
}

/**
 * Paint highlights for anchors inside a rendered container. Anchors with a
 * scope are searched only inside matching [data-annot-scope] elements;
 * scopeless anchors keep container-wide matching. Anchors whose scope element
 * is absent (e.g., hidden by a filter) are reported, not unanchored.
 */
export function paintHighlights(
  container: HTMLElement,
  anchors: { id: string; quote: string; occurrenceIndex: number; scope?: string }[],
): PaintOutcome {
  clearHighlights(container);
  const painted = new Set<string>();
  const scopeAbsent = new Set<string>();
  const scopeEls = new Map<string, HTMLElement[]>();
  container.querySelectorAll<HTMLElement>("[data-annot-scope]").forEach((el) => {
    const key = el.dataset.annotScope ?? "";
    const list = scopeEls.get(key);
    if (list) list.push(el);
    else scopeEls.set(key, [el]);
  });
  for (const a of anchors) {
    if (a.scope) {
      const els = scopeEls.get(a.scope);
      if (!els) {
        scopeAbsent.add(a.id);
        continue;
      }
      // Duplicate scope ids are possible (twin timeline events); paint in the
      // first element where the anchor resolves.
      for (const el of els) {
        if (paintOne(el, a)) {
          painted.add(a.id);
          break;
        }
      }
    } else if (paintOne(container, a)) {
      painted.add(a.id);
    }
  }
  return { painted, scopeAbsent };
}
```

(`paintOne` needs no change — it already takes any `HTMLElement` root.)

- [ ] **Step 3: Thread scope through `AnnotationLayer`**

In `board/src/components/AnnotationLayer.tsx`:

1. `PaintableAnnotation` gains `scope?: string;`.
2. Add and export `AnchoredSelection` (shape in Interfaces above); change the `onAdd` prop type from the `Omit<PlanCommentAnnotation, …>` form to `(a: AnchoredSelection) => void`; drop the now-unused `PlanCommentAnnotation` import.
3. `onPaintResult` prop type becomes `(painted: Set<string>, docKey: string, scopeAbsent: Set<string>) => void`.
4. In the repaint effect, include scope and use the new return shape:

```ts
      const outcome = paintHighlights(
        el,
        annotations.map((a) => ({
          id: a.id,
          quote: a.quote,
          occurrenceIndex: a.occurrenceIndex,
          scope: a.scope,
        })),
      );
      onPaintResult(outcome.painted, docKey, outcome.scopeAbsent);
```

5. In `save()`, pass the scope through:

```ts
    onAdd({
      quote: pending.anchor.quote,
      prefix: pending.anchor.prefix,
      suffix: pending.anchor.suffix,
      sectionHeading: pending.anchor.sectionHeading,
      scope: pending.anchor.scope,
      occurrenceIndex: pending.anchor.occurrenceIndex,
      anchored: true,
      comment: text.trim(),
    });
```

- [ ] **Step 4: Generalize `onPaintResult` in `App.tsx`**

Replace the `onPaintResult` callback:

```ts
  const onPaintResult = useCallback(
    (painted: Set<string>, docKey?: string, scopeAbsent?: Set<string>) => {
      setAnnotations((prev) => {
        let changed = false;
        const next = prev.map((a) => {
          // A paint pass only covers ONE displayed document; comments on other
          // documents must not have their anchored flag clobbered by it.
          if (a.type === "plan-comment") {
            if (docKey !== undefined && a.planPath !== docKey) return a;
            const anchored = painted.has(a.id);
            if (painted.size === 0 || a.anchored === anchored) return a;
            changed = true;
            return { ...a, anchored };
          }
          if (a.type === "doc-comment") {
            if (docKey !== undefined && a.docKey !== docKey) return a;
            // Scope element hidden (e.g., timeline filter): not unanchored.
            if (scopeAbsent?.has(a.id)) return a;
            const anchored = painted.has(a.id);
            if (a.anchored === anchored) return a;
            changed = true;
            return { ...a, anchored };
          }
          return a;
        });
        return changed ? next : prev;
      });
    },
    [],
  );
```

In `PlanReader.tsx` and `Results.tsx`, widen the `onPaintResult` prop *type* to `(painted: Set<string>, docKey: string, scopeAbsent: Set<string>) => void` (two one-line type edits; the passed value is unchanged). In `PlanReader.tsx`'s `onAddPlanComment` call nothing changes — the spread now also carries `scope`, which `PlanCommentAnnotation` accepts as optional.

- [ ] **Step 5: Typecheck + tests**

Run: `npx tsc --noEmit && npm test`
Expected: clean; all tests PASS (no behavior change for plans/results — verify no test regressions).

- [ ] **Step 6: Commit**

```bash
cd /Users/bk/github/research-plans
git add board/src/lib/anchor.ts board/src/components/AnnotationLayer.tsx board/src/App.tsx board/src/views/PlanReader.tsx board/src/views/Results.tsx
git commit -m "board: scope-anchored highlights — stamps override heading labels, occurrence counted per element, filter-safe flags"
```

---

### Task 3: Wire the three views + stamps + copy + CSS + gateDeny

**Files:**
- Modify: `board/src/views/Tracker.tsx`
- Modify: `board/src/views/Timeline.tsx`
- Modify: `board/src/views/Scorecard.tsx`
- Modify: `board/src/App.tsx` (view props, `addDocComment`, copy, `gateDeny`)
- Modify: `board/src/index.css` (highlight rule)

**Interfaces:**
- Consumes: `AnchoredSelection`, 3-arg `onPaintResult`, `DocCommentAnnotation`, `addDocComment`.
- Produces: each view accepts `annotations: Annotation[]`, `onAddDocComment: (a: Omit<DocCommentAnnotation, "id" | "type">) => void`, `onPaintResult` (3-arg shape). docKeys: `"tracker"`, `"timeline"`, review payload path.

- [ ] **Step 1: `addDocComment` in App + pass props**

In `App.tsx` add beside the other add-callbacks:

```ts
  const addDocComment = useCallback(
    (a: Omit<DocCommentAnnotation, "id" | "type">) => {
      setAnnotations((prev) => [
        ...prev,
        { ...a, id: nextId(), type: "doc-comment" },
      ]);
      setDrawerOpen(true);
    },
    [],
  );
```

(import `DocCommentAnnotation` type). Pass to the views:

```tsx
        {tab === "tracker" && (
          <Tracker
            data={data}
            canAnnotate={canAnnotate}
            annotations={annotations}
            onAddDocComment={addDocComment}
            onPaintResult={onPaintResult}
            onAddGeneral={addGeneral}
            onOpenComponent={...unchanged...}
            onOpenResults={...unchanged...}
          />
        )}
```

and equivalently add `annotations`, `onAddDocComment`, `onPaintResult` to the `<Timeline …>` and `<Scorecard …>` elements.

- [ ] **Step 2: Tracker wiring + stamps**

In `Tracker.tsx`: import `AnnotationLayer` (default) alongside the existing `GeneralCommentBox` import, plus types `Annotation`, `DocCommentAnnotation`. Extend props:

```ts
  annotations: Annotation[];
  onAddDocComment: (a: Omit<DocCommentAnnotation, "id" | "type">) => void;
  onPaintResult: (painted: Set<string>, docKey: string, scopeAbsent: Set<string>) => void;
```

Compute the view's own annotations and an add-adapter near the top of the component:

```ts
  const docAnnotations = annotations.filter(
    (a): a is DocCommentAnnotation =>
      a.type === "doc-comment" && a.docKey === "tracker",
  );
  const addComment = (partial: AnchoredSelection) =>
    onAddDocComment({ ...partial, view: "tracker", docKey: "tracker" });
```

(import `AnchoredSelection` from `../components/AnnotationLayer`.)

Wrap BOTH return paths. The `!mp.ok` fallback:

```tsx
    return (
      <div>
        <Notice text="The master plan did not match the expected format — showing it raw." />
        {canAnnotate ? (
          <AnnotationLayer
            docKey="tracker"
            annotations={docAnnotations}
            onPaintResult={onPaintResult}
            onAdd={addComment}
          >
            <Markdown source={mp.raw} />
          </AnnotationLayer>
        ) : (
          <Markdown source={mp.raw} />
        )}
      </div>
    );
```

The main return: wrap everything from the title `<div className="mb-1 …">` through the sequencing-notes section in the same conditional `AnnotationLayer` (GeneralCommentBox stays OUTSIDE the layer — its textarea would otherwise trigger the comment bubble). Concretely:

```tsx
  const body = (
    <>
      {/* existing content from the title div down to the sequencing section,
          with the stamps below added */}
    </>
  );
  return (
    <div>
      {canAnnotate ? (
        <AnnotationLayer
          docKey="tracker"
          annotations={docAnnotations}
          onPaintResult={onPaintResult}
          onAdd={addComment}
        >
          {body}
        </AnnotationLayer>
      ) : (
        body
      )}
      {canAnnotate && (
        <p className="mt-2 text-xs text-stone-400">
          Select any text to attach a comment.
        </p>
      )}
      {canAnnotate && <GeneralCommentBox view="Tracker" onAdd={onAddGeneral} />}
    </div>
  );
```

Stamps (attribute pairs added to existing elements, nothing else changes):

- status-chip strip `<div className="mb-4 flex flex-wrap gap-2">` → `data-annot-scope="chips" data-annot-section="status summary"`
- Project-context `<section>` → `data-annot-scope="context" data-annot-section="Project context"`
- each RQ `<li key={q.num} …>` → `data-annot-scope={`rq:${q.num}`} data-annot-section={`RQ${q.num}`}`
- each component `<tr key={i} …>` → `data-annot-scope={`row:${r.num}`} data-annot-section={`row ${r.num}: ${r.component}`}`
- drift notice `<div className="mt-3 rounded-md border border-red-200 …">` → `data-annot-scope="drift" data-annot-section="drift notice"`
- Sequencing `<section>` → `data-annot-scope="sequencing" data-annot-section="Sequencing notes"`

- [ ] **Step 3: Timeline wiring + stamps**

Same prop additions and imports as Tracker. Annotations filter uses `a.docKey === "timeline"`; add-adapter uses `view: "timeline", docKey: "timeline"`.

Wrap ONLY the `<ol>` events list (filter chips, search input, and empty state stay outside):

```tsx
        {canAnnotate ? (
          <AnnotationLayer
            docKey="timeline"
            annotations={docAnnotations}
            onPaintResult={onPaintResult}
            onAdd={addComment}
          >
            {list}
          </AnnotationLayer>
        ) : (
          list
        )}
```

where `list` is the existing `<ol className="relative ml-2 …">…</ol>` expression assigned to a const.

Stamp each event card — on the card `<div className="rounded-lg border border-stone-200 bg-white p-3">`:

```tsx
  data-annot-scope={`evt:${e.kind}:${e.sortKey}:${e.title}`}
  data-annot-section={`${KIND_STYLE[e.kind].label} ${e.sortKey.replace(/ 00:00$/, "")}${e.title ? ` — ${e.title}` : ""}`}
```

(Scope is content-derived so it is filter-invariant; twin events — e.g., two verdicts on the same bundle the same day — share a scope and paint in the first matching card. Accepted in the spec.)

Add the footer hint after the list/empty-state, before the GeneralCommentBox:

```tsx
      {canAnnotate && (
        <p className="mt-2 text-xs text-stone-400">
          Select any text to attach a comment.
        </p>
      )}
```

- [ ] **Step 4: Reviews (Scorecard) wiring + stamps**

Same prop additions and imports. This view shows ONE review at a time; the docKey is that file's payload path:

```ts
  const docAnnotations = annotations.filter(
    (a): a is DocCommentAnnotation =>
      a.type === "doc-comment" && a.docKey === review.path,
  );
  const addComment = (partial: AnchoredSelection) =>
    onAddDocComment({
      ...partial,
      view: "reviews",
      docKey: review.path,
      // raw reviews have no headings; never leave the label blank
      sectionHeading:
        partial.sectionHeading || (review.path.split("/").pop() ?? review.path),
    });
```

(Place these AFTER the `reviews.length === 0` early return, since `review` must exist.)

Wrap the main pane's content — inside `<div className="min-w-0 flex-1">`, wrap the whole `{!sc ? … : …}` block in the conditional AnnotationLayer (same pattern as Tracker; extract to a `body` const). `GeneralCommentBox` and the new footer hint go outside the layer, in that order: hint first, then the box (matching the other views).

Stamps:

- threshold box `<div className={`rounded-lg border p-4 …`}>` → `data-annot-scope="threshold" data-annot-section="threshold"`
- score header `<div className="rounded-lg border border-stone-200 bg-white p-5">` → `data-annot-scope="score" data-annot-section="score"`
- each rubric `<tr key={item.id} …>` → `data-annot-scope={`item:${item.id}`} data-annot-section={`item ${item.id}${item.name ? `: ${item.name}` : ""}`}`
- top-revisions `<div className="rounded-lg border border-stone-200 bg-white p-4">` → `data-annot-scope="revisions" data-annot-section="Top revisions"`
- split box → `data-annot-scope="split" data-annot-section="Split assessment"`

The `!sc` raw-markdown path gets no stamps (heading walk + filename fallback covers it).

- [ ] **Step 5: Copy changes + CSS + gateDeny (App.tsx, index.css)**

1. Remote banner (App.tsx, the `remote &&` block): replace the sentence
   `Select text in any plan to attach a comment, or use the comment boxes on the other tabs.`
   with
   `Select text in any view to attach a comment — plans, tracker rows, timeline entries, results, and reviews all take them.`
2. Drawer empty state: replace
   `Select text in a plan or add a general comment on any view.`
   with
   `Select text in any view or add a general comment.`
3. `gateDeny` body gains the client-assembled document:

```ts
        body: JSON.stringify({ annotations, feedbackMarkdown, payloadHash, feedbackDocument }),
```

4. `board/src/index.css`: the highlight rule is scoped to rendered markdown and would leave marks in table cells/cards unstyled. Change the selector

```css
.prose-md mark[data-annotation] {
```

to

```css
mark[data-annotation] {
```

(keep the declarations; native browser mark styling is overridden everywhere).

- [ ] **Step 6: Typecheck + tests + visual check**

Run: `npx tsc --noEmit && npm test`
Expected: clean, PASS.

Run `npm run dev` (dev server renders `dev-data.ts`) and verify with the playwright tools or by hand:
- Tracker: select text inside a component row → bubble → save → drawer shows `Tracker · row N: <name>`; highlight visible (amber) in the table cell; switch tab and back → highlight repaints.
- Tracker: select a sentence in Project context → label `Project context`.
- Timeline: apply a filter that hides an annotated card → its drawer item does NOT flip to "unanchored"; create a comment while filtered, clear the filter → highlight paints on the right card.
- Reviews: comment on a rubric row → `Reviews · item <id>: <name>`.
- Plans: existing select-comment still works, unchanged labels.

Then kill the dev server.

- [ ] **Step 7: Commit**

```bash
cd /Users/bk/github/research-plans
git add board/src/views/Tracker.tsx board/src/views/Timeline.tsx board/src/views/Scorecard.tsx board/src/App.tsx board/src/index.css
git commit -m "board: select-to-comment on Tracker, Timeline, and Reviews with element stamps; global mark styling; gate-deny sends assembled document"
```

---

### Task 4: Results — drag gesture replaces click-to-prompt

**Files:**
- Modify: `board/src/views/Results.tsx`

**Interfaces:**
- Consumes: `AnchoredSelection`, scoped `AnnotationLayer` (Task 2). No type changes: `ResultCommentAnnotation.target` already has optional `quote`/`occurrenceIndex`.
- Produces: metric/artifact comments as `result-comment` with quotes; one layer per bundle, `docKey` = `bundle.dir`.

- [ ] **Step 1: Remove the click-to-prompt affordances**

1. Metric tiles: change the `<button …>` per metric to a `<div>` — drop `disabled`, `onClick`, and `title` entirely; add stamps:

```tsx
              <div
                key={metric.label}
                data-annot-scope={`metric:${metric.label}`}
                data-annot-section={`metric ${metric.label}`}
                className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-left"
              >
```

2. Artifact cards: delete the whole `{canAnnotate && (<button … window.prompt …>comment…</button>)}` block, the now-unused `addArtifactComment` helper, and the now-unused `nComments` computation. Add stamps to the card root:

```tsx
                <div
                  key={art.id}
                  data-annot-scope={`artifact:${art.id}`}
                  data-annot-section={`artifact ${art.id}: ${art.title}`}
                  className="rounded-lg border border-stone-200 bg-white p-4"
                >
```

- [ ] **Step 2: One layer over metrics + report + gallery**

1. Stamp the report `<section>`: `data-annot-scope="report" data-annot-section="report"`, and remove the report's own nested `<AnnotationLayer>` (keep the plain `<Markdown source={bundle.report.content} />` — nested layers would both react to one mouseup).
2. Extract the three regions (metrics strip, report section, artifact gallery) into a `bundleBody` fragment and wrap it once:

```tsx
        {canAnnotate ? (
          <AnnotationLayer
            docKey={bundle.dir}
            annotations={paintable}
            onPaintResult={onPaintResult}
            onAdd={addSelectionComment}
          >
            {bundleBody}
          </AnnotationLayer>
        ) : (
          bundleBody
        )}
```

(Version strip, verdict banner, provenance `<details>`, and the script drawer stay outside the layer.)

3. Define the router and paint set above the return (replacing the old `reportComments` mapping):

```tsx
  const addSelectionComment = (partial: AnchoredSelection) => {
    const base = {
      component: group.component,
      resultsVersion: bundle.resultsVersion,
      comment: partial.comment,
    };
    const target =
      partial.scope.startsWith("metric:")
        ? {
            kind: "metric" as const,
            metricLabel: partial.scope.slice("metric:".length),
            quote: partial.quote,
            occurrenceIndex: partial.occurrenceIndex,
          }
        : partial.scope.startsWith("artifact:")
          ? {
              kind: "artifact" as const,
              artifactId: partial.scope.slice("artifact:".length),
              quote: partial.quote,
              occurrenceIndex: partial.occurrenceIndex,
            }
          : {
              kind: "report" as const,
              quote: partial.quote,
              occurrenceIndex: partial.occurrenceIndex,
            };
    onAddResultComment({ ...base, target });
  };

  // Only quote-carrying comments paint; scope re-derived from the target.
  const paintable = bundleAnnotations
    .filter(
      (a): a is ResultCommentAnnotation =>
        a.type === "result-comment" && Boolean(a.target.quote),
    )
    .map((a) => ({
      id: a.id,
      quote: a.target.quote!,
      occurrenceIndex: a.target.occurrenceIndex ?? 0,
      scope:
        a.target.kind === "metric"
          ? `metric:${a.target.metricLabel}`
          : a.target.kind === "artifact"
            ? `artifact:${a.target.artifactId}`
            : "report",
    }));
```

(import `AnchoredSelection` from `../components/AnnotationLayer`; `reportComments` is gone — remove its `ResultCommentAnnotation`-narrowing import only if now unused.)

Note: selections outside any stamp (gaps between cards) fall back to `kind: "report"`; their container-wide occurrence may not repaint (result comments track no anchored flag — harmless, and the comment still reaches the drawer/feedback with its quote).

- [ ] **Step 3: Typecheck + tests + visual check**

Run: `npx tsc --noEmit && npm test`
Expected: clean, PASS.

In `npm run dev`: click a metric tile → NOTHING pops up; drag-select the metric value → Comment bubble; save → drawer shows `<component> rN · metric <label>`. Drag an artifact title → `… · artifact <id>`. Drag report text → works as before. Verdict buttons still work.

- [ ] **Step 4: Commit**

```bash
cd /Users/bk/github/research-plans
git add board/src/views/Results.tsx
git commit -m "board: Results joins the drag-to-comment gesture — metric tiles and artifact cards lose window.prompt popups"
```

---

### Task 5: Consumer docs, changelog, version bump, template rebuild

**Files:**
- Modify: `commands/board.md` (line 27)
- Modify: `CHANGELOG.md`, `board/package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
- Regenerate: `skills/managing-research-plans/assets/board-template.html` (via build)

**Interfaces:**
- Consumes: everything above; feedback headers `[Tracker — …]`, `[Timeline — …]`, `[Reviews — …]`.

- [ ] **Step 1: Consumer rules in `commands/board.md`**

Replace the line
`   - **General / tracker / timeline / review comments**: answer or act as appropriate.`
with:

```markdown
   - **Tracker comments** (`[Tracker — row 3: …]`, `[Tracker — Project context]`): anchored to the master plan's rendered view; these may lead to master-plan edits (status, Outcome/notes, Serves, context) under the normal tracker rules.
   - **Timeline comments** (`[Timeline — Decision 2026-07-06 16:24]`): when they target a decision-log entry, NEVER rewrite the entry — the log is append-only. Discuss with the researcher; if the exchange changes scope or course, append a new entry. Synthetic cards (plan/results/verdict events) follow the rules of the artifact they reference.
   - **Review comments** (`[Reviews — item G3: …]`): saved reviews are records of a past review — never edit them. Comments feed a discussion, a re-run of /research-plans:review, or a plan revision.
   - **General view comments**: answer or act as appropriate.
```

- [ ] **Step 2: Changelog + versions**

Add at the top of `CHANGELOG.md` (below `# Changelog`):

```markdown
## 0.6.2 (2026-07-06)

- **Board: select-to-comment everywhere** — the Plans gesture now works on the
  Tracker (component rows, RQs, context/sequencing prose), Timeline (individual
  event cards), and Reviews (threshold, rubric items, top revisions, split)
  views. Comments arrive labeled with the exact element ("row 3: …",
  "Decision 2026-07-06 16:24", "item G3: …").
- **Scoped anchors**: highlights are anchored inside the stamped element
  (stable `data-annot-scope` ids), so short repeated strings can't repaint on
  the wrong row and timeline filtering can't corrupt or mis-flag comments
  (found in cross-model review, Codex GPT-5.5).
- **Results uses the same gesture**: metric tiles and artifact cards no longer
  pop a `window.prompt` on click — drag-select there like everywhere else;
  comments keep their structured metric/artifact/report targets.
- Highlight styling applies outside rendered markdown (table cells, cards);
  sign-off gate "request changes" now sends the same client-assembled feedback
  document as every other path.
```

Bump `"version"` to `"0.6.2"` in `board/package.json`, `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json`.

- [ ] **Step 3: Rebuild the template**

```bash
cd board && npm test && npm run build
```
Expected: tests PASS; build writes `dist/index.html` and copies it to `../skills/managing-research-plans/assets/board-template.html`. Sanity-check the template still has exactly one data slot:

```bash
grep -c 'id="board-data"' ../skills/managing-research-plans/assets/board-template.html
```
Expected: `1` (if the slot marker differs, check `SLOT` in `scripts/board.py` and grep for that instead).

- [ ] **Step 4: Commit + wrap up**

```bash
cd /Users/bk/github/research-plans
git add commands/board.md CHANGELOG.md board/package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json skills/managing-research-plans/assets/board-template.html docs/specs/2026-07-06-board-doc-comments-design.md docs/plans/2026-07-06-board-doc-comments.md logs 2>/dev/null || true
git status --short   # confirm plans/, CLAUDE.md, docs/ROADMAP.md are NOT staged; logs/ should be gitignored — if `git add logs` staged anything, unstage it
git commit -m "v0.6.2: anchored comments on Tracker, Timeline, and Reviews; scoped highlight anchors; docs + spec + plan"
```

Note: `logs/` must stay uncommitted (user rule: never commit logs). The `git add logs` above only exists to surface a mistake via `git status` if logs/ is not ignored — if it stages files, run `git restore --staged logs` and add `logs/` to `.gitignore` first.

Do NOT merge to main or push — offer the researcher the choice (merge / PR / hold) when everything above is green.
