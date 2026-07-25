// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ScriptViewer from "./ScriptViewer";

afterEach(cleanup);

describe("ScriptViewer keyboard line selection", () => {
  it("uses Enter to start and Shift+Enter to extend a comment range", () => {
    render(
      <ScriptViewer
        file={{ path: "plans/results/script.py", content: "one\ntwo\nthree\n" }}
        canAnnotate
        onAddLineComment={vi.fn()}
      />,
    );

    const lineTwo = screen.getByRole("button", {
      name: "Select line 2 for comment",
    });
    lineTwo.focus();
    fireEvent.keyDown(lineTwo, { key: "Enter" });
    expect(screen.queryByText("Comment on lines 2")).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("textbox"));

    const lineThree = screen.getByRole("button", {
      name: "Select line 3 for comment",
    });
    lineThree.focus();
    fireEvent.keyDown(lineThree, { key: "Enter", shiftKey: true });
    expect(screen.queryByText("Comment on lines 2–3")).not.toBeNull();
  });

  it("uses Space for line selection button semantics", () => {
    render(
      <ScriptViewer
        file={{ path: "plans/results/script.py", content: "one\ntwo\n" }}
        canAnnotate
        onAddLineComment={vi.fn()}
      />,
    );

    const lineOne = screen.getByRole("button", {
      name: "Select line 1 for comment",
    });
    lineOne.focus();
    fireEvent.keyDown(lineOne, { key: " " });

    expect(screen.queryByText("Comment on lines 1")).not.toBeNull();
  });

  it("opens a saved line comment from Enter and Space without selecting again", () => {
    const opened = vi.fn();
    const openFromEvent = (event: Event) => {
      const mark = (event.target as HTMLElement).closest?.("[data-annotation]");
      if (mark) opened(mark.getAttribute("data-annotation"));
    };
    document.addEventListener("keydown", (event) => {
      if (event.key === "Enter") openFromEvent(event);
    }, { once: true });
    document.addEventListener("click", openFromEvent, { once: true });
    render(
      <ScriptViewer
        file={{ path: "plans/results/script.py", content: "one\ntwo\nthree\n" }}
        canAnnotate
        saved={[
          {
            id: "saved-1",
            type: "script-comment",
            component: "01-x",
            resultsVersion: 1,
            script: "plans/results/script.py",
            lineStart: 2,
            lineEnd: 3,
            excerpt: "two\nthree",
            comment: "Saved comment",
          },
        ]}
        onAddLineComment={vi.fn()}
      />,
    );

    const savedLine = screen.getByRole("button", {
      name: "Open comment on line 2",
    });
    savedLine.focus();
    fireEvent.keyDown(savedLine, { key: "Enter" });
    fireEvent.keyDown(savedLine, { key: " " });

    expect(opened).toHaveBeenNthCalledWith(1, "saved-1");
    expect(opened).toHaveBeenNthCalledWith(2, "saved-1");
    expect(screen.queryByText(/Comment on lines/)).toBeNull();
  });
});

describe("ScriptViewer reload guard", () => {
  it("holds the reload guard only while the line-comment box is open", () => {
    const { container } = render(
      <ScriptViewer
        file={{ path: "plans/results/script.py", content: "one\ntwo\n" }}
        canAnnotate
        onAddLineComment={vi.fn()}
      />,
    );
    expect(container.querySelector("[data-reload-guard]")).toBeNull();

    const lineOne = screen.getByRole("button", {
      name: "Select line 1 for comment",
    });
    lineOne.focus();
    fireEvent.keyDown(lineOne, { key: "Enter" });

    expect(container.querySelector("[data-reload-guard]")).toBeTruthy();
  });
});
