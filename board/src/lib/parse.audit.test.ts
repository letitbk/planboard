import { describe, it, expect } from "vitest";
import { parseAudit } from "./parse";

const fence = (obj: unknown) =>
  `# Audit\n\nprose\n\n## Data\n\n\`\`\`json board-audit\n${JSON.stringify(obj)}\n\`\`\`\n`;

const finding = (comment: string, over: Record<string, unknown> = {}) => ({
  section: "Steps",
  quote: "Run the model",
  evidence: { path: "analysis/fit.R", kind: "direct", detail: "no seed set" },
  comment,
  ...over,
});

const VALID = {
  schemaVersion: 1,
  component: "03-attrition",
  planVersion: 2,
  planPath: "plans/execution/03-attrition/v2.md",
  date: "2026-07-25",
  reviewer: { token: "codex-sol", effort: "xhigh" },
  auditPlanHash: "a".repeat(64),
  overall: "Two gaps.",
  anchored: [finding("[blocker] No seed. At execution: results are irreproducible.")],
  gaps: [
    finding("[major] No missingness rule. At execution: listwise drops 2019.", {
      quote: undefined,
    }),
  ],
  dispositions: [],
};

describe("parseAudit", () => {
  it("parses a valid fence", () => {
    const a = parseAudit(fence(VALID))!;
    expect(a.component).toBe("03-attrition");
    expect(a.anchored).toHaveLength(1);
    expect(a.gaps).toHaveLength(1);
  });

  it("exposes severity counts", () => {
    expect(parseAudit(fence(VALID))!.counts).toEqual({ blocker: 1, major: 1, minor: 0 });
  });

  it("orders findings most severe first within each bucket", () => {
    const many = {
      ...VALID,
      gaps: [
        finding("[minor] Small. At execution: nothing breaks.", { quote: undefined }),
        finding("[blocker] Big. At execution: it crashes.", { quote: undefined }),
        finding("[major] Medium. At execution: wrong numbers.", { quote: undefined }),
      ],
    };
    expect(parseAudit(fence(many))!.gaps.map((f) => f.severity)).toEqual([
      "blocker",
      "major",
      "minor",
    ]);
  });

  it("returns null with no fence", () => {
    expect(parseAudit("# Audit\n\nNo fence here")).toBeNull();
  });

  it("returns null on broken JSON", () => {
    expect(parseAudit("```json board-audit\n{broken\n```")).toBeNull();
  });

  it("returns null when a bucket is not an array", () => {
    expect(parseAudit(fence({ ...VALID, gaps: "nope" }))).toBeNull();
  });

  it("does not parse a scorecard fence", () => {
    expect(parseAudit('```json board-scorecard\n{"schemaVersion":3}\n```')).toBeNull();
  });

  it("drops a finding with no valid severity tag", () => {
    const bad = { ...VALID, gaps: [finding("no tag here", { quote: undefined })] };
    expect(parseAudit(fence(bad))!.gaps).toHaveLength(0);
  });

  it("keeps a finding whose evidence is missing rather than dropping it", () => {
    // The writer enforces evidence; the reader stays tolerant so a
    // hand-edited or older artifact still renders.
    const noEv = {
      ...VALID,
      gaps: [{ section: "", comment: "[minor] Small. At execution: nothing breaks." }],
    };
    expect(parseAudit(fence(noEv))!.gaps[0].evidence).toBeUndefined();
  });

  it("exposes dispositions untouched", () => {
    const d = {
      ...VALID,
      dispositions: [{ finding: "f1", status: "accepted", reason: "known" }],
    };
    expect(parseAudit(fence(d))!.dispositions).toHaveLength(1);
  });
});
