// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Results from "./Results";
import type { BoardData, IntegrityBlock } from "../lib/types";

afterEach(cleanup);

function dataWith(integrity: IntegrityBlock | undefined, report: string | null): BoardData {
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
            provenance: "planned", trigger: "initial", capturedAt: "2026-07-10 10:00",
            metrics: [{ label: "N", value: "10", statement: "Ten." }],
            artifacts: [],
            ...(integrity ? { integrity } : {}),
          },
          manifestRaw: { path: "m", content: "{}" },
          report: report ? { path: "r", content: report } : null,
          verdict: null, verdictRaw: null, scripts: [], assets: {},
          publishedReport: null, reportFormats: { pdf: false, docx: false },
        }],
      }],
      reviews: [],
    },
  } as BoardData;
}

const noop = () => {};
function renderResults(data: BoardData) {
  return render(
    <Results data={data} canAnnotate={false} canPost={false}
      selectedComponent="01-x" onSelectComponent={noop} annotations={[]}
      onAddResultComment={noop} onAddScriptComment={noop} onPaintResult={noop}
      onVerdict={noop} focusResults={null} navRequest={null} />,
  );
}

describe("Result tab integrity + prose", () => {
  it("renders integrity status and failing check details", () => {
    const { container } = renderResults(
      dataWith(
        {
          status: "failed", checkedAt: "2026-07-13 10:00",
          checks: [{ name: "findings-sourced", verdict: "fail", detail: "unsourced findings: Effect" }],
        },
        null,
      ),
    );
    expect(container.querySelector('[data-annot-scope="integrity"]')).toBeTruthy();
    expect(screen.getByText("failed")).toBeTruthy();
    expect(screen.getByText(/unsourced findings: Effect/)).toBeTruthy();
  });

  it("shows 'not recorded' when the bundle has no integrity block", () => {
    renderResults(dataWith(undefined, null));
    expect(screen.getByText("not recorded")).toBeTruthy();
  });

  it("does not render the bundle capture-note prose (Report is the only prose home)", () => {
    renderResults(dataWith(undefined, "CAPTURE_NOTE_PROSE_XYZ"));
    expect(screen.queryByText(/CAPTURE_NOTE_PROSE_XYZ/)).toBeNull();
  });

  function renderWithReport(data: BoardData) {
    return render(
      <Results data={data} canAnnotate={false} canPost={false}
        selectedComponent="01-x" onSelectComponent={noop} annotations={[]}
        onAddResultComment={noop} onAddScriptComment={noop} onPaintResult={noop}
        onVerdict={noop} focusResults={null} navRequest={null} onRequestReport={noop} />,
    );
  }

  it("offers Generate report when the bundle has substantive findings", () => {
    renderWithReport(dataWith(undefined, null)); // default metric carries a statement
    expect(screen.getByText("Generate report")).toBeTruthy();
  });

  it("hides Generate report when the bundle has no substantive findings", () => {
    const d = dataWith(undefined, null);
    d.files.executionPlans[0].results![0].manifest!.metrics = [
      { label: "N", value: "1234", status: "descriptive" },
    ];
    renderWithReport(d);
    expect(screen.queryByText("Generate report")).toBeNull();
  });

  it("renders without crashing when the manifest omits the metrics field", () => {
    const d = dataWith(undefined, null);
    delete (d.files.executionPlans[0].results![0].manifest as { metrics?: unknown })
      .metrics;
    expect(() => renderResults(d)).not.toThrow();
    expect(screen.getByText(/01-x r1/)).toBeTruthy(); // verdict banner still renders
  });
});
