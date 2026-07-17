// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import BatchGate from "./BatchGate";
import type { BoardData } from "../lib/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PATH = "plans/execution/01-x/.draft-v1.md";

function response(status: number, json: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => JSON.stringify(json),
  } as Response;
}

function scorecard(path = PATH): string {
  return `\`\`\`json board-scorecard
{"schemaVersion":3,"status":"scored","component":"01-x","planVersion":1,"planPath":"${path}","rubricVersion":"0.4","date":"2026-07-17","channels":[{"id":"goal","score":3},{"id":"decisions","score":3},{"id":"steps","score":3},{"id":"validation","score":3},{"id":"boundaries","score":3}],"total":15,"max":15,"profile":"G3·D3·S3·V3·B3"}
\`\`\``;
}

function data(over: Record<string, unknown> = {}): BoardData {
  const entry = {
    component: "01-x",
    proposedVersion: 1,
    path: PATH,
    content: "# Original draft\n",
    contentHash: "hash-original",
    ...((over.entry as Record<string, unknown>) ?? {}),
  };
  return {
    schemaVersion: 1,
    generatedAt: "t",
    mode: "live",
    focus: null,
    projectId: "project-1",
    bootId: "boot-1",
    boardToken: "board-token",
    project: { name: "p" },
    git: { available: false },
    gateBatch: [entry],
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [],
      reviews: (over.reviews as BoardData["files"]["reviews"]) ?? [],
    },
  } as BoardData;
}

describe("BatchGate", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/health") {
        return response(200, { bootId: "boot-1", projectId: "project-1" });
      }
      return response(200, { ok: true });
    }) as typeof fetch;
  });

  it("restores a ticketed entry as approved and disables Approve", () => {
    render(<BatchGate data={data({ entry: { ticketed: true } })} />);
    expect(screen.getByText("approved ✓")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Approve/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("echoes the displayed content hash and board token on approval", async () => {
    render(<BatchGate data={data()} />);
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [path, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(path).toBe("/api/batch/approve");
    expect(JSON.parse(init!.body as string)).toEqual({
      component: "01-x",
      proposedVersion: 1,
      contentHash: "hash-original",
      boardToken: "board-token",
    });
  });

  it("refreshes changed text and hash after a stale-draft response", async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      if (String(input) === "/api/health") {
        return response(200, { bootId: "boot-1", projectId: "project-1" });
      }
      return response(409, { error: "stale-draft", entry: {
        component: "01-x", proposedVersion: 1, path: PATH,
        content: "# Refreshed draft\n", contentHash: "hash-fresh", ticketed: false,
      } });
    });
    render(<BatchGate data={data()} />);
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    expect(await screen.findByText("Refreshed draft")).toBeTruthy();
    expect(screen.getByText("This draft changed on disk — the text below is refreshed; review it again.")).toBeTruthy();
    expect(screen.queryByText("approved ✓")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    await waitFor(() => expect(vi.mocked(global.fetch).mock.calls.length).toBeGreaterThan(1));
    const approveCalls = vi.mocked(global.fetch).mock.calls.filter(([url]) => String(url) === "/api/batch/approve");
    expect(JSON.parse(approveCalls.at(-1)![1]!.body as string).contentHash).toBe("hash-fresh");
  });

  it("replaces the whole entry when a newer draft appears", async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      if (String(input) === "/api/health") {
        return response(200, { bootId: "boot-1", projectId: "project-1" });
      }
      return response(409, { error: "newer-draft", entry: {
        component: "01-x", proposedVersion: 2,
        path: "plans/execution/01-x/.draft-v2.md",
        content: "# New version text\n", contentHash: "hash-v2", ticketed: false,
      } });
    });
    render(<BatchGate data={data()} />);
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    expect(await screen.findByText(/proposed v2/)).toBeTruthy();
    expect(screen.getByText("New version text")).toBeTruthy();
    expect(screen.getByText(/A newer draft is now on disk/)).toBeTruthy();
  });

  it("marks a deleted draft removed and disables decision buttons", async () => {
    vi.mocked(global.fetch).mockResolvedValue(response(410, { error: "draft-missing" }));
    render(<BatchGate data={data()} />);
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    expect(await screen.findByText("removed")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Approve/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Request changes/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders one exact-path score profile and hides ambiguous duplicates", () => {
    const one = { path: "plans/reviews/01-x-v1.md", content: scorecard() };
    const { unmount } = render(<BatchGate data={data({ reviews: [one] })} />);
    expect(screen.getByText("G3·D3·S3·V3·B3 · 15/15")).toBeTruthy();
    unmount();
    render(<BatchGate data={data({ reviews: [
      one,
      { path: "plans/reviews/duplicate.md", content: scorecard() },
    ] })} />);
    expect(screen.queryByText("G3·D3·S3·V3·B3 · 15/15")).toBeNull();
  });

  it("explains durable-ticket resume when the server is gone", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("offline"));
    render(<BatchGate data={data()} />);
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    expect(await screen.findByText(/approvals already saved as durable tickets \(valid 7 days\) — re-run the batch to continue/)).toBeTruthy();
  });

  it("finished copy says tickets are saved and the session writes signed files", async () => {
    render(<BatchGate data={data()} />);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByText(/Approved plans are saved as durable tickets/)).toBeTruthy();
    expect(screen.getByText(/your session writes the signed files after the wizard/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("have already been written");
  });
});
