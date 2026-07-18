// Researcher-action availability (control surface, spec §3). One rule for
// visibility — live board, not in a sign session — and one state machine per plan:
// a displayed working draft is pending; a signed current version shows its
// badge; archived/pre-renewal components and plan-less groups offer nothing.
import { parseExecutionPlan, preRenewalSlugs } from "./parse";
import { parseTrailer } from "./trailer";
import type { Annotation, BoardData } from "./types";

export interface PlanActionState {
  kind: "pending" | "signedOff" | "none";
  version?: number;
  signedOffLine?: string;
  draftPath?: string;
  blockedByComments: boolean;
}

/** The ONE visibility rule for every researcher action — review menus, plan
 * clusters, Results verdict/reopen alike. Signing is a separate modal view. */
export function actionsVisible(data: BoardData): boolean {
  return data.mode === "live" && !data.sign;
}

export function planActionState(
  data: BoardData,
  component: string,
  pending: Annotation[],
): PlanActionState {
  const group = data.files.executionPlans.find(
    (g) => g.component === component,
  );
  if (!group) return { kind: "none", blockedByComments: false };
  if (preRenewalSlugs(data).has(component)) {
    return { kind: "none", blockedByComments: false };
  }
  const draft = group.draft;
  if (draft) {
    return {
      kind: "pending",
      version: draft.proposedVersion,
      draftPath: draft.path,
      blockedByComments: false,
    };
  }
  const latest = group.versions[group.versions.length - 1];
  if (latest) {
    const parsed = parseExecutionPlan(latest.content);
    const trailer = parseTrailer(latest.content);
    const signed = parsed.signedOff ??
      (trailer.kind === "signed"
        ? trailer.line!.replace(/^Signed off:\s*/, "")
        : null);
    if (signed) {
      return {
        kind: "signedOff",
        version: latest.version,
        signedOffLine: signed,
        blockedByComments: false,
      };
    }
  }
  return { kind: "none", blockedByComments: false };
}
