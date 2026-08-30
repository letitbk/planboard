"""Contract tests for command instructions that have no runtime module."""

import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]


class TestCommandInventoryDocs(unittest.TestCase):
    def test_expected_command_files_exist(self):
        for name in ("adopt", "board", "execute", "init", "models", "plan",
                     "sign",
                     "renew", "report", "results", "review", "sync"):
            self.assertTrue((REPO / "commands" / (name + ".md")).is_file(), name)


class TestInitPortabilityDocs(unittest.TestCase):
    def test_headless_recovery_lists_every_required_answer(self):
        command = (REPO / "commands" / "init.md").read_text(encoding="utf-8")

        self.assertIn("AskUserQuestion is unavailable", command)
        self.assertIn("create nothing", command)
        self.assertIn("/planboard:init Project:", command)
        for field in ("RQs:", "source=", "rough size=", "sensitivity=",
                      "constraints/deadlines=", "target journal=",
                      "model profile=", "reader detail="):
            self.assertIn(field, command)


class TestBoardReviewerPortabilityDocs(unittest.TestCase):
    def test_external_reviewers_have_preflights_and_permission(self):
        command = (REPO / "commands" / "board.md").read_text(encoding="utf-8")

        self.assertIn("Bash(command:*)", command)
        self.assertIn("command -v codex", command)
        self.assertIn("command -v agy", command)
        self.assertIn("not available — pick another reviewer", command)


class TestSignTransactionDocs(unittest.TestCase):
    def test_sign_reference_names_the_shared_procedures(self):
        reference = (REPO / "skills" / "managing-planboard" /
                     "references" / "sign-off.md").read_text(encoding="utf-8")

        for heading in ("## The finalization transaction",
                        "## Launching a sign session", "## Recovery"):
            self.assertIn(heading, reference)
        self.assertIn("--sign [NN-slug] --no-open", reference)
        self.assertIn(".sign-feedback-v<N>.md", reference)
        self.assertIn("Do not rely on stdout alone", reference)

    def test_plan_leaves_a_scored_pending_draft(self):
        command = (REPO / "commands" / "plan.md").read_text(encoding="utf-8")

        self.assertIn("draft ready — it signs at /planboard:execute", command)
        self.assertIn("link it to the draft path", command)
        self.assertNotIn("--gate-batch", command)
        self.assertNotIn("clicks **Approve**", command)

    def test_sync_records_an_amendment_without_a_ticket(self):
        command = (REPO / "commands" / "sync.md").read_text(encoding="utf-8")

        self.assertIn("Amendment recorded, <YYYY-MM-DD>", command)
        self.assertIn("without a ticket or board action", command)
        self.assertIn("amended △", command)
        self.assertNotIn("new signed version", command)

    def test_sign_and_execute_share_the_recommitment_recipe(self):
        sign = (REPO / "commands" / "sign.md").read_text(encoding="utf-8")
        execute = (REPO / "commands" / "execute.md").read_text(encoding="utf-8")
        recipe = ("Copy the amendment `v<N>.md` to `.draft-v<N+1>.md`. "
                  "Use `strip_trailer` from `signoff_gate.py`")

        self.assertIn(recipe, sign)
        self.assertIn(recipe, execute)
        for command in (sign, execute):
            self.assertIn("re-commitment for re-execution", command)
            self.assertIn("trailer state `none`", command)

    def test_board_has_no_plan_approval_route(self):
        command = (REPO / "commands" / "board.md").read_text(encoding="utf-8")

        self.assertNotIn("Sign-off order", command)
        self.assertNotIn("clicked Approve", command)

    def test_board_reopens_on_a_produced_draft(self):
        command = (REPO / "commands" / "board.md").read_text(encoding="utf-8")
        # A produced/refined plan draft is a third reopen trigger beside review/report.
        self.assertIn("produced a new or refined plan draft", command)
        # ...and the reopen focuses that component's draft.
        self.assertIn("reopen the board focused on that component", command)

    def test_results_uses_the_governing_canonical_version(self):
        command = (REPO / "commands" / "results.md").read_text(encoding="utf-8")
        validator = (REPO / "skills" / "managing-planboard" /
                     "templates" / "agents" /
                     "pb-results-validator.md").read_text(encoding="utf-8")

        self.assertIn("governing plan version", command)
        self.assertIn("valid signed or amendment trailer", command)
        self.assertIn("approval does not gate validation eligibility", command)
        self.assertIn("governing plan version", validator)

    def test_live_doctrine_no_longer_routes_approval_through_the_board(self):
        roots = (REPO / "commands", REPO / "skills")
        live_text = "\n".join(
            path.read_text(encoding="utf-8")
            for root in roots
            for path in root.rglob("*.md")
        )

        for stale in ("Approve on the board", "board Approve", "review room",
                      "gate-batch"):
            self.assertNotIn(stale, live_text)


if __name__ == "__main__":
    unittest.main()


class TestBoardLaunchDocs(unittest.TestCase):
    """Every board launch is a foreground-or-harness-background choice. Shell
    backgrounding is a third option that looks equivalent and is not: it hands
    back the shell's status instead of the board's, so board.md step 4's exit
    contract goes unread. Both launch sites must name and refuse it."""

    LAUNCH_DOCS = (
        ("commands/board.md", ("commands", "board.md")),
        ("references/sign-off.md",
         ("skills", "managing-planboard", "references", "sign-off.md")),
    )

    def test_launch_sites_refuse_shell_backgrounding(self):
        for name, parts in self.LAUNCH_DOCS:
            text = REPO.joinpath(*parts).read_text(encoding="utf-8")
            for token in ("disown", "nohup"):
                self.assertIn(token, text,
                              "%s must name %s as a launch to avoid"
                              % (name, token))
            self.assertIn("harness's own background", text,
                          "%s must point at the harness mechanism" % name)


TRIGGER_COMMANDS = ("plan.md", "sign.md", "execute.md", "sync.md")


class TestAuditWiring(unittest.TestCase):
    """The audit must dispatch wherever the review workflow runs on a draft.
    A trigger missing from any of these is a path to execution with no audit."""

    def _cmd(self, name):
        return (REPO / "commands" / name).read_text(encoding="utf-8")

    def test_every_trigger_command_can_dispatch_the_fallback_subagent(self):
        for name in TRIGGER_COMMANDS:
            head = self._cmd(name).split("---")[1]
            self.assertIn("Task", head, name)

    def test_every_trigger_command_runs_the_audit(self):
        for name in TRIGGER_COMMANDS:
            self.assertIn("audit.py", self._cmd(name), name)

    def test_every_trigger_command_names_the_fallback_agent(self):
        for name in TRIGGER_COMMANDS:
            self.assertIn("pb-plan-auditor", self._cmd(name), name)

    def test_plan_command_documents_every_exit_code(self):
        body = self._cmd("plan.md")
        for token in ("Exit 0", "Exit 1", "Exit 3"):
            self.assertIn(token, body)

    def test_the_fallback_is_recorded_through_the_cli_with_a_hash(self):
        body = self._cmd("plan.md")
        self.assertIn("record-fallback", body)
        self.assertIn("--expected-plan-hash", body)

    def test_finalization_migrates_the_audit_path(self):
        # The finalization transaction is defined in the sign-off reference,
        # not in commands/sign.md, so that is where the migration belongs.
        ref = (REPO / "skills" / "managing-planboard" / "references"
               / "sign-off.md").read_text(encoding="utf-8")
        self.assertIn("-audit.md", ref)
        self.assertIn("auditPlanHash", ref)

    def test_sign_audits_a_revised_draft(self):
        self.assertIn("fresh audit", self._cmd("sign.md"))

    def test_init_does_not_describe_the_profile_as_claude_only(self):
        # One stage now runs an independent auditor, not a Claude model.
        self.assertNotIn("which Claude model each stage", self._cmd("init.md"))
        self.assertIn("plan audit", self._cmd("init.md"))

    def _codex_bullet(self):
        body = self._cmd("board.md")
        i = body.index("- **`codex`**")
        return body[i:body.index("- **`gemini`**", i)]

    def test_board_codex_is_not_pinned_to_a_stale_model(self):
        self.assertNotIn("gpt-5.5", self._codex_bullet())

    def test_board_codex_resolves_the_profile_row(self):
        bullet = self._codex_bullet()
        self.assertIn("plan-audit", bullet)
        self.assertIn("model_reasoning_effort", bullet)

    def test_board_codex_maps_every_token(self):
        bullet = self._codex_bullet()
        for token, model in (("codex-sol", "gpt-5.6-sol"),
                             ("codex-terra", "gpt-5.6-terra"),
                             ("codex-luna", "gpt-5.6-luna")):
            self.assertIn(token, bullet)
            self.assertIn(model, bullet)

    def test_board_codex_stays_read_only(self):
        self.assertIn("--sandbox read-only", self._codex_bullet())

    def test_plan_scope_uses_the_gaps_contract(self):
        self.assertIn("Plan scope uses the audit contract", self._cmd("board.md"))


class TestActivationContract(unittest.TestCase):
    SKILL = REPO / "skills" / "managing-planboard" / "SKILL.md"

    def setUp(self):
        self.text = self.SKILL.read_text(encoding="utf-8")

    def _activation_section(self):
        start = self.text.index("## When this applies")
        return self.text[start:self.text.index("## Core pattern", start)]

    def test_both_markers_still_gate_applicability(self):
        self.assertIn("<!-- planboard:master-plan -->", self.text)
        self.assertIn("<!-- planboard:start -->", self.text)
        self.assertIn("legacy", self.text)

    def test_activating_commands_are_named(self):
        section = self._activation_section()
        for cmd in ("/planboard:plan", "/planboard:execute", "/planboard:sign",
                    "/planboard:sync", "/planboard:results",
                    "/planboard:review", "/planboard:adopt",
                    "/planboard:renew"):
            self.assertIn(cmd, section, cmd)
        self.assertIn("An activating command is running", section)

    def test_read_only_commands_do_not_activate(self):
        section = self._activation_section()
        self.assertIn("do not activate", section)
        for cmd in ("/planboard:board", "/planboard:report",
                    "/planboard:models"):
            self.assertIn(cmd, section, cmd)

    def test_activation_is_scoped_not_sticky(self):
        self.assertIn("does not persist for the rest of the session",
                      self.text)

    def test_an_unsigned_draft_governs_nothing(self):
        self.assertIn("governs nothing", self.text)

    def test_artifact_integrity_is_separate_from_activation(self):
        self.assertIn("Artifact integrity is not activation", self.text)
        self.assertIn("invoked or not", self.text)

    def test_the_ambient_session_start_rule_is_gone(self):
        self.assertNotIn("**Session start.** Read `plans/master-plan.md`",
                         self.text)

    def test_frontmatter_no_longer_triggers_on_session_start(self):
        frontmatter = self.text.split("---")[1]
        self.assertNotIn("when a session starts there", frontmatter)
        self.assertNotIn("when executing analysis or data work", frontmatter)
        self.assertIn("when a planboard command runs", frontmatter)
        self.assertIn("signed execution plan", frontmatter)


class TestClaudeMdBlock(unittest.TestCase):
    BLOCK = (REPO / "skills" / "managing-planboard" / "templates" /
             "claude-md-section.md")

    RULE_NAMES = (
        "Read the governing plan first",
        "Plan versions are immutable",
        "Log decisions in real time",
        "Interpretive choices are the researcher's",
        "Output conventions",
        "Evidence before claims",
        "Assumptions and restraint",
    )

    def setUp(self):
        self.text = self.BLOCK.read_text(encoding="utf-8")

    def test_markers_are_intact(self):
        self.assertTrue(self.text.startswith("<!-- planboard:start -->"))
        self.assertIn("<!-- planboard:end -->", self.text)

    def test_seven_named_rules_in_order(self):
        positions = []
        for name in self.RULE_NAMES:
            self.assertIn(name, self.text, name)
            positions.append(self.text.index(name))
        self.assertEqual(positions, sorted(positions))

    def test_exactly_seven_numbered_rules(self):
        import re
        numbered = re.findall(r"^(\d+)\. \*\*", self.text, re.MULTILINE)
        self.assertEqual(["1", "2", "3", "4", "5", "6", "7"], numbered)

    def test_the_ambient_preamble_is_gone(self):
        self.assertNotIn("These rules apply to every session in this "
                         "repository", self.text)

    def test_already_decided_clause_is_present(self):
        self.assertIn("already stated a decision", self.text)
        self.assertIn("rather than asking again", self.text)

    def test_pause_when_exceeding_the_plan_is_deleted(self):
        self.assertNotIn("about to exceed what the current execution plan "
                         "covers", self.text)

    def test_tracker_update_rule_is_deleted(self):
        self.assertNotIn("After execution work, update the Components table",
                         self.text)

    def test_plan_authoring_standard_is_deleted(self):
        self.assertNotIn("read cold by a coauthor", self.text)

    def test_target_journal_placeholder_survives(self):
        self.assertIn("<target journal>", self.text)


class TestRuleReferencesAreNamed(unittest.TestCase):
    # split-criteria.md's "rule 1" is split-criteria's OWN rule, not a
    # CLAUDE.md rule. It is the only legitimate numbered rule reference.
    ALLOWED = {"skills/managing-planboard/references/split-criteria.md"}

    def test_no_markdown_refers_to_a_claude_md_rule_by_number(self):
        import re
        pattern = re.compile(r"rule \d+", re.IGNORECASE)
        offenders = []
        for root in (REPO / "commands", REPO / "skills"):
            for path in sorted(root.rglob("*.md")):
                if "node_modules" in path.parts:
                    continue
                rel = path.relative_to(REPO).as_posix()
                if rel in self.ALLOWED:
                    continue
                text = path.read_text(encoding="utf-8")
                for match in pattern.finditer(text):
                    start = max(0, match.start() - 50)
                    offenders.append("%s: ...%s..." %
                                     (rel, text[start:match.end() + 50]))
        self.assertEqual([], offenders)

    def test_the_named_references_landed(self):
        checks = {
            "commands/init.md": ["**Evidence before claims**",
                                 "**Output conventions**"],
            "commands/renew.md": ["**Output conventions**"],
            "commands/plan.md": ["**Output conventions**"],
            "commands/results.md": ["**Output conventions**"],
            "skills/managing-planboard/SKILL.md": ["**Output conventions**"],
            "skills/managing-planboard/templates/execution-plan.md":
                ["**Output conventions**"],
            "skills/managing-planboard/references/planning-doctrine.md":
                ["**Evidence before claims**"],
            "skills/managing-planboard/references/execution-loop.md":
                ["**Interpretive choices are the researcher's**",
                 "**Evidence before claims**"],
        }
        for rel, needles in checks.items():
            text = (REPO / rel).read_text(encoding="utf-8")
            for needle in needles:
                self.assertIn(needle, text, "%s: %s" % (rel, needle))

    def test_split_criteria_own_rule_is_untouched(self):
        text = (REPO / "skills" / "managing-planboard" / "references" /
                "split-criteria.md").read_text(encoding="utf-8")
        self.assertIn("a new component by rule 1", text)


class TestPushBackIsScoped(unittest.TestCase):
    def test_push_back_is_bounded_to_plan_authoring(self):
        text = (REPO / "commands" / "plan.md").read_text(encoding="utf-8")
        self.assertIn("push back on a bare pick on a consequential fork", text)
        self.assertIn("only while authoring a plan", text)
        self.assertIn("never to an ordinary work request", text)


class TestBlockRefreshIsAnnounced(unittest.TestCase):
    def test_update_mode_says_the_block_changed(self):
        text = (REPO / "commands" / "init.md").read_text(encoding="utf-8")
        self.assertIn("upgrade the CLAUDE.md section (step 6)", text)
        self.assertIn("the standing rules changed", text)
