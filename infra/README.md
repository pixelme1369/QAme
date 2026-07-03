# Infrastructure — Google Cloud

Everything is provisioned with `gcloud` below (idempotent; safe to re-run).
Nothing is hardcoded in source: services read configuration from env vars and
secrets from Secret Manager at deploy time.

```
GCS (x5-clients, private) ── OBJECT_FINALIZE ──▶ Pub/Sub: call-recording-finalized
                                                      │ push + OIDC
                                                      ▼
                                             pipeline-service (Cloud Run)
                                              │  ▲            │
                              AssemblyAI ◀────┘  └── webhook  │ publish
                                                              ▼
                                             Pub/Sub: call-transcribed ── push ──▶ /tasks/score
                                                              │
                                                        (DLQs on both)
                                                              ▼
                                                  Cloud SQL (Postgres 16)
                                                              ▲
                                             api-service ─────┘      dashboard (static)
```

## 0. Project variables

```bash
export PROJECT=your-project-id
export REGION=us-central1
export BUCKET=x5-clients                  # existing recordings bucket
gcloud config set project "$PROJECT"
```

## 1. Service accounts (least privilege)

```bash
gcloud iam service-accounts create qame-pipeline --display-name "QAme pipeline"
gcloud iam service-accounts create qame-api --display-name "QAme API"
gcloud iam service-accounts create qame-pubsub-push --display-name "QAme Pub/Sub push"

# Pipeline reads recordings and signs URLs for AssemblyAI.
gsutil iam ch "serviceAccount:qame-pipeline@$PROJECT.iam.gserviceaccount.com:roles/storage.objectViewer" "gs://$BUCKET"
gcloud iam service-accounts add-iam-policy-binding "qame-pipeline@$PROJECT.iam.gserviceaccount.com" \
  --member "serviceAccount:qame-pipeline@$PROJECT.iam.gserviceaccount.com" --role roles/iam.serviceAccountTokenCreator

# API signs short-lived playback URLs.
gsutil iam ch "serviceAccount:qame-api@$PROJECT.iam.gserviceaccount.com:roles/storage.objectViewer" "gs://$BUCKET"
gcloud iam service-accounts add-iam-policy-binding "qame-api@$PROJECT.iam.gserviceaccount.com" \
  --member "serviceAccount:qame-api@$PROJECT.iam.gserviceaccount.com" --role roles/iam.serviceAccountTokenCreator

# Pipeline publishes the internal stage-transition topic.
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member "serviceAccount:qame-pipeline@$PROJECT.iam.gserviceaccount.com" --role roles/pubsub.publisher

# Both services connect to Cloud SQL.
for SA in qame-pipeline qame-api; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member "serviceAccount:$SA@$PROJECT.iam.gserviceaccount.com" --role roles/cloudsql.client
done
```

## 2. Cloud SQL (Postgres 16)

```bash
gcloud sql instances create qame-pg \
  --database-version POSTGRES_16 --tier db-custom-2-8192 --region "$REGION" \
  --storage-auto-increase --backup --require-ssl
gcloud sql databases create qame --instance qame-pg
gcloud sql users create qame_app --instance qame-pg --password "$(openssl rand -base64 24)"
# Store the resulting DATABASE_URL in Secret Manager (next step).
```

## 3. Secrets

```bash
printf '%s' "postgres://qame_app:PASSWORD@/qame?host=/cloudsql/$PROJECT:$REGION:qame-pg" | \
  gcloud secrets create qame-database-url --data-file=-
printf '%s' "YOUR_ASSEMBLYAI_KEY"  | gcloud secrets create assemblyai-api-key --data-file=-
openssl rand -hex 32               | gcloud secrets create assemblyai-webhook-secret --data-file=-
printf '%s' "YOUR_ANTHROPIC_KEY"   | gcloud secrets create anthropic-api-key --data-file=-

for SA in qame-pipeline qame-api; do
  for S in qame-database-url assemblyai-api-key assemblyai-webhook-secret anthropic-api-key; do
    gcloud secrets add-iam-policy-binding "$S" \
      --member "serviceAccount:$SA@$PROJECT.iam.gserviceaccount.com" --role roles/secretmanager.secretAccessor
  done
done
```

## 4. Pub/Sub topics, DLQs, and the GCS notification

```bash
gcloud pubsub topics create call-recording-finalized call-transcribed \
  call-recording-finalized-dlq call-transcribed-dlq

# Native GCS event: fires the moment a recording object is finalized.
gsutil notification create -t call-recording-finalized -f json -e OBJECT_FINALIZE "gs://$BUCKET"
```

## 5. Deploy Cloud Run services

```bash
# Build images (Cloud Build) — run from the repo root.
gcloud builds submit --tag "gcr.io/$PROJECT/qame-pipeline" -f apps/pipeline-service/Dockerfile .
gcloud builds submit --tag "gcr.io/$PROJECT/qame-api" -f apps/api-service/Dockerfile .

gcloud run deploy qame-pipeline \
  --image "gcr.io/$PROJECT/qame-pipeline" --region "$REGION" \
  --service-account "qame-pipeline@$PROJECT.iam.gserviceaccount.com" \
  --add-cloudsql-instances "$PROJECT:$REGION:qame-pg" \
  --no-allow-unauthenticated \
  --set-env-vars "RECORDINGS_BUCKET=$BUCKET,EVENT_MODE=pubsub,PUBLIC_BASE_URL=https://PIPELINE_URL" \
  --set-secrets "DATABASE_URL=qame-database-url:latest,ASSEMBLYAI_API_KEY=assemblyai-api-key:latest,ASSEMBLYAI_WEBHOOK_SECRET=assemblyai-webhook-secret:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest"
# After first deploy: set PUBLIC_BASE_URL and PUSH_AUTH_AUDIENCE to the real
# service URL, and PUSH_AUTH_SERVICE_ACCOUNT to the push SA email; note the
# /webhooks/assemblyai route must be publicly reachable — front the service
# with a load balancer route or run with allow-unauthenticated and rely on
# the OIDC middleware + webhook secret (both are enforced in-app).

gcloud run deploy qame-api \
  --image "gcr.io/$PROJECT/qame-api" --region "$REGION" \
  --service-account "qame-api@$PROJECT.iam.gserviceaccount.com" \
  --add-cloudsql-instances "$PROJECT:$REGION:qame-pg" \
  --allow-unauthenticated \
  --set-env-vars "RECORDINGS_BUCKET=$BUCKET,GOOGLE_OAUTH_CLIENT_ID=YOUR_CLIENT_ID,DASHBOARD_ORIGIN=https://YOUR_DASHBOARD_ORIGIN" \
  --set-secrets "DATABASE_URL=qame-database-url:latest"
```

## 6. Push subscriptions (OIDC-authenticated, with DLQs)

```bash
export PIPELINE_URL=$(gcloud run services describe qame-pipeline --region "$REGION" --format 'value(status.url)')
export PUSH_SA="qame-pubsub-push@$PROJECT.iam.gserviceaccount.com"

# Allow the push SA to invoke the pipeline service.
gcloud run services add-iam-policy-binding qame-pipeline --region "$REGION" \
  --member "serviceAccount:$PUSH_SA" --role roles/run.invoker

gcloud pubsub subscriptions create call-recording-finalized-push \
  --topic call-recording-finalized \
  --push-endpoint "$PIPELINE_URL/webhooks/gcs-recording" \
  --push-auth-service-account "$PUSH_SA" \
  --push-auth-token-audience "$PIPELINE_URL" \
  --dead-letter-topic call-recording-finalized-dlq --max-delivery-attempts 8 \
  --min-retry-delay 10s --max-retry-delay 600s

gcloud pubsub subscriptions create call-transcribed-push \
  --topic call-transcribed \
  --push-endpoint "$PIPELINE_URL/tasks/score" \
  --push-auth-service-account "$PUSH_SA" \
  --push-auth-token-audience "$PIPELINE_URL" \
  --dead-letter-topic call-transcribed-dlq --max-delivery-attempts 8 \
  --min-retry-delay 30s --max-retry-delay 600s

# Alert on any message landing in a DLQ (nothing fails silently).
```

## 7. Database migration + seed (run as a job)

```bash
gcloud run jobs create qame-migrate \
  --image "gcr.io/$PROJECT/qame-pipeline" --region "$REGION" \
  --service-account "qame-pipeline@$PROJECT.iam.gserviceaccount.com" \
  --add-cloudsql-instances "$PROJECT:$REGION:qame-pg" \
  --set-secrets "DATABASE_URL=qame-database-url:latest" \
  --command node --args packages/db/dist/migrate.js
gcloud run jobs execute qame-migrate --region "$REGION" --wait

gcloud run jobs create qame-seed \
  --image "gcr.io/$PROJECT/qame-pipeline" --region "$REGION" \
  --service-account "qame-pipeline@$PROJECT.iam.gserviceaccount.com" \
  --add-cloudsql-instances "$PROJECT:$REGION:qame-pg" \
  --set-secrets "DATABASE_URL=qame-database-url:latest" \
  --set-env-vars "SEED_ACCOUNT_EXTERNAL_ID=THE_GCS_ACCOUNT_FOLDER,SEED_ACCOUNT_NAME=Client Name" \
  --command node --args packages/db/dist/seed.js
gcloud run jobs execute qame-seed --region "$REGION" --wait
```

## 8. Observability

- **Logs**: both services emit structured JSON; Cloud Logging parses `severity` natively.
- **Metrics/alerts to create**: DLQ depth > 0 on either dead-letter topic; Cloud Run 5xx rate;
  `processing_errors` unresolved count (exposed at `/api/ops/health`); pipeline lag
  (calls stuck in transient states — `/api/ops/stuck-calls`).
- The dashboard Ops Console surfaces the same data for humans.

## Scaling notes

3,000 calls/day ≈ 2 calls/minute average. Every component here scales an
order of magnitude (or three) beyond that without redesign: Cloud Run
autoscales on push traffic, Pub/Sub buffers bursts, scoring throughput is
bounded only by Anthropic rate limits (requests are independent), and
Postgres at this write volume is trivial. The unit of parallelism is the
individual call end-to-end.
