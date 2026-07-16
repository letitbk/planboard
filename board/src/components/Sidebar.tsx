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
      className="w-full self-start overflow-y-auto border-b border-stone-200 pb-3 dark:border-stone-800 lg:sticky lg:w-56 lg:shrink-0 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-3"
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
