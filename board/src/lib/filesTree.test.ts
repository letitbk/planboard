import { describe, expect, it } from "vitest";
import { buildFilesTree, type FileNode } from "./filesTree";
import type { BoardData } from "./types";

function bundle(v: number, withReport: boolean) {
  return {
    resultsVersion: v,
    dir: `plans/results/01-x/r${v}`,
    manifest: null,
    manifestRaw: { path: `plans/results/01-x/r${v}/manifest.json`, content: "{}" },
    report: { path: `plans/results/01-x/r${v}/report.md`, content: "# r" },
    verdict: null,
    verdictRaw: null,
    scripts: [],
    assets: {},
    publishedReport: withReport
      ? { path: `plans/reports/01-x-r${v}-report.md`, content: "# pub" }
      : null,
  };
}

function data(): BoardData {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-14T00:00",
    mode: "static",
    focus: null,
    project: { name: "p" },
    git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [
        {
          component: "01-x",
          versions: [
            { version: 1, path: "plans/execution/01-x/v1.md", content: "a" },
            { version: 2, path: "plans/execution/01-x/v2.md", content: "b" },
          ],
          results: [bundle(1, true), bundle(2, false)],
        },
        { component: "02-draft-only", versions: [], draft: { path: "plans/execution/02-draft-only/.draft-v1.md", content: "d", proposedVersion: 1 } },
      ],
      reviews: [],
    },
  } as unknown as BoardData;
}

function child(node: FileNode, id: string): FileNode {
  return node.children!.find((c) => c.id === id)!;
}

describe("buildFilesTree", () => {
  it("puts master plan and decision log at the top with routes", () => {
    const tree = buildFilesTree(data());
    expect(tree[0]).toMatchObject({ id: "master-plan", route: { tab: "tracker", annotationId: "" } });
    expect(tree[1]).toMatchObject({ id: "decision-log", route: { tab: "timeline" } });
  });

  it("groups a component's plans/results/reports; Plans is a group of versions", () => {
    const comp = buildFilesTree(data()).find((n) => n.id === "component:01-x")!;
    const plans = child(comp, "01-x:plans");
    expect(plans.children!.map((c) => c.label)).toEqual(["v1", "v2"]);
    expect(plans.children!.find((c) => c.label === "v2")).toMatchObject({
      badge: "latest",
      route: { tab: "plans", component: "01-x", planPath: "plans/execution/01-x/v2.md" },
    });
    expect(child(comp, "01-x:results").children!.map((c) => c.label)).toEqual(["r1", "r2"]);
    // only r1 has a published report:
    expect(child(comp, "01-x:reports").children!.map((c) => c.label)).toEqual(["r1 report"]);
  });

  it("gives a draft-only component a Plans leaf that routes to its Plans view", () => {
    const comp = buildFilesTree(data()).find((n) => n.id === "component:02-draft-only")!;
    const plans = child(comp, "02-draft-only:plans");
    expect(plans.children).toBeUndefined();
    expect(plans.route).toMatchObject({ tab: "plans", component: "02-draft-only" });
  });
});
