# Model profile

<!-- planboard:model-profile -->

How each planboard stage picks its model or reviewer. Three mechanisms — **nudge**: Claude tells you the profile's model for this stage and suggests `/model`; you decide. **agent**: this delegated stage runs on the profile's model automatically (best-effort — an org model allowlist, `CLAUDE_CODE_SUBAGENT_MODEL`, or a per-invocation override can supersede the request). **reviewer**: this stage runs an independent auditor rather than a Claude model; the model cell holds a reviewer token (`codex-sol`, `codex-terra`, `codex-luna`, or `subagent`), the effort cell applies to whichever reviewer runs, and the row is edited with `/planboard:models` rather than on the board. `inherit` in a model cell means "whatever your session is using."

| stage | model | effort | mechanism |
|---|---|---|---|
| plan (co-authoring) | opus | max | nudge |
| execute (analysis) | sonnet | — | nudge |
| sync | inherit | — | nudge |
| plan review (verdict + grade) | opus | medium | agent |
| results validation | opus | low | agent |
| board reviewer panel | opus | low | agent |
| plan audit (deep) | codex-sol | xhigh | reviewer |

Why these defaults: planning is where quality compounds, so it gets the strongest model at max effort. Execution is interactive and iterative, so a fast cheap model stretches subscription quota. Review and validation are short judgment tasks where a smarter prior catches what longer thinking on a weaker model misses — hence opus at low or medium effort. The plan audit is the one stage deliberately run by a different model family: its whole value is that an independent auditor sees what the model that wrote the plan cannot, so it defaults to Codex at `xhigh`. `effort` on nudge rows is advisory; on agent rows it is written into the generated agent file.

After hand-editing this table, run `/planboard:models` to validate it and regenerate the agents in `.claude/agents/` — a silent typo in a row otherwise just stops that stage's nudge or pin.
