import { describe, it, expect } from "vitest";
import { validateCommentBody, MAX_COMMENT_LEN, MAX_TOTAL_BYTES } from "./validate";

const good = {
  id: "11111111-1111-4111-8111-111111111111",
  clientId: "c-abc",
  author: "Ada",
  shareHash: "abc123",
  annotation: { type: "plan-comment", component: "01-x", version: 1,
                quote: "the sample", comment: "expand please" },
};

describe("validateCommentBody", () => {
  it("accepts a well-formed comment", () => {
    const r = validateCommentBody(good);
    expect(r.ok).toBe(true);
  });
  it("rejects a non-object / missing fields", () => {
    expect(validateCommentBody(null).ok).toBe(false);
    expect(validateCommentBody({ ...good, id: undefined }).ok).toBe(false);
    expect(validateCommentBody({ ...good, annotation: undefined }).ok).toBe(false);
  });
  it("rejects a disallowed annotation type", () => {
    expect(validateCommentBody({ ...good, annotation: { type: "verdict" } }).ok).toBe(false);
  });
  it("rejects an over-long comment", () => {
    const long = { ...good, annotation: { ...good.annotation, comment: "x".repeat(MAX_COMMENT_LEN + 1) } };
    expect(validateCommentBody(long).ok).toBe(false);
  });
  it("rejects a non-uuid id", () => {
    expect(validateCommentBody({ ...good, id: "not-a-uuid" }).ok).toBe(false);
  });
  it("accepts the well-formed comment well under the total-size cap", () => {
    expect(JSON.stringify(good).length).toBeLessThan(MAX_TOTAL_BYTES);
    expect(validateCommentBody(good).ok).toBe(true);
  });
  it("rejects a body whose annotation carries a huge extra field", () => {
    const oversized = {
      ...good,
      annotation: { ...good.annotation, junk: "x".repeat(MAX_TOTAL_BYTES) },
    };
    expect(validateCommentBody(oversized).ok).toBe(false);
  });
});
