// Contract parsers for the research-plans artifact formats.
// The formats are defined by skills/managing-research-plans/templates/*.md;
// parse.test.ts uses those templates (and real generated artifacts) as fixtures,
// so a template change that breaks parsing fails the test suite.

import type {
  ParsedExecutionPlan,
  ParsedLogEntry,
  ParsedMasterPlan,
  ResearchQuestion,
  Scorecard,
  TrackerRow,
  TrackerStatus,
} from "./types";

const STATUSES: TrackerStatus[] = [
  "not started",
  "planned",
  "in progress",
  "done",
  "done (verified)",
  "dropped",
];

function sectionBody(md: string, heading: string): string | null {
  // Returns the text between `## <heading>` and the next `## ` (or EOF).
  const re = new RegExp(`^## ${escapeRe(heading)}[ \\t]*$`, "m");
  const m = re.exec(md);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = md.slice(start);
  const next = rest.search(/^## /m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseTableRows(block: string): string[][] {
  // GFM table rows -> array of cell arrays, skipping header + divider rows.
  const lines = block.split("\n").filter((l) => l.trim().startsWith("|"));
  const rows: string[][] = [];
  for (const line of lines) {
    const cells = line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // divider
    rows.push(cells);
  }
  return rows.slice(1); // drop header row
}

/** Splits the Research questions subsection out of the Project context body. */
function extractResearchQuestions(contextBody: string): {
  contextMd: string;
  researchQuestions: ResearchQuestion[];
} {
  const m = /^### Research questions[ \t]*$/m.exec(contextBody);
  if (!m) return { contextMd: contextBody, researchQuestions: [] };
  const start = m.index;
  const afterHeading = start + m[0].length;
  const rest = contextBody.slice(afterHeading);
  const next = rest.search(/^### /m);
  const block = next === -1 ? rest : rest.slice(0, next);
  const end = afterHeading + (next === -1 ? rest.length : next);

  const researchQuestions: ResearchQuestion[] = [];
  const lineRe = /^\s*(?:\d+[.)]\s*)?RQ(\d+)\s*[:.]?\s*(.+)$/gm;
  for (const lm of block.matchAll(lineRe)) {
    researchQuestions.push({ num: parseInt(lm[1], 10), text: lm[2].trim() });
  }
  const contextMd = (contextBody.slice(0, start) + contextBody.slice(end)).trim();
  return { contextMd, researchQuestions };
}

export function parseMasterPlan(raw: string): ParsedMasterPlan {
  const fail: ParsedMasterPlan = {
    ok: false,
    title: "Master Plan",
    lastUpdated: null,
    contextMd: "",
    researchQuestions: [],
    components: [],
    sequencingMd: null,
    raw,
  };
  try {
    const title = /^# (.+)$/m.exec(raw)?.[1]?.trim() ?? "Master Plan";
    const lastUpdated =
      /^Last updated:\s*(.+)$/m.exec(raw)?.[1]?.trim() ?? null;
    const contextBody = sectionBody(raw, "Project context") ?? "";
    const { contextMd, researchQuestions } =
      extractResearchQuestions(contextBody);
    const componentsBlock = sectionBody(raw, "Components");
    if (componentsBlock === null) return fail;
    const components: TrackerRow[] = parseTableRows(componentsBlock).map(
      (cells) => {
        const [
          num = "",
          component = "",
          statusRaw = "",
          planLink = "",
          notes = "",
          serves = "",
        ] = cells;
        const statusClean = statusRaw.replace(/`/g, "").trim().toLowerCase();
        const status: TrackerStatus = (STATUSES as string[]).includes(
          statusClean,
        )
          ? (statusClean as TrackerStatus)
          : "unknown";
        return { num, component, status, planLink, notes, serves };
      },
    );
    const sequencingMd = sectionBody(raw, "Sequencing notes");
    return {
      ok: true,
      title,
      lastUpdated,
      contextMd,
      researchQuestions,
      components,
      sequencingMd,
      raw,
    };
  } catch {
    return fail;
  }
}

/**
 * Normalizes a Serves value. `RQ` tokens are extracted case-insensitively and
 * canonicalized; an em/en dash or hyphen alone marks deliberate infrastructure.
 */
export function parseServes(s: string | null | undefined): {
  tokens: string[];
  isInfra: boolean;
  isEmpty: boolean;
} {
  const t = (s ?? "").replace(/`/g, "").trim();
  if (!t) return { tokens: [], isInfra: false, isEmpty: true };
  if (/^[—–-]$/.test(t)) return { tokens: [], isInfra: true, isEmpty: false };
  const tokens = [...t.matchAll(/rq\s*(\d+)/gi)].map((m) => `RQ${m[1]}`);
  return { tokens: [...new Set(tokens)], isInfra: false, isEmpty: tokens.length === 0 };
}

export function parseDecisionLog(raw: string): ParsedLogEntry[] {
  const entries: ParsedLogEntry[] = [];
  const re = /^## (\d{4}-\d{2}-\d{2} \d{2}:\d{2})([^\n]*)$/gm;
  const matches = [...raw.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : raw.length;
    const body = raw.slice(start, end).trim();
    const fields: { label: string; text: string }[] = [];
    const fieldRe = /\*\*([^*]+):\*\*\s*([\s\S]*?)(?=\n\*\*[^*]+:\*\*|$)/g;
    for (const fm of body.matchAll(fieldRe)) {
      fields.push({ label: fm[1].trim(), text: fm[2].trim() });
    }
    entries.push({
      timestamp: m[1],
      lateCaptured: /late-captured/i.test(m[2]),
      fields,
      raw: body,
    });
  }
  return entries;
}

const EXEC_SECTIONS = [
  "Goal and success criteria",
  "Context",
  "Scope decisions",
  "Approach",
  "Build steps",
  "Verification",
  "Out of scope",
  "Files to reuse",
];

export function parseExecutionPlan(raw: string): ParsedExecutionPlan {
  const fail: ParsedExecutionPlan = {
    ok: false,
    title: "Execution Plan",
    version: null,
    componentSlug: null,
    date: null,
    supersedes: null,
    goal: null,
    serves: null,
    sections: [],
    signedOff: null,
    raw,
  };
  try {
    const titleM = /^# (.+)$/m.exec(raw);
    const title = titleM?.[1]?.trim() ?? "Execution Plan";
    const version = (() => {
      const m = /Execution Plan v(\d+)/i.exec(title);
      return m ? parseInt(m[1], 10) : null;
    })();
    const componentSlug =
      /^Component:\s*`?([^`·\n]+)`?/m.exec(raw)?.[1]?.trim() ?? null;
    const date = /(?:^|·\s*)Date:\s*([0-9-]+)/m.exec(raw)?.[1] ?? null;
    const supersedes =
      /^Supersedes:\s*(.+)$/m.exec(raw)?.[1]?.trim() ?? null;
    const signedOff =
      /^Signed off:\s*(.+)$/m.exec(raw)?.[1]?.trim() ?? null;

    const sections: { heading: string; content: string }[] = [];
    for (const h of EXEC_SECTIONS) {
      const body = sectionBody(raw, h);
      if (body !== null) sections.push({ heading: h, content: body });
    }
    if (sections.length === 0) return fail;
    const goal = sectionBody(raw, "Goal and success criteria");
    const serves = goal
      ? (/^Serves:\s*(.+)$/m.exec(goal)?.[1]?.trim() ?? null)
      : null;
    return {
      ok: true,
      title,
      version,
      componentSlug,
      date,
      supersedes,
      goal,
      serves,
      sections,
      signedOff,
      raw,
    };
  } catch {
    return fail;
  }
}

const THRESHOLD_VERDICTS = ["pass", "undetermined", "fail"];

export function parseScorecard(raw: string): Scorecard | null {
  const m = /```json board-scorecard\s*\n([\s\S]*?)\n```/.exec(raw);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) {
      return null;
    }
    // schemaVersion >= 2 REQUIRES a valid threshold block; a v2 scorecard with
    // a missing/invalid threshold is malformed and must not silently render as
    // v1 (which would show a grade the review may never have issued).
    if ((parsed.schemaVersion ?? 1) >= 2) {
      const t = parsed.threshold;
      const valid =
        t &&
        typeof t === "object" &&
        THRESHOLD_VERDICTS.includes(t.verdict) &&
        Array.isArray(t.checks);
      if (!valid) return null;
    }
    return parsed as Scorecard;
  } catch {
    return null;
  }
}

// FNV-1a over sorted (path, content) pairs — stable across regenerations of the
// same artifact state; excludes generatedAt/git so pending local comments are
// not orphaned when the board is regenerated. board.py does not need to match
// this; it only echoes the client-sent hash back in the feedback document.
export function payloadContentHash(
  files: { path: string; content: string }[],
): string {
  const joined = files
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f) => `${f.path}\n${f.content}`)
    .join("\n \n");
  let h = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function allFiles(data: {
  files: {
    masterPlan: { path: string; content: string };
    decisionLog: { path: string; content: string };
    executionPlans: {
      versions: { path: string; content: string }[];
      draft?: { path: string; content: string };
      results?: {
        manifestRaw: { path: string; content: string };
        report: { path: string; content: string } | null;
        verdictRaw: { path: string; content: string } | null;
        scripts: { path: string; content: string }[];
      }[];
    }[];
    reviews: { path: string; content: string }[];
  };
}): { path: string; content: string }[] {
  const out = [data.files.masterPlan, data.files.decisionLog];
  for (const g of data.files.executionPlans) {
    out.push(...g.versions);
    if (g.draft) out.push(g.draft);
    for (const b of g.results ?? []) {
      out.push(b.manifestRaw);
      if (b.report) out.push(b.report);
      if (b.verdictRaw) out.push(b.verdictRaw);
      out.push(...b.scripts);
    }
  }
  out.push(...data.files.reviews);
  return out;
}
