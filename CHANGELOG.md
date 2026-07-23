# Changelog

## [1.1.0] - 2026-07-23

The model-profile nudge now fires deterministically, and a new `/planboard:handoff` command lets a cooperative codex run the plan/execute/results loop from a project's AGENTS.md.

### Added
- **Codex handoff.** `/planboard:handoff` writes a marked planboard block into the project's `AGENTS.md`, pointing a cooperative codex at the plugin's shipped references and stdlib scripts by absolute path so it can author plans and execute the loop. Review and signing stay in a Claude session (the sign gate is hook-enforced there); provenance records the codex model as self-attested. The block is machine-local — re-run to refresh after a plugin upgrade.

### Changed
- **Deterministic model nudge.** The per-stage model nudge no longer depends on the model guessing its own identity; it fires from the profile row alone. The execute prompt always pre-selects the profile's `execute` model when the profile names one.

## [1.0.0] - 2026-07-23

The plugin is renamed from research-plans to planboard. Commands move from `/research-plans:*` to `/planboard:*`, and the install id becomes `planboard@planboard`. Already-initialized projects and existing board state keep working: the old markers, environment variables, storage keys, launcher, and review agents are all still recognized, and old artifacts migrate to the new names on first use.

### Changed
- **Renamed to planboard.** The plugin and marketplace are now `planboard`, every command is `/planboard:<name>` (for example `/planboard:board`, `/planboard:plan`), and the GitHub repo is `letitbk/planboard`.
- **Reinstall to pick up the rename.** A plugin name change is not an in-place update, and the update notice from an installed `research-plans` build points at a now-dead command. Remove the old marketplace, then run `/plugin marketplace add letitbk/planboard`, `/plugin install planboard@planboard`, and restart.
- **Refresh your initialized projects.** Run `/planboard:init` in update mode in each research project to rewrite the marked CLAUDE.md block, which still names the old `/research-plans:*` commands. Hosted-board users re-run `/planboard:board --web-connect`.
- **Environment variables renamed, old names still work.** `RESEARCH_PLANS_NO_GATE`, `RESEARCH_PLANS_NO_UPDATE_CHECK`, and `RESEARCH_PLANS_GATE_TIMEOUT` are now `PLANBOARD_*`; the legacy names are still read as a fallback.
- **Old artifacts kept and migrated.** Legacy `<!-- research-plans:* -->` plan and CLAUDE.md markers, `rp-*` review agents, the `./rp-board` launcher, `rp-board:` browser storage, and the `~/.research-plans/web` hosted config are all still recognized. Review agents and the launcher regenerate as `pb-*` on first use (restart the session to load the renamed agents), and browser storage migrates in place.

## [0.25.0] - 2026-07-22

Board plan-review commenting gets more capable, and the board now reopens on a produced draft. Reopen your boards to pick up the highlight fix.

### Added
- **Comment on a whole plan.** A **Global comment** button in the plan reader adds a comment attributed to the whole plan — no text selection needed, for feedback that isn't about one passage.
- **Edit unsent comments.** Fix the wording of a local comment before you submit it, in place. Sent comments stay immutable, and submitting is held until you finish the edit.

### Changed
- **The board reopens on a produced draft.** When you route a request-change into a new or refined plan draft, the board reopens focused on that component's draft — landing on the draft with its diff and score, the same way a review or report request reopens to show its result. Feedback that is only discussed or declined still leaves the board closed.

### Fixed
- **Highlights stay after you save a comment.** Painted highlights used to disappear a few seconds after saving, which also broke click-to-jump. They now persist, clicking a comment scrolls to and flashes its highlighted passage, and clicking a highlight opens its comment. Reopen existing boards to pick up the fix.

## [0.24.1] - 2026-07-20

Highlight-and-comment works again. Saving a comment on the board has been silently failing since v0.19.0; update and reopen your boards.

### Fixed
- **Comments save again.** On the board, selecting text and pressing **Save comment** did nothing: the comment never reached the feedback panel, and afterwards no Comment button appeared on any further selection until the page was reloaded. The comment popup was clearing the very text selection it was attached to, so it unmounted before its own click landed. Sometimes the Comment button swallowed its own first click for the same reason. Existing boards need to be reopened to pick up the fix.

## [0.24.0] - 2026-07-19

Open the board without Claude. A mechanical `rp-board` launcher lets you reach the board when the Claude session is rate-limited — no model in the loop, and no shell setup.

### Added
- **`./rp-board` launcher.** The board now writes a small, machine-specific launcher into each project. Run `./rp-board` in a terminal (or `!./rp-board` in-session) to open the board with no LLM — it reconnects to a running board or serves a fresh one. It is created at `/research-plans:init`, refreshed on every board open, and can be written on demand with `board.py --install-launcher`. The launcher is kept out of git via `.git/info/exclude`, so it never enters a commit.

## [0.23.0] - 2026-07-18

Sign-at-execution (PR #26): approval moves out of the persistent board into slim one-shot sign sessions, plans sign at the `/execute` gate instead of at authoring, and post-execution revisions are recorded as amendment versions — one browser decision per component, at the moment it matters.

### Added
- **`/research-plans:sign`.** Sign one or many pending plans without starting execution. Durable tickets and saved `.sign-feedback-vN.md` files let an interrupted session resume from disk.
- **One slim sign view for both transports.** `SignOffView` handles ticket sessions from `/sign` and `/execute`, plus direct-write hook sessions. Each item has its plan, score, diff, annotations, note, and independent decision state.
- **Recorded amendment versions.** `/sync` can write the next consecutive canonical version with an `Amendment recorded, YYYY-MM-DD` trailer. Re-execution materializes a fresh draft and signs a new commitment.
- **Strict trailer grammar.** Python and TypeScript share fixture-backed rules for signed, amendment, missing, and malformed trailers. The board badges malformed trailers and exposes `trailerState` in its payload.
- **Authenticated board handoff.** A sign session closes a live persistent board through `/api/shutdown`; exit 5 records the handoff without relaunching the old board.

### Changed
- `/research-plans:plan` leaves a scored pending draft and marks its tracker row `planned`. Plans sign at the `/execute` gate, or sooner through `/sign`.
- `/research-plans:sync` records confirmed amendments directly. `/research-plans:adopt` signs any number of retrospective drafts in one sign session.
- Tracker drift checks use trailer state, so a recorded amendment is not mislabeled as unsigned drift.

### Removed
- In-board plan Approve and Request changes actions from the persistent dashboard.
- `board.py --gate-batch` and `--allow-single`.
- The `Signed off:` placeholder trailer from the mutable execution-plan template.

## [0.22.0] - 2026-07-18

The Output & Validation train (PR #25): the Results tab renamed, a mechanical F·A·I output score on every new bundle, codex-style discipline in the reviewer agents, and a standalone planning doctrine.

### Added
- Mechanical F·A·I output score (fidelity · attainment · integrity, 0–3 each) sealed into every finalized bundle's manifest, displayed as chips in the Output & Validation banner with a derivation popover, and as a compact profile in Tracker/Archive rows. Diagnostic, never a gate.
- `references/planning-doctrine.md` — the authoring standard `/plan` now loads; `/plan` grounds in the repo by default before the dialogue.
- CLAUDE.md rules 9 (evidence before claims — `logs/` capture) and 10 (assumptions and restraint); init ensures `logs/` is gitignored on both fresh and update paths.

### Changed
- The board's Results tab is now **Output & Validation** ("Output" in table columns, the timeline chip, and the sidebar); all internal ids, tokens, and deep links are unchanged.
- The three rp-* reviewer agents carry codex-style discipline: grounding rules, per-scope dig-deeper nudges, a verify-before-returning pass, and `[blocker]`/`[major]`/`[minor]` severity ordering shared by all reviewer paths (subagent, panel, codex, gemini). Existing projects: run `/research-plans:models` and regenerate — `models.py check` now detects template drift and says so.

## [0.21.0] - 2026-07-18

### Changed
- **Plans read like documents.** Real typographic hierarchy (larger headings, doubled section rhythm, an emphasis ladder in light and dark), a 52rem reading measure, task lists and tables that render properly, and the plan's metadata as a card (title kept, provenance no longer shown twice).
- **Build steps are a numbered spine.** Each step renders as a "Step N of M" card — nested content, task checkboxes, reference links, and inline agent-detail blocks included — and stays a semantic ordered list for assistive tech.
- **The outline tracks your position.** The sidebar TOC highlights the section you are reading on plans and reports, resets on document switches, respects reduced motion, and still navigates on click.

### Added
- Authoring guidance in the plan template: bold decision keywords, italic rationale asides, short paragraphs, one-sentence build steps.

## [0.20.0] - 2026-07-17

### Changed
- **Plans finalize in a review room, not a modal.** `/plan` (and `/sync` revisions) end on the persistent board: the draft arrives already scored, you review with annotations and Review-With available, and your Approve writes the signed version through the same durable-ticket machinery. The blocking gate browser remains as a fallback for direct writes. Finalize marks the component `planned`; execution start marks it `in progress`.
- **The results Accept/Request-changes pass is gone.** A bundle's standing state is its validation result (validated / deviations flagged / unvalidated / retrofit) — on the Results banner, the Tracker, PlanReader chips, and report staleness. Reopen works on every finalized bundle. Legacy verdicts display read-only.
- **Batch sign-off is no longer /adopt-only.** Multi-component `/plan` finalizes in one wizard session; approvals are bound to the exact text displayed (hash-checked against disk under a lock), the wizard resumes honestly after a restart, refreshes drafts that changed on disk, shows rubric score chips, and reconnects across relaunches.
- `/research-plans:sync` is now the manual recovery checkpoint (out-of-loop work, hosted-comment pulls, crashed sessions); the primary path is plan → review room → execute.

### Added
- Draft plans are scorable: the rubric scorecard attaches to the working draft and migrates to the signed version at approval.
- **`/research-plans:execute`** — one question after a plan is signed (run now? which model? report at the end?) and the loop runs itself: agent-curated capture (labeled), validation before any bookkeeping, report, tracker and decision-log updates, one commit suggestion, a view-only board, and a next-step proposal. Validation that finds deviations stops the loop with three concrete remedies on the still-staged bundle; nothing else interrupts.
- Auto-captured decision-log entries (`(auto-captured)` label) parsed and badged on the Timeline.

## [0.19.1] - 2026-07-17

### Fixed
- Gate approve/deny no longer white-screens the board tab (hook-order crash present since v0.14.0); an ErrorBoundary backstops any future render error.
- A board tab left open across a server restart now reloads itself instead of failing every action with a generic error (per-boot identity is seeded from the payload, and failed posts probe for a newer server).
- An expired sign-off gate now says so — and that the draft is saved and approvable from the board — instead of showing "failed".

### Added
- The board tab closes itself 3 seconds after a session-ending action (approve, request changes, feedback send), with a keep-open cancel and a per-project preference. Review and report requests keep the tab open — it becomes the relaunched board's window.
- The sidebar now shows which document you are reading: the Files tree highlights the active file and auto-expands to it, and the Outline is headed by the document's name.
- Working drafts appear in the Files tree as a "vN (draft)" leaf (previously invisible once a component had signed versions).

## [0.19.0] - 2026-07-16

A navigation and hardening release: the board gains a global Outline + Files sidebar, and a comprehensive plugin checkup fixed a security bug, made collaborator commenting safe under retries, cut per-session token overhead, and shored up keyboard accessibility.

### Added
- **Board Outline + Files sidebar.** One global, persistent, collapsible left panel with two sub-tabs: an **Outline** that adapts per view (a heading table of contents on document readers, a semantic outline on structured views like the Tracker and Timeline) and a **Files** navigator over your plans, results, and reports. Keyboard-navigable.
- **Keyboard access across the board.** The annotation composer, line-comment ranges, and the sidebar are now reachable without a mouse.

### Changed
- **Lighter `/board` and `/results`.** The web-publishing runbook and the results adopt/reconcile modes moved into on-demand reference files, so a plain board open or a single-capture `/results` no longer loads instruction text they don't need.
- **Collaborator commenting is retry-safe.** Hosted comment posting is now idempotent — a lost-response retry with the same id succeeds instead of duplicating a comment or being rejected, and it can never overwrite a different comment.
- **Headless `/init` recovers gracefully.** Run non-interactively without answers, it now prints a complete re-run form instead of asking questions and exiting with nothing created.

### Fixed
- **Comment-wipe CSRF.** `/api/clear` ran its destructive delete-all on any HTTP method, so a top-level GET carried the session cookie and let an attacker page erase every collaborator comment. It now requires POST.
- **Every `--pull` re-offered the previous batch.** The web-comment inbox is cleaned after routing, so comments you have already pulled and handled are no longer re-presented on the next pull.
- **Native dialogs on the board.** The feedback copy-fallback used browser `alert`/`prompt`; it now uses an in-page selectable text box.
- **Sign-off order and ticket robustness.** A new order is refused while an un-acknowledged one is pending, the pulled-comment state is written atomically, and each approval ticket is bound to its order — so an interrupted board session can no longer strand an order or leave an orphan ticket.
- **Board responsiveness and dark mode.** The header wraps, the sidebar stacks by viewport width (no squeeze at high zoom), wide tables scroll, and dark-mode warning contrast is restored.
- **Documentation and coherence drift.** The board-lifecycle description, a stale code comment, two "what it creates" omissions, a byte-vs-character size cap, and several silently-swallowed errors.

## [0.18.0] - 2026-07-14

Plan review gets shorter and moves into the plan itself: a five-number rubric replaces the old pass/fail-plus-grade, each plan version's score shows in the plan header (the Reviews tab is gone), and plans read as one narrative you can collapse to taste.

### Added
- **Five-channel rubric (v0.4).** `/research-plans:review` scores a plan on five 0–3 channels — Goal & success, Decisions & reasons (the spine), Steps, Validation, Boundaries — and reports a profile, the biggest leak, and the specific decisions to fix next. It's a diagnosis, not a pass/fail: there is no threshold gate, readability is a precondition, and prospectivity/revisability become non-scored integrity flags. The spine credits a decision you authored, chose, or approved equally, scoring the depth of the reasoning and its link to the research goal — and Validation asks whether the plan can actually test that it hit its goal.
- **Score in the plan header.** Each plan version's score renders as a strip in its header — hover a chip for the evidence, click for the full diagnosis (channels, biggest leak, suggested moves, unresolved forks, split, reviewed-by model); integrity flags show as badges. The score re-runs on every signed version.
- **Reader detail level.** `/research-plans:init` asks a detail level (compact / standard / full); the board opens plans collapsed to it, and any reader can toggle a section or block open.

### Changed
- **Plans read as one narrative.** The `Part 1 — For humans` / `Part 2 — For agents` split is gone. A plan is one continuous story (context first), with low-level agent detail in inline collapsible blocks.
- **"Review With" is capped** to at most five material, channel-tagged comments per reviewer (the panel keeps the top few) — actionable feedback, not nitpicking.
- **The live board closes on action and no longer times out.** Submitting an action closes the board instead of refreshing it in place; `/research-plans:board` reopens it at the same URL, an idle board no longer sleeps, and a review or report request still reopens with its result. The sign-off gate keeps its own bounded timeout.
- The **Reviews tab is removed** — scores live in the plan header now.

## [0.17.0] - 2026-07-13

Two themes land together: the board can now steer which model runs each stage and record which model each part actually used, and the results/report split becomes honest — evidence and a mechanical integrity check on the Result tab, narrative on the Report tab, and no report at all when there is nothing to report.

### Added
- **Board Models tab.** The per-stage model profile (previously edit-only via `/research-plans:models`) is now a first-class board tab — read-only in every mode; when served live from your project, edit model/effort per stage inline (the five aliases or a custom `claude-*` id) and Save, and the board rewrites `plans/model-profile.md` and regenerates the `rp-*` review agents itself. Nudge-stage edits (plan, execute, sync) apply immediately; agent-stage edits are flagged for a session restart. Saves are validated, atomic, and concurrency-guarded, and a reload / second tab reconciles via a new `GET /api/model-profile`.
- **Up-front model choice.** `/research-plans:init` asks whether to use the recommended per-stage defaults or choose your own before writing the profile; the Models empty-state offers the same choice.
- **Model provenance.** Each plan version, result bundle, report, and review now records which model it used — both *prescribed* (from the profile) and *reported* (self-attested by the session, shown honestly as reported, never as verified runtime truth) — surfaced as a small chip on the Plans, Results, Reports, and Reviews surfaces.
- **Integrity pass on every bundle.** `/research-plans:results` seals a mechanical integrity check into each bundle's manifest at finalize (artifact checksums match, references resolve, every substantive finding is sourced to an artifact) — advisory, surfaced on the Result tab, never blocking.
- **Tracker Report column.** The report link moves out of the Results column into its own Tracker column.

### Changed
- **Result and Report tabs split cleanly.** The Result tab is evidence + validation + integrity; the Report tab is the single home for narrative prose. A bundle with no substantive findings gets no report — `/research-plans:report` refuses (null-result gate) and the board shows a null-result state instead of an empty document.
- **Plan/version diffs wrap** to the pane width instead of scrolling horizontally.

## [0.16.0] - 2026-07-13

Artifacts open where you review, and sign-off stops surprising: text artifacts (md, csv, and friends) now render in an in-board viewer instead of downloading, a timed-out sign-off gate hands the draft to the persistent board for a durable Approve, and batch sign-off is explicitly the /adopt bulk flow — it refuses a single pending draft unless you say otherwise.

### Added
- **In-board artifact viewer.** Clicking a text artifact (`.md`, `.csv`, `.tsv`, `.txt`, `.log`, `.json`, `.tex`) opens a viewer modal on the board — markdown rendered like the Reports tab (figures included), csv/tsv as a table, the rest as plain text — instead of downloading the file. Works on live, exported, and hosted boards.

### Changed
- **Sign-off routes harmonized; batch made explicit.** A timed-out sign-off gate now saves the proposal back as the component's `.draft-vN.md` and directs recovery to the researcher's Approve on the persistent board (which mints the same durable ticket) — the timeout message no longer suggests the headless bypass. `board.py --gate-batch` is now explicitly the `/adopt` bulk flow: it refuses fewer than 2 drafts still awaiting approval unless `--allow-single` (one-component adoptions, resumed batches), and the gate's ticket-error messages stop steering agents toward batch mode.

### Fixed
- Markdown links now enforce a scheme allowlist (`javascript:`/`data:`/relative links render as plain text) — closes a script-injection path reachable from report bodies.
- The live `/artifact/` route serves text types inline and forces active content (`.html`, `.svg` documents, unknown types) to download, with `nosniff` and a sandboxing CSP — artifacts can no longer navigate same-origin with access to the board's action token.
- The newest pending draft is now selected numerically — `.draft-v10.md` no longer loses to `.draft-v9.md` (payload collection and batch collection).
- `/adopt` docs: batch approval writes a ticket (the session then writes the admitted `vN.md`), not the plan file itself.

## [0.15.0] - 2026-07-12

The board learns to read: a new Reports tab renders each component's shareable report right on the board — figures inline, version chips, staleness flags, PDF/DOCX downloads — and the Results view slims down into a reviewing surface with validation up front and one Evidence gallery.

### Added
- Board **Reports** tab: renders each bundle's generated report with figures resolved from bundle assets, `rN · plan vN` version chips, stale-report and wrong-file flags (first-line `rp-report` JSON marker), PDF/DOCX downloads on the local board, drag-select commenting, and report chips on Tracker/Archive rows and PlanReader bundles (`--focus slug:rN:reports`).
- `/research-plans:results` offers report generation at capture end; the board's verdict routing offers one-click report regeneration when the report's recorded verdict goes stale.
- `/research-plans:report` embeds figures under the finding each supports (via `artifactIds`) and defines the planless (retrofit) report shape.
- Hosted pull: per-comment staleness tags for plan and report comments (client FNV-1a hash ported to Python); `docHash` now survives the pull.

### Changed
- Results view is now the reviewing surface: validation promoted to the top, finding tiles compact (figures live in one Evidence gallery and on the Reports tab).

### Fixed
- Hosted pulls now strip the `reopen` action key (researcher-only) from collaborator annotations.
- Summary-only bundles show their notice in finding mode too.

## [0.14.0] - 2026-07-10

Per-stage model profiles land — plan on the strongest model, execute on a cheap fast one, review on opus; nudged where you decide, pinned where work is delegated — and the live board becomes a persistent control surface: a bookmarkable URL that stays up, refreshes itself after every action, and carries every researcher decision.

### Added
- **Per-stage model profiles.** `plans/model-profile.md` (created at init, committed) maps each workflow stage to a model + effort: planning nudges toward the strongest model, execution toward a cheap fast one, review/validation pin opus at low or medium effort via generated project agents.
- **Persistent live board.** A stable per-project port (41000–41999, bookmark it) and a relaunch loop: every action you take is applied by your session, then the board reopens itself and your tab refreshes with the updated state. After an idle hour it sleeps; `/research-plans:board` wakes it at the same URL.
- **`/research-plans:models`** — view or edit the profile via structured questions and regenerate the `rp-*` agents; ownership-marked files, checksum staleness hints, user-owned agents never overwritten.
- **Generated review agents.** `.claude/agents/rp-plan-reviewer.md`, `rp-results-validator.md`, `rp-board-reviewer.md` — complete, least-privilege agent definitions whose model/effort come from the profile (a request the platform can override).
- **Docked feedback panel.** On wide windows the feedback panel is a real side-by-side column — content reflows, nothing is covered; narrow windows keep the overlay, now with a scrim. Clicking a feedback card jumps to its highlight (and back), including script line comments.
- **Always-available actions.** Approve / Request changes on any displayed plan draft from the Tracker and Plan views (state-aware: signed plans show their badge), Review with … everywhere it makes sense, and Reopen on an accepted results bundle — which files a change request; the recorded verdict is never modified.
- **Board-issued approval tickets.** Clicking Approve makes the board server validate the exact displayed draft and write a one-use, content-hash-bound ticket (the same mechanism as batch sign-off); the sign-off hook admits the write by consuming it. Feedback documents are never approval authority.

### Changed
- **All researcher actions are uniformly hidden during sign-off gates** (review-before-gate; the gate stays a modal approve/request-changes moment).
- **Live drafts are stored per-project**, so a relaunch with changed content never orphans unsent comments.
- **`--collect` now peeks without deleting; the new `--ack` acknowledges** a routed order after the work finishes — a crash mid-routing re-offers the order instead of losing it.
- **`/research-plans:review` can now delegate.** When the generated `rp-plan-reviewer` exists, both scoring stages run inside it on the profile's model; without it the command runs inline exactly as before. Results validation and the board's subagent/panel reviews likewise dispatch their `rp-*` agents when present.

### Fixed
- **The Results review button no longer renders dead inside gates** (the server rejects mid-gate feedback; the button now follows the same rule as everywhere else).
- **Hand-delivered feedback files can no longer smuggle researcher-action keys or headings** — `--collect <file>` strips `signoff`/`verdict`/`reviewRequest`/`reportRequest`/`reopen` and demotes action headings to quotes.
- **Mutating board routes now require a per-boot token**, HTML/health responses are no-store, GETs validate Host, and frames are denied.

## [0.13.0] - 2026-07-10

Private board sharing — collaborators read and comment on a password-gated hosted board, and their comments flow back into Claude Code.

### Added
- **Publish the board privately to Vercel.** `--publish-web` (and a "Publish to web" button) deploys a password-gated hosted board; collaborators need only a browser. `--pull` brings their comments back into the review flow.
- **Lifecycle controls.** `--web-connect` (new computer), `--web-clear`, `--set-password` (rotate).
- **A non-technical hosting walkthrough** with a copy-paste collaborator invitation template.

### Changed
- **`--publish` (GitHub Pages) is deprecated** — it makes plans world-readable. Use `--publish-web`. The warning includes takedown steps for an existing Pages board.
- **Web sharing needs Node.js** (for the Vercel CLI); the core workflow still needs only python3.

### Fixed
- **Collaborator comments can no longer forge sign-off/review actions** (hardened feedback-fence parsing + comment-only, neutralized assembly).
- **Every local board POST endpoint is now origin/host/token-guarded.**

## [0.12.0] - 2026-07-09

Release plumbing — the plugin now tells you when it's out of date, and every
version is installable by tag.

### Added
- **Update reminders.** A once-per-version notice at session start names the
  exact update command and highlights what's new. Silence it with
  `RESEARCH_PLANS_NO_UPDATE_CHECK=1`.
- **Version pinning.** Every release (v0.1.0 … v0.12.0) is now a git tag, and
  the README shows how to install a specific older version.
- **`docs/RELEASING.md`.** A written release process so version bumps and tags
  stay in lockstep.

### Changed
- **One authoritative version.** `.claude-plugin/plugin.json` is now the single
  source of the version string; the duplicate in `marketplace.json` was removed.

## 0.11.0 (2026-07-09)

UI release — dark mode, readable paragraphs, and a provenance flow diagram.

- **Dark mode.** A sun/moon toggle in the board header (also on the batch
  sign-off and terminal screens). First visit follows the OS preference; the
  toggle overrides it and persists. An inline pre-paint boot script means no
  flash of the wrong theme, and exported/shared snapshot files carry the
  toggle too. Every view, chip, diff, annotation highlight, and the script
  viewer are themed.
- **Soft-unwrap for hard-wrapped documents.** Paragraphs that were
  hard-wrapped in the source (agent-written reports, pasted docs) now flow
  to the container width instead of breaking mid-sentence at every source
  newline. Intentional line-oriented breaks survive: `Label:` lines, list
  items, tables, headings, code blocks, and explicit two-space breaks are
  never joined; only clear sentence continuations are.
- **Provenance flow diagram.** The Results view's "How these were produced"
  text list is now a script→artifact flow diagram: script nodes (language,
  line count) connect by curved edges to artifact nodes (thumbnails,
  source paths, .tex/data chips). Click a script to read its snapshot in
  the line-numbered viewer and comment on specific lines; click an artifact
  to open its lightbox or jump to its card. Node text is drag-selectable —
  comments on the diagram route like any other, and highlights repaint on
  the surface where they were made.

## 0.10.0 (2026-07-09)

Feature release — journal-ready outputs, project renewal, shareable reports, and validation at capture.

- **Journal-quality outputs, end to end.** Init (and renew) interview for a
  target journal and write output conventions into the project's CLAUDE.md
  block (rule 7): analysis deliverables are journal-ready figures (vector PDF
  + PNG preview) and typeset tables (.png render + .tex source), produced via
  the /journal-figures and /journal-tables skills when available, standard
  tooling otherwise — a CSV of estimates is an intermediate, never the
  deliverable. Table artifacts carry `tex` and `data` source attachments
  (validated at finalize); the board displays a table's typeset render like a
  figure (lightbox included) with the sources as quiet links. **Behavior
  change:** the board no longer auto-inlines CSV/TSV/tex/json/txt artifact
  contents — legacy bundles whose table artifact is a bare CSV now render as
  a click-to-open card instead of an inline dump (.html/.md tables still
  inline, sanitized). `.xlsx` files are now discovered at capture.
- **`/research-plans:renew` — change the project's direction.** Archives the
  master plan to `plans/archive/master-plan-<date>.md` (immutable —
  hook-enforced like signed versions), writes a fresh master plan for the new
  target (new context and RQs), carries forward the prior components you
  still rely on (numbers, slugs, dirs, results untouched; numbering continues
  across renewals, never reused), preserves `Initialized:` unchanged, and
  records the pivot in a `Renewed:` line, a `Foundations` section, and one
  decision-log entry. Works on never-initialized exploratory repos too, and
  is the preferred entry there; adopt remains the backward-looking
  reconstruction and consumes carried rows that need retrospective plans.
  The board grows an **Archive** view rendering each archived plan with its
  tracker; pre-renewal components get quiet badges (never red drift) and
  are skipped by the source-drift checks.
- **`/research-plans:report` and a Generate report board button.** Assembles
  a standalone shareable report for a results bundle — background and goal
  from the plan, data and methods, findings, embedded figures/tables,
  validation summary, provenance appendix — as markdown under
  `plans/reports/` (committed, regeneratable), plus PDF and DOCX via pandoc
  when available (honest degradation otherwise). The button rides the same
  feedback channel as agent reviews: submit, board closes, report generates,
  board reopens on the bundle.
- **Automatic plan-vs-execution validation at capture.** Every planned
  capture spawns one independent subagent that compares the signed plan
  against the staged scripts, artifacts, report, decision log, and git
  evidence, producing per-build-step and per-success-criterion verdicts with
  evidence. The overall status is derived mechanically (`conforms` /
  `conforms-with-amendments` / `deviations-found` / `unverifiable`) and
  sealed into the bundle as `manifest.validation` + a readable
  `validation.md`; retrofit bundles record `not-applicable`, headless runs
  `skipped` — never silent. The board's Results view renders the audit with
  per-step marks; the Tracker flags `deviations-found`. Advisory by design:
  capture never blocks, and the remedy for an unrecorded deviation is a plan
  revision via sync.

## 0.9.2 (2026-07-08)

- **Relicensed from MIT to the PolyForm Noncommercial License 1.0.0.**
  Research, teaching, personal, non-profit, educational, and government use
  remain permitted; commercial use now requires a separate license. Versions
  <= 0.9.1 were published under MIT and remain so under their original terms;
  bundled third-party dependencies keep their own (MIT) notices.

## 0.9.1 (2026-07-08)

- **Filesystem/git drift checks in the Tracker** (the last checks from the
  retired `/status`, now folded into the board): a stale `board.html` (older
  than the newest file under `plans/`), leftover results staging directories,
  verified-source drift (a bundle's producing script changed since capture),
  and components in progress with no git activity in 14+ days. All surface in
  the board's Drift & hygiene panel; none appear in a remote share.

## 0.9.0 (2026-07-08)

Feature release — one-click agent review across every plan document.

- **Agent plan review**: a **Review with ▾** button on execution-plan
  versions, the master plan (Tracker), and results bundles asks a reviewer
  to critique the document and produce section-anchored comments — no more
  writing the feedback by hand. Four reviewers: a Claude subagent, a
  three-lens subagent panel (correctness / methodological rigor /
  feasibility), Codex (GPT-5.5), and Gemini (agy). Each returns the same
  `{overall, comments}` JSON contract; the session runs the reviewer, seeds
  its comments onto the board as pending annotations attributed to the
  reviewer, and reopens on the target so you curate them and press Send —
  routed through the normal feedback flow and logged as the reviewer's, not
  yours.
- Comments anchor per scope: plan comments on the plan, master-plan comments
  on the Tracker, results comments on the report. A quote the browser cannot
  locate becomes an explicit **unanchored** badge (shown in the drawer,
  never dropped).
- External reviewers run read-only and shell-injection-hardened: the review
  prompt is written to a gitignored temp file, never interpolated into a
  shell command; Codex runs `--sandbox read-only` and agy without
  `--dangerously-skip-permissions` — a review must not mutate the repo.

## 0.8.0 (2026-07-07)

Feature release — traceable iterations, a self-driving loop, human-readable
plans, and link-shareable boards.

- **Committed draft iterations**: every drafting round is snapshotted to
  `plans/execution/<slug>/vN-draft-K.md` — flat committed files beside the
  signed `vN.md`, so the path from first idea to signed version is traceable.
  The sign-off gate's version regex and the draft gitignore both ignore these
  names, so they commit with no gate change and no migration. The board shows a
  read-only "iterations" track per version and diffs each step against its
  predecessor; snapshots are never annotatable.
- **Auto-chaining the workflow**: `/plan` auto-runs `/review` then opens the
  board after a clean sign-off; `/sync` auto-proceeds into `/results` (the
  per-component interview is preserved) then the board; `/results` opens the
  board itself; `/init` recommends `/adopt` when it finds substantial prior
  work. Each chain opens exactly one board — through the full `/board` workflow,
  so verdicts and comments still route — after the sign-off gate's board closes.
- **Human/agent plan split**: the execution-plan template separates `Part 1 —
  For humans` (goal, context, scope decisions) from `Part 2 — For agents`
  (approach, build steps, verification, files). The board shows Part 1 and
  collapses Part 2 under a toggle, keeping a single annotation layer so comment
  anchoring is unchanged.
- **`/research-plans:board --publish`**: push the self-contained board to the
  repo's GitHub Pages (`gh-pages`) for a stable, shareable URL — no artifacts,
  no emailing HTML files. Runs through a throwaway git worktree that never
  touches the working tree or current branch; builds on an existing `gh-pages`
  or creates an orphan, dedupes no-op republishes, and warns about repo
  visibility. Best-effort Pages-enable via `gh`.
- **`/research-plans:status` retired**: its drift and hygiene checks (unsigned
  versions, empty log, missing/mismatched Serves, unverified-done,
  executed-work-with-no-plan, misfiled history, and more) now render in the
  board's Tracker, where the reviewing already happens. The `/init` interview
  also drops the collaborator question.
- Design + review: brainstormed with the researcher; each feature's diff was
  cross-model reviewed by Codex (GPT-5.5), with findings folded in.

## 0.7.0 (2026-07-07)

Adoption release — the plugin now works at any project stage, including after the fact.

- **`/research-plans:adopt`**: retrospectively decompose already-done work into
  components that each carry a full, honestly-labeled plan. Evidence scan →
  proposed decomposition → bulk-drafted retrospective plans → one board batch to
  approve them. Resumable; handles already-decomposed trackers, in-progress
  components (retrospective v1 + prospective v2), and creates the execution dir
  for every row.
- **Plan provenance (rubric v0.3)**: a plan may declare `Provenance: retrospective
  — covers <range>` with a `Sources` section. T8 is now provenance-aware — a
  declared, evidence-cited retrospective plan passes; *undeclared* retrospection
  (a methods section passed off as prospective) fails, and the adoption-cutoff
  no longer shields it. `/review` resolves the Sources; the board shows a
  provenance chip; retrospective work captures as `retrofit`, never `planned`
  (reconcile routing fixed — a 4-reviewer finding).
- **Hardened batch sign-off** (`board.py --gate-batch`): review many drafted
  plans in one one-at-a-time session; each approval writes its ticket
  immediately, so an interrupted session keeps prior approvals. Tickets are
  hashed sign-off-trailer-invariantly (draft ↔ signed match), forgery-guarded
  (the gate denies agent writes to `.import-approved-*`), not deleted on consume,
  fast-deny + 7-day TTL, slug-version-named.
- **Reconstructed history** (`plans/history.md`): pre-adoption decisions recorded
  as an evidence-cited, date-granularity record — appendable anytime, scoped to
  pre-`Initialized` events, kept out of the append-only decision log. Renders as
  distinct dashed "reconstructed" cards on the board Timeline; withheld from
  focused shares.
- **Numbers are stable identifiers**: `#` is assigned once and never changes or
  moves; work sequence is the table row order (reorder rows, never renumber), so
  finalized bundles never move. No renumber tool by design.
- Design + review: brainstormed with the researcher, two cross-model reviews
  (Codex GPT-5.5, Gemini 3.1 Pro), and an 8-dimension multi-agent ultrareview;
  ~40 findings folded in or resolved.

## 0.6.4 (2026-07-06)

- **Finding-centric results bundles**: the board's Results view now embeds each
  figure/table directly under the key finding it supports, instead of a separate
  evidence gallery. Metrics gained optional `statement` (the claim sentence
  shown as the finding headline), `status` (robust | marginal | descriptive |
  retracted | superseded), and `artifactIds` (the artifacts embedded under that
  finding). Artifacts referenced by no finding fall to an "Additional evidence"
  section; bundles without the new fields keep the previous metric-tiles +
  gallery layout (backward-compatible).
- **Figure lightbox**: clicking a figure enlarges it (Esc or click to close).
- **producedBy / source fix**: `results.py copy` now emits `source.path` (was
  `src`) to match the board contract, so the "Sources and producing scripts"
  list renders real paths. `validate_staged` now checks that metric `artifactIds`
  resolve to real artifact ids and `status` is a valid value.

## 0.6.3 (2026-07-06)

- **Reproducibility-first results capture**: when a component has runnable
  producing code, `/research-plans:results` regenerates the real
  figures/tables/numbers by re-running it and bundles those, instead of
  scavenging whatever files happen to be on disk. Recorded recipes auto-run
  without a prompt only when the script is repo-contained and its source hash
  matches the approved recipe; otherwise the command shows the exact command and
  asks. Runs are logged, use `pipefail`, and stop the capture on a non-zero exit
  or missing/stale expected outputs (design cross-model reviewed, Codex GPT-5.5).
- **Summary-only board notice**: a bundle with a report but no reproducible
  figures/tables now shows an explicit "summary only" notice on the board
  instead of a silently blank gallery. Fresh components with no code produce no
  bundle at all.
- **Broader discovery**: `results.py discover` scans more default output dirs
  (`plots`, `viz`, `visuals`, `graphics`) and takes a repeatable, repo-relative
  `--dir` for non-standard layouts (absolute / `..` / symlink escapes rejected).

## 0.6.2 (2026-07-06)

- **Board: select-to-comment everywhere** — the Plans gesture now works on the
  Tracker (component rows, RQs, context/sequencing prose), Timeline (individual
  event cards), and Reviews (threshold, rubric items, top revisions, split)
  views. Comments arrive labeled with the exact element ("row 3: …",
  "Decision 2026-07-06 16:24", "item G3: …").
- **Results uses the same gesture**: metric tiles and artifact cards no longer
  pop a `window.prompt` on click — drag-select there like everywhere else;
  comments keep their structured metric/artifact/report targets.
- **Scoped anchors**: highlights are anchored inside the stamped element
  (stable `data-annot-scope` ids), so short repeated strings can't repaint on
  the wrong row and timeline filtering can't corrupt or mis-flag comments
  (found in cross-model review, Codex GPT-5.5).
- Highlight styling applies outside rendered markdown (table cells, cards);
  sign-off gate "request changes" now sends the same client-assembled feedback
  document as every other path.

## 0.6.1 (2026-07-03)

- **Reconcile mode**: `/research-plans:results` with no argument walks the
  tracker for components that are done without a bundle (or whose verified
  sources have drifted, or with interrupted staging dirs) and backfills them
  one interview at a time — component-first, plan-Verification-anchored,
  never silent bulk capture.
- **`late: true`** manifest flag + "captured late" board chip for plan-governed
  work captured after the fact (the results analogue of the decision log's
  late-captured label); reports must state it. Adopt (`--adopt`) stays the
  route for work no plan governed.
- Mid-session capture guidance: candidate matching via plan-promised outputs,
  slug/number filename heuristics, and script git history when session
  context is thin.

## 0.6.0 (2026-07-03)

- **Results layer**: versioned, immutable result bundles per component
  (`plans/execution/<slug>/results/rN/` — report, figure/table snapshots with
  sha256 provenance, script snapshots, key metrics). Capture via
  `/research-plans:results` (or `--adopt` for pre-existing artifacts;
  `provenance: retrofit`), staging-then-atomic-rename via `results.py`.
- **Board: fifth view (Results)** — version strip with plan tags and verdict
  badges, verdict banner (Accept / Request changes), metric tiles, figure/table
  gallery (tables via a whitelist-sanitizing renderer), per-artifact
  "produced by" script drawer with line-anchored comments.
- **Verdicts are recorded acts, not gates**: accept/request-changes flows back
  as an action block; the session applies it (`results.py verdict`), logs it,
  and marks the tracker `done (verified)`. verdict.json is written once.
- Sign-off hook now also enforces bundle immutability (synchronous policy;
  never opens a browser; one-time verdict.json creation allowed).
- `/sync` offers capture when components hit done or sources drift;
  `/status` flags unverified done components and drifted verified results.
  Payload schemaVersion 2. Design doc: `docs/specs/2026-07-03-results-layer-design.md`.

## 0.5.0 (unreleased)

- **Remote plan review**: `/research-plans:board --share [component]` exports a self-contained, annotatable board file (`plans/board-share.html`, gitignored) to email to collaborators — no accounts, no hosting, browser-only. Collaborators annotate, enter their name, and download a `board-feedback-*.txt` file to send back; `/research-plans:board --collect <file>` routes it through the normal feedback pipeline with reviewer attribution and a staleness check (Python-side `shareHash`). Focused shares (`--focus`) embed only that component's plans plus the master plan (always visible by design). Remote gate approval is explicitly out of scope — sign-off stays local. Design doc: `docs/specs/2026-07-03-remote-plan-review-design.md`.

## 0.4.0 (2026-07-02)

- **Adds a PreToolUse hook** (the sign-off gate): writing a signed plan version (`plans/execution/<component>/vN.md`) in an initialized project now blocks until the researcher approves the rendered plan in their browser; requesting changes returns the feedback to Claude and the gate reopens. The hook also mechanically denies edits to, or overwrites of, existing signed versions. Scope: Claude's Write/Edit tools, dual-marker projects only. Bypass for headless work: `RESEARCH_PLANS_NO_GATE=1` (leaves a stderr trace). This is the plugin's first hook — review `hooks/hooks.json` and `skills/managing-research-plans/scripts/signoff_gate.py` before updating if that matters to you.
- Board gains a gate mode (Approve / Request changes; Approve disabled while unsent comments exist).
- plan/sync sign-off steps reframed around the gate; board preview during dialogue stays optional.

## 0.3.0 (2026-07-02)

- Research-question anchoring: numbered RQs in the master plan, a Serves column, components derived from the research design (repo scans set status only).
- Execution plans open with a constitutive "Goal and success criteria" section (with Serves line).
- Mid-session adoption made explicit: the session's history feeds the plan, never the log; `Initialized:` timestamp is the adoption cutoff.
- Rubric v0.2 ("What Counts as a Plan"): two-stage review — a 9-check pass/fail threshold with near-miss verdicts (PASS / UNDETERMINED / FAIL), then an 8-item engagement grade. Scorecards move to schemaVersion 2 with a threshold block.

## 0.2.0 (2026-07-02)

- The board: browser dashboard (tracker, plan reader with version diffs, decision timeline, review scorecards) with live text-anchored annotation feeding back into the session, and a static single-file export (`plans/board.html`).
- Unsigned drafts (`.draft-vN.md`, gitignored) enable pre-sign-off review; review can save scorecards.

## 0.1.0 (2026-07-02)

- Initial release: master plan with components tracker, versioned per-component execution plans (immutable, researcher-signed), append-only decision log, plan-quality rubric draft, split criteria, opt-in via dual markers, five commands and one ambient skill.
