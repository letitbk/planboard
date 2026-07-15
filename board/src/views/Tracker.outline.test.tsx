// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render } from "@testing-library/react";
import Tracker from "./Tracker";
import type { BoardData } from "../lib/types";
import type { OutlineEntry } from "../lib/outline";

afterEach(cleanup);

const MASTER_PLAN = `# T

## Components

| # | Component | Status | Execution plan | Outcome / notes | Serves |
|---|---|---|---|---|---|
| 1 | X | in progress | [v1](execution/01-x/v1.md) | — | — |
| 2 | Y | planned | — | — | — |
`;

function data(): BoardData {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-14T00:00",
    mode: "static",
    focus: null,
    project: { name: "p" },
    git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: MASTER_PLAN },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [],
      reviews: [],
    },
  } as unknown as BoardData;
}

const noop = () => {};

function renderOutline(): OutlineEntry[] {
  let published: OutlineEntry[] = [];
  render(
    <Tracker
      data={data()}
      canAnnotate={false}
      annotations={[]}
      onAddDocComment={noop}
      onPaintResult={noop}
      onOpenComponent={noop}
      onOpenResults={noop}
      onAddGeneral={noop}
      onOutline={(e) => (published = e)}
    />,
  );
  return published;
}

describe("Tracker outline", () => {
  it("publishes one entry per component row, id/label keyed on the row number", () => {
    const published = renderOutline();
    expect(published.map((e) => e.id)).toEqual(["tracker-row-1", "tracker-row-2"]);
    expect(published.map((e) => e.label)).toEqual(["1. X", "2. Y"]);
  });
});
