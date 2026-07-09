// Soft-unwrap for hard-wrapped markdown (v0.11). The shared renderer keeps
// breaks:true so line-oriented lines (Serves:, Signed off:, RQ1:) stay on
// their own lines — but hard-wrapped paragraphs must flow to the container
// width instead of breaking mid-sentence at every source newline. We join a
// line onto the previous one only when it clearly continues the sentence:
// it starts with a lowercase letter or an opening parenthesis. Everything
// else — labels, new sentences, lists, tables, headings, code — keeps its
// break. Intent can never be inferred perfectly; this rule is conservative.

const FENCE_RE = /^\s*(```|~~~)/;
const NO_JOIN_FROM_RE =
  /(^\s*\|)|(^#)|(^\s{4,})|(^(-{3,}|\*{3,}|_{3,})\s*$)/;
const CONTINUATION_RE = /^[a-z(]/;

export function unwrapSoftBreaks(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inFence = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      out.push(line);
      i += 1;
      continue;
    }
    if (inFence) {
      out.push(line);
      i += 1;
      continue;
    }
    let cur = line;
    while (i + 1 < lines.length) {
      const next = lines[i + 1];
      if (
        cur === "" ||
        cur.endsWith("  ") ||
        cur.endsWith("\\") ||
        NO_JOIN_FROM_RE.test(cur) ||
        FENCE_RE.test(next) ||
        !CONTINUATION_RE.test(next)
      ) {
        break;
      }
      cur = cur + " " + next;
      i += 1;
    }
    out.push(cur);
    i += 1;
  }
  return out.join("\n");
}
