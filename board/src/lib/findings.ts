import type { ResultsBundle, ResultsManifest } from "./types";

export type Metric = ResultsManifest["metrics"][number];

// Statuses that explicitly demote a metric below "finding" — a descriptive
// count, a retracted claim, or a superseded one is not a substantive result.
const DEMOTED = new Set(["descriptive", "retracted", "superseded"]);

// A metric is a substantive finding when its status is robust/marginal, OR it
// carries a claim sentence (statement) whose status is not one of the demoted
// values. An absent status with a written claim counts; a bare label/value
// with neither does not. Kept in sync with results.py `is_substantive`
// (Python/TypeScript duplication — change both).
export function isSubstantive(metric: Metric): boolean {
  if (metric.status === "robust" || metric.status === "marginal") return true;
  const hasStatement = !!metric.statement && metric.statement.trim().length > 0;
  return hasStatement && !(metric.status && DEMOTED.has(metric.status));
}

// True when the bundle's manifest parsed and any metric is substantive. Returns
// false when the manifest is unreadable — callers that need to distinguish
// "no substantive findings" from "manifest absent" should gate on
// `bundle.manifest` themselves (e.g. `bundle.manifest && !hasSubstantiveFindings(b)`).
export function hasSubstantiveFindings(bundle: ResultsBundle): boolean {
  const m = bundle.manifest;
  if (!m) return false;
  return m.metrics.some(isSubstantive);
}
