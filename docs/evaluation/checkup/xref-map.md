# Cross-reference map — "see X step N" pointers

Every cross-file step reference, verified to resolve. These couple files by *step position*: renumbering a step in one file silently breaks a pointer in another. All checked pointers currently **resolve** (so none is filed as stale without evidence — codex's caution), but the coupling is fragile and is a restructuring hazard the fix batches must respect. Raw search: `searches/xrefs.txt`.

## Load-bearing pointers (verified resolve)

| Pointer (citing site) | Target | Resolves? |
|---|---|---|
| "see review.md step 4" — `board.md:33`, `sync.md:30`, `adopt.md:22` | `review.md:15` step 4 = "Save the scorecard … Idempotent, non-blocking save" | ✓ resolves |
| "/research-plans:plan step 5" — `board.md:25` | `plan.md:26` step 5 = "Write the plan" (draft-write mechanics) | ✓ resolves |
| "board steps 4–5" — `plan.md:34`, `results.md:23` | `board.md` step 4 = Serve, step 5 = Route | ✓ resolves |
| "as `/research-plans:init` step 1 / step 6" — `renew.md:9,21` | `init.md` step 1 = project root, step 6 = CLAUDE.md block | ✓ resolves |
| "steps 2-7" / "step 8" self-refs — `results.md:23,25,32` | intra-file (results.md's own steps) | ✓ resolves |

## Verdict

- **0 stale** among the load-bearing pointers — all resolve today.
- **Fragility, not error:** the pointers are position-coupled across files. Any fix batch that renumbers or moves steps in `review.md`, `plan.md`, `board.md`, or `init.md` must update the inbound pointers listed above. Recorded here as a restructuring constraint, not a finding.
- The full enumeration of every `step N` mention (Task-6 sweep, against `searches/xrefs.txt`) confirms the rest; only the cross-file (not intra-file) pointers carry drift risk, and those are the ones tabled above.
