// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Archive from "./Archive";
import type { BoardData, OutputScore } from "../lib/types";

afterEach(cleanup);

const good: OutputScore = {
  schemaVersion: 1,
  channels: [
    { id: "fidelity", name: "Fidelity", score: 3, basis: "all followed" },
    { id: "attainment", name: "Attainment", score: 2, basis: "one partial" },
    { id: "integrity", name: "Integrity", score: 3, basis: "all pass" },
  ],
  profile: "F3·A2·I3",
  total: 8,
  max: 9,
  computedAt: "t",
};

const MASTER_PLAN = `# Archived project

## Components

| # | Component | Status | Execution plan | Outcome / notes | Serves |
|---|---|---|---|---|---|
| 1 | X | done | [v1](execution/01-x/v1.md) | Complete | infra |
`;

function data(score: unknown): BoardData {
  return {
    schemaVersion: 1, generatedAt: "t", mode: "static", focus: null,
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
      archives: [{ path: "plans/archive/master-plan.md", content: MASTER_PLAN, archivedOn: "2026-07-01" }],
    },
  } as unknown as BoardData;
}

const noop = () => {};
function renderArchive(score: unknown) {
  return render(
    <Archive data={data(score)} canAnnotate={false} annotations={[]}
      onAddDocComment={noop} onPaintResult={noop} onAddGeneral={noop}
      onOpenComponent={noop} onOpenResults={noop} />,
  );
}

describe("Archive output score", () => {
  it("labels the results column Output", () => {
    renderArchive(good);
    expect(screen.getByRole("columnheader", { name: "Output" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Results" })).toBeNull();
  });

  it("shows a valid score profile beside the result link", () => {
    renderArchive(good);
    expect(screen.getByText("F3·A2·I3")).toBeTruthy();
  });

  it("hides a malformed score", () => {
    renderArchive({ max: 15 });
    expect(screen.queryByText("F3·A2·I3")).toBeNull();
  });
});
