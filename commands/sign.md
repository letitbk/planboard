---
description: Sign pending plans — one slim session, tickets, then the finalization transaction
argument-hint: [component name/number]
allowed-tools: Read, Write, Edit, Glob, Grep, AskUserQuestion, Bash(python3:*), Bash(git:*), Bash(ls:*), Bash(date:*)
---

Sign pending execution plans. Load `${CLAUDE_PLUGIN_ROOT}/skills/managing-planboard/references/sign-off.md` and follow its named sections. This command requires an initialized project with a marked `plans/master-plan.md`. If the project is not initialized, say so, suggest `/research-plans:init`, and stop.

1. **Resolve current components.** Read the current tracker and execution plan directories. Only components linked from the current tracker are eligible. A pre-renewal or archived component is permanently browse-only. An unknown name or number is an error that lists the valid current rows and stops.

   With no argument, select every current component that has a pending `.draft-v<N>.md`. Also find every current component with a valid unexpired ticket where the matching `v<N>.md` is absent. With an argument, select that component's pending draft and outstanding ticket. If it has neither, but its latest canonical version has trailer state `amendment`, offer to materialize a re-commitment candidate as described below. Continue only if the researcher accepts. If none of these cases applies, report that there is nothing to sign and stop.

2. **Recover tickets first.** For each valid outstanding ticket, follow **Recovery** and **The finalization transaction** in the sign-off reference without opening a browser. Remove completed items from the launch set.

3. **Materialize an amendment when requested.** Use this recipe only for an explicitly named component whose latest canonical plan has trailer state `amendment`.

   **Re-commitment materialization.** Copy the amendment `v<N>.md` to `.draft-v<N+1>.md`. Use `strip_trailer` from `signoff_gate.py` to strip exactly one canonical final amendment trailer plus its optional preceding `---` separator. Update the title to `v<N+1>`. Set `Supersedes: v<N> — re-commitment for re-execution`. Update the `rp-model` marker's `reported` side to the model used for this authoring pass, and keep its `prescribed` side. Verify that the candidate now parses with trailer state `none`. If it does not, stop and repair it. Run the `/research-plans:review` workflow on the candidate, then include it as an ordinary draft.

4. **Launch once.** If any selected drafts remain, follow **Launching a sign session** in the sign-off reference. One session handles one or many drafts. After the server exits, enumerate tickets and `.sign-feedback-v<N>.md` files on disk. Apply **The finalization transaction** to every valid approved item. Apply each feedback file to its draft, preserve the next draft snapshot before a new review round, run the review workflow again, and relaunch only if the researcher wants to review the revision now. Undecided items remain drafts.

5. **Finish.** Report each signed, revised, and still pending item. The finalization transaction owns each decision-log entry. End with one message that suggests `/research-plans:execute` for the signed component or components. Do not start execution from this command.
