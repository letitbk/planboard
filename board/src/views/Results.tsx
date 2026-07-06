import { useEffect, useMemo, useState } from "react";
import Markdown from "../components/Markdown";
import SafeTable from "../components/SafeTable";
import ScriptViewer from "../components/ScriptViewer";
import AnnotationLayer, {
  type AnchoredSelection,
} from "../components/AnnotationLayer";
import { Notice } from "./Tracker";
import { parseExecutionPlan } from "../lib/parse";
import type {
  Annotation,
  BoardData,
  ResultArtifact,
  ResultCommentAnnotation,
  ResultsBundle,
  ScriptCommentAnnotation,
  VerdictRequest,
} from "../lib/types";

function verdictBadge(b: ResultsBundle): { label: string; cls: string } {
  if (b.verdict?.status === "accepted")
    return { label: "accepted", cls: "bg-green-50 text-green-800 border-green-200" };
  if (b.verdict?.status === "changes-requested")
    return { label: "changes requested", cls: "bg-red-50 text-red-700 border-red-200" };
  return { label: "pending review", cls: "bg-amber-50 text-amber-800 border-amber-200" };
}

function verdictMark(b: ResultsBundle): string {
  if (b.verdict?.status === "accepted") return " ✓";
  if (b.verdict?.status === "changes-requested") return " ✕";
  return " ●";
}

function tableKind(art: ResultArtifact): "html" | "md" | "csv" {
  const f = (art.file ?? "").toLowerCase();
  if (f.endsWith(".html")) return "html";
  if (f.endsWith(".md")) return "md";
  return "csv";
}

export default function Results({
  data,
  canAnnotate,
  canPost,
  selectedComponent,
  onSelectComponent,
  annotations,
  onAddResultComment,
  onAddScriptComment,
  onPaintResult,
  onVerdict,
  focusResults,
}: {
  data: BoardData;
  canAnnotate: boolean;
  canPost: boolean;
  selectedComponent: string | null;
  onSelectComponent: (slug: string) => void;
  annotations: Annotation[];
  onAddResultComment: (a: Omit<ResultCommentAnnotation, "id" | "type">) => void;
  onAddScriptComment: (a: Omit<ScriptCommentAnnotation, "id" | "type">) => void;
  onPaintResult: (
    painted: Set<string>,
    docKey: string,
    scopeAbsent: Set<string>,
  ) => void;
  onVerdict: (v: VerdictRequest) => void;
  focusResults: number | null;
}) {
  const groups = data.files.executionPlans.filter(
    (g) => (g.results ?? []).length > 0,
  );
  const group =
    groups.find((g) => g.component === selectedComponent) ?? groups[0] ?? null;
  const bundles = useMemo(() => group?.results ?? [], [group]);

  const [idx, setIdx] = useState(() => {
    if (focusResults !== null) {
      const i = bundles.findIndex((b) => b.resultsVersion === focusResults);
      if (i !== -1) return i;
    }
    return Math.max(0, bundles.length - 1);
  });
  useEffect(
    () => setIdx(Math.max(0, bundles.length - 1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [group?.component, bundles.length],
  );
  const bundle = bundles[Math.min(idx, bundles.length - 1)] ?? null;

  const [openScript, setOpenScript] = useState<string | null>(null);
  const [verdictComment, setVerdictComment] = useState("");
  useEffect(() => setOpenScript(null), [bundle?.dir]);

  const bundleAnnotations = useMemo(
    () =>
      annotations.filter(
        (a) =>
          (a.type === "result-comment" || a.type === "script-comment") &&
          group !== null &&
          a.component === group.component &&
          a.resultsVersion === (bundle?.resultsVersion ?? -1),
      ),
    [annotations, group, bundle],
  );

  if (!group || !bundle) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 bg-white p-10 text-center text-sm text-stone-500">
        No results captured yet. Capture a bundle with{" "}
        <code>/research-plans:results</code>.
      </div>
    );
  }

  const m = bundle.manifest;
  const badge = verdictBadge(bundle);

  // Drag-select anywhere in the bundle body; the stamped scope routes the
  // comment to its structured target (metric / artifact / report).
  const addSelectionComment = (partial: AnchoredSelection) => {
    const base = {
      component: group.component,
      resultsVersion: bundle.resultsVersion,
      comment: partial.comment,
    };
    const target =
      partial.scope.startsWith("metric:")
        ? {
            kind: "metric" as const,
            metricLabel: partial.scope.slice("metric:".length),
            quote: partial.quote,
            occurrenceIndex: partial.occurrenceIndex,
          }
        : partial.scope.startsWith("artifact:")
          ? {
              kind: "artifact" as const,
              artifactId: partial.scope.slice("artifact:".length),
              quote: partial.quote,
              occurrenceIndex: partial.occurrenceIndex,
            }
          : {
              kind: "report" as const,
              quote: partial.quote,
              occurrenceIndex: partial.occurrenceIndex,
            };
    onAddResultComment({ ...base, target });
  };

  // Only quote-carrying comments paint; scope re-derived from the target.
  const paintable = bundleAnnotations
    .filter(
      (a): a is ResultCommentAnnotation =>
        a.type === "result-comment" && Boolean(a.target.quote),
    )
    .map((a) => ({
      id: a.id,
      quote: a.target.quote!,
      occurrenceIndex: a.target.occurrenceIndex ?? 0,
      scope:
        a.target.kind === "metric"
          ? `metric:${a.target.metricLabel}`
          : a.target.kind === "artifact"
            ? `artifact:${a.target.artifactId}`
            : "report",
    }));

  return (
    <div className="flex gap-5">
      <aside className="w-56 shrink-0">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
          Components
        </h2>
        <ul className="space-y-1">
          {groups.map((g) => (
            <li key={g.component}>
              <button
                className={`w-full rounded-md px-2.5 py-1.5 text-left text-sm ${
                  g.component === group.component
                    ? "bg-stone-900 font-medium text-white"
                    : "text-stone-700 hover:bg-stone-100"
                }`}
                onClick={() => onSelectComponent(g.component)}
              >
                {g.component}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="min-w-0 flex-1">
        {/* version strip */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {bundles.map((b, i) => {
            const vb = verdictBadge(b);
            return (
              <button
                key={b.dir}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  i === Math.min(idx, bundles.length - 1)
                    ? "border-stone-900 bg-stone-900 text-white"
                    : "border-stone-300 bg-white text-stone-600 hover:border-stone-500"
                }`}
                onClick={() => setIdx(i)}
                title={vb.label}
              >
                r{b.resultsVersion}
                {b.manifest?.planVersion != null
                  ? ` · plan v${b.manifest.planVersion}`
                  : ""}
                {verdictMark(b)}
              </button>
            );
          })}
        </div>

        {/* verdict banner */}
        <div
          className={`mb-4 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 ${badge.cls}`}
        >
          <span className="text-sm font-semibold">
            {group.component} r{bundle.resultsVersion} — {badge.label}
          </span>
          {bundle.verdict && (
            <span className="text-xs">
              {bundle.verdict.reviewer} · {bundle.verdict.date}
              {bundle.verdict.comment ? ` — “${bundle.verdict.comment}”` : ""}
            </span>
          )}
          {m?.provenance === "retrofit" && (
            <span className="rounded bg-stone-200 px-1.5 py-0.5 text-[11px] font-medium text-stone-700">
              retrofit — produced outside a plan
            </span>
          )}
          {m?.late && (
            <span
              className="rounded bg-stone-200 px-1.5 py-0.5 text-[11px] font-medium text-stone-700"
              title="Backfilled: captured after the run; script snapshots show the code as of capture time"
            >
              captured late
            </span>
          )}
          {m?.trigger === "redo-after-review" && (
            <span className="rounded bg-stone-200 px-1.5 py-0.5 text-[11px] font-medium text-stone-700">
              redo after review
            </span>
          )}
          {canPost && !bundle.verdict && (
            <span className="ml-auto flex items-center gap-2">
              <input
                className="w-56 rounded-md border border-stone-300 px-2 py-1 text-xs"
                placeholder="Optional verdict comment…"
                value={verdictComment}
                onChange={(e) => setVerdictComment(e.target.value)}
              />
              <button
                className="rounded-md bg-green-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-600"
                onClick={() =>
                  onVerdict({
                    component: group.component,
                    resultsVersion: bundle.resultsVersion,
                    status: "accepted",
                    comment: verdictComment.trim(),
                  })
                }
              >
                Accept
              </button>
              <button
                className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100"
                onClick={() =>
                  onVerdict({
                    component: group.component,
                    resultsVersion: bundle.resultsVersion,
                    status: "changes-requested",
                    comment: verdictComment.trim(),
                  })
                }
              >
                Request changes
              </button>
            </span>
          )}
        </div>

        {!m && (
          <Notice text="This bundle's manifest.json did not parse — showing what can be shown." />
        )}

        {/* provenance strip — everything here comes from data already in the
            bundle/plan; collapsed by default so it informs without crowding */}
        {m &&
          (() => {
            const planFile =
              m.planVersion != null
                ? group.versions.find((v) => v.version === m.planVersion)
                : null;
            const planGoal = planFile
              ? parseExecutionPlan(planFile.content).goal
              : null;
            return (
              <details className="mb-4 rounded-lg border border-stone-200 bg-white px-4 py-2 text-xs text-stone-600">
                <summary className="cursor-pointer select-none text-stone-500">
                  How these were produced — captured {m.capturedAt}
                  {m.planVersion != null
                    ? ` under plan v${m.planVersion}`
                    : " · no governing plan (retrofit)"}
                </summary>
                <div className="mt-2 space-y-2">
                  {planGoal && (
                    <div>
                      <div className="font-semibold text-stone-700">
                        Plan goal (v{m.planVersion})
                      </div>
                      <p className="mt-0.5 whitespace-pre-line">{planGoal}</p>
                    </div>
                  )}
                  {m.artifacts.length > 0 && (
                    <div>
                      <div className="font-semibold text-stone-700">
                        Sources and producing scripts
                      </div>
                      <ul className="mt-0.5 space-y-0.5">
                        {m.artifacts.map((a) => (
                          <li key={a.id}>
                            <code>{a.source.path}</code>
                            {a.producedBy ? (
                              <>
                                {" "}
                                ← <code>{a.producedBy.sourcePath}</code>
                              </>
                            ) : (
                              <span className="text-stone-400">
                                {" "}
                                (producing script unknown)
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </details>
            );
          })()}

        {(() => {
          const bundleBody = (
            <>
        {/* metrics */}
        {m && m.metrics.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-3">
            {m.metrics.map((metric) => (
              <div
                key={metric.label}
                data-annot-scope={`metric:${metric.label}`}
                data-annot-section={`metric ${metric.label}`}
                className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-left"
              >
                <div className="text-[11px] uppercase tracking-wide text-stone-500">
                  {metric.label}
                </div>
                <div className="text-lg font-bold text-stone-900">{metric.value}</div>
                {metric.note && (
                  <div className="text-[11px] text-stone-400">{metric.note}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* report */}
        {bundle.report && (
          <section
            className="mb-4 rounded-lg border border-stone-200 bg-white p-5"
            data-annot-scope="report"
            data-annot-section="report"
          >
            <Markdown source={bundle.report.content} />
          </section>
        )}

        {/* artifact gallery — or, when a bundle carries a report but no
            reproducible figures/tables, the summary-only notice */}
        {m && m.artifacts.length === 0 ? (
          <div className="mb-4 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-5 text-sm text-stone-600">
            <div className="font-semibold text-stone-700">Summary only</div>
            <p className="mt-1">
              No figures or tables in this bundle. The report and metrics were
              captured, but the analysis outputs could not be reproduced (common
              for retrospective captures, where outputs were never saved to
              files). If a producing script exists, re-run it and capture again;
              otherwise run <code>/research-plans:results</code> and name the
              output file paths directly.
            </p>
          </div>
        ) : m ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {m.artifacts.map((art) => {
              const basename = art.file ? art.file.split("/").pop()! : null;
              const url = basename ? bundle.assets[basename] : null;
              const scriptFile = art.producedBy
                ? bundle.scripts.find((s) =>
                    s.path.endsWith("/" + art.producedBy!.script),
                  )
                : null;
              return (
                <div
                  key={art.id}
                  data-annot-scope={`artifact:${art.id}`}
                  data-annot-section={`artifact ${art.id}: ${art.title}`}
                  className="rounded-lg border border-stone-200 bg-white p-4"
                >
                  <div className="mb-2 flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-stone-800">
                      {art.title}
                    </span>
                    <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] uppercase text-stone-500">
                      {art.kind}
                    </span>
                  </div>
                  {art.source.oversized ? (
                    <div className="rounded border border-dashed border-stone-300 p-6 text-center text-xs text-stone-500">
                      Too large to snapshot (
                      {Math.round(art.source.bytes / 1024 / 1024)} MB) — original
                      at <code>{art.source.path}</code>
                    </div>
                  ) : art.kind === "table" && art.inlineText ? (
                    <SafeTable content={art.inlineText} kind={tableKind(art)} />
                  ) : art.kind === "figure" && url ? (
                    <img
                      src={url}
                      alt={art.title}
                      className="max-h-80 w-full rounded border border-stone-100 object-contain"
                    />
                  ) : url ? (
                    <a
                      href={url}
                      download={basename ?? undefined}
                      className="text-xs font-medium text-blue-700 underline"
                    >
                      download {basename}
                    </a>
                  ) : (
                    <div className="text-xs text-stone-400">no snapshot file</div>
                  )}
                  {art.caption && (
                    <p className="mt-2 text-xs text-stone-500">{art.caption}</p>
                  )}
                  {art.producedBy && (
                    <button
                      className="mt-2 text-[11px] font-medium text-blue-700 underline disabled:text-stone-400 disabled:no-underline"
                      disabled={!scriptFile}
                      onClick={() =>
                        setOpenScript(
                          openScript === scriptFile?.path
                            ? null
                            : (scriptFile?.path ?? null),
                        )
                      }
                    >
                      ▸ produced by {art.producedBy.sourcePath}
                      {scriptFile ? " (view snapshot)" : " (snapshot missing)"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}
            </>
          );
          return canAnnotate ? (
            <AnnotationLayer
              docKey={bundle.dir}
              annotations={paintable}
              onPaintResult={onPaintResult}
              onAdd={addSelectionComment}
            >
              {bundleBody}
            </AnnotationLayer>
          ) : (
            bundleBody
          );
        })()}

        {canAnnotate && (
          <p className="mb-2 text-xs text-stone-400">
            Select any text — a metric, an artifact title or caption, report
            text — to attach a comment.
          </p>
        )}

        {/* script drawer */}
        {openScript &&
          (() => {
            const sf = bundle.scripts.find((s) => s.path === openScript);
            if (!sf) return null;
            return (
              <section className="mt-4">
                <ScriptViewer
                  file={sf}
                  canAnnotate={canAnnotate}
                  onAddLineComment={(lineStart, lineEnd, excerpt, comment) =>
                    onAddScriptComment({
                      component: group.component,
                      resultsVersion: bundle.resultsVersion,
                      script: sf.path,
                      lineStart,
                      lineEnd,
                      excerpt,
                      comment,
                    })
                  }
                />
              </section>
            );
          })()}
      </div>
    </div>
  );
}
