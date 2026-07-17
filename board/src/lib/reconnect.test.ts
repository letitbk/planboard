import { describe, it, expect } from "vitest";
import {
  initialConn,
  reduceConn,
  shouldReload,
  SLEEP_AFTER_MISSES,
  STALL_AFTER_MS,
  type ConnState,
} from "./reconnect";

const P = "proj-1";

function accepted(): ConnState {
  let s = initialConn(P);
  s = reduceConn(s, { type: "submit" });
  return reduceConn(s, {
    type: "post-accepted", actionId: "a1", bootId: "b1", projectId: P, now: 1000,
  });
}

describe("reconnect reducer", () => {
  it("baseline bootId comes from the POST response, never a pre-poll", () => {
    const s = accepted();
    expect(s.phase).toMatchObject({ kind: "accepted", bootId: "b1", actionId: "a1" });
  });

  it("post-failed returns online (copy fallback allowed only here)", () => {
    let s = initialConn(P);
    s = reduceConn(s, { type: "submit" });
    s = reduceConn(s, { type: "post-failed" });
    expect(s.phase.kind).toBe("online");
  });

  it("new bootId + same project means reload after acceptance", () => {
    const s = accepted();
    expect(shouldReload(s, { bootId: "b2", projectId: P })).toBe(true);
    expect(shouldReload(s, { bootId: "b1", projectId: P })).toBe(false);
    expect(shouldReload(s, { bootId: "b2", projectId: "OTHER" })).toBe(false);
  });

  it("same-boot health after acceptance moves to applying", () => {
    let s = accepted();
    s = reduceConn(s, { type: "health", bootId: "b1", projectId: P, now: 2000 });
    expect(s.phase.kind).toBe("applying");
  });

  it("misses while applying never sleep", () => {
    let s = accepted();
    s = reduceConn(s, { type: "health-miss", now: 2000 });
    for (let i = 0; i < SLEEP_AFTER_MISSES + 3; i++) {
      s = reduceConn(s, { type: "health-miss", now: 2100 + i });
    }
    expect(s.phase.kind).not.toBe("sleeping");
  });

  it("applying stalls after STALL_AFTER_MS but keeps its identity", () => {
    let s = accepted();
    s = reduceConn(s, { type: "health", bootId: "b1", projectId: P, now: 2000 });
    s = reduceConn(s, { type: "health-miss", now: 2000 + STALL_AFTER_MS + 1 });
    expect(s.phase).toMatchObject({ kind: "stalled", bootId: "b1", actionId: "a1" });
    expect(shouldReload(s, { bootId: "b9", projectId: P })).toBe(true);
  });

  it("online misses sleep after the threshold", () => {
    let s = initialConn(P);
    for (let i = 0; i < SLEEP_AFTER_MISSES; i++) {
      s = reduceConn(s, { type: "health-miss", now: i });
    }
    expect(s.phase.kind).toBe("sleeping");
  });

  it("sleeping wakes on same-project health and reloads only on a new boot", () => {
    let s = initialConn(P);
    s = reduceConn(s, { type: "health", bootId: "b1", projectId: P, now: 1 });
    for (let i = 0; i < SLEEP_AFTER_MISSES; i++) {
      s = reduceConn(s, { type: "health-miss", now: 10 + i });
    }
    expect(s.phase.kind).toBe("sleeping");
    // same project, same boot -> wake without reload
    expect(shouldReload(s, { bootId: "b1", projectId: P })).toBe(false);
    const woke = reduceConn(s, { type: "health", bootId: "b1", projectId: P, now: 100 });
    expect(woke.phase.kind).toBe("online");
    // same project, NEW boot -> reload
    expect(shouldReload(s, { bootId: "b2", projectId: P })).toBe(true);
  });

  it("sleeping ignores a foreign project on the same port", () => {
    let s = initialConn(P);
    s = reduceConn(s, { type: "health", bootId: "b1", projectId: P, now: 1 });
    for (let i = 0; i < SLEEP_AFTER_MISSES; i++) {
      s = reduceConn(s, { type: "health-miss", now: 10 + i });
    }
    expect(shouldReload(s, { bootId: "bX", projectId: "OTHER" })).toBe(false);
    const still = reduceConn(s, {
      type: "health", bootId: "bX", projectId: "OTHER", now: 100,
    });
    expect(still.phase.kind).toBe("sleeping");
  });

  it("foreign-project health never changes state in any phase", () => {
    let s = accepted();
    const same = reduceConn(s, {
      type: "health", bootId: "bZ", projectId: "OTHER", now: 5000,
    });
    expect(same.phase).toEqual(s.phase);
  });

  it("health while online refreshes lastBootId and resets misses", () => {
    let s = initialConn(P);
    s = reduceConn(s, { type: "health-miss", now: 1 });
    s = reduceConn(s, { type: "health", bootId: "b1", projectId: P, now: 2 });
    expect(s.misses).toBe(0);
    expect(s.phase).toMatchObject({ kind: "online", lastBootId: "b1" });
  });

  it("reset restores the initial state", () => {
    const s = reduceConn(accepted(), { type: "reset" });
    expect(s).toEqual(initialConn(P));
  });
});

describe("initialConn bootId seeding", () => {
  it("seeds the reload baseline from the payload bootId", () => {
    const s = initialConn("p1", "boot-a");
    expect(shouldReload(s, { bootId: "boot-b", projectId: "p1" })).toBe(true);
    expect(shouldReload(s, { bootId: "boot-a", projectId: "p1" })).toBe(false);
  });

  it("keeps the null baseline when no bootId is provided", () => {
    const s = initialConn("p1");
    expect(shouldReload(s, { bootId: "boot-b", projectId: "p1" })).toBe(false);
  });

  it("never reloads for a foreign project even with a seeded baseline", () => {
    const s = initialConn("p1", "boot-a");
    expect(shouldReload(s, { bootId: "boot-b", projectId: "other" })).toBe(false);
  });
});
