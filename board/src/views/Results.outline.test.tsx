// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render } from "@testing-library/react";
import Results from "./Results";
import type { BoardData, ResultsManifest } from "../lib/types";
import type { OutlineEntry } from "../lib/outline";

afterEach(cleanup);

function dataWithManifest(manifest: ResultsManifest | null): BoardData {
  return {
    schemaVersion: 1, generatedAt: "2026-07-14T00:00", mode: "static", focus: null,
    project: { name: "p" }, git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [{
        component: "01-x",
        versions: [{ version: 1, path: "plans/execution/01-x/v1.md", content: "# v1" }],
        results: [{
          resultsVersion: 1, dir: "plans/execution/01-x/results/r1",
          manifest,
          manifestRaw: { path: "plans/execution/01-x/results/r1/manifest.json", content: "{}" },
          report: null, verdict: null, verdictRaw: null, scripts: [], assets: {},
          publishedReport: null, reportFormats: { pdf: false, docx: false },
        }],
      }],
      reviews: [],
    },
  } as unknown as BoardData;
}

const noop = () => {};

function renderOutline(data: BoardData): OutlineEntry[] {
  let published: OutlineEntry[] = [];
  render(
    <Results data={data} canAnnotate={false} canPost={false}
      selectedComponent="01-x" annotations={[]}
      onAddResultComment={noop} onAddScriptComment={noop} onPaintResult={noop}
      onVerdict={noop} focusResults={null} navRequest={null}
      onOutline={(e) => (published = e)} />,
  );
  return published;
}

const ARTIFACT = {
  id: "fig", kind: "figure" as const, title: "Fig 1", caption: "",
  file: "artifacts/fig1.png",
  source: { path: "o/fig1.png", sha256: "0".repeat(64), bytes: 1, oversized: false },
  producedBy: null,
};

describe("Results outline", () => {
  it("publishes Integrity/Validation/Findings/Artifacts/Provenance, each id matching its anchor", () => {
    const manifest: ResultsManifest = {
      schemaVersion: 1, component: "01-x", resultsVersion: 1, planVersion: 1,
      provenance: "planned", trigger: "initial", capturedAt: "2026-07-14 10:00",
      metrics: [{ label: "N", value: "10", statement: "Ten.", artifactIds: ["fig"] }],
      artifacts: [ARTIFACT],
      integrity: { status: "passed", checks: [] },
      validation: { status: "conforms", steps: [], criteria: [] },
    } as unknown as ResultsManifest;
    const published = renderOutline(dataWithManifest(manifest));
    expect(published.map((e) => e.label)).toEqual([
      "Integrity", "Validation", "Findings", "Artifacts", "Provenance",
    ]);
    expect(published.map((e) => e.id)).toEqual([
      "results-integrity", "results-validation", "results-findings",
      "results-artifacts", "results-provenance",
    ]);
  });

  it("publishes without throwing when the manifest omits metrics, and the integrity anchor still renders", () => {
    const manifest = {
      schemaVersion: 1, component: "01-x", resultsVersion: 1, planVersion: 1,
      provenance: "planned", trigger: "initial", capturedAt: "2026-07-14 10:00",
      artifacts: [],
    } as unknown as ResultsManifest;
    const data = dataWithManifest(manifest);
    let published: OutlineEntry[] = [];
    const { container } = render(
      <Results data={data} canAnnotate={false} canPost={false}
        selectedComponent="01-x" annotations={[]}
        onAddResultComment={noop} onAddScriptComment={noop} onPaintResult={noop}
        onVerdict={noop} focusResults={null} navRequest={null}
        onOutline={(e) => (published = e)} />,
    );
    expect(published.map((e) => e.label)).not.toContain("Findings");
    // section anchoring (data-annot-scope) is unaffected by the missing
    // metrics field — the Integrity block always renders when m is present.
    expect(container.querySelector('[data-annot-scope="integrity"]')).toBeTruthy();
  });

  it("publishes both Findings and Artifacts for legacy metrics with no statement/artifactIds", () => {
    const manifest: ResultsManifest = {
      schemaVersion: 1, component: "01-x", resultsVersion: 1, planVersion: 1,
      provenance: "planned", trigger: "initial", capturedAt: "2026-07-14 10:00",
      metrics: [{ label: "N", value: "1234" }],
      artifacts: [ARTIFACT],
    } as unknown as ResultsManifest;
    const published = renderOutline(dataWithManifest(manifest));
    expect(published.map((e) => e.label)).toContain("Findings");
    expect(published.map((e) => e.label)).toContain("Artifacts");
  });
});
