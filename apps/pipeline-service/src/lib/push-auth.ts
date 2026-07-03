import type { NextFunction, Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import type { Config } from "../config.js";
import { log } from "./logger.js";

/**
 * Verifies the OIDC token Google attaches to Pub/Sub push deliveries.
 * Every internal endpoint sits behind this; the only unauthenticated route
 * is /healthz. When PUSH_AUTH_AUDIENCE is unset (local dev), verification
 * is disabled and a warning is logged once at boot.
 */
export function pushAuth(config: Config) {
  const client = new OAuth2Client();
  if (!config.PUSH_AUTH_AUDIENCE) {
    log.warn("push auth DISABLED (PUSH_AUTH_AUDIENCE unset) — local dev only");
  }
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!config.PUSH_AUTH_AUDIENCE) return next();
    try {
      const header = req.header("authorization") ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : null;
      if (!token) {
        res.status(401).json({ error: "missing bearer token" });
        return;
      }
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: config.PUSH_AUTH_AUDIENCE,
      });
      const payload = ticket.getPayload();
      if (
        config.PUSH_AUTH_SERVICE_ACCOUNT &&
        payload?.email !== config.PUSH_AUTH_SERVICE_ACCOUNT
      ) {
        res.status(403).json({ error: "unexpected caller identity" });
        return;
      }
      next();
    } catch {
      res.status(401).json({ error: "invalid token" });
    }
  };
}
