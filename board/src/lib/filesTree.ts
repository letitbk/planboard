import type { BoardData, BoardFile } from "./types";
import type { NavTarget } from "./navTarget";
import { parseScorecard, preRenewalSlugs } from "./parse";

export interface FileNode {
  id: string;
  label: string;
  badge?: string;
  route?: NavTarget; // present on navigable leaves
  children?: FileNode[];
}

function route(partial: Partial<NavTarget> & { tab: NavTarget["tab"] }): NavTarget {
  return { annotationId: "", anchored: false, ...partial };
}

function reviewLabel(r: BoardFile): string {
  const sc = parseScorecard(r.content);
  if (sc) {
    const tail =
      sc.threshold?.verdict === "fail"
        ? "threshold failed"
        : sc.threshold?.verdict === "undetermined"
          ? "undetermined"
          : `${sc.percent}%`;
    return `v${sc.planVersion} — ${tail}`;
  }
  return r.path.split("/").pop() ?? r.path;
}

export function buildFilesTree(data: BoardData): FileNode[] {
  const nodes: FileNode[] = [
    { id: "master-plan", label: "Master plan", route: route({ tab: "tracker" }) },
    { id: "decision-log", label: "Decision log", route: route({ tab: "timeline" }) },
  ];

  const groups = data.files.executionPlans;
  const pre = preRenewalSlugs(data);

  const reviewsByComponent = new Map<string, BoardFile[]>();
  const unassigned: BoardFile[] = [];
  for (const r of data.files.reviews) {
    const sc = parseScorecard(r.content);
    if (sc?.component) {
      const list = reviewsByComponent.get(sc.component) ?? [];
      list.push(r);
      reviewsByComponent.set(sc.component, list);
    } else {
      unassigned.push(r);
    }
  }

  const componentIds = new Set<string>(groups.map((g) => g.component));
  for (const c of reviewsByComponent.keys()) componentIds.add(c);

  for (const comp of [...componentIds].sort()) {
    const g = groups.find((x) => x.component === comp);
    const children: FileNode[] = [];

    // Plans: ONLY for real execution groups. With signed versions → a group of
    // version leaves; a group with only a draft → a single Plans leaf (draft-only
    // components stay reachable). A review-only component (no execution group, e.g.
    // a review whose component was renamed/removed) gets NO Plans node — routing to
    // Plans there would silently fall back to another group (PlanReader.tsx:93).
    if (g) {
      const versions = g.versions ?? [];
      if (versions.length) {
        const latest = Math.max(...versions.map((v) => v.version));
        children.push({
          id: `${comp}:plans`,
          label: "Plans",
          children: versions
            .slice()
            .sort((a, b) => a.version - b.version)
            .map((v) => ({
              id: v.path,
              label: `v${v.version}`,
              badge: v.version === latest ? "latest" : undefined,
              route: route({ tab: "plans", component: comp, planPath: v.path }),
            })),
        });
      } else {
        children.push({
          id: `${comp}:plans`,
          label: "Plans",
          route: route({ tab: "plans", component: comp }),
        });
      }
    }

    if (g?.results?.length) {
      children.push({
        id: `${comp}:results`,
        label: "Results",
        children: g.results
          .slice()
          .sort((a, b) => a.resultsVersion - b.resultsVersion)
          .map((b) => ({
            id: `${comp}:r${b.resultsVersion}`,
            label: `r${b.resultsVersion}`,
            route: route({ tab: "results", component: comp, resultsVersion: b.resultsVersion }),
          })),
      });
    }

    const reportBundles = (g?.results ?? []).filter((b) => b.publishedReport);
    if (reportBundles.length) {
      children.push({
        id: `${comp}:reports`,
        label: "Reports",
        children: reportBundles
          .slice()
          .sort((a, b) => a.resultsVersion - b.resultsVersion)
          .map((b) => ({
            id: `${comp}:report:r${b.resultsVersion}`,
            label: `r${b.resultsVersion} report`,
            route: route({ tab: "reports", component: comp, resultsVersion: b.resultsVersion }),
          })),
      });
    }

    const revs = reviewsByComponent.get(comp) ?? [];
    if (revs.length) {
      children.push({
        id: `${comp}:reviews`,
        label: "Reviews",
        children: revs.map((r) => ({
          id: r.path,
          label: reviewLabel(r),
          route: route({ tab: "reviews", component: comp, reviewPath: r.path }),
        })),
      });
    }

    nodes.push({
      id: `component:${comp}`,
      label: comp,
      badge: pre.has(comp) ? "pre-renewal" : undefined,
      children,
    });
  }

  if (unassigned.length) {
    nodes.push({
      id: "unassigned-reviews",
      label: "Unassigned reviews",
      children: unassigned.map((r) => ({
        id: r.path,
        label: r.path.split("/").pop() ?? r.path,
        route: route({ tab: "reviews", reviewPath: r.path }),
      })),
    });
  }

  return nodes;
}
