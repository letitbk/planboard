// The feedback surface (control surface work, spec §2): a real docked column
// on wide viewports — content reflows, nothing is covered — and the classic
// overlay on narrow ones. Extracted verbatim from App's drawer block; App owns
// all state, this renders it.
import type { CSSProperties, ReactNode } from "react";
import type {
  Annotation,
  BoardData,
  StoredComment,
} from "../lib/types";
import { VIEW_LABEL } from "../lib/feedback";

export type SubmitState =
  | "idle"
  | "sending"
  | "sent"
  | "approved"
  | "denied"
  | "failed"
  | "downloaded";

// One annotation's card in the panel list. Shared by local pending items
// (deletable, optionally with a hosted Save action) and read-only server
// comments (hosted mode: no delete — comments can't be edited or deleted
// once sent).
export function AnnotationCard({
  a,
  sentBy,
  stale,
  onDelete,
  saveAction,
  onOpen,
}: {
  a: Annotation;
  sentBy?: string;
  stale?: boolean;
  onDelete?: () => void;
  saveAction?: ReactNode;
  onOpen?: () => void;
}) {
  return (
    <div
      className={`rounded-md border border-stone-200 dark:border-stone-800 p-2 text-xs${
        onOpen ? " cursor-pointer hover:border-stone-400 dark:hover:border-stone-500" : ""
      }`}
      data-card-id={a.id}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (e) => {
              if (e.key === "Enter") onOpen();
            }
          : undefined
      }
    >
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-stone-500">
        {a.type === "plan-comment" ? (
          <>
            <span className="font-medium text-stone-700 dark:text-stone-300">
              {a.component} v{a.version}
              {a.isDraft ? " (draft)" : ""}
            </span>
            {a.sectionHeading && <span>· {a.sectionHeading}</span>}
            {a.author && (
              <span className="rounded bg-violet-100 dark:bg-violet-900/50 px-1 py-0.5 font-medium text-violet-700 dark:text-violet-300">
                via {a.author}
              </span>
            )}
            {!a.anchored && (
              <span className="rounded bg-stone-100 dark:bg-stone-800 px-1 py-0.5">
                unanchored
              </span>
            )}
          </>
        ) : a.type === "result-comment" ? (
          <>
            <span className="font-medium text-stone-700 dark:text-stone-300">
              {a.component} r{a.resultsVersion} ·{" "}
              {a.target.kind === "artifact"
                ? a.target.artifactId
                : a.target.kind === "metric"
                  ? a.target.metricLabel
                  : "report"}
            </span>
            {a.author && (
              <span className="rounded bg-violet-100 dark:bg-violet-900/50 px-1 py-0.5 font-medium text-violet-700 dark:text-violet-300">
                via {a.author}
              </span>
            )}
            {a.anchored === false && (
              <span className="rounded bg-stone-100 dark:bg-stone-800 px-1 py-0.5">
                unanchored
              </span>
            )}
          </>
        ) : a.type === "script-comment" ? (
          <span className="font-medium text-stone-700 dark:text-stone-300">
            {a.script.split("/").pop()} L{a.lineStart}
            {a.lineEnd !== a.lineStart ? `–${a.lineEnd}` : ""}
          </span>
        ) : a.type === "doc-comment" ? (
          <>
            <span className="font-medium text-stone-700 dark:text-stone-300">
              {VIEW_LABEL[a.view]}
            </span>
            {a.sectionHeading && <span>· {a.sectionHeading}</span>}
            {a.author && (
              <span className="rounded bg-violet-100 dark:bg-violet-900/50 px-1 py-0.5 font-medium text-violet-700 dark:text-violet-300">
                via {a.author}
              </span>
            )}
            {!a.anchored && (
              <span className="rounded bg-stone-100 dark:bg-stone-800 px-1 py-0.5">
                unanchored
              </span>
            )}
          </>
        ) : (
          <span className="font-medium text-stone-700 dark:text-stone-300">
            {a.view} — general
          </span>
        )}
        {sentBy && (
          <span className="rounded bg-stone-100 dark:bg-stone-800 px-1 py-0.5 font-medium text-stone-600 dark:text-stone-300">
            {sentBy}
          </span>
        )}
        {stale && (
          <span className="rounded bg-amber-100 dark:bg-amber-900/50 px-1 py-0.5 font-medium text-amber-700 dark:text-amber-300">
            outdated
          </span>
        )}
        {onDelete && (
          <button
            className="ml-auto text-stone-400 dark:text-stone-500 hover:text-red-600"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete"
          >
            ✕
          </button>
        )}
      </div>
      {(a.type === "plan-comment" || a.type === "doc-comment") && (
        <div className="mb-1 line-clamp-2 rounded bg-amber-50 dark:bg-amber-950 px-1.5 py-1 text-[11px] italic text-stone-500">
          “{a.quote}”
        </div>
      )}
      {a.type === "result-comment" && a.target.quote && (
        <div className="mb-1 line-clamp-2 rounded bg-amber-50 dark:bg-amber-950 px-1.5 py-1 text-[11px] italic text-stone-500">
          “{a.target.quote}”
        </div>
      )}
      {a.type === "script-comment" && (
        <pre className="mb-1 max-h-16 overflow-hidden rounded bg-stone-50 dark:bg-stone-800/50 px-1.5 py-1 text-[10px] text-stone-500">
          {a.excerpt}
        </pre>
      )}
      <div className="text-stone-700 dark:text-stone-300">{a.comment}</div>
      {saveAction}
    </div>
  );
}

export interface FeedbackPanelProps {
  variant: "docked" | "overlay";
  style?: CSSProperties;
  annotations: Annotation[];
  serverLive: StoredComment[];
  serverStale: StoredComment[];
  hosted: boolean;
  gate: BoardData["gate"] | null;
  canPost: boolean;
  submitState: SubmitState;
  reviewer: string;
  savingIds: Set<string>;
  onReviewerChange: (v: string) => void;
  onRemove: (id: string) => void;
  onSaveHosted: (a: Annotation) => void;
  onCardClick?: (a: Annotation) => void;
  onClose: () => void;
  onSubmit: () => void;
  onGateApprove: () => void;
  onGateDeny: () => void;
  onDownload: () => void;
  onCopyFallback: () => void;
}

export default function FeedbackPanel(p: FeedbackPanelProps) {
  const shell =
    p.variant === "docked"
      ? "sticky flex w-[380px] shrink-0 flex-col border-l border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900"
      : "fixed right-0 top-0 z-40 flex h-full w-80 flex-col border-l border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-2xl";
  return (
    <aside className={shell} style={p.style}>
      <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-200">
          Feedback ({p.annotations.length})
        </h2>
        <button
          className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
          onClick={p.onClose}
        >
          Close
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {p.annotations.length === 0 &&
          p.serverLive.length === 0 &&
          p.serverStale.length === 0 && (
            <p className="p-4 text-center text-xs text-stone-400 dark:text-stone-500">
              Select text in any view or add a general comment.
            </p>
          )}
        {p.annotations.map((a) => (
          <AnnotationCard
            key={a.id}
            a={a}
            onOpen={p.onCardClick ? () => p.onCardClick!(a) : undefined}
            onDelete={() => p.onRemove(a.id)}
            saveAction={
              p.hosted ? (
                <div className="mt-1.5 flex items-center gap-2 border-t border-stone-100 dark:border-stone-800 pt-1.5">
                  <button
                    className="rounded-md bg-stone-900 dark:bg-stone-200 px-2 py-1 text-[11px] font-semibold text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-400 disabled:opacity-40"
                    disabled={!p.reviewer.trim() || p.savingIds.has(a.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      p.onSaveHosted(a);
                    }}
                  >
                    {p.savingIds.has(a.id) ? "Saving…" : "Save"}
                  </button>
                  <span className="text-[10px] text-stone-400 dark:text-stone-500">
                    Comments can’t be edited or deleted once sent.
                  </span>
                </div>
              ) : undefined
            }
          />
        ))}
        {p.hosted && p.serverLive.length > 0 && (
          <div className="pt-2">
            <h3 className="px-0.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500">
              Sent
            </h3>
            <div className="space-y-2">
              {p.serverLive.map((c) => (
                <AnnotationCard key={c.id} a={c.annotation} sentBy={c.author} />
              ))}
            </div>
          </div>
        )}
        {p.hosted && p.serverStale.length > 0 && (
          <div className="pt-2">
            <h3 className="px-0.5 pb-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
              Written before the board was last updated — the researcher still
              has a copy of all comments
            </h3>
            <div className="space-y-2">
              {p.serverStale.map((c) => (
                <AnnotationCard
                  key={c.id}
                  a={c.annotation}
                  sentBy={c.author}
                  stale
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="border-t border-stone-200 dark:border-stone-800 p-3">
        {p.submitState === "failed" && (
          <div className="mb-2 rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 p-2 text-xs text-red-800 dark:text-red-300">
            Could not reach the board server (it may have exited).{" "}
            <button className="font-medium underline" onClick={p.onCopyFallback}>
              Copy feedback as markdown
            </button>{" "}
            and paste it into your session instead.
          </div>
        )}
        {p.gate ? (
          <div className="space-y-2">
            {p.annotations.length > 0 && (
              <p className="text-[11px] text-stone-500">
                You have unsent comments — send them as "Request changes", or
                delete them to approve.
              </p>
            )}
            <button
              className="w-full rounded-md bg-green-700 py-2 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-40"
              disabled={p.annotations.length > 0 || p.submitState === "sending"}
              onClick={p.onGateApprove}
            >
              Approve — write v{p.gate.proposedVersion} exactly as shown
            </button>
            <button
              className="w-full rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 py-2 text-sm font-semibold text-red-800 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-40"
              disabled={p.annotations.length === 0 || p.submitState === "sending"}
              onClick={p.onGateDeny}
            >
              Request changes ({p.annotations.length})
            </button>
          </div>
        ) : p.canPost ? (
          <div className="space-y-2">
            <button
              className="w-full rounded-md bg-stone-900 dark:bg-stone-200 py-2 text-sm font-semibold text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-400 disabled:opacity-40"
              disabled={
                p.annotations.length === 0 ||
                p.submitState === "sending"
              }
              onClick={p.onSubmit}
            >
              {p.submitState === "sending" ? "Sending…" : "Send to Claude"}
            </button>
          </div>
        ) : p.hosted ? (
          <div className="space-y-2">
            <input
              className="w-full rounded-md border border-stone-300 dark:border-stone-600 px-2 py-1.5 text-sm"
              placeholder="Your name (shown on your comments)"
              value={p.reviewer}
              onChange={(e) => p.onReviewerChange(e.target.value)}
              maxLength={120}
            />
            <p className="text-[11px] text-stone-500">
              Names are self-entered and not verified.
            </p>
            {!p.reviewer.trim() && p.annotations.length > 0 && (
              <p className="text-[11px] text-stone-500">
                Enter your name to save comments below.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <input
              className="w-full rounded-md border border-stone-300 dark:border-stone-600 px-2 py-1.5 text-sm"
              placeholder="Your name (for attribution)"
              value={p.reviewer}
              onChange={(e) => p.onReviewerChange(e.target.value)}
            />
            {p.submitState === "downloaded" && (
              <p className="rounded-md border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950 p-2 text-[11px] text-green-800 dark:text-green-300">
                Feedback file downloaded — email it back to the researcher. You
                can keep annotating and download again.
              </p>
            )}
            <button
              className="w-full rounded-md bg-stone-900 dark:bg-stone-200 py-2 text-sm font-semibold text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-400 disabled:opacity-40"
              disabled={p.annotations.length === 0}
              onClick={p.onDownload}
            >
              Download feedback file
            </button>
            <button
              className="block w-full text-center text-[11px] text-stone-500 underline hover:text-stone-700"
              onClick={p.onCopyFallback}
            >
              or copy feedback to clipboard
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
