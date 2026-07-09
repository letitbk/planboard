import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "../components/Markdown";
import DiffView from "../components/DiffView";
import AnnotationLayer from "../components/AnnotationLayer";
import ReviewMenu from "../components/ReviewMenu";
import { Notice } from "./Tracker";
import {
  AGENT_SECTIONS,
  parseExecutionPlan,
  parseMasterPlan,
  parseServes,
  preRenewalSlugs,
} from "../lib/parse";
import type {
  Annotation,
  BoardData,
  DraftSnapshotFile,
  ExecutionPlanGroup,
  PlanCommentAnnotation,
  ReviewRequest,
} from "../lib/types";

type DocKind = "signed" | "workingDraft" | "draftSnapshot";

interface DocRef {
  group: ExecutionPlanGroup;
  version: number;
  iteration?: number; // draftSnapshot only
  docKind: DocKind;
  isDraft: boolean; // convenience: docKind !== "signed"
  path: string;
  content: string;
}

const docLabel = (d: DocRef): string =>
  d.docKind === "draftSnapshot"
    ? `v${d.version}·d${d.iteration}`
    : d.docKind === "workingDraft"
      ? `proposed v${d.version}`
      : `v${d.version}`;

export default function PlanReader({
  data,
  canAnnotate,
  selectedComponent,
  onSelectComponent,
  annotations,
  onAddPlanComment,
  onPaintResult,
  onOpenResults,
  canPost,
  onRequestReview,
}: {
  data: BoardData;
  canAnnotate: boolean;
  selectedComponent: string | null;
  onSelectComponent: (slug: string) => void;
  annotations: Annotation[];
  onAddPlanComment: (
    a: Omit<PlanCommentAnnotation, "id" | "type">,
  ) => void;
  onPaintResult: (
    paintedIds: Set<string>,
    docKey: string,
    scopeAbsent: Set<string>,
  ) => void;
  onOpenResults: (slug: string) => void;
  canPost?: boolean;
  onRequestReview?: (req: ReviewRequest) => void;
}) {
  const groups = data.files.executionPlans;
  const preRenewal = preRenewalSlugs(data);
  const group =
    groups.find((g) => g.component === selectedComponent) ?? groups[0] ?? null;

  // The full version history in chronological order: for each version number,
  // its committed draft iterations (vN-draft-K) in order, then the signed vN (or
  // the still-unsigned working draft). Reads idea → signed left to right.
  const docs: DocRef[] = useMemo(() => {
    if (!group) return [];
    const snapsByVersion = new Map<number, DraftSnapshotFile[]>();
    for (const s of group.draftSnapshots ?? []) {
      const list = snapsByVersion.get(s.version) ?? [];
      list.push(s);
      snapsByVersion.set(s.version, list);
    }
    const signedByVersion = new Map(group.versions.map((v) => [v.version, v]));
    const draftVersion = group.draft?.proposedVersion ?? null;
    const versionNums = [
      ...new Set<number>([
        ...group.versions.map((v) => v.version),
        ...(group.draftSnapshots ?? []).map((s) => s.version),
        ...(draftVersion !== null ? [draftVersion] : []),
      ]),
    ].sort((a, b) => a - b);

    const out: DocRef[] = [];
    let draftPushed = false;
    const pushDraft = () => {
      if (!group.draft) return;
      out.push({
        group,
        version: group.draft.proposedVersion,
        docKind: "workingDraft",
        isDraft: true,
        path: group.draft.path,
        content: group.draft.content,
      });
      draftPushed = true;
    };
    for (const n of versionNums) {
      for (const s of (snapsByVersion.get(n) ?? [])
        .slice()
        .sort((a, b) => a.iteration - b.iteration)) {
        out.push({
          group,
          version: n,
          iteration: s.iteration,
          docKind: "draftSnapshot",
          isDraft: true,
          path: s.path,
          content: s.content,
        });
      }
      const signed = signedByVersion.get(n);
      if (signed) {
        out.push({
          group,
          version: n,
          docKind: "signed",
          isDraft: false,
          path: signed.path,
          content: signed.content,
        });
      }
      // The working draft shows at its proposedVersion when that version has no
      // signed vN yet. If a signed vN already exists there, the draft is a stale
      // leftover — still shown (appended at the end) so the stale banner can warn.
      if (draftVersion === n && !signed) pushDraft();
    }
    if (!draftPushed) pushDraft();
    return out;
  }, [group]);

  const [docIdx, setDocIdx] = useState(docs.length - 1);
  useEffect(() => setDocIdx(docs.length - 1), [group?.component, docs.length]);
  const curIdx = Math.min(docIdx, docs.length - 1);
  const doc = docs[curIdx] ?? null;

  // Part 2 (agent/technical half) collapse state; reset when the shown doc changes.
  const [agentOpen, setAgentOpen] = useState(false);
  useEffect(() => setAgentOpen(false), [doc?.path]);

  // Diff base is the immediately preceding step in the version history (previous
  // snapshot, signed version, or working draft) — reads the evolution in order.
  const prevDoc = curIdx > 0 ? docs[curIdx - 1] : null;

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
    // Agent sections sit in the collapsed Part 2 — open it, then scroll once the
    // DOM has reflowed.
    if (AGENT_SECTIONS.includes(heading)) setAgentOpen(true);
    const doScroll = () => {
      const host = scrollRef.current;
      if (!host) return;
      for (const h of host.querySelectorAll("h2")) {
        if ((h.textContent ?? "").trim() === heading) {
          h.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(doScroll));
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
      <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-10 text-center text-sm text-stone-500">
        No execution plans yet. Scope the first component with{" "}
        <code>/research-plans:plan</code>.
      </div>
    );
  }

  const stale =
    doc.docKind === "workingDraft" &&
    group.versions.some((v) => v.version >= (group.draft?.proposedVersion ?? 0));

  // Snapshots (committed draft iterations) are read-only: viewed and diffed,
  // never annotated. Feedback routing must not touch an immutable snapshot.
  const annotatable = canAnnotate && doc.docKind !== "draftSnapshot";

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
                    ? "bg-stone-900 dark:bg-stone-200 font-medium text-white dark:text-stone-900"
                    : "text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800"
                }`}
                onClick={() => onSelectComponent(g.component)}
              >
                {g.component}
                {preRenewal.has(g.component) && (
                  <span className="ml-1 rounded bg-stone-200 dark:bg-stone-700 px-1 py-0.5 text-[10px] text-stone-600 dark:text-stone-400">
                    pre-renewal
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>

        {parsed?.ok &&
          (
            [
              {
                label: "Part 1 · for humans",
                items: parsed.sections.filter(
                  (s) => !AGENT_SECTIONS.includes(s.heading),
                ),
              },
              {
                label: "Part 2 · for agents",
                items: parsed.sections.filter((s) =>
                  AGENT_SECTIONS.includes(s.heading),
                ),
              },
            ] as const
          ).map((grp) =>
            grp.items.length === 0 ? null : (
              <div key={grp.label}>
                <h2 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-stone-500">
                  {grp.label}
                </h2>
                <ul className="space-y-0.5">
                  {grp.items.map((s) => (
                    <li key={s.heading}>
                      <button
                        className="w-full rounded px-2 py-1 text-left text-xs text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
                        onClick={() => scrollToSection(s.heading)}
                      >
                        {s.heading}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
      </aside>

      {/* Main pane */}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          {docs.map((d, i) =>
            d.docKind === "draftSnapshot" ? null : (
              <button
                key={d.path}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  i === curIdx
                    ? "border-stone-900 bg-stone-900 dark:bg-stone-200 text-white dark:text-stone-900"
                    : "border-stone-300 dark:border-stone-600 bg-white text-stone-600 hover:border-stone-500 dark:hover:border-stone-400"
                } ${d.docKind === "workingDraft" ? "border-dashed" : ""}`}
                onClick={() => setDocIdx(i)}
              >
                {d.docKind === "workingDraft"
                  ? `proposed v${d.version} (draft)`
                  : `v${d.version}`}
              </button>
            ),
          )}
          <div className="ml-auto flex items-center gap-2">
            {canPost && !data.gate && onRequestReview && doc.docKind !== "draftSnapshot" && (
              <ReviewMenu
                onPick={(agent) =>
                  onRequestReview({
                    agent,
                    scope: "plan",
                    component: group.component,
                    version: doc.version,
                    planPath: doc.path,
                    isDraft: doc.isDraft,
                  })
                }
              />
            )}
            {prevDoc && (
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-stone-600 dark:text-stone-400">
                <input
                  type="checkbox"
                  checked={diffOn}
                  onChange={(e) => setDiffOn(e.target.checked)}
                />
                Diff vs {docLabel(prevDoc)}
              </label>
            )}
          </div>
        </div>

        {docs.some((d) => d.docKind === "draftSnapshot") && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="text-xs uppercase tracking-wide text-stone-400 dark:text-stone-500">
              iterations
            </span>
            {docs.map((d, i) =>
              d.docKind !== "draftSnapshot" ? null : (
                <button
                  key={d.path}
                  title="Committed draft iteration — read-only"
                  className={`rounded border px-2 py-0.5 text-xs ${
                    i === curIdx
                      ? "border-stone-900 bg-stone-100 font-semibold text-stone-900 dark:text-stone-100"
                      : "border-dashed border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 text-stone-500 hover:border-stone-500 dark:hover:border-stone-400"
                  }`}
                  onClick={() => setDocIdx(i)}
                >
                  {docLabel(d)}
                </button>
              ),
            )}
          </div>
        )}

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
                  className="rounded-full border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-2 py-0.5 font-medium text-blue-700 dark:text-blue-400 hover:border-stone-500 dark:hover:border-stone-400"
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

        {doc.docKind === "workingDraft" && (
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
              Unsigned draft
            </span>
            {stale && (
              <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-red-800 dark:text-red-300">
                Stale — a signed version already supersedes this draft
              </span>
            )}
          </div>
        )}

        {doc.docKind === "draftSnapshot" && (
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded bg-stone-100 dark:bg-stone-800 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-stone-600 dark:text-stone-400">
              Draft iteration {docLabel(doc)} · read-only
            </span>
          </div>
        )}

        {parsed?.ok && parsed.provenance && (
          <div className="mb-2">
            <span
              className="rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300"
              title="Written after the work it documents — a declared, evidence-cited reconstruction, not a prospective plan."
            >
              Provenance: {parsed.provenance}
            </span>
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
                <span className="rounded bg-stone-100 dark:bg-stone-800 px-2 py-0.5 text-xs font-semibold text-stone-700 dark:text-stone-300">
                  Serves: {parsed.serves}
                </span>
                {rqs.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {rqs.map((q) => (
                      <li key={q.num} className="text-[11px] leading-snug text-stone-500">
                        <span className="font-semibold text-stone-600 dark:text-stone-400">
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
            className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-6"
          >
            {annotatable ? (
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
                <PlanBody
                content={doc.content}
                open={agentOpen}
                onToggle={() => setAgentOpen((o) => !o)}
              />
              </AnnotationLayer>
            ) : (
              <PlanBody
                content={doc.content}
                open={agentOpen}
                onToggle={() => setAgentOpen((o) => !o)}
              />
            )}
            {parsed?.ok && (
              <div className="mt-4 border-t border-stone-100 dark:border-stone-800 pt-3 text-xs">
                {parsed.signedOff ? (
                  <span className="rounded bg-green-50 dark:bg-green-950 px-2 py-1 font-medium text-green-800 dark:text-green-300">
                    Signed off: {parsed.signedOff}
                  </span>
                ) : (
                  <span className="rounded bg-amber-50 dark:bg-amber-950 px-2 py-1 font-medium text-amber-800 dark:text-amber-300">
                    No sign-off line
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        {annotatable && (
          <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
            Select any text in the plan to attach a comment.
          </p>
        )}
        {canAnnotate && doc.docKind === "draftSnapshot" && (
          <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
            Draft iterations are read-only history — open the signed version or
            working draft to comment.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Split a plan on its "## Part 2 —" banner. Returns the human half, the agent
 * half (everything after the Part-2 heading line), and the heading text for the
 * toggle. Old-format plans with no banner return agent:null (rendered whole).
 */
function splitParts(content: string): {
  human: string;
  agent: string | null;
  heading: string;
} {
  const m = /^## Part 2\b[^\n]*$/m.exec(content);
  if (!m) return { human: content, agent: null, heading: "" };
  return {
    human: content.slice(0, m.index),
    agent: content.slice(m.index + m[0].length),
    heading: m[0].replace(/^##\s*/, "").trim(),
  };
}

/**
 * Renders a plan body with Part 2 (the agent/technical half) collapsed under a
 * toggle. Both halves stay inside the caller's single AnnotationLayer container,
 * so comment anchoring — occurrence-counted over the whole rendered text — is
 * unchanged. The collapsed half is clipped (max-h-0), never unmounted, so its
 * painted highlights survive and reveal on expand. The toggle's label is the
 * verbatim Part-2 heading text, keeping the container's text content identical
 * to a single-blob render.
 */
function PlanBody({
  content,
  open,
  onToggle,
}: {
  content: string;
  open: boolean;
  onToggle: () => void;
}) {
  const { human, agent, heading } = splitParts(content);
  if (agent === null) return <Markdown source={content} />;
  return (
    <>
      <Markdown source={human} />
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="mt-4 flex w-full items-center gap-2 border-t border-stone-200 dark:border-stone-800 pt-4 text-left text-lg font-bold text-stone-900 dark:text-stone-100 hover:text-stone-600"
      >
        <svg
          className={`h-4 w-4 shrink-0 text-stone-400 dark:text-stone-500 transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M6 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {heading}
      </button>
      <div className={open ? "mt-2" : "max-h-0 overflow-hidden"} aria-hidden={!open}>
        <Markdown source={agent} />
      </div>
    </>
  );
}
