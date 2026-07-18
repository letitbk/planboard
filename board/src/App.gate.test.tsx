// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import App from "./App";
import type { BoardData } from "./lib/types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

function signFixture(): BoardData {
  const item = {
    component: "01-alpha", proposedVersion: 1,
    path: "plans/execution/01-alpha/.gate-v1.md",
    content: "# Alpha — Execution Plan v1\n\n## Goal and success criteria\n\ngoal text\n",
    contentHash: "a".repeat(64), ticketed: false,
  };
  return {
    schemaVersion: 2, generatedAt: "2026-07-18T00:00", mode: "live",
    focus: "01-alpha", projectId: "p1", bootId: "b1", boardToken: "token",
    project: { name: "p" }, git: { available: false },
    sign: { batchId: "h1", transport: "hook", items: [item] },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [{ component: "01-alpha", versions: [], draft: item }],
      reviews: [],
    },
  } as BoardData;
}

describe("App sign-mode takeover", () => {
  it("renders SignOffView for hook transport without normal board tabs", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ bootId: "b1", projectId: "p1" }) })));
    render(<App data={signFixture()} />);
    expect(screen.getByRole("heading", { name: "Sign plan" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tracker" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Approve$/ })).toBeTruthy();
  });
});
