import { useState } from "react";
import type { BoardFile } from "../lib/types";

/** Line-numbered script snapshot with line-range comments. Text-selection
 * anchoring (anchor.ts) is for prose; scripts anchor by line number. */
export default function ScriptViewer({
  file,
  canAnnotate,
  onAddLineComment,
}: {
  file: BoardFile;
  canAnnotate: boolean;
  onAddLineComment: (
    lineStart: number,
    lineEnd: number,
    excerpt: string,
    comment: string,
  ) => void;
}) {
  const lines = file.content.replace(/\n$/, "").split("\n");
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const [text, setText] = useState("");

  const lo = selStart !== null && selEnd !== null ? Math.min(selStart, selEnd) : null;
  const hi = selStart !== null && selEnd !== null ? Math.max(selStart, selEnd) : null;

  const clickLine = (n: number, shift: boolean) => {
    if (!canAnnotate) return;
    if (shift && selStart !== null) {
      setSelEnd(n);
    } else {
      setSelStart(n);
      setSelEnd(n);
    }
  };

  const save = () => {
    if (lo === null || hi === null || !text.trim()) return;
    onAddLineComment(
      lo,
      hi,
      lines.slice(lo - 1, hi).join("\n").slice(0, 500),
      text.trim(),
    );
    setSelStart(null);
    setSelEnd(null);
    setText("");
  };

  return (
    <div className="rounded-lg border border-stone-200 bg-white">
      <div className="flex items-center justify-between border-b border-stone-100 px-3 py-1.5">
        <span className="font-mono text-xs text-stone-600">
          {file.path.split("/results/")[1] ?? file.path}
        </span>
        {canAnnotate && (
          <span className="text-[11px] text-stone-400">
            click a line (shift-click to extend) to comment
          </span>
        )}
      </div>
      <pre className="max-h-96 overflow-auto p-0 text-xs leading-5">
        {lines.map((ln, i) => {
          const n = i + 1;
          const selected = lo !== null && hi !== null && n >= lo && n <= hi;
          return (
            <div
              key={n}
              className={`flex cursor-pointer px-0 ${selected ? "bg-amber-100" : "hover:bg-stone-50"}`}
              onClick={(e) => clickLine(n, e.shiftKey)}
            >
              <span className="w-10 shrink-0 select-none border-r border-stone-100 pr-2 text-right text-stone-400">
                {n}
              </span>
              <code className="whitespace-pre pl-3">{ln || " "}</code>
            </div>
          );
        })}
      </pre>
      {canAnnotate && lo !== null && hi !== null && (
        <div className="border-t border-stone-200 p-2">
          <div className="mb-1 text-[11px] text-stone-500">
            Comment on lines {lo}
            {hi !== lo ? `–${hi}` : ""}
          </div>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="h-16 w-full resize-none rounded border border-stone-200 p-2 text-sm outline-none focus:border-stone-400"
            placeholder="Your comment on these lines…"
          />
          <div className="mt-1 flex justify-end gap-2">
            <button
              className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-100"
              onClick={() => {
                setSelStart(null);
                setSelEnd(null);
                setText("");
              }}
            >
              Cancel
            </button>
            <button
              className="rounded bg-stone-900 px-3 py-1 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-40"
              disabled={!text.trim()}
              onClick={save}
            >
              Save comment
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
