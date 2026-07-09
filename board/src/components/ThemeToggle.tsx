import { useEffect, useState } from "react";
import { resolveTheme, THEME_KEY, type Theme } from "../lib/theme";

function readStored(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/** Sun/moon theme toggle (v0.11). The inline head script in index.html sets
 * the initial class pre-paint; this component owns changes after that. With
 * no stored override the board live-follows OS theme switches; an explicit
 * click wins and stops following. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );

  // Live-follow the OS only while the user has not chosen explicitly.
  useEffect(() => {
    if (readStored() !== null) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      if (readStored() !== null) return; // a toggle happened meanwhile
      const next = resolveTheme(null, e.matches);
      apply(next);
      setTheme(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const flip = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    apply(next);
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // storage unavailable — the choice still applies for this session
    }
  };

  return (
    <button
      className="rounded-md border border-stone-300 px-2 py-1.5 text-sm text-stone-600 hover:border-stone-500 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-500"
      onClick={flip}
      title="Toggle dark mode"
      aria-label="Toggle dark mode"
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
