import { describe, it, expect } from "vitest";
import { isSubstantive, hasSubstantiveFindings, type Metric } from "./findings";
import type { ResultsBundle } from "./types";

const m = (over: Partial<Metric>): Metric => ({ label: "L", value: "1", ...over });

describe("isSubstantive", () => {
  it("robust and marginal are substantive regardless of statement", () => {
    expect(isSubstantive(m({ status: "robust" }))).toBe(true);
    expect(isSubstantive(m({ status: "marginal" }))).toBe(true);
  });
  it("a written claim with no status is substantive", () => {
    expect(isSubstantive(m({ statement: "Effect is positive." }))).toBe(true);
  });
  it("descriptive / retracted / superseded are never substantive", () => {
    expect(isSubstantive(m({ status: "descriptive", statement: "Count is 10." }))).toBe(false);
    expect(isSubstantive(m({ status: "retracted", statement: "x" }))).toBe(false);
    expect(isSubstantive(m({ status: "superseded", statement: "x" }))).toBe(false);
  });
  it("a bare label/value with no statement and no robust/marginal status is not substantive", () => {
    expect(isSubstantive(m({}))).toBe(false);
    expect(isSubstantive(m({ note: "just a note" }))).toBe(false);
  });
  it("an empty/whitespace statement does not count", () => {
    expect(isSubstantive(m({ statement: "   " }))).toBe(false);
  });
});

function bundle(metrics: Metric[] | null): ResultsBundle {
  return {
    resultsVersion: 1,
    dir: "d",
    manifest:
      metrics === null
        ? null
        : ({
            schemaVersion: 1, component: "01-x", resultsVersion: 1, planVersion: 1,
            provenance: "planned", trigger: "initial", capturedAt: "t",
            metrics, artifacts: [],
          } as ResultsBundle["manifest"]),
    manifestRaw: { path: "m", content: "{}" },
    report: null, verdict: null, verdictRaw: null, scripts: [], assets: {},
    publishedReport: null,
  };
}

describe("hasSubstantiveFindings", () => {
  it("true when any metric is substantive", () => {
    expect(hasSubstantiveFindings(bundle([m({}), m({ status: "robust" })]))).toBe(true);
  });
  it("false when all metrics are descriptive/none", () => {
    expect(hasSubstantiveFindings(bundle([m({ status: "descriptive" }), m({})]))).toBe(false);
  });
  it("false when the manifest is unreadable", () => {
    expect(hasSubstantiveFindings(bundle(null))).toBe(false);
  });
  it("does not throw when a finalized manifest omits the metrics field", () => {
    const b = bundle([]);
    // simulate a manifest.json that finalized without a metrics array
    delete (b.manifest as { metrics?: unknown }).metrics;
    expect(() => hasSubstantiveFindings(b)).not.toThrow();
    expect(hasSubstantiveFindings(b)).toBe(false);
  });
});
