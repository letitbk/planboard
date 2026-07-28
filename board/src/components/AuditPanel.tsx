import { useState } from "react";
import type { Audit, AuditDisposition, AuditFinding, AuditSeverity } from "../lib/types";

const SEV_CLASS: Record<AuditSeverity, string> = {
  blocker:
    "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300",
  major:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  minor:
    "border-stone-300 bg-stone-50 text-stone-600 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-400",
};

function dispositionFor(
  audit: Audit,
  finding: AuditFinding,
): AuditDisposition | undefined {
  return audit.dispositions.find((d) => d.finding === finding.comment);
}

function Finding({
  finding,
  gap,
  disposition,
}: {
  finding: AuditFinding;
  gap: boolean;
  disposition?: AuditDisposition;
}) {
  return (
    <li className="border-t border-stone-200 py-2 text-xs dark:border-stone-700">
      <div className="flex items-baseline gap-2">
        <span className={`rounded border px-1.5 py-0.5 font-medium ${SEV_CLASS[finding.severity]}`}>
          {finding.severity}
        </span>
        {gap ? (
          <span className="text-stone-500 dark:text-stone-400">Not stated in the plan</span>
        ) : (
          finding.section && (
            <span className="text-stone-500 dark:text-stone-400">{finding.section}</span>
          )
        )}
      </div>
      <p className="mt-1 text-stone-700 dark:text-stone-300">{finding.comment}</p>
      {finding.quote && (
        <p className="mt-1 border-l-2 border-stone-300 pl-2 italic text-stone-500 dark:border-stone-600">
          {finding.quote}
        </p>
      )}
      {finding.evidence && (
        <p className="mt-1 text-stone-500 dark:text-stone-400">
          <code>{finding.evidence.path}</code>
          {finding.evidence.kind === "inferred" && " (inferred)"}
          {finding.evidence.detail && ` — ${finding.evidence.detail}`}
        </p>
      )}
      {disposition && (
        <p className="mt-1 text-stone-600 dark:text-stone-400">
          <span className="font-medium">{disposition.status}</span>
          {disposition.reason && ` — ${disposition.reason}`}
        </p>
      )}
    </li>
  );
}

/**
 * The plan-header audit: a severity strip that expands to the findings list.
 * Read-only, and deliberately separate from the rubric score beside it — the
 * score asks whether the plan is a checkable contract, this asks whether it
 * will actually work. "15/15 with two blockers" is a coherent state.
 *
 * Findings arrive already severity-ordered from parseAudit.
 */
export default function AuditPanel({ audit }: { audit: Audit }) {
  const [open, setOpen] = useState(false);
  const { blocker, major, minor } = audit.counts;
  const total = blocker + major + minor;
  const label =
    total === 0 ? "no findings" : `${blocker} blocker · ${major} major · ${minor} minor`;
  const tone = blocker > 0 ? SEV_CLASS.blocker : major > 0 ? SEV_CLASS.major : SEV_CLASS.minor;

  return (
    <span className="relative inline-block">
      <button
        aria-label="audit findings"
        className={`rounded border px-2 py-0.5 text-xs font-medium ${tone}`}
        onClick={() => setOpen((o) => !o)}
      >
        audit: {label}
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-96 rounded-lg border border-stone-300 bg-white p-3 text-left shadow-lg dark:border-stone-600 dark:bg-stone-900">
          <p className="text-xs text-stone-700 dark:text-stone-300">{audit.overall}</p>
          <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
            {audit.reviewer.token}
            {audit.reviewer.effort ? ` · ${audit.reviewer.effort}` : ""} · {audit.date}
          </p>
          {audit.reviewer.reviewerFallback && (
            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
              fell back: {audit.reviewer.reviewerFallback}
            </p>
          )}
          {total === 0 ? (
            <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
              No findings in this audit.
            </p>
          ) : (
            <ul className="mt-2">
              {audit.anchored.map((f, i) => (
                <Finding
                  key={`a${i}`}
                  finding={f}
                  gap={false}
                  disposition={dispositionFor(audit, f)}
                />
              ))}
              {audit.gaps.map((f, i) => (
                <Finding key={`g${i}`} finding={f} gap disposition={dispositionFor(audit, f)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  );
}
