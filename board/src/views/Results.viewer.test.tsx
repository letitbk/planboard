// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Results from "./Results";
import type { BoardData } from "../lib/types";

afterEach(cleanup);

const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64");
const noop = () => {};

// Mirror Results.lean.test.tsx's fixture, with a csv table artifact whose
// bytes live in the bundle assets as a data: URL (static-mode shape).
function csvData(): BoardData {
  return {
    schemaVersion: 1, generatedAt: "2026-07-12T00:00", mode: "static",
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
            provenance: "planned", trigger: "initial", capturedAt: "2026-07-12 10:00",
            metrics: [{ label: "N", value: "10", statement: "Ten.", artifactIds: ["tab"] }],
            artifacts: [{
              id: "tab", kind: "table", title: "Table 1", caption: "",
              file: "artifacts/table.csv",
              source: { path: "o/table.csv", sha256: "0".repeat(64), bytes: 10, oversized: false },
              producedBy: null,
            }],
            validation: { status: "conforms", steps: [], criteria: [] },
          },
          manifestRaw: { path: "plans/execution/01-x/results/r1/manifest.json", content: "{}" },
          report: null, verdict: null, verdictRaw: null, scripts: [],
          assets: { "table.csv": "data:text/csv;base64," + b64("h1,h2\nv1,v2") },
          publishedReport: null, reportFormats: { pdf: false, docx: false },
        }],
      }],
      reviews: [],
    },
  } as BoardData;
}

describe("Results viewer wiring", () => {
  it("clicking a view button opens the modal and renders the csv", async () => {
    render(
      <Results data={csvData()} canAnnotate={false}
        selectedComponent="01-x" annotations={[]}
        onAddResultComment={noop} onAddScriptComment={noop} onPaintResult={noop}
        focusResults={null} navRequest={null} />,
    );
    fireEvent.click(screen.getByText("view table.csv"));
    expect(await screen.findByText("v2")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Close viewer"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
