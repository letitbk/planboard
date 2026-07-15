# Board Sidebar (Outline + Files) Implementation Plan — v3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one global, collapsible left panel to the board with an **Outline** sub-tab (per-view navigation) and a **Files** sub-tab (a by-component logical navigator of `plans/` artifacts), consolidating the four per-view sidebars the document views render today.

**Architecture:** All front-end, in `board/src`. App owns two new pieces of state — `outline` (the current view's entries) and the derived `filesTree` — plus a shared `applyRoute(target)` primitive that generalizes the existing `openReport`/`openAnnotation`. A new `Sidebar` renders both sub-tabs. Each view publishes its outline through an optional `onOutline` callback and drops its own `<aside>`; Files routing reuses the existing `navTargetFor`/`setNavRequest` plumbing. No `board.py`, payload-format, or `plans/` changes.

**Tech Stack:** React 19, TypeScript 5.6, Vite 6, Tailwind 4, Vitest 3, @testing-library/react. Board is bundled to a single file via `vite-plugin-singlefile`.

**v2 note:** this revision folds in a verified Codex review of v1. The material changes: `onOutline` is staged per-view (never passed to a view before that view accepts it), the Reports outline reads rendered heading nodes (no markdown re-parser, no render loop), Results cross-component routing is fixed, every execution group gets a Plans route (draft-only components stay reachable), all new hooks are placed before each view's early return with stable primitive dependencies, active-highlight is scoped to plans/results/reports, and the Sidebar scrolls independently.

**v3 note:** a second Codex pass verified v2 fixed all seven prior findings, then found more. This revision adds: Task 4 passes `onOutline` to NO view (PlanReader's prop + pass both land in Task 5, so Task 4's isolated state typechecks); the Results outline normalizes `metrics`/`artifacts` with `Array.isArray` (a metrics-less manifest must not crash — Results.tsx:622); **review-only components (a parseable review whose `component` has no execution group) get NO Plans node** (only real execution groups do); Timeline outline ids are index-keyed (same-date events collided); Archive explicitly clears the outline; the Sidebar honors App's measured sticky-header offset (`headerOffset`) in `top`/`maxHeight`; Task 11 stubs `window.matchMedia` (ThemeToggle needs it under jsdom) and **commits the rebuilt `board-template.html`** (the plugin ships the board from that asset); and the auto-collapse default uses a mode-independent `useMediaQuery("(pointer: coarse)")` instead of the hosted-only `isTouch`.

## Global Constraints

- Work only inside `board/` — one exception: Task 11 rebuilds and commits the generated `skills/managing-research-plans/assets/board-template.html` (the compiled single-file board is how the plugin ships this UI). No `board.py`, no payload schema, no `plans/` content changes.
- Data shapes (verbatim): reviews are raw `BoardFile[]` parsed on demand with `parseScorecard`; a results bundle exposes `resultsVersion`, `report: BoardFile | null`, `publishedReport: BoardFile | null`, `reportFormats?: { pdf; docx }`; `ExecutionPlanGroup` has `versions: PlanVersionFile[]` and optional `draft`, `draftSnapshots`, `results`; `parseExecutionPlan(...).sections` items are `{ heading: string; content: string }` (no `level`). Do not invent fields.
- `NavTarget` (from `board/src/lib/navTarget.ts`): `tab` ∈ `tracker|plans|results|timeline|reviews|archive|reports` (no `models`, no `reportPath` — reports route by `resultsVersion`), optional `component|planPath|resultsVersion|scriptPath|archivePath|reviewPath|clearTimelineFilter`, required `annotationId: string` and `anchored: boolean`. Build non-annotation routes with `annotationId: ""`. (No change to this type is required.)
- `navRequest` is retained state, not a consumed one-shot: `App` stores it and each view reacts to its `token`; a remount can re-apply it. Preserve that behavior.
- The `Markdown` component (`board/src/components/Markdown.tsx`) renders headings with **no `id`**. To scroll within a rendered markdown body, capture the rendered heading element and call `scrollIntoView` (as `PlanReader.scrollToSection` does), or scroll to a wrapper you add an `id` to. Never scroll to markdown-heading ids that don't exist.
- React Rules of Hooks: every new `useMemo`/`useEffect`/`useRef` must be placed BEFORE the view's first early `return`, and its dependency array must use STABLE primitives (content strings, `bundle?.dir`, `baselineHash`, numbers) — never arrays/objects rebuilt each render.
- Test env: lib tests run in node (no pragma); component tests start with `// @vitest-environment jsdom`. `Element.prototype.scrollIntoView` and `getElementById(...).scrollIntoView` are not implemented in jsdom — do NOT invoke an entry's `onSelect` in a test unless you first stub `Element.prototype.scrollIntoView = vi.fn()`. Assert on published entries (labels/levels/ids) instead. Direct calls to a published `onSelect` that sets React state must be wrapped in `act(...)`.
- Run a single file with `npx vitest run <path>` (from `board/`); the whole suite with `npm test`. Verify the build with `npm run build` (compiles and copies `dist/index.html` → `../skills/managing-research-plans/assets/board-template.html`).
- v1 active-highlight in Files is **component + tab only**, and only when `activeTab` ∈ `{plans, results, reports}`. Exact-leaf highlight (which `vN`/`rN`/review is open) is out of scope — do not lift per-view selection state.

## Phases

- **Phase 1 (Tasks 1–6):** foundation + a working, shippable panel — `OutlineEntry` + a DOM heading helper, `buildFilesTree`, the `Sidebar`, App wiring, PlanReader consolidated, and the Results cross-component routing fix (reachable as soon as Files renders results leaves). Ships value on its own; checkpoint after Task 6.
- **Phase 2 (Tasks 7–11):** consolidate the remaining views — Reports, Results, Scorecard drop their picker asides and publish outlines; Tracker, Timeline, Models add semantic outlines — plus a static-mode render/route test.

## Shared recipe: publishing a view's outline

Every Phase-2 view follows the same shape. Place these BEFORE the view's first early return, using the per-view lines given in each task:

```tsx
// 1) prop: add to the destructured params and the Props type
  onOutline?: (entries: OutlineEntry[]) => void;

// 2) import
import type { OutlineEntry } from "../lib/outline";

// 3) build entries from a STABLE primitive dep, then publish + clean up
  const outlineEntries = useMemo<OutlineEntry[]>(() => /* per-view */ [], [/* stable deps */]);
  useEffect(() => {
    onOutline?.(outlineEntries);
    return () => onOutline?.([]);
  }, [onOutline, outlineEntries]);
```

Then App passes `onOutline={setOutline}` to that view (added in the same task, so every commit typechecks), and the view's `<aside>` (if any) is removed and its wrapper `<div className="flex gap-5">` becomes `<div className="min-w-0">`.

---

## Task 1: `OutlineEntry` type + DOM heading helper

**Files:**
- Create: `board/src/lib/outline.ts`
- Test: `board/src/lib/outline.test.tsx`

**Interfaces:**
- Produces: `interface OutlineEntry { id: string; label: string; level: number; onSelect: () => void }`; `function outlineFromContainer(root: HTMLElement | null): OutlineEntry[]` — reads rendered `h1/h2/h3`, one entry per heading (index-keyed, so duplicate headings stay distinct), `onSelect` scrolls that exact element.

- [ ] **Step 1: Write the failing test**

```tsx
// board/src/lib/outline.test.tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { outlineFromContainer } from "./outline";

describe("outlineFromContainer", () => {
  it("builds one entry per rendered heading with levels, keeping duplicates distinct", () => {
    const root = document.createElement("div");
    root.innerHTML = "<h1>Title</h1><p>x</p><h2>Section</h2><h3>Sub</h3><h2>Section</h2>";
    const entries = outlineFromContainer(root);
    expect(entries.map((e) => [e.label, e.level])).toEqual([
      ["Title", 1],
      ["Section", 2],
      ["Sub", 3],
      ["Section", 2],
    ]);
    expect(new Set(entries.map((e) => e.id)).size).toBe(4); // ids unique despite duplicate labels
  });

  it("returns [] for a null container", () => {
    expect(outlineFromContainer(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd board && npx vitest run src/lib/outline.test.tsx`
Expected: FAIL (`outlineFromContainer` is not defined).

- [ ] **Step 3: Write minimal implementation**

```ts
// board/src/lib/outline.ts

/** A single entry in the sidebar Outline; `onSelect` performs the in-view jump. */
export interface OutlineEntry {
  id: string;
  label: string;
  level: number; // 1..3
  onSelect: () => void;
}

/** Build an outline from the rendered headings inside `root` (one entry each,
 *  index-keyed so duplicate heading text stays addressable). onSelect scrolls
 *  the captured element — the Markdown renderer adds no ids, so we hold nodes. */
export function outlineFromContainer(root: HTMLElement | null): OutlineEntry[] {
  if (!root) return [];
  const heads = Array.from(root.querySelectorAll("h1, h2, h3")) as HTMLElement[];
  return heads.map((h, i) => ({
    id: `h-${i}`,
    label: (h.textContent ?? "").trim(),
    level: Number(h.tagName[1]),
    onSelect: () => h.scrollIntoView({ behavior: "smooth", block: "start" }),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd board && npx vitest run src/lib/outline.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add board/src/lib/outline.ts board/src/lib/outline.test.tsx
git commit -m "feat(board): OutlineEntry type + DOM heading outline helper"
```

---

## Task 2: `buildFilesTree` logical navigator

**Files:**
- Create: `board/src/lib/filesTree.ts`
- Test: `board/src/lib/filesTree.test.ts`

**Interfaces:**
- Consumes: `BoardData`, `BoardFile` (`./types`); `NavTarget` (`./navTarget`); `parseScorecard`, `preRenewalSlugs` (`./parse`).
- Produces: `interface FileNode { id: string; label: string; badge?: string; route?: NavTarget; children?: FileNode[] }`; `function buildFilesTree(data: BoardData): FileNode[]`.

**Decisions baked in (from review):**
- **Every execution group gets a Plans entry point.** With signed versions, "Plans" is a group of `vN` leaves; with only a draft, "Plans" is a leaf routing to `{tab:"plans", component}` — so draft-only components stay reachable. **A review-only component (a parseable review whose `component` has NO execution group) gets NO Plans node** (it would misroute); it shows only its Reviews.
- **Reports leaves require `publishedReport`** (a Files leaf means "a published report exists"; report generation remains a board action, not a file).

- [ ] **Step 1: Write the failing test**

```ts
// board/src/lib/filesTree.test.ts
import { describe, expect, it } from "vitest";
import { buildFilesTree, type FileNode } from "./filesTree";
import type { BoardData, BoardFile } from "./types";

function review(component: string | null, version: number): BoardFile {
  const block = component
    ? "```json board-scorecard\n" +
      JSON.stringify({ schemaVersion: 1, component, planVersion: version, items: [] }) +
      "\n```\n"
    : "no scorecard here";
  return { path: `plans/reviews/${component ?? "junk"}-v${version}.md`, content: block };
}

function bundle(v: number, withReport: boolean) {
  return {
    resultsVersion: v,
    dir: `plans/results/01-x/r${v}`,
    manifest: null,
    manifestRaw: { path: `plans/results/01-x/r${v}/manifest.json`, content: "{}" },
    report: { path: `plans/results/01-x/r${v}/report.md`, content: "# r" },
    verdict: null,
    verdictRaw: null,
    scripts: [],
    assets: {},
    publishedReport: withReport
      ? { path: `plans/reports/01-x-r${v}-report.md`, content: "# pub" }
      : null,
  };
}

function data(): BoardData {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-14T00:00",
    mode: "static",
    focus: null,
    project: { name: "p" },
    git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [
        {
          component: "01-x",
          versions: [
            { version: 1, path: "plans/execution/01-x/v1.md", content: "a" },
            { version: 2, path: "plans/execution/01-x/v2.md", content: "b" },
          ],
          results: [bundle(1, true), bundle(2, false)],
        },
        { component: "02-draft-only", versions: [], draft: { path: "plans/execution/02-draft-only/.draft-v1.md", content: "d", proposedVersion: 1 } },
      ],
      reviews: [review("01-x", 2), review("03-review-only", 1), review(null, 9)],
    },
  } as unknown as BoardData;
}

function child(node: FileNode, id: string): FileNode {
  return node.children!.find((c) => c.id === id)!;
}

describe("buildFilesTree", () => {
  it("puts master plan and decision log at the top with routes", () => {
    const tree = buildFilesTree(data());
    expect(tree[0]).toMatchObject({ id: "master-plan", route: { tab: "tracker", annotationId: "" } });
    expect(tree[1]).toMatchObject({ id: "decision-log", route: { tab: "timeline" } });
  });

  it("groups a component's plans/results/reports/reviews; Plans is a group of versions", () => {
    const comp = buildFilesTree(data()).find((n) => n.id === "component:01-x")!;
    const plans = child(comp, "01-x:plans");
    expect(plans.children!.map((c) => c.label)).toEqual(["v1", "v2"]);
    expect(plans.children!.find((c) => c.label === "v2")).toMatchObject({
      badge: "latest",
      route: { tab: "plans", component: "01-x", planPath: "plans/execution/01-x/v2.md" },
    });
    expect(child(comp, "01-x:results").children!.map((c) => c.label)).toEqual(["r1", "r2"]);
    // only r1 has a published report:
    expect(child(comp, "01-x:reports").children!.map((c) => c.label)).toEqual(["r1 report"]);
    expect(child(comp, "01-x:reviews").children!.length).toBe(1);
  });

  it("gives a draft-only component a Plans leaf that routes to its Plans view", () => {
    const comp = buildFilesTree(data()).find((n) => n.id === "component:02-draft-only")!;
    const plans = child(comp, "02-draft-only:plans");
    expect(plans.children).toBeUndefined();
    expect(plans.route).toMatchObject({ tab: "plans", component: "02-draft-only" });
  });

  it("gives a review-only component (no execution group) Reviews but no Plans node", () => {
    const comp = buildFilesTree(data()).find((n) => n.id === "component:03-review-only")!;
    expect(comp.children!.map((c) => c.id)).toEqual(["03-review-only:reviews"]);
  });

  it("routes an unparseable review to an Unassigned reviews node", () => {
    const un = buildFilesTree(data()).find((n) => n.id === "unassigned-reviews")!;
    expect(un.children![0].route).toMatchObject({ tab: "reviews", reviewPath: "plans/reviews/junk-v9.md" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd board && npx vitest run src/lib/filesTree.test.ts`
Expected: FAIL (`buildFilesTree` is not defined).

- [ ] **Step 3: Write minimal implementation**

```ts
// board/src/lib/filesTree.ts
import type { BoardData, BoardFile } from "./types";
import type { NavTarget } from "./navTarget";
import { parseScorecard, preRenewalSlugs } from "./parse";

export interface FileNode {
  id: string;
  label: string;
  badge?: string;
  route?: NavTarget; // present on navigable leaves
  children?: FileNode[];
}

function route(partial: Partial<NavTarget> & { tab: NavTarget["tab"] }): NavTarget {
  return { annotationId: "", anchored: false, ...partial };
}

function reviewLabel(r: BoardFile): string {
  const sc = parseScorecard(r.content);
  if (sc) {
    const tail =
      sc.threshold?.verdict === "fail"
        ? "threshold failed"
        : sc.threshold?.verdict === "undetermined"
          ? "undetermined"
          : `${sc.percent}%`;
    return `v${sc.planVersion} — ${tail}`;
  }
  return r.path.split("/").pop() ?? r.path;
}

export function buildFilesTree(data: BoardData): FileNode[] {
  const nodes: FileNode[] = [
    { id: "master-plan", label: "Master plan", route: route({ tab: "tracker" }) },
    { id: "decision-log", label: "Decision log", route: route({ tab: "timeline" }) },
  ];

  const groups = data.files.executionPlans;
  const pre = preRenewalSlugs(data);

  const reviewsByComponent = new Map<string, BoardFile[]>();
  const unassigned: BoardFile[] = [];
  for (const r of data.files.reviews) {
    const sc = parseScorecard(r.content);
    if (sc?.component) {
      const list = reviewsByComponent.get(sc.component) ?? [];
      list.push(r);
      reviewsByComponent.set(sc.component, list);
    } else {
      unassigned.push(r);
    }
  }

  const componentIds = new Set<string>(groups.map((g) => g.component));
  for (const c of reviewsByComponent.keys()) componentIds.add(c);

  for (const comp of [...componentIds].sort()) {
    const g = groups.find((x) => x.component === comp);
    const children: FileNode[] = [];

    // Plans: ONLY for real execution groups. With signed versions → a group of
    // version leaves; a group with only a draft → a single Plans leaf (draft-only
    // components stay reachable). A review-only component (no execution group, e.g.
    // a review whose component was renamed/removed) gets NO Plans node — routing to
    // Plans there would silently fall back to another group (PlanReader.tsx:93).
    if (g) {
      const versions = g.versions ?? [];
      if (versions.length) {
        const latest = Math.max(...versions.map((v) => v.version));
        children.push({
          id: `${comp}:plans`,
          label: "Plans",
          children: versions
            .slice()
            .sort((a, b) => a.version - b.version)
            .map((v) => ({
              id: v.path,
              label: `v${v.version}`,
              badge: v.version === latest ? "latest" : undefined,
              route: route({ tab: "plans", component: comp, planPath: v.path }),
            })),
        });
      } else {
        children.push({
          id: `${comp}:plans`,
          label: "Plans",
          route: route({ tab: "plans", component: comp }),
        });
      }
    }

    if (g?.results?.length) {
      children.push({
        id: `${comp}:results`,
        label: "Results",
        children: g.results
          .slice()
          .sort((a, b) => a.resultsVersion - b.resultsVersion)
          .map((b) => ({
            id: `${comp}:r${b.resultsVersion}`,
            label: `r${b.resultsVersion}`,
            route: route({ tab: "results", component: comp, resultsVersion: b.resultsVersion }),
          })),
      });
    }

    const reportBundles = (g?.results ?? []).filter((b) => b.publishedReport);
    if (reportBundles.length) {
      children.push({
        id: `${comp}:reports`,
        label: "Reports",
        children: reportBundles
          .slice()
          .sort((a, b) => a.resultsVersion - b.resultsVersion)
          .map((b) => ({
            id: `${comp}:report:r${b.resultsVersion}`,
            label: `r${b.resultsVersion} report`,
            route: route({ tab: "reports", component: comp, resultsVersion: b.resultsVersion }),
          })),
      });
    }

    const revs = reviewsByComponent.get(comp) ?? [];
    if (revs.length) {
      children.push({
        id: `${comp}:reviews`,
        label: "Reviews",
        children: revs.map((r) => ({
          id: r.path,
          label: reviewLabel(r),
          route: route({ tab: "reviews", component: comp, reviewPath: r.path }),
        })),
      });
    }

    nodes.push({
      id: `component:${comp}`,
      label: comp,
      badge: pre.has(comp) ? "pre-renewal" : undefined,
      children,
    });
  }

  if (unassigned.length) {
    nodes.push({
      id: "unassigned-reviews",
      label: "Unassigned reviews",
      children: unassigned.map((r) => ({
        id: r.path,
        label: r.path.split("/").pop() ?? r.path,
        route: route({ tab: "reviews", reviewPath: r.path }),
      })),
    });
  }

  return nodes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd board && npx vitest run src/lib/filesTree.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add board/src/lib/filesTree.ts board/src/lib/filesTree.test.ts
git commit -m "feat(board): buildFilesTree logical navigator (every-component Plans route, published-report leaves)"
```

---

## Task 3: `Sidebar` component

**Files:**
- Create: `board/src/components/Sidebar.tsx`
- Test: `board/src/components/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `OutlineEntry` (`../lib/outline`), `FileNode` (`../lib/filesTree`), `NavTarget` (`../lib/navTarget`).
- Produces: `default function Sidebar(props: { outline: OutlineEntry[]; tree: FileNode[]; onNavigate: (t: NavTarget) => void; activeTab: string; activeComponent: string | null; storageKey: string; defaultCollapsed?: boolean }): JSX.Element`.

Fixes baked in: independent scroll (`overflow-y-auto`) + a sticky `topOffsetPx` offset; `defaultCollapsed` (App passes `isCoarse`, a mode-independent coarse-pointer check) honored when nothing is persisted; active-highlight only on `plans|results|reports`; leaf labels in their own `<span>` for reliable queries.

- [ ] **Step 1: Write the failing test**

```tsx
// board/src/components/Sidebar.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import Sidebar from "./Sidebar";
import type { FileNode } from "../lib/filesTree";
import type { OutlineEntry } from "../lib/outline";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const tree: FileNode[] = [
  { id: "master-plan", label: "Master plan", route: { tab: "tracker", annotationId: "", anchored: false } },
  {
    id: "component:01-x",
    label: "01-x",
    children: [
      {
        id: "01-x:plans",
        label: "Plans",
        children: [
          { id: "p1", label: "v1", route: { tab: "plans", component: "01-x", planPath: "p/v1.md", annotationId: "", anchored: false } },
        ],
      },
    ],
  },
];

function renderSidebar(over: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const onNavigate = vi.fn();
  const onSelect = vi.fn();
  const outline: OutlineEntry[] = [{ id: "g", label: "Goal", level: 1, onSelect }];
  render(
    <Sidebar
      outline={outline}
      tree={tree}
      onNavigate={onNavigate}
      activeTab="plans"
      activeComponent="01-x"
      storageKey="rp-sidebar:test"
      {...over}
    />,
  );
  return { onNavigate, onSelect };
}

describe("Sidebar", () => {
  it("shows Outline by default and fires onSelect", () => {
    const { onSelect } = renderSidebar();
    fireEvent.click(screen.getByText("Goal"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("switches to Files and navigates a leaf via its route", () => {
    const { onNavigate } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /files/i }));
    fireEvent.click(screen.getByText("Plans")); // expand depth-1 group
    fireEvent.click(screen.getByText("v1"));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ tab: "plans", planPath: "p/v1.md" }));
  });

  it("marks the active component only on plans/results/reports tabs", () => {
    const { onNavigate: _ } = renderSidebar({ activeTab: "reviews" });
    fireEvent.click(screen.getByRole("button", { name: /files/i }));
    expect(screen.getByText("01-x").closest("button")?.getAttribute("data-active")).toBeNull();
    cleanup();
    renderSidebar({ activeTab: "plans" });
    fireEvent.click(screen.getByRole("button", { name: /files/i }));
    expect(screen.getByText("01-x").closest("button")?.getAttribute("data-active")).toBe("true");
  });

  it("collapses, persists, and starts collapsed when defaultCollapsed and nothing stored", () => {
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(localStorage.getItem("rp-sidebar:test")).toContain("collapsed");
    expect(screen.queryByText("Goal")).toBeNull();
    cleanup();
    localStorage.clear();
    renderSidebar({ defaultCollapsed: true });
    expect(screen.queryByText("Goal")).toBeNull(); // honored default
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd board && npx vitest run src/components/Sidebar.test.tsx`
Expected: FAIL (cannot find `./Sidebar`).

- [ ] **Step 3: Write minimal implementation**

```tsx
// board/src/components/Sidebar.tsx
import { useState } from "react";
import type { NavTarget } from "../lib/navTarget";
import type { FileNode } from "../lib/filesTree";
import type { OutlineEntry } from "../lib/outline";

type SubTab = "outline" | "files";
interface Persisted { sub: SubTab; collapsed: boolean }
const HIGHLIGHT_TABS = new Set(["plans", "results", "reports"]);

function load(key: string, defaultCollapsed: boolean): Persisted {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { sub: "outline", collapsed: false, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { sub: "outline", collapsed: defaultCollapsed };
}

export default function Sidebar({
  outline,
  tree,
  onNavigate,
  activeTab,
  activeComponent,
  storageKey,
  defaultCollapsed = false,
  topOffsetPx = 16,
}: {
  outline: OutlineEntry[];
  tree: FileNode[];
  onNavigate: (t: NavTarget) => void;
  activeTab: string;
  activeComponent: string | null;
  storageKey: string;
  defaultCollapsed?: boolean;
  topOffsetPx?: number; // App's measured sticky-header height (headerOffset)
}) {
  const [state, setState] = useState<Persisted>(() => load(storageKey, defaultCollapsed));
  const persist = (next: Persisted) => {
    setState(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  if (state.collapsed) {
    return (
      <aside
        className="sticky w-8 shrink-0 self-start border-r border-stone-200 dark:border-stone-800"
        style={{ top: topOffsetPx }}
      >
        <button
          aria-label="Expand sidebar"
          className="w-full py-2 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
          onClick={() => persist({ ...state, collapsed: false })}
        >
          »
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="sticky w-56 shrink-0 self-start overflow-y-auto border-r border-stone-200 pr-3 dark:border-stone-800"
      style={{ top: topOffsetPx, maxHeight: `calc(100vh - ${topOffsetPx + 16}px)` }}
    >
      <div className="mb-3 flex items-center gap-1">
        {(["outline", "files"] as SubTab[]).map((s) => (
          <button
            key={s}
            className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
              state.sub === s
                ? "bg-stone-900 text-white dark:bg-stone-200 dark:text-stone-900"
                : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
            }`}
            onClick={() => persist({ ...state, sub: s })}
          >
            {s}
          </button>
        ))}
        <button
          aria-label="Collapse sidebar"
          className="ml-auto rounded px-1.5 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
          onClick={() => persist({ ...state, collapsed: true })}
        >
          «
        </button>
      </div>

      {state.sub === "outline" ? (
        <ul className="space-y-0.5">
          {outline.length === 0 && (
            <li className="px-2 py-1 text-xs text-stone-400">No outline for this view.</li>
          )}
          {outline.map((e) => (
            <li key={e.id}>
              <button
                className="w-full rounded px-2 py-1 text-left text-xs text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
                style={{ paddingLeft: `${0.5 + (e.level - 1) * 0.75}rem` }}
                onClick={e.onSelect}
              >
                {e.label}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-0.5">
          {tree.map((n) => (
            <TreeNode key={n.id} node={n} depth={0} onNavigate={onNavigate} activeTab={activeTab} activeComponent={activeComponent} />
          ))}
        </ul>
      )}
    </aside>
  );
}

function TreeNode({
  node,
  depth,
  onNavigate,
  activeTab,
  activeComponent,
}: {
  node: FileNode;
  depth: number;
  onNavigate: (t: NavTarget) => void;
  activeTab: string;
  activeComponent: string | null;
}) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = !!node.children?.length;
  const isActiveComponent =
    node.id === `component:${activeComponent}` && HIGHLIGHT_TABS.has(activeTab);

  return (
    <li>
      <button
        data-active={isActiveComponent ? "true" : undefined}
        className={`w-full rounded px-2 py-1 text-left text-xs hover:bg-stone-100 dark:hover:bg-stone-800 ${
          isActiveComponent
            ? "bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100"
            : "text-stone-600 dark:text-stone-400"
        }`}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
        onClick={() => (hasChildren ? setOpen((o) => !o) : node.route && onNavigate(node.route))}
      >
        {hasChildren && <span aria-hidden className="mr-1 text-stone-400">{open ? "▾" : "▸"}</span>}
        <span>{node.label}</span>
        {node.badge && (
          <span className="ml-1 rounded bg-stone-200 px-1 py-0.5 text-[10px] text-stone-600 dark:bg-stone-700 dark:text-stone-400">
            {node.badge}
          </span>
        )}
      </button>
      {hasChildren && open && (
        <ul className="space-y-0.5">
          {node.children!.map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} onNavigate={onNavigate} activeTab={activeTab} activeComponent={activeComponent} />
          ))}
        </ul>
      )}
    </li>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd board && npx vitest run src/components/Sidebar.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add board/src/components/Sidebar.tsx board/src/components/Sidebar.test.tsx
git commit -m "feat(board): Sidebar shell (scoped highlight, own scroll, collapse persistence + default)"
```

---

## Task 4: App wiring — `applyRoute`, outline state, layout (paired with Task 5)

**Files:**
- Modify: `board/src/App.tsx` (imports; new state after line 900; `openReport`/`openAnnotation` at 927-950; the content region 1127-1261)

**Interfaces:**
- Consumes: `Sidebar`, `buildFilesTree`, `OutlineEntry`, existing `NavTarget`, existing `headerOffset` (App.tsx:979) and `useMediaQuery` (App.tsx:980).
- Produces: `applyRoute(target: NavTarget)`; `<Sidebar>` in the content layout; `onOutline` passed to **no view in this task** — PlanReader's prop + its App pass land together in Task 5, and each later view task pairs its prop with its App pass.

- [ ] **Step 1: Add imports** (near the other `./lib`/`./components` imports):

```tsx
import Sidebar from "./components/Sidebar";
import { buildFilesTree } from "./lib/filesTree";
import type { OutlineEntry } from "./lib/outline";
```

- [ ] **Step 2: Add state** (immediately after the `navRequest` state at `App.tsx:900`; this sits among App's existing hooks, all of which already follow the one stable early return `if (data.gateBatch) return <BatchGate/>` at App.tsx:145 — hook order never changes within a session, so this matches the file's established pattern):

```tsx
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  const filesTree = useMemo(() => buildFilesTree(data), [data]);
```

Also add a mode-independent coarse-pointer flag next to the existing `isDesktop = useMediaQuery("(min-width: 1024px)")` at App.tsx:980 (the existing `isTouch` is `hosted`-only, so it would never auto-collapse a static/live board):

```tsx
  const isCoarse = useMediaQuery("(pointer: coarse)");
```

- [ ] **Step 3: Add `applyRoute`; refactor `openReport` and `openAnnotation` through it.** Replace `App.tsx:927-950` (the current `openAnnotation` then `openReport`) with:

```tsx
  // Shared route primitive. navRequest is RETAINED state keyed by token (App
  // never clears it; views react to the token, and a remount can re-apply it).
  const applyRoute = (target: NavTarget) => {
    setTab(target.tab);
    if (target.component) setSelectedComponent(target.component);
    navTokenRef.current += 1;
    setNavRequest({ ...target, token: navTokenRef.current });
  };
  const openAnnotation = (a: Annotation) => {
    const target = navTargetFor(a, data);
    applyRoute(target);
    if (!target.anchored) {
      showSyncNotice("No highlight in this document — opened its view instead.");
      return;
    }
    scrollToSelector(`mark[data-annotation="${a.id}"], [data-annotation="${a.id}"]`);
  };
  const openReport = (slug: string, resultsVersion: number) =>
    applyRoute({ tab: "reports", component: slug, resultsVersion, annotationId: "", anchored: false });
```

- [ ] **Step 4: Wrap the content region with the sidebar.** The view blocks live inside the `max-w-5xl` wrapper (`App.tsx:1127`) and end before the docked feedback panel (`App.tsx:1263`). Immediately before the first `{tab === "tracker" && (` block, open the flex row + sidebar; immediately after the last view block (the `{tab === "reviews" && (...)}` Scorecard block), close the wrapper:

```tsx
        <div className="flex gap-5">
          <Sidebar
            outline={outline}
            tree={filesTree}
            onNavigate={applyRoute}
            activeTab={tab}
            activeComponent={selectedComponent}
            storageKey={`rp-sidebar:${data.projectId ?? data.project.name}`}
            defaultCollapsed={isCoarse}
            topOffsetPx={headerOffset}
          />
          <div className="min-w-0 flex-1">
            {/* all existing {tab === "..." && <View .../>} blocks unchanged, here */}
          </div>
        </div>
```

- [ ] **Step 5: Do NOT pass `onOutline` to any view in this task.** Task 4's isolated end state must typecheck, and no view accepts `onOutline` yet. PlanReader's prop AND its App `onOutline={setOutline}` pass land together in Task 5; every later view task likewise adds its prop and pass in the same task.

- [ ] **Step 6:** proceed to Task 5 (Tasks 4+5 share one commit — the App wiring above is inert until Task 5 adds PlanReader's `onOutline` prop and passes it). Do not commit here.

---

## Task 5: PlanReader — publish outline (diff-aware), drop its aside

**Files:**
- Modify: `board/src/views/PlanReader.tsx` (Props 54-90; add hooks after `scrollToSection` at 223, before the guard at 234; remove `<aside>` 253-318; wrapper 251)
- Modify: `board/src/App.tsx` (commit point for Task 4)
- Test: `board/src/views/PlanReader.outline.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// board/src/views/PlanReader.outline.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import PlanReader from "./PlanReader";
import type { BoardData } from "../lib/types";
import type { OutlineEntry } from "../lib/outline";

afterEach(cleanup);

const PLAN = [
  "# Execution Plan v1",
  "Component: `01-x`",
  "## Goal and success criteria",
  "do the thing",
  "## Approach",
  "this way",
  "## Build steps",
  "step one",
].join("\n");

function data(): BoardData {
  return {
    schemaVersion: 1, generatedAt: "2026-07-14T00:00", mode: "static", focus: null,
    project: { name: "p" }, git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [{ component: "01-x", versions: [{ version: 1, path: "plans/execution/01-x/v1.md", content: PLAN }] }],
      reviews: [],
    },
  } as unknown as BoardData;
}

it("publishes an outline built from the plan's sections", () => {
  let published: OutlineEntry[] = [];
  render(
    <PlanReader
      data={data()} canAnnotate={false} selectedComponent="01-x" onSelectComponent={vi.fn()}
      annotations={[]} onAddPlanComment={vi.fn()} onPaintResult={vi.fn()} onOpenResults={vi.fn()}
      canPost={false} navRequest={null} onOutline={(e) => (published = e)}
    />,
  );
  expect(published.map((e) => e.label)).toEqual(["Goal and success criteria", "Approach", "Build steps"]);
});
```

Add a second `it(...)` for the diff-mode gate: clone `data()`, add a draft to the group (`d.files.executionPlans[0].draft = { path: "plans/execution/01-x/.draft-v2.md", content: PLAN, proposedVersion: 2 }`) so PlanReader auto-selects the draft and enables diff (`doc.isDraft && prevDoc`), render with `onOutline`, and assert the published entries are `[]` (the diff-mode gate). Stub `Element.prototype.scrollIntoView = vi.fn()` if DiffView rendering touches it.

- [ ] **Step 2: Run test to verify it fails** — `cd board && npx vitest run src/views/PlanReader.outline.test.tsx` → FAIL.

- [ ] **Step 3: Add the prop + import.** In the destructured params add `onOutline`; in the Props type add `onOutline?: (entries: OutlineEntry[]) => void;`. Add `import type { OutlineEntry } from "../lib/outline";` and ensure `useMemo`/`useEffect` are imported.

- [ ] **Step 4: Publish the outline** — insert AFTER `scrollToSection` (ends line 223) and BEFORE the `docAnnotations` memo (225), so it sits above the `if (!group || !doc)` guard at 234. Gate to `[]` in diff mode (matching the render condition `diffOn && prevDoc` at 511):

```tsx
  const outlineEntries = useMemo<OutlineEntry[]>(
    () =>
      parsed?.ok && !(diffOn && prevDoc)
        ? parsed.sections.map((s) => ({
            id: s.heading,
            label: s.heading,
            level: AGENT_SECTIONS.includes(s.heading) ? 2 : 1,
            onSelect: () => scrollToSection(s.heading),
          }))
        : [],
    [parsed, diffOn, prevDoc, scrollToSection],
  );
  useEffect(() => {
    onOutline?.(outlineEntries);
    return () => onOutline?.([]);
  }, [onOutline, outlineEntries]);
```

(`AGENT_SECTIONS` is already imported at line 17; `parsed`, `diffOn`, `prevDoc`, `scrollToSection` are all defined above line 223.)

- [ ] **Step 5: Remove the `<aside>`.** Delete the `<aside className="w-56 shrink-0">…</aside>` block (253-318) and change the outer wrapper `return ( <div className="flex gap-5">` (251) to `return ( <div className="min-w-0">`.

- [ ] **Step 6: Pass `onOutline` from App.** In App's `<PlanReader .../>` block (the Task 4 layout), add `onOutline={setOutline}`. This is the first `onOutline` pass in App; it typechecks now that Step 3 added the prop.

- [ ] **Step 7: Run tests** — `cd board && npx vitest run src/views/PlanReader.outline.test.tsx src/views/PlanReader.navsync.test.tsx && npx tsc --noEmit` → PASS + clean typecheck.

- [ ] **Step 8: Commit Tasks 4 + 5**

```bash
git add board/src/App.tsx board/src/views/PlanReader.tsx board/src/views/PlanReader.outline.test.tsx
git commit -m "feat(board): global sidebar wired into App; PlanReader publishes outline (diff-aware), drops aside"
```

---

## Task 6: Fix Results cross-component routing

**Files:**
- Modify: `board/src/views/Results.tsx` (the nav effect at 300-315)
- Test: `board/src/views/Results.navsync.test.tsx` (add a cross-component case; create the file if absent)

**Why:** the component-reset effect (277-281) sets `idx` to the latest bundle when the component changes, and the nav effect's guard `i !== Math.min(idx, bundles.length-1)` reads the STALE pre-reset `idx`. When the requested bundle's index equals that stale value, the guard skips `setIdx`, and the reset wins — opening the wrong bundle. Force the nav when the component changed.

- [ ] **Step 1: Write the failing test** — render Results, rerender with a `navRequest` that switches from component A (idx on its latest) to component B's `r1` where `r1`'s index equals A's stale idx; assert B's `r1` renders (not B's latest). Build a `data()` fixture with two components, B having ≥2 bundles, and assert on a bundle-identifying string the view shows for `r1`.

- [ ] **Step 2: Run it** → FAIL (shows B's latest).

- [ ] **Step 3: Fix the nav effect.** Add a component-tracking ref and force `setIdx` when the component changed. Replace the nav effect (`App`-verified current body at Results.tsx:300-315):

```tsx
  const navLastComponent = useRef(group?.component);
  useEffect(() => {
    if (!navRequest) return;
    const script = navRequest.scriptPath ?? null;
    const componentChanged = navLastComponent.current !== group?.component;
    navLastComponent.current = group?.component;
    if (navRequest.resultsVersion !== undefined) {
      const i = bundles.findIndex((b) => b.resultsVersion === navRequest.resultsVersion);
      if (i >= 0 && (componentChanged || i !== Math.min(idx, bundles.length - 1))) {
        pendingNavScript.current = { script };
        setIdx(i);
        return;
      }
    }
    setOpenScript(script);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRequest?.token]);
```

(Declare `navLastComponent` just above this effect; `pendingNavScript` stays as-is at line 299. The nav effect still runs after the reset effect in definition order, so its `setIdx(i)` wins for the next commit.)

- [ ] **Step 4: Run tests** — `cd board && npx vitest run src/views/Results.navsync.test.tsx && npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit** — `fix(board): Results honors a cross-component results navRequest over the latest-bundle reset`.

**Phase 1 checkpoint:** `cd board && npm run build && npm test`. The global Outline+Files panel is live; Plans works fully through it; Files result leaves route correctly across components. Reports/Results/Reviews still render their own asides (harmless duplication) until Phase 2.

---

## Task 7: Reports — publish outline from rendered headings, drop its aside

**Files:**
- Modify: `board/src/views/Reports.tsx` (Props 36-62; hooks BEFORE the early return at 94 — insert between 92 and 94; add `ref` to the report `<section>` at 146; remove `<aside>` 157-182; wrapper 155); `board/src/App.tsx` (pass `onOutline`)
- Test: `board/src/views/Reports.outline.test.tsx`

- [ ] **Step 1: Write the failing test** — render Reports with a component whose single bundle has a `publishedReport` markdown body containing `## Findings` / `## Limitations`; pass `onOutline`; assert published labels `["Findings", "Limitations"]`. (Bundle shape as in Task 2's `bundle()` helper; set `publishedReport.content` to markdown with those headings.)

- [ ] **Step 2: Run it** → FAIL.

- [ ] **Step 3: Add the prop + imports** — add `onOutline?` to params + Props; `import { outlineFromContainer, type OutlineEntry } from "../lib/outline";` and ensure `useEffect`, `useRef` are imported.

- [ ] **Step 4: Add the body ref + publish effect BEFORE the early return.** Insert between line 92 (`const bundle = ...`) and line 94 (`if (!group || !bundle)`):

```tsx
  const reportBodyRef = useRef<HTMLElement>(null);
  const reportContent = bundle?.publishedReport?.content ?? "";
  useEffect(() => {
    // Read the rendered headings (Markdown adds no ids). Rebuild only when the
    // report content changes — never every render, so no publish loop.
    onOutline?.(outlineFromContainer(reportBodyRef.current));
    return () => onOutline?.([]);
  }, [onOutline, reportContent]);
```

Attach the ref: at line 146 change `<section` (the `reportBody` wrapper) to `<section ref={reportBodyRef}`.

- [ ] **Step 5: Remove the `<aside>`** (157-182) and change the wrapper `<div className="flex gap-5">` (155) to `<div className="min-w-0">`. The in-pane bundle picker stays.

- [ ] **Step 6: Pass `onOutline`** — in App's `<Reports .../>` block add `onOutline={setOutline}`.

- [ ] **Step 7: Run tests** — `cd board && npx vitest run src/views/Reports.outline.test.tsx && npx tsc --noEmit` → PASS.

- [ ] **Step 8: Commit** — `feat(board): Reports publishes heading outline from rendered body; drops aside`.

---

## Task 8: Results — publish structured outline, drop its aside

**Files:**
- Modify: `board/src/views/Results.tsx` (Props 216-257; hooks BEFORE the early return at 342 — insert between 340 and 342; add `id` wrappers around section blocks in the main return 621-780; remove `<aside>` 419-444; wrapper 418); `board/src/App.tsx` (pass `onOutline`)
- Test: `board/src/views/Results.outline.test.tsx`

- [ ] **Step 1: Write the failing test** — render Results (mode `static`) with one component + a bundle whose `manifest` has `metrics` (a statement, so `findingMode`) and `artifacts`; pass `onOutline`; assert the published labels include `"Findings"`, `"Artifacts"`, `"Provenance"` (and `"Validation"`/`"Integrity"` only when present). Assert each entry's `id` matches its section anchor (e.g. `results-findings`). Add a second case: a bundle whose `manifest` OMITS `metrics` (delete it from the fixture) — assert the effect publishes without throwing (no `"Findings"` entry) and that the section's existing `data-annot-scope` attributes still render (query `[data-annot-scope="provenance"]` or similar). Add a third case: legacy metrics that have artifacts but no `statement`/`artifactIds` (so `findingMode` is false yet `metrics.length > 0` and `artifacts.length > 0`) — assert both `"Findings"` and `"Artifacts"` still appear, so `results-artifacts` anchors the backward-compat gallery (Results.tsx:710).

- [ ] **Step 2: Run it** → FAIL.

- [ ] **Step 3: Add prop + import** (`onOutline?`, `OutlineEntry`).

- [ ] **Step 4: Add stable id anchors** in the main return (621-780): wrap each conditional section block in an id'd div — `{m && <div id="results-integrity">…</div>}` (integrity), `id="results-validation"` (validation), `id="results-findings"` (findings), `id="results-artifacts"` (Evidence section at 690), `id="results-provenance"` (provenance). Keep the existing `data-annot-scope` attributes intact (annotation anchoring depends on them).

- [ ] **Step 5: Publish the outline BEFORE the early return.** Insert between line 340 (`bundleAnnotations` memo) and line 342 (`if (!group || !bundle)`), keyed on `bundle?.dir` (a stable per-bundle string):

```tsx
  const outlineEntries = useMemo<OutlineEntry[]>(() => {
    const m = bundle?.manifest;
    if (!m) return [];
    // Normalize like the view does (Results.tsx:622) — a manifest.json may omit
    // metrics/artifacts, and `.some`/`.length` on undefined would crash. An
    // existing regression test deletes metrics (Results.integrity.test.tsx:98).
    const metrics = Array.isArray(m.metrics) ? m.metrics : [];
    const artifacts = Array.isArray(m.artifacts) ? m.artifacts : [];
    const findingMode = metrics.some((mt) => (mt.artifactIds?.length ?? 0) > 0 || mt.statement);
    const jump = (id: string) => () =>
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    const es: OutlineEntry[] = [];
    if (m.integrity) es.push({ id: "results-integrity", label: "Integrity", level: 1, onSelect: jump("results-integrity") });
    if (m.validation) es.push({ id: "results-validation", label: "Validation", level: 1, onSelect: jump("results-validation") });
    if (findingMode || metrics.length > 0) es.push({ id: "results-findings", label: "Findings", level: 1, onSelect: jump("results-findings") });
    if (artifacts.length > 0) es.push({ id: "results-artifacts", label: "Artifacts", level: 1, onSelect: jump("results-artifacts") });
    es.push({ id: "results-provenance", label: "Provenance", level: 1, onSelect: jump("results-provenance") });
    return es;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle?.dir]);
  useEffect(() => {
    onOutline?.(outlineEntries);
    return () => onOutline?.([]);
  }, [onOutline, outlineEntries]);
```

- [ ] **Step 6: Remove the `<aside>`** (419-444); wrapper (418) → `<div className="min-w-0">`. The in-pane version strip stays.

- [ ] **Step 7: Pass `onOutline`** in App's `<Results .../>` block.

- [ ] **Step 8: Run tests** — `cd board && npx vitest run src/views/Results.outline.test.tsx src/views/Results.navsync.test.tsx && npx tsc --noEmit` → PASS.

- [ ] **Step 9: Commit** — `feat(board): Results publishes structured outline; drops aside`.

---

## Task 9: Scorecard (Reviews) — publish outline, drop its aside

**Files:**
- Modify: `board/src/views/Scorecard.tsx` (Props 19-39; add hook before the body render; remove `<aside>` 78-108; wrapper 76); `board/src/App.tsx` (pass `onOutline`)
- Test: `board/src/views/Scorecard.outline.test.tsx`

- [ ] **Step 1: Write the failing test** — render Scorecard with `data.files.reviews` = one parseable review (`board-scorecard` JSON block) + one unparseable; pass `onOutline`; assert two entries: the parsed label for the first, the filename for the second. Then (wrapped in `act`) invoke the second entry's `onSelect` and assert its raw markdown shows. Import `act` from `@testing-library/react`.

- [ ] **Step 2: Run it** → FAIL.

- [ ] **Step 3: Add prop + import.** Scorecard already keeps its selection in `idx` (`useState`, line 41). Ensure `useMemo`/`useEffect` imported.

- [ ] **Step 4: Publish the outline** (place after the existing state hooks, before the JSX return). Reuse the existing label logic and select via `setIdx`:

```tsx
  const outlineEntries = useMemo<OutlineEntry[]>(
    () =>
      data.files.reviews.map((r, i) => {
        const s = parseScorecard(r.content);
        const label = s
          ? s.threshold?.verdict === "fail"
            ? `${s.component} v${s.planVersion} — threshold failed`
            : s.threshold?.verdict === "undetermined"
              ? `${s.component} v${s.planVersion} — undetermined`
              : `${s.component} v${s.planVersion} — ${s.percent}%`
          : (r.path.split("/").pop() ?? r.path);
        return { id: r.path, label, level: 1, onSelect: () => setIdx(i) };
      }),
    [data.files.reviews],
  );
  useEffect(() => {
    onOutline?.(outlineEntries);
    return () => onOutline?.([]);
  }, [onOutline, outlineEntries]);
```

(`parseScorecard` is already imported at Scorecard.tsx:8.)

- [ ] **Step 5: Remove the `<aside>`** (78-108); wrapper (76) → `<div className="min-w-0">`.

- [ ] **Step 6: Pass `onOutline`** in App's `<Scorecard .../>` block.

- [ ] **Step 7: Run tests** — `cd board && npx vitest run src/views/Scorecard.outline.test.tsx && npx tsc --noEmit` → PASS.

- [ ] **Step 8: Commit** — `feat(board): Reviews publishes outline; drops aside`.

---

## Task 10: Tracker, Timeline, Models — semantic outlines

**Files:**
- Modify: `board/src/views/Tracker.tsx`, `board/src/views/Timeline.tsx`, `board/src/views/Models.tsx`, `board/src/App.tsx`
- Test: `board/src/views/Tracker.outline.test.tsx`, `Timeline.outline.test.tsx`, `Models.outline.test.tsx`

None of these three renders an aside today, so this is purely additive. Each needs hooks BEFORE its early return, keyed on stable primitives, plus a scroll anchor `id` on its rows.

- [ ] **Step 1 (Tracker): failing test** — render Tracker with a master plan whose component table has rows; assert one entry per component row.

- [ ] **Step 2 (Tracker): implement.** Tracker currently uses no hooks (add `import { useMemo, useEffect } from "react"`). Insert BEFORE the `if (!mp.ok)` early return at line 80 (after `const mp = parseMasterPlan(...)` at 71), keyed on the master-plan **content string** (mp itself is rebuilt each render — never depend on it):

```tsx
  const outlineEntries = useMemo<OutlineEntry[]>(() => {
    const m = parseMasterPlan(data.files.masterPlan.content);
    if (!m.ok) return [];
    return m.components.map((r) => ({
      id: `tracker-row-${r.num}`,
      label: `${r.num}. ${r.component}`,
      level: 1,
      onSelect: () => document.getElementById(`tracker-row-${r.num}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    }));
  }, [data.files.masterPlan.content]);
  useEffect(() => {
    onOutline?.(outlineEntries);
    return () => onOutline?.([]);
  }, [onOutline, outlineEntries]);
```

Add `id={`tracker-row-${r.num}`}` to the `<tr>` at line 401 (`r.num` is stable; do not use `slugFromLink`, which can be null). Add the `onOutline?` prop + `OutlineEntry` import.

- [ ] **Step 3 (Timeline): failing test** — render Timeline; assert one entry per visible event. Include a fixture with two events on the SAME date (e.g. two reviews dated `2026-07-02`) and assert their outline `id`s are distinct (index-keyed), guarding the collision the old `kind+sortKey` id had.

- [ ] **Step 4 (Timeline): implement.** Timeline has no early return; `events` is memoized (line 57). Insert after the existing `useEffect` (67), keyed on `[events, filter, query]` (recompute `visible` inside the memo — do not depend on the render-built `visible`):

```tsx
  const outlineEntries = useMemo<OutlineEntry[]>(
    () =>
      events
        .filter((e) => (filter === "all" || e.kind === filter) && (!query || e.searchText.toLowerCase().includes(query.toLowerCase())))
        .map((e, i) => ({
          // Index-keyed: `kind + sortKey` collides for same-date events (reviews
          // are dated `date + " 00:00"`; the dev fixture has 3 on 2026-07-02).
          id: `timeline-evt-${i}`,
          label: e.title,
          level: 1,
          onSelect: () => document.getElementById(`timeline-evt-${i}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
        })),
    [events, filter, query],
  );
  useEffect(() => {
    onOutline?.(outlineEntries);
    return () => onOutline?.([]);
  }, [onOutline, outlineEntries]);
```

Add `id={`timeline-evt-${i}`}` to the `<li>` at line 118 — its `visible.map((e, i) => ...)` index matches the outline's filtered index (both filter the same way), so the ids line up and stay unique even for same-date events. Add the prop + import.

- [ ] **Step 5 (Models): failing test** — render Models (loaded profile) with `PROFILE.rows`; assert one entry per stage row. Render Models with `modelProfile={undefined}`; assert `onOutline` called with `[]`.

- [ ] **Step 6 (Models): implement.** Insert AFTER the `dirty` memo (142-148) and BEFORE the `if (!modelProfile)` early return at 224, keyed on `modelProfile?.baselineHash` (stable content hash):

```tsx
  const outlineEntries = useMemo<OutlineEntry[]>(
    () =>
      (modelProfile?.rows ?? []).map((r) => ({
        id: `models-row-${r.stage}`,
        label: r.label,
        level: 1,
        onSelect: () => document.getElementById(`models-row-${r.stage}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
      })),
    [modelProfile?.baselineHash], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    onOutline?.(outlineEntries);
    return () => onOutline?.([]);
  }, [onOutline, outlineEntries]);
```

Add `id={`models-row-${r.stage}`}` to the `<tr>` at line 300. Add the prop + import.

- [ ] **Step 7 (Archive): clear the outline explicitly.** Archive is rendered as a normal view (App.tsx:1194) with no outline of its own. The previous view's effect cleanup already publishes `[]` on unmount, so switching Plans→Archive empties the outline — but make it explicit and test-guaranteed (and robust to future cleanup changes). Add `onOutline?: (entries: OutlineEntry[]) => void` to Archive's Props (`board/src/views/Archive.tsx`) + `import type { OutlineEntry } from "../lib/outline";`, and publish empty (placed before any early return):

```tsx
  useEffect(() => {
    onOutline?.([]);
  }, [onOutline]);
```

  Test (`board/src/views/Archive.outline.test.tsx`): render Archive with `onOutline={spy}`, assert `spy` was called with `[]`.

- [ ] **Step 8: Pass `onOutline={setOutline}`** in App's `<Tracker>`, `<Timeline>`, `<Models>`, and `<Archive>` blocks.

- [ ] **Step 9: Run all + typecheck** — `cd board && npx vitest run src/views/Tracker.outline.test.tsx src/views/Timeline.outline.test.tsx src/views/Models.outline.test.tsx src/views/Archive.outline.test.tsx && npx tsc --noEmit` → PASS.

- [ ] **Step 10: Commit** — `feat(board): Tracker/Timeline/Models publish semantic outlines; Archive clears the outline`.

---

## Task 11: Full suite + static-mode render/route test + ship the template

**Files:**
- Create: `board/src/App.route.test.tsx`
- Build + commit: `skills/managing-research-plans/assets/board-template.html` (the compiled single-file board — this is how the plugin actually ships the feature; without committing it, the shipped board lacks the panel)

This is a component-level render/route test (mode `"static"`), not a compiled-artifact test — the single-file build is verified separately by `npm run build`.

- [ ] **Step 1: Write the test.** Import `App` from `./App` — its signature is `App({ data }: { data: BoardData })` (App.tsx:141) — NOT `main.tsx` (which reads `#root`/`#board-data` and calls `createRoot`). Two jsdom prerequisites, both at the top of the file:
  - Stub `Element.prototype.scrollIntoView = vi.fn()` (navigation scrolls).
  - Stub `window.matchMedia` — `ThemeToggle` calls it unconditionally (ThemeToggle.tsx:28) and jsdom 29 does not provide it, so App's first effect throws without this:

  ```tsx
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })),
  });
  ```

  The fixture must be a COMPLETE `"static"`-mode `BoardData` with the full top-level `files` shape (masterPlan, decisionLog, executionPlans, reviews) and ≥2 components — App calls `allFiles(data)` immediately at App.tsx:152. Render `<App data={fixture} />` and assert: the `outline`/`files` sub-tab buttons exist; click **Files**, expand a component's **Plans** group, click a `vN` leaf, and assert the Plans view shows that plan's body; click **Collapse sidebar** and assert the panel body is hidden.

- [ ] **Step 2: Run it** — `cd board && npx vitest run src/App.route.test.tsx` → PASS (fix any wiring gaps it surfaces).

- [ ] **Step 3: Full verification + build** — `cd board && npm test && npx tsc --noEmit && npm run build`. Expected: all tests pass, clean typecheck, `dist/index.html` built and copied to `../skills/managing-research-plans/assets/board-template.html`.

- [ ] **Step 4: Manual check** — `cd board && npm run dev`, open the URL: panel open by default; Outline lists each view's structure and jumps on click (including Tracker rows, Timeline events, Results sections, Reviews); Files routes into views incl. cross-component result leaves; active component highlighted only on plans/results/reports; the panel clears its outline when you open Archive; collapse persists across reload; the panel sits below the sticky header when the page scrolls. (Or use the project `/run` skill.)

- [ ] **Step 5: Commit** — include the rebuilt template so the feature actually ships:

```bash
git add board/src/App.route.test.tsx skills/managing-research-plans/assets/board-template.html
git commit -m "test(board): static-mode render/route test for the sidebar; ship rebuilt board template"
```

---

## Self-review

- **Spec coverage:** Outline adapt-per-view → Tasks 5,7,8,9,10 (all seven views). Files logical navigator, by component, routes to views, zero payload → Tasks 2,3,4. Consolidation (remove four asides) → Tasks 5,7,8,9. Collapse + persistence keyed by `projectId`, default-collapse on touch → Task 3+4. Cross-component routing correctness → Task 6. Snapshot parity → Task 11. Excluded Versions/Archive sub-tabs → honored. Deferred exact-leaf highlight → stated.
- **Codex v1 fixes applied:** per-view `onOutline` staging (Tasks 4→5, and each Phase-2 task adds prop+pass together); DOM-based Reports outline keyed on content string (Task 7, no re-parser/loop); Results cross-component fix (Task 6); every-component Plans route (Task 2); published-report-only Reports leaves (Task 2); hooks before every early return with stable deps (Tasks 5,7,8,9,10 cite exact insertion lines); highlight scoped to plans/results/reports (Task 3); PlanReader diff-mode empty outline (Task 5); Tracker row ids via `r.num` (Task 10); Timeline via `buildEvents`/`events` (Task 10); phase numbering (1–6 / 7–11) with checkpoint after Task 6; "one-shot" wording corrected (Global Constraints + Task 4); `useCallback`/`useRef` import notes; Task 11 imports `App`, expands Plans before querying, stubs `scrollIntoView`, and is named a render/route (not compiled-artifact) test; Sidebar `overflow-y-auto` + sticky + narrow-collapse (Task 3).
- **Type consistency:** `OutlineEntry` (Task 1) is produced by every view and consumed by Sidebar. `FileNode`/`buildFilesTree` (Task 2) feed Sidebar + App. `applyRoute(target: NavTarget)` (Task 4) is the single nav entry used by Sidebar's `onNavigate`, `openReport`, `openAnnotation`. `onOutline?: (entries: OutlineEntry[]) => void` added identically per view, in the same task that passes it from App.
- **Placeholder scan:** pure modules + Sidebar (Tasks 1–3) carry full code + tests; App/PlanReader/Results edits (Tasks 4–6) show verbatim old→new with exact lines; Tasks 7–10 give the concrete entries code, anchor-id additions, and insertion lines per view. Each task ends independently testable and committable (Tasks 4+5 share one commit by design, stated).
