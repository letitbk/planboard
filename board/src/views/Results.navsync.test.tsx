// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Results from "./Results";
import type { BoardData, ResultsBundle } from "../lib/types";

afterEach(cleanup);

const noop = () => {};

function bundle(resultsVersion: number, component: string): ResultsBundle {
  return {
    resultsVersion,
    dir: `plans/execution/${component}/results/r${resultsVersion}`,
    manifest: {
      schemaVersion: 1, component, resultsVersion, planVersion: 1,
      provenance: "planned", trigger: "initial", capturedAt: "2026-07-14 10:00",
      metrics: [{ label: "N", value: String(resultsVersion), statement: `Statement ${resultsVersion}.` }],
      artifacts: [],
    },
    manifestRaw: {
      path: `plans/execution/${component}/results/r${resultsVersion}/manifest.json`,
      content: "{}",
    },
    report: null, verdict: null, verdictRaw: null, scripts: [], assets: {},
    publishedReport: null, reportFormats: { pdf: false, docx: false },
  };
}

// Two components:
//   01-a — 2 bundles (r1, r2). Mounting on 01-a defaults idx to its latest
//     bundle, index 1 (r2). That index becomes the STALE pre-reset idx the
//     nav effect's old guard reads after switching components.
//   02-b — 3 bundles (r10, r11, r12). The nav target is r11, which sits at
//     index 1 — the same index as 01-a's stale idx — while 02-b's actual
//     latest bundle is r12 at index 2. This is exactly the collision the bug
//     description calls for: requested index === stale idx, so the old
//     guard (`i !== Math.min(idx, bundles.length - 1)`) skips setIdx and the
//     component-reset effect's "jump to latest" wins instead.
function navSyncData(): BoardData {
  return {
    schemaVersion: 1, generatedAt: "2026-07-14T00:00", mode: "live",
    focus: null, project: { name: "p" }, git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [
        {
          component: "01-a",
          versions: [{ version: 1, path: "plans/execution/01-a/v1.md", content: "# v1" }],
          results: [bundle(1, "01-a"), bundle(2, "01-a")],
        },
        {
          component: "02-b",
          versions: [{ version: 1, path: "plans/execution/02-b/v1.md", content: "# v1" }],
          results: [bundle(10, "02-b"), bundle(11, "02-b"), bundle(12, "02-b")],
        },
      ],
      reviews: [],
    },
  } as BoardData;
}

describe("Results nav sync across components", () => {
  it("honors a cross-component navRequest even when the target index equals the previous component's stale idx", () => {
    const data = navSyncData();
    const { rerender } = render(
      <Results data={data} canAnnotate={false}
        selectedComponent="01-a" annotations={[]}
        onAddResultComment={noop} onAddScriptComment={noop} onPaintResult={noop}
        onVerdict={noop} focusResults={null} navRequest={null} />,
    );
    // Sanity: 01-a mounts on its latest bundle, r2 (idx 1) — this is the
    // stale idx the nav effect's guard will read on the next render.
    expect(screen.getByText(/01-a r2/)).toBeTruthy();

    // Switch component AND request 02-b's r11 in the same navRequest.
    rerender(
      <Results data={data} canAnnotate={false}
        selectedComponent="02-b" annotations={[]}
        onAddResultComment={noop} onAddScriptComment={noop} onPaintResult={noop}
        onVerdict={noop} focusResults={null}
        navRequest={{ token: 1, resultsVersion: 11 }} />,
    );

    // Must land on the requested bundle, r11 — not 02-b's latest, r12.
    expect(screen.getByText(/02-b r11/)).toBeTruthy();
    expect(screen.queryByText(/02-b r12/)).toBeNull();
  });
});
