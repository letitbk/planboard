// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AnnotationLayer, { GeneralCommentBox } from "./AnnotationLayer";

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

describe("AnnotationLayer composer survives clicks inside itself", () => {
  it("opens the composer when the button is clicked after the selection collapsed", () => {
    render(
      <AnnotationLayer
        docKey="doc"
        annotations={[]}
        onAdd={vi.fn()}
        onPaintResult={vi.fn()}
      >
        <p>Collapsed selection target</p>
      </AnnotationLayer>,
    );

    const textNode = screen.getByText("Collapsed selection target").firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 9);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent(document, new Event("selectionchange"));

    const comment = screen.getByRole("button", {
      name: "Comment on selected text",
    });
    // Some browsers drop the selection on mousedown over the button.
    selection.removeAllRanges();
    fireEvent.mouseUp(comment);
    fireEvent.click(comment);
    expect(screen.queryByPlaceholderText(/Your comment/)).not.toBeNull();
  });

  it("keeps the pending anchor when the composer is clicked with a collapsed selection", () => {
    const onAdd = vi.fn();
    render(
      <AnnotationLayer
        docKey="doc"
        annotations={[]}
        onAdd={onAdd}
        onPaintResult={vi.fn()}
      >
        <p>Composer click target</p>
      </AnnotationLayer>,
    );

    const textNode = screen.getByText("Composer click target").firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 8);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent(document, new Event("selectionchange"));

    fireEvent.click(
      screen.getByRole("button", { name: "Comment on selected text" }),
    );
    const box = screen.getByPlaceholderText(/Your comment/);
    fireEvent.change(box, { target: { value: "keep me" } });

    // Focusing the textarea collapses the document selection; the mouseup of a
    // click on Save must not be read as "the user cleared their selection".
    selection.removeAllRanges();
    fireEvent.mouseUp(box);

    const save = screen.getByRole("button", { name: "Save comment" });
    fireEvent.click(save);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toMatchObject({ comment: "keep me" });
  });
});

describe("AnnotationLayer reload guard", () => {
  it("holds the reload guard only while the composer is open", () => {
    const { container } = render(
      <AnnotationLayer
        docKey="doc"
        annotations={[]}
        onAdd={vi.fn()}
        onPaintResult={vi.fn()}
      >
        <p>Reload guard target</p>
      </AnnotationLayer>,
    );
    expect(container.querySelector("[data-reload-guard]")).toBeNull();

    const textNode = screen.getByText("Reload guard target").firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 6);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent(document, new Event("selectionchange"));

    fireEvent.click(
      screen.getByRole("button", { name: "Comment on selected text" }),
    );
    expect(container.querySelector("[data-reload-guard]")).toBeTruthy();
  });
});

describe("GeneralCommentBox reload guard", () => {
  it("holds the reload guard only while open", () => {
    const { container } = render(
      <GeneralCommentBox view="tracker" onAdd={vi.fn()} />,
    );
    expect(container.querySelector("[data-reload-guard]")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "+ General comment on this view" }),
    );
    expect(container.querySelector("[data-reload-guard]")).toBeTruthy();
  });
});
