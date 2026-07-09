import { useState } from "react";
import Markdown from "../components/Markdown";
import AnnotationLayer, {
  GeneralCommentBox,
  type AnchoredSelection,
} from "../components/AnnotationLayer";
import { Notice } from "./Tracker";
import { parseScorecard } from "../lib/parse";
import type { Annotation, BoardData, DocCommentAnnotation } from "../lib/types";

function bandColor(percent: number): string {
  if (percent < 50) return "bg-red-500";
  if (percent <= 75) return "bg-amber-500";
  return "bg-green-600";
}

export default function Scorecard({
  data,
  canAnnotate,
  annotations,
  onAddDocComment,
  onPaintResult,
  onAddGeneral,
}: {
  data: BoardData;
  canAnnotate: boolean;
  annotations: Annotation[];
  onAddDocComment: (a: Omit<DocCommentAnnotation, "id" | "type">) => void;
  onPaintResult: (
    painted: Set<string>,
    docKey: string,
    scopeAbsent: Set<string>,
  ) => void;
  onAddGeneral: (view: string, comment: string) => void;
}) {
  const reviews = data.files.reviews;
  const [idx, setIdx] = useState(reviews.length - 1);

  if (reviews.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-10 text-center text-sm text-stone-500">
        No saved reviews yet. Run <code>/research-plans:review</code> and accept
        the save offer to see scorecards here.
      </div>
    );
  }

  const review = reviews[Math.min(idx, reviews.length - 1)];
  const sc = parseScorecard(review.content);

  const docAnnotations = annotations.filter(
    (a): a is DocCommentAnnotation =>
      a.type === "doc-comment" && a.docKey === review.path,
  );
  const addComment = (partial: AnchoredSelection) =>
    onAddDocComment({
      ...partial,
      view: "reviews",
      docKey: review.path,
      // raw reviews have no headings; never leave the label blank
      sectionHeading:
        partial.sectionHeading || (review.path.split("/").pop() ?? review.path),
    });

  return (
    <div className="flex gap-5">
      <aside className="w-56 shrink-0">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
          Saved reviews
        </h2>
        <ul className="space-y-1">
          {reviews.map((r, i) => {
            const s = parseScorecard(r.content);
            const label = s
              ? s.threshold?.verdict === "fail"
                ? `${s.component} v${s.planVersion} — threshold failed`
                : s.threshold?.verdict === "undetermined"
                  ? `${s.component} v${s.planVersion} — undetermined`
                  : `${s.component} v${s.planVersion} — ${s.percent}%`
              : r.path.split("/").pop();
            return (
              <li key={r.path}>
                <button
                  className={`w-full rounded-md px-2.5 py-1.5 text-left text-sm ${
                    i === Math.min(idx, reviews.length - 1)
                      ? "bg-stone-900 dark:bg-stone-200 font-medium text-white dark:text-stone-900"
                      : "text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800"
                  }`}
                  onClick={() => setIdx(i)}
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="min-w-0 flex-1">
        {(() => {
          const body = !sc ? (
          <div>
            <Notice text="This review has no (valid) machine-readable scorecard block — showing the raw markdown." />
            <div className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-6">
              <Markdown source={review.content} />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {sc.threshold && (
              <div
                className={`rounded-lg border p-4 ${
                  sc.threshold.verdict === "pass"
                    ? "border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950"
                    : sc.threshold.verdict === "undetermined"
                      ? "border-amber-200 bg-amber-50"
                      : "border-red-200 bg-red-50"
                }`}
                data-annot-scope="threshold"
                data-annot-section="threshold"
              >
                <h2 className="text-sm font-bold uppercase tracking-wide text-stone-800 dark:text-stone-200">
                  {sc.threshold.verdict === "pass"
                    ? "Threshold: PASS — meets the definition of a plan; quality is the grade below"
                    : sc.threshold.verdict === "undetermined"
                      ? "Threshold: UNDETERMINED — missing evidence; grade withheld"
                      : "Threshold: FAILED — not a plan yet"}
                </h2>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {sc.threshold.checks.map((c) => (
                    <span
                      key={c.id}
                      title={c.note ?? c.name ?? c.id}
                      className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                        c.result === "pass"
                          ? "bg-green-100 text-green-800 dark:text-green-300"
                          : c.result === "fail"
                            ? "bg-red-100 text-red-800"
                            : "bg-stone-100 dark:bg-stone-800 text-stone-500"
                      }`}
                    >
                      {c.id} {c.result === "na" ? "N/A" : c.result}
                    </span>
                  ))}
                </div>
                {sc.threshold.verdict !== "pass" &&
                  (sc.threshold.failures?.length ?? 0) > 0 && (
                    <ul className="mt-3 space-y-2 text-sm text-stone-800 dark:text-stone-200">
                      {sc.threshold.failures!.map((f) => (
                        <li key={f.id}>
                          <span className="font-bold">{f.id}:</span> {f.verdict}
                          {f.fix && (
                            <span className="text-stone-600 dark:text-stone-400"> Fix: {f.fix}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
              </div>
            )}

            <div
              className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5"
              data-annot-scope="score"
              data-annot-section="score"
            >
              <div className="flex items-baseline justify-between">
                <h1 className="text-lg font-bold text-stone-900 dark:text-stone-100">
                  {sc.component} — plan v{sc.planVersion}
                </h1>
                <span className="text-xs text-stone-500">
                  {sc.date} · rubric v{sc.rubricVersion}
                </span>
              </div>
              {(!sc.threshold || sc.threshold.verdict === "pass") &&
              sc.percent !== null ? (
                <div className="mt-3 flex items-center gap-4">
                  <div className="text-3xl font-bold text-stone-900 dark:text-stone-100">
                    {sc.percent}%
                  </div>
                  <div className="flex-1">
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                      <div
                        className={`h-full ${bandColor(sc.percent)}`}
                        style={{ width: `${Math.min(100, sc.percent)}%` }}
                      />
                    </div>
                    <div className="mt-1 text-xs text-stone-500">
                      {sc.raw} / {sc.applicableMax} applicable · band:{" "}
                      <span className="font-medium text-stone-700 dark:text-stone-300">
                        {sc.band}
                      </span>
                      {sc.excluded && sc.excluded.length > 0 && (
                        <>
                          {" "}
                          · excluded:{" "}
                          {sc.excluded
                            .map((e) => `${e.id} (${e.why})`)
                            .join("; ")}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-sm text-stone-500">
                  No grade —{" "}
                  {sc.threshold?.verdict === "fail"
                    ? "the document must pass the threshold before quality is graded."
                    : "grade withheld until the missing evidence is supplied."}
                </div>
              )}
            </div>

            {sc.items.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 dark:border-stone-800 text-left text-xs uppercase tracking-wide text-stone-500">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2">Score</th>
                    <th className="px-3 py-2">Evidence</th>
                    <th className="px-3 py-2">Justification</th>
                  </tr>
                </thead>
                <tbody>
                  {sc.items.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b border-stone-100 dark:border-stone-800 align-top last:border-0"
                      data-annot-scope={`item:${item.id}`}
                      data-annot-section={`item ${item.id}${item.name ? `: ${item.name}` : ""}`}
                    >
                      <td className="px-3 py-2 text-stone-400 dark:text-stone-500">{item.id}</td>
                      <td className="px-3 py-2 font-medium text-stone-800 dark:text-stone-200">
                        {item.name ?? ""}
                      </td>
                      <td className="px-3 py-2">
                        <ScoreChip score={item.score} status={item.status} />
                      </td>
                      <td className="px-3 py-2 text-stone-600 dark:text-stone-400">
                        {item.evidence ?? ""}
                      </td>
                      <td className="px-3 py-2 text-stone-600 dark:text-stone-400">
                        {item.justification ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}

            {sc.topRevisions && sc.topRevisions.length > 0 && (
              <div
                className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4"
                data-annot-scope="revisions"
                data-annot-section="Top revisions"
              >
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                  Top revisions
                </h2>
                <ol className="ml-5 list-decimal space-y-1 text-sm text-stone-700 dark:text-stone-300">
                  {sc.topRevisions.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ol>
              </div>
            )}

            {sc.split && (
              <div
                className={`rounded-lg border p-4 ${
                  sc.split.verdict === "right-sized"
                    ? "border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950"
                    : "border-red-200 bg-red-50"
                }`}
                data-annot-scope="split"
                data-annot-section="Split assessment"
              >
                <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-stone-600 dark:text-stone-400">
                  Split assessment — {sc.split.verdict}
                </h2>
                <p className="text-sm text-stone-700 dark:text-stone-300">{sc.split.detail}</p>
              </div>
            )}
          </div>
        );
          return canAnnotate ? (
            <AnnotationLayer
              docKey={review.path}
              annotations={docAnnotations}
              onPaintResult={onPaintResult}
              onAdd={addComment}
            >
              {body}
            </AnnotationLayer>
          ) : (
            body
          );
        })()}
        {canAnnotate && (
          <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
            Select any text to attach a comment.
          </p>
        )}
        {canAnnotate && <GeneralCommentBox view="Reviews" onAdd={onAddGeneral} />}
      </div>
    </div>
  );
}

function ScoreChip({
  score,
  status,
}: {
  score: number | null;
  status?: string;
}) {
  if (score === null) {
    return (
      <span className="rounded bg-stone-100 dark:bg-stone-800 px-2 py-0.5 text-xs font-medium text-stone-500">
        {status ?? "—"}
      </span>
    );
  }
  const cls =
    score === 2
      ? "bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-300"
      : score === 1
        ? "bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-300"
        : "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-bold ${cls}`}>
      {score}
    </span>
  );
}
