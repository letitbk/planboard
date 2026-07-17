// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Results from "./Results";
import type { BoardData, ResultsVerdict, ValidationBlock } from "../lib/types";

afterEach(cleanup);

function data(
  validation: ValidationBlock["status"] | null,
  verdict: ResultsVerdict | null = null,
  curatedBy: "agent" | null = null,
): BoardData {
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
              content: "# v1",
            },
          ],
          results: [
            {
              resultsVersion: 1,
              dir: "plans/execution/01-x/results/r1",
              manifest: {
                schemaVersion: 1,
                component: "01-x",
                resultsVersion: 1,
                planVersion: 1,
                provenance: "planned",
                trigger: "initial",
                capturedAt: "t",
                metrics: [],
                artifacts: [],
                ...(curatedBy ? { curatedBy } : {}),
                ...(validation
                  ? {
                      validation: {
                        status: validation,
                        steps: [],
                        criteria: [],
                      },
                    }
                  : {}),
              },
              manifestRaw: { path: "manifest.json", content: "{}" },
              report: null,
              verdict,
              verdictRaw: null,
              scripts: [],
              assets: {},
              publishedReport: null,
            },
          ],
        },
      ],
      reviews: [],
    },
  } as BoardData;
}

const noop = vi.fn();
function renderResults(boardData: BoardData) {
  return render(
    <Results
      data={boardData}
      canAnnotate={false}
      selectedComponent="01-x"
      annotations={[]}
      onAddResultComment={noop}
      onAddScriptComment={noop}
      onPaintResult={noop}
      onReopen={noop}
      focusResults={null}
      navRequest={null}
    />,
  );
}

describe("Results bundle state", () => {
  it("shows a validated banner and no Accept control", () => {
    renderResults(data("conforms"));
    expect(screen.getByText("01-x r1 — validated")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^accept$/i })).toBeNull();
    expect(screen.queryByPlaceholderText(/verdict comment/i)).toBeNull();
  });

  it("offers Reopen on a verdictless finalized bundle", () => {
    renderResults(data(null));
    expect(screen.getByPlaceholderText(/Reopen — why/i)).toBeTruthy();
  });

  it("still displays a legacy verdict read-only", () => {
    renderResults(
      data(null, {
        status: "accepted",
        reviewer: "R",
        date: "2026-07-01",
        planVersion: 1,
      }),
    );
    expect(screen.getByText(/legacy verdict: accepted/i)).toBeTruthy();
  });

  it("labels agent-curated autopilot bundles", () => {
    renderResults(data("conforms", null, "agent"));
    expect(screen.getByText("curated by agent (autopilot)")).toBeTruthy();
  });
});
