-- QAme core schema.
-- Multi-tenant from day one: every operational table hangs off accounts.id,
-- so onboarding another client is an INSERT, not a migration.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- --------------------------------------------------------------------------
-- Organizational entities
-- --------------------------------------------------------------------------

CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The account segment of the GCS recording path ({account_id}/{date}/...).
  external_id   text NOT NULL UNIQUE,
  name          text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id),
  name          text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, name)
);

CREATE TABLE agents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id),
  -- Identifier from the dialer/telephony platform, when available.
  external_ref  text,
  full_name     text NOT NULL,
  email         text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, external_ref)
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  full_name     text NOT NULL,
  role          text NOT NULL CHECK (role IN ('analyst', 'manager', 'admin')),
  -- Google identity subject, bound on first SSO login.
  google_sub    text UNIQUE,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Calls and transcripts
-- --------------------------------------------------------------------------

CREATE TABLE calls (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id),
  campaign_id       uuid REFERENCES campaigns(id),
  agent_id          uuid REFERENCES agents(id),
  -- Full GCS object path: the pipeline idempotency key.
  gcs_object_path   text NOT NULL UNIQUE,
  gcs_bucket        text NOT NULL,
  recorded_at       timestamptz NOT NULL,
  phone_number      text NOT NULL,
  direction         text NOT NULL DEFAULT 'outbound'
                    CHECK (direction IN ('outbound', 'inbound')),
  duration_seconds  integer,
  status            text NOT NULL DEFAULT 'received' CHECK (status IN
                    ('received', 'transcribing', 'transcribed',
                     'scoring', 'scored', 'failed')),
  status_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX calls_account_recorded_idx ON calls (account_id, recorded_at DESC);
CREATE INDEX calls_agent_idx ON calls (agent_id, recorded_at DESC);
CREATE INDEX calls_status_idx ON calls (status)
  WHERE status NOT IN ('scored', 'failed');

CREATE TABLE transcripts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id                 uuid NOT NULL UNIQUE REFERENCES calls(id),
  provider                text NOT NULL DEFAULT 'assemblyai',
  provider_transcript_id  text NOT NULL UNIQUE,
  language                text,
  full_text               text NOT NULL,
  audio_duration_seconds  integer,
  confidence              real,
  -- Which diarized speaker label was resolved to the agent (e.g. 'A').
  agent_speaker_label     text,
  attribution_method      text NOT NULL DEFAULT 'heuristic'
                          CHECK (attribution_method IN ('heuristic', 'manual')),
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE utterances (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id  uuid NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  idx            integer NOT NULL,
  speaker        text NOT NULL CHECK (speaker IN ('agent', 'customer', 'unknown')),
  raw_speaker_label text NOT NULL,
  start_ms       integer NOT NULL,
  end_ms         integer NOT NULL,
  text           text NOT NULL,
  confidence     real,
  UNIQUE (transcript_id, idx)
);

CREATE INDEX utterances_transcript_idx ON utterances (transcript_id, idx);

-- --------------------------------------------------------------------------
-- Scorecard rubric (versioned configuration, not code)
-- --------------------------------------------------------------------------

CREATE TABLE scorecard_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id),
  name        text NOT NULL,
  version     integer NOT NULL,
  status      text NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft', 'active', 'retired')),
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, name, version)
);

-- One active template per account: the pipeline scores against this.
CREATE UNIQUE INDEX scorecard_templates_one_active_idx
  ON scorecard_templates (account_id) WHERE status = 'active';

CREATE TABLE scorecard_categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  uuid NOT NULL REFERENCES scorecard_templates(id) ON DELETE CASCADE,
  name         text NOT NULL,
  weight       numeric(6,2) NOT NULL CHECK (weight > 0),
  sort_order   integer NOT NULL DEFAULT 0
);

CREATE TABLE scorecard_criteria (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   uuid NOT NULL REFERENCES scorecard_categories(id) ON DELETE CASCADE,
  name          text NOT NULL,
  -- Rubric guidance injected verbatim into the AI scoring prompt.
  guidance      text NOT NULL,
  scoring_type  text NOT NULL CHECK (scoring_type IN ('pass_fail', 'scale')),
  weight        numeric(6,2) NOT NULL DEFAULT 1 CHECK (weight > 0),
  is_auto_fail  boolean NOT NULL DEFAULT false,
  sort_order    integer NOT NULL DEFAULT 0,
  -- Auto-fail is deterministic and only defined for pass/fail criteria.
  CHECK (NOT is_auto_fail OR scoring_type = 'pass_fail')
);

-- --------------------------------------------------------------------------
-- Scoring results
-- --------------------------------------------------------------------------

CREATE TABLE call_scorecard_results (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id            uuid NOT NULL UNIQUE REFERENCES calls(id),
  template_id        uuid NOT NULL REFERENCES scorecard_templates(id),
  -- Weighted 0-100 score computed deterministically in application code.
  overall_score      numeric(5,2) NOT NULL,
  auto_failed        boolean NOT NULL DEFAULT false,
  outcome            text NOT NULL,
  outcome_rationale  text NOT NULL,
  call_summary       text NOT NULL,
  -- Per-category sub-scores: [{categoryId, name, weight, score}].
  category_scores    jsonb NOT NULL,
  ai_model           text NOT NULL,
  prompt_version     text NOT NULL,
  scored_at          timestamptz NOT NULL DEFAULT now(),
  -- Manager override: AI values above are never overwritten.
  override_score     numeric(5,2),
  override_auto_failed boolean,
  override_outcome   text,
  override_reason    text,
  override_by        uuid REFERENCES users(id),
  override_at        timestamptz,
  CHECK (override_score IS NULL OR override_reason IS NOT NULL)
);

CREATE INDEX results_template_idx ON call_scorecard_results (template_id);
CREATE INDEX results_scored_at_idx ON call_scorecard_results (scored_at DESC);

CREATE TABLE call_criterion_scores (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id         uuid NOT NULL REFERENCES call_scorecard_results(id) ON DELETE CASCADE,
  criterion_id      uuid NOT NULL REFERENCES scorecard_criteria(id),
  passed            boolean,
  score             numeric(5,2),
  rationale         text NOT NULL,
  evidence_quote    text,
  evidence_start_ms integer,
  UNIQUE (result_id, criterion_id)
);

CREATE TABLE flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id     uuid NOT NULL REFERENCES calls(id),
  type        text NOT NULL
              CHECK (type IN ('compliance', 'soft_skill', 'outcome', 'processing_error')),
  severity    text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  source      text NOT NULL CHECK (source IN ('ai', 'system', 'manual')),
  label       text NOT NULL,
  detail      text,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX flags_call_idx ON flags (call_id);
CREATE INDEX flags_type_severity_idx ON flags (type, severity, created_at DESC);

CREATE TABLE coaching_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id      uuid NOT NULL REFERENCES calls(id),
  agent_id     uuid NOT NULL REFERENCES agents(id),
  assigned_to  uuid REFERENCES users(id),
  created_by   uuid NOT NULL REFERENCES users(id),
  note         text NOT NULL,
  status       text NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'in_progress', 'resolved')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX coaching_agent_idx ON coaching_notes (agent_id, status);

-- --------------------------------------------------------------------------
-- Operations: nothing fails silently
-- --------------------------------------------------------------------------

CREATE TABLE processing_errors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id     uuid REFERENCES calls(id),
  stage       text NOT NULL,
  error_code  text NOT NULL,
  message     text NOT NULL,
  detail      jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  resolved    boolean NOT NULL DEFAULT false
);

CREATE INDEX processing_errors_unresolved_idx
  ON processing_errors (occurred_at DESC) WHERE NOT resolved;

CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id),
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
