// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import FeedbackPanel, { type FeedbackPanelProps } from "./FeedbackPanel";
import type { PlanCommentAnnotation } from "../lib/types";

afterEach(cleanup);

function comment(id: string, text: string): PlanCommentAnnotation {
  return {
    id, type: "plan-comment", planPath: "p", component: "01-x", version: 1, isDraft: false,
    quote: "q", prefix: "", suffix: "", sectionHeading: "", occurrenceIndex: 0, anchored: true, comment: text,
  };
}

function props(over: Partial<FeedbackPanelProps> = {}): FeedbackPanelProps {
  return {
    variant: "overlay", annotations: [comment("a1", "first")], serverLive: [], serverStale: [],
    hosted: false, canPost: true, submitState: "idle", reviewer: "", savingIds: new Set(),
    onReviewerChange: vi.fn(), onRemove: vi.fn(), onSaveHosted: vi.fn(), onEdit: vi.fn(),
    onClose: vi.fn(), onSubmit: vi.fn(), onDownload: vi.fn(), onCopyFallback: vi.fn(),
    ...over,
  };
}

describe("FeedbackPanel edit unsent comments", () => {
  it("edits a local comment's text via onEdit", () => {
    const onEdit = vi.fn();
    render(<FeedbackPanel {...props({ onEdit })} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByDisplayValue("first"), { target: { value: "edited text" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onEdit).toHaveBeenCalledWith("a1", "edited text");
  });

  it("disables Send while an edit is open", () => {
    render(<FeedbackPanel {...props()} />);
    const send = screen.getByRole("button", { name: /Send to Claude/ }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect((screen.getByRole("button", { name: /Send to Claude/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("freezes Edit/Delete on all cards while an edit is open", () => {
    render(
      <FeedbackPanel
        {...props({ annotations: [comment("a1", "first"), comment("a2", "second")] })}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect(screen.queryByTitle("Delete")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("clears a stranded edit when the edited comment disappears (unfreezes Send)", () => {
    const { rerender } = render(
      <FeedbackPanel
        {...props({ annotations: [comment("a1", "first"), comment("a2", "second")] })}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]); // edit a1
    expect((screen.getByRole("button", { name: /Send to Claude/ }) as HTMLButtonElement).disabled).toBe(true);
    // a1 disappears (e.g. its hosted Save completed); only a2 remains
    rerender(<FeedbackPanel {...props({ annotations: [comment("a2", "second")] })} />);
    // editingId is cleared, so Send is no longer frozen
    expect((screen.getByRole("button", { name: /Send to Claude/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows no Edit button on sent (serverLive) comments", () => {
    render(
      <FeedbackPanel
        {...props({
          annotations: [], hosted: true,
          serverLive: [{ id: "s1", annotation: comment("s1", "sent"), author: "BK", receivedAt: "" } as never],
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("holds the reload guard only while an edit form is open", () => {
    const { container } = render(<FeedbackPanel {...props()} />);
    expect(container.querySelector("[data-reload-guard]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(container.querySelector("[data-reload-guard]")).toBeTruthy();
  });
});
