import type { CallOutcome } from "@qame/scorecard-schema";

export type CallStatus =
  | "received"
  | "transcribing"
  | "transcribed"
  | "scoring"
  | "scored"
  | "failed";

export type UserRole = "analyst" | "manager" | "admin";

export interface CallRow {
  id: string;
  account_id: string;
  campaign_id: string | null;
  agent_id: string | null;
  gcs_object_path: string;
  gcs_bucket: string;
  recorded_at: Date;
  phone_number: string;
  direction: "outbound" | "inbound";
  duration_seconds: number | null;
  status: CallStatus;
  status_updated_at: Date;
  created_at: Date;
}

export interface TranscriptRow {
  id: string;
  call_id: string;
  provider: string;
  provider_transcript_id: string;
  language: string | null;
  full_text: string;
  audio_duration_seconds: number | null;
  confidence: number | null;
  agent_speaker_label: string | null;
  attribution_method: "heuristic" | "manual";
  created_at: Date;
}

export interface UtteranceRow {
  id: string;
  transcript_id: string;
  idx: number;
  speaker: "agent" | "customer" | "unknown";
  raw_speaker_label: string;
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number | null;
}

export interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  google_sub: string | null;
  is_active: boolean;
  created_at: Date;
}

export interface AgentRow {
  id: string;
  account_id: string;
  external_ref: string | null;
  full_name: string;
  email: string | null;
  is_active: boolean;
  created_at: Date;
}

export interface CategoryScore {
  categoryId: string;
  name: string;
  weight: number;
  score: number;
}

export interface ResultRow {
  id: string;
  call_id: string;
  template_id: string;
  overall_score: string;
  auto_failed: boolean;
  outcome: CallOutcome;
  outcome_rationale: string;
  call_summary: string;
  category_scores: CategoryScore[];
  ai_model: string;
  prompt_version: string;
  scored_at: Date;
  override_score: string | null;
  override_auto_failed: boolean | null;
  override_outcome: string | null;
  override_reason: string | null;
  override_by: string | null;
  override_at: Date | null;
}

export interface CriterionScoreRow {
  id: string;
  result_id: string;
  criterion_id: string;
  passed: boolean | null;
  score: string | null;
  rationale: string;
  evidence_quote: string | null;
  evidence_start_ms: number | null;
}

export interface FlagRow {
  id: string;
  call_id: string;
  type: "compliance" | "soft_skill" | "outcome" | "processing_error";
  severity: "info" | "warning" | "critical";
  source: "ai" | "system" | "manual";
  label: string;
  detail: string | null;
  created_by: string | null;
  created_at: Date;
}

export interface CoachingNoteRow {
  id: string;
  call_id: string;
  agent_id: string;
  assigned_to: string | null;
  created_by: string | null;
  note: string;
  status: "open" | "in_progress" | "resolved";
  created_at: Date;
  updated_at: Date;
}

export interface ProcessingErrorRow {
  id: string;
  call_id: string | null;
  stage: string;
  error_code: string;
  message: string;
  detail: Record<string, unknown> | null;
  occurred_at: Date;
  resolved: boolean;
}
