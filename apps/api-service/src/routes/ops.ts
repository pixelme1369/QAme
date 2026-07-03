import { Router } from "express";
import { z } from "zod";
import { calls, coaching, ops, type Db } from "@qame/db";
import { requireRole } from "../auth.js";
import { h } from "../lib/http.js";

export function opsRouter(db: Db): Router {
  const router = Router();
  router.use(requireRole("admin"));

  router.get(
    "/health",
    h(async (_req, res) => {
      res.json(await ops.pipelineHealth(db));
    }),
  );

  router.get(
    "/errors",
    h(async (req, res) => {
      const resolved =
        req.query.resolved === undefined ? false : req.query.resolved === "true";
      res.json(await ops.listErrors(db, { resolved, limit: 200 }));
    }),
  );

  router.post(
    "/errors/:id/resolve",
    h(async (req, res) => {
      await ops.resolveError(db, String(req.params.id));
      res.json({ ok: true });
    }),
  );

  router.get(
    "/stuck-calls",
    h(async (req, res) => {
      const minutes = z.coerce.number().int().min(1).default(30).parse(req.query.minutes);
      res.json(await calls.stuck(db, minutes));
    }),
  );

  return router;
}

const noteStatusSchema = z.object({
  status: z.enum(["open", "in_progress", "resolved"]),
});

export function coachingRouter(db: Db): Router {
  const router = Router();
  router.patch(
    "/:id/status",
    h(async (req, res) => {
      const body = noteStatusSchema.parse(req.body);
      const ok = await coaching.setStatus(db, String(req.params.id), body.status);
      if (!ok) {
        res.status(404).json({ error: "note not found" });
        return;
      }
      res.json({ ok: true });
    }),
  );
  return router;
}
