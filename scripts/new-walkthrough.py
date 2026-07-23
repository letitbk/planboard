#!/usr/bin/env python3
"""Create a disposable scratch project for the walkthrough harness (component 01).

Usage:
    python3 scripts/new-walkthrough.py [parent-dir]

Creates <parent-dir>/wt-YYYYMMDD-HHMMSS/ (default parent: ~/walkthroughs)
containing a synthetic solo-quant survey project — research brief (README.md)
plus data/survey.csv — initialized as a git repository, ready for a full
planboard workflow loop against the LOCAL dev plugin.

The dataset is generated deterministically (fixed seed), so every scratch
project carries identical data: runs are comparable and nothing sensitive
ever enters the loop. Python stdlib only, matching plugin conventions.
"""

import csv
import random
import subprocess
import sys
from datetime import datetime
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
SEED = 20260706
N_ROWS = 2000

EDU_LEVELS = ["high school", "some college", "bachelor", "graduate"]

README = """\
# Social media and trust in science — walkthrough project

Synthetic solo-quant scenario for the planboard walkthrough harness.
All data are simulated (seed {seed}); nothing here is real.

## Research questions

1. RQ1 (descriptive): How does trust in science vary across education levels
   and regions?
2. RQ2 (regression): Does social media use predict trust in science, net of
   demographics (age, gender, education, income, ideology)?

## Data

`data/survey.csv` — synthetic national survey, n = {n}.

| Column | Meaning |
|--------|---------|
| id | respondent id |
| age | years (18–80) |
| gender | female / male / nonbinary |
| edu | high school / some college / bachelor / graduate |
| region | Northeast / Midwest / South / West |
| income | household income, USD; blank = missing, -9 = refused |
| social_media_hours | hours per day; blank = missing |
| ideology | 1 = very liberal … 7 = very conservative |
| trust_science | 1–7, higher = more trust |

## Planned analyses

Descriptives of trust_science by education and region; a regression of
trust_science on social_media_hours plus demographic controls. Income
missing codes must be handled before modeling.
""".format(seed=SEED, n=N_ROWS)

GITIGNORE = """\
logs/
"""


def make_rows():
    rng = random.Random(SEED)
    rows = []
    for i in range(1, N_ROWS + 1):
        age = rng.randint(18, 80)
        gender = rng.choices(
            ["female", "male", "nonbinary"], weights=[52, 46, 2]
        )[0]
        edu = rng.choices(EDU_LEVELS, weights=[28, 30, 27, 15])[0]
        edu_score = EDU_LEVELS.index(edu)
        region = rng.choices(
            ["Northeast", "Midwest", "South", "West"], weights=[17, 21, 38, 24]
        )[0]
        ideology = rng.randint(1, 7)
        sm_hours = round(min(max(rng.gauss(3.2, 2.0), 0.0), 12.0), 1)
        latent = (
            4.0
            + 0.45 * edu_score
            - 0.28 * (ideology - 4)
            - 0.10 * sm_hours
            + rng.gauss(0, 1.1)
        )
        trust = int(min(max(round(latent), 1), 7))
        income = int(max(rng.gauss(62000 + 14000 * edu_score, 28000), 8000))

        # Injected missingness: blanks for item nonresponse, -9 for refusals.
        r = rng.random()
        if r < 0.11:
            income_val = ""
        elif r < 0.13:
            income_val = -9
        else:
            income_val = income
        sm_val = "" if rng.random() < 0.06 else sm_hours

        rows.append(
            [i, age, gender, edu, region, income_val, sm_val, ideology, trust]
        )
    return rows


def main():
    parent = (
        Path(sys.argv[1]).expanduser()
        if len(sys.argv) > 1
        else Path.home() / "walkthroughs"
    )
    target = parent / f"wt-{datetime.now():%Y%m%d-%H%M%S}"
    (target / "data").mkdir(parents=True)

    (target / "README.md").write_text(README)
    (target / ".gitignore").write_text(GITIGNORE)
    with open(target / "data" / "survey.csv", "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "id",
                "age",
                "gender",
                "edu",
                "region",
                "income",
                "social_media_hours",
                "ideology",
                "trust_science",
            ]
        )
        writer.writerows(make_rows())

    for cmd in (
        ["git", "init", "-q"],
        ["git", "add", "-A"],
        ["git", "commit", "-q", "-m", "walkthrough scenario: synthetic survey project"],
    ):
        subprocess.run(cmd, cwd=target, check=True)

    print(f"Scratch project ready: {target}")
    print()
    print("Launch the walkthrough:")
    print(f"  cd {target}")
    print(f"  claude --plugin-dir {PLUGIN_ROOT}")
    print()
    print("Then start the loop with /planboard:init")
    print()
    print(
        "Note: if the marketplace-installed planboard plugin is enabled,\n"
        "it may shadow the dev copy. Check /plugin inside the session; disable\n"
        "the installed one there if both are loaded."
    )


if __name__ == "__main__":
    main()
