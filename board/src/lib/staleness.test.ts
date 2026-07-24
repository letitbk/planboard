// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  initialStale,
  reduceStale,
  reloadGuardHeld,
  shouldStaleReload,
} from "./staleness";

const PAGE = { generation: "g-page", projectId: "p1" };
const h = (generation: string, projectId = "p1") => ({ generation, projectId });

describe("reduceStale", () => {
  it("fires after two consecutive polls of the same foreign generation", () => {
    let s = reduceStale(initialStale, h("g-new"), PAGE, "online");
    expect(shouldStaleReload(s)).toBe(false);
    s = reduceStale(s, h("g-new"), PAGE, "online");
    expect(shouldStaleReload(s)).toBe(true);
  });

  it("resets on a matching poll", () => {
    let s = reduceStale(initialStale, h("g-new"), PAGE, "online");
    s = reduceStale(s, h("g-page"), PAGE, "online");
    expect(s).toEqual(initialStale);
  });

  it("restarts the count when the mismatching generation changes", () => {
    let s = reduceStale(initialStale, h("g-a"), PAGE, "online");
    s = reduceStale(s, h("g-b"), PAGE, "online");
    expect(shouldStaleReload(s)).toBe(false);
    s = reduceStale(s, h("g-b"), PAGE, "online");
    expect(shouldStaleReload(s)).toBe(true);
  });

  it("ignores foreign projects", () => {
    let s = reduceStale(initialStale, h("g-new", "OTHER"), PAGE, "online");
    s = reduceStale(s, h("g-new", "OTHER"), PAGE, "online");
    expect(shouldStaleReload(s)).toBe(false);
  });

  it("suppresses in every non-online phase", () => {
    for (const phase of ["submitting", "accepted", "applying", "stalled", "sleeping"]) {
      let s = reduceStale(initialStale, h("g-new"), PAGE, phase);
      s = reduceStale(s, h("g-new"), PAGE, phase);
      expect(shouldStaleReload(s)).toBe(false);
    }
  });

  it("does nothing without a page generation (pre-refresh servers)", () => {
    const page = { generation: null, projectId: "p1" };
    let s = reduceStale(initialStale, h("g-new"), page, "online");
    s = reduceStale(s, h("g-new"), page, "online");
    expect(shouldStaleReload(s)).toBe(false);
  });
});

describe("reloadGuardHeld", () => {
  it("holds while a data-reload-guard element exists", () => {
    const el = document.createElement("div");
    el.setAttribute("data-reload-guard", "");
    document.body.appendChild(el);
    expect(reloadGuardHeld(document)).toBe(true);
    el.remove();
    expect(reloadGuardHeld(document)).toBe(false);
  });

  it("holds while a textarea is focused", () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    expect(reloadGuardHeld(document)).toBe(true);
    ta.blur();
    ta.remove();
    expect(reloadGuardHeld(document)).toBe(false);
  });
});
