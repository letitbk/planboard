// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import PlanReader from "./PlanReader";
import type { BoardData } from "../lib/types";

afterEach(cleanup);

const PLAN = [
  "# Readable plan — Execution Plan v1",
  "",
  "Component: `01-readable` · Master plan: [master-plan.md](../../master-plan.md) · Date: 2026-07-18",
  "",
  "## Context",
  "Contract context stays visible.",
  "",
  "## Goal and success criteria",
  "Contract goal stays visible.",
  "",
  "## Decisions",
  "Contract decision stays visible.",
  "",
  "## Approach",
  "Method approach stays mounted.",
  "",
  "<details class=\"agent-detail\"><summary>Agent detail — exact command</summary>",
  "",
  "Run the exact command.",
  "",
  "</details>",
  "",
  "## Build steps",
  "1. Build the readable plan.",
  "",
  "## Verification",
  "Verify the readable plan.",
  "",
  "## Out of scope",
  "Contract boundary stays visible.",
].join("\n");

function data(detailLevel: "compact" | "standard" | "full"): BoardData {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-18T00:00",
    mode: "static",
    focus: null,
    detailLevel,
    project: { name: "p" },
    git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [{
        component: "01-readable",
        versions: [{
          version: 1,
          path: "plans/execution/01-readable/v1.md",
          content: PLAN,
        }],
      }],
      reviews: [],
    },
  } as unknown as BoardData;
}

function draw(detailLevel: "compact" | "standard" | "full") {
  return render(
    <PlanReader
      data={data(detailLevel)}
      canAnnotate={false}
      selectedComponent="01-readable"
      annotations={[]}
      onAddPlanComment={() => {}}
      onPaintResult={() => {}}
      onOpenResults={() => {}}
    />,
  );
}

describe("PlanReader detail-level invariants", () => {
  it("clips compact method bodies but keeps them mounted", () => {
    draw("compact");
    expect(screen.getByText("Method approach stays mounted.").closest(".max-h-0")).toBeTruthy();
  });

  it("opens standard method bodies and keeps contract sections open", () => {
    draw("standard");
    expect(screen.getByText("Method approach stays mounted.").closest(".max-h-0")).toBeNull();
    expect(screen.getByText("Contract goal stays visible.").closest(".max-h-0")).toBeNull();
  });

  it("keeps contract sections open in compact mode", () => {
    draw("compact");
    expect(screen.getByText("Contract boundary stays visible.").closest(".max-h-0")).toBeNull();
  });

  it("force-opens agent detail in full and keeps it clipped-mounted in standard", () => {
    const full = draw("full");
    expect(screen.getByRole("button", { name: "Agent detail — exact command" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Run the exact command.").closest(".max-h-0")).toBeNull();
    full.unmount();

    draw("standard");
    expect(screen.getByRole("button", { name: "Agent detail — exact command" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Run the exact command.").closest(".max-h-0")).toBeTruthy();
  });

  it("renders agent detail as a disclosure button, never raw details", () => {
    const { container } = draw("standard");
    expect(screen.getByRole("button", { name: "Agent detail — exact command" })).toBeTruthy();
    expect(container.querySelector("details")).toBeNull();
  });

  it.each(["compact", "standard", "full"] as const)(
    "keeps every section heading an h2 at %s detail",
    (detailLevel) => {
      const { container } = draw(detailLevel);
      expect(Array.from(container.querySelectorAll("h2"), (h) => h.textContent)).toEqual([
        "Context",
        "Goal and success criteria",
        "Decisions",
        "Approach",
        "Build steps",
        "Verification",
        "Out of scope",
      ]);
    },
  );
});
