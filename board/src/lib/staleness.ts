// Content-staleness tracker for the live board: compares the page's own
// payload generation (data.generation) against /api/health's current disk
// generation. Pure and framework-free, like reconnect.ts. Process identity
// (bootId) reloads live in reconnect.ts and take precedence; this module only
// handles same-boot content drift.

export const STALE_POLLS_TO_FIRE = 2;

export interface StaleState {
  seen: string | null; // the mismatching generation observed last poll
  count: number; // consecutive polls that saw exactly `seen`
}

export const initialStale: StaleState = { seen: null, count: 0 };

export function reduceStale(
  s: StaleState,
  health: { generation?: string; projectId: string },
  page: { generation: string | null; projectId: string },
  phaseKind: string,
): StaleState {
  if (phaseKind !== "online") return initialStale;
  if (!page.generation || !health.generation) return initialStale;
  if (health.projectId !== page.projectId) return initialStale;
  if (health.generation === page.generation) return initialStale;
  if (health.generation === s.seen) return { seen: s.seen, count: s.count + 1 };
  return { seen: health.generation, count: 1 };
}

export function shouldStaleReload(s: StaleState): boolean {
  return s.count >= STALE_POLLS_TO_FIRE;
}

/** True while reloading would destroy transient text: any open editor marked
 * data-reload-guard, or a focused free-text field (fallback for fields that
 * predate the convention). */
export function reloadGuardHeld(doc: Document): boolean {
  if (doc.querySelector("[data-reload-guard]")) return true;
  const ae = doc.activeElement;
  if (!ae) return false;
  const tag = ae.tagName.toLowerCase();
  return (
    tag === "textarea" ||
    (tag === "input" && (ae as HTMLInputElement).type === "text")
  );
}
