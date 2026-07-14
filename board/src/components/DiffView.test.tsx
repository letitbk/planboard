// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render } from "@testing-library/react";
import DiffView from "./DiffView";

afterEach(cleanup);

describe("DiffView wrapping", () => {
  it("wraps long lines instead of forcing horizontal scroll", () => {
    const longLine = "xx ".repeat(200).trim(); // a single very long changed line
    const { container } = render(
      <DiffView before={"a\n"} after={"a\n" + longLine + "\n"} supersedesReason={null} />,
    );
    // the changed line's text is rendered in a wrapping element (not white-space:pre)
    const wrapping = Array.from(container.querySelectorAll("span")).filter((s) =>
      /whitespace-pre-wrap/.test(s.className),
    );
    expect(wrapping.length).toBeGreaterThan(0);
    const carries = wrapping.some((s) => s.textContent?.includes("xx xx xx"));
    expect(carries).toBe(true);
  });

  it("preserves leading indentation on wrapped lines", () => {
    const indented = "    indented body";
    const { container } = render(
      <DiffView before={"a\n"} after={"a\n" + indented + "\n"} supersedesReason={null} />,
    );
    const wrapping = Array.from(container.querySelectorAll("span")).find(
      (s) =>
        /whitespace-pre-wrap/.test(s.className) &&
        s.textContent?.includes("indented"),
    );
    // whitespace-pre-wrap keeps the leading spaces intact
    expect(wrapping?.textContent?.startsWith("    ")).toBe(true);
  });
});
