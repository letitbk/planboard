import type { ResultArtifact, ResultsBundle } from "../lib/types";
import { artifactDisplay, type ArtifactLink } from "../lib/artifactDisplay";
import SafeTable from "./SafeTable";

/** One artifact (figure / typeset table / download), reused inside a finding
 * block and in the "Additional evidence" section. All branch logic lives in
 * lib/artifactDisplay (pure, unit-tested); this component only renders the
 * decision. Figures AND table renders zoom via onZoom; the "produced by"
 * button toggles the shared ScriptViewer drawer via openScript. */
export default function ArtifactCard({
  art,
  bundle,
  openScript,
  setOpenScript,
  onZoom,
}: {
  art: ResultArtifact;
  bundle: ResultsBundle;
  openScript: string | null;
  setOpenScript: (s: string | null) => void;
  onZoom?: (url: string, title: string) => void;
}) {
  const d = artifactDisplay(art, bundle.assets);
  const scriptFile = art.producedBy
    ? bundle.scripts.find((s) => s.path.endsWith("/" + art.producedBy!.script))
    : null;

  const zoomImg = (url: string) => (
    <img
      src={url}
      alt={art.title}
      role={onZoom ? "button" : undefined}
      tabIndex={onZoom ? 0 : undefined}
      onClick={onZoom ? () => onZoom(url, art.title) : undefined}
      onKeyDown={
        onZoom
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onZoom(url, art.title);
              }
            }
          : undefined
      }
      className={`max-h-80 w-full rounded border border-stone-100 dark:border-stone-800 object-contain${
        onZoom ? " cursor-zoom-in" : ""
      }`}
    />
  );

  const linksRow = (links: ArtifactLink[]) =>
    links.length > 0 ? (
      <div className="mt-1.5 flex flex-wrap gap-3">
        {links.map((l) => (
          <a
            key={l.label}
            href={l.url}
            download={l.download}
            className="text-[11px] font-medium text-blue-700 dark:text-blue-400 underline"
          >
            {l.label}
          </a>
        ))}
      </div>
    ) : null;

  return (
    <div
      data-annot-scope={`artifact:${art.id}`}
      data-annot-section={`artifact ${art.id}: ${art.title}`}
      className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4"
    >
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-sm font-semibold text-stone-800 dark:text-stone-200">{art.title}</span>
        <span className="rounded bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 text-[10px] uppercase text-stone-500">
          {art.kind}
        </span>
      </div>
      {d.mode === "oversized" ? (
        <div className="rounded border border-dashed border-stone-300 dark:border-stone-600 p-6 text-center text-xs text-stone-500">
          Too large to snapshot ({Math.round(art.source.bytes / 1024 / 1024)} MB)
          — original at <code>{art.source.path}</code>
        </div>
      ) : d.mode === "table-image" ? (
        <>
          {zoomImg(d.url)}
          {linksRow(d.links)}
        </>
      ) : d.mode === "table-inline" ? (
        <>
          <SafeTable content={art.inlineText!} kind={d.kind} />
          {linksRow(d.links)}
        </>
      ) : d.mode === "figure" ? (
        zoomImg(d.url)
      ) : d.mode === "card" ? (
        <>
          {d.url && (
            <a
              href={d.url}
              download={d.basename ?? undefined}
              className="text-xs font-medium text-blue-700 dark:text-blue-400 underline"
            >
              open {d.basename}
            </a>
          )}
          {linksRow(d.links)}
        </>
      ) : (
        <div className="text-xs text-stone-400 dark:text-stone-500">no snapshot file</div>
      )}
      {art.caption && (
        <p className="mt-2 text-xs text-stone-500">{art.caption}</p>
      )}
      {art.producedBy && (
        <button
          className="mt-2 text-[11px] font-medium text-blue-700 dark:text-blue-400 underline disabled:text-stone-400 disabled:no-underline"
          disabled={!scriptFile}
          onClick={() =>
            setOpenScript(
              openScript === scriptFile?.path ? null : (scriptFile?.path ?? null),
            )
          }
        >
          ▸ produced by {art.producedBy.sourcePath}
          {scriptFile ? " (view snapshot)" : " (snapshot missing)"}
        </button>
      )}
    </div>
  );
}
