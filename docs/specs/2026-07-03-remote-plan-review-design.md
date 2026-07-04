# Remote Plan Review — Design

**Date:** 2026-07-03
**Status:** Revised after cross-model review (Codex gpt-5.5 + Gemini 3.1 Pro, 2026-07-03); pending final approval
**Target:** research-plans plugin (board), next minor version

## Problem

The board today has two modes. Live mode serves the board on `127.0.0.1`, blocks until the researcher submits feedback, and routes that feedback into the Claude session. Export mode (`--export`) writes a self-contained read-only snapshot with all annotation UI disabled. Neither lets a remote collaborator comment on a plan.

The collaborators we design for are known, named people (co-authors, advisors). They review on their own time, over hours or days. We cannot assume they have GitHub accounts, git skills, or any hosting account. Plans are private research designs and must not be world-readable. This rules out public GitHub Pages, GitHub Issues or Discussions as a comment channel, and any flow that requires the collaborator to clone a repository.

## Decision

Ship a file-based review flow. The researcher exports an annotatable board file and sends it by email or file link. The collaborator opens it in any browser, annotates, and downloads a small feedback file that they send back. The researcher ingests that file, and it routes through the existing feedback pipeline unchanged.

This requires zero accounts and zero hosting from anyone. The feedback document format is the same one live mode produces, so a hosted backend (secret URL plus a small store) can be added later as an opt-in without reworking the contract.

Alternatives considered and rejected for now:

- **Hosted board with a comment backend** (Vercel, Cloudflare, Netlify). Slicker return path, but every researcher using the plugin would need their own hosting account, and a secret URL is weaker privacy than a direct email. Deferred, not precluded.
- **Tunneling the live board** (ngrok, Tailscale). Real-time, but requires the researcher's machine to stay up with the session open. Wrong shape for async review.
- **Separate reviewer-only HTML bundle.** A second build target that would drift from the main board. Maintenance cost out of proportion to benefit.
- **docx/PDF export with Word comments.** Zero development, familiar to academics, but loses anchored annotations, version diffs, and structured routing into the decision log — the board's core value.

## Design

### 1. Share export: `board.py --share [PATH] [--focus NN-slug]`

A third mode alongside serve and `--export`.

- Builds the same payload as live mode with `mode: "remote"`. Includes signed plan versions, the master plan, decision log, reviews, and the current unsigned draft if one exists. Pre-sign-off feedback is exactly when remote input is most valuable; the share hash (below) flags staleness if the draft changes before feedback returns. Note: today `collect_payload` includes drafts only when `mode == "live"`; the condition widens to remote.
- **Share hash, computed in Python.** The existing `payloadHash` lives only in TypeScript (`payloadContentHash` in `parse.ts`); porting it to Python would be brittle. Instead, `--share` computes a `shareHash` in `board.py` (stdlib `hashlib` over the embedded files' paths and contents, in sorted order) and injects it into the payload. The client echoes it back verbatim in the feedback document. `--collect` recomputes it with the same Python function — for focused shares, re-running the same pruning first, driven by the `focus` field in the feedback metadata. The client-side `payloadHash` keeps its current job (localStorage keying) and nothing more.
- Never includes `project.root` (the local filesystem path). Never includes a gate payload: share exports are built by `--share` directly, outside the sign-off gate flow, so remote boards never render gate UI.
- Default output path: `plans/board-share.html`, added to the hard-coded `GITIGNORE_LINES` in `board.py` (the existing `ensure_gitignore` mechanism does not cover it otherwise). Sharing happens by email, not by commit.
- `--focus` behaves differently than in live mode, where it only sets the initial view while the payload still embeds every plan file. In share mode, `--focus NN-slug` **prunes the payload**: it includes only the focused component's versions and draft plus the master plan, and omits the decision log, reviews, and all other components' plans. **The master plan remains fully visible in focused shares by design** — a component plan is unreadable without its master-plan context — and the tracker will render every component's row. The command's privacy reminder states this plainly.

### 2. Remote mode in the board UI

Add `"remote"` to the `BoardData["mode"]` union in `types.ts` (currently `"live" | "static"` — a build error otherwise). The gating on `data.mode === "live"` is spread across `App.tsx`, `PlanReader`, `Tracker`, `Timeline`, and `Scorecard`; rather than editing every site to a two-mode check, replace the `live` boolean with capability flags derived once from the mode — `canAnnotate` (live and remote), `canPost` (live only), `canDownload` (remote only) — and gate each site on the capability it actually needs. Gate UI (`gateApprove`/`gateDeny`, which `fetch` local endpoints) renders only when a gate payload exists, which share exports never contain.

In remote mode specifically:

- A first-run banner orients the collaborator: what this file is, click text to comment, press "Download feedback file" when done, and email the downloaded file back. It also warns: do not move or rename this file until you have downloaded your feedback — browsers key `file://` localStorage in ways that can orphan annotations if the file moves (Safari is the strictest).
- A "your name" field appears once — remote mode only, never in live mode — and is stored in localStorage with the annotations. The existing storage key (`rp-board:<project>:<payloadHash>`) makes a multi-day review survive browser restarts. Known limitation: the key carries no reviewer identity, so two reviewers sharing one browser profile on the same file would collide; with email distribution each reviewer works on their own machine, so this is documented, not engineered around.
- The submit button becomes **"Download feedback file"**. The client assembles the full feedback document — the same markdown plus ` ```json board-feedback` fence that `build_feedback_document` produces server-side today — with metadata: `sessionId`, `generatedAt`, `mode`, `focus`, `reviewer`, `shareHash`, `annotations`. The download is a Blob named `board-feedback-<project>-<reviewer>-<date>-<short-session-id>.txt` (reviewer and project sanitized to filename-safe characters). The `.txt` extension is deliberate: some mail clients inline `.md` attachments into the message body, mangling the JSON fence and the exact quotes anchor resolution depends on.
- The document-assembly logic is shared client code; live mode's POST body gains the assembled document and `serve` writes it verbatim. `build_feedback_document` stays in `board.py` as a compatibility path — the sign-off gate's denial flow uses it and is untouched.
- The copy-to-clipboard fallback stays, fixed to copy the full document including the JSON fence (today it copies only the markdown).
- Multiple reviewers never conflict at submission: each annotates their own copy of the file, and merging happens at routing time, one feedback file at a time.

### 3. Ingest: `board.py --collect <file>`

`--collect` today is a boolean flag whose handler reads *and deletes* `plans/.board-feedback.md`. It gains an optional path argument implemented as a separate code path (`collect_file`, alongside the existing pending-recovery logic) so the delete behavior of pending recovery is untouched. Without a path, behavior is unchanged.

With a path:

- Validate the document: JSON fence present and parseable; fall back to markdown-only with a warning if not.
- Recompute the `shareHash` over the current plan files with the same Python function `--share` used — re-running the focus pruning first if the metadata names a focus — and print a staleness note to stderr if it differs from the hash in the document.
- Print the document to stdout, exit 0. The source file is left untouched.

Precedence: if a pending `plans/.board-feedback.md` from an interrupted local session also exists, the `/board` command recovers and routes it first (its existing step 2), then processes the collaborator file.

### 4. `/board` command updates

Two new argument forms in `commands/board.md`:

- **`--share [component]`**: run the export, then tell the researcher two things in publishing terms. First, emailing this file IS publishing its embedded plan content to that person — an unfocused share embeds everything under `plans/`; a focused share embeds one component's plans plus the full master plan (always visible by design). Second, some mail providers flag `.html` attachments; zip the file or use a Dropbox/Drive link if delivery fails.
- **`--collect <file>`**: run the ingest. If the script printed a staleness note, relay it to the researcher before routing anything — never route stale feedback silently. Then route through the existing step-5 pipeline unchanged — anchored comments discussed one by one, drafts revised directly, decision-log entries written for every piece of feedback including declined ones. Attribution is conditional on the metadata: entries say "Board feedback from <reviewer> (remote)" only when the fence's `mode` is `remote`, so live-session feedback is never mislabeled. Multiple files route one at a time, in the order the researcher chooses; when two reviewers commented on the same draft and the first file's routing changed the draft's text, the second file's anchors resolve best-effort against the updated draft, and the researcher arbitrates what no longer applies.

Signed versions are immutable, so anchors on a signed vN always resolve even if vN+1 was signed after the export. The staleness note only signals that the conversation has moved; it never blocks routing.

### 5. Error handling

- Corrupt or missing JSON fence: route from the markdown body (existing fallback).
- Missing reviewer name: allowed as "anonymous reviewer"; the banner prompts but does not require it.
- `crypto.randomUUID` unavailable in an odd `file://` context: fall back to random hex for the session id.
- Gate flows cannot reach remote mode: share exports never carry a gate payload, and gate UI renders only when one exists, so the `fetch`-based approve/deny buttons can never fire against a nonexistent server.
- No server exists on the collaborator's side, so there is nothing new to break there.

### 6. Testing

- Playwright roundtrip on a fixture project: export with `--share`, serve the file over localhost (the Playwright MCP blocks `file://`), annotate, set a reviewer name, download, then `--collect` the downloaded file and verify the document matches the live-mode shape, fence included.
- Focused-share test: export with `--focus`, verify the payload contains only the focused component plus master plan, and that `--collect` recomputes the pruned `shareHash` correctly.
- Staleness test: modify a draft after export, `--collect`, verify the staleness note appears.
- Multi-sitting test: annotate, close, reopen, verify localStorage restores annotations and name.
- Live-mode regression: run a normal live session and a sign-off gate flow, verify no name prompt appears, feedback posts as before, and the gate's approve/deny path is unchanged.
- Dogfood: one real email roundtrip with a collaborator before release.

## Non-goals

- Hosted backend with auto-collection (deferred; the feedback contract is designed so remote mode can gain a POST target later).
- Real-time shared sessions or tunneling.
- Any GitHub-based comment channel.
- Merging concurrent feedback files into one document; each file routes independently.
- **Remote gate approval.** A collaborator cannot sign off a plan version by file; sign-off remains a local, researcher-only act through the v0.4 gate. Share exports never carry a gate payload.
- Pruning or redacting the master plan in focused shares; it is always visible (decided 2026-07-03).
