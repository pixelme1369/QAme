import type { NextFunction, Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import { users, type Db, type UserRole, type UserRow } from "@qame/db";
import type { Config } from "./config.js";

/**
 * Google-identity-backed SSO. The dashboard sends the Google ID token as a
 * bearer token; we verify signature + audience, then require a provisioned,
 * active row in the users table — SSO authenticates, the users table
 * authorizes. Roles: analyst < manager < admin.
 */

declare module "express-serve-static-core" {
  interface Request {
    user?: UserRow;
  }
}

const ROLE_RANK: Record<UserRole, number> = { analyst: 1, manager: 2, admin: 3 };

export function authenticate(db: Db, config: Config) {
  const client = new OAuth2Client(config.GOOGLE_OAUTH_CLIENT_ID);
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      res.status(401).json({ error: "missing bearer token" });
      return;
    }
    try {
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: config.GOOGLE_OAUTH_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (!payload?.email || !payload.email_verified) {
        res.status(401).json({ error: "unverified identity" });
        return;
      }
      const user = await users.byEmail(db, payload.email);
      if (!user) {
        res.status(403).json({ error: "not provisioned for this system" });
        return;
      }
      if (!user.google_sub && payload.sub) {
        await users.bindGoogleSub(db, user.id, payload.sub);
      } else if (user.google_sub && user.google_sub !== payload.sub) {
        res.status(403).json({ error: "identity mismatch" });
        return;
      }
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: "invalid token" });
    }
  };
}

export function requireRole(minimum: UserRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user || ROLE_RANK[user.role] < ROLE_RANK[minimum]) {
      res.status(403).json({ error: `requires ${minimum} role` });
      return;
    }
    next();
  };
}
