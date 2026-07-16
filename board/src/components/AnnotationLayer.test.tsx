// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AnnotationLayer from "./AnnotationLayer";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
});

describe("AnnotationLayer keyboard selection", () => {
  it("offers the comment composer after a selectionchange event", () => {
    render(
      <AnnotationLayer
        docKey="doc"
        annotations={[]}
        onAdd={vi.fn()}
        onPaintResult={vi.fn()}
      >
        <p>Keyboard selection target</p>
      </AnnotationLayer>,
    );

    const textNode = screen.getByText("Keyboard selection target").firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 8);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent(document, new Event("selectionchange"));

    const comment = screen.getByRole("button", {
      name: "Comment on selected text",
    });
    comment.focus();
    fireEvent.keyDown(comment, { key: "Enter" });
    fireEvent.click(comment);
    expect(screen.queryByPlaceholderText(/Your comment/)).not.toBeNull();
  });
});
