// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import PlanReader from "./PlanReader";
import type { BoardData } from "../lib/types";

afterEach(cleanup);

const PLAN_PATH = "plans/execution/01-x/v1.md";
const PLAN = ["# X — Execution Plan v1", "", "## Context", "Body text here.", "", "Signed off: BK, 2026-07-18"].join("\n");

function data(): BoardData {
  return {
    schemaVersion: 1, generatedAt: "t", mode: "static", focus: null, detailLevel: "standard",
    project: { name: "p" }, git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [{ component: "01-x", versions: [{ version: 1, path: PLAN_PATH, content: PLAN }] }],
      reviews: [],
    },
  } as unknown as BoardData;
}

function draw(canAnnotate = true, onAddPlanComment = vi.fn()) {
  render(
    <PlanReader data={data()} canAnnotate={canAnnotate} selectedComponent="01-x"
      annotations={[]} onAddPlanComment={onAddPlanComment} onPaintResult={vi.fn()} onOpenResults={vi.fn()} />,
  );
  return onAddPlanComment;
}

describe("PlanReader global comment", () => {
  it("adds an unanchored plan comment attributed to the current doc", () => {
    const onAdd = draw();
    fireEvent.click(screen.getByRole("button", { name: "Global comment" }));
    fireEvent.change(screen.getByPlaceholderText(/comment on this whole plan/i), {
      target: { value: "  a whole-plan note  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toMatchObject({
      anchored: false, quote: "", planPath: PLAN_PATH, component: "01-x", version: 1,
      isDraft: false, comment: "a whole-plan note",
    });
  });

  it("hides the button when the doc is not annotatable", () => {
    draw(false);
    expect(screen.queryByRole("button", { name: "Global comment" })).toBeNull();
  });
});
