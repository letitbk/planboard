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
  vi.unstubAllGlobals();
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
  it("lets the header and tab navigation wrap at narrow widths", () => {
    const { container } = render(<App data={fixture()} />);
    expect(container.querySelector("header > div")?.className).toContain("flex-wrap");
    expect(screen.getByRole("navigation", { name: /board views/i }).className).toContain(
      "flex-wrap",
    );
  });

  it("stacks the global sidebar above content below the desktop breakpoint", () => {
    render(<App data={fixture()} />);
    const layout = screen.getByTestId("board-content-layout");
    expect(layout.className).toContain("flex-col");
    expect(layout.className).toContain("lg:flex-row");
  });

  it("routes Files -> component -> Plans -> vN, then collapses the sidebar", () => {
    render(<App data={fixture()} />);

    // Sidebar sub-tabs exist (panel open by default in static mode).
    expect(screen.getByRole("tab", { name: /outline/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /files/i })).toBeTruthy();

    // Switch to Files.
    fireEvent.click(screen.getByRole("tab", { name: /files/i }));

    // Expand 01-alpha's Plans group (depth-1 groups start collapsed) and open v1.
    const compLi = screen.getByRole("treeitem", { name: "01-alpha" }).closest("li")!;
    fireEvent.click(within(compLi).getByText("Plans"));
    fireEvent.click(within(compLi).getByText("v1"));

    // Files routed into the Plans view showing v1's body — not v2's (proves the
    // click resolved to the specific version, not just whatever was already
    // selected).
    expect(screen.getByText("Alpha v1 goal text")).toBeTruthy();
    expect(screen.queryByText("Alpha v2 goal text")).toBeNull();

    // Collapse the sidebar; its panel body (the sub-tab buttons) is hidden.
    fireEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(screen.queryByRole("tab", { name: /files/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /outline/i })).toBeNull();
    expect(screen.getByRole("button", { name: /expand sidebar/i })).toBeTruthy();
  });

  it("highlights the file being read in the Files tree and clears on a fileless view", async () => {
    render(<App data={fixture()} />);
    fireEvent.click(screen.getByRole("tab", { name: /files/i }));
    const compLi = screen.getByRole("treeitem", { name: "01-alpha" }).closest("li")!;
    fireEvent.click(within(compLi).getByText("Plans"));
    fireEvent.click(within(compLi).getByText("v1"));

    const leaf = await screen.findByRole("treeitem", { name: /v1/ });
    expect(leaf.getAttribute("data-active")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    const marked = screen
      .getAllByRole("treeitem")
      .filter((item) => item.getAttribute("data-active"));
    expect(marked).toHaveLength(0);
  });

  it("renders copy fallback text in-DOM without native dialogs", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    const promptSpy = vi.spyOn(window, "prompt").mockImplementation(() => null);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<App data={{ ...fixture(), mode: "remote", shareHash: "abc" }} />);

    fireEvent.click(screen.getByRole("button", { name: /^feedback/i }));
    fireEvent.click(screen.getByRole("button", { name: /copy feedback to clipboard/i }));

    const textarea = await screen.findByRole("textbox", { name: /feedback markdown/i });
    expect((textarea as HTMLTextAreaElement).value).toContain("board-feedback");
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(promptSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
    promptSpy.mockRestore();
  });

  it("shows pending-order recovery without entering the applying state", async () => {
    const recovery =
      "Route the existing plans/.board-feedback.md order, then run --ack.";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "pending-order", message: recovery }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <App
        data={{
          ...fixture(),
          mode: "live",
          projectId: "project-1",
          boardToken: "token-1",
          seededAnnotations: [
            {
              scope: "master",
              sectionHeading: "Components",
              quote: "MP",
              comment: "Check this.",
              author: "reviewer",
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send to Claude" }));

    expect(await screen.findByText(recovery)).not.toBeNull();
    expect(
      (screen.getByRole("button", { name: "Send to Claude" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(screen.queryByText(/applying your action/i)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
