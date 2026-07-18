import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTrailer } from "./trailer";

const FIXTURES = join(__dirname, "__fixtures__", "trailer");

describe("shared trailer grammar fixtures", () => {
  it("matches the Python fixture contract", () => {
    const expected = JSON.parse(
      readFileSync(join(FIXTURES, "expectations.json"), "utf-8"),
    ) as Record<string, { kind: string; violations: number }>;
    expect(Object.keys(expected).length).toBeGreaterThanOrEqual(8);
    for (const [name, contract] of Object.entries(expected)) {
      const got = parseTrailer(
        readFileSync(join(FIXTURES, `${name}.md`), "utf-8"),
      );
      expect(got.kind, name).toBe(contract.kind);
      expect(got.violations.length, name).toBe(contract.violations);
    }
  });
});
