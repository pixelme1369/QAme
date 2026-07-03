import { Router } from "express";
import { z } from "zod";
import { CALL_OUTCOMES } from "@qame/scorecard-schema";
import { calls, transcripts, results, coaching, type Db } from "@qame/db";
import { requireRole } from "../auth.js";
import { h } from "../lib/http.js";
import { playbackUrl } from "../lib/audio-url.js";

const queueQuerySchema = z.object({
  accountId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  status: z
    .enum(["received", "transcribing", "transcribed", "scoring", "scored", "failed"])
    .optional(),
  outcome: z.enum(CALL_OUTCOMES).optional(),
  autoFailed: z.enum(["true", "false"]).optional(),
  flagType: z.enum(["compliance", "soft_skill", "outcome", "processing_error"]).optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  maxScore: z.coerce.number().min(0).max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const overrideBodySchema = z.object({
  score: z.number().min(0).max(100),
  autoFailed: z.boolean(),
  outcome: z.enum(CALL_OUTCOMES),
  reason: z.string().min(10, "override justification is mandatory"),
});

const noteBodySchema = z.object({
  note: z.string().min(1),
  assignedTo: z.string().uuid().nullable().default(null),
});

export function callsRouter(db: Db): Router {
  const router = Router();

  // The Call Queue — filterable triage list.
  router.get(
    "/",
    h(async (req, res) => {
      const q = queueQuerySchema.parse(req.query);
      const result = await calls.queue(db, {
        ...q,
        autoFailed: q.autoFailed === undefined ? undefined : q.autoFailed === "true",
      });
      res.json(result);
    }),
  );

  // Call Detail — everything the review screen needs in one round trip.
  router.get(
    "/:id",
    h(async (req, res) => {
      const call = await calls.getById(db, String(req.params.id));
      if (!call) {
        res.status(404).json({ error: "call not found" });
        return;
      }
      const transcript = await transcripts.getByCallId(db, call.id);
      const utterances = transcript ? await transcripts.utterances(db, transcript.id) : [];
      const result = await results.getByCallId(db, call.id);
      const criterionScores = result ? await results.criterionScores(db, result.id) : [];
      const flags = await results.flagsForCall(db, call.id);
      const notes = await coaching.forCall(db, call.id);
      res.json({ call, transcript, utterances, result, criterionScores, flags, notes });
    }),
  );

  // Signed playback URL, minted per-request after RBAC.
  router.post(
    "/:id/audio-url",
    h(async (req, res) => {
      const call = await calls.getById(db, String(req.params.id));
      if (!call) {
        res.status(404).json({ error: "call not found" });
        return;
      }
      const url = await playbackUrl(call.gcs_bucket, call.gcs_object_path);
      res.json({ url, expiresInSeconds: 15 * 60 });
    }),
  );

  // Manager override — mandatory justification, full audit trail.
  router.post(
    "/:id/override",
    requireRole("manager"),
    h(async (req, res) => {
      const body = overrideBodySchema.parse(req.body);
      const ok = await results.override(db, {
        callId: String(req.params.id),
        userId: req.user!.id,
        score: body.score,
        autoFailed: body.autoFailed,
        outcome: body.outcome,
        reason: body.reason,
      });
      if (!ok) {
        res.status(404).json({ error: "no scored result for this call" });
        return;
      }
      res.json({ ok: true });
    }),
  );

  // Manual speaker correction (agent/customer swap).
  router.post(
    "/:id/swap-speakers",
    h(async (req, res) => {
      const transcript = await transcripts.getByCallId(db, String(req.params.id));
      if (!transcript) {
        res.status(404).json({ error: "no transcript for this call" });
        return;
      }
      await transcripts.swapSpeakers(db, transcript.id);
      res.json({ ok: true });
    }),
  );

  // Coaching notes on a call.
  router.post(
    "/:id/coaching-notes",
    h(async (req, res) => {
      const body = noteBodySchema.parse(req.body);
      const call = await calls.getById(db, String(req.params.id));
      if (!call?.agent_id) {
        res.status(400).json({ error: "call has no agent to coach" });
        return;
      }
      const note = await coaching.create(db, {
        callId: call.id,
        agentId: call.agent_id,
        assignedTo: body.assignedTo,
        createdBy: req.user!.id,
        note: body.note,
      });
      res.status(201).json(note);
    }),
  );

  return router;
}
