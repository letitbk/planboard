import { modelChipText } from "../lib/modelUsage";
import type { ModelUsage } from "../lib/types";

// A small provenance pill: which model a plan / result / report / review used.
// prescribed (from the profile) is the main token; a self-reported override is
// appended as a muted "reported …" (or a custom label like "captured by").
// Renders nothing when there is no usable provenance (old artifacts).
export default function ModelChip({
  usage,
  reportedLabel,
  className = "",
}: {
  usage: ModelUsage | null | undefined;
  reportedLabel?: string;
  className?: string;
}) {
  if (!usage) return null;
  const text = modelChipText(usage, reportedLabel);
  if (!text) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/50 px-2 py-0.5 text-[10px] font-medium text-stone-600 dark:text-stone-400 ${className}`}
      title="Model provenance — prescribed comes from the profile; reported is self-attested by the session, not verified runtime truth."
    >
      <span className="font-mono">{text.main}</span>
      {text.sub && <span className="text-stone-400 dark:text-stone-500">· {text.sub}</span>}
    </span>
  );
}
