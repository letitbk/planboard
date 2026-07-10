import { describe, it, expect } from "vitest";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildFeedbackMarkdown, buildFeedbackDocument, type FeedbackMeta } from "./feedback";
import type { Annotation } from "./types";

const FIXTURE = join(__dirname, "__fixtures__", "hosted-feedback-golden.json");

// Benign comment annotations (no backticks/newlines in collaborator fields),
// so the TS formatter and the neutralizing Python assembler agree. The second
// carries a smuggled researcher-only `signoff` key: validate.ts passes unknown
// fields through, so the fixture proves the Python assembler strips it.
const annotations: Annotation[] = [
  { type: "plan-comment", id: "a1", component: "01-x", version: 1,
    quote: "the sample is small", comment: "please expand", author: "Ada",
    view: "tracker" } as unknown as Annotation,
  { type: "doc-comment", id: "a2", view: "tracker",
    quote: "the cutoff date", comment: "why this date?", author: "Bo",
    signoff: { status: "approved" } } as unknown as Annotation,
];

describe("hosted feedback golden fixture", () => {
  it("emits the committed fixture from feedback.ts", () => {
    const meta: FeedbackMeta = {
      sessionId: "s1", generatedAt: "2026-07-09T00:00:00Z", mode: "hosted",
      focus: null, reviewer: "Ada", payloadHash: "ph", shareHash: "abc123",
      annotations,
    };
    const doc = buildFeedbackDocument(buildFeedbackMarkdown(annotations, null), meta);
    if (!existsSync(dirname(FIXTURE))) mkdirSync(dirname(FIXTURE), { recursive: true });
    writeFileSync(FIXTURE, JSON.stringify({ annotations, meta, doc }, null, 2) + "\n");
    // Sanity: the fixture we just wrote parses back.
    const parsed = JSON.parse(readFileSync(FIXTURE, "utf8"));
    expect(parsed.annotations.length).toBe(2);
    expect(parsed.doc).toContain("```json board-feedback");
  });
});
