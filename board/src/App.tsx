import { useCallback, useEffect, useMemo, useState } from "react";
import Tracker from "./views/Tracker";
import PlanReader from "./views/PlanReader";
import Results from "./views/Results";
import Timeline from "./views/Timeline";
import Scorecard from "./views/Scorecard";
import { allFiles, payloadContentHash } from "./lib/parse";
import {
  buildFeedbackDocument,
  buildFeedbackMarkdown,
  feedbackFilename,
  newSessionId,
  VIEW_LABEL,
} from "./lib/feedback";
import type {
  Annotation,
  BoardData,
  DocCommentAnnotation,
  PlanCommentAnnotation,
  ResultCommentAnnotation,
  ScriptCommentAnnotation,
  VerdictRequest,
} from "./lib/types";

type Tab = "tracker" | "plans" | "results" | "timeline" | "reviews";

const TABS: { id: Tab; label: string }[] = [
  { id: "tracker", label: "Tracker" },
  { id: "plans", label: "Plans" },
  { id: "results", label: "Results" },
  { id: "timeline", label: "Timeline" },
  { id: "reviews", label: "Reviews" },
];

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `ann-${Date.now().toString(36)}-${idCounter}`;
}

export default function App({ data }: { data: BoardData }) {
  const canAnnotate = data.mode === "live" || data.mode === "remote";
  const canPost = data.mode === "live";
  const remote = data.mode === "remote";
  const gate = data.gate ?? null;
  const payloadHash = useMemo(() => payloadContentHash(allFiles(data)), [data]);
  const storageKey = `rp-board:${data.project.name}:${payloadHash}`;
  const sessionId = useMemo(() => newSessionId(), []);

  const [tab, setTab] = useState<Tab>(
    gate
      ? "plans"
      : data.focusResults != null
        ? "results"
        : data.focus
          ? "plans"
          : "tracker",
  );
  const [selectedComponent, setSelectedComponent] = useState<string | null>(
    gate?.component ?? data.focus,
  );
  const [annotations, setAnnotations] = useState<Annotation[]>(() => {
    if (!canAnnotate) return [];
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? (JSON.parse(saved) as Annotation[]) : [];
    } catch {
      return [];
    }
  });
  const [drawerOpen, setDrawerOpen] = useState(gate !== null);
  const [submitState, setSubmitState] = useState<
    "idle" | "sending" | "sent" | "approved" | "denied" | "failed" | "downloaded"
  >("idle");
  const [reviewer, setReviewer] = useState<string>(() => {
    if (!remote) return "";
    try {
      return localStorage.getItem(`${storageKey}:reviewer`) ?? "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    if (!remote) return;
    try {
      localStorage.setItem(`${storageKey}:reviewer`, reviewer);
    } catch {
      // storage unavailable — name still lives in memory
    }
  }, [reviewer, remote, storageKey]);

  useEffect(() => {
    if (!canAnnotate) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(annotations));
    } catch {
      // storage full/unavailable — annotations still live in memory
    }
  }, [annotations, canAnnotate, storageKey]);

  const addPlanComment = useCallback(
    (a: Omit<PlanCommentAnnotation, "id" | "type">) => {
      setAnnotations((prev) => [
        ...prev,
        { ...a, id: nextId(), type: "plan-comment" },
      ]);
      setDrawerOpen(true);
    },
    [],
  );

  const addResultComment = useCallback(
    (a: Omit<ResultCommentAnnotation, "id" | "type">) => {
      setAnnotations((prev) => [
        ...prev,
        { ...a, id: nextId(), type: "result-comment" },
      ]);
      setDrawerOpen(true);
    },
    [],
  );

  const addScriptComment = useCallback(
    (a: Omit<ScriptCommentAnnotation, "id" | "type">) => {
      setAnnotations((prev) => [
        ...prev,
        { ...a, id: nextId(), type: "script-comment" },
      ]);
      setDrawerOpen(true);
    },
    [],
  );

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

  const [pendingVerdict, setPendingVerdict] = useState<VerdictRequest | null>(
    null,
  );
  const onVerdict = useCallback((v: VerdictRequest) => {
    setPendingVerdict(v);
    setDrawerOpen(true);
  }, []);

  const addGeneral = useCallback((view: string, comment: string) => {
    setAnnotations((prev) => [
      ...prev,
      { id: nextId(), type: "general", view, comment },
    ]);
    setDrawerOpen(true);
  }, []);

  const removeAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const onPaintResult = useCallback(
    (painted: Set<string>, docKey?: string, scopeAbsent?: Set<string>) => {
      setAnnotations((prev) => {
        let changed = false;
        const next = prev.map((a) => {
          // A paint pass only covers ONE displayed document; comments on other
          // documents (other plan versions, views, results reports) must not
          // have their anchored flag clobbered by it.
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

  const feedbackMarkdown = useMemo(
    () => buildFeedbackMarkdown(annotations, pendingVerdict),
    [annotations, pendingVerdict],
  );

  const feedbackDocument = useMemo(
    () =>
      buildFeedbackDocument(feedbackMarkdown, {
        sessionId,
        generatedAt: data.generatedAt,
        mode: data.mode,
        focus: data.focus,
        reviewer: remote ? reviewer.trim() || "anonymous reviewer" : null,
        payloadHash,
        shareHash: data.shareHash ?? null,
        annotations,
        verdict: pendingVerdict,
      }),
    [feedbackMarkdown, sessionId, data, remote, reviewer, payloadHash, annotations, pendingVerdict],
  );

  const submit = async () => {
    setSubmitState("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          annotations,
          feedbackMarkdown,
          payloadHash,
          feedbackDocument,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSubmitState("sent");
      setPendingVerdict(null);
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
    } catch {
      setSubmitState("failed");
    }
  };

  const download = () => {
    const blob = new Blob([feedbackDocument], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = feedbackFilename(
      data.project.name,
      remote ? reviewer : null,
      sessionId,
    );
    a.click();
    URL.revokeObjectURL(url);
    setSubmitState("downloaded");
  };

  const gateApprove = async () => {
    setSubmitState("sending");
    try {
      const res = await fetch("/api/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSubmitState("approved");
    } catch {
      setSubmitState("failed");
    }
  };

  const gateDeny = async () => {
    setSubmitState("sending");
    try {
      const res = await fetch("/api/deny", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          annotations,
          feedbackMarkdown,
          payloadHash,
          feedbackDocument,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSubmitState("denied");
    } catch {
      setSubmitState("failed");
    }
  };

  const copyFallback = async () => {
    try {
      await navigator.clipboard.writeText(feedbackDocument);
      alert("Feedback copied — paste it into your Claude Code session.");
    } catch {
      window.prompt("Copy the feedback below:", feedbackDocument);
    }
  };

  if (submitState === "approved" || submitState === "denied") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <div className="max-w-md rounded-lg border border-stone-200 bg-white p-8 text-center shadow-sm">
          <div className="text-3xl">
            {submitState === "approved" ? "✓" : "✎"}
          </div>
          <h1 className="mt-2 text-lg font-semibold text-stone-800">
            {submitState === "approved"
              ? "Approved — the version is being written"
              : "Changes requested — return to your session"}
          </h1>
          <p className="mt-2 text-sm text-stone-600">
            {submitState === "approved"
              ? `${gate?.component} v${gate?.proposedVersion} will land exactly as shown here, signed.`
              : "Claude received your feedback and will revise the draft; the gate reopens on the next sign-off attempt."}
          </p>
        </div>
      </div>
    );
  }

  if (submitState === "sent") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <div className="max-w-md rounded-lg border border-stone-200 bg-white p-8 text-center shadow-sm">
          <div className="text-3xl">✓</div>
          <h1 className="mt-2 text-lg font-semibold text-stone-800">
            Feedback sent
          </h1>
          <p className="mt-2 text-sm text-stone-600">
            Return to your Claude Code session — it received your{" "}
            {annotations.length} item{annotations.length === 1 ? "" : "s"} and
            will walk through them with you.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-5 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-stone-900">
              {data.project.name}
            </div>
            <div className="text-[11px] text-stone-400">
              research-plans board · generated {data.generatedAt.slice(0, 16)}
              {data.git.available && data.git.head ? ` · ${data.git.head}` : ""}
            </div>
          </div>
          <nav className="ml-4 flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  tab === t.id
                    ? "bg-stone-900 text-white"
                    : "text-stone-600 hover:bg-stone-100"
                }`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {canAnnotate && (
            <button
              className="ml-auto rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:border-stone-500"
              onClick={() => setDrawerOpen((o) => !o)}
            >
              Feedback ({annotations.length})
            </button>
          )}
        </div>
        {data.mode === "static" && (
          <div className="border-t border-amber-200 bg-amber-50 px-5 py-1.5 text-center text-xs text-amber-900">
            Read-only snapshot generated {data.generatedAt.slice(0, 16)}
            {data.git.available && data.git.head
              ? ` at commit ${data.git.head}`
              : ""}{" "}
            — regenerate with /research-plans:board --export
          </div>
        )}
        {remote && (
          <div className="border-t border-blue-200 bg-blue-50 px-5 py-2 text-xs leading-relaxed text-blue-900">
            <span className="font-medium">
              You’ve been asked to review this research plan.
            </span>{" "}
            Select text in any view to attach a comment — plans, tracker rows,
            timeline entries, results, and reviews all take them. When you’re
            done, open Feedback and press
            “Download feedback file”, then email the downloaded file back to
            the researcher. Don’t move or rename this HTML file until you’ve
            downloaded your feedback — your comments are saved by this browser
            against this file’s location.
          </div>
        )}
        {gate && (
          <div className="border-t border-stone-800 bg-stone-900 px-5 py-2 text-center text-sm font-semibold text-white">
            Sign-off gate: {gate.component} v{gate.proposedVersion} — approve in
            this window, or request changes with comments
          </div>
        )}
      </header>

      <main className="mx-auto max-w-5xl px-5 py-6">
        {tab === "tracker" && (
          <Tracker
            data={data}
            canAnnotate={canAnnotate}
            annotations={annotations}
            onAddDocComment={addDocComment}
            onPaintResult={onPaintResult}
            onAddGeneral={addGeneral}
            onOpenComponent={(slug) => {
              setSelectedComponent(slug);
              setTab("plans");
            }}
            onOpenResults={(slug) => {
              setSelectedComponent(slug);
              setTab("results");
            }}
          />
        )}
        {tab === "plans" && (
          <PlanReader
            data={data}
            canAnnotate={canAnnotate}
            selectedComponent={selectedComponent}
            onSelectComponent={setSelectedComponent}
            annotations={annotations}
            onAddPlanComment={addPlanComment}
            onPaintResult={onPaintResult}
            onOpenResults={(slug) => {
              setSelectedComponent(slug);
              setTab("results");
            }}
          />
        )}
        {tab === "results" && (
          <Results
            data={data}
            canAnnotate={canAnnotate}
            canPost={canPost}
            selectedComponent={selectedComponent}
            onSelectComponent={setSelectedComponent}
            annotations={annotations}
            onAddResultComment={addResultComment}
            onAddScriptComment={addScriptComment}
            onPaintResult={onPaintResult}
            onVerdict={onVerdict}
            focusResults={data.focusResults ?? null}
          />
        )}
        {tab === "timeline" && (
          <Timeline
            data={data}
            canAnnotate={canAnnotate}
            annotations={annotations}
            onAddDocComment={addDocComment}
            onPaintResult={onPaintResult}
            onAddGeneral={addGeneral}
          />
        )}
        {tab === "reviews" && (
          <Scorecard
            data={data}
            canAnnotate={canAnnotate}
            annotations={annotations}
            onAddDocComment={addDocComment}
            onPaintResult={onPaintResult}
            onAddGeneral={addGeneral}
          />
        )}
      </main>

      {canAnnotate && drawerOpen && (
        <aside className="fixed right-0 top-0 z-40 flex h-full w-80 flex-col border-l border-stone-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-stone-800">
              Feedback ({annotations.length})
            </h2>
            <button
              className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-100"
              onClick={() => setDrawerOpen(false)}
            >
              Close
            </button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {annotations.length === 0 && (
              <p className="p-4 text-center text-xs text-stone-400">
                Select text in any view or add a general comment.
              </p>
            )}
            {annotations.map((a) => (
              <div
                key={a.id}
                className="rounded-md border border-stone-200 p-2 text-xs"
              >
                <div className="mb-1 flex items-center gap-1.5 text-[11px] text-stone-500">
                  {a.type === "plan-comment" ? (
                    <>
                      <span className="font-medium text-stone-700">
                        {a.component} v{a.version}
                        {a.isDraft ? " (draft)" : ""}
                      </span>
                      {a.sectionHeading && <span>· {a.sectionHeading}</span>}
                      {!a.anchored && (
                        <span className="rounded bg-stone-100 px-1 py-0.5">
                          unanchored
                        </span>
                      )}
                    </>
                  ) : a.type === "result-comment" ? (
                    <span className="font-medium text-stone-700">
                      {a.component} r{a.resultsVersion} ·{" "}
                      {a.target.kind === "artifact"
                        ? a.target.artifactId
                        : a.target.kind === "metric"
                          ? a.target.metricLabel
                          : "report"}
                    </span>
                  ) : a.type === "script-comment" ? (
                    <span className="font-medium text-stone-700">
                      {a.script.split("/").pop()} L{a.lineStart}
                      {a.lineEnd !== a.lineStart ? `–${a.lineEnd}` : ""}
                    </span>
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
                    <span className="font-medium text-stone-700">
                      {a.view} — general
                    </span>
                  )}
                  <button
                    className="ml-auto text-stone-400 hover:text-red-600"
                    onClick={() => removeAnnotation(a.id)}
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
                {(a.type === "plan-comment" || a.type === "doc-comment") && (
                  <div className="mb-1 line-clamp-2 rounded bg-amber-50 px-1.5 py-1 text-[11px] italic text-stone-500">
                    “{a.quote}”
                  </div>
                )}
                {a.type === "result-comment" && a.target.quote && (
                  <div className="mb-1 line-clamp-2 rounded bg-amber-50 px-1.5 py-1 text-[11px] italic text-stone-500">
                    “{a.target.quote}”
                  </div>
                )}
                {a.type === "script-comment" && (
                  <pre className="mb-1 max-h-16 overflow-hidden rounded bg-stone-50 px-1.5 py-1 text-[10px] text-stone-500">
                    {a.excerpt}
                  </pre>
                )}
                <div className="text-stone-700">{a.comment}</div>
              </div>
            ))}
          </div>
          <div className="border-t border-stone-200 p-3">
            {submitState === "failed" && (
              <div className="mb-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                Could not reach the board server (it may have exited).{" "}
                <button className="font-medium underline" onClick={copyFallback}>
                  Copy feedback as markdown
                </button>{" "}
                and paste it into your session instead.
              </div>
            )}
            {gate ? (
              <div className="space-y-2">
                {annotations.length > 0 && (
                  <p className="text-[11px] text-stone-500">
                    You have unsent comments — send them as "Request changes",
                    or delete them to approve.
                  </p>
                )}
                <button
                  className="w-full rounded-md bg-green-700 py-2 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-40"
                  disabled={annotations.length > 0 || submitState === "sending"}
                  onClick={gateApprove}
                >
                  Approve — write v{gate.proposedVersion} exactly as shown
                </button>
                <button
                  className="w-full rounded-md border border-red-300 bg-red-50 py-2 text-sm font-semibold text-red-800 hover:bg-red-100 disabled:opacity-40"
                  disabled={annotations.length === 0 || submitState === "sending"}
                  onClick={gateDeny}
                >
                  Request changes ({annotations.length})
                </button>
              </div>
            ) : canPost ? (
              <div className="space-y-2">
                {pendingVerdict && (
                  <div className="rounded-md border border-stone-300 bg-stone-50 p-2 text-xs">
                    <span className="font-semibold">
                      Verdict: {pendingVerdict.status} —{" "}
                      {pendingVerdict.component} r{pendingVerdict.resultsVersion}
                    </span>
                    <button
                      className="ml-2 text-stone-400 hover:text-red-600"
                      onClick={() => setPendingVerdict(null)}
                      title="Withdraw verdict"
                    >
                      ✕
                    </button>
                  </div>
                )}
                <button
                  className="w-full rounded-md bg-stone-900 py-2 text-sm font-semibold text-white hover:bg-stone-700 disabled:opacity-40"
                  disabled={
                    (annotations.length === 0 && !pendingVerdict) ||
                    submitState === "sending"
                  }
                  onClick={submit}
                >
                  {submitState === "sending" ? "Sending…" : "Send to Claude"}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
                  placeholder="Your name (for attribution)"
                  value={reviewer}
                  onChange={(e) => setReviewer(e.target.value)}
                />
                {submitState === "downloaded" && (
                  <p className="rounded-md border border-green-200 bg-green-50 p-2 text-[11px] text-green-800">
                    Feedback file downloaded — email it back to the researcher.
                    You can keep annotating and download again.
                  </p>
                )}
                <button
                  className="w-full rounded-md bg-stone-900 py-2 text-sm font-semibold text-white hover:bg-stone-700 disabled:opacity-40"
                  disabled={annotations.length === 0}
                  onClick={download}
                >
                  Download feedback file
                </button>
                <button
                  className="block w-full text-center text-[11px] text-stone-500 underline hover:text-stone-700"
                  onClick={copyFallback}
                >
                  or copy feedback to clipboard
                </button>
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

