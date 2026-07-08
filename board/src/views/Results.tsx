import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "../components/Markdown";
import ArtifactCard from "../components/ArtifactCard";
import ScriptViewer from "../components/ScriptViewer";
import AnnotationLayer, {
  type AnchoredSelection,
} from "../components/AnnotationLayer";
import ReviewMenu from "../components/ReviewMenu";
import { Notice } from "./Tracker";
import { parseExecutionPlan } from "../lib/parse";
import type {
  Annotation,
  BoardData,
  ResultArtifact,
  ResultCommentAnnotation,
  ResultsBundle,
  ReviewRequest,
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

const STATUS_CLS: Record<string, string> = {
  robust: "border-green-200 bg-green-50 text-green-800",
  marginal: "border-amber-200 bg-amber-50 text-amber-800",
  descriptive: "border-sky-200 bg-sky-50 text-sky-800",
  retracted: "border-red-200 bg-red-50 text-red-700",
  superseded: "border-stone-200 bg-stone-100 text-stone-500",
};

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
  onRequestReview,
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
  onRequestReview?: (req: ReviewRequest) => void;
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
  // Reset to the latest bundle when the researcher switches component — but NOT
  // on first mount, so an initial focusResults pin (--focus slug:rN, e.g. a
  // results-review reopen) lands on the reviewed bundle instead of the latest.
  const lastComponent = useRef(group?.component);
  useEffect(() => {
    if (lastComponent.current === group?.component) return;
    lastComponent.current = group?.component;
    setIdx(Math.max(0, bundles.length - 1));
  }, [group?.component, bundles.length]);
  const bundle = bundles[Math.min(idx, bundles.length - 1)] ?? null;

  const [openScript, setOpenScript] = useState<string | null>(null);
  const [verdictComment, setVerdictComment] = useState("");
  const [zoom, setZoom] = useState<{ url: string; title: string } | null>(null);
  useEffect(() => setOpenScript(null), [bundle?.dir]);
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

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
          {canPost && onRequestReview && (
            <div className="ml-auto">
              <ReviewMenu
                onPick={(agent) =>
                  onRequestReview({
                    agent,
                    scope: "results",
                    component: group.component,
                    resultsVersion: bundle.resultsVersion,
                  })
                }
              />
            </div>
          )}
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
            <span
              className="rounded bg-stone-200 px-1.5 py-0.5 text-[11px] font-medium text-stone-700"
              title={
                m.planVersion != null
                  ? "Documented by a retrospective plan (written after the work), not prospectively governed."
                  : "Produced outside any plan."
              }
            >
              {m.planVersion != null
                ? `retrofit — documented by a retrospective plan (v${m.planVersion})`
                : "retrofit — produced outside a plan"}
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
                    ? m.provenance === "retrofit"
                      ? ` · documented by retrospective plan v${m.planVersion}`
                      : ` under plan v${m.planVersion}`
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
          const findingMode = !!(
            m &&
            m.metrics.some(
              (mt) =>
                (mt.artifactIds && mt.artifactIds.length > 0) || mt.statement,
            )
          );
          const referenced = new Set(
            m ? m.metrics.flatMap((mt) => mt.artifactIds ?? []) : [],
          );
          const orphanArtifacts = m
            ? m.artifacts.filter((a) => !referenced.has(a.id))
            : [];
          const onZoom = (url: string, title: string) => setZoom({ url, title });
          const bundleBody = (
            <>
              {/* report — overview */}
              {bundle.report && (
                <section
                  className="mb-4 rounded-lg border border-stone-200 bg-white p-5"
                  data-annot-scope="report"
                  data-annot-section="report"
                >
                  <Markdown source={bundle.report.content} />
                </section>
              )}

              {m && findingMode ? (
                <>
                  {/* findings — each key finding with its evidence embedded */}
                  {m.metrics.map((metric) => {
                    const arts = (metric.artifactIds ?? [])
                      .map((id) => m.artifacts.find((a) => a.id === id))
                      .filter((a): a is ResultArtifact => Boolean(a));
                    return (
                      <section
                        key={metric.label}
                        data-annot-scope={`metric:${metric.label}`}
                        data-annot-section={`metric ${metric.label}`}
                        className="mb-4 rounded-lg border border-stone-200 bg-white p-5"
                      >
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          {metric.status && (
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                STATUS_CLS[metric.status] ??
                                STATUS_CLS.descriptive
                              }`}
                            >
                              {metric.status}
                            </span>
                          )}
                          <span className="text-[11px] font-medium uppercase tracking-wide text-stone-500">
                            {metric.label}
                          </span>
                        </div>
                        {metric.statement && (
                          <p className="mb-1 font-serif text-lg leading-snug text-stone-900">
                            {metric.statement}
                          </p>
                        )}
                        <div className="text-base font-bold text-stone-900">
                          {metric.value}
                        </div>
                        {metric.note && (
                          <div className="mt-0.5 text-xs text-stone-400">
                            {metric.note}
                          </div>
                        )}
                        {arts.length > 0 && (
                          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                            {arts.map((art) => (
                              <ArtifactCard
                                key={art.id}
                                art={art}
                                bundle={bundle}
                                openScript={openScript}
                                setOpenScript={setOpenScript}
                                onZoom={onZoom}
                              />
                            ))}
                          </div>
                        )}
                      </section>
                    );
                  })}

                  {orphanArtifacts.length > 0 && (
                    <section className="mb-4">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                        Additional evidence
                      </h3>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {orphanArtifacts.map((art) => (
                          <ArtifactCard
                            key={art.id}
                            art={art}
                            bundle={bundle}
                            openScript={openScript}
                            setOpenScript={setOpenScript}
                            onZoom={onZoom}
                          />
                        ))}
                      </div>
                    </section>
                  )}
                </>
              ) : (
                <>
                  {/* backward-compat: metric tiles + full gallery */}
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
                          <div className="text-lg font-bold text-stone-900">
                            {metric.value}
                          </div>
                          {metric.note && (
                            <div className="text-[11px] text-stone-400">
                              {metric.note}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {m && m.artifacts.length === 0 ? (
                    <div className="mb-4 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-5 text-sm text-stone-600">
                      <div className="font-semibold text-stone-700">
                        Summary only
                      </div>
                      <p className="mt-1">
                        No figures or tables in this bundle. The report and
                        metrics were captured, but the analysis outputs could not
                        be reproduced (common for retrospective captures, where
                        outputs were never saved to files). If a producing script
                        exists, re-run it and capture again; otherwise run{" "}
                        <code>/research-plans:results</code> and name the output
                        file paths directly.
                      </p>
                    </div>
                  ) : m ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      {m.artifacts.map((art) => (
                        <ArtifactCard
                          key={art.id}
                          art={art}
                          bundle={bundle}
                          openScript={openScript}
                          setOpenScript={setOpenScript}
                          onZoom={onZoom}
                        />
                      ))}
                    </div>
                  ) : null}
                </>
              )}
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

        {zoom && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
            role="dialog"
            aria-label={`Enlarged: ${zoom.title}`}
            onClick={() => setZoom(null)}
          >
            <img
              src={zoom.url}
              alt={zoom.title}
              className="max-h-full max-w-full rounded object-contain"
            />
          </div>
        )}
      </div>
    </div>
  );
}
