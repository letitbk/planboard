// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ReviewMenu from "./ReviewMenu";

afterEach(cleanup);

describe("ReviewMenu dismissal", () => {
  it("moves focus into the menu, navigates, and restores focus on Escape", () => {
    render(<ReviewMenu onPick={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /Review with/ });

    fireEvent.click(trigger);
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: "End" });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on outside clicks", () => {
    render(<ReviewMenu onPick={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /Review with/ });

    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not dismiss for clicks inside the menu", () => {
    render(<ReviewMenu onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Review with/ }));
    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(screen.queryByRole("menu")).not.toBeNull();
  });
});
