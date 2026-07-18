import type { TrailerKind } from "./types";

const TRAILER_SIGNED_RE = /^Signed off: .+$/;
const TRAILER_AMEND_RE = /^Amendment recorded, \d{4}-\d{2}-\d{2}$/;

export interface TrailerResult {
  kind: TrailerKind;
  line: string | null;
  violations: string[];
}

export function parseTrailer(text: string): TrailerResult {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let idx = lines.length - 1;
  while (idx >= 0 && !lines[idx].trim()) idx -= 1;
  const final = idx >= 0 ? lines[idx].trim() : "";
  let kind: TrailerKind = "none";
  if (TRAILER_SIGNED_RE.test(final)) {
    kind = "signed";
  } else if (TRAILER_AMEND_RE.test(final)) {
    kind = "amendment";
  }
  const violations: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const value = lines[i].trim();
    if (i === idx && kind !== "none") continue;
    if (TRAILER_SIGNED_RE.test(value) || TRAILER_AMEND_RE.test(value)) {
      violations.push(`line ${i + 1}: ${value}`);
    }
  }
  if (violations.length > 0) {
    return {
      kind: "malformed",
      line: kind !== "none" ? final : null,
      violations,
    };
  }
  return { kind, line: kind !== "none" ? final : null, violations: [] };
}
