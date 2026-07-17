// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useAutoClose, autoCloseKey, AUTO_CLOSE_SECONDS } from "./autoClose";

const KEY = autoCloseKey("proj-1");

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("useAutoClose", () => {
  it("counts down and calls window.close, then reports refusal", () => {
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});
    const { result, rerender } = renderHook(
      ({ active }) => useAutoClose(active, KEY),
      { initialProps: { active: false } },
    );
    expect(result.current.state.phase).toBe("idle");

    rerender({ active: true });
    expect(result.current.state).toEqual({ phase: "counting", remaining: AUTO_CLOSE_SECONDS });

    for (let i = 0; i < AUTO_CLOSE_SECONDS; i += 1) {
      act(() => { vi.advanceTimersByTime(1000); });
    }
    expect(result.current.state.phase).toBe("closed");
    expect(closeSpy).toHaveBeenCalled();

    // jsdom never actually closes: the 300ms probe reports refusal.
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current.state.phase).toBe("closeFailed");
  });

  it("cancel stops the countdown and persists the preference", () => {
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});
    const { result, rerender } = renderHook(
      ({ active }) => useAutoClose(active, KEY),
      { initialProps: { active: false } },
    );
    rerender({ active: true });
    act(() => { result.current.cancel(); });
    expect(result.current.state.phase).toBe("cancelled");
    expect(localStorage.getItem(KEY)).toBe("off");
    act(() => { vi.advanceTimersByTime(5000); });
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("honors a persisted off preference on activation", () => {
    localStorage.setItem(KEY, "off");
    const { result, rerender } = renderHook(
      ({ active }) => useAutoClose(active, KEY),
      { initialProps: { active: false } },
    );
    rerender({ active: true });
    expect(result.current.state.phase).toBe("cancelled");
  });

  it("enable restarts the countdown and clears the preference", () => {
    localStorage.setItem(KEY, "off");
    const { result, rerender } = renderHook(
      ({ active }) => useAutoClose(active, KEY),
      { initialProps: { active: false } },
    );
    rerender({ active: true });
    act(() => { result.current.enable(); });
    expect(result.current.state).toEqual({ phase: "counting", remaining: AUTO_CLOSE_SECONDS });
    expect(localStorage.getItem(KEY)).toBe(null);
  });
});
