// Layout hooks for the docked feedback panel (control surface, spec §2).
import { useEffect, useState, type RefObject } from "react";

/** Live pixel height of the sticky header (banners included) via
 * ResizeObserver — a fixed offset would slide the docked panel under the
 * header whenever a gate/remote/hosted banner changes its height. */
export function useHeaderOffset(ref: RefObject<HTMLElement | null>): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setOffset(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return offset;
}

/** One mounted panel, form chosen in JS: CSS-only dual-mounting would
 * duplicate every data-card-id and break click-sync scroll targets. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
