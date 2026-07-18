import { describe, expect, it } from "vitest";
import { coerceOutputScore } from "./outputScore";

const good = {
  schemaVersion: 1,
  channels: [
    { id: "fidelity", name: "Fidelity", score: 3, basis: "all 2 steps followed" },
    { id: "attainment", name: "Attainment", score: 2, basis: "1 criteria partial, first: 'c0'" },
    { id: "integrity", name: "Integrity", score: 3, basis: "all 4 checks pass" },
  ],
  profile: "F3·A2·I3",
  total: 8,
  max: 9,
  computedAt: "2026-07-18 12:00",
};

describe("coerceOutputScore", () => {
  it("accepts a well-formed block", () => {
    expect(coerceOutputScore(good)).not.toBeNull();
  });
  it("accepts null channels with null total and – profile", () => {
    const s = {
      ...good,
      channels: [
        { id: "fidelity", name: "Fidelity", score: null, basis: "no plan validation (retrofit)" },
        { id: "attainment", name: "Attainment", score: null, basis: "no plan validation (retrofit)" },
        { id: "integrity", name: "Integrity", score: 3, basis: "all 4 checks pass" },
      ],
      profile: "F–·A–·I3",
      total: null,
    };
    expect(coerceOutputScore(s)).not.toBeNull();
  });
  it.each([
    ["missing", null],
    ["non-object", 7],
    ["wrong channel count", { ...good, channels: good.channels.slice(0, 2) }],
    ["wrong channel order", { ...good, channels: [good.channels[1], good.channels[0], good.channels[2]] }],
    ["out-of-range score", { ...good, channels: [{ ...good.channels[0], score: 4 }, good.channels[1], good.channels[2]] }],
    ["non-integer score", { ...good, channels: [{ ...good.channels[0], score: 2.5 }, good.channels[1], good.channels[2]] }],
    ["inconsistent total", { ...good, total: 9 }],
    ["non-null total with null channel", { ...good, channels: [{ ...good.channels[0], score: null }, good.channels[1], good.channels[2]], profile: "F–·A2·I3" }],
    ["wrong max", { ...good, max: 15 }],
    ["profile mismatch", { ...good, profile: "F3·A3·I3" }],
    ["wrong schemaVersion", { ...good, schemaVersion: 2 }],
    ["wrong channel name", { ...good, channels: [{ ...good.channels[0], name: "F" }, good.channels[1], good.channels[2]] }],
    ["non-string basis", { ...good, channels: [{ ...good.channels[0], basis: 7 }, good.channels[1], good.channels[2]] }],
    ["non-string computedAt", { ...good, computedAt: 42 }],
  ])("rejects %s", (_name, raw) => {
    expect(coerceOutputScore(raw)).toBeNull();
  });
});
