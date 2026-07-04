// Client-side feedback document assembly — the single source of the
// markdown + ```json board-feedback``` fence format. Live mode POSTs the
// assembled document; remote mode downloads it as a .txt file.
import type { Annotation, BoardData, VerdictRequest } from "./types";

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
