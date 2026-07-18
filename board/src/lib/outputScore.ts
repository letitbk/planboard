import type { OutputScore, OutputScoreChannelId } from "./types";

const CHANNEL_IDS: OutputScoreChannelId[] = ["fidelity", "attainment", "integrity"];
const CHANNEL_NAMES = ["Fidelity", "Attainment", "Integrity"];
const LETTERS = ["F", "A", "I"];

/** Runtime guard for the sealed manifest.score block. Returns the typed block
 * only when it matches what results.py seals — schemaVersion 1, exactly three
 * ordered/named channels with scores null|0–3, string basis/computedAt, and a
 * consistent profile/total/max — anything else is treated as absent. */
export function coerceOutputScore(raw: unknown): OutputScore | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (s.schemaVersion !== 1) return null;
  if (s.computedAt !== undefined && typeof s.computedAt !== "string") return null;
  const ch = s.channels;
  if (!Array.isArray(ch) || ch.length !== 3) return null;
  const scores: (number | null)[] = [];
  for (let i = 0; i < 3; i++) {
    const c = ch[i] as Record<string, unknown> | null;
    if (!c || typeof c !== "object" || c.id !== CHANNEL_IDS[i]) return null;
    if (c.name !== CHANNEL_NAMES[i]) return null;
    if (c.basis !== undefined && typeof c.basis !== "string") return null;
    const sc = c.score;
    if (sc === null) {
      scores.push(null);
    } else if (typeof sc === "number" && Number.isInteger(sc) && sc >= 0 && sc <= 3) {
      scores.push(sc);
    } else {
      return null;
    }
  }
  const allInt = scores.every((v): v is number => typeof v === "number");
  if (allInt) {
    if (s.total !== scores.reduce((x, y) => x + y, 0)) return null;
  } else if (s.total !== null) {
    return null;
  }
  if (s.max !== 9) return null;
  const expectedProfile = scores
    .map((v, i) => LETTERS[i] + (v === null ? "–" : String(v)))
    .join("·");
  if (s.profile !== expectedProfile) return null;
  return raw as OutputScore;
}
