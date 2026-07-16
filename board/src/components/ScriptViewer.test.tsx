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

    fireEvent.keyDown(
      screen.getByRole("button", { name: "Select line 3 for comment" }),
      { key: "Enter", shiftKey: true },
    );
    expect(screen.queryByText("Comment on lines 2–3")).not.toBeNull();
  });
});
