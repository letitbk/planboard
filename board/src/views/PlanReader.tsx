import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "../components/Markdown";
import DiffView from "../components/DiffView";
import AnnotationLayer from "../components/AnnotationLayer";
import { Notice } from "./Tracker";
import { parseExecutionPlan, parseMasterPlan, parseServes } from "../lib/parse";
import type {
  Annotation,
  BoardData,
  ExecutionPlanGroup,
  PlanCommentAnnotation,
} from "../lib/types";

interface DocRef {
  group: ExecutionPlanGroup;
  version: number;
  isDraft: boolean;
  path: string;
  content: string;
}

export default function PlanReader({
  data,
  canAnnotate,
  selectedComponent,
  onSelectComponent,
  annotations,
  onAddPlanComment,
  onPaintResult,
  onOpenResults,
}: {
  data: BoardData;
  canAnnotate: boolean;
  selectedComponent: string | null;
  onSelectComponent: (slug: string) => void;
  annotations: Annotation[];
  onAddPlanComment: (
    a: Omit<PlanCommentAnnotation, "id" | "type">,
  ) => void;
  onPaintResult: (paintedIds: Set<string>, docKey: string) => void;
  onOpenResults: (slug: string) => void;
}) {
  const groups = data.files.executionPlans;
  const group =
    groups.find((g) => g.component === selectedComponent) ?? groups[0] ?? null;

  const docs: DocRef[] = useMemo(() => {
    if (!group) return [];
    const out: DocRef[] = group.versions
      .slice()
      .sort((a, b) => a.version - b.version)
      .map((v) => ({
        group,
        version: v.version,
        isDraft: false,
        path: v.path,
        content: v.content,
      }));
    if (group.draft) {
      out.push({
        group,
        version: group.draft.proposedVersion,
        isDraft: true,
        path: group.draft.path,
        content: group.draft.content,
      });
    }
    return out;
  }, [group]);

  const [docIdx, setDocIdx] = useState(docs.length - 1);
  useEffect(() => setDocIdx(docs.length - 1), [group?.component, docs.length]);
  const doc = docs[Math.min(docIdx, docs.length - 1)] ?? null;

  const prevDoc = useMemo(() => {
    if (!doc) return null;
    const before = docs.filter(
      (d) => !d.isDraft && (doc.isDraft ? true : d.version < doc.version),
    );
    return before.length > 0 ? before[before.length - 1] : null;
  }, [doc, docs]);

  const [diffOn, setDiffOn] = useState(false);
  useEffect(() => {
    setDiffOn(Boolean(doc?.isDraft && prevDoc));
  }, [doc?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = useMemo(
    () => (doc ? parseExecutionPlan(doc.content) : null),
    [doc],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToSection = useCallback((heading: string) => {
    const host = scrollRef.current;
    if (!host) return;
    const h2s = host.querySelectorAll("h2");
    for (const h of h2s) {
      if ((h.textContent ?? "").trim() === heading) {
        h.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
  }, []);

  const docAnnotations = useMemo(
    () =>
      annotations.filter(
        (a): a is PlanCommentAnnotation =>
          a.type === "plan-comment" && doc !== null && a.planPath === doc.path,
      ),
    [annotations, doc],
  );

  if (!group || !doc) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 bg-white p-10 text-center text-sm text-stone-500">
        No execution plans yet. Scope the first component with{" "}
        <code>/research-plans:plan</code>.
      </div>
    );
  }

  const stale =
    doc.isDraft &&
    group.versions.some((v) => v.version >= (group.draft?.proposedVersion ?? 0));

  return (
    <div className="flex gap-5">
      {/* Sidebar */}
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

        {parsed?.ok && (
          <>
            <h2 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-stone-500">
              Sections
            </h2>
            <ul className="space-y-0.5">
              {parsed.sections.map((s) => (
                <li key={s.heading}>
                  <button
                    className="w-full rounded px-2 py-1 text-left text-xs text-stone-600 hover:bg-stone-100"
                    onClick={() => scrollToSection(s.heading)}
                  >
                    {s.heading}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>

      {/* Main pane */}
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {docs.map((d, i) => (
            <button
              key={d.path}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                i === Math.min(docIdx, docs.length - 1)
                  ? "border-stone-900 bg-stone-900 text-white"
                  : "border-stone-300 bg-white text-stone-600 hover:border-stone-500"
              } ${d.isDraft ? "border-dashed" : ""}`}
              onClick={() => setDocIdx(i)}
            >
              {d.isDraft ? `proposed v${d.version} (draft)` : `v${d.version}`}
            </button>
          ))}
          {prevDoc && (
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-stone-600">
              <input
                type="checkbox"
                checked={diffOn}
                onChange={(e) => setDiffOn(e.target.checked)}
              />
              Diff vs v{prevDoc.version}
            </label>
          )}
        </div>

        {(group.results ?? []).some(
          (b) => b.manifest?.planVersion === doc.version && !doc.isDraft,
        ) && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
            Results under this version:
            {(group.results ?? [])
              .filter((b) => b.manifest?.planVersion === doc.version)
              .map((b) => (
                <button
                  key={b.dir}
                  className="rounded-full border border-stone-300 bg-white px-2 py-0.5 font-medium text-blue-700 hover:border-stone-500"
                  onClick={() => onOpenResults(group.component)}
                >
                  r{b.resultsVersion}
                  {b.verdict?.status === "accepted"
                    ? " ✓"
                    : b.verdict?.status === "changes-requested"
                      ? " ✕"
                      : " ●"}
                </button>
              ))}
          </div>
        )}

        {doc.isDraft && (
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-800">
              Unsigned draft
            </span>
            {stale && (
              <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-red-800">
                Stale — a signed version already supersedes this draft
              </span>
            )}
          </div>
        )}

        {parsed?.ok &&
          parsed.serves &&
          (() => {
            const mp = parseMasterPlan(data.files.masterPlan.content);
            const tokens = parseServes(parsed.serves).tokens;
            const rqs = mp.ok
              ? mp.researchQuestions.filter((q) => tokens.includes(`RQ${q.num}`))
              : [];
            return (
              <div className="mb-2">
                <span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-700">
                  Serves: {parsed.serves}
                </span>
                {rqs.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {rqs.map((q) => (
                      <li key={q.num} className="text-[11px] leading-snug text-stone-500">
                        <span className="font-semibold text-stone-600">
                          RQ{q.num}
                        </span>{" "}
                        — {q.text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })()}

        {parsed && !parsed.ok && (
          <Notice text="This plan did not match the expected execution-plan format — showing it raw." />
        )}

        {diffOn && prevDoc ? (
          <DiffView
            before={prevDoc.content}
            after={doc.content}
            supersedesReason={parsed?.supersedes ?? null}
          />
        ) : (
          <div
            ref={scrollRef}
            className="rounded-lg border border-stone-200 bg-white p-6"
          >
            {canAnnotate ? (
              <AnnotationLayer
                docKey={doc.path}
                annotations={docAnnotations}
                onPaintResult={onPaintResult}
                onAdd={(partial) =>
                  onAddPlanComment({
                    ...partial,
                    planPath: doc.path,
                    component: group.component,
                    version: doc.version,
                    isDraft: doc.isDraft,
                  })
                }
              >
                <Markdown source={doc.content} />
              </AnnotationLayer>
            ) : (
              <Markdown source={doc.content} />
            )}
            {parsed?.ok && (
              <div className="mt-4 border-t border-stone-100 pt-3 text-xs">
                {parsed.signedOff ? (
                  <span className="rounded bg-green-50 px-2 py-1 font-medium text-green-800">
                    Signed off: {parsed.signedOff}
                  </span>
                ) : (
                  <span className="rounded bg-amber-50 px-2 py-1 font-medium text-amber-800">
                    No sign-off line
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        {canAnnotate && (
          <p className="mt-2 text-xs text-stone-400">
            Select any text in the plan to attach a comment.
          </p>
        )}
      </div>
    </div>
  );
}
