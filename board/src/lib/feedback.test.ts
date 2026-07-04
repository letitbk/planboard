import { describe, expect, it } from "vitest";
import {
  buildFeedbackDocument,
  feedbackFilename,
  newSessionId,
  sanitizeForFilename,
  type FeedbackMeta,
} from "./feedback";

const meta: FeedbackMeta = {
  sessionId: "abcdef12-3456-7890-abcd-ef1234567890",
  generatedAt: "2026-07-03T12:00:00",
  mode: "remote",
  focus: null,
  reviewer: "Candice",
  payloadHash: "deadbeef",
  shareHash: "0123456789abcdef",
  annotations: [],
};

describe("buildFeedbackDocument", () => {
  it("appends a parseable json board-feedback fence", () => {
    const doc = buildFeedbackDocument("# Board Feedback\n\nHi.\n", meta);
    const m = doc.match(/```json board-feedback\n([\s\S]*?)\n```\n$/);
    expect(m).not.toBeNull();
    const parsed = JSON.parse(m![1]);
    expect(parsed.reviewer).toBe("Candice");
    expect(parsed.shareHash).toBe("0123456789abcdef");
    expect(parsed.mode).toBe("remote");
  });

  it("keeps the markdown body intact above the fence", () => {
    const doc = buildFeedbackDocument("# Board Feedback\n\nBody text.", meta);
    expect(doc.startsWith("# Board Feedback\n\nBody text.\n\n```json")).toBe(true);
  });
});

describe("sanitizeForFilename", () => {
  it("strips unsafe characters", () => {
    expect(sanitizeForFilename("Candice Ó Brien!")).toBe("Candice-O-Brien");
  });
  it("falls back to anonymous when nothing survives", () => {
    expect(sanitizeForFilename("!!!")).toBe("anonymous");
  });
});

describe("feedbackFilename", () => {
  it("builds a .txt name with sanitized parts and short session id", () => {
    const name = feedbackFilename("My Project", "Candice", meta.sessionId);
    expect(name).toMatch(
      /^board-feedback-My-Project-Candice-\d{4}-\d{2}-\d{2}-abcdef12\.txt$/,
    );
  });
});

describe("newSessionId", () => {
  it("returns a uuid or 32-hex fallback", () => {
    expect(newSessionId()).toMatch(/^[0-9a-f-]{32,36}$/);
  });
});
