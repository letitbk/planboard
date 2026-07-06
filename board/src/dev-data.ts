// Sample payload for `npm run dev` only. The string RP_BOARD_DEV_DATA below is
// a tree-shake sentinel: the build check greps the built template to confirm
// this module was eliminated from production output.
import type { BoardData } from "./lib/types";

const MARKER = "RP_BOARD_DEV_DATA";

const masterPlan = `<!-- research-plans:master-plan -->
# Immigration Attitudes (ISSP) — Master Plan

Last updated: 2026-07-02
Initialized: 2026-06-28 09:15

## Project context

This project is a cross-national analysis of immigration attitudes using ISSP data (${MARKER}). It asks how support for immigration varies across countries and what individual- and country-level factors account for that variation.

The hard constraint is the deadline: end of July 2026.

### Research questions

1. RQ1: How does public support for immigration vary across countries and over time?
2. RQ2: Which individual- and country-level factors are associated with that variation?

## Components

| # | Component | Status | Execution plan | Outcome / notes | Serves |
|---|-----------|--------|----------------|-----------------|--------|
| 1 | Data acquisition | done | — | ISSP sample in repo | — |
| 2 | Data cleaning | done | [v2](execution/02-data-cleaning/v2.md) | 66,864 rows after exclusions | RQ1, RQ2 |
| 3 | Descriptive analysis | in progress | [v1](execution/03-descriptives/v1.md) | — | RQ1 |
| 4 | Regression modeling | not started | — | — | RQ2 |

Statuses: \`not started\` / \`planned\` / \`in progress\` / \`done\` / \`dropped\`.
`;

const decisionLog = `# Decision Log

Append-only. Entries are timestamped and written as decisions happen.

## 2026-07-01 10:12

**Context:** Starting data cleaning under plan v1.
**Question (Claude):** The codebook lists 97/98 as refusal codes for the support item. Treat as missing?
**Response (researcher):** Yes — recode to NA; add a count to the cleaning log.
**Effect on execution:** Added recode step; 431 rows affected.

## 2026-07-01 15:40

**Context:** Cleaning revealed duplicated household IDs in two countries.
**Decision (Claude):** Flagged rather than dropped — awaiting researcher call.
**Response (researcher):** Drop exact duplicates only; keep the rest.
**Effect on execution:** Plan revision proposed (v2) to record the exclusion rule.

## 2026-07-02 09:05 (late-captured at sync)

**Context:** Yesterday's session ended without logging the weighting decision.
**Question (Claude):** Use ISSP design weights in descriptives?
**Response (researcher):** Yes, weighted and unweighted side by side.
**Effect on execution:** Descriptives plan updated before execution.
`;

const cleaningV1 = `# Data Cleaning — Execution Plan v1

Component: \`02-data-cleaning\` · Master plan: [master-plan.md](../../master-plan.md) · Date: 2026-06-30

## Context

Prepare the ISSP extract for analysis: recode missing values, harmonize country codes, and produce a documented analysis sample.

## Scope decisions

| Dimension | Decision | Why |
|-----------|----------|-----|
| Missing codes | Recode 97/98 to NA | Codebook lists them as refusals |
| Countries | Keep all 31 | Attrition handled at modeling stage |

## Approach

Load raw extract, apply recode table, write cleaned parquet + cleaning log.

## Build steps

1. Load raw CSV
2. Apply missing-value recodes
3. Write cleaned data + row-count log

## Verification

Row counts before/after each step logged; spot-check 20 random rows against raw.

## Out of scope

No imputation; no derived scales (descriptives component owns those).

---
Signed off: Jane Doe, 2026-06-30
`;

const cleaningV2 = `# Data Cleaning — Execution Plan v2

Component: \`02-data-cleaning\` · Master plan: [master-plan.md](../../master-plan.md) · Date: 2026-07-01
Supersedes: v1 — duplicated household IDs discovered in two countries; added an explicit exclusion rule.

## Goal and success criteria

Serves: RQ1, RQ2

Produce a documented analysis sample from the raw ISSP extract. Success: every recode and exclusion is logged with row counts; the cleaned file reproduces exactly from the committed script; the duplicate report is reviewed and signed off by the researcher.

## Context

Prepare the ISSP extract for analysis: recode missing values, harmonize country codes, and produce a documented analysis sample.

## Scope decisions

| Dimension | Decision | Why |
|-----------|----------|-----|
| Missing codes | Recode 97/98 to NA | Codebook lists them as refusals |
| Countries | Keep all 31 | Attrition handled at modeling stage |
| Duplicates | Drop exact duplicates only | Household IDs collide in two countries; partial matches kept |

## Approach

Load raw extract, apply recode table, drop exact duplicates, write cleaned parquet + cleaning log.

## Build steps

1. Load raw CSV
2. Apply missing-value recodes
3. Drop exact duplicate rows (log counts per country)
4. Write cleaned data + row-count log

## Verification

Row counts before/after each step logged; spot-check 20 random rows against raw; duplicate report reviewed by researcher.

## Out of scope

No imputation; no derived scales (descriptives component owns those).

---
Signed off: Jane Doe, 2026-07-01
`;

const descriptivesV1 = `# Descriptive Analysis — Execution Plan v1

Component: \`03-descriptives\` · Master plan: [master-plan.md](../../master-plan.md) · Date: 2026-07-02

## Context

Describe the analysis sample: distribution of the support item by country and year, weighted and unweighted.

## Scope decisions

| Dimension | Decision | Why |
|-----------|----------|-----|
| Weights | ISSP design weights, shown alongside unweighted | Comparability with published CRI descriptives |

## Approach

Compute per-country summaries, export table + one figure.

## Build steps

1. Weighted and unweighted means by country
2. Figure: country means with CIs

## Verification

Totals cross-checked against cleaning log row counts.

## Out of scope

No models; no country-level covariates yet.

---
Signed off: Jane Doe, 2026-07-02
`;

const descriptivesDraft = `# Descriptive Analysis — Execution Plan v2

Component: \`03-descriptives\` · Master plan: [master-plan.md](../../master-plan.md) · Date: 2026-07-02
Supersedes: v1 — reviewer asked for item-level missingness table before means.

## Goal and success criteria

Serves: RQ1

Describe cross-country variation in immigration support with honest missingness reporting. Success: a per-country table (weighted and unweighted) plus a missingness table, each cross-checked against the cleaning log row counts.

## Context

Describe the analysis sample: distribution of the support item by country and year, weighted and unweighted, plus item-level missingness.

## Scope decisions

| Dimension | Decision | Why |
|-----------|----------|-----|
| Weights | ISSP design weights, shown alongside unweighted | Comparability with published CRI descriptives |
| Missingness | Item-level table by country | Reviewer request; informs listwise-deletion defense |

## Approach

Compute missingness table, then per-country summaries, export tables + one figure.

## Build steps

1. Item-level missingness by country
2. Weighted and unweighted means by country
3. Figure: country means with CIs

## Verification

Totals cross-checked against cleaning log row counts.

## Out of scope

No models; no country-level covariates yet.
`;

const review = `# Review — Data Cleaning v2

Plan: [v2.md](../execution/02-data-cleaning/v2.md) · Rubric: plan-rubric.md (draft v0.1) · Date: 2026-07-02
Score: **18 / 22 (82%)** — strong

## Items

| # | Item | Score | Evidence | Justification |
|---|------|-------|----------|---------------|
| 1 | Written and self-contained | 2 | "Prepare the ISSP extract…" | Readable cold |

## Top revisions

1. Name the spot-check seed so verification is reproducible.

## Split assessment

Right-sized: one coherent cleaning component with a single verification routine.

## Data

\`\`\`json board-scorecard
{"schemaVersion":1,"component":"02-data-cleaning","planVersion":2,
 "planPath":"plans/execution/02-data-cleaning/v2.md","rubricVersion":"0.1","date":"2026-07-02",
 "items":[
  {"id":1,"name":"Written and self-contained","score":2,"evidence":"Prepare the ISSP extract for analysis","justification":"Readable cold"},
  {"id":2,"name":"Prospective","score":2,"evidence":"v2 committed 2026-07-01; outputs 2026-07-02","justification":"Plan precedes outputs"},
  {"id":3,"name":"Revisable with versions","score":2,"evidence":"v2 supersedes v1 with reason","justification":"Real event-triggered revision"},
  {"id":4,"name":"Researcher-committed","score":2,"evidence":"Signed off: Jane Doe","justification":"Signed; choices researcher's"},
  {"id":5,"name":"All sections present","score":2,"evidence":"7 sections","justification":"Complete"},
  {"id":6,"name":"Scope decisions carry reasons","score":2,"evidence":"3 rows with reasons","justification":"Each dimension reasoned"},
  {"id":7,"name":"Verification checkable","score":1,"evidence":"spot-check 20 random rows","justification":"No seed named"},
  {"id":8,"name":"Decisions specific and grounded","score":2,"evidence":"duplicate household IDs","justification":"Project-specific"},
  {"id":9,"name":"Domain knowledge non-generic","score":1,"evidence":"codebook refusal codes","justification":"Some grounding"},
  {"id":10,"name":"Choices consequential","score":2,"evidence":"exclusion rule","justification":"Materially affects sample"},
  {"id":11,"name":"Revisions substantive","score":null,"status":"N/A","justification":"Scored at v2 creation"},
  {"id":12,"name":"Another agent could pick it up","score":2,"evidence":"Build steps 1-4","justification":"Concrete"},
  {"id":13,"name":"Out of scope constrains","score":1,"evidence":"No imputation","justification":"Somewhat generic"},
  {"id":14,"name":"Right-sized","score":2,"evidence":"one cleaning component","justification":"Single verification"}],
 "raw":18,"applicableMax":22,"percent":82,"band":"strong",
 "excluded":[{"id":11,"why":"N/A — scored at creation"}],
 "topRevisions":["Name the spot-check seed so verification is reproducible."],
 "split":{"verdict":"right-sized","detail":"One coherent cleaning component with a single verification routine."}}
\`\`\`
`;

const reviewV2Pass = `# Review — Descriptive Analysis v1

Plan: [v1.md](../execution/03-descriptives/v1.md) · Rubric: plan-rubric.md (v0.2) · Date: 2026-07-02
Threshold: **PASS (9/9; T8 N/A, T9 N/A — unexecuted)**
Score: **11 / 14 (79%)** — strong

## Threshold

| ID | Check | Result | Note |
|----|-------|--------|------|
| T1 | Goal + success criteria | pass | goal + cross-check criteria stated |
| T8 | Prospective | na | unexecuted — commit before executing |

## Grading items

| # | Item | Score | Evidence | Justification |
|---|------|-------|----------|---------------|
| G1 | Decisions specific, reasoned, grounded | 2 | "Comparability with published CRI descriptives" | Project-specific reason |

## Top revisions

1. Name the exact weight variable from the codebook.

## Split assessment

Right-sized: one descriptive component with a single verification routine.

## Data

\`\`\`json board-scorecard
{"schemaVersion":2,"component":"03-descriptives","planVersion":1,
 "planPath":"plans/execution/03-descriptives/v1.md","rubricVersion":"0.2","date":"2026-07-02",
 "threshold":{"verdict":"pass","checks":[
  {"id":"T1","name":"Goal + success criteria","result":"pass","evidence":"Success: a per-country table...","note":"explicit criteria"},
  {"id":"T2","name":"Scope decisions with reasons","result":"pass","note":"weights row reasoned"},
  {"id":"T3","name":"Approach / build steps","result":"pass"},
  {"id":"T4","name":"Verification plan","result":"pass","note":"cross-check vs cleaning log"},
  {"id":"T5","name":"Readable cold","result":"pass"},
  {"id":"T6","name":"Goal-driven","result":"pass"},
  {"id":"T7","name":"Executable + fidelity-checkable","result":"pass"},
  {"id":"T8","name":"Prospective","result":"na","note":"unexecuted"},
  {"id":"T9","name":"Revisable","result":"na","note":"no deviation yet"}],
  "failures":[]},
 "items":[
  {"id":"G1","name":"Decisions specific, reasoned, grounded","score":2,"evidence":"Comparability with published CRI descriptives","justification":"Project-specific"},
  {"id":"G2","name":"Domain knowledge non-generic","score":1,"evidence":"ISSP design weights","justification":"Some grounding"},
  {"id":"G3","name":"Choices consequential","score":2,"evidence":"weighted and unweighted side by side","justification":"Shapes evidence"},
  {"id":"G4","name":"Revisions substantive","score":null,"status":"N/A","justification":"unexecuted v1"},
  {"id":"G5","name":"Readability quality","score":2,"evidence":"whole plan","justification":"Reads cold"},
  {"id":"G6","name":"Verification checkability","score":2,"evidence":"cross-checked against cleaning log","justification":"Concrete"},
  {"id":"G7","name":"Out of scope constrains","score":1,"evidence":"No models","justification":"Somewhat generic"},
  {"id":"G8","name":"Right-sized","score":1,"evidence":"one component","justification":"Missingness add-on borderline"}],
 "raw":11,"applicableMax":14,"percent":79,"band":"strong",
 "excluded":[{"id":"G4","why":"N/A — unexecuted v1"}],
 "topRevisions":["Name the exact weight variable from the codebook."],
 "split":{"verdict":"right-sized","detail":"One descriptive component with a single verification routine."}}
\`\`\`
`;

const reviewV2Fail = `# Review — Regression Modeling v1

Plan: [v1.md](../execution/04-regression/v1.md) · Rubric: plan-rubric.md (v0.2) · Date: 2026-07-02
Threshold: **FAIL — T1, T4**

## Threshold

| ID | Check | Result | Note |
|----|-------|--------|------|
| T1 | Goal + success criteria | fail | steps only; no success criteria anywhere |
| T4 | Verification plan | fail | "check the results" names no check |

Nearest archetype: a to-do list — no reasons and no success criteria.

## Top revisions

1. State the goal and the criteria for judging success.
2. Name at least one verification check and where it applies.
3. Give each modeling choice a reason.

## Split assessment

Split not assessable until it is a plan; on its face it also mixes main models and robustness.

## Data

\`\`\`json board-scorecard
{"schemaVersion":2,"component":"04-regression","planVersion":1,
 "planPath":"plans/execution/04-regression/v1.md","rubricVersion":"0.2","date":"2026-07-02",
 "threshold":{"verdict":"fail","checks":[
  {"id":"T1","name":"Goal + success criteria","result":"fail"},
  {"id":"T2","name":"Scope decisions with reasons","result":"fail"},
  {"id":"T3","name":"Approach / build steps","result":"pass"},
  {"id":"T4","name":"Verification plan","result":"fail"},
  {"id":"T5","name":"Readable cold","result":"pass"},
  {"id":"T6","name":"Goal-driven","result":"unknown"},
  {"id":"T7","name":"Executable + fidelity-checkable","result":"pass"},
  {"id":"T8","name":"Prospective","result":"na"},
  {"id":"T9","name":"Revisable","result":"na"}],
  "failures":[
   {"id":"T1","verdict":"No extractable goal or success criteria — a task list, not a plan yet.","fix":"State the goal and the criteria for judging success."},
   {"id":"T2","verdict":"Choices without reasons — what makes a to-do list not a plan.","fix":"Give each modeling choice a reason."},
   {"id":"T4","verdict":"Verification is owed but never named.","fix":"Name at least one check and where it applies."}]},
 "items":[],
 "raw":null,"applicableMax":null,"percent":null,"band":"not a plan",
 "excluded":[],
 "topRevisions":["State the goal and the criteria for judging success.","Name at least one verification check and where it applies.","Give each modeling choice a reason."],
 "split":{"verdict":"split required","detail":"Mixes main models and robustness; split once it clears the threshold."}}
\`\`\`
`;

const FIG_SVG =
  "data:image/svg+xml;base64," +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="280"><rect width="480" height="280" fill="#fafaf9"/><g stroke="#a8a29e"><line x1="50" y1="240" x2="440" y2="240"/><line x1="50" y1="30" x2="50" y2="240"/></g><rect x="80" y="120" width="50" height="120" fill="#15803d"/><rect x="170" y="80" width="50" height="160" fill="#15803d"/><rect x="260" y="150" width="50" height="90" fill="#15803d"/><rect x="350" y="60" width="50" height="180" fill="#15803d"/><text x="240" y="20" font-size="13" text-anchor="middle" fill="#44403c">Support by wave (dev sample)</text></svg>',
  );

const cleaningReport = `# Results — Data cleaning (r1)

The cleaning pipeline ran end to end under plan v2. The analytic sample is
**66,864 rows** after the exclusion rules recorded in the plan; the duplicate
rule (drop exact household duplicates only) removed 214 rows.

Meets the plan's success criteria: row count within the expected range, all
recode counts logged. One anomaly worth eyes: wave 3 has a higher refusal
share (fig-support), consistent with the codebook note.
`;

const descriptivesReport = `# Results — Descriptives (r1, retrofit)

These figures existed before the workflow was adopted; captured for
verification. Weighted and unweighted means diverge most in waves 2-3.
`;

const cleaningResults = [
  {
    resultsVersion: 1,
    dir: "plans/execution/02-data-cleaning/results/r1",
    manifest: {
      schemaVersion: 1,
      component: "02-data-cleaning",
      resultsVersion: 1,
      planVersion: 2,
      provenance: "planned" as const,
      trigger: "initial" as const,
      capturedAt: "2026-07-02 10:30",
      late: true,
      summary: "Cleaning pipeline output under plan v2 (backfilled)",
      metrics: [
        { label: "Rows", value: "66,864", note: "analytic sample" },
        { label: "Dupes dropped", value: "214" },
        { label: "Refusals → NA", value: "431" },
      ],
      artifacts: [
        {
          id: "fig-support",
          kind: "figure" as const,
          title: "Support by wave",
          caption: "Weighted means; error bars omitted in dev sample.",
          file: "artifacts/fig-support.svg",
          source: {
            path: "output/figures/fig-support.svg",
            sha256: "d".repeat(64),
            bytes: 4210,
            oversized: false,
          },
          producedBy: {
            script: "scripts/02_clean.R",
            sourcePath: "code/02_clean.R",
            lang: "r",
          },
        },
        {
          id: "tab-exclusions",
          kind: "table" as const,
          title: "Exclusion cascade",
          caption: "Rows removed at each cleaning step.",
          file: "artifacts/exclusions.csv",
          inlineText:
            "step,rows removed,rows remaining\nraw,0,67295\nmissing outcome,217,67078\nduplicates,214,66864\n",
          source: {
            path: "output/tables/exclusions.csv",
            sha256: "e".repeat(64),
            bytes: 96,
            oversized: false,
          },
          producedBy: {
            script: "scripts/02_clean.R",
            sourcePath: "code/02_clean.R",
            lang: "r",
          },
        },
      ],
    },
    manifestRaw: {
      path: "plans/execution/02-data-cleaning/results/r1/manifest.json",
      content: "{}",
    },
    report: {
      path: "plans/execution/02-data-cleaning/results/r1/report.md",
      content: cleaningReport,
    },
    verdict: {
      status: "accepted" as const,
      date: "2026-07-02 11:05",
      planVersion: 2,
      reviewer: "BK",
      comment: "Counts match the plan; ship it.",
    },
    verdictRaw: {
      path: "plans/execution/02-data-cleaning/results/r1/verdict.json",
      content: "{}",
    },
    scripts: [
      {
        path: "plans/execution/02-data-cleaning/results/r1/scripts/02_clean.R",
        content:
          "library(dplyr)\n\nraw <- read_issp('data/raw')\nclean <- raw |>\n  filter(!is.na(support)) |>\n  mutate(support = na_if(support, 97), support = na_if(support, 98)) |>\n  distinct(hh_id, .keep_all = TRUE)\n\nwrite_csv(count_exclusions(raw, clean), 'output/tables/exclusions.csv')\nggsave('output/figures/fig-support.svg', plot_support(clean))\n",
      },
    ],
    assets: { "fig-support.svg": FIG_SVG },
  },
];

const descriptivesResults = [
  {
    resultsVersion: 1,
    dir: "plans/execution/03-descriptives/results/r1",
    manifest: {
      schemaVersion: 1,
      component: "03-descriptives",
      resultsVersion: 1,
      planVersion: null,
      provenance: "retrofit" as const,
      trigger: "initial" as const,
      capturedAt: "2026-07-02 14:00",
      summary: "Pre-existing descriptive figures, adopted for verification",
      metrics: [{ label: "Countries", value: "31" }],
      artifacts: [
        {
          id: "fig-means",
          kind: "figure" as const,
          title: "Country means",
          file: "artifacts/fig-means.svg",
          source: {
            path: "figures/fig-means.svg",
            sha256: "f".repeat(64),
            bytes: 3900,
            oversized: false,
          },
          producedBy: null,
        },
      ],
    },
    manifestRaw: {
      path: "plans/execution/03-descriptives/results/r1/manifest.json",
      content: "{}",
    },
    report: {
      path: "plans/execution/03-descriptives/results/r1/report.md",
      content: descriptivesReport,
    },
    verdict: null,
    verdictRaw: null,
    scripts: [],
    assets: { "fig-means.svg": FIG_SVG },
  },
];

export const devData: BoardData = {
  schemaVersion: 1,
  generatedAt: "2026-07-02T12:00:00-04:00",
  mode: "live",
  focus: null,
  project: { name: "issp-immigration-dev", root: "/dev/sample" },
  git: {
    available: true,
    branch: "main",
    head: "abc1234",
    fileDates: {
      "plans/execution/02-data-cleaning/v1.md": {
        firstCommit: "2026-06-30T09:00:00-04:00",
        lastCommit: "2026-06-30T09:00:00-04:00",
      },
      "plans/execution/02-data-cleaning/v2.md": {
        firstCommit: "2026-07-01T16:00:00-04:00",
        lastCommit: "2026-07-01T16:00:00-04:00",
      },
    },
  },
  files: {
    masterPlan: { path: "plans/master-plan.md", content: masterPlan },
    decisionLog: { path: "plans/decision-log.md", content: decisionLog },
    executionPlans: [
      {
        component: "02-data-cleaning",
        versions: [
          { version: 1, path: "plans/execution/02-data-cleaning/v1.md", content: cleaningV1 },
          { version: 2, path: "plans/execution/02-data-cleaning/v2.md", content: cleaningV2 },
        ],
        results: cleaningResults,
      },
      {
        component: "03-descriptives",
        versions: [
          { version: 1, path: "plans/execution/03-descriptives/v1.md", content: descriptivesV1 },
        ],
        draft: {
          proposedVersion: 2,
          path: "plans/execution/03-descriptives/.draft-v2.md",
          content: descriptivesDraft,
        },
        results: descriptivesResults,
      },
    ],
    reviews: [
      { path: "plans/reviews/02-data-cleaning-v2.md", content: review },
      { path: "plans/reviews/03-descriptives-v1.md", content: reviewV2Pass },
      { path: "plans/reviews/04-regression-v1.md", content: reviewV2Fail },
    ],
  },
};
