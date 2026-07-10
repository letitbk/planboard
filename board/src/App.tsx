import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Tracker from "./views/Tracker";
import PlanReader from "./views/PlanReader";
import Results from "./views/Results";
import Timeline from "./views/Timeline";
import Scorecard from "./views/Scorecard";
import Archive from "./views/Archive";
import BatchGate from "./views/BatchGate";
import ThemeToggle from "./components/ThemeToggle";
import { allFiles, payloadContentHash } from "./lib/parse";
import {
  buildFeedbackDocument,
  buildFeedbackMarkdown,
  feedbackFilename,
  newSessionId,
  VIEW_LABEL,
} from "./lib/feedback";
import {
  applyPostResult,
  buildCommentBody,
  getClientId,
  newUuid,
  partitionComments,
} from "./lib/hostedComments";
import type {
  Annotation,
  BoardData,
  DocCommentAnnotation,
  PlanCommentAnnotation,
  ReportRequest,
  ResultCommentAnnotation,
  ReviewRequest,
  ScriptCommentAnnotation,
  SeededAnnotation,
  StoredComment,
  VerdictRequest,
} from "./lib/types";

type Tab = "tracker" | "plans" | "results" | "timeline" | "reviews" | "archive";

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

// Agent plan review (v0.9). Scope-aware identity for a seeded reviewer comment,
// used to make ingestion one-shot (see the annotations initializer): a dismissed
// seed must not re-add on reload, and reopening must never double it.
function seedDedupKey(s: SeededAnnotation): string {
  const scope = s.scope ?? "plan";
  // Plan scope keeps the original (unprefixed) key `planPath|quote|comment|author`
  // so a plan seed dismissed under Phase 1-3 stays dismissed after upgrading;
  // master/results get scope-prefixed keys that never collide with a plan path.
  if (scope === "plan") return `${s.planPath}|${s.quote}|${s.comment}|${s.author}`;
  const target =
    scope === "results" ? `${s.component}|r${s.resultsVersion}` : "master";
  return `${scope}|${target}|${s.quote}|${s.comment}|${s.author}`;
}

// Convert a reviewer seed into a pending annotation of the right type for its
// scope: plan → plan-comment, master → doc-comment (tracker), results →
// result-comment (report target). Seeds arrive unanchored (anchored:false) and
// paint in-browser at first quote match; occurrenceIndex 0 anchors the first
// match (section-aware disambiguation is a later hardening).
function seedToAnnotation(s: SeededAnnotation): Annotation {
  const scope = s.scope ?? "plan";
  if (scope === "master") {
    return {
      id: nextId(),
      type: "doc-comment",
      view: "tracker",
      docKey: "tracker",
      scope: "",
      quote: s.quote,
      prefix: "",
      suffix: "",
      sectionHeading: s.sectionHeading,
      occurrenceIndex: 0,
      anchored: false,
      comment: s.comment,
      author: s.author,
    };
  }
  if (scope === "results") {
    return {
      id: nextId(),
      type: "result-comment",
      component: s.component ?? "",
      resultsVersion: s.resultsVersion ?? 0,
      target: { kind: "report", quote: s.quote, occurrenceIndex: 0 },
      anchored: false,
      comment: s.comment,
      author: s.author,
    };
  }
  return {
    id: nextId(),
    type: "plan-comment",
    planPath: s.planPath ?? "",
    component: s.component ?? "",
    version: s.version ?? 0,
    isDraft: s.isDraft ?? false,
    quote: s.quote,
    prefix: "",
    suffix: "",
    sectionHeading: s.sectionHeading,
    scope: "",
    occurrenceIndex: 0,
    anchored: false,
    comment: s.comment,
    author: s.author,
  };
}

// One annotation's card in the drawer list. Shared by local pending items
// (deletable, optionally with a hosted Save action) and read-only server
// comments (hosted mode: no delete — comments can't be edited or deleted
// once sent).
function AnnotationCard({
  a,
  sentBy,
  stale,
  onDelete,
  saveAction,
}: {
  a: Annotation;
  sentBy?: string;
  stale?: boolean;
  onDelete?: () => void;
  saveAction?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-stone-200 dark:border-stone-800 p-2 text-xs">
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
            onClick={onDelete}
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

export default function App({ data }: { data: BoardData }) {
  // Batch sign-off is a full-screen wizard, isolated from the normal board's
  // tabs/annotation state. The payload is static, so this early return is stable
  // (hook order never changes within a session).
  if (data.gateBatch) return <BatchGate data={data} />;

  const hosted = data.mode === "hosted";
  const canAnnotate = data.mode === "live" || data.mode === "remote" || hosted;
  const canPost = data.mode === "live";
  const remote = data.mode === "remote";
  const gate = data.gate ?? null;
  const payloadHash = useMemo(() => payloadContentHash(allFiles(data)), [data]);
  const storageKey = `rp-board:${data.project.name}:${payloadHash}`;
  // Hosted persistence is keyed by project + board URL (stable across a
  // republish), not payloadHash — so redeploying the board never orphans a
  // visitor's unsent drafts or resets their name.
  const webKey = hosted ? `rp-hosted:${data.project.name}:${location.origin}` : null;
  const pendingKey = hosted ? (webKey as string) : storageKey;
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
    let base: Annotation[] = [];
    try {
      const saved = localStorage.getItem(pendingKey);
      base = saved ? (JSON.parse(saved) as Annotation[]) : [];
    } catch {
      base = [];
    }
    // Agent plan review (v0.9): reviewer comments arrive unanchored and paint
    // in-browser at first quote match (see seedToAnnotation). One-shot per board
    // session: `${pendingKey}:seeded` records which reviewer comments have already
    // been ingested, so deleting one and reloading before Send does not re-add it
    // (curation must stick), and reopening never doubles.
    let ingested: Set<string>;
    try {
      ingested = new Set(
        JSON.parse(localStorage.getItem(`${pendingKey}:seeded`) ?? "[]") as string[],
      );
    } catch {
      ingested = new Set();
    }
    const seeded: Annotation[] = (data.seededAnnotations ?? [])
      .filter((s) => !ingested.has(seedDedupKey(s)))
      .map(seedToAnnotation);
    return [...base, ...seeded];
  });
  const [drawerOpen, setDrawerOpen] = useState(
    gate !== null || (data.seededAnnotations?.length ?? 0) > 0,
  );
  const [submitState, setSubmitState] = useState<
    "idle" | "sending" | "sent" | "approved" | "denied" | "failed" | "downloaded"
  >("idle");
  // Reviewer name: remote persists it under the payload-hashed storageKey
  // (fine — a remote reviewer downloads one board once); hosted persists it
  // under webKey so a republish doesn't blank the name field.
  const [reviewer, setReviewer] = useState<string>(() => {
    if (!remote && !hosted) return "";
    try {
      return localStorage.getItem(hosted ? `${webKey}:name` : `${storageKey}:reviewer`) ?? "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    if (!remote && !hosted) return;
    try {
      localStorage.setItem(hosted ? `${webKey}:name` : `${storageKey}:reviewer`, reviewer);
    } catch {
      // storage unavailable — name still lives in memory
    }
  }, [reviewer, remote, hosted, webKey, storageKey]);

  // Hosted-only state: server-known comments (separate population from the
  // local pending `annotations`), a per-visitor clientId, and save feedback.
  const [serverComments, setServerComments] = useState<StoredComment[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOnce, setSavedOnce] = useState(false);
  // In-flight guard (mirrors the Publish-to-web button's publishState pattern):
  // which annotation ids currently have a Save POST in flight, so a double-click
  // or a slow response can't fire a second POST for the same annotation.
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());
  // Stable per-annotation comment uuid: buildCommentBody mints a fresh uuid
  // whenever the annotation id isn't UUID-shaped (board annotation ids are
  // `ann-…`, never UUID), so without this a retry after a lost response would
  // post a second blob with a different id. Reusing the same uuid makes the
  // API's allowOverwrite upsert dedup a retry against the first attempt.
  const commentUuids = useRef<Map<string, string>>(new Map());
  const clientId = useMemo(() => (hosted ? getClientId(localStorage) : ""), [hosted]);

  useEffect(() => {
    if (!hosted) return;
    fetch("/api/comments")
      .then((r) => (r.ok ? r.json() : { comments: [] }))
      .then((d) => setServerComments(d.comments ?? []))
      .catch(() => setServerComments([]));
  }, [hosted]);

  const { live, stale } = hosted
    ? partitionComments(serverComments, data)
    : { live: [] as StoredComment[], stale: [] as StoredComment[] };

  async function saveHosted(a: Annotation) {
    const name = reviewer.trim();
    if (!name || savingIds.has(a.id)) return;
    setSaveError(null);
    setSavingIds((prev) => new Set(prev).add(a.id));
    // Resolve (and remember) a stable uuid for this annotation, so a double-click
    // or a retry after a lost response posts the SAME blob id — the upsert dedups
    // it — instead of a fresh newUuid() minting a permanent duplicate comment.
    let uuid = commentUuids.current.get(a.id);
    if (!uuid) {
      uuid = newUuid();
      commentUuids.current.set(a.id, uuid);
    }
    const body = { ...buildCommentBody(a, data, name, clientId), id: uuid };
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // comment stays in `annotations` (pending) — not lost, either way
        setSaveError(
          res.status === 400
            ? "Couldn’t save — your comment may be too long. Shorten it and try again."
            : "Couldn’t save — re-enter the password; your unsent comments are kept",
        );
        return;
      }
      setAnnotations((prev) => applyPostResult(prev, a.id, true));
      setServerComments((prev) => [...prev, { ...body, receivedAt: "" }]);
      setSavedOnce(true);
    } catch {
      setSaveError("Couldn’t save — re-enter the password; your unsent comments are kept");
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(a.id);
        return next;
      });
    }
  }

  const isTouch = hosted && !!window.matchMedia?.("(pointer: coarse)")?.matches;

  useEffect(() => {
    if (!canAnnotate) return;
    try {
      localStorage.setItem(pendingKey, JSON.stringify(annotations));
    } catch {
      // storage full/unavailable — annotations still live in memory
    }
  }, [annotations, canAnnotate, pendingKey]);

  // Record seeded reviewer comments as ingested (one-shot) — see the annotations
  // initializer. Runs once so a dismissed seed is not re-added on reload.
  useEffect(() => {
    const seeds = data.seededAnnotations ?? [];
    if (!canAnnotate || seeds.length === 0) return;
    try {
      const prev = new Set<string>(
        JSON.parse(localStorage.getItem(`${pendingKey}:seeded`) ?? "[]"),
      );
      for (const s of seeds) prev.add(seedDedupKey(s));
      localStorage.setItem(`${pendingKey}:seeded`, JSON.stringify([...prev]));
    } catch {
      // storage unavailable — one-shot degrades to memory only
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          if (a.type === "result-comment") {
            // Only seeded reviewer comments track anchoring (anchored defined);
            // researcher-selected ones stay untracked (no badge). Sticky-promote:
            // once painted it stays anchored, so switching bundles — where this
            // comment isn't in the pass's painted set — never clobbers it back.
            if (a.anchored === undefined) return a;
            const anchored = a.anchored || painted.has(a.id);
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

  // Agent plan review (v0.9): submit a review-request through the same feedback
  // channel. Any pending manual comments ride along and get routed first; the
  // session then runs the reviewer and reopens the board with its comments seeded.
  const requestReview = async (req: ReviewRequest) => {
    const md = buildFeedbackMarkdown(annotations, pendingVerdict, req);
    const doc = buildFeedbackDocument(md, {
      sessionId,
      generatedAt: data.generatedAt,
      mode: data.mode,
      focus: data.focus,
      reviewer: remote ? reviewer.trim() || "anonymous reviewer" : null,
      payloadHash,
      shareHash: data.shareHash ?? null,
      annotations,
      verdict: pendingVerdict,
      reviewRequest: req,
    });
    setSubmitState("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          annotations,
          feedbackMarkdown: md,
          payloadHash,
          feedbackDocument: doc,
          reviewRequest: req,
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

  // Generate report (v0.10): same channel and lifecycle as requestReview —
  // submit ends the board session; the session runs /research-plans:report
  // and offers to reopen. Pending manual comments ride along.
  const requestReport = async (req: ReportRequest) => {
    const md = buildFeedbackMarkdown(annotations, pendingVerdict, undefined, req);
    const doc = buildFeedbackDocument(md, {
      sessionId,
      generatedAt: data.generatedAt,
      mode: data.mode,
      focus: data.focus,
      reviewer: remote ? reviewer.trim() || "anonymous reviewer" : null,
      payloadHash,
      shareHash: data.shareHash ?? null,
      annotations,
      verdict: pendingVerdict,
      reportRequest: req,
    });
    setSubmitState("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          annotations,
          feedbackMarkdown: md,
          payloadHash,
          feedbackDocument: doc,
          reportRequest: req,
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

  const copyFallback = async () => {
    try {
      await navigator.clipboard.writeText(feedbackDocument);
      alert("Feedback copied — paste it into your Claude Code session.");
    } catch {
      window.prompt("Copy the feedback below:", feedbackDocument);
    }
  };

  // Publish-to-web (live mode only): the local server injects a per-session
  // token as data.publishToken (sub-plan 4). Without it, there's no local
  // endpoint to post to yet — show the CLI hint instead.
  const [publishState, setPublishState] = useState<
    "idle" | "publishing" | "published" | "failed"
  >("idle");
  const publishToWeb = async () => {
    setPublishState("publishing");
    try {
      const res = await fetch("/publish-web", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.publishToken }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPublishState("published");
    } catch {
      setPublishState("failed");
    }
  };

  if (submitState === "approved" || submitState === "denied") {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-stone-50 dark:bg-stone-800/50">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        <div className="max-w-md rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-8 text-center shadow-sm">
          <div className="text-3xl">
            {submitState === "approved" ? "✓" : "✎"}
          </div>
          <h1 className="mt-2 text-lg font-semibold text-stone-800 dark:text-stone-200">
            {submitState === "approved"
              ? "Approved — the version is being written"
              : "Changes requested — return to your session"}
          </h1>
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
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
      <div className="relative flex min-h-screen items-center justify-center bg-stone-50 dark:bg-stone-800/50">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        <div className="max-w-md rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-8 text-center shadow-sm">
          <div className="text-3xl">✓</div>
          <h1 className="mt-2 text-lg font-semibold text-stone-800 dark:text-stone-200">
            Feedback sent
          </h1>
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
            Return to your Claude Code session — it received your{" "}
            {annotations.length} item{annotations.length === 1 ? "" : "s"} and
            will walk through them with you.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <header className="sticky top-0 z-30 border-b border-stone-200 dark:border-stone-800 bg-white/90 dark:bg-stone-900/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-5 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-stone-900 dark:text-stone-100">
              {data.project.name}
            </div>
            <div className="text-[11px] text-stone-400 dark:text-stone-500">
              research-plans board · generated {data.generatedAt.slice(0, 16)}
              {data.git.available && data.git.head ? ` · ${data.git.head}` : ""}
            </div>
          </div>
          <nav className="ml-4 flex gap-1">
            {(data.files.archives?.length
              ? [...TABS, { id: "archive" as Tab, label: "Archive" }]
              : TABS
            ).map((t) => (
              <button
                key={t.id}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  tab === t.id
                    ? "bg-stone-900 dark:bg-stone-200 text-white dark:text-stone-900"
                    : "text-stone-600 hover:bg-stone-100 dark:hover:bg-stone-800"
                }`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {canPost &&
              (data.publishToken ? (
                <button
                  className="rounded-md border border-stone-300 dark:border-stone-600 px-3 py-1.5 text-sm font-medium text-stone-700 dark:text-stone-300 hover:border-stone-500 dark:hover:border-stone-400 disabled:opacity-40"
                  disabled={publishState === "publishing"}
                  onClick={publishToWeb}
                >
                  {publishState === "publishing"
                    ? "Publishing…"
                    : publishState === "published"
                      ? "Published"
                      : publishState === "failed"
                        ? "Publish failed — retry"
                        : "Publish to web"}
                </button>
              ) : (
                <span className="text-[11px] text-stone-400 dark:text-stone-500">
                  Run /research-plans:board --publish-web in Claude Code
                </span>
              ))}
            {canAnnotate && (
              <button
                className="rounded-md border border-stone-300 dark:border-stone-600 px-3 py-1.5 text-sm font-medium text-stone-700 dark:text-stone-300 hover:border-stone-500 dark:hover:border-stone-400"
                onClick={() => setDrawerOpen((o) => !o)}
              >
                Feedback ({annotations.length})
              </button>
            )}
          </div>
        </div>
        {data.mode === "static" && (
          <div className="border-t border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-5 py-1.5 text-center text-xs text-amber-900 dark:text-amber-200">
            Read-only snapshot generated {data.generatedAt.slice(0, 16)}
            {data.git.available && data.git.head
              ? ` at commit ${data.git.head}`
              : ""}{" "}
            — regenerate with /research-plans:board --export
          </div>
        )}
        {remote && (
          <div className="border-t border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950 px-5 py-2 text-xs leading-relaxed text-blue-900 dark:text-blue-200">
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
          <div className="border-t border-stone-800 bg-stone-900 dark:bg-stone-200 px-5 py-2 text-center text-sm font-semibold text-white dark:text-stone-900">
            Sign-off gate: {gate.component} v{gate.proposedVersion} — approve in
            this window, or request changes with comments
          </div>
        )}
        {hosted && saveError && (
          <div className="border-t border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 px-5 py-1.5 text-center text-xs text-red-800 dark:text-red-300">
            {saveError}
          </div>
        )}
        {hosted && savedOnce && !saveError && (
          <div className="border-t border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950 px-5 py-1.5 text-center text-xs text-green-800 dark:text-green-300">
            Sent — visible to everyone with this link; the researcher picks up
            comments in Claude Code
          </div>
        )}
        {isTouch && (
          <div className="border-t border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950 px-5 py-1.5 text-center text-xs text-blue-900 dark:text-blue-200">
            Reading works here; commenting works best on a computer
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
            canPost={canPost}
            onRequestReview={requestReview}
            onOpenArchive={
              data.files.archives?.length ? () => setTab("archive") : undefined
            }
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
            canPost={canPost}
            onRequestReview={requestReview}
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
            onRequestReview={requestReview}
            onRequestReport={requestReport}
          />
        )}
        {tab === "archive" && (
          <Archive
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
        <aside className="fixed right-0 top-0 z-40 flex h-full w-80 flex-col border-l border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-2xl">
          <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-200">
              Feedback ({annotations.length})
            </h2>
            <button
              className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
              onClick={() => setDrawerOpen(false)}
            >
              Close
            </button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {annotations.length === 0 && live.length === 0 && stale.length === 0 && (
              <p className="p-4 text-center text-xs text-stone-400 dark:text-stone-500">
                Select text in any view or add a general comment.
              </p>
            )}
            {annotations.map((a) => (
              <AnnotationCard
                key={a.id}
                a={a}
                onDelete={() => removeAnnotation(a.id)}
                saveAction={
                  hosted ? (
                    <div className="mt-1.5 flex items-center gap-2 border-t border-stone-100 dark:border-stone-800 pt-1.5">
                      <button
                        className="rounded-md bg-stone-900 dark:bg-stone-200 px-2 py-1 text-[11px] font-semibold text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-400 disabled:opacity-40"
                        disabled={!reviewer.trim() || savingIds.has(a.id)}
                        onClick={() => saveHosted(a)}
                      >
                        {savingIds.has(a.id) ? "Saving…" : "Save"}
                      </button>
                      <span className="text-[10px] text-stone-400 dark:text-stone-500">
                        Comments can’t be edited or deleted once sent.
                      </span>
                    </div>
                  ) : undefined
                }
              />
            ))}
            {hosted && live.length > 0 && (
              <div className="pt-2">
                <h3 className="px-0.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500">
                  Sent
                </h3>
                <div className="space-y-2">
                  {live.map((c) => (
                    <AnnotationCard key={c.id} a={c.annotation} sentBy={c.author} />
                  ))}
                </div>
              </div>
            )}
            {hosted && stale.length > 0 && (
              <div className="pt-2">
                <h3 className="px-0.5 pb-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                  Written before the board was last updated — the researcher
                  still has a copy of all comments
                </h3>
                <div className="space-y-2">
                  {stale.map((c) => (
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
            {submitState === "failed" && (
              <div className="mb-2 rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 p-2 text-xs text-red-800 dark:text-red-300">
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
                  className="w-full rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 py-2 text-sm font-semibold text-red-800 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-40"
                  disabled={annotations.length === 0 || submitState === "sending"}
                  onClick={gateDeny}
                >
                  Request changes ({annotations.length})
                </button>
              </div>
            ) : canPost ? (
              <div className="space-y-2">
                {pendingVerdict && (
                  <div className="rounded-md border border-stone-300 dark:border-stone-600 bg-stone-50 dark:bg-stone-800/50 p-2 text-xs">
                    <span className="font-semibold">
                      Verdict: {pendingVerdict.status} —{" "}
                      {pendingVerdict.component} r{pendingVerdict.resultsVersion}
                    </span>
                    <button
                      className="ml-2 text-stone-400 dark:text-stone-500 hover:text-red-600"
                      onClick={() => setPendingVerdict(null)}
                      title="Withdraw verdict"
                    >
                      ✕
                    </button>
                  </div>
                )}
                <button
                  className="w-full rounded-md bg-stone-900 dark:bg-stone-200 py-2 text-sm font-semibold text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-400 disabled:opacity-40"
                  disabled={
                    (annotations.length === 0 && !pendingVerdict) ||
                    submitState === "sending"
                  }
                  onClick={submit}
                >
                  {submitState === "sending" ? "Sending…" : "Send to Claude"}
                </button>
              </div>
            ) : hosted ? (
              <div className="space-y-2">
                <input
                  className="w-full rounded-md border border-stone-300 dark:border-stone-600 px-2 py-1.5 text-sm"
                  placeholder="Your name (shown on your comments)"
                  value={reviewer}
                  onChange={(e) => setReviewer(e.target.value)}
                  maxLength={120}
                />
                {!reviewer.trim() && annotations.length > 0 && (
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
                  value={reviewer}
                  onChange={(e) => setReviewer(e.target.value)}
                />
                {submitState === "downloaded" && (
                  <p className="rounded-md border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950 p-2 text-[11px] text-green-800 dark:text-green-300">
                    Feedback file downloaded — email it back to the researcher.
                    You can keep annotating and download again.
                  </p>
                )}
                <button
                  className="w-full rounded-md bg-stone-900 dark:bg-stone-200 py-2 text-sm font-semibold text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-400 disabled:opacity-40"
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

