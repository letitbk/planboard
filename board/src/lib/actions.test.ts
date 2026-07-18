import { describe, it, expect } from "vitest";
import { actionsVisible, planActionState } from "./actions";
import type { Annotation, BoardData } from "./types";

function boardData(over: Record<string, unknown> = {}): BoardData {
  return {
    mode: "live",
    files: {
      masterPlan: { content: "# MP" },
      executionPlans: [],
      archives: [],
      reviews: [],
    },
    ...over,
  } as unknown as BoardData;
}

const draftGroup = {
  component: "01-x",
  versions: [
    { version: 1, path: "plans/execution/01-x/v1.md", content: "# v1\n\nSigned off: BK, 2026-07-01\n" },
  ],
  draft: {
    proposedVersion: 2,
    path: "plans/execution/01-x/.draft-v2.md",
    content: "# v2 draft",
  },
};

const signedGroup = {
  component: "02-y",
  versions: [
    { version: 1, path: "plans/execution/02-y/v1.md", content: "# v1\n\nbody\n\n---\nSigned off: BK, 2026-07-02\n" },
  ],
};

function planComment(planPath: string): Annotation {
  return {
    id: "a1",
    type: "plan-comment",
    planPath,
    component: "01-x",
    version: 2,
  } as unknown as Annotation;
}

describe("actionsVisible", () => {
  it("live outside a sign session only", () => {
    expect(actionsVisible(boardData())).toBe(true);
    expect(actionsVisible(boardData({ sign: { batchId: "b", transport: "ticket", items: [] } }))).toBe(false);
    expect(actionsVisible(boardData({ mode: "hosted" }))).toBe(false);
    expect(actionsVisible(boardData({ mode: "remote" }))).toBe(false);
    expect(actionsVisible(boardData({ mode: "static" }))).toBe(false);
  });
});

describe("planActionState", () => {
  it("displayed draft is pending without an in-board approval affordance", () => {
    const d = boardData({ files: { masterPlan: { content: "# MP" }, executionPlans: [draftGroup], archives: [], reviews: [] } });
    expect(planActionState(d, "01-x", [])).toMatchObject({
      kind: "pending",
      version: 2,
      draftPath: "plans/execution/01-x/.draft-v2.md",
      blockedByComments: false,
    });
  });

  it("pending comments do not turn the display-only draft state into a gate", () => {
    const d = boardData({ files: { masterPlan: { content: "# MP" }, executionPlans: [draftGroup], archives: [], reviews: [] } });
    expect(
      planActionState(d, "01-x", [planComment("plans/execution/01-x/.draft-v2.md")])
        .blockedByComments,
    ).toBe(false);
    expect(
      planActionState(d, "01-x", [planComment("plans/execution/99-z/.draft-v9.md")])
        .blockedByComments,
    ).toBe(false);
  });

  it("signed current version shows the badge state", () => {
    const d = boardData({ files: { masterPlan: { content: "# MP" }, executionPlans: [signedGroup], archives: [], reviews: [] } });
    const s = planActionState(d, "02-y", []);
    expect(s.kind).toBe("signedOff");
    expect(s.version).toBe(1);
    expect(s.signedOffLine).toContain("BK");
  });

  it("does not treat an interior Signed off line as a valid latest-version trailer", () => {
    const interior = {
      component: "04-w",
      versions: [{
        version: 1,
        path: "plans/execution/04-w/v1.md",
        content: "# v1\n\n## Goal and success criteria\n\nSigned off: BK, 2026-07-02\n\nMore plan text.\n",
      }],
    };
    const d = boardData({ files: { masterPlan: { content: "# MP" }, executionPlans: [interior], archives: [], reviews: [] } });
    expect(planActionState(d, "04-w", []).kind).toBe("none");
  });

  it("unknown component and unsigned no-draft groups offer nothing", () => {
    const bare = {
      component: "03-z",
      versions: [{ version: 1, path: "p", content: "# v1\n\nno signoff\n" }],
    };
    const d = boardData({ files: { masterPlan: { content: "# MP" }, executionPlans: [bare], archives: [], reviews: [] } });
    expect(planActionState(d, "03-z", []).kind).toBe("none");
    expect(planActionState(d, "99-none", []).kind).toBe("none");
  });
});
