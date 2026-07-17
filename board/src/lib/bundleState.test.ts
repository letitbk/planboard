import { describe, expect, it } from "vitest";
import { bundleState, bundleStateBadge, bundleStateMark } from "./bundleState";
import type { ResultsBundle } from "./types";

function bundle(partial: object): ResultsBundle {
  return {
    resultsVersion: 1,
    dir: "plans/execution/01-a/results/r1",
    manifest: {
      schemaVersion: 1,
      component: "01-a",
      resultsVersion: 1,
      planVersion: 1,
      provenance: "planned",
      trigger: "initial",
      capturedAt: "2026-07-17 10:00",
      summary: "",
      metrics: [],
      artifacts: [],
    },
    manifestRaw: { path: "m", content: "{}" },
    report: null,
    verdict: null,
    verdictRaw: null,
    scripts: [],
    assets: {},
    publishedReport: null,
    ...(partial as object),
  } as unknown as ResultsBundle;
}

const withValidation = (status: string) =>
  bundle({
    manifest: {
      schemaVersion: 1,
      component: "01-a",
      resultsVersion: 1,
      planVersion: 1,
      provenance: "planned",
      trigger: "initial",
      capturedAt: "x",
      summary: "",
      metrics: [],
      artifacts: [],
      validation: {
        status,
        validatedAt: "x",
        planVersion: 1,
        validator: "subagent",
        steps: [],
        criteria: [],
        notes: "",
      },
    },
  });

describe("bundleState", () => {
  it("maps validation statuses to states", () => {
    expect(bundleState(withValidation("conforms")).kind).toBe("validated");
    expect(bundleState(withValidation("conforms-with-amendments")).kind).toBe(
      "validated",
    );
    expect(bundleState(withValidation("deviations-found")).kind).toBe(
      "deviations",
    );
    expect(bundleState(withValidation("unverifiable")).kind).toBe(
      "unvalidated",
    );
    expect(bundleState(withValidation("skipped")).kind).toBe("unvalidated");
    expect(bundleState(withValidation("not-applicable")).kind).toBe("retrofit");
  });

  it("maps a missing validation block to unvalidated", () => {
    expect(bundleState(bundle({})).kind).toBe("unvalidated");
  });

  it("still surfaces a legacy verdict", () => {
    const b = bundle({
      verdict: {
        status: "accepted",
        date: "d",
        planVersion: 1,
        reviewer: "R",
      },
    });
    expect(bundleState(b).legacyVerdict).toBe("accepted");
  });

  it("derives badges and marks from validation state", () => {
    expect(bundleStateBadge(withValidation("conforms")).label).toMatch(
      /validated/i,
    );
    expect(bundleStateMark(withValidation("deviations-found"))).toBe(" ✕");
    expect(bundleStateMark(withValidation("conforms"))).toBe(" ✓");
    expect(bundleStateMark(bundle({}))).toBe(" ●");
  });

  it("falls back to a legacy mark when validation is absent", () => {
    const b = bundle({
      verdict: {
        status: "accepted",
        date: "d",
        planVersion: 1,
        reviewer: "R",
      },
    });
    expect(bundleStateMark(b)).toBe(" ✓");
  });
});
