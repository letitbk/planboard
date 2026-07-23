---
description: Write or refresh the codex handoff — a planboard AGENTS.md block so a cooperative codex can run the plan/execute/results loop
allowed-tools: Read, AskUserQuestion, Bash(python3:*), Bash(git:*), Bash(ls:*)
---

Generate the codex handoff for this project: a marked planboard block in `AGENTS.md` pointing a cooperative codex at the plugin's shipped references and stdlib scripts by absolute path. Script: `${CLAUDE_PLUGIN_ROOT}/skills/managing-planboard/scripts/handoff.py` (python3, stdlib only). Requires an initialized project with BOTH opt-in markers — a marked `plans/master-plan.md` and the planboard block in `CLAUDE.md`; without both, even the Claude sign gate is inactive, so the script refuses. If either is absent, say so and point to `/planboard:init`, then stop.

1. **Ask for the codex model id.** Use AskUserQuestion (one question): which codex model will author/execute — e.g. `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, or a custom id. This is recorded as self-attested provenance in the plan's `pb-model` marker; do not infer it yourself.

2. **Generate.** Run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/managing-planboard/scripts/handoff.py generate --codex-model <id>` and relay its output faithfully: `wrote/appended/refreshed AGENTS.md …` on success, or the exit-2 refusal reason (missing markers, unreadable or malformed-marker AGENTS.md) verbatim. A marker-less `AGENTS.md` is appended to; an existing planboard block is refreshed in place; nothing outside the markers is touched.

3. **Machine-local note.** The block bakes absolute plugin-cache paths, so it is machine- and version-specific. Run `git check-ignore -q AGENTS.md`; if it is NOT ignored, tell the researcher the file is machine-local and suggest gitignoring it (a collaborator regenerates with `/planboard:handoff` on their own machine), and that re-running this command refreshes the paths after a plugin upgrade. Codex is instructed to fail closed and ask for a rerun if any baked path is missing.
