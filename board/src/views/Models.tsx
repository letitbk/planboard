import { useEffect, useMemo, useState } from "react";
import Markdown from "../components/Markdown";
import { Notice } from "./Tracker";
import { actionsVisible } from "../lib/actions";
import type {
  BoardData,
  ModelProfile,
  ModelProfileRow,
  ModelProfileSaveResult,
} from "../lib/types";

// The per-stage model profile (plans/model-profile.md) as a board tab. Read-only
// in every mode; when the board is served live and the on-disk profile is
// canonical, model/effort become editable inline (mechanism stays read-only).
// Saving writes the file and regenerates the rp-* agents server-side.

const MODEL_ALIASES = ["inherit", "opus", "sonnet", "haiku", "fable"];
const EFFORT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "—" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
  { value: "max", label: "max" },
];
const CUSTOM_ID_RE = /^claude-[a-z0-9.-]+$/;
const NUDGE_STAGES = ["plan", "execute", "sync"];

const SELECT_CLS =
  "rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 px-2 py-1 text-sm";
const INPUT_CLS =
  "rounded border bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 px-2 py-1 text-sm font-mono";

interface DraftRow {
  stage: string;
  label: string;
  model: string;
  effort: string | null;
  mechanism: "nudge" | "agent";
}

function toDraft(rows: ModelProfileRow[]): DraftRow[] {
  return rows.map((r) => ({ ...r }));
}

function modelValid(m: string): boolean {
  return MODEL_ALIASES.includes(m) || CUSTOM_ID_RE.test(m);
}

function prettyStage(key: string): string {
  return key.replace(/-/g, " ");
}

function MechChip({ mechanism }: { mechanism: "nudge" | "agent" }) {
  const cls =
    mechanism === "agent"
      ? "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300"
      : "border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300";
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
      title={mechanism === "agent" ? "Delegated to a generated review agent" : "Claude suggests /model; you decide"}
    >
      {mechanism}
    </span>
  );
}

type Feedback =
  | {
      kind: "saved";
      restartNeeded: boolean;
      changedAgentStages: string[];
      nudgeChanged: boolean;
      refused: string[];
      genError?: string;
    }
  | { kind: "stale" }
  | { kind: "error"; message: string }
  | null;

export default function Models({
  data,
  modelProfile,
  onProfileChange,
}: {
  data: BoardData;
  modelProfile?: ModelProfile;
  onProfileChange: (mp: ModelProfile | undefined) => void;
}) {
  const live = data.mode === "live";
  const canEdit = actionsVisible(data) && modelProfile?.editable === true;

  const [draft, setDraft] = useState<DraftRow[]>(() => toDraft(modelProfile?.rows ?? []));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  // Reset the editable draft whenever the authoritative snapshot changes
  // (mount fetch, a save, or a 409 rebase) — keyed on the content hash so live
  // edits (which don't change the hash) are never clobbered.
  const baseHash = modelProfile?.baselineHash ?? null;
  useEffect(() => {
    setDraft(toDraft(modelProfile?.rows ?? []));
    setFeedback(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseHash]);

  // The served HTML is frozen at boot, so on mount (live) pull the current disk
  // snapshot — this is what makes a reload / second tab / external edit show
  // fresh state instead of the stale embedded payload.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    fetch("/api/model-profile")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) onProfileChange(d.modelProfile ?? undefined);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = useMemo(() => {
    if (!modelProfile) return false;
    return draft.some((r) => {
      const b = modelProfile.rows.find((x) => x.stage === r.stage);
      return !b || b.model !== r.model || b.effort !== r.effort;
    });
  }, [draft, modelProfile]);

  const allValid = draft.every((r) => modelValid(r.model));
  const canSave = canEdit && dirty && allValid && !saving;

  function setRow(stage: string, patch: Partial<DraftRow>) {
    setDraft((d) => d.map((r) => (r.stage === stage ? { ...r, ...patch } : r)));
  }

  function changedStages(): string[] {
    if (!modelProfile) return [];
    return draft
      .filter((r) => {
        const b = modelProfile.rows.find((x) => x.stage === r.stage);
        return b && (b.model !== r.model || b.effort !== r.effort);
      })
      .map((r) => r.stage);
  }

  async function post(body: unknown) {
    setSaving(true);
    setFeedback(null);
    const nudgeChanged = changedStages().some((s) => NUDGE_STAGES.includes(s));
    try {
      const res = await fetch("/api/model-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 200) {
        const result = json as ModelProfileSaveResult;
        onProfileChange(result.modelProfile);
        const refused = (result.generation?.results ?? [])
          .filter((r) => r.outcome === "refused-user" || r.outcome === "refused-unreadable")
          .map((r) => r.agent);
        setFeedback({
          kind: "saved",
          restartNeeded: !!result.restartNeeded,
          changedAgentStages: result.changedAgentStages ?? [],
          nudgeChanged,
          refused,
          genError: result.generation?.error,
        });
      } else if (res.status === 409 && json.modelProfile) {
        onProfileChange(json.modelProfile);
        setFeedback({ kind: "stale" });
      } else {
        setFeedback({ kind: "error", message: errorMessage(res.status, json) });
      }
    } catch {
      setFeedback({ kind: "error", message: "Couldn't reach the board server." });
    } finally {
      setSaving(false);
    }
  }

  const save = () =>
    post({
      boardToken: data.boardToken,
      baselineHash: modelProfile?.baselineHash,
      rows: draft.map((r) => ({ stage: r.stage, model: r.model, effort: r.effort })),
    });
  const createDefaults = () => post({ boardToken: data.boardToken, create: true });
  const revert = () => {
    setDraft(toDraft(modelProfile?.rows ?? []));
    setFeedback(null);
  };

  // ---- empty state: no profile file ----
  if (!modelProfile) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Header />
        {live ? (
          <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-700 p-6 text-center">
            <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">
              No model profile yet — every stage runs on your session model.
            </p>
            <button
              className="rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 px-3 py-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300 hover:border-emerald-500 dark:hover:border-emerald-400 disabled:opacity-40"
              disabled={saving}
              onClick={createDefaults}
            >
              {saving ? "Creating…" : "Create from defaults"}
            </button>
          </div>
        ) : (
          <p className="text-sm text-stone-500 dark:text-stone-400">
            No model profile is configured for this project.
          </p>
        )}
        <Banner feedback={feedback} />
      </div>
    );
  }

  const rows = canEdit ? draft : modelProfile.rows;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Header />
      {modelProfile.proseBefore.trim() && (
        <Markdown source={modelProfile.proseBefore} className="mb-4 text-sm" />
      )}

      {modelProfile.agentsGitignored === true && (
        <Notice text=".claude/agents/ is gitignored — regenerated review agents won't reach collaborators until that ignore rule is lifted." />
      )}
      {!modelProfile.editable && (
        <Notice
          text={
            "This profile isn't in the canonical six-row form, so it's read-only here — edit it with /research-plans:models." +
            (modelProfile.warnings.length ? " (" + modelProfile.warnings.join("; ") + ")" : "")
          }
        />
      )}

      <div className="overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 dark:border-stone-800 text-left text-[11px] uppercase tracking-wide text-stone-500 dark:text-stone-400">
              <th className="px-4 py-2 font-semibold">Stage</th>
              <th className="px-4 py-2 font-semibold">Model</th>
              <th className="px-4 py-2 font-semibold">Effort</th>
              <th className="px-4 py-2 font-semibold">Mechanism</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.stage}
                className="border-b border-stone-100 dark:border-stone-800/60 last:border-0"
              >
                <td className="px-4 py-2 text-stone-800 dark:text-stone-200">{r.label}</td>
                <td className="px-4 py-2">
                  {canEdit ? (
                    <ModelCell row={r as DraftRow} onChange={(patch) => setRow(r.stage, patch)} />
                  ) : (
                    <span className="font-mono text-stone-700 dark:text-stone-300">{r.model}</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {canEdit ? (
                    <select
                      className={SELECT_CLS}
                      value={r.effort ?? ""}
                      onChange={(e) => setRow(r.stage, { effort: e.target.value || null })}
                    >
                      {EFFORT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-stone-700 dark:text-stone-300">{r.effort ?? "—"}</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <MechChip mechanism={r.mechanism} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="mt-4 flex items-center gap-3">
          <button
            className="rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 px-3 py-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300 hover:border-emerald-500 dark:hover:border-emerald-400 disabled:opacity-40"
            disabled={!canSave}
            onClick={save}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            className="rounded-md border border-stone-300 dark:border-stone-700 px-3 py-1.5 text-sm font-medium text-stone-600 dark:text-stone-400 hover:border-stone-500 disabled:opacity-40"
            disabled={!dirty || saving}
            onClick={revert}
          >
            Revert
          </button>
          {dirty && !allValid && (
            <span className="text-xs text-red-600 dark:text-red-400">
              Fix the highlighted custom model id to save.
            </span>
          )}
        </div>
      )}

      <Banner feedback={feedback} />

      {modelProfile.proseAfter.trim() && (
        <Markdown source={modelProfile.proseAfter} className="mt-6 text-sm text-stone-600 dark:text-stone-400" />
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="mb-4">
      <h1 className="text-lg font-semibold text-stone-800 dark:text-stone-200">Model profile</h1>
      <p className="text-xs text-stone-500 dark:text-stone-400">
        Which Claude model each research-plans stage runs on.
      </p>
    </div>
  );
}

function ModelCell({
  row,
  onChange,
}: {
  row: DraftRow;
  onChange: (patch: Partial<DraftRow>) => void;
}) {
  const isAlias = MODEL_ALIASES.includes(row.model);
  const selectValue = isAlias ? row.model : "custom";
  return (
    <div className="flex items-center gap-2">
      <select
        className={SELECT_CLS}
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "custom") {
            // keep an existing custom id; otherwise start an empty (invalid) one
            onChange({ model: isAlias ? "" : row.model });
          } else {
            onChange({ model: v });
          }
        }}
      >
        {MODEL_ALIASES.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
        <option value="custom">custom claude-… id</option>
      </select>
      {selectValue === "custom" && (
        <input
          className={`${INPUT_CLS} ${
            modelValid(row.model)
              ? "border-stone-300 dark:border-stone-700"
              : "border-red-400 dark:border-red-600"
          }`}
          value={row.model}
          spellCheck={false}
          placeholder="claude-opus-4-8"
          onChange={(e) => onChange({ model: e.target.value.trim() })}
        />
      )}
    </div>
  );
}

function Banner({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  if (feedback.kind === "stale") {
    return (
      <Notice text="The profile changed on disk since you opened it — rebased to the latest. Review and Save again." />
    );
  }
  if (feedback.kind === "error") {
    return (
      <div className="mt-4 rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 px-3 py-2 text-xs text-red-800 dark:text-red-200">
        {feedback.message}
      </div>
    );
  }
  // saved
  return (
    <div className="mt-4 space-y-2">
      {feedback.nudgeChanged && (
        <div className="rounded-md border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950 px-3 py-2 text-xs text-sky-800 dark:text-sky-200">
          Saved. Nudge stages (plan, execute, sync) take effect immediately — this session already uses the new profile.
        </div>
      )}
      {feedback.restartNeeded ? (
        <div className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          Restart your Claude Code session so the regenerated review agents load
          {feedback.changedAgentStages.length
            ? ` (${feedback.changedAgentStages.map(prettyStage).join(", ")})`
            : ""}
          — agent stages are read only at session start.
        </div>
      ) : (
        !feedback.nudgeChanged && (
          <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
            Saved.
          </div>
        )
      )}
      {feedback.refused.length > 0 && (
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 px-3 py-2 text-xs text-red-800 dark:text-red-200">
          Left unchanged — a same-named agent you wrote yourself always wins: {feedback.refused.join(", ")}.
        </div>
      )}
      {feedback.genError && (
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 px-3 py-2 text-xs text-red-800 dark:text-red-200">
          Profile saved, but agent regeneration didn't finish ({feedback.genError}) — Save again or run /research-plans:models.
        </div>
      )}
    </div>
  );
}

function errorMessage(status: number, json: { error?: string }): string {
  const e = json?.error ?? "";
  if (e === "unparsable-base")
    return "The on-disk profile isn't in the canonical form — edit it with /research-plans:models.";
  if (e === "invalid") return "That model or effort value isn't allowed.";
  if (e === "bad-token") return "Session token rejected — reload the board.";
  if (status === 500) return "The server couldn't rewrite the profile safely; nothing was changed.";
  return `Save failed (${status}).`;
}
