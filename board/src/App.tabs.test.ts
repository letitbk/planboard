// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { TABS } from "./App";

describe("tab labels", () => {
  it("results tab is labeled Output & Validation with a stable id", () => {
    const t = TABS.find((t) => t.id === "results");
    expect(t?.label).toBe("Output & Validation");
  });
});
