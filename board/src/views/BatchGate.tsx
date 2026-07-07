import { useState } from "react";
import Markdown from "../components/Markdown";
import { parseExecutionPlan } from "../lib/parse";
import type { BoardData } from "../lib/types";

type Status = "pending" | "approved" | "rejected";

// One-at-a-time batch sign-off wizard. Full-screen takeover (rendered instead of
// the normal board when data.gateBatch is present). Each approval POSTs its
// ticket immediately, so an interrupted session keeps prior approvals.
export default function BatchGate({ data }: { data: BoardData }) {
  const plans = data.gateBatch ?? [];
  const [idx, setIdx] = useState(0);
  const [status, setStatus] = useState<Status[]>(() =>
    plans.map(() => "pending"),
  );
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approvedCount = status.filter((s) => s === "approved").length;
  const rejectedCount = status.filter((s) => s === "rejected").length;
  const pendingCount = status.filter((s) => s === "pending").length;

  if (plans.length === 0) {
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
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text().catch(() => "request failed"));
  };

  const setStatusAt = (i: number, s: Status) =>
    setStatus((prev) => prev.map((v, j) => (j === i ? s : v)));
  const next = () => setIdx((i) => Math.min(i + 1, plans.length - 1));
  const prev = () => setIdx((i) => Math.max(i - 1, 0));

  const decide = async (kind: "approve" | "reject") => {
    const plan = plans[idx];
    setBusy(true);
    setError(null);
    try {
      if (kind === "approve") {
        await post("/api/batch/approve", {
          component: plan.component,
          proposedVersion: plan.proposedVersion,
        });
        setStatusAt(idx, "approved");
      } else {
        await post("/api/batch/reject", {
          component: plan.component,
          proposedVersion: plan.proposedVersion,
          comment: comment.trim(),
        });
        setStatusAt(idx, "rejected");
        setComment("");
      }
      if (idx < plans.length - 1) next();
    } catch (e) {
      setError(
        `Could not reach the board server — is it still running? (${String(e)})`,
      );
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await post("/api/batch/done", {});
      setFinished(true);
    } catch (e) {
      setError(`Could not end the session (${String(e)}).`);
    } finally {
      setBusy(false);
    }
  };

  if (finished) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <div className="mb-3 text-4xl">✓</div>
        <h1 className="mb-2 text-xl font-semibold text-stone-800">
          Batch sign-off complete
        </h1>
        <p className="text-sm text-stone-600">
          {approvedCount} approved, {rejectedCount} changes-requested,{" "}
          {pendingCount} left for later. Approved plans are being written; you can
          close this tab.
        </p>
      </div>
    );
  }

  const plan = plans[idx];
  const parsed = parseExecutionPlan(plan.content);
  const cur = status[idx];

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      {/* header + progress */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-base font-semibold text-stone-800">
          Batch sign-off
        </h1>
        <span className="text-sm text-stone-500">
          plan {idx + 1} of {plans.length}
        </span>
        <span className="ml-auto flex items-center gap-2 text-xs">
          <span className="rounded bg-green-50 px-2 py-0.5 font-medium text-green-800">
            {approvedCount} approved
          </span>
          <span className="rounded bg-red-50 px-2 py-0.5 font-medium text-red-700">
            {rejectedCount} changes
          </span>
          <span className="rounded bg-stone-100 px-2 py-0.5 font-medium text-stone-600">
            {pendingCount} pending
          </span>
        </span>
      </div>
      <div className="mb-4 h-1.5 w-full overflow-hidden rounded bg-stone-100">
        <div
          className="h-full bg-stone-800 transition-all"
          style={{ width: `${((idx + 1) / plans.length) * 100}%` }}
        />
      </div>

      {/* plan card */}
      <div className="rounded-lg border border-stone-200 bg-white p-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-stone-800">
            {plan.component} · proposed v{plan.proposedVersion}
          </span>
          {parsed.provenance && (
            <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              {parsed.provenance}
            </span>
          )}
          {parsed.serves && (
            <span className="rounded bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600">
              Serves: {parsed.serves}
            </span>
          )}
          {cur !== "pending" && (
            <span
              className={`ml-auto rounded px-2 py-0.5 text-[11px] font-semibold ${
                cur === "approved"
                  ? "bg-green-100 text-green-800"
                  : "bg-red-100 text-red-700"
              }`}
            >
              {cur === "approved" ? "approved ✓" : "changes requested ✕"}
            </span>
          )}
        </div>
        <div className="max-h-[52vh] overflow-y-auto rounded border border-stone-100 bg-stone-50/40 p-4">
          <Markdown source={plan.content} />
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {/* request-changes comment */}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional note for a change request…"
        className="mt-4 h-16 w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500"
      />

      {/* action bar */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className="rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-600 disabled:opacity-40 hover:border-stone-500"
          onClick={prev}
          disabled={idx === 0 || busy}
        >
          ◀ Prev
        </button>
        <button
          className="rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-600 disabled:opacity-40 hover:border-stone-500"
          onClick={next}
          disabled={idx === plans.length - 1 || busy}
        >
          Next ▶
        </button>
        <button
          className="ml-auto rounded-md bg-green-700 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50 hover:bg-green-600"
          onClick={() => decide("approve")}
          disabled={busy}
        >
          Approve — write v{plan.proposedVersion}
        </button>
        <button
          className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-800 disabled:opacity-50 hover:bg-red-100"
          onClick={() => decide("reject")}
          disabled={busy}
        >
          Request changes
        </button>
        <button
          className="rounded-md border border-stone-400 px-3 py-1.5 text-sm font-medium text-stone-700 disabled:opacity-50 hover:bg-stone-100"
          onClick={finish}
          disabled={busy}
          title="End the session. Approved plans have already been written; the rest stay drafts for a later pass."
        >
          Finish
        </button>
      </div>
      <p className="mt-2 text-xs text-stone-400">
        Each approval is saved the moment you click — closing early keeps every
        plan you already approved.
      </p>
    </div>
  );
}
