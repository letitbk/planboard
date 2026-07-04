// Contract-drift alarm: fixtures include the LITERAL plugin templates and REAL
// artifacts produced by the v0.1.0 pressure tests. Template fixtures are the
// CONTRACT tests (current format must parse fully); the real v0.1 artifacts are
// TOLERANCE tests (old format must keep parsing, with v0.3 fields defaulted).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  allFiles,
  parseDecisionLog,
  parseExecutionPlan,
  parseMasterPlan,
  parseScorecard,
  parseServes,
  payloadContentHash,
} from "./parse";
import { devData } from "../dev-data";

const TEMPLATES = join(
  __dirname,
  "../../../skills/managing-research-plans/templates",
);
const FIXTURES = join(__dirname, "__fixtures__");

const read = (p: string) => readFileSync(p, "utf-8");

describe("master plan parsing (contract: current template)", () => {
  it("parses the literal template with RQs and Serves", () => {
    const mp = parseMasterPlan(read(join(TEMPLATES, "master-plan.md")));
    expect(mp.ok).toBe(true);
    expect(mp.raw).toContain("<!-- research-plans:master-plan -->");
    expect(mp.researchQuestions.length).toBe(2);
    expect(mp.researchQuestions[0].num).toBe(1);
    expect(mp.components.length).toBeGreaterThanOrEqual(2);
    expect(mp.components[1].serves).toBe("RQ1");
    expect(mp.contextMd).not.toContain("### Research questions");
  });

  it("parses the dev-data sample: statuses, serves, RQs", () => {
    const mp = parseMasterPlan(devData.files.masterPlan.content);
    expect(mp.ok).toBe(true);
    expect(mp.components.map((c) => c.status)).toEqual([
      "done",
      "done",
      "in progress",
      "not started",
    ]);
    expect(mp.components.map((c) => c.serves)).toEqual([
      "—",
      "RQ1, RQ2",
      "RQ1",
      "RQ2",
    ]);
    expect(mp.researchQuestions.map((q) => q.num)).toEqual([1, 2]);
    expect(mp.components[1].planLink).toContain("02-data-cleaning");
  });

  it("degrades to ok:false on non-contract markdown", () => {
    const mp = parseMasterPlan("# Something else entirely\n\nprose only");
    expect(mp.ok).toBe(false);
    expect(mp.raw).toContain("Something else");
  });
});

describe("master plan parsing (tolerance: real v0.1 artifact)", () => {
  it("still parses, with v0.3 fields defaulted", () => {
    const mp = parseMasterPlan(read(join(FIXTURES, "real-master-plan.md")));
    expect(mp.ok).toBe(true);
    expect(mp.lastUpdated).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(mp.components.length).toBe(4);
    expect(mp.components[0].status).toBe("done");
    expect(mp.researchQuestions).toEqual([]);
    expect(mp.components.every((c) => c.serves === "")).toBe(true);
  });
});

describe("serves normalization", () => {
  it("extracts and canonicalizes RQ tokens", () => {
    expect(parseServes("RQ1, RQ2").tokens).toEqual(["RQ1", "RQ2"]);
    expect(parseServes("rq1,rq2").tokens).toEqual(["RQ1", "RQ2"]);
    expect(parseServes("`RQ3`").tokens).toEqual(["RQ3"]);
    expect(parseServes("RQ1 and RQ1").tokens).toEqual(["RQ1"]);
  });
  it("distinguishes infrastructure dash from empty", () => {
    expect(parseServes("—").isInfra).toBe(true);
    expect(parseServes("-").isInfra).toBe(true);
    expect(parseServes("").isEmpty).toBe(true);
    expect(parseServes("").isInfra).toBe(false);
    expect(parseServes(null).isEmpty).toBe(true);
  });
});

describe("decision log parsing", () => {
  it("returns zero entries for the literal template (header only)", () => {
    const entries = parseDecisionLog(read(join(TEMPLATES, "decision-log.md")));
    expect(entries.length).toBe(0);
  });

  it("parses dev-data entries with fields and late-captured flag", () => {
    const entries = parseDecisionLog(devData.files.decisionLog.content);
    expect(entries.length).toBe(3);
    expect(entries[0].timestamp).toBe("2026-07-01 10:12");
    expect(entries[0].lateCaptured).toBe(false);
    expect(entries[2].lateCaptured).toBe(true);
    const labels = entries[0].fields.map((f) => f.label);
    expect(labels).toContain("Context");
    expect(labels).toContain("Question (Claude)");
    expect(labels).toContain("Response (researcher)");
    expect(labels).toContain("Effect on execution");
  });

  it("handles Decision (Claude) entries", () => {
    const entries = parseDecisionLog(devData.files.decisionLog.content);
    const labels = entries[1].fields.map((f) => f.label);
    expect(labels).toContain("Decision (Claude)");
  });
});

describe("execution plan parsing (contract: current template)", () => {
  it("parses the literal template with all eight sections, Goal first", () => {
    const ep = parseExecutionPlan(read(join(TEMPLATES, "execution-plan.md")));
    expect(ep.ok).toBe(true);
    expect(ep.sections.map((s) => s.heading)).toEqual([
      "Goal and success criteria",
      "Context",
      "Scope decisions",
      "Approach",
      "Build steps",
      "Verification",
      "Out of scope",
      "Files to reuse",
    ]);
    expect(ep.goal).not.toBeNull();
    expect(ep.serves).toContain("RQ");
  });

  it("parses goal, serves, version, supersedes, sign-off from dev-data v2", () => {
    const v2 = devData.files.executionPlans[0].versions[1];
    const ep = parseExecutionPlan(v2.content);
    expect(ep.ok).toBe(true);
    expect(ep.version).toBe(2);
    expect(ep.supersedes).toContain("v1");
    expect(ep.signedOff).toContain("Jane Doe");
    expect(ep.goal).toContain("documented analysis sample");
    expect(ep.serves).toBe("RQ1, RQ2");
  });

  it("detects missing sign-off on drafts", () => {
    const draft = devData.files.executionPlans[1].draft!;
    const ep = parseExecutionPlan(draft.content);
    expect(ep.ok).toBe(true);
    expect(ep.signedOff).toBeNull();
    expect(ep.serves).toBe("RQ1");
  });
});

describe("execution plan parsing (tolerance: real v0.1 artifact)", () => {
  it("still parses without a Goal section", () => {
    const ep = parseExecutionPlan(read(join(FIXTURES, "real-execution-plan.md")));
    expect(ep.ok).toBe(true);
    expect(ep.version).toBe(1);
    expect(ep.componentSlug).toBe("01-full-pipeline");
    expect(ep.goal).toBeNull();
    expect(ep.serves).toBeNull();
    expect(ep.sections.length).toBeGreaterThanOrEqual(6);
  });
});

describe("scorecard parsing", () => {
  it("parses a v1 scorecard (no threshold block) as before", () => {
    const sc = parseScorecard(devData.files.reviews[0].content);
    expect(sc).not.toBeNull();
    expect(sc!.threshold).toBeUndefined();
    expect(sc!.items.length).toBe(14);
    expect(sc!.percent).toBe(82);
    expect(sc!.band).toBe("strong");
  });

  it("parses a v2 PASS scorecard with threshold checks", () => {
    const sc = parseScorecard(devData.files.reviews[1].content);
    expect(sc).not.toBeNull();
    expect(sc!.threshold!.verdict).toBe("pass");
    expect(sc!.threshold!.checks.length).toBe(9);
    expect(sc!.items.length).toBe(8);
    expect(sc!.percent).toBe(79);
    expect(sc!.excluded![0].id).toBe("G4");
  });

  it("parses a v2 FAIL scorecard: null grade fields, empty items", () => {
    const sc = parseScorecard(devData.files.reviews[2].content);
    expect(sc).not.toBeNull();
    expect(sc!.threshold!.verdict).toBe("fail");
    expect(sc!.threshold!.failures!.length).toBe(3);
    expect(sc!.items).toEqual([]);
    expect(sc!.percent).toBeNull();
    expect(sc!.raw).toBeNull();
    expect(sc!.band).toBe("not a plan");
  });

  it("treats schemaVersion 2 WITHOUT a valid threshold as malformed", () => {
    const bad = '```json board-scorecard\n{"schemaVersion":2,"items":[],"band":"strong","percent":90}\n```';
    expect(parseScorecard(bad)).toBeNull();
    const badVerdict =
      '```json board-scorecard\n{"schemaVersion":2,"threshold":{"verdict":"maybe","checks":[]},"items":[]}\n```';
    expect(parseScorecard(badVerdict)).toBeNull();
  });

  it("returns null when the fence is absent or invalid", () => {
    expect(parseScorecard("# Review\n\nNo fence here")).toBeNull();
    expect(parseScorecard("```json board-scorecard\n{broken\n```")).toBeNull();
  });

  it("parses the scorecard template's fence shape without throwing", () => {
    const tpl = read(join(TEMPLATES, "review-scorecard.md"));
    expect(() => parseScorecard(tpl)).not.toThrow();
  });
});

describe("payload content hash", () => {
  it("is stable across ordering and sensitive to content", () => {
    const a = payloadContentHash([
      { path: "b.md", content: "two" },
      { path: "a.md", content: "one" },
    ]);
    const b = payloadContentHash([
      { path: "a.md", content: "one" },
      { path: "b.md", content: "two" },
    ]);
    expect(a).toBe(b);
    const c = payloadContentHash([
      { path: "a.md", content: "one!" },
      { path: "b.md", content: "two" },
    ]);
    expect(c).not.toBe(a);
  });
});

describe("results layer", () => {
  it("parses done (verified) tracker status", () => {
    const mp = parseMasterPlan(
      "# T\n\n## Components\n\n" +
        "| # | Component | Status | Execution plan | Outcome / notes | Serves |\n" +
        "|---|---|---|---|---|---|\n" +
        "| 1 | X | done (verified) | — | — | — |\n",
    );
    expect(mp.components[0].status).toBe("done (verified)");
  });

  it("allFiles includes results bundle text files", () => {
    const data = {
      files: {
        masterPlan: { path: "plans/master-plan.md", content: "m" },
        decisionLog: { path: "plans/decision-log.md", content: "d" },
        executionPlans: [
          {
            component: "01-x",
            versions: [{ path: "plans/execution/01-x/v1.md", content: "v", version: 1 }],
            results: [
              {
                resultsVersion: 1,
                dir: "plans/execution/01-x/results/r1",
                manifest: null,
                manifestRaw: { path: "plans/execution/01-x/results/r1/manifest.json", content: "{}" },
                report: { path: "plans/execution/01-x/results/r1/report.md", content: "# R" },
                verdict: null,
                verdictRaw: { path: "plans/execution/01-x/results/r1/verdict.json", content: "{}" },
                scripts: [{ path: "plans/execution/01-x/results/r1/scripts/a.R", content: "x" }],
                assets: {},
              },
            ],
          },
        ],
        reviews: [],
      },
    };
    const paths = allFiles(data as never).map((f) => f.path);
    expect(paths).toContain("plans/execution/01-x/results/r1/manifest.json");
    expect(paths).toContain("plans/execution/01-x/results/r1/report.md");
    expect(paths).toContain("plans/execution/01-x/results/r1/verdict.json");
    expect(paths).toContain("plans/execution/01-x/results/r1/scripts/a.R");
  });
});
