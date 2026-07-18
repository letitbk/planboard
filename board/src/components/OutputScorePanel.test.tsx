// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import OutputScorePanel from "./OutputScorePanel";
import type { OutputScore } from "../lib/types";

afterEach(cleanup);

const good: OutputScore = {
  schemaVersion: 1,
  channels: [
    { id: "fidelity", name: "Fidelity", score: 3, basis: "all 2 steps followed" },
    { id: "attainment", name: "Attainment", score: 2, basis: "1 criteria partial, first: 'c0'" },
    { id: "integrity", name: "Integrity", score: 3, basis: "all 4 checks pass" },
  ],
  profile: "F3·A2·I3",
  total: 8,
  max: 9,
  computedAt: "2026-07-18 12:00",
};

describe("OutputScorePanel", () => {
  it("shows the compact profile and expandable derivation", () => {
    render(<OutputScorePanel score={good} sections={{ validation: true, integrity: true }} />);
    expect(screen.getByText("F3").getAttribute("title")).toContain("all 2 steps followed");
    expect(screen.getByText("A2")).toBeTruthy();
    expect(screen.getByText("I3")).toBeTruthy();
    expect(screen.getByText("8/9")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /F3A2I3/ }));
    expect(screen.getByText("all 4 checks pass")).toBeTruthy();
    expect(screen.getByText(/Derived from/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "validation details" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "integrity details" })).toBeTruthy();
  });

  it("only links to sections that render", () => {
    render(<OutputScorePanel score={good} sections={{ validation: false, integrity: true }} />);
    fireEvent.click(screen.getByRole("button", { name: /F3A2I3/ }));
    expect(screen.queryByRole("button", { name: "validation details" })).toBeNull();
    expect(screen.getByRole("button", { name: "integrity details" })).toBeTruthy();
  });

  it("renders underivable channels and total as dashes", () => {
    const nullable: OutputScore = {
      ...good,
      channels: [
        { id: "fidelity", name: "Fidelity", score: null, basis: "no plan validation" },
        { id: "attainment", name: "Attainment", score: null, basis: "no plan validation" },
        good.channels[2],
      ],
      profile: "F–·A–·I3",
      total: null,
    };
    render(<OutputScorePanel score={nullable} sections={{ validation: false, integrity: true }} />);
    expect(screen.getByText("F–")).toBeTruthy();
    expect(screen.getByText("–/9")).toBeTruthy();
  });
});
