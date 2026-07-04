import { useMemo } from "react";
import { Marked } from "marked";

// HTML policy: comments are stripped; any other raw HTML in artifacts is
// ESCAPED, never executed — a committed/shared board.html must be inert even
// if an artifact contains injected markup.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// breaks: true — research plans and reports are written line-oriented
// (Serves:, Success:, sign-off lines); single newlines must render as breaks.
const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }: { text: string }) {
      const t = text.trim();
      if (t.startsWith("<!--")) return "";
      return escapeHtml(text);
    },
  },
});

export default function Markdown({
  source,
  className = "",
}: {
  source: string;
  className?: string;
}) {
  const html = useMemo(() => marked.parse(source) as string, [source]);
  return (
    <div
      className={`prose-md ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
