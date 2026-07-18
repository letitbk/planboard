import type { BoardData } from "./types";
import type { NavTarget } from "./navTarget";
import { preRenewalSlugs } from "./parse";

export interface FileNode {
  id: string;
  label: string;
  badge?: string;
  route?: NavTarget; // present on navigable leaves
  children?: FileNode[];
}

export interface ActiveFileRef {
  id: string; // must equal a FileNode id for the sidebar highlight to attach
  label: string; // human name shown above the Outline ("v2 — 03-hetero-effects")
}

export function subtreeHasId(node: FileNode, id: string): boolean {
  if (node.id === id) return true;
  return (node.children ?? []).some((c) => subtreeHasId(c, id));
}

function route(partial: Partial<NavTarget> & { tab: NavTarget["tab"] }): NavTarget {
  return { annotationId: "", anchored: false, ...partial };
}

export function buildFilesTree(data: BoardData): FileNode[] {
  const nodes: FileNode[] = [
    { id: "master-plan", label: "Master plan", route: route({ tab: "tracker" }) },
    { id: "decision-log", label: "Decision log", route: route({ tab: "timeline" }) },
  ];

  const groups = data.files.executionPlans;
  const pre = preRenewalSlugs(data);

  for (const comp of groups.map((g) => g.component).sort()) {
    const g = groups.find((x) => x.component === comp)!;
    const children: FileNode[] = [];

    // Plans: with signed versions → a group of version leaves (plus the working
    // draft, when present — the draft is what gets reviewed); a group with only
    // a draft → a single Plans leaf whose id is the draft path so the active-
    // file highlight can attach.
    const versions = g.versions ?? [];
    if (versions.length) {
      const latest = Math.max(...versions.map((v) => v.version));
      const versionLeaves: FileNode[] = versions
        .slice()
        .sort((a, b) => a.version - b.version)
        .map((v) => ({
          id: v.path,
          label: `v${v.version}`,
          badge: v.version === latest ? "latest" : undefined,
          route: route({ tab: "plans", component: comp, planPath: v.path }),
        }));
      if (g.draft) {
        versionLeaves.push({
          id: g.draft.path,
          label: `v${g.draft.proposedVersion} (draft)`,
          badge: "draft",
          route: route({ tab: "plans", component: comp, planPath: g.draft.path }),
        });
      }
      children.push({
        id: `${comp}:plans`,
        label: "Plans",
        children: versionLeaves,
      });
    } else {
      children.push({
        id: g.draft?.path ?? `${comp}:plans`,
        label: "Plans",
        route: route({ tab: "plans", component: comp }),
      });
    }

    if (g.results?.length) {
      children.push({
        id: `${comp}:results`,
        label: "Output",
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

    const reportBundles = (g.results ?? []).filter((b) => b.publishedReport);
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

    nodes.push({
      id: `component:${comp}`,
      label: comp,
      badge: pre.has(comp) ? "pre-renewal" : undefined,
      children,
    });
  }

  return nodes;
}
