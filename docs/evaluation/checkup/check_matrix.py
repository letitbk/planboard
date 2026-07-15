#!/usr/bin/env python3
"""check_matrix.py — the scenario-matrix closure gate.

Exit 0 only when every data row of scenario-matrix.md has all required fields
filled and a terminal status (PASS | FAIL | NOT-RUN:<reason>). Exit 1 (listing
offenders) otherwise. Task 12 Step 1 runs this before synthesis; a PENDING row
or any blank required cell blocks the findings document.
"""
import re
import sys
import pathlib

REQUIRED = ["id", "scenario", "surfaces", "task", "fixture", "command",
            "oracle", "expected", "actual", "evidence", "runs",
            "environment", "status"]
TERMINAL = re.compile(r"^(PASS|FAIL|NOT-RUN:.+)$")


def _cells(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def validate(md):
    rows = [_cells(ln) for ln in md.splitlines() if ln.startswith("|")]
    if len(rows) < 3:
        return ["no data rows"]
    header = [h.lower() for h in rows[0]]
    problems = []
    for r in rows[2:]:
        # skip separator-like rows (all cells empty or only dashes)
        if all((not c) or set(c) <= set("-") for c in r):
            continue
        rec = dict(zip(header, r))
        rid = rec.get("id", "?")
        for f in REQUIRED:
            if not rec.get(f, "").strip():
                problems.append("%s: missing '%s'" % (rid, f))
        st = rec.get("status", "").strip()
        if st and not TERMINAL.match(st):
            problems.append("%s: status '%s' not terminal "
                            "(PASS|FAIL|NOT-RUN:<reason>)" % (rid, st))
    return problems


def _selftest():
    header = ("| id | scenario | surfaces | task | fixture | command | oracle "
              "| expected | actual | evidence | runs | environment | status |")
    sep = "|" + "---|" * 13
    row = ("| S1 | x | a.py | T8 | fx | cmd | orc | exp | act | e.md | 1 | mac "
           "| PASS |")
    complete = "\n".join([header, sep, row]) + "\n"
    pending = complete.replace("| PASS |", "| PENDING |")
    assert validate(complete) == [], "complete matrix must report no problems"
    assert any("S1" in p for p in validate(pending)), \
        "a PENDING row must be flagged as incomplete"
    print("selftest OK")


def main(path):
    md = pathlib.Path(path).read_text(encoding="utf-8")
    problems = validate(md)
    if problems:
        print("MATRIX INCOMPLETE — synthesis blocked:")
        for p in problems:
            print("  -", p)
        return 1
    print("MATRIX COMPLETE — all rows terminal.")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
        sys.exit(0)
    arg = sys.argv[1] if len(sys.argv) > 1 else \
        "docs/evaluation/checkup/scenario-matrix.md"
    sys.exit(main(arg))
