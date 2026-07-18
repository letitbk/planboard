// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import PlanReader from "./PlanReader";
import type { BoardData, PlanCommentAnnotation } from "../lib/types";

afterEach(cleanup);

const PLAN_PATH = "plans/execution/01-readability/v1.md";
const METADATA_LINE =
  "Component: `01-readability` · Master plan: [Project plan](../../master-plan.md) · Date: 2026-07-18";

const STANDARD_PLAN = [
  "# Readability — Execution Plan v1",
  "",
  METADATA_LINE,
  "Provenance: retrospective — Repeated quote",
  "Supersedes: v0",
  "",
  "Extra preamble prose stays visible.",
  "",
  "## Context",
  "Repeated quote in the section body.",
  "",
  "## Goal and success criteria",
  "The plan is readable.",
  "",
  "Signed off: BK, 2026-07-18",
].join("\n");

function data(content: string): BoardData {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-18T00:00",
    mode: "static",
    focus: null,
    detailLevel: "standard",
    project: { name: "p" },
    git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [{
        component: "01-readability",
        versions: [{ version: 1, path: PLAN_PATH, content }],
      }],
      reviews: [],
    },
  } as unknown as BoardData;
}

function annotation(
  id: string,
  quote: string,
  occurrenceIndex: number,
): PlanCommentAnnotation {
  return {
    id,
    type: "plan-comment",
    planPath: PLAN_PATH,
    component: "01-readability",
    version: 1,
    isDraft: false,
    quote,
    prefix: "",
    suffix: "",
    sectionHeading: "",
    occurrenceIndex,
    anchored: true,
    comment: "Review note",
  };
}

function draw(
  content = STANDARD_PLAN,
  annotations: PlanCommentAnnotation[] = [],
  onPaintResult = vi.fn(),
) {
  return render(
    <PlanReader
      data={data(content)}
      canAnnotate={annotations.length > 0}
      selectedComponent="01-readability"
      annotations={annotations}
      onAddPlanComment={() => {}}
      onPaintResult={onPaintResult}
      onOpenResults={() => {}}
    />,
  );
}

describe("PlanReader metadata card", () => {
  it("renders card-worthy fields while keeping the H1 and stripping raw metadata", () => {
    const { container } = draw();

    expect(screen.getByRole("heading", { level: 1, name: "Readability — Execution Plan v1" })).toBeTruthy();
    expect(screen.getByText("Component").nextElementSibling?.textContent).toBe("01-readability");
    expect(screen.getByText("Version").nextElementSibling?.textContent).toBe("v1");
    expect(screen.getByText("Date").nextElementSibling?.textContent).toBe("2026-07-18");
    expect(screen.getByText("Master plan").nextElementSibling?.textContent).toBe("Project plan");
    expect(screen.queryByText("[Project plan](../../master-plan.md)")).toBeNull();
    expect(container.textContent).not.toContain(METADATA_LINE);
  });

  it("shows provenance exactly once in the card and removes its standalone badge", () => {
    draw();

    expect(screen.getAllByText("retrospective — Repeated quote")).toHaveLength(1);
    expect(screen.queryByText("Provenance: retrospective — Repeated quote")).toBeNull();
  });

  it("keeps ordinary preamble prose below the card", () => {
    draw();

    expect(screen.getByText("Extra preamble prose stays visible.")).toBeTruthy();
  });

  it("leaves the preamble untouched when parsed sections have no card-worthy fields", () => {
    const bare = [
      "# Untagged plan",
      "",
      "Preamble should stay exactly visible.",
      "",
      "## Context",
      "Context.",
    ].join("\n");
    draw(bare);

    expect(screen.getByText("Preamble should stay exactly visible.")).toBeTruthy();
    expect(screen.queryByText("Component")).toBeNull();
    expect(screen.queryByText("Version")).toBeNull();
  });

  it("keeps the signed-off text visible as body content", () => {
    const { container } = draw();

    expect(
      Array.from(container.querySelectorAll(".prose-md p")).some(
        (p) => p.textContent === "Signed off: BK, 2026-07-18",
      ),
    ).toBe(true);
  });

  it("badges amendment and malformed trailer states honestly", () => {
    const amendment = STANDARD_PLAN.replace(
      "Signed off: BK, 2026-07-18",
      "Amendment recorded, 2026-07-18",
    );
    const { unmount } = draw(amendment);
    expect(screen.getByText("amended △")).toBeTruthy();
    unmount();

    draw(STANDARD_PLAN + "\n\nordinary final line");
    expect(screen.getByText("malformed trailer ⚠")).toBeTruthy();
    expect(screen.queryByText("signed ✓")).toBeNull();
  });
});

describe("PlanReader metadata annotation contract", () => {
  it("falls back to the surviving occurrence when stripping shifts the quote count", async () => {
    const note = annotation("section-note", "Repeated quote", 1);
    const { container } = draw(STANDARD_PLAN, [note]);

    await waitFor(() => {
      expect(container.querySelector('mark[data-annotation="section-note"]')?.textContent).toBe("Repeated quote");
    });
    expect(container.querySelector('mark[data-annotation="section-note"]')?.closest("p")?.textContent).toContain(
      "in the section body",
    );
  });

  it("leaves annotations of stripped metadata unanchored without crashing", async () => {
    const onPaintResult = vi.fn();
    const note = annotation("metadata-note", METADATA_LINE, 0);
    const { container } = draw(STANDARD_PLAN, [note], onPaintResult);

    await waitFor(() => expect(onPaintResult).toHaveBeenCalled());
    expect(container.querySelector('mark[data-annotation="metadata-note"]')).toBeNull();
    const [painted] = onPaintResult.mock.calls.at(-1) ?? [];
    expect(painted).toEqual(new Set());
  });
});
