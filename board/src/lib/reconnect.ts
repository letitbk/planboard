// Reconnect state machine for the persistent live board (control surface).
// Pure and framework-free: App wires it to a health poll + POST responses.
// The baseline bootId for reload detection starts with the boot payload and is
// refreshed by accepted POST responses or observed same-project health.

export type ConnPhase =
  | { kind: "online"; lastBootId: string | null }
  | { kind: "submitting"; lastBootId: string | null }
  | { kind: "accepted"; actionId: string; bootId: string; projectId: string; at: number }
  | { kind: "applying"; actionId: string; bootId: string; projectId: string; since: number }
  | { kind: "stalled"; actionId: string; bootId: string; projectId: string; since: number }
  | { kind: "sleeping"; lastBootId: string | null };

export type ConnEvent =
  | { type: "submit" }
  | { type: "post-accepted"; actionId: string; bootId: string; projectId: string; now: number }
  | { type: "post-failed" }
  | { type: "health"; bootId: string; projectId: string; now: number }
  | { type: "health-miss"; now: number }
  | { type: "reset" };

export const POLL_MS = 3000;
export const SLEEP_AFTER_MISSES = 4;
export const STALL_AFTER_MS = 120_000;

export interface ConnState {
  phase: ConnPhase;
  misses: number;
  projectId: string;
}

export function initialConn(projectId: string, bootId: string | null = null): ConnState {
  return { phase: { kind: "online", lastBootId: bootId }, misses: 0, projectId };
}

function lastBootOf(phase: ConnPhase): string | null {
  switch (phase.kind) {
    case "online":
    case "submitting":
    case "sleeping":
      return phase.lastBootId;
    case "accepted":
    case "applying":
    case "stalled":
      return phase.bootId;
  }
}

/** True when this health response proves a fresh server for OUR project —
 * the caller reloads the page instead of reducing. */
export function shouldReload(
  s: ConnState,
  health: { bootId: string; projectId: string },
): boolean {
  if (health.projectId !== s.projectId) return false;
  const last = lastBootOf(s.phase);
  return last !== null && health.bootId !== last;
}

export function reduceConn(s: ConnState, e: ConnEvent): ConnState {
  const p = s.phase;
  switch (e.type) {
    case "reset":
      return initialConn(s.projectId);

    case "submit":
      return {
        ...s,
        misses: 0,
        phase: { kind: "submitting", lastBootId: lastBootOf(p) },
      };

    case "post-accepted":
      return {
        ...s,
        misses: 0,
        phase: {
          kind: "accepted",
          actionId: e.actionId,
          bootId: e.bootId,
          projectId: e.projectId,
          at: e.now,
        },
      };

    case "post-failed":
      return { ...s, misses: 0, phase: { kind: "online", lastBootId: lastBootOf(p) } };

    case "health": {
      if (e.projectId !== s.projectId) return s; // foreign board on our port
      switch (p.kind) {
        case "accepted":
          // Same boot still up: the order is being applied server-side.
          return p.bootId === e.bootId
            ? { ...s, misses: 0, phase: { ...p, kind: "applying", since: e.now } }
            : s; // new boot: caller reloads via shouldReload
        case "applying":
        case "stalled":
          return s; // same boot: keep waiting; new boot: caller reloads
        case "online":
        case "submitting":
          return { ...s, misses: 0, phase: { ...p, lastBootId: e.bootId } };
        case "sleeping":
          return { ...s, misses: 0, phase: { kind: "online", lastBootId: e.bootId } };
      }
      return s;
    }

    case "health-miss": {
      switch (p.kind) {
        case "accepted":
          // The expected gap: the one-shot server exited after our order.
          return { ...s, phase: { ...p, kind: "applying", since: e.now } };
        case "applying":
          return e.now - p.since >= STALL_AFTER_MS
            ? { ...s, phase: { ...p, kind: "stalled" } }
            : s;
        case "stalled":
        case "sleeping":
          return s;
        case "online":
        case "submitting": {
          const misses = s.misses + 1;
          if (misses >= SLEEP_AFTER_MISSES) {
            return {
              ...s,
              misses,
              phase: { kind: "sleeping", lastBootId: lastBootOf(p) },
            };
          }
          return { ...s, misses };
        }
      }
      return s;
    }
  }
}
