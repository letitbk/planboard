// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { paintHighlights } from "./anchor";

describe("paintHighlights empty-quote guard", () => {
  it("skips an empty-quote anchor without painting or hanging", () => {
    const el = document.createElement("div");
    el.innerHTML = "<p>Some plan text to anchor against.</p>";
    const outcome = paintHighlights(el, [{ id: "g1", quote: "", occurrenceIndex: 0 }]);
    expect(outcome.painted.size).toBe(0);
    expect(el.querySelector("mark[data-annotation]")).toBeNull();
  });

  it("skips a whitespace-only quote too", () => {
    const el = document.createElement("div");
    el.innerHTML = "<p>Some plan text.</p>";
    const outcome = paintHighlights(el, [{ id: "g1", quote: "   ", occurrenceIndex: 0 }]);
    expect(outcome.painted.size).toBe(0);
  });

  it("still paints a real quote alongside an empty one", () => {
    const el = document.createElement("div");
    el.innerHTML = "<p>Some plan text to anchor against.</p>";
    const outcome = paintHighlights(el, [
      { id: "g1", quote: "", occurrenceIndex: 0 },
      { id: "r1", quote: "plan text", occurrenceIndex: 0 },
    ]);
    expect(outcome.painted.has("r1")).toBe(true);
    expect(outcome.painted.has("g1")).toBe(false);
    expect(el.querySelector('mark[data-annotation="r1"]')?.textContent).toBe("plan text");
  });
});
