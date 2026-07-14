// The generated report's first line is a machine-readable identity marker:
// <!-- rp-report {"schemaVersion": 1, "component": "<NN-slug>", "bundle": N,
//      "plan": N|null, "verdict": "accepted|changes-requested|pending",
//      "generated": "<ISO>"} -->
// The board ALWAYS strips the first line before rendering when it starts with
// the prefix — Marked treats an unclosed comment as swallowing the whole
// document, so rendering must never see a malformed marker.
import { coerceModelUsage } from "./modelUsage";
import type { ModelUsage } from "./types";

export interface ReportMarker {
  schemaVersion: number;
  component: string;
  bundle: number;
  plan: number | null;
  verdict: "accepted" | "changes-requested" | "pending";
  generated: string;
  modelUsage?: ModelUsage; // which model generated the report (reported only)
}

export interface ParsedReport {
  marker: ReportMarker | null;
  malformed: boolean; // first line claimed to be a marker but did not validate
  body: string; // always safe to render
}

export const MARKER_PREFIX = "<!-- rp-report";
export const REPORT_DOCKEY_RE = /^plans\/reports\/(.+)-r(\d+)-report\.md$/;

const VERDICTS = new Set(["accepted", "changes-requested", "pending"]);

export function parseReport(content: string): ParsedReport {
  const nl = content.indexOf("\n");
  const first = nl === -1 ? content : content.slice(0, nl);
  if (!first.trimStart().startsWith(MARKER_PREFIX)) {
    return { marker: null, malformed: false, body: content };
  }
  const body = nl === -1 ? "" : content.slice(nl + 1);
  const m = /^<!--\s*rp-report\s+(\{.*\})\s*-->\s*$/.exec(first.trim());
  if (!m) return { marker: null, malformed: true, body };
  try {
    const j = JSON.parse(m[1]) as Record<string, unknown>;
    if (
      typeof j.schemaVersion === "number" &&
      typeof j.component === "string" &&
      typeof j.bundle === "number" &&
      (typeof j.plan === "number" || j.plan === null) &&
      typeof j.verdict === "string" && VERDICTS.has(j.verdict) &&
      typeof j.generated === "string"
    ) {
      return {
        marker: {
          schemaVersion: j.schemaVersion, component: j.component,
          bundle: j.bundle, plan: j.plan as number | null,
          verdict: j.verdict as ReportMarker["verdict"], generated: j.generated,
          modelUsage: coerceModelUsage(j.modelUsage) ?? undefined,
        },
        malformed: false, body,
      };
    }
  } catch { /* fall through to malformed */ }
  return { marker: null, malformed: true, body };
}

export function stripMarkerLine(content: string): string {
  return parseReport(content).body;
}
