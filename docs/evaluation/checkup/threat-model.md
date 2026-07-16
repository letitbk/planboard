# Threat model

Authored **before** the adversarial security pass (Task 10) so the pass selects its cases from here rather than producing the model as a by-product. Each boundary carries a named adversarial case mapped to a scenario row; Task 10 fills the verdict (`holds` / `regressed` / `never-covered`, labeled `static-contract` or `runtime-verified`).

## Assets

| Asset | Where | Why it matters |
|---|---|---|
| Plans, decision log, results bundles, verdicts | `plans/` (repo) | The integrity record the whole workflow exists to protect; immutability is enforced by the sign-off gate + write-once verdicts. |
| Hosted collaborator comments | Vercel private Blob | Untrusted input; the confused-deputy source. |
| Per-boot board token | `board.py` served payload (`boardToken`) | Authorizes local mutation routes for the current board process only. |
| Publish token | `board.py` (`publishToken`) | Authorizes the local `/publish-web` route. |
| `BOARD_PASSWORD` | Vercel env (Production) | The collaborator access gate. |
| `BOARD_SESSION_SECRET` | Vercel env (auth.ts:69) | Signs the 30-day session cookie; rotating it force-logs-out everyone. |
| `BOARD_PULL_KEY` | Vercel env + `${CLAUDE_PLUGIN_DATA}/web/` (auth.ts:74) | Authenticates `--pull`/`--web-connect`; lives outside the repo. |
| `BOARD_URL` | Vercel env | Non-secret; recovery mechanism for `--web-connect`. |
| Private Blob store | Vercel | Holds comments; must not be world-readable by URL. |

## Actors

- **Researcher** — full authority; signs plans, issues verdicts, runs the board.
- **Honest collaborator** — comment-only; sees a shared/hosted board, sends feedback.
- **Malicious collaborator** — crafts comment field values (`quote`, `comment`, `author`, …) attempting to forge a researcher action through the feedback channel. The primary web adversary.
- **Local same-machine attacker** — a **non-root local user** on the researcher's machine who **can** connect to `127.0.0.1` ports and read world-readable repo files, but **cannot** read the researcher's process environment/memory or write files owned by the researcher's uid. Bounds what the local mutation surface (S10) must defend.
- **Artifact-embedded code** — active content (`.html`/`.svg`, `javascript:` links) inside a results artifact that the board serves; attempts to run under the board origin and reach local routes.
- **Supply-chain position** — whoever controls what `check_update.py` fetches from GitHub `main`, or the `npx vercel` package resolution.

## Trust boundaries and adversarial cases

| # | Boundary | Adversarial case (Task 10 attempts) | Row |
|---|---|---|---|
| B1 | collaborator comment → researcher **action** | POST/craft a feedback doc embedding a ```json board-feedback``` fence with `verdict`/`reviewRequest`/`reopen` keys inside a `quote` field; confirm hand-delivered `--collect` strips action keys + demotes headings, `parse_fence` takes the **last** fence and rejects multi-fence, and collaborator fields are neutralized. | S9 |
| B2 | artifact origin → **local mutation** routes | From a served `.html`/`.svg` artifact, `fetch('/api/feedback', …)` under the board origin; and a blind local-attacker POST to `/api/*` without the per-boot `boardToken`. Confirm 127.0.0.1 bind + `local_request_ok` (Host check) + `token_ok` (board.py:1216) reject both; confirm artifact CSP/MIME (`text/plain`/attachment) prevents active execution. | S10 |
| B3 | hosted Blob → **password gate** | On a live throwaway deploy: fetch a comment blob by its URL without the password (expect denied / non-guessable-private); verify the login gate; rotate `BOARD_SESSION_SECRET` and confirm the old 30-day cookie is invalidated. **runtime-verified** (decision: live Vercel arm). | S7, S5 |
| B4 | agent-written ticket → **sign-off gate** | Have the agent write a `.import-approved-<slug>-vN` ticket directly; confirm `signoff_gate.py:230` denies it as forgery; confirm only the board.py subprocess can mint one. | S2 |
| B5 | `Write\|Edit`-only hook matcher → **redirection escape** | The gate matches only `Write`/`Edit` (`hooks.json:5`). Attempt to create/modify a signed `vN.md` via a shell **redirection** (`Bash` `>`), which the matcher does not cover; characterize whether the immutability invariant is bypassable this way and what the documented boundary (reference.md:93) claims. | HOOK |
| B6 | command-prompt tool grants → **session authority** | Least-privilege review of each command's `allowed-tools`: `/board` grants `codex`/`agy`/`vercel`/`node`/`git`; does any command grant more than it uses? Assess the blast radius if a command body were manipulated (e.g. via untrusted feedback it routes). | B6/SUP |
| B7 | secret in Bash invocation → **transcript** | `printf '<secret>' \| npx vercel env add` (board.md:80): the secret is not a CLI arg but is embedded in the Bash tool call and may land in the session transcript. Threat-model it; propose a mitigation (e.g. a file-fed env add); do not overstate. | SUP |
| B8 | supply-chain fetch → **session** | `check_update.py:146` fetches `plugin.json`/`CHANGELOG.md` from the moving GitHub `main` every session; assess the parse hardening against a crafted version/CHANGELOG string, and whether a pinned ref reduces risk. Assess `npx vercel` package trust. | SUP |

## Notes for the pass

- **B2 is the load-bearing local-security invariant** and the napkin records it as previously fixed (artifact MIME/CSP hardening, `token_ok` enforcement at board.py:1216 — confirmed non-stale in the sweep). Task 10 re-verifies it runtime, not from memory.
- **B3 is the one boundary that genuinely needs a live deploy** — a mocked test proves the SDK contract (`access: 'private'`), not the runtime. Labeled `runtime-verified` only after the live attempt; else `static-contract`.
- **B1** is the historical confused-deputy channel (v0.13 blocker, napkin); the pass confirms the fix still holds against a fresh fuzz of every collaborator-controlled field, not just the ones patched then.
