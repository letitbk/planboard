// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import Scorecard from "./Scorecard";
import type { BoardData, BoardFile } from "../lib/types";
import type { OutlineEntry } from "../lib/outline";

afterEach(cleanup);

const noop = () => {};

function parseableReview(): BoardFile {
  const block =
    "```json board-scorecard\n" +
    JSON.stringify({
      schemaVersion: 1,
      component: "01-x",
      planVersion: 2,
      planPath: "plans/execution/01-x/v2.md",
      rubricVersion: "v1",
      date: "2026-07-01",
      items: [{ id: 1, score: 2 }],
      raw: 2,
      applicableMax: 2,
      percent: 100,
      band: "solid",
    }) +
    "\n```\n";
  return { path: "plans/reviews/01-x-v2.md", content: block };
}

const UNPARSEABLE_CONTENT = "Just some raw notes, no scorecard block here.";

function unparseableReview(): BoardFile {
  return { path: "plans/reviews/free-notes.md", content: UNPARSEABLE_CONTENT };
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
      reviews: [parseableReview(), unparseableReview()],
    },
  } as unknown as BoardData;
}

describe("Scorecard outline", () => {
  it("publishes the parsed label for a parseable review and the filename for an unparseable one", () => {
    let published: OutlineEntry[] = [];
    render(
      <Scorecard
        data={data()}
        canAnnotate={false}
        annotations={[]}
        onAddDocComment={noop}
        onPaintResult={noop}
        onAddGeneral={noop}
        onOutline={(e) => (published = e)}
      />,
    );
    expect(published.map((e) => e.label)).toEqual(["01-x v2 — 100%", "free-notes.md"]);
  });

  it("selecting the parseable entry switches the view to it", () => {
    let published: OutlineEntry[] = [];
    const { getByText, queryByText } = render(
      <Scorecard
        data={data()}
        canAnnotate={false}
        annotations={[]}
        onAddDocComment={noop}
        onPaintResult={noop}
        onAddGeneral={noop}
        onOutline={(e) => (published = e)}
      />,
    );
    // idx defaults to reviews.length - 1 = 1 (the unparseable review), so the
    // parseable review's header is not shown yet.
    expect(queryByText(/01-x — plan v2/)).toBeNull();
    act(() => {
      published[0].onSelect();
    });
    expect(getByText(/01-x — plan v2/)).toBeTruthy();
  });
});
