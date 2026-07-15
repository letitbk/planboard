// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Results from "./Results";
import type { BoardData } from "../lib/types";

afterEach(cleanup);

function summaryOnlyFindingData(): BoardData {
  return {
    schemaVersion: 1, generatedAt: "2026-07-10T00:00", mode: "live",
    focus: null, project: { name: "p" }, git: { available: false },
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
            provenance: "planned", trigger: "initial", capturedAt: "2026-07-10 10:00",
            // statement puts the bundle in FINDING mode; zero artifacts = summary-only
            metrics: [{ label: "N", value: "10", statement: "The N is ten." }],
            artifacts: [],
          },
          manifestRaw: { path: "plans/execution/01-x/results/r1/manifest.json", content: "{}" },
          report: null, verdict: null, verdictRaw: null, scripts: [], assets: {},
          publishedReport: null, reportFormats: { pdf: false, docx: false },
        }],
      }],
      reviews: [],
    },
  } as BoardData;
}

const noop = () => {};
describe("summary-only notice", () => {
  it("renders in finding mode when the bundle has zero artifacts", () => {
    render(
      <Results data={summaryOnlyFindingData()} canAnnotate={false} canPost={false}
        selectedComponent="01-x" annotations={[]}
        onAddResultComment={noop} onAddScriptComment={noop} onPaintResult={noop}
        onVerdict={noop} focusResults={null} navRequest={null} />,
    );
    expect(screen.getByText("Summary only")).toBeTruthy();
  });
});
