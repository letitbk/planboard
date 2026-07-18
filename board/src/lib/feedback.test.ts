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
import type { Annotation } from "./types";

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
    expect(buildFeedbackMarkdown([])).toBe(
      "# Board Feedback\n\nNo feedback.",
    );
  });

  it("renders doc-comments with view label, section, and quote", () => {
    const md = buildFeedbackMarkdown([docComment]);
    expect(md).toContain("## 1. [Tracker — row 3: Platform reach]");
    expect(md).toContain('Feedback on: "Platform reach"');
    expect(md).toContain("> status is wrong");
  });

  it("falls back to the bare view label when sectionHeading is empty", () => {
    const md = buildFeedbackMarkdown(
      [{ ...docComment, sectionHeading: "" } as Annotation],
    );
    expect(md).toContain("## 1. [Tracker]");
  });

  it("keeps plan-comment and general formats unchanged", () => {
    const md = buildFeedbackMarkdown([planComment, general]);
    expect(md).toContain("## 1. [03-x v2 — Goal]");
    expect(md).toContain('Feedback on: "the goal"');
    expect(md).toContain("## 2. [Timeline — general]");
  });

  it("renders a review-request header (agent plan review)", () => {
    const md = buildFeedbackMarkdown([], {
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
    );
    expect(md).toContain("## 1. [03-x v2 — Goal] (via Codex)");
  });

  it("badges agent-authored doc and result comments with (via …)", () => {
    const docMd = buildFeedbackMarkdown(
      [{ ...docComment, author: "Gemini" } as Annotation],
    );
    expect(docMd).toContain("## 1. [Tracker — row 3: Platform reach] (via Gemini)");
    const resultComment: Annotation = {
      id: "r1", type: "result-comment", component: "03-x", resultsVersion: 2,
      target: { kind: "report", quote: "n = 40", occurrenceIndex: 0 },
      comment: "underpowered", author: "Subagent panel · rigor",
    };
    const resMd = buildFeedbackMarkdown([resultComment]);
    expect(resMd).toContain("## 1. [03-x r2 — report] (via Subagent panel · rigor)");
    expect(resMd).toContain('Feedback on: "n = 40"');
  });

  it("renders review-request headers for master and results scopes", () => {
    expect(
      buildFeedbackMarkdown([], { agent: "codex", scope: "master" }),
    ).toContain("## REVIEW REQUEST: codex on master plan");
    expect(
      buildFeedbackMarkdown([], {
        agent: "gemini", scope: "results", component: "03-x", resultsVersion: 1,
      }),
    ).toContain("## REVIEW REQUEST: gemini on 03-x r1");
  });

  it("emits no VERDICT block and no verdict fence key", () => {
    const md = buildFeedbackMarkdown([]);
    expect(md).not.toContain("VERDICT");
    const doc = buildFeedbackDocument("body", meta);
    expect(doc).not.toContain('"verdict"');
  });

  it("exposes display labels for every doc-comment view", () => {
    expect(VIEW_LABEL.tracker).toBe("Tracker");
    expect(VIEW_LABEL.timeline).toBe("Timeline");
    expect(VIEW_LABEL.reviews).toBe("Reviews");
  });

  it("doc-comment on a report is labeled Reports", () => {
    const md = buildFeedbackMarkdown([
      { id: "1", type: "doc-comment", view: "reports",
        docKey: "plans/reports/01-x-r1-report.md", scope: "", quote: "the finding",
        prefix: "", suffix: "", sectionHeading: "", occurrenceIndex: 0,
        anchored: true, comment: "check this" },
    ]);
    expect(md).toContain("[Reports]");
    expect(md).toContain('Feedback on: "the finding"');
  });

  it("renders (via author) for script-comment and general", () => {
    const anns: Annotation[] = [
      { id: "s", type: "script-comment", component: "01-x", resultsVersion: 1,
        script: "a/b.py", lineStart: 1, lineEnd: 2, excerpt: "x", comment: "c1",
        author: "Ada" } as unknown as Annotation,
      { id: "g", type: "general", view: "timeline", comment: "c2",
        author: "Bo" } as unknown as Annotation,
    ];
    const md = buildFeedbackMarkdown(anns);
    expect(md).toContain("(via Ada)");
    expect(md).toContain("(via Bo)");
  });
});

describe("feedback control-surface emitters", () => {
  const base = {
    sessionId: "s",
    generatedAt: "now",
    mode: "live" as const,
    focus: null,
    reviewer: null,
    payloadHash: "h",
    shareHash: null,
    annotations: [],
  };

  it("reopen emits a change-request order that never touches verdict.json", () => {
    const md = buildFeedbackMarkdown([], null, null, {
      component: "01-x", resultsVersion: 3, reason: "n changed",
    });
    expect(md).toContain("## REOPEN REQUEST: 01-x r3");
    expect(md).toContain("> n changed");
    expect(md).toContain("against a finalized bundle");
    expect(md).toContain("never touch verdict.json");
    expect(md).not.toContain("its own verdict");
    const doc = buildFeedbackDocument(md, {
      ...base,
      reopen: { component: "01-x", resultsVersion: 3, reason: "n changed" },
    });
    const fence = JSON.parse(
      doc.split("```json board-feedback\n")[1].split("\n```")[0],
    );
    expect(fence.reopen.resultsVersion).toBe(3);
  });
});
