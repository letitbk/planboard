// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { outlineFromContainer } from "./outline";

describe("outlineFromContainer", () => {
  it("builds one entry per rendered heading with levels, keeping duplicates distinct", () => {
    const root = document.createElement("div");
    root.innerHTML = "<h1>Title</h1><p>x</p><h2>Section</h2><h3>Sub</h3><h2>Section</h2>";
    const entries = outlineFromContainer(root);
    expect(entries.map((e) => [e.label, e.level])).toEqual([
      ["Title", 1],
      ["Section", 2],
      ["Sub", 3],
      ["Section", 2],
    ]);
    expect(new Set(entries.map((e) => e.id)).size).toBe(4); // ids unique despite duplicate labels
  });

  it("returns [] for a null container", () => {
    expect(outlineFromContainer(null)).toEqual([]);
  });
});
