import type { Request, Response } from "express";
import { z } from "zod";
import { calls, transcripts, scorecards, results, ops, type Db } from "@qame/db";
import { log } from "../lib/logger.js";
import type { ScoringClient } from "../qa/claude-client.js";
import { computeScore, deriveFlags } from "../qa/scoring.js";
import { PROMPT_VERSION } from "../qa/prompt-builder.js";

/**
 * Scoring stage. In production this is a Pub/Sub push subscription on the
 * call-transcribed topic (own retry policy + DLQ); in inline mode it is
 * invoked directly. Either way the work is the same: load transcript +
 * active rubric, get schema-forced judgments from Claude, compute the
 * weighted score and auto-fail deterministically, persist atomically.
 */
export async function scoreCall(db: Db, scorer: ScoringClient, callId: string): Promise<void> {
  const claimed = await calls.transition(db, callId, "transcribed", "scoring");
  if (!claimed) {
    log.info("scoring skipped (not in transcribed state)", { callId });
    return;
  }

  try {
    const call = await calls.getById(db, callId);
    if (!call) throw new Error(`call ${callId} vanished`);

    const transcript = await transcripts.getByCallId(db, callId);
    if (!transcript) throw new Error(`no transcript for call ${callId}`);

    const template = await scorecards.getActive(db, call.account_id);
    if (!template) {
      throw new Error(`no active scorecard template for account ${call.account_id}`);
    }

    const utterances = await transcripts.utterances(db, transcript.id);
    if (utterances.length === 0) {
      // Nothing to judge (silence/voicemail with no diarized speech).
      await results.insert(db, {
        callId,
        templateId: template.id,
        overallScore: 0,
        autoFailed: false,
        outcome: "no_contact",
        outcomeRationale: "No diarized speech in the recording.",
        callSummary: "No conversational content was detected in this recording.",
        categoryScores: [],
        aiModel: "none",
        promptVersion: PROMPT_VERSION,
        criterionScores: [],
        flags: [
          {
            type: "processing_error",
            severity: "info",
            source: "system",
            label: "Empty transcript — not scored",
            detail: null,
          },
        ],
      });
      await calls.transition(db, callId, "scoring", "scored");
      return;
    }

    const { output, model } = await scorer.score(template, utterances);
    const computed = computeScore(template, output);
    const flags = deriveFlags(template, output, computed);

    await results.insert(db, {
      callId,
      templateId: template.id,
      overallScore: computed.overallScore,
      autoFailed: computed.autoFailed,
      outcome: output.outcome,
      outcomeRationale: output.outcomeRationale,
      callSummary: output.callSummary,
      categoryScores: computed.categoryScores,
      aiModel: model,
      promptVersion: PROMPT_VERSION,
      criterionScores: output.judgments.map((j) => ({
        criterionId: j.criterionId,
        passed: j.passed,
        score: j.score,
        rationale: j.rationale,
        evidenceQuote: j.evidenceQuote,
        evidenceStartMs: j.evidenceStartMs,
      })),
      flags,
    });

    await calls.transition(db, callId, "scoring", "scored");
    log.info("call scored", {
      callId,
      overallScore: computed.overallScore,
      autoFailed: computed.autoFailed,
      outcome: output.outcome,
    });
  } catch (err) {
    await ops
      .recordError(db, {
        callId,
        stage: "score",
        errorCode: "scoring_error",
        message: String(err),
      })
      .catch(() => undefined);
    // Return to 'transcribed' so the Pub/Sub retry (or manual requeue from
    // the ops console) can re-claim and re-score.
    await calls.transition(db, callId, "scoring", "transcribed");
    throw err;
  }
}

const pushEnvelopeSchema = z.object({
  message: z.object({ data: z.string() }),
});
const eventSchema = z.object({ callId: z.string().uuid() });

/** Pub/Sub push endpoint wrapping scoreCall with the ack/nack contract. */
export function scoreTaskHandler(db: Db, scorer: ScoringClient) {
  return async (req: Request, res: Response): Promise<void> => {
    let callId: string;
    try {
      const envelope = pushEnvelopeSchema.parse(req.body);
      callId = eventSchema.parse(
        JSON.parse(Buffer.from(envelope.message.data, "base64").toString("utf8")),
      ).callId;
    } catch {
      log.warn("malformed score task payload", { body: req.body });
      res.status(204).end();
      return;
    }
    try {
      await scoreCall(db, scorer, callId);
      res.status(204).end();
    } catch (err) {
      log.error("scoring failed, nacking for retry", { callId, error: String(err) });
      res.status(500).json({ error: "scoring failed" });
    }
  };
}
