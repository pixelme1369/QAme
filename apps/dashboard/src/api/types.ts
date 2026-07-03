// API response shapes (JSON-serialized rows from the api-service).

export type CallStatus =
  | "received"
  | "transcribing"
  | "transcribed"
  | "scoring"
  | "scored"
  | "failed";

export interface Me {
  id: string;
  email: string;
  fullName: string;
  role: "analyst" | "manager" | "admin";
}

export interface Account {
  id: string;
  external_id: string;
  name: string;
}

export interface Agent {
  id: string;
  account_id: string;
  full_name: string;
  email: string | null;
}

export interface Campaign {
  id: string;
  name: string;
}

export interface CallQueueItem {
  id: string;
  recorded_at: string;
  phone_number: string;
  duration_seconds: number | null;
  status: CallStatus;
  agent_name: string | null;
  campaign_name: string | null;
  overall_score: string | null;
  auto_failed: boolean | null;
  outcome: string | null;
  override_score: string | null;
  flag_count: number;
  critical_flag_count: number;
}

export interface Utterance {
  id: string;
  idx: number;
  speaker: "agent" | "customer" | "unknown";
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface CategoryScore {
  categoryId: string;
  name: string;
  weight: number;
  score: number;
}

export interface CallResult {
  id: string;
  overall_score: string;
  auto_failed: boolean;
  outcome: string;
  outcome_rationale: string;
  call_summary: string;
  category_scores: CategoryScore[];
  ai_model: string;
  prompt_version: string;
  scored_at: string;
  override_score: string | null;
  override_auto_failed: boolean | null;
  override_outcome: string | null;
  override_reason: string | null;
  override_at: string | null;
}

export interface CriterionScore {
  id: string;
  criterion_id: string;
  criterion_name: string;
  category_name: string;
  scoring_type: "pass_fail" | "scale";
  is_auto_fail: boolean;
  passed: boolean | null;
  score: string | null;
  rationale: string;
  evidence_quote: string | null;
  evidence_start_ms: number | null;
}

export interface Flag {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  label: string;
  detail: string | null;
}

export interface CoachingNote {
  id: string;
  note: string;
  status: "open" | "in_progress" | "resolved";
  created_at: string;
}

export interface CallDetailResponse {
  call: {
    id: string;
    recorded_at: string;
    phone_number: string;
    direction: string;
    duration_seconds: number | null;
    status: CallStatus;
    agent_id: string | null;
  };
  transcript: { id: string; attribution_method: string } | null;
  utterances: Utterance[];
  result: CallResult | null;
  criterionScores: CriterionScore[];
  flags: Flag[];
  notes: CoachingNote[];
}

export interface LeaderboardRow {
  agent_id: string;
  agent_name: string;
  calls_scored: number;
  avg_score: number | null;
  auto_fail_rate: number | null;
  critical_flags: number;
  coaching_open: number;
}

export interface TrendPoint {
  day: string;
  calls_scored: number;
  avg_score: number | null;
  auto_fail_rate: number | null;
}

export interface CategoryBreakdown {
  category_name: string;
  avg_score: number | null;
}

export interface OutcomeCount {
  outcome: string;
  count: number;
}

export interface Overview {
  calls_total: number;
  calls_scored: number;
  avg_score: number | null;
  auto_fail_rate: number | null;
  override_rate: number | null;
}

export interface PipelineHealth {
  by_status: Array<{ status: string; count: number }>;
  unresolved_errors: number;
  scored_last_24h: number;
  failed_last_24h: number;
}

export interface ProcessingError {
  id: string;
  call_id: string | null;
  stage: string;
  error_code: string;
  message: string;
  occurred_at: string;
  resolved: boolean;
}

export interface ScorecardTemplateHead {
  id: string;
  name: string;
  version: number;
  status: "draft" | "active" | "retired";
  created_at: string;
}
