// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import PlanReader from "./PlanReader";
import type { BoardData } from "../lib/types";
import type { OutlineEntry } from "../lib/outline";

afterEach(cleanup);

const PLAN = [
  "# Execution Plan v1",
  "Component: `01-x`",
  "## Goal and success criteria",
  "do the thing",
  "## Approach",
  "this way",
  "## Build steps",
  "step one",
].join("\n");

function data(): BoardData {
  return {
    schemaVersion: 1, generatedAt: "2026-07-14T00:00", mode: "static", focus: null,
    project: { name: "p" }, git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [{ component: "01-x", versions: [{ version: 1, path: "plans/execution/01-x/v1.md", content: PLAN }] }],
      reviews: [],
    },
  } as unknown as BoardData;
}

it("publishes an outline built from the plan's sections", () => {
  let published: OutlineEntry[] = [];
  render(
    <PlanReader
      data={data()} canAnnotate={false} selectedComponent="01-x"
      annotations={[]} onAddPlanComment={vi.fn()} onPaintResult={vi.fn()} onOpenResults={vi.fn()}
      navRequest={null} onOutline={(e) => (published = e)}
    />,
  );
  expect(published.map((e) => e.label)).toEqual(["Goal and success criteria", "Approach", "Build steps"]);
});

it("publishes no outline while a draft is diffed against its predecessor", () => {
  Element.prototype.scrollIntoView = vi.fn();
  const d = data();
  d.files.executionPlans[0].draft = {
    path: "plans/execution/01-x/.draft-v2.md",
    content: PLAN,
    proposedVersion: 2,
  };
  let published: OutlineEntry[] = [];
  render(
    <PlanReader
      data={d} canAnnotate={false} selectedComponent="01-x"
      annotations={[]} onAddPlanComment={vi.fn()} onPaintResult={vi.fn()} onOpenResults={vi.fn()}
      navRequest={null} onOutline={(e) => (published = e)}
    />,
  );
  expect(published).toEqual([]);
});
