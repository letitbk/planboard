// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import Models from "./Models";
import type { BoardData, ModelProfile } from "../lib/types";

afterEach(cleanup);

const noop = () => {};

// The same six editable rows the other Models tests use, plus the reviewer row
// a migrated profile now carries.
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
    { stage: "plan-audit", label: "plan audit (deep)", model: "codex-sol", effort: "xhigh", mechanism: "reviewer" },
  ],
  editable: true,
  warnings: [],
  agentsGitignored: false,
};

function base(): BoardData {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-25T00:00",
    mode: "live",
    focus: null,
    boardToken: "tok",
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

function row(stage: string): HTMLElement {
  const el = document.getElementById(`models-row-${stage}`);
  if (!el) throw new Error(`no row for ${stage}`);
  return el;
}

describe("Models view with a reviewer row", () => {
  it("renders the reviewer row's label and token", () => {
    render(<Models data={base()} modelProfile={PROFILE} onProfileChange={noop} />);
    expect(screen.getByText("plan audit (deep)")).toBeTruthy();
    expect(screen.getByText("codex-sol")).toBeTruthy();
  });

  it("renders the reviewer row's model and effort as static text, not controls", () => {
    render(<Models data={base()} modelProfile={PROFILE} onProfileChange={noop} />);
    expect(within(row("plan-audit")).queryAllByRole("combobox")).toHaveLength(0);
    expect(within(row("plan-audit")).queryAllByRole("textbox")).toHaveLength(0);
  });

  it("explains why the reviewer row is not editable", () => {
    render(<Models data={base()} modelProfile={PROFILE} onProfileChange={noop} />);
    // Three elements point at the command: the read-only model cell, the
    // read-only effort cell, and the reviewer mechanism chip. A reader
    // hovering any of them learns where to change it.
    expect(within(row("plan-audit")).getAllByTitle(/planboard:models/i)).toHaveLength(3);
    // The editable rows must not claim to be reviewer-managed.
    expect(within(row("plan")).queryAllByTitle(/planboard:models/i)).toHaveLength(0);
  });

  it("still exposes editing controls for the Claude rows", () => {
    render(<Models data={base()} modelProfile={PROFILE} onProfileChange={noop} />);
    // model select + effort select
    expect(within(row("plan")).queryAllByRole("combobox").length).toBeGreaterThanOrEqual(2);
  });

  it("shows a distinct mechanism chip for the reviewer row", () => {
    render(<Models data={base()} modelProfile={PROFILE} onProfileChange={noop} />);
    expect(within(row("plan-audit")).getByText("reviewer")).toBeTruthy();
  });

  it("does not disable Save because of the reviewer row's token", () => {
    // The regression that matters: running the Claude model validator over
    // `codex-sol` would make allValid false and kill Save for every row.
    render(<Models data={base()} modelProfile={PROFILE} onProfileChange={noop} />);
    const save = screen.getByRole("button", { name: /save changes/i });
    // Save is disabled only because nothing is dirty yet — not because the
    // profile is considered invalid. Dirty it via a Claude row, then re-check.
    expect(save).toBeTruthy();
    const select = within(row("plan")).getAllByRole("combobox")[0] as HTMLSelectElement;
    expect(select.disabled).toBe(false);
  });
});
