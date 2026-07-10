# Board control surface 2/3 — React client (rev 2, codex round folded) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Docked side-by-side feedback with two-way click-sync, state-aware action clusters, and a reconnect machine wired to the plan-1 server contracts — with token enforcement landing atomically across both layers.

**Architecture:** Pure libs first (reconnect, drafts, actions, navTarget), then FeedbackPanel + layout, then view wiring, then ONE cross-layer task that flips server token enforcement together with every client sender and the template rebuild. Rebuild + commit `skills/managing-research-plans/assets/board-template.html` with every rendering change.

**Tech Stack:** React 19, TS 5.6, Tailwind v4 defaults, Vitest 3; NEW devDeps `jsdom` + `@testing-library/react` (per-file `// @vitest-environment jsdom` pragma; existing 8 lib tests stay node).

**Spec:** §2–§4. Anchors at `0d01a90`. Codex dispositions approved by BK 2026-07-10.

## Global Constraints

- One annotate gesture (AnnotationLayer); no new comment buttons.
- `canPost = mode === "live"` (`App.tsx:259`) is the action gate; hosted/remote/static get no clusters.
- Uniform gate rule: ALL researcher actions — review menus, plan clusters, AND Results verdict/reopen buttons (`Results.tsx:424` uses only `canPost` today) — hidden when `data.gate` is set.
- Dark variants on every new element. Suites green after every task (`npm --prefix board test`, `python3 -m pytest tests/ -q`).

---

### Task 1: Reconnect reducer (pure lib)

**Files:** Create `board/src/lib/reconnect.ts`, `board/src/lib/reconnect.test.ts` (node env).

**Interfaces (Task 6 consumes verbatim):**

```ts
export type ConnPhase =
  | { kind: "online"; lastBootId: string | null }
  | { kind: "submitting"; lastBootId: string | null }
  | { kind: "accepted"; actionId: string; bootId: string; projectId: string; at: number }
  | { kind: "applying"; actionId: string; bootId: string; projectId: string; since: number }
  | { kind: "stalled"; actionId: string; bootId: string; projectId: string; since: number }
  | { kind: "sleeping"; lastBootId: string | null };

export type ConnEvent =
  | { type: "submit" }
  | { type: "post-accepted"; actionId: string; bootId: string; projectId: string; now: number }
  | { type: "post-failed" }
  | { type: "health"; bootId: string; projectId: string; now: number }
  | { type: "health-miss"; now: number }
  | { type: "reset" };

export const POLL_MS = 3000;
export const SLEEP_AFTER_MISSES = 4;
export const STALL_AFTER_MS = 120_000;
export interface ConnState { phase: ConnPhase; misses: number; projectId: string; }
export function initialConn(projectId: string): ConnState;
export function reduceConn(s: ConnState, e: ConnEvent): ConnState;
export function shouldReload(s: ConnState, e: { bootId: string; projectId: string }): boolean;
```

Semantics (each one test): `stalled` KEEPS actionId/bootId/projectId so recovery detection still works after a stall (codex). `shouldReload(s, health)` = health.projectId === s.projectId AND ((phase accepted/applying/stalled AND health.bootId !== phase.bootId) OR (phase sleeping/online AND s.phase.lastBootId !== null AND health.bootId !== lastBootId)) — sleeping recovery reloads only for the SAME project and a genuinely new boot (codex: foreign-project guard; `lastBootId` is recorded from every same-project health while online). `health` with foreign projectId is ignored in every phase. Misses while accepted/applying/stalled never sleep; online misses ≥ threshold → sleeping. `post-failed` → online (copy-fallback allowed only here). applying + `now-since ≥ STALL_AFTER_MS` → stalled.

- [ ] Steps: failing tests (≈10 cases incl. stalled-recovery, sleeping-foreign-project-ignored, sleeping-same-project-new-boot-reloads) → run FAIL → implement single-switch reducer → run + full suite green → commit `feat(board-ui): reconnect reducer with identity-preserving stall/sleep recovery`.

---

### Task 2: projectId-keyed draft storage + submitted-id clearing

**Files:** Create `board/src/lib/drafts.ts` + `drafts.test.ts` (node, Map-backed fake Storage). Modify `board/src/App.tsx:262-268, :287, :322-335, :411-418, :582, :625, :720` and `board/src/lib/types.ts` (BoardData gains `projectId?: string`, `boardToken?: string`).

**Interfaces:**

```ts
export function liveDraftKey(projectId: string): string;                    // `rp-board:${projectId}:live`
export function draftSuffixKey(projectId: string, suffix: "reviewer" | "seeded"): string;
export function loadDrafts(storage: StorageLike, projectId: string,
                           legacyProject: string, legacyHash: string): Annotation[];
// merges + deletes BOTH legacy keys (`rp-board:${name}:${hash}` and its suffixes)
export function clearSubmitted(storage: StorageLike, projectId: string, ids: string[]): void;
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
```

Live/gate modes use `data.projectId` (injected by plan-1 Task 2; codex: `data.project.name` is just the directory name — `board.py:497`). Remote mode (no meaningful projectId across machines) KEEPS today's `${name}:${payloadHash}` scheme unchanged — remote boards are one-shot files; only live storage gets the stable key. Hosted keys (`webKey` :267) untouched. Fallback: `data.projectId` absent (old payload) → legacy scheme (no behavior change).

- [ ] Steps: failing tests (fresh-empty; legacy merge deletes old incl. suffix keys; clearSubmitted removes only given ids; remote scheme untouched) → FAIL → implement + wire App (live branch only) → suites + `npm run build` → commit `feat(board-ui): projectId-keyed live drafts, clear only submitted ids`.

---

### Task 3: jsdom harness + FeedbackPanel + docked layout with measured header offset

**Files:** Modify `board/package.json` (+`jsdom`, `@testing-library/react`), `board/vite.config.ts` (`test: { environment: "node" }`), `board/src/App.tsx` (:805-913 header/root, :915 main, :1013-1193 drawer). Create `board/src/components/FeedbackPanel.tsx` + `FeedbackPanel.test.tsx` (jsdom pragma), `board/src/lib/useHeaderOffset.ts`.

**Interfaces:**
- `FeedbackPanel` props: the rev-1 list PLUS `className?: string` (codex: it was used but undeclared) — full set: `{ className?, annotations, serverLive, serverStale, hosted, remote, gate, canPost, submitState, pendingVerdict, reviewerName, onReviewerName, onRemove, onSaveHosted, savingIds, onClose, onSubmit, onGateApprove, onGateDeny, onDownload, onCopyFallback, onCardClick }` — copy exact types from the current drawer block usages (`App.tsx:1013-1191`).
- `useHeaderOffset(headerRef) -> number` — ResizeObserver on the `<header>` element; returns its current pixel height (codex: banners make the header taller than 57px; a fixed offset slides the panel under it). Applied as inline style on the docked panel: `style={{ top: offset, height: \`calc(100vh - ${offset}px)\` }}` with `sticky` positioning.
- Layout: header stays the outer sticky element; BELOW it a `<div className="mx-auto flex w-full max-w-[1440px]">` row wraps `<main className="min-w-0 flex-1 px-5 py-6">` (inner content div keeps `max-w-5xl mx-auto`) and, when open: docked form `hidden lg:flex w-[380px] shrink-0 flex-col border-l border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 sticky` (+measured offset), overlay form `lg:hidden fixed right-0 top-0 z-40 h-full w-80 …` + scrim `fixed inset-0 z-30 bg-black/30 lg:hidden` with `onClick={onClose}`. Header inner bar (:808) widens to `max-w-[1440px]`.

- [ ] Steps: add deps + vitest env block, suites green → failing FeedbackPanel.test (cards render; gate footer vs Send footer by props; onCardClick fires; onRemove fires; className lands on the docked wrapper) → FAIL → extract :1013-1191 verbatim into the component (AnnotationCard import moves), implement both forms + `useHeaderOffset`, rewire App → suites + `npm run build` → MANUAL VISUAL CHECK (spec §9): walkthrough project export at 1024/1280/1665px, gate mode (banner-tall header — panel must not underlap), dark both forms, scrim below lg → commit `feat(board-ui): docked FeedbackPanel with measured header offset + jsdom harness`.

---

### Task 4: Click-sync — navRequest pattern, lifted selection, ScriptViewer targets

**Files:** Create `board/src/lib/navTarget.ts` + `navTarget.test.ts` (node). Modify `App.tsx`, `views/PlanReader.tsx:145-148`, `views/Results.tsx:173-194`, `views/Archive.tsx:54-55`, `views/Scorecard.tsx:37,48`, `views/Timeline.tsx:56-64`, `components/ScriptViewer.tsx`, `components/AnnotationLayer.tsx`, `components/FeedbackPanel.tsx`, `board/src/index.css`.

**Interfaces:**
- `NavTarget` as rev-1 (tab/component/planPath/resultsVersion/scriptPath/archivePath/reviewPath/clearTimelineFilter/annotationId/anchored) + `export function navTargetFor(a: Annotation, data: BoardData): NavTarget` (pure, tested per annotation type).
- **navRequest pattern** (codex: define ownership explicitly): App owns `const [navRequest, setNavRequest] = useState<{token: number} & NavTarget | null>(null)`; each view KEEPS its internal `useState` as the source of truth and gains ONE optional prop `navRequest?: {token: number, …view-specific fields}`; the view applies it in a `useEffect` keyed on `navRequest?.token` (translating path → its internal index itself: PlanReader finds `docs.findIndex(d => d.path === planPath)` and also opens Part 2 via its existing `scrollToSection`/`agentOpen` (:151-184) when the anchor needs it; Results maps `resultsVersion → idx` and sets `openScript` when `scriptPath` given; Archive/Scorecard map path → idx; Timeline sets BOTH `filter = "all"` AND `query = ""` (codex: query can also hide the target) when `clearTimelineFilter`). No existing `setIdx` call site changes — internal state stays authoritative; the effect just overrides on each new token.
- Scroll/flash: after `setNavRequest`, App waits two `requestAnimationFrame`s then `document.querySelectorAll('mark[data-annotation="<id>"]')` → first `scrollIntoView({block: "center"})`, add `annot-flash` class to all (CSS in index.css: amber outline pulse ~2s + dark variant). Panel cards get `data-card-id`; reverse direction scrolls the card + flash.
- Reverse click: AnnotationLayer's container gets ONE delegated click/keydown listener that resolves `closest('mark[data-annotation]')` → `onHighlightClick(id)`; ScriptViewer (OUTSIDE any AnnotationLayer — codex, `Results.tsx:676`) gets its OWN handler: it now receives `saved: ScriptCommentAnnotation[]`, renders saved line-range highlights with `data-annotation` attributes on its rows, and calls the same `onHighlightClick`. Marks get `tabIndex=0`; Enter activates.
- Unanchored: `anchored: false` → navigate only + transient "no highlight in this document" notice (styling family of the saveError banner `App.tsx:897-901`).

- [ ] Steps: failing navTarget tests (one per type + provenance-script scriptPath case + unanchored) → FAIL → implement lib → wire views/App/ScriptViewer/panel per pattern → jsdom test for one controlled round-trip (render PlanReader with navRequest token → internal doc switches; user click on a version pill afterwards still works — codex "controls become inert" check) → suites + `npm run build` → manual visual check (card→highlight across tabs incl. a script comment; highlight→card; timeline filtered target; keyboard Enter) → commit `feat(board-ui): two-way click-sync — navRequest pattern, script targets, flash + keyboard`.

---

### Task 5: Action clusters, SIGNOFF/reopen emitters, uniform gate rule

**Files:** Create `board/src/lib/actions.ts` + `actions.test.ts`. Modify `board/src/lib/feedback.ts` (:13-25, :38-48, :57-153), `board/src/lib/types.ts`, `views/Tracker.tsx` (:300-304, :371-470), `views/PlanReader.tsx` (:282-326), `views/Results.tsx` (:322-460), `App.tsx`, `board/src/lib/feedback.test.ts`.

**Interfaces:**

```ts
// types.ts
export interface SignoffRequest { component: string; version: number;
  decision: "approve" | "request-changes"; reason?: string; }
export interface ReopenRequest { component: string; resultsVersion: number; reason: string; }
// feedback.ts — FeedbackMeta gains signoff?: SignoffRequest; reopen?: ReopenRequest.
// buildFeedbackMarkdown SIGNATURE (codex: define it): today's positional params stay
// untouched; add two trailing optionals:
//   buildFeedbackMarkdown(annotations, verdict?, reviewRequest?, reportRequest?,
//                         signoff?: SignoffRequest, reopen?: ReopenRequest)
// (read the exact current param list at feedback.ts:57 first and append after it.)
// Emits, first when present: "## SIGNOFF: <component> v<N> — <decision>" (+ reason
// blockquote); "## REOPEN REQUEST: <component> r<N>" (+ required reason blockquote).
// actions.ts
export interface PlanActionState { kind: "approve" | "signedOff" | "none";
  version?: number; signedOffLine?: string; blockedByComments: boolean; }
export function planActionState(data: BoardData, componentNum: string,
                                pending: Annotation[]): PlanActionState;
export function actionsVisible(data: BoardData): boolean;   // canPost && !data.gate
```

`actionsVisible` replaces the three review guards (`Tracker.tsx:300`, `PlanReader.tsx:301`, `Results.tsx:344`) AND newly wraps the Results verdict buttons (`Results.tsx:424`) and the reopen affordance — every researcher action obeys one rule (codex + spec §3). Cluster placement/state rules as rev-1 (Tracker Plan cell :425-440 + PlanReader version strip :282-326; signedOff badge from `parseExecutionPlan(...).signedOff`, `parse.ts:299-300`; Approve disabled when target-scoped pending comments exist — the `PlanReader.tsx:186-193` filter extracted into `actions.ts`; request-changes inline reason input required when no target comments). App gains `submitSignoff(req: SignoffRequest)` and `submitReopen(req: ReopenRequest)` handlers that post to `/api/feedback` with `action: {kind: "signoff", ...req}` (signoff) or plain body whose markdown/meta carry `reopen` (reopen is comment-tier on the wire; the SERVER never validates it — board.md routes it; plan 1 Task 7 strips it from hand-delivered files). Both include ONLY target-scoped annotations; `clearSubmitted` with exactly those ids.

- [ ] Steps: failing tests (`planActionState` 5 rules; `actionsVisible`; feedback emitter cases: signoff section first + fence key round-trip, reopen section + key, existing emitters unchanged) → FAIL → implement libs → wire views (buttons styled per ReviewMenu family + dark) → suites + `npm run build` → visual check (clusters in all three views; ALL actions gone in gate mode incl. verdict; remote/hosted/static clean; signedOff badge) → commit `feat(board-ui): always-on action clusters + SIGNOFF/reopen emitters under one gate rule`.

---

### Task 6: ATOMIC token enforcement + reconnect wiring

**Files:** Modify `skills/managing-research-plans/scripts/board.py` (do_POST :673-789 — the enforcement flip), `tests/test_board.py` (HTTP token cases), `board/src/App.tsx`, `board/src/views/BatchGate.tsx` (:35-42 post helper, :55, :61, :83 — IN the file list this time), `board/src/components/FeedbackPanel.tsx`, create `board/src/components/ConnBanner.tsx` + `ConnBanner.test.tsx` (jsdom). Template rebuild in the SAME commit.

**Interfaces:**
- Server: do_POST, after `local_request_ok` and the body pre-read, for every `/api/` route: `if not token_ok(body, board_token): self._json(403, {"error": "bad-token"}); return` — flipping plan-1 Task 3's pinned "not yet enforced" test to its enforced counterpart IN THIS COMMIT.
- Client: a single `post(path, body)` helper in App adds `boardToken: data.boardToken` to every body; `submit` (:565), `requestReview` (:594), `requestReport` (:689), `gateApprove` (:651), `gateDeny` (:666), `submitSignoff`/`submitReopen` (Task 5) all route through it; BatchGate's local `post()` (:35-42) reads the token from its `data` prop the same way.
- Reconnect wiring: `useConn(data)` — `setInterval(POLL_MS)` health fetch when `mode === "live"`; dispatch `health`/`health-miss`; `shouldReload(...)` → `location.reload()`. POST helpers dispatch `submit` → on 200 `post-accepted` (response's actionId/bootId/projectId), on network error `post-failed`, on `409 already-accepted` show "already applying your earlier action" (no fallback), on `409 stale-draft` treat EXACTLY like accepted-with-restart: dispatch `post-accepted` with the response identity and show "the plan changed on disk — refreshing the board" (server exits 4; loop relaunches; reload follows — plan-1 Task 5 disposition).
- `ConnBanner` phases: applying → "Applying… the board will refresh itself when Claude is done. Reviewer runs can take many minutes."; stalled → + "still applying — if this session ended, run /board to reconnect."; sleeping → "Board sleeping — run /board in your session to wake it." + `connBlocked` disables every action/submit button (drag-select commenting stays live). Copy-fallback (`App.tsx:1090`) renders ONLY after `post-failed`. Live submit no longer swaps to the "Feedback sent" terminal screen (:784-803) — gate approve/deny and remote keep their existing screens (:759-782 gate, remote unchanged).

- [ ] Steps: failing tests — python: HTTP feedback/approve/deny/batch each 403 without token + 200 with (batch via `spawn_board(root, "--gate-batch")` fixture — seed two drafts; flip the Task-3 pinned test); jsdom: ConnBanner copy per phase + disabled buttons when blocked → FAIL → implement server flip + client plumbing + banner + terminal-screen change → ALL suites + `npm run build`, template committed with both layers → live manual check per rev-1 Task 6 Step 4 (submit → applying; kill server → sleeping + disabled; relaunch same port → tab reloads) → commit `feat(board): boardToken enforced atomically across server, every client sender, and the built template`.

---

## Self-review notes

- Codex items landed: stalled identity + sleeping recovery semantics (T1), projectId storage + remote unchanged (T2), className + measured offset (T3), navRequest ownership + Timeline query + ScriptViewer reverse-click + inertness check (T4), buildFeedbackMarkdown signature + verdict-in-gate hiding (T5), atomic token task incl. BatchGate in file list + stale-draft client behavior (T6).
- Reopen stays a comment-tier wire key by design; its AUTHORITY lives in board.md routing of live-ingress docs only (plan 1 strips it from hand-delivered files; plan 3 words the provenance rule).
- The spec's "no fallback after accepted" is pinned by ConnBanner tests + the reducer's post-failed-only path.
