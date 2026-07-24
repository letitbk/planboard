The design is feasible, but it is not implementation ready as written. The core detection and reload approach fits the current architecture. Excluding `generatedAt` is correct. It is the only time based field created by `collect_payload`, and the repository already treats it as the board’s only volatile field ([board.py:801](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:801), [board.py:2102](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:2102)).

## 1. Feasibility issues

1. High. A fresh `collect_payload()` result is not equivalent to the payload served at boot.

   Boot also adds asset URLs, focused result routing, seeded annotations, `projectId`, and process tokens ([board.py:2936](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:2936), [board.py:2940](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:2940), [board.py:2941](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:2941), [board.py:1300](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:1300)). `build_assets()` mutates each results bundle with URLs and inline text after collection ([board.py:368](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:368)).

   The spec’s Tier 2 collect and `regenerate()` steps do not include this full preparation. As a result:

   - Health can report a false mismatch because the candidate lacks fields present in the served payload.
   - A swap can remove artifact links, focused routing, or seeded comments.
   - Losing `projectId` breaks the stable draft key and reconnect identity, both of which depend on it ([App.tsx:195](/Users/bk/github/research-plans/board/src/App.tsx:195), [App.tsx:221](/Users/bk/github/research-plans/board/src/App.tsx:221), [App.tsx:733](/Users/bk/github/research-plans/board/src/App.tsx:733)).

   A focused probe reproduced the generation mismatch and empty asset map ([probe log:1](/Users/bk/github/research-plans/logs/2026-07-23_13-51-59_live-board-design-probes.log:1)). The implementation needs one canonical snapshot builder used at boot, by health, and by root GET.

2. High. Generation comparison must reject health responses for another project.

   The existing boot reload path first checks `projectId`, and the reducer deliberately ignores foreign projects ([reconnect.ts:51](/Users/bk/github/research-plans/board/src/lib/reconnect.ts:51), [reconnect.ts:104](/Users/bk/github/research-plans/board/src/lib/reconnect.ts:104)). The proposed generation rules compare only generations. If another project later answers on the same port, its generation will almost certainly differ and could cause a reload into that project.

   The generation helper must require the same `projectId`, with the existing `bootId` check running first.

3. High. The composer guard does not cover all transient comment text.

   `AnnotationLayer` has its own unsaved text state ([AnnotationLayer.tsx:55](/Users/bk/github/research-plans/board/src/components/AnnotationLayer.tsx:55)), as does `GeneralCommentBox` ([AnnotationLayer.tsx:212](/Users/bk/github/research-plans/board/src/components/AnnotationLayer.tsx:212)). Other editors live in PlanReader, ScriptViewer, and FeedbackPanel ([PlanReader.tsx:414](/Users/bk/github/research-plans/board/src/views/PlanReader.tsx:414), [ScriptViewer.tsx:134](/Users/bk/github/research-plans/board/src/components/ScriptViewer.tsx:134), [FeedbackPanel.tsx:183](/Users/bk/github/research-plans/board/src/components/FeedbackPanel.tsx:183)).

   Checking `document.activeElement` protects these only while the textarea remains focused. A user can blur an open editor without saving it. The text is not yet in the persisted `annotations` array, which is what App writes to localStorage ([App.tsx:358](/Users/bk/github/research-plans/board/src/App.tsx:358)). Every open transient editor needs the same reload guard, not only the `AnnotationLayer` composer.

4. Medium. The proposed fingerprint does not cover every input that affects the payload.

   Concrete mismatches include:

   - `sourceDrift` hashes source files that can live outside `plans/` ([results.py:528](/Users/bk/github/research-plans/skills/managing-planboard/scripts/results.py:528)).
   - `agentsGitignored` depends on Git ignore state outside `plans/` ([board.py:501](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:501)).
   - `leftoverStaging` includes empty directories, but the proposed fingerprint records files only ([board.py:459](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:459)).
   - `staleBoardHtml` currently considers tickets and other files that the fingerprint proposes excluding ([board.py:449](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:449)). A probe confirmed that an excluded ticket changes this payload field ([probe log:6](/Users/bk/github/research-plans/logs/2026-07-23_13-51-59_live-board-design-probes.log:6)).
   - Inference: applying `.board*` by basename at every depth can hide a real hidden review, script, or artifact. Reviews accept every `*.md` file ([board.py:743](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:743)), and `pathlib` matches hidden Markdown files ([probe log:5](/Users/bk/github/research-plans/logs/2026-07-23_13-51-59_live-board-design-probes.log:5)).

   The spec must either narrow freshness to plan content or expand the fingerprint to every derived payload input.

5. Medium. The state swap needs a more exact concurrency contract.

   The server uses `ThreadingHTTPServer` ([board.py:1080](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:1080)). Concurrent handlers read generation, maps, HTML, and payload metadata at different routes ([board.py:1392](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:1392), [board.py:1404](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:1404), [board.py:1421](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:1421), [board.py:1502](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:1502)).

   Correctness requires replacing one immutable snapshot reference under the lock. Updating five dictionary keys separately is not an atomic swap. Each handler should copy one snapshot reference under the lock, release the lock, and then perform network or file I/O. Otherwise a large artifact response or expensive collect can block all other handlers.

6. Medium. Failure and cache behavior is incomplete.

   `die()` prints and raises `SystemExit` ([board.py:147](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:147)). Other candidate-building stages can also fail while reading assets, reports, or the template ([board.py:368](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:368), [board.py:396](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:396)).

   The last good snapshot must survive failure anywhere in candidate construction, not only inside `collect_payload`. A failed fingerprint must not be cached as successfully collected, or health will stop retrying while that fingerprint remains unchanged.

## 2. Missing steps and edge cases

- Add `generation?: string` to `BoardData`. It is absent today ([types.ts:3](/Users/bk/github/research-plans/board/src/lib/types.ts:3)). It should be optional because static, remote, and hosted payloads do not pass through `serve()`.

- Explicitly disable generation reload during `submitting`. The spec says “online only” but its list of excluded phases omits this real phase ([reconnect.ts:6](/Users/bk/github/research-plans/board/src/lib/reconnect.ts:6), [reconnect.ts:81](/Users/bk/github/research-plans/board/src/lib/reconnect.ts:81)).

- Define held mismatch behavior. If disk returns to the page’s generation while a composer is open, clear the notice. If disk changes to another generation, restart the two-poll debounce before reloading.

- Prevent overlapping health requests. App uses an asynchronous `setInterval`, so a collect lasting more than three seconds can overlap the next poll ([App.tsx:744](/Users/bk/github/research-plans/board/src/App.tsx:744)). Use an in-flight guard or schedule the next poll after the previous one finishes.

- Update the HTTP harness. `serve_in_thread()` passes an unprepared `collect_payload()` result and then overwrites the token read from the lock with the caller payload’s token ([test_board.py:1834](/Users/bk/github/research-plans/tests/test_board.py:1834), [test_board.py:1887](/Users/bk/github/research-plans/tests/test_board.py:1887)). If the new builder stops mutating the caller’s object, POST tests will receive an empty token.

- Test both frozen transports. Gate and ticket sign sessions both carry `mode == "live"` and are separated by `sign.transport` ([board.py:1291](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:1291)). Preserve the existing gate exit codes and ticket timeout contract ([board.py:1701](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:1701), [board.py:1721](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:1721)).

- Extend the artifact test to assert that the regenerated HTML contains the new artifact URL. Merely proving the route works will not catch an omitted `build_assets()` call.

- Add concurrent root GET and health tests. Assert that HTML generation, payload generation, and maps always come from one snapshot.

- Handle deleted artifact or report files as 404. Current handlers call `read_bytes()` without catching an intervening deletion ([board.py:1410](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:1410), [board.py:1427](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:1427)).

- Resolve Git metadata through the real git directory. In a linked worktree, `.git` is a file and the proposed `.git/HEAD` and `.git/index` paths do not exist. This was reproduced in the probe ([probe log:12](/Users/bk/github/research-plans/logs/2026-07-23_13-51-59_live-board-design-probes.log:12)).

## 3. Risks and tradeoffs

- A full collect is expensive because `git_info()` runs two global Git commands and two commands for every tracked payload path ([board.py:165](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:165)). Recollecting once for health and again for root GET doubles that work.

- A stat walk every three seconds is not necessarily “microseconds” for projects with many result artifacts. Multiple tabs multiply these walks even if the candidate cache is shared.

- Every reload resets the current tab, selected component, and scroll position because these are React state initialized from the payload ([App.tsx:202](/Users/bk/github/research-plans/board/src/App.tsx:202)). This will be more disruptive than the existing boot reload path because ordinary disk writes can trigger it.

- Saving the Models view will trigger this mechanism because the server writes `plans/model-profile.md` ([board.py:648](/Users/bk/github/research-plans/skills/managing-planboard/scripts/board.py:648)). That conflicts with the current design, which patches model state without reloading ([App.tsx:214](/Users/bk/github/research-plans/board/src/App.tsx:214)).

- Inference: the stable localStorage key prevents data loss, but it does not migrate annotation targets. An annotation aimed at `.draft-v2.md` can remain stored after that path is renamed, signed, or deleted. `loadDrafts()` merges by annotation ID only ([drafts.ts:29](/Users/bk/github/research-plans/board/src/lib/drafts.ts:29)).

- Old in-flight artifact requests may use the old map after a swap. That is acceptable snapshot behavior if missing files become 404 and old map objects are never mutated.

- The gate, ticket sign, and batch exit contracts remain safe if refresh enablement is fixed once from `not sign_mode`. Checking only `payload["mode"]` would be unsafe because those sessions also use live mode.

## 4. Suggested improvements

1. Introduce an immutable `BootContext` containing `focusResults`, `focusView`, seeded annotations, `projectId`, and the three process identities.

2. Introduce one immutable `LiveSnapshot` containing payload, generation, HTML bytes, artifact map, report map, and fingerprint.

3. Build a candidate once when health detects a fingerprint change. Reuse that exact candidate on root GET instead of running `collect_payload()` again.

4. Use a refresh lock to ensure only one thread builds a candidate. Use a separate short state lock only to read or replace the snapshot reference.

5. Replace basename prefix exclusions with exact relative paths and subtrees. Share the same bookkeeping predicate with `collect_drift` so both calculations agree.

6. Use one `data-reload-guard` convention for all transient editors. Keep the persistent stale notice in separate state from `syncNotice`, which currently clears after 2.5 seconds ([App.tsx:845](/Users/bk/github/research-plans/board/src/App.tsx:845)).

7. Add tests for same-project enforcement, boot precedence, submitting suppression, mismatch cancellation while held, boot-only field preservation, asset injection, linked worktrees, concurrent refreshes, and both sign transports.

## 5. Open questions

1. Does “current disk generation” cover only plan content, or also `sourceDrift`, Git ignore status, and Git head changes? The fingerprint design depends on this boundary.

2. Should the tab that saves a model profile reload, or should its POST response advance that tab’s generation baseline while other tabs reload?

3. What should happen to stored annotations whose plan path disappears after refresh? Keep them as stale feedback, migrate known draft-to-version renames, or ask the user?

4. Should the board preserve its current tab, selected result, and scroll position across a generation reload?

5. Can an abandoned open editor hold refresh indefinitely, or should the notice offer an explicit “Refresh now” action?