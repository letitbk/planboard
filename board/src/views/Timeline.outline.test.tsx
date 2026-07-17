// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Timeline from "./Timeline";
import type { BoardData, BoardFile } from "../lib/types";
import type { OutlineEntry } from "../lib/outline";

afterEach(cleanup);

function reviewOn(component: string, date: string, band: string): BoardFile {
  const block =
    "```json board-scorecard\n" +
    JSON.stringify({
      schemaVersion: 1,
      component,
      planVersion: 1,
      planPath: `plans/execution/${component}/v1.md`,
      rubricVersion: "v1",
      date,
      items: [{ id: 1, score: 2 }],
      raw: 2,
      applicableMax: 2,
      percent: 100,
      band,
    }) +
    "\n```\n";
  return { path: `plans/reviews/${component}-v1.md`, content: block };
}

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
      // Two reviews dated the same day — the old kind+sortKey id would
      // collide for these; the index-keyed id must not.
      reviews: [
        reviewOn("01-x", "2026-07-02", "solid"),
        reviewOn("02-y", "2026-07-02", "strong"),
      ],
    },
  } as unknown as BoardData;
}

const noop = () => {};

function renderOutline(): OutlineEntry[] {
  let published: OutlineEntry[] = [];
  render(
    <Timeline
      data={data()}
      canAnnotate={false}
      annotations={[]}
      onAddDocComment={noop}
      onPaintResult={noop}
      onAddGeneral={noop}
      onOutline={(e) => (published = e)}
    />,
  );
  return published;
}

describe("Timeline outline", () => {
  it("publishes one entry per visible event", () => {
    const published = renderOutline();
    expect(published.length).toBe(2);
  });

  it("gives same-date events distinct, index-keyed ids", () => {
    const published = renderOutline();
    const ids = published.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["timeline-evt-0", "timeline-evt-1"]);
  });

  it("badges auto-captured decision entries", () => {
    const fixture = data();
    fixture.files.decisionLog.content =
      "# Decision log\n\n## 2026-07-17 14:05 (auto-captured)\n\n**Context:** x\n";
    render(
      <Timeline
        data={fixture}
        canAnnotate={false}
        annotations={[]}
        onAddDocComment={noop}
        onPaintResult={noop}
        onAddGeneral={noop}
      />,
    );
    expect(screen.getByText("auto-captured")).toBeTruthy();
  });
});
