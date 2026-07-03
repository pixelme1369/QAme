import { Router } from "express";
import { analytics, org, coaching, type Db } from "@qame/db";
import { h, parseDateRange } from "../lib/http.js";

export function analyticsRouter(db: Db): Router {
  const router = Router();

  router.get(
    "/overview",
    h(async (req, res) => {
      const accountId = String(req.query.accountId ?? "");
      const { from, to } = parseDateRange(req);
      res.json(await analytics.overview(db, accountId, from, to));
    }),
  );

  router.get(
    "/leaderboard",
    h(async (req, res) => {
      const accountId = String(req.query.accountId ?? "");
      const { from, to } = parseDateRange(req);
      res.json(await analytics.agentLeaderboard(db, accountId, from, to));
    }),
  );

  router.get(
    "/trend",
    h(async (req, res) => {
      const { from, to } = parseDateRange(req);
      res.json(
        await analytics.scoreTrend(db, {
          accountId: String(req.query.accountId ?? ""),
          agentId: req.query.agentId ? String(req.query.agentId) : undefined,
          campaignId: req.query.campaignId ? String(req.query.campaignId) : undefined,
          from,
          to,
        }),
      );
    }),
  );

  router.get(
    "/categories",
    h(async (req, res) => {
      const { from, to } = parseDateRange(req);
      res.json(
        await analytics.categoryBreakdown(db, {
          accountId: String(req.query.accountId ?? ""),
          agentId: req.query.agentId ? String(req.query.agentId) : undefined,
          from,
          to,
        }),
      );
    }),
  );

  router.get(
    "/outcomes",
    h(async (req, res) => {
      const { from, to } = parseDateRange(req);
      res.json(
        await analytics.outcomeDistribution(db, {
          accountId: String(req.query.accountId ?? ""),
          agentId: req.query.agentId ? String(req.query.agentId) : undefined,
          from,
          to,
        }),
      );
    }),
  );

  router.get(
    "/agents/:agentId",
    h(async (req, res) => {
      const agentId = String(req.params.agentId);
      const agent = await org.agentById(db, agentId);
      if (!agent) {
        res.status(404).json({ error: "agent not found" });
        return;
      }
      const { from, to } = parseDateRange(req);
      const [trend, categories, outcomes, notes] = await Promise.all([
        analytics.scoreTrend(db, { accountId: agent.account_id, agentId, from, to }),
        analytics.categoryBreakdown(db, { accountId: agent.account_id, agentId, from, to }),
        analytics.outcomeDistribution(db, { accountId: agent.account_id, agentId, from, to }),
        coaching.forAgent(db, agentId),
      ]);
      res.json({ agent, trend, categories, outcomes, coachingNotes: notes });
    }),
  );

  return router;
}
