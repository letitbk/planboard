import Markdown from "../components/Markdown";
import AnnotationLayer, {
  GeneralCommentBox,
  type AnchoredSelection,
} from "../components/AnnotationLayer";
import ReviewMenu from "../components/ReviewMenu";
import type {
  Annotation,
  BoardData,
  DocCommentAnnotation,
  ReviewRequest,
  TrackerStatus,
} from "../lib/types";
import {
  parseDecisionLog,
  parseExecutionPlan,
  parseHistory,
  parseMasterPlan,
  parseServes,
} from "../lib/parse";

const CHIP: Record<TrackerStatus, string> = {
  "not started": "bg-stone-100 text-stone-600 border-stone-200",
  planned: "bg-blue-50 text-blue-700 border-blue-200",
  "in progress": "bg-amber-50 text-amber-800 border-amber-200",
  done: "bg-green-50 text-green-800 border-green-200",
  "done (verified)": "bg-green-100 text-green-900 border-green-300",
  dropped: "bg-red-50 text-red-700 border-red-200 line-through",
  unknown: "bg-stone-100 text-stone-500 border-stone-200",
};

function slugFromLink(link: string): string | null {
  const m = /execution\/([^/)]+)\//.exec(link);
  return m ? m[1] : null;
}

export default function Tracker({
  data,
  canAnnotate,
  annotations,
  onAddDocComment,
  onPaintResult,
  onOpenComponent,
  onOpenResults,
  onAddGeneral,
  canPost,
  onRequestReview,
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
  onOpenComponent: (slug: string | null, name: string) => void;
  onOpenResults: (slug: string) => void;
  onAddGeneral: (view: string, comment: string) => void;
  canPost?: boolean;
  onRequestReview?: (req: ReviewRequest) => void;
}) {
  const mp = parseMasterPlan(data.files.masterPlan.content);

  const docAnnotations = annotations.filter(
    (a): a is DocCommentAnnotation =>
      a.type === "doc-comment" && a.docKey === "tracker",
  );
  const addComment = (partial: AnchoredSelection) =>
    onAddDocComment({ ...partial, view: "tracker", docKey: "tracker" });

  if (!mp.ok) {
    return (
      <div>
        <Notice text="The master plan did not match the expected format — showing it raw." />
        {canAnnotate ? (
          <AnnotationLayer
            docKey="tracker"
            annotations={docAnnotations}
            onPaintResult={onPaintResult}
            onAdd={addComment}
          >
            <Markdown source={mp.raw} />
          </AnnotationLayer>
        ) : (
          <Markdown source={mp.raw} />
        )}
      </div>
    );
  }

  const knownSlugs = new Set(data.files.executionPlans.map((g) => g.component));
  const linkedSlugs = new Set(
    mp.components
      .map((r) => slugFromLink(r.planLink))
      .filter((s): s is string => s !== null),
  );
  const orphanGroups = data.files.executionPlans.filter(
    (g) => !linkedSlugs.has(g.component),
  );

  const counts = mp.components.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  const hasRQs = mp.researchQuestions.length > 0;
  // Serves mismatch: the latest execution-plan version declares different RQs
  // than the master row (client has both files; cheap check).
  const planServesBySlug = new Map<string, string[]>();
  for (const g of data.files.executionPlans) {
    const latest = g.versions[g.versions.length - 1];
    if (!latest) continue;
    const parsed = parseExecutionPlan(latest.content);
    if (parsed.serves) {
      planServesBySlug.set(g.component, parseServes(parsed.serves).tokens);
    }
  }
  const servesMismatch = (row: (typeof mp.components)[number]): boolean => {
    const slug = slugFromLink(row.planLink);
    if (!slug || !planServesBySlug.has(slug)) return false;
    const rowTokens = parseServes(row.serves).tokens;
    const planTokens = planServesBySlug.get(slug)!;
    if (rowTokens.length === 0 && planTokens.length === 0) return false;
    return (
      rowTokens.length !== planTokens.length ||
      rowTokens.some((t) => !planTokens.includes(t))
    );
  };

  // Drift & hygiene checks folded in from the retired /status command. Most are
  // computed from the payload already present; the four filesystem/git checks
  // (stale board.html, leftover staging dirs, verified-source drift, 14-day
  // inactivity) use board.py's `drift` payload field plus git.fileDates and are
  // surfaced below (feature #7).
  type Drift = { text: string; slug?: string };
  const drift: Drift[] = [];
  const rqNums = new Set(mp.researchQuestions.map((q) => q.num));
  for (const g of data.files.executionPlans) {
    const latest = g.versions[g.versions.length - 1];
    if (latest && parseExecutionPlan(latest.content).signedOff === null) {
      drift.push({
        text: `${g.component} v${latest.version} has no sign-off line`,
        slug: g.component,
      });
    }
  }
  if (
    data.files.executionPlans.length > 0 &&
    parseDecisionLog(data.files.decisionLog.content).length === 0
  ) {
    drift.push({
      text: "Decision log is empty while execution plans exist — a logging gap",
    });
  }
  if (!hasRQs) {
    drift.push({
      text: "Master plan has no Research questions (pre-v0.3) — run /research-plans:init update mode",
    });
  }
  for (const r of mp.components) {
    const slug = slugFromLink(r.planLink);
    const badRQs = parseServes(r.serves).tokens.filter(
      (t) => !rqNums.has(parseInt(t.replace(/\D/g, ""), 10)),
    );
    if (badRQs.length > 0) {
      drift.push({
        text: `${r.component}: Serves names ${badRQs.join(", ")}, not in the research questions`,
      });
    }
    if (
      (r.status === "done" ||
        r.status === "done (verified)" ||
        r.status === "in progress") &&
      !slug
    ) {
      drift.push({
        text: `${r.component} is ${r.status} but carries no execution plan — run /research-plans:adopt`,
      });
    }
    const g = slug
      ? data.files.executionPlans.find((x) => x.component === slug)
      : null;
    if (g) {
      const latestResult = g.results?.[g.results.length - 1];
      if (
        r.status === "done" &&
        latestResult &&
        latestResult.verdict?.status !== "accepted"
      ) {
        drift.push({
          text: `${r.component} is done but results r${latestResult.resultsVersion} are unverified`,
          slug: slug ?? undefined,
        });
      }
      const latestV = g.versions[g.versions.length - 1];
      if (r.status === "in progress" && latestV) {
        const prov = parseExecutionPlan(latestV.content).provenance;
        if (prov && /retrospective/i.test(prov)) {
          drift.push({
            text: `${r.component} is in progress but its latest plan is retrospective — write a prospective v${latestV.version + 1}`,
            slug: slug ?? undefined,
          });
        }
      }
    }
  }
  const initialized =
    /^Initialized:\s*(\d{4}-\d{2}-\d{2})/m.exec(mp.raw)?.[1] ?? null;
  if (initialized && data.files.history) {
    for (const h of parseHistory(data.files.history.content)) {
      if (h.sortKey >= initialized) {
        drift.push({
          text: `history.md entry ${h.date} is on/after Initialized (${initialized}) — belongs in the decision log`,
        });
      }
    }
  }

  // Filesystem/git hygiene (feature #7): board.py-provided flags, plus 14-day
  // inactivity computed here from git.fileDates.
  if (data.drift?.staleBoardHtml) {
    drift.push({
      text: "Exported board.html is older than newer files under plans/ — regenerate with /research-plans:board --export",
    });
  }
  for (const slug of data.drift?.leftoverStaging ?? []) {
    drift.push({
      text: `${slug}: a leftover results/.staging-* dir — resume or remove the interrupted capture`,
      slug,
    });
  }
  for (const slug of data.drift?.sourceDrift ?? []) {
    drift.push({
      text: `${slug}: captured results no longer match the source files on disk (drifted)`,
      slug,
    });
  }
  const genMs = data.generatedAt ? Date.parse(data.generatedAt) : NaN;
  const fileDates = data.git?.fileDates ?? {};
  if (data.git?.available && !Number.isNaN(genMs)) {
    for (const r of mp.components) {
      if (r.status !== "in progress") continue;
      const slug = slugFromLink(r.planLink);
      const g = slug
        ? data.files.executionPlans.find((x) => x.component === slug)
        : null;
      if (!g) continue;
      let last = 0;
      for (const f of [...g.versions, ...(g.draftSnapshots ?? [])]) {
        const d = fileDates[f.path]?.lastCommit;
        if (d) last = Math.max(last, Date.parse(d));
      }
      if (last > 0 && genMs - last > 14 * 24 * 3600 * 1000) {
        drift.push({
          text: `${r.component} is in progress but has had no git activity in 14+ days`,
          slug: slug ?? undefined,
        });
      }
    }
  }

  const body = (
    <>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-stone-900">{mp.title}</h1>
        <div className="flex items-center gap-3">
          {mp.lastUpdated && (
            <span className="text-xs text-stone-500">
              Last updated {mp.lastUpdated}
            </span>
          )}
          {canPost && !data.gate && onRequestReview && (
            <ReviewMenu
              onPick={(agent) => onRequestReview({ agent, scope: "master" })}
            />
          )}
        </div>
      </div>

      <div
        className="mb-4 flex flex-wrap gap-2"
        data-annot-scope="chips"
        data-annot-section="status summary"
      >
        {Object.entries(counts).map(([status, n]) => (
          <span
            key={status}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${CHIP[status as TrackerStatus] ?? CHIP.unknown}`}
          >
            {n} {status}
          </span>
        ))}
      </div>

      <section
        className="mb-4 rounded-lg border border-stone-200 bg-white p-4"
        data-annot-scope="context"
        data-annot-section="Project context"
      >
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
          Project context
        </h2>
        <Markdown source={mp.contextMd} className="text-sm" />
      </section>

      {hasRQs && (
        <section className="mb-6 rounded-lg border border-stone-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
            Research questions
          </h2>
          <ol className="space-y-1 text-sm text-stone-800">
            {mp.researchQuestions.map((q) => (
              <li
                key={q.num}
                className="flex gap-2"
                data-annot-scope={`rq:${q.num}`}
                data-annot-section={`RQ${q.num}`}
              >
                <span className="shrink-0 rounded bg-stone-900 px-1.5 py-0.5 text-xs font-bold text-white">
                  RQ{q.num}
                </span>
                <span>{q.text}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-2">#</th>
              <th className="px-4 py-2">Component</th>
              {hasRQs && <th className="px-4 py-2">Serves</th>}
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Plan</th>
              <th className="px-4 py-2">Results</th>
              <th className="px-4 py-2">Outcome / notes</th>
            </tr>
          </thead>
          <tbody>
            {mp.components.map((r, i) => {
              const slug = slugFromLink(r.planLink);
              const missingFile =
                slug !== null && !knownSlugs.has(slug);
              const serves = parseServes(r.serves);
              const mismatch = servesMismatch(r);
              return (
                <tr
                  key={i}
                  className="border-b border-stone-100 last:border-0"
                  data-annot-scope={`row:${r.num}`}
                  data-annot-section={`row ${r.num}: ${r.component}`}
                >
                  <td className="px-4 py-2.5 text-stone-400">{r.num}</td>
                  <td className="px-4 py-2.5 font-medium text-stone-800">
                    {r.component}
                  </td>
                  {hasRQs && (
                    <td className="px-4 py-2.5">
                      {serves.isInfra ? (
                        <span className="text-xs text-stone-400">infra</span>
                      ) : serves.tokens.length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {serves.tokens.map((t) => (
                            <span
                              key={t}
                              className="rounded bg-stone-100 px-1.5 py-0.5 text-xs font-semibold text-stone-700"
                            >
                              {t}
                            </span>
                          ))}
                          {mismatch && (
                            <span
                              className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800"
                              title="The execution plan's Serves line disagrees with this row"
                            >
                              mismatch
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                          unlinked
                        </span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${CHIP[r.status]}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {slug && !missingFile ? (
                      <button
                        className="text-xs font-medium text-blue-700 underline hover:text-blue-900"
                        onClick={() => onOpenComponent(slug, r.component)}
                      >
                        open plan
                      </button>
                    ) : missingFile ? (
                      <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">
                        linked file missing
                      </span>
                    ) : (
                      <span className="text-xs text-stone-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {(() => {
                      const g = slug
                        ? data.files.executionPlans.find(
                            (x) => x.component === slug,
                          )
                        : null;
                      const latest = g?.results?.[g.results.length - 1];
                      if (!latest)
                        return <span className="text-xs text-stone-400">—</span>;
                      const mark =
                        latest.verdict?.status === "accepted"
                          ? "✓"
                          : latest.verdict?.status === "changes-requested"
                            ? "✕"
                            : "●";
                      return (
                        <button
                          className="text-xs font-medium text-blue-700 underline hover:text-blue-900"
                          onClick={() => onOpenResults(slug!)}
                        >
                          r{latest.resultsVersion} {mark}
                        </button>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2.5 text-stone-600">{r.notes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {orphanGroups.length > 0 && (
        <div
          className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
          data-annot-scope="drift"
          data-annot-section="drift notice"
        >
          Drift: execution plan{orphanGroups.length > 1 ? "s" : ""} with no
          tracker row —{" "}
          {orphanGroups.map((g, i) => (
            <button
              key={g.component}
              className="font-medium underline"
              onClick={() => onOpenComponent(g.component, g.component)}
            >
              {g.component}
              {i < orphanGroups.length - 1 ? ", " : ""}
            </button>
          ))}
        </div>
      )}

      {drift.length > 0 && (
        <div
          className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          data-annot-scope="drift-checks"
          data-annot-section="drift and hygiene"
        >
          <div className="mb-1 font-semibold uppercase tracking-wide text-amber-700">
            Drift &amp; hygiene ({drift.length})
          </div>
          <ul className="list-disc space-y-0.5 pl-4">
            {drift.map((d, i) => (
              <li key={i}>
                {d.slug ? (
                  <button
                    className="text-left underline hover:text-amber-950"
                    onClick={() => onOpenComponent(d.slug!, d.slug!)}
                  >
                    {d.text}
                  </button>
                ) : (
                  d.text
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {mp.sequencingMd && (
        <section
          className="mt-4 rounded-lg border border-stone-200 bg-white p-4"
          data-annot-scope="sequencing"
          data-annot-section="Sequencing notes"
        >
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
            Sequencing notes
          </h2>
          <Markdown source={mp.sequencingMd} className="text-sm" />
        </section>
      )}
    </>
  );

  return (
    <div>
      {canAnnotate ? (
        <AnnotationLayer
          docKey="tracker"
          annotations={docAnnotations}
          onPaintResult={onPaintResult}
          onAdd={addComment}
        >
          {body}
        </AnnotationLayer>
      ) : (
        body
      )}
      {canAnnotate && (
        <p className="mt-2 text-xs text-stone-400">
          Select any text to attach a comment.
        </p>
      )}
      {canAnnotate && <GeneralCommentBox view="Tracker" onAdd={onAddGeneral} />}
    </div>
  );
}

export function Notice({ text }: { text: string }) {
  return (
    <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      {text}
    </div>
  );
}
