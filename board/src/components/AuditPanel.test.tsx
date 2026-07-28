// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AuditPanel from "./AuditPanel";
import type { Audit } from "../lib/types";

afterEach(cleanup);

const BLOCKER = "[blocker] No random seed. At execution: results are irreproducible.";
const GAP = "[major] No missingness rule. At execution: listwise drops the 2019 wave.";

function audit(over: Partial<Audit> = {}): Audit {
  return {
    schemaVersion: 1,
    component: "03-attrition",
    planVersion: 2,
    planPath: "plans/execution/03-attrition/v2.md",
    date: "2026-07-25",
    reviewer: { token: "codex-sol", effort: "xhigh" },
    overall: "Two material gaps.",
    anchored: [
      {
        section: "Steps",
        quote: "Run the model",
        evidence: { path: "analysis/fit.R", kind: "direct", detail: "no seed set" },
        comment: BLOCKER,
        severity: "blocker",
      },
    ],
    gaps: [
      {
        section: "",
        evidence: { path: "data/wave3.csv", kind: "direct", detail: "12% missing" },
        comment: GAP,
        severity: "major",
      },
    ],
    dispositions: [],
    counts: { blocker: 1, major: 1, minor: 0 },
    ...over,
  };
}

const expand = () => fireEvent.click(screen.getByRole("button", { name: /audit findings/i }));

describe("AuditPanel", () => {
  it("shows the severity strip collapsed", () => {
    render(<AuditPanel audit={audit()} />);
    expect(screen.getByText(/1 blocker · 1 major · 0 minor/)).toBeTruthy();
    expect(screen.queryByText(BLOCKER)).toBeNull();
  });

  it("expands to show both buckets", () => {
    render(<AuditPanel audit={audit()} />);
    expand();
    expect(screen.getByText(BLOCKER)).toBeTruthy();
    expect(screen.getByText(GAP)).toBeTruthy();
  });

  it("shows the evidence path for a finding", () => {
    render(<AuditPanel audit={audit()} />);
    expand();
    expect(screen.getByText("analysis/fit.R")).toBeTruthy();
  });

  it("labels gaps distinctly from anchored findings", () => {
    render(<AuditPanel audit={audit()} />);
    expand();
    expect(screen.getByText(/Not stated in the plan/i)).toBeTruthy();
  });

  it("shows the anchored finding's quote", () => {
    render(<AuditPanel audit={audit()} />);
    expand();
    expect(screen.getByText("Run the model")).toBeTruthy();
  });

  it("marks inferred evidence as inferred", () => {
    const a = audit();
    a.gaps[0].evidence = { path: "data/wave3.csv", kind: "inferred", detail: "likely" };
    render(<AuditPanel audit={a} />);
    expand();
    expect(screen.getByText(/inferred/)).toBeTruthy();
  });

  it("reads clean when there are no findings", () => {
    render(
      <AuditPanel
        audit={audit({ anchored: [], gaps: [], counts: { blocker: 0, major: 0, minor: 0 } })}
      />,
    );
    expect(screen.getByText(/audit: no findings/)).toBeTruthy();
  });

  it("names the reviewer and effort", () => {
    render(<AuditPanel audit={audit()} />);
    expand();
    expect(screen.getByText(/codex-sol · xhigh · 2026-07-25/)).toBeTruthy();
  });

  it("surfaces a fallback reviewer", () => {
    render(
      <AuditPanel
        audit={audit({
          reviewer: { token: "subagent", reviewerFallback: "codex is not available on PATH" },
        })}
      />,
    );
    expand();
    expect(screen.getByText(/not available on PATH/)).toBeTruthy();
  });

  it("shows a disposition when one exists", () => {
    render(
      <AuditPanel
        audit={audit({
          dispositions: [{ finding: BLOCKER, status: "accepted", reason: "seed set in the runner" }],
        })}
      />,
    );
    expand();
    expect(screen.getByText(/accepted/)).toBeTruthy();
    expect(screen.getByText(/seed set in the runner/)).toBeTruthy();
  });

  it("collapses again on a second click", () => {
    render(<AuditPanel audit={audit()} />);
    expand();
    expect(screen.getByText(BLOCKER)).toBeTruthy();
    expand();
    expect(screen.queryByText(BLOCKER)).toBeNull();
  });
});
