#!/usr/bin/env python3
"""planboard codex handoff — generate/refresh the marked planboard block in a
project's AGENTS.md so a cooperative codex can run the loop by reading the
plugin's shipped references and running its stdlib scripts by absolute path.
Stdlib only.

Subcommand:
    generate --codex-model <id>   write/refresh the planboard block in
                                  <root>/AGENTS.md. Requires the dual opt-in
                                  markers (a marked plans/master-plan.md AND a
                                  planboard marker in CLAUDE.md); without both,
                                  even the Claude sign gate is inactive, so this
                                  refuses (exit 2). A marker-less AGENTS.md is
                                  appended to; an existing block is refreshed;
                                  malformed markers stop the write untouched.
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import signoff_gate  # noqa: E402  (reuse the dual-marker opt-in constants)

SKILL_DIR = Path(__file__).resolve().parents[1]  # skills/managing-planboard
TEMPLATE = SKILL_DIR / "templates" / "agents-md-section.md"
BLOCK_START = "<!-- planboard:start -->"
BLOCK_END = "<!-- planboard:end -->"


def find_root(start=None):
    p = Path(start if start else Path.cwd()).resolve()
    for cand in (p, *p.parents):
        if (cand / "plans" / "master-plan.md").exists():
            return cand
    return p


def dual_markers_ok(root):
    """(ok, reason). Mirrors signoff_gate.find_project_root's opt-in: a marked
    plans/master-plan.md AND a planboard marker in CLAUDE.md."""
    mp = root / "plans" / "master-plan.md"
    if not mp.is_file():
        return False, "no plans/master-plan.md — run /planboard:init first"
    try:
        mtext = mp.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return False, "cannot read plans/master-plan.md (%s)" % e
    if not any(mk in mtext for mk in signoff_gate.MASTER_MARKERS):
        return False, "plans/master-plan.md is missing its planboard marker"
    cm = root / "CLAUDE.md"
    if not cm.is_file():
        return False, "no CLAUDE.md planboard block — the sign gate is inactive; run /planboard:init"
    try:
        ctext = cm.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return False, "cannot read CLAUDE.md (%s)" % e
    if not any(mk in ctext for mk in signoff_gate.CLAUDE_MARKERS):
        return False, "CLAUDE.md is missing its planboard block — the sign gate is inactive; run /planboard:init"
    return True, ""


def render_block(codex_model):
    stamp = "<!-- planboard:agents-handoff root %s model %s -->" % (SKILL_DIR, codex_model)
    body = TEMPLATE.read_text(encoding="utf-8")
    body = body.replace("{{SKILL_DIR}}", str(SKILL_DIR)).replace("{{CODEX_MODEL}}", codex_model)
    return "%s\n%s\n%s\n%s" % (BLOCK_START, stamp, body.rstrip("\n"), BLOCK_END)


def splice(existing, block):
    """(new_text, action). Raises ValueError on malformed markers."""
    n_start, n_end = existing.count(BLOCK_START), existing.count(BLOCK_END)
    if n_start == 0 and n_end == 0:
        sep = "" if existing == "" else ("\n" if existing.endswith("\n") else "\n\n")
        return existing + sep + block + "\n", "appended"
    if n_start != 1 or n_end != 1:
        raise ValueError(
            "AGENTS.md has malformed planboard markers (%d start, %d end)" % (n_start, n_end)
        )
    i, j = existing.index(BLOCK_START), existing.index(BLOCK_END)
    if j < i:
        raise ValueError("AGENTS.md has malformed planboard markers in reverse order")
    return existing[:i] + block + existing[j + len(BLOCK_END):], "refreshed"


def _atomic_write(path, text):
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(str(tmp), str(path))


def cmd_generate(root, codex_model):
    ok, reason = dual_markers_ok(root)
    if not ok:
        print("handoff: %s" % reason, file=sys.stderr)
        return 2
    block = render_block(codex_model)
    target = root / "AGENTS.md"
    claude = root / "CLAUDE.md"
    if target.exists() and claude.exists() and os.path.samefile(str(target), str(claude)):
        print(
            "handoff: AGENTS.md resolves to the same file as CLAUDE.md (symlink or hardlink) — "
            "the codex handoff block cannot share a file with the Claude conventions block; "
            "give AGENTS.md its own file, then rerun",
            file=sys.stderr,
        )
        return 2
    if not target.exists():
        _atomic_write(target, block + "\n")
        print("wrote AGENTS.md (planboard block, model %s)" % codex_model)
        return 0
    try:
        existing = target.read_text(encoding="utf-8")
    except OSError as e:
        print("handoff: cannot read AGENTS.md (%s)" % e, file=sys.stderr)
        return 2
    try:
        new_text, action = splice(existing, block)
    except ValueError as e:
        print("handoff: %s — fix or remove them, then rerun" % e, file=sys.stderr)
        return 2
    _atomic_write(target, new_text)
    print("%s AGENTS.md planboard block (model %s)" % (action, codex_model))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="planboard codex handoff")
    ap.add_argument("--root", default=None, help="project root (default: walk up to plans/master-plan.md)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate", help="write/refresh the planboard block in AGENTS.md")
    g.add_argument("--codex-model", required=True, help="the codex model id to record as provenance")
    args = ap.parse_args(argv)
    root = Path(args.root).resolve() if args.root else find_root()
    if args.cmd == "generate":
        return cmd_generate(root, args.codex_model)
    return 1


if __name__ == "__main__":
    sys.exit(main())
