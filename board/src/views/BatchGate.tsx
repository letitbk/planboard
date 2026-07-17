import { useEffect, useState } from "react";
import Markdown from "../components/Markdown";
import ThemeToggle from "../components/ThemeToggle";
import { parseExecutionPlan, parseScorecard } from "../lib/parse";
import {
  classifyPostFailure,
  initialConn,
  POLL_MS,
  shouldReload,
} from "../lib/reconnect";
import type { BoardData, GateBatchEntry } from "../lib/types";

type Status = "pending" | "approved" | "rejected" | "removed";

// One-at-a-time batch sign-off wizard. Full-screen takeover (rendered instead of
// the normal board when data.gateBatch is present). Each approval POSTs its
// ticket immediately, so an interrupted session keeps prior approvals.
export default function BatchGate({ data }: { data: BoardData }) {
  const plans = data.gateBatch ?? [];
  const [entries, setEntries] = useState(plans);
  const [idx, setIdx] = useState(0);
  const [status, setStatus] = useState<Status[]>(() =>
    plans.map((entry) => (entry.ticketed ? "approved" : "pending")),
  );
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const conn = initialConn(data.projectId ?? "", data.bootId ?? null);
  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (!res.ok) return;
        const health = await res.json() as { bootId: string; projectId: string };
        if (shouldReload(conn, health)) window.location.reload();
      } catch {
        // A stopped batch server is expected; the next launch restores tickets.
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [data.projectId, data.bootId]); // eslint-disable-line react-hooks/exhaustive-deps

  const approvedCount = status.filter((s) => s === "approved").length;
  const rejectedCount = status.filter((s) => s === "rejected").length;
  const pendingCount = status.filter((s) => s === "pending").length;

  if (entries.length === 0) {
    return (
      <div className="p-10 text-center text-sm text-stone-500">
        No pending drafts to review.
      </div>
    );
  }

  const post = async (path: string, body: object) => {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, boardToken: data.boardToken }),
    });
    const responseBody = await res.json().catch(() => ({})) as Record<string, unknown>;
    return { res, body: responseBody };
  };

  const recoverPostFailure = async (fallback: string) => {
    let health: { bootId: string; projectId: string } | null = null;
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (res.ok) health = await res.json();
    } catch {
      // classified below as server-gone
    }
    const recovery = classifyPostFailure(conn, health);
    if (recovery === "reload") {
      window.location.reload();
    } else if (recovery === "server-gone") {
      setError(
        "The batch server stopped. Any approvals already saved as durable tickets (valid 7 days) — re-run the batch to continue.",
      );
    } else {
      setError(fallback);
    }
  };

  const setStatusAt = (i: number, s: Status) =>
    setStatus((prev) => prev.map((v, j) => (j === i ? s : v)));
  const replaceEntry = (i: number, entry: GateBatchEntry) =>
    setEntries((prev) => prev.map((value, j) => (j === i ? entry : value)));
  const next = () => setIdx((i) => Math.min(i + 1, entries.length - 1));
  const prev = () => setIdx((i) => Math.max(i - 1, 0));

  const decide = async (kind: "approve" | "reject") => {
    const plan = entries[idx];
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (kind === "approve") {
        const { res, body } = await post("/api/batch/approve", {
          component: plan.component,
          proposedVersion: plan.proposedVersion,
          contentHash: plan.contentHash,
        });
        if (res.ok) {
          setStatusAt(idx, "approved");
        } else if (
          res.status === 409 &&
          (body.error === "stale-draft" || body.error === "newer-draft") &&
          body.entry
        ) {
          replaceEntry(idx, body.entry as GateBatchEntry);
          setStatusAt(idx, "pending");
          setNotice(
            body.error === "stale-draft"
              ? "This draft changed on disk — the text below is refreshed; review it again."
              : "A newer draft is now on disk — the text and version below are refreshed; review them again.",
          );
          return;
        } else if (res.status === 410) {
          setStatusAt(idx, "removed");
          setNotice("This draft was removed from disk; no decision was saved.");
          return;
        } else {
          await recoverPostFailure(
            `Approval failed (${String(body.error ?? res.status)}). Reload the batch and review this draft again.`,
          );
          return;
        }
      } else {
        const { res, body } = await post("/api/batch/reject", {
          component: plan.component,
          proposedVersion: plan.proposedVersion,
          comment: comment.trim(),
        });
        if (!res.ok) {
          await recoverPostFailure(
            `Change request failed (${String(body.error ?? res.status)}). Try again.`,
          );
          return;
        }
        setStatusAt(idx, "rejected");
        setComment("");
      }
      if (idx < entries.length - 1) next();
    } catch {
      await recoverPostFailure("The batch request failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const { res, body } = await post("/api/batch/done", {});
      if (!res.ok) {
        await recoverPostFailure(
          `Could not end the session (${String(body.error ?? res.status)}).`,
        );
        return;
      }
      setFinished(true);
    } catch {
      await recoverPostFailure("Could not end the session.");
    } finally {
      setBusy(false);
    }
  };

  if (finished) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <div className="mb-3 text-4xl">✓</div>
        <h1 className="mb-2 text-xl font-semibold text-stone-800 dark:text-stone-200">
          Batch sign-off complete
        </h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          {approvedCount} approved, {rejectedCount} changes-requested,{" "}
          {pendingCount} left for later. Approved plans are saved as durable tickets
          (valid 7 days); your session writes the signed files after the wizard.
        </p>
      </div>
    );
  }

  const plan = entries[idx];
  const parsed = parseExecutionPlan(plan.content);
  const cur = status[idx];
  const scorecardFor = (path: string) => {
    const matches = data.files.reviews
      .map((review) => parseScorecard(review.content))
      .filter((scorecard) =>
        scorecard && scorecard.planPath === path && scorecard.status === "scored");
    return matches.length === 1 ? matches[0] : null;
  };
  const scorecard = scorecardFor(plan.path);

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      {/* header + progress */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-base font-semibold text-stone-800 dark:text-stone-200">
          Batch sign-off
        </h1>
        <span className="text-sm text-stone-500">
          plan {idx + 1} of {entries.length}
        </span>
        <ThemeToggle />
        <span className="ml-auto flex items-center gap-2 text-xs">
          <span className="rounded bg-green-50 dark:bg-green-950 px-2 py-0.5 font-medium text-green-800 dark:text-green-300">
            {approvedCount} approved
          </span>
          <span className="rounded bg-red-50 dark:bg-red-950 px-2 py-0.5 font-medium text-red-700 dark:text-red-400">
            {rejectedCount} changes
          </span>
          <span className="rounded bg-stone-100 dark:bg-stone-800 px-2 py-0.5 font-medium text-stone-600 dark:text-stone-400">
            {pendingCount} pending
          </span>
        </span>
      </div>
      <div className="mb-4 h-1.5 w-full overflow-hidden rounded bg-stone-100 dark:bg-stone-800">
        <div
          className="h-full bg-stone-800 transition-all"
          style={{ width: `${((idx + 1) / entries.length) * 100}%` }}
        />
      </div>

      {/* plan card */}
      <div className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-stone-800 dark:text-stone-200">
            {plan.component} · proposed v{plan.proposedVersion}
          </span>
          {scorecard && (
            <span className="rounded border border-stone-300 dark:border-stone-700 px-2 py-0.5 text-[11px] font-medium text-stone-700 dark:text-stone-300">
              {scorecard.profile} · {scorecard.total}/{scorecard.max}
            </span>
          )}
          {parsed.provenance && (
            <span className="rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
              {parsed.provenance}
            </span>
          )}
          {parsed.serves && (
            <span className="rounded bg-stone-100 dark:bg-stone-800 px-2 py-0.5 text-[11px] font-medium text-stone-600 dark:text-stone-400">
              Serves: {parsed.serves}
            </span>
          )}
          {cur !== "pending" && (
            <span
              className={`ml-auto rounded px-2 py-0.5 text-[11px] font-semibold ${
                cur === "approved"
                  ? "bg-green-100 dark:bg-green-900/60 text-green-800 dark:text-green-300"
                  : cur === "removed"
                    ? "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400"
                    : "bg-red-100 text-red-700"
              }`}
            >
              {cur === "approved"
                ? "approved ✓"
                : cur === "removed"
                  ? "removed"
                  : "changes requested ✕"}
            </span>
          )}
        </div>
        <div className="max-h-[52vh] overflow-y-auto rounded border border-stone-100 dark:border-stone-800 bg-stone-50/40 p-4">
          <Markdown source={plan.content} />
        </div>
      </div>

      {notice && (
        <p className="mt-3 rounded border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          {notice}
        </p>
      )}

      {error && (
        <p className="mt-3 rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 px-3 py-2 text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {/* request-changes comment */}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional note for a change request…"
        disabled={cur !== "pending"}
        className="mt-4 h-16 w-full rounded-md border border-stone-300 dark:border-stone-600 px-3 py-2 text-sm outline-none focus:border-stone-500"
      />

      {/* action bar */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className="rounded-md border border-stone-300 dark:border-stone-600 px-3 py-1.5 text-sm text-stone-600 dark:text-stone-400 disabled:opacity-40 hover:border-stone-500 dark:hover:border-stone-400"
          onClick={prev}
          disabled={idx === 0 || busy}
        >
          ◀ Prev
        </button>
        <button
          className="rounded-md border border-stone-300 dark:border-stone-600 px-3 py-1.5 text-sm text-stone-600 dark:text-stone-400 disabled:opacity-40 hover:border-stone-500 dark:hover:border-stone-400"
          onClick={next}
          disabled={idx === entries.length - 1 || busy}
        >
          Next ▶
        </button>
        <button
          className="ml-auto rounded-md bg-green-700 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50 hover:bg-green-600"
          onClick={() => decide("approve")}
          disabled={busy || cur !== "pending"}
        >
          Approve — save ticket for v{plan.proposedVersion}
        </button>
        <button
          className="rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 px-3 py-1.5 text-sm font-semibold text-red-800 dark:text-red-300 disabled:opacity-50 hover:bg-red-100 dark:hover:bg-red-900/40"
          onClick={() => decide("reject")}
          disabled={busy || cur !== "pending"}
        >
          Request changes
        </button>
        <button
          className="rounded-md border border-stone-400 px-3 py-1.5 text-sm font-medium text-stone-700 dark:text-stone-300 disabled:opacity-50 hover:bg-stone-100 dark:hover:bg-stone-800"
          onClick={finish}
          disabled={busy}
          title="End the session. Approved plans are saved as durable tickets; your session writes signed files after the wizard."
        >
          Finish
        </button>
      </div>
      <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
        Each approval is saved the moment you click — closing early keeps every
        plan you already approved. Change-requests live only in this session —
        approvals survive a crash, rejections don't.
      </p>
    </div>
  );
}
