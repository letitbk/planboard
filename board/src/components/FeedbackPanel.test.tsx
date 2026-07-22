// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

// vitest globals are off, so testing-library's auto-cleanup never registers.
afterEach(cleanup);
import FeedbackPanel, { type FeedbackPanelProps, AnnotationCard } from "./FeedbackPanel";
import type { Annotation } from "../lib/types";

function ann(id: string): Annotation {
  return {
    id,
    type: "general",
    view: "tracker",
    comment: `comment-${id}`,
  } as unknown as Annotation;
}

function props(over: Partial<FeedbackPanelProps> = {}): FeedbackPanelProps {
  return {
    variant: "docked",
    annotations: [ann("a1")],
    serverLive: [],
    serverStale: [],
    hosted: false,
    canPost: true,
    submitState: "idle",
    reviewer: "",
    savingIds: new Set(),
    onReviewerChange: vi.fn(),
    onRemove: vi.fn(),
    onSaveHosted: vi.fn(),
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    onDownload: vi.fn(),
    onCopyFallback: vi.fn(),
    ...over,
  };
}

describe("FeedbackPanel", () => {
  it("renders cards and the live Send footer", () => {
    render(<FeedbackPanel {...props()} />);
    expect(screen.getByText("comment-a1")).toBeTruthy();
    expect(screen.getByText("Send to Claude")).toBeTruthy();
  });

  it("card click calls onCardClick; delete stays independent", () => {
    const onCardClick = vi.fn();
    const onRemove = vi.fn();
    render(<FeedbackPanel {...props({ onCardClick, onRemove })} />);
    fireEvent.click(screen.getByText("comment-a1"));
    expect(onCardClick).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTitle("Delete"));
    expect(onRemove).toHaveBeenCalledWith("a1");
    expect(onCardClick).toHaveBeenCalledTimes(1); // stopPropagation held
  });

  it("failed state offers the copy fallback", () => {
    const onCopyFallback = vi.fn();
    render(
      <FeedbackPanel {...props({ submitState: "failed", onCopyFallback })} />,
    );
    fireEvent.click(screen.getByText("Copy feedback as markdown"));
    expect(onCopyFallback).toHaveBeenCalled();
  });

  it("docked variant applies the measured offset style", () => {
    const { container } = render(
      <FeedbackPanel
        {...props({ style: { top: 57, height: "calc(100vh - 57px)" } })}
      />,
    );
    const aside = container.querySelector("aside") as HTMLElement;
    expect(aside.style.top).toBe("57px");
    expect(aside.className).toContain("sticky");
  });

  it("labels hosted author names as self-entered and unverified", () => {
    render(<FeedbackPanel {...props({ hosted: true, canPost: false })} />);
    expect(screen.getByText(/self-entered and not verified/i)).toBeTruthy();
  });

  it("renders hosted HTML and javascript payloads as inert text", () => {
    const payload = '<img src=x onerror="alert(1)"><a href="javascript:alert(2)">x</a>';
    const { container } = render(
      <FeedbackPanel
        {...props({
          hosted: true,
          canPost: false,
          annotations: [{ ...ann("a1"), comment: payload }],
        })}
      />,
    );
    expect(screen.getByText(payload)).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });
});

describe("AnnotationCard empty-quote", () => {
  function unanchored(): Annotation {
    return {
      id: "g1", type: "plan-comment", planPath: "p", component: "01-x", version: 1,
      isDraft: false, quote: "", prefix: "", suffix: "", sectionHeading: "",
      occurrenceIndex: 0, anchored: false, comment: "note on the whole plan",
    } as unknown as Annotation;
  }

  it("shows the unanchored badge and no empty quote block", () => {
    const { container, getByText } = render(<AnnotationCard a={unanchored()} />);
    expect(getByText("unanchored")).toBeTruthy();
    // The amber quote block uses italic styling; with an empty quote it must not render.
    expect(container.querySelector(".italic")).toBeNull();
    expect(getByText("note on the whole plan")).toBeTruthy();
  });
});
