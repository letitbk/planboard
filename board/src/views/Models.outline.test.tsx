// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render } from "@testing-library/react";
import Models from "./Models";
import type { BoardData, ModelProfile } from "../lib/types";
import type { OutlineEntry } from "../lib/outline";

afterEach(cleanup);

const noop = () => {};

const PROFILE: ModelProfile = {
  path: "plans/model-profile.md",
  exists: true,
  baselineHash: "a".repeat(64),
  raw: "",
  proseBefore: "How each stage picks a model.",
  proseAfter: "Why these defaults.",
  rows: [
    { stage: "plan", label: "plan (co-authoring)", model: "opus", effort: "max", mechanism: "nudge" },
    { stage: "execute", label: "execute (analysis)", model: "sonnet", effort: null, mechanism: "nudge" },
    { stage: "sync", label: "sync", model: "inherit", effort: null, mechanism: "nudge" },
    { stage: "plan-review", label: "plan review (verdict + grade)", model: "opus", effort: "medium", mechanism: "agent" },
    { stage: "results-validation", label: "results validation", model: "opus", effort: "low", mechanism: "agent" },
    { stage: "board-reviewer", label: "board reviewer panel", model: "opus", effort: "low", mechanism: "agent" },
  ],
  editable: true,
  warnings: [],
  agentsGitignored: false,
};

function base(): BoardData {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-13T00:00",
    mode: "static",
    focus: null,
    project: { name: "p" },
    git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [],
      reviews: [],
    },
  } as unknown as BoardData;
}

describe("Models outline", () => {
  it("publishes one entry per stage row, id/label keyed on the row", () => {
    let published: OutlineEntry[] = [];
    render(
      <Models
        data={base()}
        modelProfile={PROFILE}
        onProfileChange={noop}
        onOutline={(e) => (published = e)}
      />,
    );
    expect(published.map((e) => e.id)).toEqual(
      PROFILE.rows.map((r) => `models-row-${r.stage}`),
    );
    expect(published.map((e) => e.label)).toEqual(PROFILE.rows.map((r) => r.label));
  });

  it("publishes an empty outline when there is no profile", () => {
    let published: OutlineEntry[] | null = null;
    render(
      <Models
        data={base()}
        modelProfile={undefined}
        onProfileChange={noop}
        onOutline={(e) => (published = e)}
      />,
    );
    expect(published).toEqual([]);
  });
});
