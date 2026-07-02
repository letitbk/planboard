import { useCallback, useEffect, useMemo, useState } from "react";
import Tracker from "./views/Tracker";
import PlanReader from "./views/PlanReader";
import Timeline from "./views/Timeline";
import Scorecard from "./views/Scorecard";
import { allFiles, payloadContentHash } from "./lib/parse";
import type {
  Annotation,
  BoardData,
  PlanCommentAnnotation,
} from "./lib/types";

type Tab = "tracker" | "plans" | "timeline" | "reviews";

const TABS: { id: Tab; label: string }[] = [
  { id: "tracker", label: "Tracker" },
  { id: "plans", label: "Plans" },
  { id: "timeline", label: "Timeline" },
  { id: "reviews", label: "Reviews" },
];

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `ann-${Date.now().toString(36)}-${idCounter}`;
}

export default function App({ data }: { data: BoardData }) {
  const live = data.mode === "live";
  const gate = data.gate ?? null;
  const payloadHash = useMemo(() => payloadContentHash(allFiles(data)), [data]);
  const storageKey = `rp-board:${data.project.name}:${payloadHash}`;

  const [tab, setTab] = useState<Tab>(
    gate || data.focus ? "plans" : "tracker",
  );
  const [selectedComponent, setSelectedComponent] = useState<string | null>(
    gate?.component ?? data.focus,
  );
  const [annotations, setAnnotations] = useState<Annotation[]>(() => {
    if (!live) return [];
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? (JSON.parse(saved) as Annotation[]) : [];
    } catch {
      return [];
    }
  });
  const [drawerOpen, setDrawerOpen] = useState(gate !== null);
  const [submitState, setSubmitState] = useState<
    "idle" | "sending" | "sent" | "approved" | "denied" | "failed"
  >("idle");

  useEffect(() => {
    if (!live) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(annotations));
    } catch {
      // storage full/unavailable — annotations still live in memory
    }
  }, [annotations, live, storageKey]);

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

  const onPaintResult = useCallback((painted: Set<string>) => {
    setAnnotations((prev) => {
      let changed = false;
      const next = prev.map((a) => {
        if (a.type !== "plan-comment") return a;
        const anchored = painted.has(a.id);
        // Only update annotations that were subject to this paint pass:
        // painted set covers the currently displayed doc; leave others alone.
        if (painted.size === 0 || a.anchored === anchored) return a;
        changed = true;
        return { ...a, anchored };
      });
      return changed ? next : prev;
    });
  }, []);

  const feedbackMarkdown = useMemo(
    () => buildFeedbackMarkdown(annotations),
    [annotations],
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
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSubmitState("sent");
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
    } catch {
      setSubmitState("failed");
    }
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
        body: JSON.stringify({ annotations, feedbackMarkdown, payloadHash }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSubmitState("denied");
    } catch {
      setSubmitState("failed");
    }
  };

  const copyFallback = async () => {
    try {
      await navigator.clipboard.writeText(feedbackMarkdown);
      alert("Feedback copied — paste it into your Claude Code session.");
    } catch {
      window.prompt("Copy the feedback below:", feedbackMarkdown);
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
          {live && (
            <button
              className="ml-auto rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:border-stone-500"
              onClick={() => setDrawerOpen((o) => !o)}
            >
              Feedback ({annotations.length})
            </button>
          )}
        </div>
        {!live && (
          <div className="border-t border-amber-200 bg-amber-50 px-5 py-1.5 text-center text-xs text-amber-900">
            Read-only snapshot generated {data.generatedAt.slice(0, 16)}
            {data.git.available && data.git.head
              ? ` at commit ${data.git.head}`
              : ""}{" "}
            — regenerate with /research-plans:board --export
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
            live={live}
            onAddGeneral={addGeneral}
            onOpenComponent={(slug) => {
              setSelectedComponent(slug);
              setTab("plans");
            }}
          />
        )}
        {tab === "plans" && (
          <PlanReader
            data={data}
            live={live}
            selectedComponent={selectedComponent}
            onSelectComponent={setSelectedComponent}
            annotations={annotations}
            onAddPlanComment={addPlanComment}
            onPaintResult={onPaintResult}
          />
        )}
        {tab === "timeline" && (
          <Timeline data={data} live={live} onAddGeneral={addGeneral} />
        )}
        {tab === "reviews" && (
          <Scorecard data={data} live={live} onAddGeneral={addGeneral} />
        )}
      </main>

      {live && drawerOpen && (
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
                Select text in a plan or add a general comment on any view.
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
                {a.type === "plan-comment" && (
                  <div className="mb-1 line-clamp-2 rounded bg-amber-50 px-1.5 py-1 text-[11px] italic text-stone-500">
                    “{a.quote}”
                  </div>
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
            ) : (
              <button
                className="w-full rounded-md bg-stone-900 py-2 text-sm font-semibold text-white hover:bg-stone-700 disabled:opacity-40"
                disabled={annotations.length === 0 || submitState === "sending"}
                onClick={submit}
              >
                {submitState === "sending" ? "Sending…" : "Send to Claude"}
              </button>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

function buildFeedbackMarkdown(annotations: Annotation[]): string {
  if (annotations.length === 0) return "# Board Feedback\n\nNo feedback.";
  const lines: string[] = [
    "# Board Feedback",
    "",
    `I've reviewed the board and have ${annotations.length} piece${annotations.length === 1 ? "" : "s"} of feedback:`,
    "",
  ];
  annotations.forEach((a, i) => {
    if (a.type === "plan-comment") {
      const head = `${a.component} v${a.version}${a.isDraft ? " (draft)" : ""}${a.sectionHeading ? ` — ${a.sectionHeading}` : ""}`;
      lines.push(`## ${i + 1}. [${head}]`);
      lines.push(`Feedback on: "${a.quote}"`);
    } else {
      lines.push(`## ${i + 1}. [${a.view} — general]`);
    }
    for (const ln of a.comment.split("\n")) lines.push(`> ${ln}`);
    lines.push("");
  });
  return lines.join("\n");
}
