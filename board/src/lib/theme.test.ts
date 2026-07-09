import { describe, expect, it } from "vitest";
import { resolveTheme } from "./theme";

describe("resolveTheme", () => {
  it("a stored explicit choice wins over the system", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("no stored value follows the system", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });

  it("garbage stored values fall back to the system", () => {
    expect(resolveTheme("solarized", true)).toBe("dark");
    expect(resolveTheme("", false)).toBe("light");
  });
});
