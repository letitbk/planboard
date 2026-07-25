// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import App from "./App";
import type { BoardData } from "./lib/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

function liveFixture(): BoardData {
  return {
    schemaVersion: 2, generatedAt: "2026-07-23T00:00", mode: "live",
    focus: null, projectId: "p1", bootId: "b1", boardToken: "token",
    generation: "g-page",
    project: { name: "p" }, git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [],
      reviews: [],
    },
  } as BoardData;
}

function stubHealth(generation: string) {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, bootId: "b1", projectId: "p1", generation }),
  })) as unknown as typeof fetch);
}

function stubReload() {
  const reload = vi.fn();
  const orig = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...orig, reload },
  });
  return reload;
}

async function polls(n: number) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
  }
}

describe("generation staleness wiring", () => {
  it("reloads after two mismatching polls", async () => {
    stubHealth("g-disk");
    const reload = stubReload();
    render(<App data={liveFixture()} />);
    await polls(2);
    expect(reload).toHaveBeenCalled();
  });

  it("holds with a guard element open, shows the notice, refreshes on demand", async () => {
    stubHealth("g-disk");
    const reload = stubReload();
    const guard = document.createElement("div");
    guard.setAttribute("data-reload-guard", "");
    document.body.appendChild(guard);
    render(<App data={liveFixture()} />);
    await polls(2);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText(/Plans changed on disk/)).toBeTruthy();
    screen.getByText("Refresh now").click();
    expect(reload).toHaveBeenCalled();
    guard.remove();
  });

  it("clears the notice when disk returns to the page generation", async () => {
    const reload = stubReload();
    const guard = document.createElement("div");
    guard.setAttribute("data-reload-guard", "");
    document.body.appendChild(guard);
    stubHealth("g-disk");
    render(<App data={liveFixture()} />);
    await polls(2);
    expect(screen.getByText(/Plans changed on disk/)).toBeTruthy();
    stubHealth("g-page");
    await polls(1);
    expect(screen.queryByText(/Plans changed on disk/)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
    guard.remove();
  });

  it("never fires on a matching generation", async () => {
    stubHealth("g-page");
    const reload = stubReload();
    render(<App data={liveFixture()} />);
    await polls(4);
    expect(reload).not.toHaveBeenCalled();
  });
});
