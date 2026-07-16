// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Archive from "./Archive";
import type { BoardData } from "../lib/types";
import type { OutlineEntry } from "../lib/outline";

afterEach(cleanup);

const noop = () => {};

const MASTER_PLAN = `# Archived project

## Components

| # | Component | Status | Execution plan | Outcome / notes | Serves |
|---|---|---|---|---|---|
| 1 | X | done | — | Complete | infra |
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
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [],
      reviews: [],
      archives: [],
    },
  } as unknown as BoardData;
}

describe("Archive outline", () => {
  it("contains the archived component table when the viewport is narrow", () => {
    const archiveData = data();
    archiveData.files.archives = [
      {
        path: "plans/archive/master-plan.md",
        content: MASTER_PLAN,
        archivedOn: "2026-07-01",
      },
    ];
    render(
      <Archive
        data={archiveData}
        canAnnotate={false}
        annotations={[]}
        onAddDocComment={noop}
        onPaintResult={noop}
        onAddGeneral={noop}
        onOpenComponent={noop}
        onOpenResults={noop}
      />,
    );
    expect(screen.getByRole("table").parentElement?.classList.contains("overflow-x-auto")).toBe(true);
  });

  it("clears the outline (Archive has none of its own)", () => {
    const onOutline = vi.fn<(entries: OutlineEntry[]) => void>();
    render(
      <Archive
        data={data()}
        canAnnotate={false}
        annotations={[]}
        onAddDocComment={noop}
        onPaintResult={noop}
        onAddGeneral={noop}
        onOpenComponent={noop}
        onOpenResults={noop}
        onOutline={onOutline}
      />,
    );
    expect(onOutline).toHaveBeenCalledWith([]);
  });
});
