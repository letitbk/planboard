// Scroll-spy for the sidebar outline (spec R2). Observes only the elements the
// caller's selector names (PlanReader: [data-outline-id] section headings —
// H3s and the H1 must never clear the active state; Reports: all headings).
// Returns the ELEMENT; callers map it to their outline-entry id. Resets on
// dependency change so a new document never inherits the old highlight.
// No-ops when IntersectionObserver is unavailable (exported file:// safety).
import { useEffect, useState, type RefObject } from "react";

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useScrollSpy(
  ref: RefObject<HTMLElement | null>,
  selector: string,
  deps: unknown[],
): Element | null {
  const [active, setActive] = useState<Element | null>(null);
  useEffect(() => {
    setActive(null);
    const host = ref.current;
    if (!host || typeof IntersectionObserver === "undefined") return;
    const headings = Array.from(host.querySelectorAll(selector));
    if (headings.length === 0) return;
    const seen = new Map<Element, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          seen.set(e.target, e.isIntersecting || e.boundingClientRect.top < 0);
        const passed = headings.filter((h) => seen.get(h));
        setActive(passed.length ? passed[passed.length - 1] : null);
      },
      { rootMargin: "0px 0px -70% 0px" },
    );
    headings.forEach((h) => io.observe(h));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return active;
}
