// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import Tracker from "./Tracker";
import type { BoardData, ResultsBundle } from "../lib/types";

afterEach(cleanup);

const MASTER_PLAN = `# T

## Components

| # | Component | Status | Execution plan | Outcome / notes | Serves |
|---|---|---|---|---|---|
| 1 | X | in progress | [v1](execution/01-x/v1.md) | — | — |
`;

function bundle(over: Partial<ResultsBundle>): ResultsBundle {
  return {
    resultsVersion: 1,
    dir: "plans/execution/01-x/results/r1",
    manifest: null,
    manifestRaw: {
      path: "plans/execution/01-x/results/r1/manifest.json",
      content: "{}",
    },
    report: null,
    verdict: null,
    verdictRaw: null,
    scripts: [],
    assets: {},
    publishedReport: null,
    ...over,
  };
}

function data(results: ResultsBundle[]): BoardData {
  return {
    schemaVersion: 1,
    generatedAt: "t",
    mode: "live",
    focus: null,
    project: { name: "p" },
    git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: MASTER_PLAN },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [
        {
          component: "01-x",
          versions: [
            { version: 1, path: "plans/execution/01-x/v1.md", content: "# v1" },
          ],
          results,
        },
      ],
      reviews: [],
    },
  } as BoardData;
}

const noop = () => {};

function renderTrackerFixture(over: Record<string, unknown> = {}) {
  const results = [
    bundle({
      resultsVersion: 1,
      dir: "plans/execution/01-x/results/r1",
      publishedReport: {
        path: "plans/reports/01-x-r1-report.md",
        content: "R",
      },
    }),
    bundle({
      resultsVersion: 2,
      dir: "plans/execution/01-x/results/r2",
      publishedReport: null,
    }),
  ];
  return render(
    <Tracker
      data={data(results)}
      canAnnotate={false}
      annotations={[]}
      onAddDocComment={noop}
      onPaintResult={noop}
      onOpenComponent={noop}
      onOpenResults={noop}
      onAddGeneral={noop}
      {...over}
    />,
  );
}

function renderTrackerFixtureWithoutReports() {
  const results = [
    bundle({
      resultsVersion: 1,
      dir: "plans/execution/01-x/results/r1",
      publishedReport: null,
    }),
  ];
  return render(
    <Tracker
      data={data(results)}
      canAnnotate={false}
      annotations={[]}
      onAddDocComment={noop}
      onPaintResult={noop}
      onOpenComponent={noop}
      onOpenResults={noop}
      onAddGeneral={noop}
    />,
  );
}

function renderTrackerFixtureNullResult() {
  // latest bundle has a readable manifest but only descriptive metrics — a
  // deliberate null result — and no report anywhere.
  const results = [
    bundle({
      resultsVersion: 1,
      dir: "plans/execution/01-x/results/r1",
      publishedReport: null,
      manifest: {
        schemaVersion: 1, component: "01-x", resultsVersion: 1, planVersion: 1,
        provenance: "planned", trigger: "initial", capturedAt: "t",
        metrics: [{ label: "N", value: "1234", status: "descriptive" }],
        artifacts: [],
      },
    } as Partial<ResultsBundle>),
  ];
  return render(
    <Tracker
      data={data(results)}
      canAnnotate={false}
      annotations={[]}
      onAddDocComment={noop}
      onPaintResult={noop}
      onOpenComponent={noop}
      onOpenResults={noop}
      onAddGeneral={noop}
    />,
  );
}

describe("Tracker report column", () => {
  it("renders a dedicated Report column header", () => {
    renderTrackerFixture();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toContain("Report");
  });
  it("report link targets the latest bundle WITH a report", () => {
    const onOpenReport = vi.fn();
    renderTrackerFixture({ onOpenReport });
    fireEvent.click(screen.getByText("report"));
    expect(onOpenReport).toHaveBeenCalledWith("01-x", 1); // r2 exists but has no report
  });
  it("no report link when no bundle has a report", () => {
    renderTrackerFixtureWithoutReports();
    expect(screen.queryByText("report")).toBeNull();
  });
  it("shows 'no result' when the latest bundle has no substantive findings and no report", () => {
    renderTrackerFixtureNullResult();
    expect(screen.getByText("no result")).toBeTruthy();
    expect(screen.queryByText("report")).toBeNull();
  });
});
