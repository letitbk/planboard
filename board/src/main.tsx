import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import type { BoardData } from "./lib/types";
import { migrateLegacyStorage } from "./lib/storageMigration";
import "./index.css";

function readSlot(): BoardData | null {
  const el = document.getElementById("board-data");
  const txt = el?.textContent?.trim();
  if (!txt) return null;
  try {
    const parsed = JSON.parse(txt);
    if (parsed && typeof parsed === "object" && parsed.schemaVersion >= 1) {
      return parsed as BoardData;
    }
  } catch {
    // fall through to null
  }
  return null;
}

function NoData() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 dark:bg-stone-800/50">
      <div className="max-w-md rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-stone-800 dark:text-stone-200">
          Planboard
        </h1>
        <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
          No project data is injected into this page. This file is a template.
          Generate a real board from your research project with:
        </p>
        <pre className="mt-3 rounded bg-stone-100 dark:bg-stone-800 p-2 text-left text-xs">
          /planboard:board
        </pre>
      </div>
    </div>
  );
}

let data = readSlot();
if (!data && import.meta.env.DEV) {
  data = (await import("./dev-data")).devData;
}

// Migrate pre-rename localStorage keys (rp-* -> pb-*) once, before React reads
// any of them (theme already read pre-paint in index.html with an rp- fallback).
try {
  migrateLegacyStorage(localStorage);
} catch {
  // no localStorage (file:// exports, SSR) — skip
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>{data ? <App data={data} /> : <NoData />}</ErrorBoundary>
  </StrictMode>,
);
