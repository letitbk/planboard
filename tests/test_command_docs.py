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
