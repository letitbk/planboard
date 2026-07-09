import { useMemo } from "react";
import { diffLines } from "diff";

export default function DiffView({
  before,
  after,
  supersedesReason,
}: {
  before: string;
  after: string;
  supersedesReason: string | null;
}) {
  const parts = useMemo(() => diffLines(before, after), [before, after]);
  const added = parts.filter((p) => p.added).reduce((n, p) => n + (p.count ?? 0), 0);
  const removed = parts
    .filter((p) => p.removed)
    .reduce((n, p) => n + (p.count ?? 0), 0);

  return (
    <div>
      {supersedesReason && (
        <div className="mb-3 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          <span className="font-semibold">Supersedes:</span> {supersedesReason}
        </div>
      )}
      <div className="mb-2 text-xs text-stone-500">
        <span className="text-green-700 dark:text-green-400">+{added}</span>{" "}
        <span className="text-red-700 dark:text-red-400">−{removed}</span> lines
      </div>
      <pre className="overflow-x-auto rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 text-[13px] leading-5">
        {parts.map((part, i) => {
          const cls = part.added ? "diff-add" : part.removed ? "diff-del" : "";
          const prefix = part.added ? "+" : part.removed ? "−" : " ";
          return (
            <div key={i} className={cls}>
              {part.value
                .replace(/\n$/, "")
                .split("\n")
                .map((line, j) => (
                  <div key={j} className="px-3">
                    <span className="select-none pr-2 text-stone-400 dark:text-stone-500">
                      {prefix}
                    </span>
                    {line}
                  </div>
                ))}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
