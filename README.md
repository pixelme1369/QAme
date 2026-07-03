# QAme — Enterprise Call QA & Conversation Intelligence Platform

The moment a call recording lands in Google Cloud Storage, QAme transcribes
it (diarized), scores it with AI against a configurable weighted QA rubric,
applies deterministic auto-fail rules, and surfaces it to QA staff in a
purpose-built dashboard — call queue, evidence-linked call detail, agent and
team analytics, versioned scorecard administration, and an ops console.

Built as a standalone, cloud-native, event-driven system: 100% of calls
processed, nothing dropped silently, designed to go from 3,000 calls/day to
orders of magnitude more without a rewrite.

## Architecture

```
                     GCS  (call recordings, private)
                      │  OBJECT_FINALIZE event
                      ▼
            Pub/Sub: call-recording-finalized
                      │ push (OIDC-authenticated)
                      ▼
          ┌────────────────────────────┐        AssemblyAI
          │      pipeline-service      │──────► (diarized transcription)
          │      (Cloud Run)           │◄────── webhook on completion
          │                            │
          │  ingest → transcribe →     │        Anthropic Claude
          │  QA-score → persist        │──────► (schema-forced scorecard
          └──────────────┬─────────────┘◄────── judgment per criterion)
                         │
                         ▼
                Cloud SQL (Postgres)
                         ▲
          ┌──────────────┴─────────────┐
          │        api-service         │◄── Google SSO + RBAC ── QA staff
          └──────────────┬─────────────┘
                         ▼
                  React dashboard
```

Every stage transition (recording landed → transcript ready → scored) is its
own Pub/Sub hop with independent retry/backoff and a dead-letter queue. An
AI-provider outage delays scoring; it never loses calls.

## Repository layout

| Path | What it is |
|---|---|
| `packages/scorecard-schema` | The shared contract: rubric structure + the schema-forced AI output shape, with server-side validation |
| `packages/db` | Postgres schema (migrations), typed query layer, seed for the v1 scorecard |
| `apps/pipeline-service` | Ingestion webhook, AssemblyAI orchestration, speaker attribution, Claude scoring engine, deterministic scoring/auto-fail |
| `apps/api-service` | Dashboard API: Google-SSO auth, role-based access (analyst/manager/admin), signed audio URLs, audited overrides |
| `apps/dashboard` | React SPA: Call Queue, Call Detail (click-to-evidence), Agent Performance, Team Analytics, Scorecard Admin, Ops Console |
| `infra/` | GCP provisioning runbook (IAM, Cloud SQL, Pub/Sub + DLQs, Cloud Run, secrets) |

## Design decisions that matter

- **AI judges; code decides.** Claude scores each criterion independently
  through a forced tool call whose JSON schema embeds the real criterion ids
  as an enum, then application code computes the weighted score and applies
  auto-fail policy. The model never does arithmetic and never makes the final
  pass/fail call.
- **No free-text parsing.** Scoring output is validated server-side against
  the exact template (every criterion judged exactly once, value shape
  matching the scoring type) before anything trusts it. Validation failure is
  a recorded processing error, never a silent fallback.
- **Evidence or it didn't happen.** Every criterion score stores a verbatim
  quote and a transcript timestamp; the dashboard seeks the audio to that
  moment on click.
- **Rubric is data.** Categories, weights, criteria, guidance text, and
  auto-fail flags live in Postgres, versioned. Admins publish a new version
  from the dashboard without a deploy; every scored call keeps the version it
  was judged against.
- **Idempotent everywhere.** The GCS object path is the pipeline idempotency
  key; state transitions are conditional updates; transcript and result
  writes are `ON CONFLICT DO NOTHING` transactions. Redelivered or replayed
  events are no-ops.
- **Overrides are additive.** A manager override (mandatory justification,
  manager+ role) is stored beside the AI score — never over it — and written
  to the audit log. The override rate is tracked as the live AI-drift signal.
- **Private by default.** The recordings bucket is never public: AssemblyAI
  gets a 2-hour signed URL; the dashboard gets a 15-minute signed URL minted
  per request after RBAC.

## Local development

```bash
npm install
docker run -d --name qame-pg -e POSTGRES_PASSWORD=qame -e POSTGRES_USER=qame \
  -e POSTGRES_DB=qame -p 5432:5432 postgres:16

cp .env.example .env            # fill in keys
npm run build:packages
DATABASE_URL=postgres://qame:qame@localhost:5432/qame npm run migrate
DATABASE_URL=postgres://qame:qame@localhost:5432/qame \
  SEED_ACCOUNT_EXTERNAL_ID=dev-account npm run seed

npm run dev -w @qame/pipeline-service   # :8080  (EVENT_MODE=inline locally)
npm run dev -w @qame/api-service        # :8081
npm run dev -w @qame/dashboard          # :5173 (proxies /api → :8081)
```

Verification: `npm run typecheck && npm test && npm run build`.

## Quality bar before trusting the AI (Phase 3 gate)

Before QA staff act on AI scores: a QA lead hand-scores a reference set of
real calls against the rubric, the pipeline scores the same set, and
agreement is measured explicitly (auto-fail agreement ≥ 90%; overall score
within a tight band on the large majority). Rubric guidance text is iterated
until the bar is met, and the comparison re-runs on every rubric change.
In production, the manager-override rate on the Team Analytics page is the
standing drift signal. Every result row records the model and prompt version
it was produced with, so score populations stay comparable across revisions.

## Build phases

1. **Platform foundation** — this repo, CI, `infra/` runbook, migrations. ✅
2. **Ingestion & transcription** — event-driven capture → stored diarized
   transcript, proven under duplicate/replayed events. ✅ (code; needs cloud provisioning)
3. **AI QA scoring engine** — schema-forced scoring, deterministic
   auto-fail, to be validated against the human reference set (gate above). ✅ (code)
4. **Dashboard MVP** — Call Queue + Call Detail. ✅
5. **Analytics & coaching** — trends, leaderboard, coaching workflow,
   scorecard admin, ops console. ✅
