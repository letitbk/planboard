// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "./App";
import type { BoardData } from "./lib/types";

// jsdom prerequisites, both required before the first render:
// - navigation (Sidebar -> App.applyRoute) scrolls the target into view.
// - ThemeToggle calls matchMedia unconditionally on mount (ThemeToggle.tsx:28)
//   and jsdom does not provide it, so App's first effect would throw.
Element.prototype.scrollIntoView = vi.fn();

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const ALPHA_V1 = [
  "# Execution Plan v1",
  "Component: `01-alpha`",
  "## Goal and success criteria",
  "Alpha v1 goal text",
  "## Approach",
  "Alpha v1 approach",
  "## Build steps",
  "Alpha v1 step",
].join("\n");

const ALPHA_V2 = [
  "# Execution Plan v2",
  "Component: `01-alpha`",
  "## Goal and success criteria",
  "Alpha v2 goal text",
  "## Approach",
  "Alpha v2 approach",
  "## Build steps",
  "Alpha v2 step",
].join("\n");

const BETA_V1 = [
  "# Execution Plan v1",
  "Component: `02-beta`",
  "## Goal and success criteria",
  "Beta v1 goal text",
  "## Approach",
  "Beta v1 approach",
  "## Build steps",
  "Beta v1 step",
].join("\n");

// A complete static-mode BoardData: App calls allFiles(data) immediately at
// mount (App.tsx:152), so every top-level `files` group must be present, and
// the files tree needs >=2 components with plan versions to be worth routing
// through (Files -> component -> Plans group -> vN leaf).
function fixture(): BoardData {
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
      executionPlans: [
        {
          component: "01-alpha",
          versions: [
            { version: 1, path: "plans/execution/01-alpha/v1.md", content: ALPHA_V1 },
            { version: 2, path: "plans/execution/01-alpha/v2.md", content: ALPHA_V2 },
          ],
        },
        {
          component: "02-beta",
          versions: [
            { version: 1, path: "plans/execution/02-beta/v1.md", content: BETA_V1 },
          ],
        },
      ],
      reviews: [],
    },
  };
}

describe("App (static mode render/route)", () => {
  it("routes Files -> component -> Plans -> vN, then collapses the sidebar", () => {
    render(<App data={fixture()} />);

    // Sidebar sub-tabs exist (panel open by default in static mode).
    expect(screen.getByRole("button", { name: /outline/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /files/i })).toBeTruthy();

    // Switch to Files.
    fireEvent.click(screen.getByRole("button", { name: /files/i }));

    // Expand 01-alpha's Plans group (depth-1 groups start collapsed) and open v1.
    const compLi = screen.getByRole("button", { name: "01-alpha" }).closest("li")!;
    fireEvent.click(within(compLi).getByText("Plans"));
    fireEvent.click(within(compLi).getByText("v1"));

    // Files routed into the Plans view showing v1's body — not v2's (proves the
    // click resolved to the specific version, not just whatever was already
    // selected).
    expect(screen.getByText("Alpha v1 goal text")).toBeTruthy();
    expect(screen.queryByText("Alpha v2 goal text")).toBeNull();

    // Collapse the sidebar; its panel body (the sub-tab buttons) is hidden.
    fireEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(screen.queryByRole("button", { name: /files/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /outline/i })).toBeNull();
    expect(screen.getByRole("button", { name: /expand sidebar/i })).toBeTruthy();
  });
});
