// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Results from "./Results";
import type { BoardData } from "../lib/types";

afterEach(cleanup);

function leanFindingData(): BoardData {
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
            metrics: [{ label: "N", value: "10", statement: "Ten.", artifactIds: ["fig"] }],
            artifacts: [{
              id: "fig", kind: "figure", title: "Fig 1", caption: "",
              file: "artifacts/fig1.png",
              source: { path: "o/fig1.png", sha256: "0".repeat(64), bytes: 1, oversized: false },
              producedBy: null,
            }],
            validation: { status: "conforms", steps: [], criteria: [] },
          },
          manifestRaw: { path: "plans/execution/01-x/results/r1/manifest.json", content: "{}" },
          report: null, verdict: null, verdictRaw: null, scripts: [],
          assets: { "fig1.png": "data:image/png;base64,AAAA" },
          publishedReport: null, reportFormats: { pdf: false, docx: false },
        }],
      }],
      reviews: [],
    },
  } as BoardData;
}

const noop = () => {};
function renderLeanFixture() {
  return render(
    <Results data={leanFindingData()} canAnnotate={false}
      selectedComponent="01-x" annotations={[]}
      onAddResultComment={noop} onAddScriptComment={noop} onPaintResult={noop}
      focusResults={null} navRequest={null} />,
  );
}

describe("lean Results", () => {
  it("renders validation before the finding tiles and no inline artifact grid", () => {
    const { container } = renderLeanFixture();
    const validation = container.querySelector('[data-annot-scope="validation"]');
    const tile = container.querySelector('[data-annot-scope="metric:N"]');
    expect(validation).toBeTruthy();
    expect(tile).toBeTruthy();
    // validation section precedes the finding tile in document order
    expect(
      validation!.compareDocumentPosition(tile!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // the tile no longer embeds ArtifactCards
    expect(tile!.querySelector("img")).toBeNull();
    // the artifact's ArtifactCard renders exactly once, in the Evidence
    // gallery (the provenance diagram's own small preview thumbnail is a
    // separate, unrelated element — not an embedded artifact grid)
    expect(container.querySelectorAll("[data-artifact-card-id]").length).toBe(1);
    expect(screen.getByText("Evidence")).toBeTruthy();
  });
});
