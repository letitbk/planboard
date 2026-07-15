/** A single entry in the sidebar Outline; `onSelect` performs the in-view jump. */
export interface OutlineEntry {
  id: string;
  label: string;
  level: number; // 1..3
  onSelect: () => void;
}

/** Build an outline from the rendered headings inside `root` (one entry each,
 *  index-keyed so duplicate heading text stays addressable). onSelect scrolls
 *  the captured element — the Markdown renderer adds no ids, so we hold nodes. */
export function outlineFromContainer(root: HTMLElement | null): OutlineEntry[] {
  if (!root) return [];
  const heads = Array.from(root.querySelectorAll("h1, h2, h3")) as HTMLElement[];
  return heads.map((h, i) => ({
    id: `h-${i}`,
    label: (h.textContent ?? "").trim(),
    level: Number(h.tagName[1]),
    onSelect: () => h.scrollIntoView({ behavior: "smooth", block: "start" }),
  }));
}
