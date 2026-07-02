// Mirrors the payload board.py injects into the #board-data slot (schemaVersion 1).

export interface BoardData {
  schemaVersion: number;
  generatedAt: string;
  mode: "live" | "static";
  focus: string | null;
  gate?: { component: string; proposedVersion: number }; // sign-off gate mode
  project: { name: string; root?: string };
  git: {
    available: boolean;
    branch?: string;
    head?: string;
    fileDates?: Record<string, { firstCommit?: string; lastCommit?: string }>;
  };
  files: {
    masterPlan: BoardFile;
    decisionLog: BoardFile;
    executionPlans: ExecutionPlanGroup[];
    reviews: BoardFile[];
  };
}

export interface BoardFile {
  path: string;
  content: string;
}

export interface ExecutionPlanGroup {
  component: string; // NN-slug
  versions: PlanVersionFile[];
  draft?: DraftFile;
}

export interface PlanVersionFile extends BoardFile {
  version: number;
}

export interface DraftFile extends BoardFile {
  proposedVersion: number;
}

// ---- parsed shapes (client-side contract parsing; see parse.ts) ----

export interface ParsedMasterPlan {
  ok: boolean;
  title: string;
  lastUpdated: string | null;
  contextMd: string; // Research questions subsection stripped out
  researchQuestions: ResearchQuestion[];
  components: TrackerRow[];
  sequencingMd: string | null;
  raw: string;
}

export interface ResearchQuestion {
  num: number;
  text: string;
}

export type TrackerStatus =
  | "not started"
  | "planned"
  | "in progress"
  | "done"
  | "dropped"
  | "unknown";

export interface TrackerRow {
  num: string;
  component: string;
  status: TrackerStatus;
  planLink: string;
  notes: string;
  serves: string; // raw Serves cell; "" for old 5-column tables
}

export interface ParsedLogEntry {
  timestamp: string;
  lateCaptured: boolean;
  fields: { label: string; text: string }[];
  raw: string;
}

export interface ParsedExecutionPlan {
  ok: boolean;
  title: string;
  version: number | null;
  componentSlug: string | null;
  date: string | null;
  supersedes: string | null;
  goal: string | null; // "Goal and success criteria" body; null in pre-v0.3 plans
  serves: string | null; // "Serves:" line inside the goal section
  sections: { heading: string; content: string }[];
  signedOff: string | null;
  raw: string;
}

export interface Scorecard {
  schemaVersion: number;
  component: string;
  planVersion: number;
  planPath: string;
  rubricVersion: string;
  date: string;
  threshold?: ScorecardThreshold; // schemaVersion 2+
  items: ScorecardItem[];
  raw: number | null; // null on threshold fail/undetermined
  applicableMax: number | null;
  percent: number | null;
  band: string; // "not a plan" (fail) | "undetermined" | grade bands
  excluded?: { id: number | string; why: string }[];
  topRevisions?: string[];
  split?: { verdict: string; detail: string };
}

export interface ScorecardThreshold {
  verdict: "pass" | "undetermined" | "fail";
  checks: ThresholdCheck[];
  failures?: { id: string; verdict: string; fix?: string }[];
}

export interface ThresholdCheck {
  id: string;
  name?: string;
  result: "pass" | "fail" | "na" | "unknown";
  evidence?: string;
  note?: string;
}

export interface ScorecardItem {
  id: number | string; // 1..14 in v1, "G1".."G8" in v2
  name?: string;
  score: number | null;
  status?: string; // "N/A" | "unknown" when score is null
  evidence?: string;
  justification?: string;
}

// ---- annotations ----

export interface PlanCommentAnnotation {
  id: string;
  type: "plan-comment";
  planPath: string;
  component: string;
  version: number;
  isDraft: boolean;
  quote: string;
  prefix: string;
  suffix: string;
  sectionHeading: string;
  occurrenceIndex: number;
  anchored: boolean;
  comment: string;
}

export interface GeneralAnnotation {
  id: string;
  type: "general";
  view: string;
  comment: string;
}

export type Annotation = PlanCommentAnnotation | GeneralAnnotation;
