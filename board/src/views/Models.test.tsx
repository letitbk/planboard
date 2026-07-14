// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Models from "./Models";
import type { BoardData, ModelProfile } from "../lib/types";

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

function base(mode: BoardData["mode"]): BoardData {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-13T00:00",
    mode,
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
  };
}

describe("Models view (read-only)", () => {
  it("renders six rows and prose, no editing controls, in static mode", () => {
    render(<Models data={base("static")} modelProfile={PROFILE} onProfileChange={noop} />);
    expect(screen.getByText("plan (co-authoring)")).toBeTruthy();
    expect(screen.getByText("board reviewer panel")).toBeTruthy();
    expect(screen.getByText("How each stage picks a model.")).toBeTruthy();
    expect(document.querySelectorAll("select").length).toBe(0);
    expect(screen.queryByText("Save changes")).toBeNull();
  });

  it("is read-only in a remote (collaborator) board even though the profile is editable", () => {
    render(<Models data={base("remote")} modelProfile={PROFILE} onProfileChange={noop} />);
    expect(document.querySelectorAll("select").length).toBe(0);
    expect(screen.queryByText("Save changes")).toBeNull();
  });

  it("shows the non-editable notice and no selects for a non-canonical profile", () => {
    const mp: ModelProfile = { ...PROFILE, editable: false, warnings: ["model-profile: missing sync row"] };
    render(<Models data={base("static")} modelProfile={mp} onProfileChange={noop} />);
    expect(document.querySelectorAll("select").length).toBe(0);
    expect(screen.getByText(/read-only here/)).toBeTruthy();
  });

  it("shows the gitignored warning when agents are ignored", () => {
    const mp: ModelProfile = { ...PROFILE, agentsGitignored: true };
    render(<Models data={base("static")} modelProfile={mp} onProfileChange={noop} />);
    expect(screen.getByText(/gitignored/)).toBeTruthy();
  });

  it("shows the no-profile message when absent in a non-live board", () => {
    render(<Models data={base("static")} modelProfile={undefined} onProfileChange={noop} />);
    expect(screen.getByText(/No model profile is configured/)).toBeTruthy();
  });

  it("does not render a duplicate title when the prose opens with its own H1", () => {
    const mp: ModelProfile = { ...PROFILE, proseBefore: "# Model profile\n\nHow each stage picks a model." };
    render(<Models data={base("static")} modelProfile={mp} onProfileChange={noop} />);
    // exactly one "Model profile" heading (the view's Header), not two
    const headings = screen.getAllByRole("heading", { name: "Model profile" });
    expect(headings.length).toBe(1);
    expect(screen.getByText("How each stage picks a model.")).toBeTruthy();
  });
});

describe("Models view (editing, live)", () => {
  let postBody: Record<string, unknown> | null;
  let postResponse: { status: number; json: unknown };

  const savedResponse = (over: Record<string, unknown> = {}) => ({
    status: 200,
    json: {
      ok: true,
      saved: true,
      modelProfile: PROFILE,
      restartNeeded: true,
      changedAgentStages: ["plan-review"],
      generation: { results: [] },
      ...over,
    },
  });

  beforeEach(() => {
    postBody = null;
    postResponse = savedResponse();
    global.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        postBody = JSON.parse(init.body as string);
        return { status: postResponse.status, json: async () => postResponse.json } as Response;
      }
      return { json: async () => ({ modelProfile: PROFILE }) } as unknown as Response;
    }) as unknown as typeof fetch;
  });

  const selects = () => document.querySelectorAll("select");
  const saveBtn = () => screen.getByText("Save changes") as HTMLButtonElement;

  it("renders 12 selects and the action buttons", async () => {
    render(<Models data={base("live")} modelProfile={PROFILE} onProfileChange={noop} />);
    await waitFor(() => expect(selects().length).toBe(12));
    expect(screen.getByText("Save changes")).toBeTruthy();
    expect(screen.getByText("Revert")).toBeTruthy();
  });

  it("Save is disabled until an edit is made", async () => {
    render(<Models data={base("live")} modelProfile={PROFILE} onProfileChange={noop} />);
    await waitFor(() => expect(selects().length).toBe(12));
    expect(saveBtn().disabled).toBe(true);
    fireEvent.change(selects()[6], { target: { value: "sonnet" } }); // plan-review model
    expect(saveBtn().disabled).toBe(false);
  });

  it("saves the edited rows and shows the restart nudge", async () => {
    const onChange = vi.fn();
    render(<Models data={base("live")} modelProfile={PROFILE} onProfileChange={onChange} />);
    await waitFor(() => expect(selects().length).toBe(12));
    fireEvent.change(selects()[6], { target: { value: "sonnet" } });
    fireEvent.click(saveBtn());
    await screen.findByText(/Restart your Claude Code session/);
    expect((postBody!.rows as { stage: string; model: string }[]).find((r) => r.stage === "plan-review")!.model).toBe("sonnet");
    expect(postBody!.baselineHash).toBe(PROFILE.baselineHash);
  });

  it("a nudge-only edit says 'take effect immediately', no restart", async () => {
    postResponse = savedResponse({ restartNeeded: false, changedAgentStages: [] });
    render(<Models data={base("live")} modelProfile={PROFILE} onProfileChange={noop} />);
    await waitFor(() => expect(selects().length).toBe(12));
    fireEvent.change(selects()[2], { target: { value: "haiku" } }); // execute model (nudge stage)
    fireEvent.click(saveBtn());
    await screen.findByText(/take effect immediately/);
    expect(screen.queryByText(/Restart your Claude Code session/)).toBeNull();
  });

  it("custom model id: empty is invalid (Save off), a valid claude-* id enables Save", async () => {
    render(<Models data={base("live")} modelProfile={PROFILE} onProfileChange={noop} />);
    await waitFor(() => expect(selects().length).toBe(12));
    fireEvent.change(selects()[6], { target: { value: "custom" } });
    const input = document.querySelector("input") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(saveBtn().disabled).toBe(true);
    fireEvent.change(input, { target: { value: "claude-opus-4-8" } });
    expect(saveBtn().disabled).toBe(false);
  });

  it("a 409 shows the rebased notice", async () => {
    postResponse = { status: 409, json: { error: "stale", modelProfile: PROFILE } };
    const onChange = vi.fn();
    render(<Models data={base("live")} modelProfile={PROFILE} onProfileChange={onChange} />);
    await waitFor(() => expect(selects().length).toBe(12));
    fireEvent.change(selects()[6], { target: { value: "sonnet" } });
    fireEvent.click(saveBtn());
    await screen.findByText(/rebased to the latest/);
  });

  it("Revert restores the baseline value", async () => {
    render(<Models data={base("live")} modelProfile={PROFILE} onProfileChange={noop} />);
    await waitFor(() => expect(selects().length).toBe(12));
    const modelSel = () => selects()[6] as HTMLSelectElement;
    fireEvent.change(modelSel(), { target: { value: "sonnet" } });
    expect(modelSel().value).toBe("sonnet");
    fireEvent.click(screen.getByText("Revert"));
    expect(modelSel().value).toBe("opus");
  });

  it("empty state 'Use recommended defaults' posts create:true", async () => {
    render(<Models data={base("live")} modelProfile={undefined} onProfileChange={noop} />);
    fireEvent.click(await screen.findByText("Use recommended defaults"));
    await waitFor(() => expect(postBody).toBeTruthy());
    expect(postBody!.create).toBe(true);
  });

  it("empty state 'Choose your models' also posts create:true", async () => {
    render(<Models data={base("live")} modelProfile={undefined} onProfileChange={noop} />);
    fireEvent.click(await screen.findByText("Choose your models"));
    await waitFor(() => expect(postBody).toBeTruthy());
    expect(postBody!.create).toBe(true);
  });

  // A stateful parent so onProfileChange actually re-renders Models with the
  // returned profile — this is what exposes the feedback-suppression bug that
  // a plain vi.fn() callback hides.
  function Harness({ initial }: { initial?: ModelProfile }) {
    const [mp, setMp] = useState<ModelProfile | undefined>(initial);
    return <Models data={base("live")} modelProfile={mp} onProfileChange={setMp} />;
  }

  it("keeps the restart banner after the parent re-renders with the saved profile", async () => {
    // A different baselineHash forces the draft-reset effect to run.
    postResponse = savedResponse({ modelProfile: { ...PROFILE, baselineHash: "b".repeat(64) } });
    render(<Harness initial={PROFILE} />);
    await waitFor(() => expect(selects().length).toBe(12));
    fireEvent.change(selects()[6], { target: { value: "sonnet" } });
    fireEvent.click(saveBtn());
    await screen.findByText(/Restart your Claude Code session/);
    expect(screen.getByText(/Restart your Claude Code session/)).toBeTruthy();
  });

  it("a 409 with a deleted profile switches to the empty state", async () => {
    postResponse = { status: 409, json: { error: "stale", modelProfile: null } };
    render(<Harness initial={PROFILE} />);
    await waitFor(() => expect(selects().length).toBe(12));
    fireEvent.change(selects()[6], { target: { value: "sonnet" } });
    fireEvent.click(saveBtn());
    await screen.findByText("Use recommended defaults");
  });

  it("hides the create buttons during a sign-off gate", () => {
    const data: BoardData = { ...base("live"), gate: { component: "x", proposedVersion: 1 } };
    render(<Models data={data} modelProfile={undefined} onProfileChange={noop} />);
    expect(screen.queryByText("Use recommended defaults")).toBeNull();
    expect(screen.queryByText("Choose your models")).toBeNull();
    expect(screen.getByText(/No model profile is configured/)).toBeTruthy();
  });
});
