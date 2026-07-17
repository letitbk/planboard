// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import PlanReader from "./PlanReader";
import type { BoardData } from "../lib/types";

afterEach(cleanup);

const SIGNED_PATH = "plans/execution/01-x/v1.md";
const DRAFT_PATH = "plans/execution/01-x/.draft-v2.md";
const noop = () => {};

function scorecard(planPath: string): string {
  return `\`\`\`json board-scorecard
{"schemaVersion":3,"status":"scored","component":"01-x","planVersion":1,"planPath":"${planPath}","rubricVersion":"0.4","date":"2026-07-17","channels":[{"id":"goal","score":3},{"id":"decisions","score":3},{"id":"steps","score":3},{"id":"validation","score":3},{"id":"boundaries","score":3}],"total":15,"max":15,"profile":"G3·D3·S3·V3·B3"}
\`\`\``;
}

function data({ draft = false, duplicates = false }: { draft?: boolean; duplicates?: boolean } = {}): BoardData {
  const target = draft ? DRAFT_PATH : SIGNED_PATH;
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
      executionPlans: [{
        component: "01-x",
        versions: [{ version: 1, path: SIGNED_PATH, content: "# Plan v1\n" }],
        draft: draft ? { path: DRAFT_PATH, content: "# Draft v2\n", proposedVersion: 2 } : undefined,
        results: [],
      }],
      reviews: [
        { path: "plans/reviews/01-x-v1.md", content: scorecard(target) },
        ...(duplicates ? [{ path: "plans/reviews/duplicate.md", content: scorecard(target) }] : []),
      ],
    },
  } as unknown as BoardData;
}

function draw(boardData: BoardData) {
  return render(
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
}

describe("PlanReader scorecard selection", () => {
  it("renders the exact-path scorecard for a working draft", () => {
    draw(data({ draft: true }));
    expect(screen.getByTitle("Plan score — click for the full diagnosis")).toBeTruthy();
  });

  it("keeps rendering the exact-path scorecard for a signed plan", () => {
    draw(data());
    expect(screen.getByTitle("Plan score — click for the full diagnosis")).toBeTruthy();
  });

  it("renders no score when duplicate cards match the document", () => {
    draw(data({ draft: true, duplicates: true }));
    expect(screen.queryByTitle("Plan score — click for the full diagnosis")).toBeNull();
  });
});
