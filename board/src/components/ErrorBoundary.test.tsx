// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary";

afterEach(cleanup);

function Bomb(): never {
  throw new Error("boom");
}

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(<ErrorBoundary><div>fine</div></ErrorBoundary>);
    expect(screen.getByText("fine")).toBeTruthy();
  });

  it("renders the fallback card when a child throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    expect(screen.getByText(/The board hit an error/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /reload/i })).toBeTruthy();
    spy.mockRestore();
  });
});
