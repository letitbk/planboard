import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { anchorFromSelection, paintHighlights } from "../lib/anchor";
import type { PlanCommentAnnotation } from "../lib/types";

interface Pending {
  x: number;
  y: number;
  anchor: ReturnType<typeof anchorFromSelection>;
}

/** The minimal shape the paint pass needs; PlanCommentAnnotation and
 * report-targeted result comments are both structurally assignable. */
export interface PaintableAnnotation {
  id: string;
  quote: string;
  occurrenceIndex: number;
}

export default function AnnotationLayer({
  children,
  annotations,
  onAdd,
  onPaintResult,
  docKey,
}: {
  children: ReactNode;
  annotations: PaintableAnnotation[];
  onAdd: (
    a: Omit<PlanCommentAnnotation, "id" | "type" | "planPath" | "component" | "version" | "isDraft">,
  ) => void;
  onPaintResult: (paintedIds: Set<string>) => void;
  docKey: string; // changes when the displayed document changes
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState("");

  // Re-paint highlights when annotations or the displayed doc change.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const t = window.setTimeout(() => {
      const painted = paintHighlights(
        el,
        annotations.map((a) => ({
          id: a.id,
          quote: a.quote,
          occurrenceIndex: a.occurrenceIndex,
        })),
      );
      onPaintResult(painted);
    }, 0);
    return () => window.clearTimeout(t);
  }, [annotations, docKey, onPaintResult]);

  const handleMouseUp = useCallback(() => {
    if (composing) return;
    const el = containerRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      setPending(null);
      return;
    }
    const anchor = anchorFromSelection(el);
    if (!anchor) {
      setPending(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const host = el.getBoundingClientRect();
    setPending({
      x: rect.left - host.left + rect.width / 2,
      y: rect.bottom - host.top + 6,
      anchor,
    });
  }, [composing]);

  const save = () => {
    if (!pending?.anchor || !text.trim()) return;
    onAdd({
      quote: pending.anchor.quote,
      prefix: pending.anchor.prefix,
      suffix: pending.anchor.suffix,
      sectionHeading: pending.anchor.sectionHeading,
      occurrenceIndex: pending.anchor.occurrenceIndex,
      anchored: true,
      comment: text.trim(),
    });
    setText("");
    setComposing(false);
    setPending(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div className="relative" onMouseUp={handleMouseUp}>
      <div ref={containerRef}>{children}</div>

      {pending && !composing && (
        <button
          className="absolute z-20 -translate-x-1/2 rounded-full bg-stone-900 px-3 py-1 text-xs font-medium text-white shadow-lg hover:bg-stone-700"
          style={{ left: pending.x, top: pending.y }}
          onClick={() => setComposing(true)}
        >
          Comment
        </button>
      )}

      {pending && composing && (
        <div
          className="absolute z-20 w-72 -translate-x-1/2 rounded-lg border border-stone-300 bg-white p-2 shadow-xl"
          style={{ left: Math.max(150, pending.x), top: pending.y }}
        >
          <div className="mb-1 line-clamp-2 rounded bg-amber-50 px-2 py-1 text-xs text-stone-600">
            “{pending.anchor?.quote}”
          </div>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
              if (e.key === "Escape") {
                setComposing(false);
                setPending(null);
              }
            }}
            placeholder="Your comment… (⌘↵ to save)"
            className="h-20 w-full resize-none rounded border border-stone-200 p-2 text-sm outline-none focus:border-stone-400"
          />
          <div className="mt-1 flex justify-end gap-2">
            <button
              className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-100"
              onClick={() => {
                setComposing(false);
                setPending(null);
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

export function GeneralCommentBox({
  view,
  onAdd,
}: {
  view: string;
  onAdd: (view: string, comment: string) => void;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        className="mt-6 rounded-md border border-dashed border-stone-300 px-3 py-1.5 text-xs text-stone-500 hover:border-stone-400 hover:text-stone-700"
        onClick={() => setOpen(true)}
      >
        + General comment on this view
      </button>
    );
  }
  return (
    <div className="mt-6 rounded-lg border border-stone-300 bg-white p-2 shadow-sm">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`General comment on the ${view} view…`}
        className="h-16 w-full resize-none rounded border border-stone-200 p-2 text-sm outline-none focus:border-stone-400"
      />
      <div className="mt-1 flex justify-end gap-2">
        <button
          className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-100"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
        <button
          className="rounded bg-stone-900 px-3 py-1 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-40"
          disabled={!text.trim()}
          onClick={() => {
            onAdd(view, text.trim());
            setText("");
            setOpen(false);
          }}
        >
          Add to feedback
        </button>
      </div>
    </div>
  );
}
