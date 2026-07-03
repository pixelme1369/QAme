import type { Request, Response } from "express";
import { z } from "zod";
import { calls, org, ops, type Db } from "@qame/db";
import type { Config } from "../config.js";
import { log } from "../lib/logger.js";
import { parseRecordingPath } from "../lib/recording-path.js";
import { signedReadUrl } from "../lib/gcs.js";
import type { AssemblyAiClient } from "../transcription/assemblyai-client.js";

/**
 * Ingestion entrypoint: GCS OBJECT_FINALIZE → Pub/Sub push → here, seconds
 * after a recording lands. Idempotency is the INSERT ... ON CONFLICT on the
 * object path — Pub/Sub redeliveries and event replays are no-ops.
 *
 * Response-code contract with Pub/Sub:
 *   2xx  — ack (done, or permanently unprocessable: logged + recorded)
 *   5xx  — nack → retry with backoff → dead-letter queue after max attempts
 */
const pushEnvelopeSchema = z.object({
  message: z.object({
    data: z.string(),
    messageId: z.string(),
  }),
});

const gcsEventSchema = z.object({
  bucket: z.string(),
  name: z.string(),
});

export function gcsRecordingHandler(db: Db, config: Config, aai: AssemblyAiClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const envelope = pushEnvelopeSchema.safeParse(req.body);
    if (!envelope.success) {
      // Malformed push — retrying can never succeed; ack and record.
      log.warn("malformed pub/sub envelope", { body: req.body });
      res.status(204).end();
      return;
    }

    let event: z.infer<typeof gcsEventSchema>;
    try {
      event = gcsEventSchema.parse(
        JSON.parse(Buffer.from(envelope.data.message.data, "base64").toString("utf8")),
      );
    } catch {
      log.warn("undecodable gcs event", { messageId: envelope.data.message.messageId });
      res.status(204).end();
      return;
    }

    const parsed = parseRecordingPath(event.name);
    if (!parsed) {
      // Not a "-all.mp3" recording (per-leg file, temp object, etc.) — ignore.
      res.status(204).end();
      return;
    }

    try {
      const account = await org.accountByExternalId(db, parsed.accountExternalId);
      if (!account) {
        // Unknown account prefix: permanently unprocessable, but must be
        // visible — this is how a misconfigured client shows up.
        await ops.recordError(db, {
          callId: null,
          stage: "ingest",
          errorCode: "unknown_account",
          message: `no active account for external id "${parsed.accountExternalId}"`,
          detail: { objectPath: event.name },
        });
        res.status(204).end();
        return;
      }

      const call = await calls.insertIfNew(db, {
        accountId: account.id,
        gcsObjectPath: event.name,
        gcsBucket: event.bucket,
        recordedAt: parsed.recordedAt,
        phoneNumber: parsed.phoneNumber,
      });
      if (!call) {
        // Duplicate delivery — already ingested.
        res.status(204).end();
        return;
      }

      log.info("call ingested", { callId: call.id, path: event.name });

      // Kick transcription. If this fails the message nacks and Pub/Sub
      // retries; insertIfNew has already returned null on the retry, so we
      // re-kick via the received-state check instead.
      await startTranscription(db, config, aai, call.id, event.bucket, event.name);
      res.status(204).end();
    } catch (err) {
      log.error("ingest failed, nacking for retry", {
        path: event.name,
        error: String(err),
      });
      await ops
        .recordError(db, {
          callId: null,
          stage: "ingest",
          errorCode: "ingest_error",
          message: String(err),
          detail: { objectPath: event.name },
        })
        .catch(() => undefined);
      res.status(500).json({ error: "ingest failed" });
    }
  };
}

export async function startTranscription(
  db: Db,
  config: Config,
  aai: AssemblyAiClient,
  callId: string,
  bucket: string,
  objectName: string,
): Promise<void> {
  // Claim the transcription step; a concurrent retry that lost the race exits.
  const claimed = await calls.transition(db, callId, "received", "transcribing");
  if (!claimed) return;
  try {
    const audioUrl = await signedReadUrl(bucket, objectName);
    const transcriptId = await aai.submit(audioUrl, callId);
    log.info("transcription submitted", { callId, transcriptId });
  } catch (err) {
    // Roll the state back so a redelivery can retry the submission.
    await calls.transition(db, callId, "transcribing", "received");
    throw err;
  }
}
