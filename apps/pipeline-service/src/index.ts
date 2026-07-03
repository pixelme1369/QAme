import express from "express";
import { createPool } from "@qame/db";
import { loadConfig } from "./config.js";
import { log } from "./lib/logger.js";
import { pushAuth } from "./lib/push-auth.js";
import { AssemblyAiClient } from "./transcription/assemblyai-client.js";
import { ScoringClient } from "./qa/claude-client.js";
import { gcsRecordingHandler } from "./webhooks/gcs-recording.js";
import { assemblyAiWebhookHandler } from "./webhooks/assemblyai.js";
import { scoreCall, scoreTaskHandler } from "./tasks/score.js";
import { inlinePublisher, pubsubPublisher, type EventPublisher } from "./events/publisher.js";

const config = loadConfig();
const db = createPool();
const aai = new AssemblyAiClient(config);
const scorer = new ScoringClient(config);

const events: EventPublisher =
  config.EVENT_MODE === "pubsub"
    ? pubsubPublisher(config)
    : inlinePublisher((e) => scoreCall(db, scorer, e.callId));

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

const requirePushAuth = pushAuth(config);

// Stage 1: GCS OBJECT_FINALIZE via Pub/Sub push.
app.post("/webhooks/gcs-recording", requirePushAuth, gcsRecordingHandler(db, config, aai));

// Stage 2: AssemblyAI completion (authenticated by shared secret header).
app.post("/webhooks/assemblyai", assemblyAiWebhookHandler(db, config, aai, events));

// Stage 3: scoring, via Pub/Sub push on the call-transcribed topic.
app.post("/tasks/score", requirePushAuth, scoreTaskHandler(db, scorer));

app.listen(config.PORT, () => {
  log.info("pipeline-service listening", {
    port: config.PORT,
    eventMode: config.EVENT_MODE,
    model: config.SCORING_MODEL,
  });
});
