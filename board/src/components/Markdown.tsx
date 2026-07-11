import { useMemo } from "react";
import { Marked } from "marked";
import { unwrapSoftBreaks } from "../lib/markdownText";

// HTML policy: comments are stripped; any other raw HTML in artifacts is
// ESCAPED, never executed — a committed/shared board.html must be inert even
// if an artifact contains injected markup.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

// breaks: true — research plans and reports are written line-oriented
// (Serves:, Success:, sign-off lines); single newlines must render as breaks.
// Hard-wrapped paragraphs are soft-unwrapped BEFORE parsing (v0.11), so
// sentence continuations flow to the container width while the intentional
// line-oriented breaks above survive. See lib/markdownText.ts.
function makeMarked(assets?: Record<string, string>) {
  return new Marked({
    gfm: true,
    breaks: true,
    renderer: {
      html({ text }: { text: string }) {
        const t = text.trim();
        if (t.startsWith("<!--")) return "";
        return escapeHtml(text);
      },
      // Reports embed figures by repo-relative path; resolve ONLY against the
      // bundle's basename-keyed assets (same contract as artifactDisplay's
      // assetUrl). Anything unresolved renders as text — the board never
      // fetches an image URL the payload did not provide.
      ...(assets
        ? {
            image({ href, title, text }: { href: string; title: string | null; text: string }) {
              const resolved = assets[href.split("/").pop() ?? ""];
              if (!resolved) return escapeHtml(text || href);
              return `<img src="${escapeAttr(resolved)}" alt="${escapeAttr(text)}"${
                title ? ` title="${escapeAttr(title)}"` : ""
              } class="max-w-full" loading="lazy">`;
            },
          }
        : {}),
    },
  });
}

const defaultMarked = makeMarked();

export default function Markdown({
  source,
  className = "",
  assets,
}: {
  source: string;
  className?: string;
  assets?: Record<string, string>;
}) {
  const html = useMemo(() => {
    const m = assets ? makeMarked(assets) : defaultMarked;
    return m.parse(unwrapSoftBreaks(source)) as string;
  }, [source, assets]);
  return (
    <div
      className={`prose-md ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
