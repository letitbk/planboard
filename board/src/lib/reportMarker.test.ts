import { describe, expect, it } from "vitest";
import { parseReport, stripMarkerLine } from "./reportMarker";

const MARKER = '<!-- rp-report {"schemaVersion": 1, "component": "01-x", "bundle": 2, "plan": 1, "verdict": "pending", "generated": "2026-07-10T14:30"} -->';

describe("parseReport", () => {
  it("parses a well-formed marker and returns the body without it", () => {
    const r = parseReport(`${MARKER}\n# Title\n\nBody.\n`);
    expect(r.marker).toEqual({ schemaVersion: 1, component: "01-x", bundle: 2,
      plan: 1, verdict: "pending", generated: "2026-07-10T14:30" });
    expect(r.malformed).toBe(false);
    expect(r.body).toBe("# Title\n\nBody.\n");
  });
  it("accepts plan null", () => {
    const r = parseReport('<!-- rp-report {"schemaVersion": 1, "component": "01-x", "bundle": 1, "plan": null, "verdict": "pending", "generated": "t"} -->\nB\n');
    expect(r.marker?.plan).toBeNull();
  });
  it("no marker: body is the whole content, not malformed", () => {
    const r = parseReport("# Title\nBody.\n");
    expect(r.marker).toBeNull();
    expect(r.malformed).toBe(false);
    expect(r.body).toBe("# Title\nBody.\n");
  });
  it("malformed marker (unclosed comment) still yields the full body", () => {
    const r = parseReport('<!-- rp-report {"broken": \n# Title\nBody.\n');
    expect(r.marker).toBeNull();
    expect(r.malformed).toBe(true);
    expect(r.body).toBe("# Title\nBody.\n"); // never a blank page
  });
  it("wrong field types are malformed", () => {
    const r = parseReport('<!-- rp-report {"schemaVersion": 1, "component": 5, "bundle": "x", "plan": 1, "verdict": "odd", "generated": "t"} -->\nB\n');
    expect(r.marker).toBeNull();
    expect(r.malformed).toBe(true);
  });
  it("stripMarkerLine is body-only", () => {
    expect(stripMarkerLine(`${MARKER}\nB\n`)).toBe("B\n");
    expect(stripMarkerLine("B\n")).toBe("B\n");
  });
});
