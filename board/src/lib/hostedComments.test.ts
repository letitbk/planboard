import { describe, it, expect } from "vitest";
import {
  newUuid, getClientId, targetHash, isStale, partitionComments, applyPostResult, buildCommentBody,
} from "./hostedComments";
import type {
  BoardData, StoredComment, Annotation, ExecutionPlanGroup, ResultsBundle,
  PlanCommentAnnotation, ResultCommentAnnotation, GeneralAnnotation,
} from "./types";

// Real-shaped BoardData: plans live under files.executionPlans (matches the
// payload board.py builds — see payload["files"]["executionPlans"] = exec_groups).
function boardWith(planContent: string, results?: ResultsBundle[]): BoardData {
  const execGroup: ExecutionPlanGroup = {
    component: "01-x",
    versions: [{ version: 1, content: planContent, path: "plans/execution/01-x/v1.md" }],
    results,
  };
  return {
    schemaVersion: 1,
    generatedAt: "t",
    mode: "hosted",
    focus: null,
    shareHash: "board-hash-1",
    project: { name: "proj" },
    git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "" },
      decisionLog: { path: "plans/decision-log.md", content: "" },
      executionPlans: [execGroup],
      reviews: [],
    },
  };
}

function resultsBundle(resultsVersion: number, manifestContent: string): ResultsBundle {
  return {
    resultsVersion,
    dir: `results/r${resultsVersion}`,
    manifest: null,
    manifestRaw: { path: `results/r${resultsVersion}/manifest.json`, content: manifestContent },
    report: null,
    verdict: null,
    verdictRaw: null,
    scripts: [],
    assets: {},
  };
}

const planComment = (): PlanCommentAnnotation => ({
  id: "n1", type: "plan-comment", planPath: "plans/execution/01-x/v1.md", component: "01-x", version: 1,
  isDraft: false, quote: "q", prefix: "", suffix: "", sectionHeading: "", occurrenceIndex: 0, anchored: true,
  comment: "c",
});

const resultComment = (resultsVersion: number): ResultCommentAnnotation => ({
  id: "r1", type: "result-comment", component: "01-x", resultsVersion,
  target: { kind: "report" }, comment: "c",
});

const generalComment = (): GeneralAnnotation => ({ id: "g1", type: "general", view: "timeline", comment: "c" });

const stored = (over: Partial<StoredComment>): StoredComment =>
  ({ id: "s1", clientId: "cl1", author: "Ada", shareHash: "board-hash-1",
     docHash: null, annotation: planComment(), receivedAt: "t", ...over });

describe("ids", () => {
  it("newUuid is uuid-shaped and unique", () => {
    const a = newUuid(); const b = newUuid();
    expect(a).toMatch(/^[0-9a-f-]{36}$/i);
    expect(a).not.toBe(b);
  });
  it("getClientId persists across calls", () => {
    const mem: Record<string, string> = {};
    const storage = { getItem: (k: string) => mem[k] ?? null,
                      setItem: (k: string, v: string) => { mem[k] = v; } } as unknown as Storage;
    const id1 = getClientId(storage);
    const id2 = getClientId(storage);
    expect(id1).toBe(id2);
  });
});

describe("per-document staleness", () => {
  it("targetHash changes when the target plan content changes", () => {
    const h1 = targetHash(boardWith("original"), planComment());
    const h2 = targetHash(boardWith("edited"), planComment());
    expect(h1).not.toBe(h2);
    expect(h1).toBeTypeOf("string");
  });
  it("a comment on an unchanged doc is NOT stale", () => {
    const data = boardWith("original");
    const c = stored({ docHash: targetHash(data, planComment()) });
    expect(isStale(c, data)).toBe(false);
  });
  it("a comment on a CHANGED doc IS stale", () => {
    const c = stored({ docHash: targetHash(boardWith("original"), planComment()) });
    expect(isStale(c, boardWith("edited"))).toBe(true);
  });
  it("view/general comments (docHash null) fall back to whole-board shareHash", () => {
    const data = boardWith("x");
    const general: StoredComment = { ...stored({ docHash: null }), annotation: generalComment() };
    expect(isStale({ ...general, shareHash: "board-hash-1" }, data)).toBe(false);
    expect(isStale({ ...general, shareHash: "OLD" }, data)).toBe(true);
  });
  it("partitionComments splits live vs stale", () => {
    const data = boardWith("original");
    const fresh = stored({ id: "fresh", docHash: targetHash(data, planComment()) });
    const old = stored({ id: "old", docHash: "STALE" });
    const { live, stale } = partitionComments([fresh, old], data);
    expect(live.map((c) => c.id)).toEqual(["fresh"]);
    expect(stale.map((c) => c.id)).toEqual(["old"]);
  });

  it("a result-comment on results version N is NOT stale when a DIFFERENT results version is added/changed", () => {
    const before = boardWith("original", [resultsBundle(1, "manifest-v1")]);
    const annotation = resultComment(1);
    const docHash = targetHash(before, annotation);

    // A new results version 2 appears (or an existing v2 changes) — v1's
    // manifest content is untouched, so the comment on v1 must stay live.
    const after = boardWith("original", [resultsBundle(1, "manifest-v1"), resultsBundle(2, "manifest-v2-NEW")]);
    const c = stored({ docHash, annotation });
    expect(isStale(c, after)).toBe(false);

    // Sanity: changing v1 itself DOES stale the comment.
    const v1Changed = boardWith("original", [resultsBundle(1, "manifest-v1-EDITED")]);
    expect(isStale(c, v1Changed)).toBe(true);
  });
});

describe("failed-post keeps pending", () => {
  it("removes on ok, keeps on failure", () => {
    const pending: Annotation[] = [planComment(), { ...planComment(), id: "n2" }];
    expect(applyPostResult(pending, "n1", true).map((a) => a.id)).toEqual(["n2"]);
    expect(applyPostResult(pending, "n1", false).map((a) => a.id)).toEqual(["n1", "n2"]);
  });
});

describe("buildCommentBody", () => {
  it("carries id/clientId/author/shareHash/docHash and the annotation", () => {
    const data = boardWith("original");
    const body = buildCommentBody(planComment(), data, "Ada", "cl1") as Record<string, unknown>;
    expect(body.author).toBe("Ada");
    expect(body.clientId).toBe("cl1");
    expect(body.shareHash).toBe("board-hash-1");
    expect(typeof body.id).toBe("string");
    expect((body.annotation as Annotation).type).toBe("plan-comment");
  });
});
