import { useMemo } from "react";
import Markdown from "./Markdown";

const ALLOWED_TAGS = new Set([
  "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD",
  "CAPTION", "COL", "COLGROUP",
]);
const ALLOWED_ATTRS = new Set(["colspan", "rowspan", "align"]);

/** Whitelist-sanitize table HTML: unknown tags are dropped (their text is
 * kept), attributes outside the whitelist are stripped. Markdown.tsx's
 * escape-all policy stays global; this is the ONLY sanctioned raw-HTML path,
 * and it renders tables only. */
export function sanitizeTableHtml(src: string): string {
  const doc = new DOMParser().parseFromString(src, "text/html");
  const table = doc.querySelector("table");
  if (!table) return "";
  const walk = (el: Element): void => {
    for (const child of [...el.children]) {
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(doc.createTextNode(child.textContent ?? ""));
        continue;
      }
      for (const attr of [...child.attributes]) {
        if (!ALLOWED_ATTRS.has(attr.name.toLowerCase())) {
          child.removeAttribute(attr.name);
        }
      }
      walk(child);
    }
  };
  for (const attr of [...table.attributes]) table.removeAttribute(attr.name);
  walk(table);
  return table.outerHTML;
}

function csvToMarkdown(csv: string): string {
  const rows = csv.trim().split("\n").map((l) => l.split(","));
  if (rows.length === 0) return "";
  const md = [
    `| ${rows[0].join(" | ")} |`,
    `| ${rows[0].map(() => "---").join(" | ")} |`,
    ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`),
  ];
  return md.join("\n");
}

export default function SafeTable({
  content,
  kind,
}: {
  content: string;
  kind: "html" | "md" | "csv";
}) {
  const html = useMemo(
    () => (kind === "html" ? sanitizeTableHtml(content) : ""),
    [content, kind],
  );
  if (kind === "html") {
    if (!html) {
      return (
        <pre className="overflow-x-auto rounded bg-stone-50 p-2 text-xs">{content}</pre>
      );
    }
    return (
      <div
        className="prose-md overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  const md = kind === "csv" ? csvToMarkdown(content) : content;
  return (
    <div className="overflow-x-auto">
      <Markdown source={md} className="text-sm" />
    </div>
  );
}
