// Last-resort render-error backstop (spec H1). A crash inside App must never
// leave a blank tab — especially around sign-off, where the action has already
// reached the session and reloading is safe.
import { Component, type ReactNode } from "react";

export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-stone-50 dark:bg-stone-800/50">
          <div className="max-w-md rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-8 text-center shadow-sm">
            <h1 className="text-lg font-semibold text-stone-800 dark:text-stone-200">
              The board hit an error
            </h1>
            <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
              Reload the page. If you just approved or requested changes, that
              action already reached your session — reloading is safe.
            </p>
            <button
              className="mt-4 rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white dark:bg-stone-200 dark:text-stone-900"
              onClick={() => location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
