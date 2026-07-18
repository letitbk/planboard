// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Results from "./Results";
import type { BoardData, OutputScore } from "../lib/types";

afterEach(cleanup);

const good: OutputScore = {
  schemaVersion: 1,
  channels: [
    { id: "fidelity", name: "Fidelity", score: 3, basis: "all 2 steps followed" },
    { id: "attainment", name: "Attainment", score: 2, basis: "1 criteria partial" },
    { id: "integrity", name: "Integrity", score: 3, basis: "all 4 checks pass" },
  ],
  profile: "F3·A2·I3",
  total: 8,
  max: 9,
  computedAt: "2026-07-18 12:00",
};

function dataWith(score: unknown): BoardData {
  return {
    schemaVersion: 1, generatedAt: "t", mode: "live", focus: null,
    project: { name: "p" }, git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [{
        component: "01-x",
        versions: [{ version: 1, path: "plans/execution/01-x/v1.md", content: "# v1" }],
        results: [{
          resultsVersion: 1, dir: "plans/execution/01-x/results/r1",
          manifest: {
            schemaVersion: 1, component: "01-x", resultsVersion: 1, planVersion: 1,
            provenance: "planned", trigger: "initial", capturedAt: "t",
            metrics: [], artifacts: [], score,
          },
          manifestRaw: { path: "m", content: "{}" }, report: null,
          verdict: null, verdictRaw: null, scripts: [], assets: {}, publishedReport: null,
        }],
      }],
      reviews: [],
    },
  } as unknown as BoardData;
}

const noop = () => {};
function renderResults(data: BoardData) {
  return render(
    <Results data={data} canAnnotate={false} selectedComponent="01-x" annotations={[]}
      onAddResultComment={noop} onAddScriptComment={noop} onPaintResult={noop}
      focusResults={null} navRequest={null} />,
  );
}

describe("Results output score", () => {
  it("shows a valid score in the verdict banner", () => {
    renderResults(dataWith(good));
    expect(screen.getByText("F3")).toBeTruthy();
    expect(screen.getByText("8/9")).toBeTruthy();
  });

  it("treats a malformed score as absent", () => {
    renderResults(dataWith({ max: 15 }));
    expect(screen.queryByText("F3")).toBeNull();
    expect(screen.queryByText("8/9")).toBeNull();
  });
});
