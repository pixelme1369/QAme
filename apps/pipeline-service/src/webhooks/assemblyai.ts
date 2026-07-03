import type { Request, Response } from "express";
import { z } from "zod";
import { calls, transcripts, ops, type Db } from "@qame/db";
import type { Config } from "../config.js";
import { log } from "../lib/logger.js";
import type { AssemblyAiClient } from "../transcription/assemblyai-client.js";
import { attributeSpeakers } from "../transcription/speaker-attribution.js";
import type { EventPublisher } from "../events/publisher.js";

/**
 * AssemblyAI completion webhook. Authenticated by the shared secret header
 * AssemblyAI echoes back. The webhook body is only a notification — the
 * transcript itself is re-fetched from the API, so a spoofed body can never
 * inject transcript content.
 */
const webhookBodySchema = z.object({
  transcript_id: z.string(),
  status: z.string(),
});

export function assemblyAiWebhookHandler(
  db: Db,
  config: Config,
  aai: AssemblyAiClient,
  events: EventPublisher,
) {
  return async (req: Request, res: Response): Promise<void> => {
    if (req.header("x-webhook-secret") !== config.ASSEMBLYAI_WEBHOOK_SECRET) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const callId = typeof req.query.callId === "string" ? req.query.callId : null;
    const body = webhookBodySchema.safeParse(req.body);
    if (!callId || !body.success) {
      res.status(400).json({ error: "bad webhook payload" });
      return;
    }

    try {
      const call = await calls.getById(db, callId);
      if (!call) {
        res.status(200).json({ ok: true, ignored: "unknown call" });
        return;
      }

      if (body.data.status === "error") {
        await ops.recordError(db, {
          callId,
          stage: "transcribe",
          errorCode: "provider_error",
          message: `assemblyai reported error for transcript ${body.data.transcript_id}`,
        });
        await calls.transition(db, callId, "transcribing", "failed");
        res.status(200).json({ ok: true });
        return;
      }
      if (body.data.status !== "completed") {
        res.status(200).json({ ok: true, ignored: body.data.status });
        return;
      }

      const transcript = await aai.get(body.data.transcript_id);
      if (transcript.status !== "completed" || transcript.text === null) {
        // Notification/fetch race — let AssemblyAI's webhook retry handle it.
        res.status(503).json({ error: "transcript not ready" });
        return;
      }

      const aaiUtterances = transcript.utterances ?? [];
      const attribution = attributeSpeakers(aaiUtterances);

      const inserted = await transcripts.insert(db, {
        callId,
        providerTranscriptId: transcript.id,
        language: transcript.language_code ?? null,
        fullText: transcript.text,
        audioDurationSeconds: transcript.audio_duration ?? null,
        confidence: transcript.confidence ?? null,
        agentSpeakerLabel: attribution.agentLabel,
        utterances: aaiUtterances.map((u, idx) => ({
          idx,
          speaker: attribution.roleFor(u.speaker),
          rawSpeakerLabel: u.speaker,
          startMs: u.start,
          endMs: u.end,
          text: u.text,
          confidence: u.confidence ?? null,
        })),
      });

      if (transcript.audio_duration) {
        await calls.setDuration(db, callId, transcript.audio_duration);
      }

      const advanced = await calls.transition(db, callId, "transcribing", "transcribed");
      if (inserted === null && !advanced) {
        // Duplicate webhook delivery — transcript already stored and advanced.
        res.status(200).json({ ok: true, duplicate: true });
        return;
      }

      log.info("transcript stored", { callId, transcriptId: transcript.id });
      await events.callTranscribed({ callId });
      res.status(200).json({ ok: true });
    } catch (err) {
      log.error("assemblyai webhook failed", { callId, error: String(err) });
      await ops
        .recordError(db, {
          callId,
          stage: "transcribe",
          errorCode: "webhook_error",
          message: String(err),
        })
        .catch(() => undefined);
      // 5xx → AssemblyAI retries the webhook.
      res.status(500).json({ error: "internal" });
    }
  };
}
