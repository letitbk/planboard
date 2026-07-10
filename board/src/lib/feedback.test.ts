import { describe, expect, it } from "vitest";
import {
  buildFeedbackDocument,
  buildFeedbackMarkdown,
  feedbackFilename,
  newSessionId,
  sanitizeForFilename,
  VIEW_LABEL,
  type FeedbackMeta,
} from "./feedback";
import type { Annotation, VerdictRequest } from "./types";

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

describe("buildFeedbackMarkdown", () => {
  const docComment: Annotation = {
    id: "a1", type: "doc-comment", view: "tracker", docKey: "tracker",
    scope: "row:3", quote: "Platform reach", prefix: "", suffix: "",
    sectionHeading: "row 3: Platform reach", occurrenceIndex: 0,
    anchored: true, comment: "status is wrong",
  };
  const planComment: Annotation = {
    id: "a2", type: "plan-comment", planPath: "plans/execution/03-x/v2.md",
    component: "03-x", version: 2, isDraft: false, quote: "the goal",
    prefix: "", suffix: "", sectionHeading: "Goal", occurrenceIndex: 0,
    anchored: true, comment: "tighten this",
  };
  const general: Annotation = {
    id: "a3", type: "general", view: "Timeline", comment: "looks sparse",
  };

  it("returns the no-feedback stub when empty", () => {
    expect(buildFeedbackMarkdown([], null)).toBe(
      "# Board Feedback\n\nNo feedback.",
    );
  });

  it("renders doc-comments with view label, section, and quote", () => {
    const md = buildFeedbackMarkdown([docComment], null);
    expect(md).toContain("## 1. [Tracker — row 3: Platform reach]");
    expect(md).toContain('Feedback on: "Platform reach"');
    expect(md).toContain("> status is wrong");
  });

  it("falls back to the bare view label when sectionHeading is empty", () => {
    const md = buildFeedbackMarkdown(
      [{ ...docComment, sectionHeading: "" } as Annotation],
      null,
    );
    expect(md).toContain("## 1. [Tracker]");
  });

  it("keeps plan-comment and general formats unchanged", () => {
    const md = buildFeedbackMarkdown([planComment, general], null);
    expect(md).toContain("## 1. [03-x v2 — Goal]");
    expect(md).toContain('Feedback on: "the goal"');
    expect(md).toContain("## 2. [Timeline — general]");
  });

  it("renders a review-request header (agent plan review)", () => {
    const md = buildFeedbackMarkdown([], null, {
      agent: "subagent",
      scope: "plan",
      component: "03-x",
      version: 2,
      isDraft: false,
    });
    expect(md).toContain("## REVIEW REQUEST: subagent on 03-x v2");
  });

  it("badges an agent-authored plan comment with (via …)", () => {
    const md = buildFeedbackMarkdown(
      [{ ...planComment, author: "Codex" } as Annotation],
      null,
    );
    expect(md).toContain("## 1. [03-x v2 — Goal] (via Codex)");
  });

  it("badges agent-authored doc and result comments with (via …)", () => {
    const docMd = buildFeedbackMarkdown(
      [{ ...docComment, author: "Gemini" } as Annotation],
      null,
    );
    expect(docMd).toContain("## 1. [Tracker — row 3: Platform reach] (via Gemini)");
    const resultComment: Annotation = {
      id: "r1", type: "result-comment", component: "03-x", resultsVersion: 2,
      target: { kind: "report", quote: "n = 40", occurrenceIndex: 0 },
      comment: "underpowered", author: "Subagent panel · rigor",
    };
    const resMd = buildFeedbackMarkdown([resultComment], null);
    expect(resMd).toContain("## 1. [03-x r2 — report] (via Subagent panel · rigor)");
    expect(resMd).toContain('Feedback on: "n = 40"');
  });

  it("renders review-request headers for master and results scopes", () => {
    expect(
      buildFeedbackMarkdown([], null, { agent: "codex", scope: "master" }),
    ).toContain("## REVIEW REQUEST: codex on master plan");
    expect(
      buildFeedbackMarkdown([], null, {
        agent: "gemini", scope: "results", component: "03-x", resultsVersion: 1,
      }),
    ).toContain("## REVIEW REQUEST: gemini on 03-x r1");
  });

  it("renders the verdict block with the apply command", () => {
    const verdict: VerdictRequest = {
      component: "03-x", resultsVersion: 1,
      status: "changes-requested", comment: "redo fig 2",
    };
    const md = buildFeedbackMarkdown([], verdict);
    expect(md).toContain("## VERDICT: CHANGES-REQUESTED — 03-x r1");
    expect(md).toContain("results.py verdict --component 03-x --version 1");
  });

  it("exposes display labels for every doc-comment view", () => {
    expect(VIEW_LABEL.tracker).toBe("Tracker");
    expect(VIEW_LABEL.timeline).toBe("Timeline");
    expect(VIEW_LABEL.reviews).toBe("Reviews");
  });

  it("renders (via author) for script-comment and general", () => {
    const anns: Annotation[] = [
      { id: "s", type: "script-comment", component: "01-x", resultsVersion: 1,
        script: "a/b.py", lineStart: 1, lineEnd: 2, excerpt: "x", comment: "c1",
        author: "Ada" } as unknown as Annotation,
      { id: "g", type: "general", view: "timeline", comment: "c2",
        author: "Bo" } as unknown as Annotation,
    ];
    const md = buildFeedbackMarkdown(anns, null);
    expect(md).toContain("(via Ada)");
    expect(md).toContain("(via Bo)");
  });
});
