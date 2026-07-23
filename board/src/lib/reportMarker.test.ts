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
  it("parses a v2 marker with a validation field", () => {
    const line = '<!-- rp-report {"schemaVersion": 2, "component": "01-a", "bundle": 1, "plan": 1, "validation": "conforms", "generated": "2026-07-17T10:00"} -->';
    const r = parseReport(`${line}\nbody`);
    expect(r.marker?.schemaVersion).toBe(2);
    expect(r.marker?.validation).toBe("conforms");
  });
  it("v2 marker without validation is malformed", () => {
    const line = '<!-- rp-report {"schemaVersion": 2, "component": "01-a", "bundle": 1, "plan": 1, "generated": "2026-07-17T10:00"} -->';
    const r = parseReport(`${line}\nbody`);
    expect(r.marker).toBeNull();
    expect(r.malformed).toBe(true);
  });
  it("unknown schemaVersion is malformed (deliberate narrowing)", () => {
    const line = '<!-- rp-report {"schemaVersion": 3, "component": "01-a", "bundle": 1, "plan": 1, "validation": "conforms", "generated": "x"} -->';
    expect(parseReport(`${line}\nbody`).malformed).toBe(true);
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

describe("parseReport rename compat (rp/pb dual-read)", () => {
  const body = '{"schemaVersion": 1, "component": "01-x", "bundle": 2, "plan": 1, "verdict": "pending", "generated": "t"}';
  it("parses the new pb-report prefix", () => {
    const r = parseReport(`<!-- pb-report ${body} -->\n# Title\n`);
    expect(r.malformed).toBe(false);
    expect(r.marker?.component).toBe("01-x");
    expect(r.body).toBe("# Title\n");
  });
  it("still parses the legacy rp-report prefix", () => {
    const r = parseReport(`<!-- rp-report ${body} -->\nB\n`);
    expect(r.malformed).toBe(false);
    expect(r.marker?.component).toBe("01-x");
  });
  it("strips either prefix", () => {
    expect(stripMarkerLine(`<!-- pb-report ${body} -->\nB\n`)).toBe("B\n");
    expect(stripMarkerLine(`<!-- rp-report ${body} -->\nB\n`)).toBe("B\n");
  });
});
