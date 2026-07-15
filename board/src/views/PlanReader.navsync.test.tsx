// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import PlanReader from "./PlanReader";
import type { BoardData } from "../lib/types";

afterEach(cleanup);

function data(): BoardData {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-10T00:00",
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
            {
              version: 2,
              path: "plans/execution/01-x/v2.md",
              content: "# Plan v2\n\nbody-two\n",
            },
          ],
        },
      ],
      reviews: [],
    },
  } as unknown as BoardData;
}

function renderReader(navRequest: { token: number; planPath?: string } | null) {
  return render(
    <PlanReader
      data={data()}
      canAnnotate={false}
      selectedComponent="01-x"
      annotations={[]}
      onAddPlanComment={vi.fn()}
      onPaintResult={vi.fn()}
      onOpenResults={vi.fn()}
      canPost={false}
      navRequest={navRequest}
    />,
  );
}

describe("PlanReader click-sync round trip", () => {
  it("defaults to the latest version", () => {
    renderReader(null);
    expect(screen.getByText("body-two")).toBeTruthy();
  });

  it("navRequest switches the doc; a later user click still works", () => {
    const { rerender } = renderReader(null);
    expect(screen.getByText("body-two")).toBeTruthy();
    rerender(
      <PlanReader
        data={data()}
        canAnnotate={false}
        selectedComponent="01-x"
        annotations={[]}
        onAddPlanComment={vi.fn()}
        onPaintResult={vi.fn()}
        onOpenResults={vi.fn()}
        canPost={false}
        navRequest={{ token: 1, planPath: "plans/execution/01-x/v1.md" }}
      />,
    );
    expect(screen.getByText("body-one")).toBeTruthy();
    // Controls are not inert after a navRequest: the user can still switch.
    fireEvent.click(screen.getByRole("button", { name: "v2" }));
    expect(screen.getByText("body-two")).toBeTruthy();
  });
});
