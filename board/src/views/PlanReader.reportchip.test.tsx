// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import PlanReader from "./PlanReader";
import type { BoardData, ResultsBundle, ResultsManifest } from "../lib/types";

afterEach(cleanup);

function manifest(over: Partial<ResultsManifest>): ResultsManifest {
  return {
    schemaVersion: 1,
    component: "01-x",
    resultsVersion: 1,
    planVersion: 1,
    provenance: "planned",
    trigger: "initial",
    capturedAt: "t",
    metrics: [],
    artifacts: [],
    ...over,
  };
}

function bundle(over: Partial<ResultsBundle>): ResultsBundle {
  return {
    resultsVersion: 1,
    dir: "plans/execution/01-x/results/r1",
    manifest: manifest({}),
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
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [
        {
          component: "01-x",
          versions: [
            {
              version: 1,
              path: "plans/execution/01-x/v1.md",
              content: "# Plan v1\n\nbody-one\n",
            },
          ],
          results,
        },
      ],
      reviews: [],
    },
  } as unknown as BoardData;
}

const noop = () => {};

describe("PlanReader per-bundle report chip keying", () => {
  it("keeps the stale-draft warning legible in dark mode", () => {
    const boardData = data([]);
    boardData.files.executionPlans[0].draft = {
      path: "plans/execution/01-x/.draft-v1.md",
      content: "# Stale draft\n",
      proposedVersion: 1,
    };

    render(
      <PlanReader
        data={boardData}
        canAnnotate={false}
        selectedComponent="01-x"
        annotations={[]}
        onAddPlanComment={noop}
        onPaintResult={noop}
        onOpenResults={noop}
      />,
    );

    expect(
      screen.getByText(/Stale —/).classList.contains("dark:bg-red-950"),
    ).toBe(true);
  });

  it("keys each bundle's chip group so React doesn't warn about missing keys", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onOpenReport = vi.fn();
    const results = [
      bundle({
        resultsVersion: 1,
        dir: "plans/execution/01-x/results/r1",
        manifest: manifest({ resultsVersion: 1, planVersion: 1 }),
        publishedReport: { path: "plans/reports/01-x-r1-report.md", content: "R" },
      }),
      bundle({
        resultsVersion: 2,
        dir: "plans/execution/01-x/results/r2",
        manifest: manifest({ resultsVersion: 2, planVersion: 1 }),
        publishedReport: null,
      }),
    ];

    render(
      <PlanReader
        data={data(results)}
        canAnnotate={false}
        selectedComponent="01-x"
        annotations={[]}
        onAddPlanComment={noop}
        onPaintResult={noop}
        onOpenResults={noop}
        onOpenReport={onOpenReport}
      />,
    );

    // Two bundles share this plan version; only r1 has a published report.
    const chips = screen.getAllByText("report");
    expect(chips).toHaveLength(1);
    fireEvent.click(chips[0]);
    expect(onOpenReport).toHaveBeenCalledWith("01-x", 1);

    for (const call of spy.mock.calls) {
      const msg = call.map(String).join(" ");
      expect(msg).not.toContain('unique "key"');
    }

    spy.mockRestore();
  });
});
