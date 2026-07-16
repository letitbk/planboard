import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { ReviewRequest } from "../lib/types";

// The reviewer roster shared by every "Review with ▾" control (v0.9). All four
// are wired end-to-end: two Task-subagent paths and two external CLIs.
export const REVIEW_AGENTS: { id: ReviewRequest["agent"]; label: string }[] = [
  { id: "subagent", label: "Claude subagent" },
  { id: "panel", label: "Subagent panel" },
  { id: "codex", label: "Codex (GPT-5.5)" },
  { id: "gemini", label: "Gemini (agy)" },
];

// One "Review with ▾" dropdown. The caller supplies the scope-specific request
// fields via onPick; this component owns only its open/closed state and markup,
// so plans, the master plan, and results bundles all render an identical control.
export default function ReviewMenu({
  onPick,
}: {
  onPick: (agent: ReviewRequest["agent"]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter(
      (item): item is HTMLButtonElement => item !== null,
    );
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Tab") setOpen(false);
    if (next !== null && items.length > 0) {
      event.preventDefault();
      items[next].focus();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        className="rounded-full border border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-950 px-3 py-1 text-xs font-medium text-violet-700 dark:text-violet-300 hover:border-violet-500 dark:hover:border-violet-400"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="review-agent-menu"
      >
        Review with ▾
      </button>
      {open && (
        <div
          id="review-agent-menu"
          role="menu"
          aria-label="Review agents"
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 py-1 shadow-lg"
        >
          {REVIEW_AGENTS.map((ag, index) => (
            <button
              key={ag.id}
              ref={(element) => { itemRefs.current[index] = element; }}
              role="menuitem"
              tabIndex={-1}
              className="block w-full px-3 py-1.5 text-left text-xs text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
              onClick={() => {
                setOpen(false);
                onPick(ag.id);
              }}
            >
              {ag.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
