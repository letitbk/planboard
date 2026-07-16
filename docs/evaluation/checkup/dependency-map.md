# Dependency / bleed inventory

Every reference in a shipped surface that assumes something outside a bare Claude Code install, classified **hard** (fails without it) / **fallback** (degrades gracefully) / **cosmetic** (mention only), with the guard cited and a supply-chain note per runtime fetch. Raw searches: `searches/dep-guards.txt`, `dep-refs.txt`, `supply-chain.txt`.

| Assumption | Where | Guard | Class | Note |
|---|---|---|---|---|
| `pandoc` (+ LaTeX engine) | `report.md:24` | **`command -v pandoc`**, reports which is missing, markdown is source of truth | **fallback** | Model guard. The reference implementation of a graceful degrade — no report is lost, only the PDF/DOCX. |
| `codex` CLI | `board.md:44,46` (Review-with) | **none seen** (`command -v` absent) | **hard** | A user without `codex` who clicks "Review with Codex" hits a raw shell failure. Portability finding candidate → probe in T8 (missing-tool) + dependency verdict. |
| `agy` CLI (Gemini) | `board.md:44,47` (Review-with) | **none seen** | **hard** | Same as codex — no `command -v agy` guard. |
| `npx vercel` / Node.js | `board.md:72,76,80,82` (web publish) | documented as an explicit prerequisite ("additionally needs Node.js"); first-run setup walks it | **hard, but opt-in** | Only reached on `--publish-web` and friends; the core loop is python3-only. Honestly gated. |
| `/journal-figures`, `/journal-tables` skills | `results.md:15`, `claude-md-section.md:13-14` | **"if available; otherwise …"** explicit fallback to modelsummary/kableExtra | **fallback** | Author-authored skills; the fallback path is spelled out. |
| `gh` CLI | `board.md:66,92` (deprecated `--publish` GitHub Pages) | the script enforces + reports preconditions (git repo, GitHub origin, `gh` auth) | **fallback** | Deprecated path; relays an enable-instructions message when unavailable. Other `gh ` hits are commit-suggestion prose, cosmetic. |
| `AskUserQuestion` interactive | every command's interview | headless auto-denies it (`--permission-mode dontAsk`) | **hard in headless** | The mechanism behind the headless `/init` dead-end (friction-log 1.1, baseline.md). Interactive sessions unaffected; scripted/CI is where it bites. Probe: T8 interactive vs scripted. |
| model aliases (`fable`/`opus`/`sonnet`/`haiku`) | `models.md`, model-profile | validated by `models.py`; `inherit` = no assumption | **cosmetic/fallback** | A profile naming an unavailable model is a nudge only; the platform can override. |

## Supply-chain (runtime fetches — trust posture)

| Fetch | Where | Posture |
|---|---|---|
| `raw.githubusercontent.com/letitbk/research-plans/**main**/.claude-plugin/plugin.json` and `/main/CHANGELOG.md` | `check_update.py:146,149` via `urllib.request.urlopen` (`:155`), SessionStart hook | Fetches from the **moving `main` branch**, not a pinned tag, at (rate-limited) session start over HTTPS; exits 0 on any failure; napkin/v0.12 records it as control-char/injection-hardened. A compromised `main` (or a MITM without cert pinning) could feed a crafted version/CHANGELOG string — the parse hardening is the defense. → T10 supply-chain verdict (SUP row): assess the parse hardening + whether a pinned ref would be safer. |
| `npx vercel` | `board.md` web-publish | Pulls the Vercel CLI on demand (`npx` fetches the published package). Standard npm supply-chain surface; opt-in (web publish only). → T10 SUP row. |

## Verdict summary

- **2 unguarded hard deps in a user-reachable path:** `codex` and `agy` in the board Review-with flow (no `command -v`). The likeliest real portability finding — a user without those CLIs gets a raw failure, not a graceful "not available." Fix candidate: a `command -v` preflight mirroring `report.md:24`'s pandoc guard.
- **Graceful fallbacks** (pandoc, journal-*, gh, model aliases) are the model to copy.
- **`AskUserQuestion` headless** is the confirmed `/init` dead-end mechanism.
- **Supply-chain:** the `check_update` fetch from `main` is the one standing network dependency of the *core* workflow (every session); its safety rests on parse hardening — T10 verifies it and weighs pinning.
