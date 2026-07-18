import { useState } from "react";
import { chipClass } from "./scoreChip";
import type { OutputScore } from "../lib/types";

const LETTERS = ["F", "A", "I"];

/** The bundle-header output score: three F·A·I chips with the derivation basis
 * on hover, expandable to the full derivation table. Mechanical — the caption
 * says so, so it is never mistaken for an independent measurement. */
export default function OutputScorePanel({
  score,
  sections,
}: {
  score: OutputScore;
  sections: { validation: boolean; integrity: boolean };
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Output score — derived from validation verdicts and integrity checks; click for the derivation"
        className="inline-flex items-center gap-0.5 rounded hover:bg-stone-100 dark:hover:bg-stone-800"
      >
        {score.channels.map((c, i) => (
          <span
            key={c.id}
            className={`rounded border px-1 py-0.5 text-[11px] font-semibold tabular-nums ${chipClass(c.score)}`}
            title={`${c.name}: ${c.score ?? "–"}/3${c.basis ? ` — ${c.basis}` : ""}`}
          >
            {LETTERS[i]}
            {c.score ?? "–"}
          </span>
        ))}
        <span className="ml-0.5 text-[11px] tabular-nums opacity-70">
          {score.total ?? "–"}/{score.max}
        </span>
      </button>
      {open && (
        <OutputScoreDetail score={score} sections={sections} onClose={() => setOpen(false)} />
      )}
    </span>
  );
}

function OutputScoreDetail({
  score,
  sections,
  onClose,
}: {
  score: OutputScore;
  sections: { validation: boolean; integrity: boolean };
  onClose: () => void;
}) {
  const jump = (id: string) => () => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    onClose();
  };
  return (
    <div className="absolute left-0 top-full z-20 mt-1 w-96 max-w-[90vw] rounded-lg border border-stone-200 bg-white p-3 text-left text-xs text-stone-700 shadow-lg dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-semibold">{score.profile} · output score</span>
        <button
          type="button"
          onClick={onClose}
          className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <p className="mb-2 text-stone-500">
        Derived from the bundle's validation verdicts and integrity checks — mechanical, not an independent measurement.
      </p>
      <table className="w-full border-collapse">
        <tbody>
          {score.channels.map((c) => (
            <tr key={c.id} className="border-t border-stone-100 dark:border-stone-800 align-top">
              <td className="py-1 pr-2 font-medium whitespace-nowrap">{c.name}</td>
              <td className="py-1 pr-2">
                <span className={`rounded border px-1 text-[11px] font-semibold ${chipClass(c.score)}`}>
                  {c.score ?? "–"}
                </span>
              </td>
              <td className="py-1 text-stone-500">{c.basis ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-stone-500">
        {score.computedAt && <span>computed {score.computedAt}</span>}
        {sections.validation && (
          <button type="button" className="underline" onClick={jump("results-validation")}>
            validation details
          </button>
        )}
        {sections.integrity && (
          <button type="button" className="underline" onClick={jump("results-integrity")}>
            integrity details
          </button>
        )}
      </p>
    </div>
  );
}
