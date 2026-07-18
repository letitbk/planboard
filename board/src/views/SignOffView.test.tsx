// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SignOffView from "./SignOffView";
import type { BoardData } from "../lib/types";

const PLAN = [
  "# Alpha — Execution Plan v1",
  "",
  "## Goal and success criteria",
  "",
  "goal text",
  "",
  "## Build steps",
  "",
  "1. Do the work.",
].join("\n");

function fixture(transport: "ticket" | "hook" = "ticket", ticketed = false): BoardData {
  const items = [{
    component: "01-alpha", proposedVersion: 1,
    path: "plans/execution/01-alpha/.draft-v1.md", content: PLAN,
    contentHash: "a".repeat(64), ticketed,
  }];
  return {
    schemaVersion: 2, generatedAt: "2026-07-18T00:00", mode: "live",
    focus: "01-alpha", projectId: "p1", bootId: "b1", boardToken: "token",
    project: { name: "p" }, git: { available: false },
    sign: { batchId: "s1", transport, items },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [{ component: "01-alpha", versions: [], draft: items[0] }],
      reviews: [],
    },
  } as BoardData;
}

function stubFetch() {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    if (path.includes("/api/health")) {
      return { ok: true, status: 200, json: async () => ({ bootId: "b1", projectId: "p1" }) };
    }
    calls.push({ path, body: JSON.parse(String(init?.body ?? "{}")) });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }));
  return calls;
}

function addAnnotation() {
  const textNode = screen.getByText("goal text").firstChild!;
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, 4);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent(document, new Event("selectionchange"));
  fireEvent.click(screen.getByRole("button", { name: "Comment on selected text" }));
  fireEvent.change(screen.getByPlaceholderText(/Your comment/), {
    target: { value: "Clarify this goal." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
  vi.unstubAllGlobals();
});

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

describe("SignOffView", () => {
  it("renders items and ticket approval posts the exact identity plus token", async () => {
    const calls = stubFetch();
    render(<SignOffView data={fixture()} />);
    expect(screen.getByText("01-alpha · v1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Approve$/ }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/sign/approve")).toBe(true));
    const call = calls.find((c) => c.path === "/api/sign/approve")!;
    expect(call.body).toMatchObject({
      component: "01-alpha", proposedVersion: 1,
      contentHash: "a".repeat(64), boardToken: "token",
    });
    expect(await screen.findByText("approved ✓")).toBeTruthy();
  });

  it("blocks approval while an unsent annotation exists", () => {
    stubFetch();
    render(<SignOffView data={fixture()} />);
    addAnnotation();
    const approve = screen.getByRole("button", { name: /^Approve$/ }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(approve.title).toMatch(/pending annotation/i);
  });

  it("request changes posts the item's annotations and note", async () => {
    const calls = stubFetch();
    render(<SignOffView data={fixture()} />);
    addAnnotation();
    fireEvent.change(screen.getByPlaceholderText(/Optional note/), {
      target: { value: "Revise before signing." },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Request changes$/ }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/sign/reject")).toBe(true));
    const call = calls.find((c) => c.path === "/api/sign/reject")!;
    expect(call.body.note).toBe("Revise before signing.");
    expect(call.body.annotations).toHaveLength(1);
    expect(JSON.stringify(call.body.annotations)).toContain("goal");
  });

  it("keeps item decisions independent and posts done when all are decided", async () => {
    const calls = stubFetch();
    const data = fixture();
    const second = { ...data.sign!.items[0], component: "02-beta", path: "plans/execution/02-beta/.draft-v1.md", contentHash: "b".repeat(64) };
    data.sign!.items.push(second);
    data.files.executionPlans.push({ component: "02-beta", versions: [], draft: second });
    render(<SignOffView data={data} />);
    fireEvent.click(screen.getByRole("button", { name: /^Approve$/ }));
    await waitFor(() => expect(screen.getByText("02-beta · v1")).toBeTruthy());
    expect(screen.getByText("approved ✓")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Request changes$/ }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/sign/done")).toBe(true));
    expect(await screen.findByRole("heading", { name: "Sign-off decisions saved" })).toBeTruthy();
  });

  it("uses the preserved hook routes and never posts sign/done", async () => {
    const calls = stubFetch();
    const { unmount } = render(<SignOffView data={fixture("hook")} />);
    fireEvent.click(screen.getByRole("button", { name: /^Approve$/ }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/approve")).toBe(true));
    expect(calls.some((c) => c.path === "/api/sign/done")).toBe(false);
    unmount();

    const denyCalls = stubFetch();
    render(<SignOffView data={fixture("hook")} />);
    fireEvent.click(screen.getByRole("button", { name: /^Request changes$/ }));
    await waitFor(() => expect(denyCalls.some((c) => c.path === "/api/deny")).toBe(true));
  });

  it("renders an already-ticketed item as decided", () => {
    stubFetch();
    render(<SignOffView data={fixture("ticket", true)} />);
    expect(screen.getByText("ticket already saved ✓")).toBeTruthy();
  });
});
