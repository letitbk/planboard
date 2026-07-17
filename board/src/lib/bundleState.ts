// The durable bundle state (spec S3): validation status keys everything the
// verdict used to key. Legacy verdict.json still displays (read-only) but no
// new verdicts are ever emitted. Marks fall back to the legacy verdict when a
// pre-v0.20 bundle has no validation block, so old boards read unchanged.
import type { ResultsBundle } from "./types";

export interface BundleState {
  kind: "validated" | "deviations" | "unvalidated" | "retrofit";
  validation: string | null;
  legacyVerdict: "accepted" | "changes-requested" | null;
}

export function bundleState(b: ResultsBundle): BundleState {
  const validation = b.manifest?.validation?.status ?? null;
  const legacyVerdict = b.verdict?.status ?? null;
  const kind =
    validation === "conforms" || validation === "conforms-with-amendments"
      ? "validated"
      : validation === "deviations-found"
        ? "deviations"
        : validation === "not-applicable"
          ? "retrofit"
          : "unvalidated";
  return { kind, validation, legacyVerdict };
}

const BADGES: Record<
  BundleState["kind"],
  { label: string; cls: string }
> = {
  validated: {
    label: "validated",
    cls: "border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-300",
  },
  deviations: {
    label: "deviations flagged",
    cls: "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-300",
  },
  unvalidated: {
    label: "unvalidated",
    cls: "border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-600 dark:text-stone-300",
  },
  retrofit: {
    label: "retrofit — no plan validation",
    cls: "border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-600 dark:text-stone-300",
  },
};

export function bundleStateBadge(
  b: ResultsBundle,
): { label: string; cls: string } {
  const state = bundleState(b);
  const base = BADGES[state.kind];
  return state.validation === "conforms-with-amendments"
    ? { ...base, label: "validated — amendments recorded" }
    : base;
}

export function bundleStateMark(b: ResultsBundle): string {
  const state = bundleState(b);
  if (state.validation === null && state.legacyVerdict) {
    return state.legacyVerdict === "accepted" ? " ✓" : " ✕";
  }
  return state.kind === "validated"
    ? " ✓"
    : state.kind === "deviations"
      ? " ✕"
      : " ●";
}
