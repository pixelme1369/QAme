import { Router } from "express";
import { z } from "zod";
import { SCORING_TYPES } from "@qame/scorecard-schema";
import { scorecards, type Db } from "@qame/db";
import { requireRole } from "../auth.js";
import { h } from "../lib/http.js";

const publishBodySchema = z.object({
  accountId: z.string().uuid(),
  name: z.string().min(1),
  categories: z
    .array(
      z.object({
        name: z.string().min(1),
        weight: z.number().positive(),
        sortOrder: z.number().int(),
        criteria: z
          .array(
            z.object({
              name: z.string().min(1),
              guidance: z.string().min(1),
              scoringType: z.enum(SCORING_TYPES),
              weight: z.number().positive().default(1),
              isAutoFail: z.boolean().default(false),
              sortOrder: z.number().int(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

export function scorecardsRouter(db: Db): Router {
  const router = Router();

  router.get(
    "/",
    h(async (req, res) => {
      const accountId = String(req.query.accountId ?? "");
      res.json(await scorecards.listByAccount(db, accountId));
    }),
  );

  router.get(
    "/active",
    h(async (req, res) => {
      const accountId = String(req.query.accountId ?? "");
      const template = await scorecards.getActive(db, accountId);
      if (!template) {
        res.status(404).json({ error: "no active scorecard" });
        return;
      }
      res.json(template);
    }),
  );

  router.get(
    "/:id",
    h(async (req, res) => {
      const template = await scorecards.getById(db, String(req.params.id));
      if (!template) {
        res.status(404).json({ error: "scorecard not found" });
        return;
      }
      res.json(template);
    }),
  );

  // Publishing a new rubric version — admin only, no deploy needed. The DB
  // check constraint enforces auto-fail ⇒ pass_fail; scored calls keep the
  // version they were judged against.
  router.post(
    "/publish",
    requireRole("admin"),
    h(async (req, res) => {
      const body = publishBodySchema.parse(req.body);
      for (const cat of body.categories) {
        for (const crit of cat.criteria) {
          if (crit.isAutoFail && crit.scoringType !== "pass_fail") {
            res.status(400).json({
              error: `criterion "${crit.name}" is auto-fail but not pass_fail`,
            });
            return;
          }
        }
      }
      const templateId = await scorecards.publishVersion(db, {
        ...body,
        createdBy: req.user!.id,
      });
      res.status(201).json({ templateId });
    }),
  );

  return router;
}
