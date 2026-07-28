// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import PlanReader from "./PlanReader";
import type { BoardData } from "../lib/types";

afterEach(cleanup);

const SIGNED_PATH = "plans/execution/01-x/v1.md";
const DRAFT_PATH = "plans/execution/01-x/.draft-v2.md";
const noop = () => {};

function auditFence(component: string, version: number, planPath: string): string {
  return `# Audit\n\n\`\`\`json board-audit\n${JSON.stringify({
    schemaVersion: 1,
    component,
    planVersion: version,
    planPath,
    date: "2026-07-25",
    reviewer: { token: "codex-sol", effort: "xhigh" },
    overall: "One blocker.",
    anchored: [],
    gaps: [
      {
        section: "",
        evidence: { path: "data/wave3.csv", kind: "direct", detail: "12% missing" },
        comment: "[blocker] No missingness rule. At execution: listwise drops 2019.",
      },
    ],
    dispositions: [],
  })}\n\`\`\`\n`;
}

const SCORECARD = `\`\`\`json board-scorecard
{"schemaVersion":3,"status":"scored","component":"01-x","planVersion":1,"planPath":"${SIGNED_PATH}","rubricVersion":"0.4","date":"2026-07-25","channels":[{"id":"goal","score":3},{"id":"decisions","score":3},{"id":"steps","score":3},{"id":"validation","score":3},{"id":"boundaries","score":3}],"total":15,"max":15,"profile":"G3·D3·S3·V3·B3"}
\`\`\``;

function data(reviews: { path: string; content: string }[], draft = false): BoardData {
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
          versions: [{ version: 1, path: SIGNED_PATH, content: "# Plan v1\n" }],
          // PlanReader copies proposedVersion into the doc's version, which is
          // what the audit matches on.
          draft: draft
            ? { path: DRAFT_PATH, content: "# Draft v2\n", proposedVersion: 2 }
            : undefined,
          results: [],
        },
      ],
      reviews,
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

describe("PlanReader audit strip", () => {
  it("renders the strip when an audit matches the open plan", () => {
    draw(
      data([
        { path: "plans/reviews/01-x-v1-audit.md", content: auditFence("01-x", 1, SIGNED_PATH) },
      ]),
    );
    expect(screen.getByText(/audit: 1 blocker/)).toBeTruthy();
  });

  it("still matches after sign-off, when the audit records the draft path", () => {
    // audit_plan_hash is trailer-invariant, so a draft's audit stays valid for
    // the signed version. Exact-path matching would drop it here.
    draw(
      data([
        {
          path: "plans/reviews/01-x-v1-audit.md",
          content: auditFence("01-x", 1, "plans/execution/01-x/.draft-v1.md"),
        },
      ]),
    );
    expect(screen.getByText(/audit: 1 blocker/)).toBeTruthy();
  });

  it("matches a working draft on its proposed version", () => {
    draw(
      data(
        [{ path: "plans/reviews/01-x-v2-audit.md", content: auditFence("01-x", 2, DRAFT_PATH) }],
        true,
      ),
    );
    expect(screen.getByText(/audit: 1 blocker/)).toBeTruthy();
  });

  it("renders nothing when the audit belongs to another version", () => {
    draw(
      data([
        {
          path: "plans/reviews/01-x-v9-audit.md",
          content: auditFence("01-x", 9, "plans/execution/01-x/v9.md"),
        },
      ]),
    );
    expect(screen.queryByText(/audit:/)).toBeNull();
  });

  it("renders nothing when the audit belongs to another component", () => {
    draw(
      data([
        {
          path: "plans/reviews/02-y-v1-audit.md",
          content: auditFence("02-y", 1, "plans/execution/02-y/v1.md"),
        },
      ]),
    );
    expect(screen.queryByText(/audit:/)).toBeNull();
  });

  it("renders nothing when there is no audit", () => {
    draw(data([]));
    expect(screen.queryByText(/audit:/)).toBeNull();
  });

  it("shows nothing when two audits claim the same component and version", () => {
    const content = auditFence("01-x", 1, SIGNED_PATH);
    draw(
      data([
        { path: "plans/reviews/a-audit.md", content },
        { path: "plans/reviews/b-audit.md", content },
      ]),
    );
    expect(screen.queryByText(/audit:/)).toBeNull();
  });

  it("renders the score strip alongside the audit strip", () => {
    draw(
      data([
        { path: "plans/reviews/01-x-v1-audit.md", content: auditFence("01-x", 1, SIGNED_PATH) },
        { path: "plans/reviews/01-x-v1.md", content: SCORECARD },
      ]),
    );
    expect(screen.getByText(/audit: 1 blocker/)).toBeTruthy();
    expect(screen.getByTitle("Plan score — click for the full diagnosis")).toBeTruthy();
  });
});
