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

export default function SafeTable({
  content,
  kind,
}: {
  content: string;
  kind: "html" | "md";
}) {
  const html = useMemo(
    () => (kind === "html" ? sanitizeTableHtml(content) : ""),
    [content, kind],
  );
  if (kind === "html") {
    if (!html) {
      return (
        <pre className="overflow-x-auto rounded bg-stone-50 dark:bg-stone-800/50 p-2 text-xs">{content}</pre>
      );
    }
    return (
      <div
        className="prose-md overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <Markdown source={content} className="text-sm" />
    </div>
  );
}
