import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Marked } from "marked";
import Markdown from "../components/Markdown";
import ModelChip from "../components/ModelChip";
import ScorePanel from "../components/ScorePanel";
import { parsePlanModelMarker } from "../lib/modelUsage";
import DiffView from "../components/DiffView";
import AnnotationLayer from "../components/AnnotationLayer";
import ReviewMenu from "../components/ReviewMenu";
import { Notice } from "./Tracker";
import {
  METHOD_SECTIONS,
  parseExecutionPlan,
  parseMasterPlan,
  parseScorecard,
  parseServes,
} from "../lib/parse";
import { actionsVisible, planActionState } from "../lib/actions";
import { bundleStateMark } from "../lib/bundleState";
import RequestChangesButton from "../components/RequestChangesButton";
import type {
  Annotation,
  BoardData,
  DraftSnapshotFile,
  ExecutionPlanGroup,
  ParsedExecutionPlan,
  PlanCommentAnnotation,
  ReviewRequest,
  SignoffRequest,
} from "../lib/types";
import type { OutlineEntry } from "../lib/outline";
import type { ActiveFileRef } from "../lib/filesTree";
import { prefersReducedMotion, useScrollSpy } from "../lib/scrollSpy";

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

// Metadata preamble lines render as a card and are stripped from the prose so
// they don't render twice. The H1 title is KEPT (it is the plan's only
// human-readable title). Anything else in the preamble still renders below
// the card. Annotations on metadata lines unanchor by design (ruled v0.21).
const METADATA_LINE_RE =
  /^(?:Component:.*|Master plan:.*|Date:.*|Provenance:.*|Supersedes:.*)$/;
export function stripPreambleMetadata(body: string): string {
  return body
    .split("\n")
    .filter((ln) => !METADATA_LINE_RE.test(ln.trim()))
    .join("\n")
    .trim();
}

/** "[label](target)" → "label"; plain strings pass through. */
export function linkLabel(v: string): string {
  return /^\[([^\]]+)\]\([^)]*\)$/.exec(v.trim())?.[1] ?? v;
}

function metadataRows(parsed: ParsedExecutionPlan): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (parsed.componentSlug) rows.push(["Component", parsed.componentSlug]);
  if (parsed.version != null) rows.push(["Version", `v${parsed.version}`]);
  if (parsed.date) rows.push(["Date", parsed.date]);
  if (parsed.provenance) rows.push(["Provenance", parsed.provenance]);
  if (parsed.supersedes) rows.push(["Supersedes", parsed.supersedes]);
  if (parsed.masterPlan) rows.push(["Master plan", linkLabel(parsed.masterPlan)]);
  return rows;
}

function MetadataCard({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-800 dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-200">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <span className="font-medium" style={{ color: "var(--rp-prose-muted)" }}>{k}</span>
          <span>{v}</span>
        </Fragment>
      ))}
    </div>
  );
}

// Build steps render as a numbered card spine (spec R2). Boundaries come from
// marked's lexer (structural, never regex). Each item re-renders through
// BodyParts so agent-detail keeps working; reference-link definitions from the
// whole body are appended so cross-item links survive; GFM task state renders
// in the card chrome (marked strips it from item.text). CRLF is normalized
// up front — marked normalizes internally, which would break raw indexing.
// Semantic <ol>/<li> so assistive tech still announces an ordered list.
const stepLexer = new Marked({ gfm: true });
const LINK_DEF_RE = /^\[[^\]]+\]:\s+\S.*$/gm;

interface StepItem { text: string; task: boolean; checked: boolean }

export function splitBuildSteps(
  rawBody: string,
): { before: string; items: StepItem[]; after: string } | null {
  const body = rawBody.replace(/\r\n/g, "\n");
  const tokens = stepLexer.lexer(body);
  const list = tokens.find(
    (t) => t.type === "list" && (t as { ordered?: boolean }).ordered,
  ) as { raw: string; items: Array<{ text: string; task: boolean; checked?: boolean }> } | undefined;
  if (!list) return null;
  const start = body.indexOf(list.raw);
  if (start === -1) return null;
  const defs = (body.match(LINK_DEF_RE) ?? []).join("\n");
  return {
    before: body.slice(0, start).trim(),
    items: list.items.map((it) => ({
      text: defs ? `${it.text}\n\n${defs}` : it.text,
      task: it.task,
      checked: Boolean(it.checked),
    })),
    after: body.slice(start + list.raw.length).trim(),
  };
}

function StepCards({ body, detailOpen }: { body: string; detailOpen: boolean }) {
  const split = useMemo(() => splitBuildSteps(body), [body]);
  if (!split) return <BodyParts source={body} detailOpen={detailOpen} />;
  return (
    <>
      {split.before && <BodyParts source={split.before} detailOpen={detailOpen} />}
      <ol className="ml-0 list-none">
        {split.items.map((it, i) => (
          <li
            key={i}
            className="my-3 rounded-lg border border-stone-200 p-4 dark:border-stone-700"
          >
            <div
              className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: "var(--rp-prose-muted)" }}
            >
              Step {i + 1} of {split.items.length}
              {it.task && (
                <input type="checkbox" disabled checked={it.checked} className="accent-green-600" />
              )}
            </div>
            <BodyParts source={it.text} detailOpen={detailOpen} />
          </li>
        ))}
      </ol>
      {split.after && <BodyParts source={split.after} detailOpen={detailOpen} />}
    </>
  );
}

export default function PlanReader({
  data,
  canAnnotate,
  selectedComponent,
  annotations,
  onAddPlanComment,
  onPaintResult,
  onOpenResults,
  onRequestReview,
  onSignoff,
  navRequest,
  onOpenReport,
  onOutline,
  onActiveOutline,
  onActiveFile,
}: {
  data: BoardData;
  canAnnotate: boolean;
  selectedComponent: string | null;
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
  onRequestReview?: (req: ReviewRequest) => void;
  onSignoff?: (req: SignoffRequest) => void;
  // Click-sync (control surface): one-shot navigation request from a feedback
  // card. Internal selection stays authoritative; each new token overrides.
  navRequest?: { token: number; planPath?: string } | null;
  onOpenReport?: (slug: string, resultsVersion: number) => void;
  onOutline?: (entries: OutlineEntry[]) => void;
  onActiveOutline?: (id: string | null) => void;
  onActiveFile?: (ref: ActiveFileRef | null) => void;
}) {
  const groups = data.files.executionPlans;
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
  // Apply a click-sync navigation request: resolve the target path to this
  // view's own index. User clicks afterwards still work (state stays local).
  useEffect(() => {
    if (!navRequest?.planPath) return;
    const i = docs.findIndex((d) => d.path === navRequest.planPath);
    if (i >= 0) setDocIdx(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRequest?.token]);
  const curIdx = Math.min(docIdx, docs.length - 1);
  const doc = docs[curIdx] ?? null;
  useEffect(() => {
    if (!doc) return;
    const label =
      doc.docKind === "workingDraft"
        ? `proposed v${doc.version} (draft) — ${doc.group.component}`
        : doc.docKind === "draftSnapshot"
          ? `v${doc.version}·d${doc.iteration} — ${doc.group.component}`
          : `v${doc.version} — ${doc.group.component}`;
    onActiveFile?.({ id: doc.path, label });
    return () => onActiveFile?.(null);
  }, [onActiveFile, doc]);

  // Reader detail level (project default; the reader can still toggle any block).
  const level: DetailLevel = data.detailLevel ?? "standard";

  // Diff base is the immediately preceding step in the version history (previous
  // snapshot, signed version, or working draft) — reads the evolution in order.
  const prevDoc = curIdx > 0 ? docs[curIdx - 1] : null;

  const [diffOn, setDiffOn] = useState(false);
  useEffect(() => {
    setDiffOn(Boolean(doc?.isDraft && prevDoc));
  }, [doc?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  // Strip the leading rp-model provenance marker before parsing/rendering/diff
  // (a malformed one would otherwise swallow the plan body in Markdown).
  const planMarker = useMemo(
    () => (doc ? parsePlanModelMarker(doc.content) : null),
    [doc],
  );
  const docBody = planMarker ? planMarker.body : "";
  const prevBody = useMemo(
    () => (prevDoc ? parsePlanModelMarker(prevDoc.content).body : ""),
    [prevDoc],
  );
  const parsed = useMemo(
    () => (planMarker ? parseExecutionPlan(planMarker.body) : null),
    [planMarker],
  );
  const cardRows = parsed?.ok ? metadataRows(parsed) : [];

  const scrollRef = useRef<HTMLDivElement>(null);
  const activeHeading = useScrollSpy(
    scrollRef,
    "[data-outline-id]",
    [doc?.path, level, diffOn],
  );
  const scrollToSection = useCallback((heading: string) => {
    // Every section heading renders even when its body is collapsed, so scrolling
    // to the h2 works at any detail level.
    const doScroll = () => {
      const host = scrollRef.current;
      if (!host) return;
      for (const h of host.querySelectorAll("h2")) {
        if ((h.textContent ?? "").trim() === heading) {
          h.scrollIntoView({
            behavior: prefersReducedMotion() ? "auto" : "smooth",
            block: "start",
          });
          return;
        }
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(doScroll));
  }, []);

  const outlineEntries = useMemo<OutlineEntry[]>(
    () =>
      parsed?.ok && !(diffOn && prevDoc)
        ? parsed.sections.map((s) => ({
            id: s.heading,
            label: s.heading,
            level: 1,
            onSelect: () => scrollToSection(s.heading),
          }))
        : [],
    [parsed, diffOn, prevDoc, scrollToSection],
  );
  useEffect(() => {
    onOutline?.(outlineEntries);
    return () => onOutline?.([]);
  }, [onOutline, outlineEntries]);
  useEffect(() => {
    onActiveOutline?.(
      activeHeading?.getAttribute("data-outline-id") ?? null,
    );
    return () => onActiveOutline?.(null);
  }, [onActiveOutline, activeHeading]);

  const docAnnotations = useMemo(
    () =>
      annotations.filter(
        (a): a is PlanCommentAnnotation =>
          a.type === "plan-comment" && doc !== null && a.planPath === doc.path,
      ),
    [annotations, doc],
  );

  // The five-channel score for THIS document, matched by the scorecard's
  // authoritative planPath. v0.20: the working draft is scorable too (the
  // review room scores before sign-off; review.md's idempotence rule migrates
  // the card's planPath to the signed file). Snapshots never carry a score.
  // A duplicate match is ambiguous — show nothing rather than a wrong score.
  const scorecard = useMemo(() => {
    if (!doc || (doc.docKind !== "signed" && doc.docKind !== "workingDraft")) return null;
    const matches = data.files.reviews
      .map((r) => parseScorecard(r.content))
      .filter((sc) => sc && sc.planPath === doc.path);
    return matches.length === 1 ? matches[0] : null;
  }, [doc, data.files.reviews]);

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
    <div className="min-w-0">
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
            {scorecard && <ScorePanel scorecard={scorecard} />}
            {actionsVisible(data) && onSignoff && doc.docKind === "workingDraft" && group && (() => {
              const st = planActionState(data, group.component, annotations);
              if (st.kind !== "approve") return null;
              return (
                <span className="flex items-center gap-1">
                  <button
                    className="rounded border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950 px-2 py-0.5 text-xs font-medium text-green-800 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/40 disabled:opacity-40"
                    disabled={st.blockedByComments}
                    title={st.blockedByComments ? "Send or delete the pending comments on this draft first" : undefined}
                    onClick={() => onSignoff({ component: group.component, version: st.version as number, decision: "approve" })}
                  >
                    Approve v{st.version}
                  </button>
                  <RequestChangesButton
                    requireReason={!st.blockedByComments}
                    onSubmit={(reason) =>
                      onSignoff({ component: group.component, version: st.version as number, decision: "request-changes", reason })
                    }
                  />
                </span>
              );
            })()}
            {actionsVisible(data) && onRequestReview && doc.docKind !== "draftSnapshot" && (
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
                <Fragment key={b.dir}>
                  <button
                    className="rounded-full border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-2 py-0.5 font-medium text-blue-700 dark:text-blue-400 hover:border-stone-500 dark:hover:border-stone-400"
                    onClick={() => onOpenResults(group.component)}
                  >
                    r{b.resultsVersion}
                    {bundleStateMark(b)}
                  </button>
                  {b.publishedReport && onOpenReport && (
                    <button
                      className="rounded-full border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-stone-900 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-400 hover:border-emerald-500"
                      onClick={() => onOpenReport(group.component, b.resultsVersion)}
                    >
                      report
                    </button>
                  )}
                </Fragment>
              ))}
          </div>
        )}

        {doc.docKind === "workingDraft" && (
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
              Unsigned draft
            </span>
            {stale && (
              <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-red-800 dark:bg-red-950 dark:text-red-300">
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
            before={prevBody}
            after={docBody}
            supersedesReason={parsed?.supersedes ?? null}
          />
        ) : (
          <div
            ref={scrollRef}
            className="max-w-[52rem] rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-6"
          >
            {planMarker?.modelUsage && (
              <div className="mb-3 flex justify-end">
                <ModelChip usage={planMarker.modelUsage} />
              </div>
            )}
            {planMarker?.malformed && (
              <div className="mb-3 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                This plan's model-provenance marker is unreadable — the plan body is shown; regenerate or fix the marker to restore the model chip.
              </div>
            )}
            {cardRows.length > 0 && <MetadataCard rows={cardRows} />}
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
                <PlanBody content={docBody} level={level} stripMetadata={cardRows.length > 0} />
              </AnnotationLayer>
            ) : (
              <PlanBody content={docBody} level={level} stripMetadata={cardRows.length > 0} />
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
  );
}

type DetailLevel = "compact" | "standard" | "full";

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Split a plan into sections on `## ` headings. The chunk before the first
// heading is returned with heading=null. The body excludes the heading line.
function splitSections(content: string): { heading: string | null; body: string }[] {
  const out: { heading: string | null; body: string }[] = [];
  let heading: string | null = null;
  let body: string[] = [];
  const flush = () => {
    const b = body.join("\n");
    if (heading !== null || b.trim()) out.push({ heading, body: b });
  };
  for (const line of content.split("\n")) {
    const m = /^## (.+?)\s*$/.exec(line);
    if (m) {
      flush();
      heading = m[1].trim();
      body = [];
    } else body.push(line);
  }
  flush();
  return out;
}

const AGENT_DETAIL_RE =
  /<details class="agent-detail">\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g;

type MdPart =
  | { kind: "md"; text: string }
  | { kind: "detail"; summary: string; body: string };

// Split a section body into Markdown spans and agent-detail blocks. Rendered via
// a dedicated component, never as raw HTML (Markdown escapes HTML) — this is the
// safe renderer for the <details class="agent-detail"> convention.
function splitAgentDetail(source: string): MdPart[] {
  const parts: MdPart[] = [];
  let last = 0;
  AGENT_DETAIL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AGENT_DETAIL_RE.exec(source))) {
    if (m.index > last) parts.push({ kind: "md", text: source.slice(last, m.index) });
    parts.push({ kind: "detail", summary: m[1].trim(), body: m[2].trim() });
    last = m.index + m[0].length;
  }
  if (last < source.length) parts.push({ kind: "md", text: source.slice(last) });
  return parts.length ? parts : [{ kind: "md", text: source }];
}

// Render a body's Markdown + agent-detail blocks. Collapsed content is clipped
// (max-h-0), never unmounted, so AnnotationLayer highlights survive and the
// container's text content is stable regardless of collapse state.
function BodyParts({ source, detailOpen }: { source: string; detailOpen: boolean }) {
  return (
    <>
      {splitAgentDetail(source).map((p, i) =>
        p.kind === "md" ? (
          <Markdown key={i} source={p.text} />
        ) : (
          <AgentDetailBlock key={i} summary={p.summary} body={p.body} forceOpen={detailOpen} />
        ),
      )}
    </>
  );
}

function AgentDetailBlock({
  summary,
  body,
  forceOpen,
}: {
  summary: string;
  body: string;
  forceOpen: boolean;
}) {
  const [open, setOpen] = useState(forceOpen);
  useEffect(() => setOpen(forceOpen), [forceOpen]);
  return (
    <div className="my-2 rounded border border-stone-200 dark:border-stone-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs font-medium text-stone-500 hover:bg-stone-50 dark:hover:bg-stone-800"
      >
        <Caret open={open} />
        {summary || "Agent detail"}
      </button>
      <div className={open ? "px-3 pb-2" : "max-h-0 overflow-hidden"} aria-hidden={!open}>
        <Markdown source={body} />
      </div>
    </div>
  );
}

function SectionBlock({
  heading,
  body,
  level,
}: {
  heading: string;
  body: string;
  level: DetailLevel;
}) {
  const isMethod = METHOD_SECTIONS.includes(heading);
  // compact shows only the contract sections' bodies; standard/full show method
  // bodies too. The heading itself always renders so the structure stays visible.
  const forceOpen = !isMethod || level !== "compact";
  const [open, setOpen] = useState(forceOpen);
  useEffect(() => setOpen(forceOpen), [forceOpen]);
  return (
    <div>
      <div data-outline-id={heading}>
        <Markdown source={`## ${heading}`} />
      </div>
      {isMethod && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mb-1 flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
        >
          <Caret open={open} />
          {open ? "hide" : "show section"}
        </button>
      )}
      <div className={open ? "" : "max-h-0 overflow-hidden"} aria-hidden={!open}>
        {heading === "Build steps" ? (
          <StepCards body={body} detailOpen={level === "full"} />
        ) : (
          <BodyParts source={body} detailOpen={level === "full"} />
        )}
      </div>
    </div>
  );
}

/**
 * Renders a plan body as one narrative, collapsing by the project's detail level:
 * `compact` clips the method sections (approach/steps/verification), `standard`
 * shows them, `full` also expands the inline agent-detail blocks. Everything
 * stays inside the caller's single AnnotationLayer, clipped never unmounted, so
 * comment anchoring is unaffected. Pre-v0.4 plans still carrying a "## Part 2 —"
 * banner fall back to the old two-half render.
 */
function PlanBody({
  content,
  level,
  stripMetadata,
}: {
  content: string;
  level: DetailLevel;
  stripMetadata: boolean;
}) {
  // Strip HTML comments before rendering: the execution-plan template carries a
  // guidance comment that itself contains a literal <details class="agent-detail">
  // example, which the agent-detail matcher would otherwise surface as content
  // (and Markdown escapes comments into ugly literal text). Comments are never
  // rendered content, so removing them does not perturb annotation anchoring.
  const clean = content.replace(/<!--[\s\S]*?-->/g, "");
  if (/^## Part 2\b/m.test(clean)) return <LegacyPlanBody content={clean} />;
  const sections = splitSections(clean);
  return (
    <>
      {sections.map((s, i) =>
        s.heading === null ? (
          <BodyParts
            key="preamble"
            source={stripMetadata ? stripPreambleMetadata(s.body) : s.body}
            detailOpen={level === "full"}
          />
        ) : (
          <SectionBlock key={s.heading + i} heading={s.heading} body={s.body} level={level} />
        ),
      )}
    </>
  );
}

// Pre-v0.4 plans: split on the "## Part 2 —" banner, Part 2 collapsed under a
// toggle (the original render, kept so old plans still read correctly).
function LegacyPlanBody({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  const m = /^## Part 2\b[^\n]*$/m.exec(content);
  if (!m) return <Markdown source={content} />;
  const human = content.slice(0, m.index);
  const agent = content.slice(m.index + m[0].length);
  const heading = m[0].replace(/^##\s*/, "").trim();
  return (
    <>
      <Markdown source={human} />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mt-4 flex w-full items-center gap-2 border-t border-stone-200 dark:border-stone-800 pt-4 text-left text-lg font-bold text-stone-900 dark:text-stone-100 hover:text-stone-600"
      >
        <Caret open={open} />
        {heading}
      </button>
      <div className={open ? "mt-2" : "max-h-0 overflow-hidden"} aria-hidden={!open}>
        <Markdown source={agent} />
      </div>
    </>
  );
}
