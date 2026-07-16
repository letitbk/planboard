// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import Sidebar from "./Sidebar";
import type { FileNode } from "../lib/filesTree";
import type { OutlineEntry } from "../lib/outline";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const tree: FileNode[] = [
  { id: "master-plan", label: "Master plan", route: { tab: "tracker", annotationId: "", anchored: false } },
  {
    id: "component:01-x",
    label: "01-x",
    children: [
      {
        id: "01-x:plans",
        label: "Plans",
        children: [
          { id: "p1", label: "v1", route: { tab: "plans", component: "01-x", planPath: "p/v1.md", annotationId: "", anchored: false } },
        ],
      },
    ],
  },
];

function renderSidebar(over: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const onNavigate = vi.fn();
  const onSelect = vi.fn();
  const outline: OutlineEntry[] = [{ id: "g", label: "Goal", level: 1, onSelect }];
  const { container } = render(
    <Sidebar
      outline={outline}
      tree={tree}
      onNavigate={onNavigate}
      activeTab="plans"
      activeComponent="01-x"
      storageKey="rp-sidebar:test"
      {...over}
    />,
  );
  return { container, onNavigate, onSelect };
}

describe("Sidebar", () => {
  it("uses full width until the desktop breakpoint", () => {
    const { container } = renderSidebar();
    const aside = container.querySelector("aside")!;
    expect(aside.className).toContain("w-full");
    expect(aside.className).toContain("lg:w-56");
    expect(aside.className).toContain("lg:sticky");
  });

  it("shows Outline by default and fires onSelect", () => {
    const { onSelect } = renderSidebar();
    fireEvent.click(screen.getByText("Goal"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("switches to Files and navigates a leaf via its route", () => {
    const { onNavigate } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /files/i }));
    fireEvent.click(screen.getByText("Plans")); // expand depth-1 group
    fireEvent.click(screen.getByText("v1"));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ tab: "plans", planPath: "p/v1.md" }));
  });

  it("marks the active component only on plans/results/reports tabs", () => {
    const { onNavigate: _ } = renderSidebar({ activeTab: "reviews" });
    fireEvent.click(screen.getByRole("button", { name: /files/i }));
    expect(screen.getByText("01-x").closest("button")?.getAttribute("data-active")).toBeNull();
    cleanup();
    renderSidebar({ activeTab: "plans" });
    fireEvent.click(screen.getByRole("button", { name: /files/i }));
    expect(screen.getByText("01-x").closest("button")?.getAttribute("data-active")).toBe("true");
  });

  it("collapses, persists, and starts collapsed when defaultCollapsed and nothing stored", () => {
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(localStorage.getItem("rp-sidebar:test")).toContain("collapsed");
    expect(screen.queryByText("Goal")).toBeNull();
    cleanup();
    localStorage.clear();
    renderSidebar({ defaultCollapsed: true });
    expect(screen.queryByText("Goal")).toBeNull(); // honored default
  });
});
