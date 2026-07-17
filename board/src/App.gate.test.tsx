// @vitest-environment jsdom
// Regression: a successful gate Approve/Deny must render its confirmation
// card. Shipped-broken v0.14.0–v0.19.0: hooks after the early returns made
// React throw "Rendered fewer hooks than expected" on approve.
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import type { BoardData } from "./lib/types";

Element.prototype.scrollIntoView = vi.fn();
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })),
});

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

const V1 = [
  "# Execution Plan v1",
  "Component: `01-alpha`",
  "## Goal and success criteria",
  "goal text",
  "## Build steps",
  "step one",
].join("\n");

export function gateFixture(): BoardData {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-16T00:00",
    mode: "live",
    focus: null,
    projectId: "proj-1",
    boardToken: "tok-abc",
    gate: { component: "01-alpha", proposedVersion: 1 },
    project: { name: "p" },
    git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [
        {
          component: "01-alpha",
          versions: [],
          draft: {
            path: "plans/execution/01-alpha/.gate-v1.md",
            content: V1,
            proposedVersion: 1,
          },
        },
      ],
      reviews: [],
    },
  } as unknown as BoardData;
}

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/api/health")) {
      return { ok: true, json: async () => ({ bootId: "b1", projectId: "proj-1", generation: 1 }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }));
}

describe("gate approve/deny render their confirmation cards", () => {
  it("approve renders the approved card without a hook-order crash", async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a[0]); });
    stubFetch();
    render(<App data={gateFixture()} />);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => {
      expect(screen.getByText(/Approved — the version is being written/i)).toBeTruthy();
    });
    const hookErr = errors.find((e) => String(e).includes("fewer hooks"));
    expect(hookErr, `hook-order error: ${String(hookErr)}`).toBeUndefined();
    spy.mockRestore();
  });

  it("deny renders the changes-requested card without a hook-order crash", async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a[0]); });
    stubFetch();
    const data = gateFixture();
    data.seededAnnotations = [{
      sectionHeading: "Goal and success criteria",
      quote: "goal text",
      comment: "Please revise this goal.",
      author: "reviewer",
      planPath: "plans/execution/01-alpha/.gate-v1.md",
      component: "01-alpha",
      version: 1,
      isDraft: true,
    }];
    render(<App data={data} />);
    fireEvent.click(screen.getByRole("button", { name: /request changes/i }));
    await waitFor(() => {
      expect(screen.getByText(/Changes requested — return to your session/i)).toBeTruthy();
    });
    const hookErr = errors.find((e) => String(e).includes("fewer hooks"));
    expect(hookErr, `hook-order error: ${String(hookErr)}`).toBeUndefined();
    spy.mockRestore();
  });

  it("approve card counts down and respects keep-open", async () => {
    stubFetch();
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});
    render(<App data={gateFixture()} />);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => screen.getByText(/Approved — the version is being written/i));
    expect(screen.getByText(/Closing this tab in 3s/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /keep open/i }));
    expect(screen.getByText(/Auto-close is off/i)).toBeTruthy();
    expect(closeSpy).not.toHaveBeenCalled();
  });
});
