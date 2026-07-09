import { describe, expect, it } from "vitest";
import { unwrapSoftBreaks } from "./markdownText";

describe("unwrapSoftBreaks", () => {
  it("joins BK's example into one flowing paragraph", () => {
    const src =
      "The country-level variance is small once\n" +
      "design weights are applied, and the pooled\n" +
      "estimate is stable.\n" +
      "Serves: RQ1\n" +
      "Signed off: BK, 2026-07-09\n";
    expect(unwrapSoftBreaks(src)).toBe(
      "The country-level variance is small once design weights are applied, and the pooled estimate is stable.\n" +
        "Serves: RQ1\n" +
        "Signed off: BK, 2026-07-09\n",
    );
  });

  it("keeps Label:, RQ, and uppercase-start lines on their own lines", () => {
    const src = "Stopping rule: target N reached\nRQ1: how does it vary\nThe next sentence.\n";
    expect(unwrapSoftBreaks(src)).toBe(src);
  });

  it("joins continuations that start with a parenthesis", () => {
    expect(unwrapSoftBreaks("tagged with hindsight\n(reconstructed) as usual\n")).toBe(
      "tagged with hindsight (reconstructed) as usual\n",
    );
  });

  it("never touches fenced code blocks", () => {
    const src = "intro line\n```\nx <- 1\ny <- x %>%\nfilter(a)\n```\nafter the\nfence text\n";
    expect(unwrapSoftBreaks(src)).toBe(
      "intro line\n```\nx <- 1\ny <- x %>%\nfilter(a)\n```\nafter the fence text\n",
    );
  });

  it("keeps table rows, headings, blockquotes, and hrs intact", () => {
    const src = "| a | b |\n|---|---|\n| 1 | 2 |\n# heading\n> quoted\nline\n---\n";
    expect(unwrapSoftBreaks(src)).toBe(
      "| a | b |\n|---|---|\n| 1 | 2 |\n# heading\n> quoted line\n---\n",
    );
  });

  it("keeps list items but joins a wrapped list-item continuation", () => {
    const src = "- first item wraps\ncontinues here\n- second item\n1. ordered\n2. stays\n";
    expect(unwrapSoftBreaks(src)).toBe(
      "- first item wraps continues here\n- second item\n1. ordered\n2. stays\n",
    );
  });

  it("respects explicit two-space and backslash breaks", () => {
    expect(unwrapSoftBreaks("line with break  \ncontinuation\n")).toBe(
      "line with break  \ncontinuation\n",
    );
    expect(unwrapSoftBreaks("line with break\\\ncontinuation\n")).toBe(
      "line with break\\\ncontinuation\n",
    );
  });

  it("collapses a three-line wrap fully", () => {
    expect(unwrapSoftBreaks("one two\nthree four\nfive six.\n")).toBe(
      "one two three four five six.\n",
    );
  });

  it("leaves blank-line paragraph structure alone", () => {
    const src = "para one line.\n\npara two line.\n";
    expect(unwrapSoftBreaks(src)).toBe(src);
  });

  it("does not join onto an indented code block", () => {
    const src = "text before:\n\n    indented code\n    more code\nafter text\n";
    expect(unwrapSoftBreaks(src)).toBe(src);
  });
});
