// Client-side feedback document assembly — the single source of the
// markdown + ```json board-feedback``` fence format. Live mode POSTs the
// assembled document; remote mode downloads it as a .txt file.
import type {
  Annotation,
  BoardData,
  DocCommentAnnotation,
  ReviewRequest,
  VerdictRequest,
} from "./types";

export interface FeedbackMeta {
  sessionId: string;
  generatedAt: string;
  mode: BoardData["mode"];
  focus: string | null;
  reviewer: string | null;
  payloadHash: string;
  shareHash: string | null;
  annotations: Annotation[];
  verdict?: VerdictRequest | null;
  reviewRequest?: ReviewRequest | null; // agent plan review (v0.9)
}

export function newSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  let hex = "";
  for (let i = 0; i < 32; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return hex;
}

export function buildFeedbackDocument(
  feedbackMarkdown: string,
  meta: FeedbackMeta,
): string {
  return (
    feedbackMarkdown.trimEnd() +
    "\n\n```json board-feedback\n" +
    JSON.stringify(meta, null, 1) +
    "\n```\n"
  );
}

export const VIEW_LABEL: Record<DocCommentAnnotation["view"], string> = {
  tracker: "Tracker",
  timeline: "Timeline",
  reviews: "Reviews",
};

export function buildFeedbackMarkdown(
  annotations: Annotation[],
  verdict: VerdictRequest | null,
  reviewRequest?: ReviewRequest | null,
): string {
  if (annotations.length === 0 && !verdict && !reviewRequest)
    return "# Board Feedback\n\nNo feedback.";
  const lines: string[] = ["# Board Feedback", ""];
  if (reviewRequest) {
    const t =
      reviewRequest.scope === "plan"
        ? `${reviewRequest.component} v${reviewRequest.version}${reviewRequest.isDraft ? " (draft)" : ""}`
        : reviewRequest.scope === "results"
          ? `${reviewRequest.component} r${reviewRequest.resultsVersion}`
          : "master plan";
    lines.push(
      `## REVIEW REQUEST: ${reviewRequest.agent} on ${t}`,
      "",
      "Run this reviewer on the target, then reopen the board with its comments seeded.",
      "",
    );
  }
  if (verdict) {
    lines.push(
      `## VERDICT: ${verdict.status.toUpperCase()} — ${verdict.component} r${verdict.resultsVersion}`,
    );
    if (verdict.comment) lines.push(`> ${verdict.comment}`);
    lines.push(
      "",
      "Apply via: results.py verdict --component " +
        `${verdict.component} --version ${verdict.resultsVersion} --status ${verdict.status}`,
      "",
    );
  }
  if (annotations.length > 0) {
    lines.push(
      `I've reviewed the board and have ${annotations.length} piece${annotations.length === 1 ? "" : "s"} of feedback:`,
      "",
    );
  }
  annotations.forEach((a, i) => {
    switch (a.type) {
      case "plan-comment": {
        const head = `${a.component} v${a.version}${a.isDraft ? " (draft)" : ""}${a.sectionHeading ? ` — ${a.sectionHeading}` : ""}`;
        lines.push(`## ${i + 1}. [${head}]${a.author ? ` (via ${a.author})` : ""}`);
        lines.push(`Feedback on: "${a.quote}"`);
        break;
      }
      case "result-comment": {
        const t =
          a.target.kind === "artifact"
            ? `artifact ${a.target.artifactId}`
            : a.target.kind === "metric"
              ? `metric ${a.target.metricLabel}`
              : "report";
        lines.push(
          `## ${i + 1}. [${a.component} r${a.resultsVersion} — ${t}]${a.author ? ` (via ${a.author})` : ""}`,
        );
        if (a.target.quote) lines.push(`Feedback on: "${a.target.quote}"`);
        break;
      }
      case "script-comment": {
        lines.push(
          `## ${i + 1}. [${a.component} r${a.resultsVersion} — ${a.script.split("/").pop()} lines ${a.lineStart}-${a.lineEnd}]`,
        );
        lines.push("```", a.excerpt, "```");
        break;
      }
      case "doc-comment": {
        const head = `${VIEW_LABEL[a.view]}${a.sectionHeading ? ` — ${a.sectionHeading}` : ""}`;
        lines.push(`## ${i + 1}. [${head}]${a.author ? ` (via ${a.author})` : ""}`);
        lines.push(`Feedback on: "${a.quote}"`);
        break;
      }
      case "general": {
        lines.push(`## ${i + 1}. [${a.view} — general]`);
        break;
      }
      default: {
        const _exhaustive: never = a;
        void _exhaustive;
      }
    }
    for (const ln of a.comment.split("\n")) lines.push(`> ${ln}`);
    lines.push("");
  });
  return lines.join("\n");
}

export function sanitizeForFilename(s: string): string {
  const cleaned = s
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || "anonymous";
}

export function feedbackFilename(
  project: string,
  reviewer: string | null,
  sessionId: string,
): string {
  const date = new Date().toISOString().slice(0, 10);
  return [
    "board-feedback",
    sanitizeForFilename(project),
    sanitizeForFilename(reviewer || "anonymous"),
    date,
    sessionId.replace(/-/g, "").slice(0, 8),
  ].join("-") + ".txt";
}
