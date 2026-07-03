import { Router } from "express";
import { org, users, type Db } from "@qame/db";
import { requireRole } from "../auth.js";
import { h } from "../lib/http.js";

export function orgRouter(db: Db): Router {
  const router = Router();

  router.get(
    "/me",
    h(async (req, res) => {
      const { id, email, full_name, role } = req.user!;
      res.json({ id, email, fullName: full_name, role });
    }),
  );

  router.get(
    "/accounts",
    h(async (_req, res) => {
      res.json(await org.listAccounts(db));
    }),
  );

  router.get(
    "/agents",
    h(async (req, res) => {
      res.json(await org.listAgents(db, String(req.query.accountId ?? "")));
    }),
  );

  router.get(
    "/campaigns",
    h(async (req, res) => {
      res.json(await org.listCampaigns(db, String(req.query.accountId ?? "")));
    }),
  );

  router.get(
    "/users",
    requireRole("admin"),
    h(async (_req, res) => {
      res.json(await users.list(db));
    }),
  );

  return router;
}
