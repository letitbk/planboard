// @vitest-environment jsdom
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useScrollSpy } from "./scrollSpy";

interface ObserverHarness {
  callback: IntersectionObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

let observers: ObserverHarness[] = [];

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn((callback: IntersectionObserverCallback) => {
      const harness = {
        callback,
        observe: vi.fn(),
        disconnect: vi.fn(),
      };
      observers.push(harness);
      return harness;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness({
  docKey = "one",
  selector = "[data-outline-id]",
}: {
  docKey?: string;
  selector?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useScrollSpy(ref, selector, [docKey]);
  return (
    <>
      <div ref={ref}>
        <h2 data-outline-id="context">Context</h2>
        <h3>Nested detail</h3>
        <h2 data-outline-id="decisions">Decisions</h2>
      </div>
      <output aria-label="active heading">{active?.textContent ?? "none"}</output>
    </>
  );
}

function entry(target: Element, isIntersecting: boolean, top = 0): IntersectionObserverEntry {
  return {
    target,
    isIntersecting,
    boundingClientRect: { top } as DOMRectReadOnly,
  } as IntersectionObserverEntry;
}

describe("useScrollSpy", () => {
  it("reports the last heading that passed the reading band", () => {
    const { container } = render(<Harness />);
    const headings = container.querySelectorAll("[data-outline-id]");

    act(() => observers[0].callback(
      [entry(headings[0], true), entry(headings[1], true)],
      observers[0] as unknown as IntersectionObserver,
    ));

    expect(screen.getByRole("status", { name: "active heading" }).textContent).toBe("Decisions");
  });

  it("returns null before any heading has been seen", () => {
    render(<Harness />);

    expect(screen.getByRole("status", { name: "active heading" }).textContent).toBe("none");
  });

  it("resets to null when dependencies change", () => {
    const { container, rerender } = render(<Harness docKey="one" />);
    const heading = container.querySelector("[data-outline-id]")!;
    act(() => observers[0].callback(
      [entry(heading, true)],
      observers[0] as unknown as IntersectionObserver,
    ));
    expect(screen.getByRole("status", { name: "active heading" }).textContent).toBe("Context");

    rerender(<Harness docKey="two" />);

    expect(screen.getByRole("status", { name: "active heading" }).textContent).toBe("none");
    expect(observers).toHaveLength(2);
  });

  it("observes only elements matching the selector", () => {
    const { container } = render(<Harness />);
    const h2s = container.querySelectorAll("[data-outline-id]");
    const h3 = screen.getByRole("heading", { level: 3 });

    expect(observers[0].observe).toHaveBeenCalledTimes(2);
    expect(observers[0].observe).not.toHaveBeenCalledWith(h3);
    act(() => observers[0].callback(
      [entry(h2s[0], true), entry(h3, true)],
      observers[0] as unknown as IntersectionObserver,
    ));
    expect(screen.getByRole("status", { name: "active heading" }).textContent).toBe("Context");
  });

  it("disconnects the observer on unmount", () => {
    const { unmount } = render(<Harness />);
    const observer = observers[0];

    unmount();

    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });
});
