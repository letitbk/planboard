// @vitest-environment jsdom
// Regression: painted <mark> highlights must survive parent re-renders. The
// board re-renders often (3s health poll, drawer/annotation state); Markdown
// owns the plan DOM via dangerouslySetInnerHTML, so a re-render used to
// re-commit the innerHTML and tear out the imperatively-injected marks. Fixed by
// memoizing Markdown (see components/Markdown.tsx).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor, act } from "@testing-library/react";
import { useCallback, useState } from "react";
import PlanReader from "./PlanReader";
import type { Annotation, BoardData, PlanCommentAnnotation } from "../lib/types";

afterEach(cleanup);

const PLAN_PATH = "plans/execution/01-readability/v1.md";
const STANDARD_PLAN = [
  "# Readability — Execution Plan v1",
  "",
  "## Context",
  "The transition to remote work reshaped how teams coordinate.",
  "",
  "## Goal and success criteria",
  "Produce a single readable narrative that a coauthor can follow.",
  "",
  "Signed off: BK, 2026-07-18",
].join("\n");

function data(content: string): BoardData {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-18T00:00",
    mode: "static",
    focus: null,
    detailLevel: "standard",
    project: { name: "p" },
    git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [
        { component: "01-readability", versions: [{ version: 1, path: PLAN_PATH, content }] },
      ],
      reviews: [],
    },
  } as unknown as BoardData;
}

function annotation(id: string, quote: string): PlanCommentAnnotation {
  return {
    id, type: "plan-comment", planPath: PLAN_PATH, component: "01-readability",
    version: 1, isDraft: false, quote, prefix: "", suffix: "", sectionHeading: "",
    occurrenceIndex: 0, anchored: true, comment: "note",
  };
}

// Mirrors App.tsx's onPaintResult (updates anchored flags in state).
function useAppLikeState(initial: Annotation[]) {
  const [annotations, setAnnotations] = useState(initial);
  const onPaintResult = useCallback((painted: Set<string>, docKey?: string) => {
    setAnnotations((prev) => {
      let changed = false;
      const next = prev.map((a) => {
        if (a.type === "plan-comment") {
          if (docKey !== undefined && a.planPath !== docKey) return a;
          const anchored = painted.has(a.id);
          if (painted.size === 0 || a.anchored === anchored) return a;
          changed = true;
          return { ...a, anchored };
        }
        return a;
      });
      return changed ? next : prev;
    });
  }, []);
  return { annotations, onPaintResult };
}

const STABLE_DATA = data(STANDARD_PLAN);

function Harness({ tick }: { tick: number }) {
  const { annotations, onPaintResult } = useAppLikeState([
    annotation("n1", "Produce a single readable narrative"),
  ]);
  return (
    <div data-tick={tick}>
      <PlanReader
        data={STABLE_DATA}
        canAnnotate
        selectedComponent="01-readability"
        annotations={annotations}
        onAddPlanComment={() => {}}
        onPaintResult={onPaintResult}
        onOpenResults={() => {}}
      />
    </div>
  );
}

describe("PlanReader highlight persistence", () => {
  it("keeps the painted <mark> after the parent re-renders (poll churn)", async () => {
    const { container, rerender } = render(<Harness tick={0} />);

    await waitFor(() =>
      expect(container.querySelector('mark[data-annotation="n1"]')).toBeTruthy(),
    );

    for (let t = 1; t <= 3; t++) {
      await act(async () => {
        rerender(<Harness tick={t} />);
        await new Promise((r) => setTimeout(r, 5));
      });
    }

    expect(container.querySelector('mark[data-annotation="n1"]')).toBeTruthy();
  });
});
