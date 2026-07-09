import { useState } from "react";
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
  return (
    <div className="relative">
      <button
        className="rounded-full border border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-950 px-3 py-1 text-xs font-medium text-violet-700 dark:text-violet-300 hover:border-violet-500 dark:hover:border-violet-400"
        onClick={() => setOpen((o) => !o)}
      >
        Review with ▾
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 py-1 shadow-lg">
          {REVIEW_AGENTS.map((ag) => (
            <button
              key={ag.id}
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
