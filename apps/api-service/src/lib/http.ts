import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Routes throw; this funnels rejections into the error middleware. */
export function h(
  fn: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error(JSON.stringify({ severity: "ERROR", message: String(err) }));
  if (res.headersSent) return;
  res.status(500).json({ error: "internal error" });
}

export function parseDateRange(req: Request): { from: Date; to: Date } {
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const from = req.query.from
    ? new Date(String(req.query.from))
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw Object.assign(new Error("invalid date range"), { status: 400 });
  }
  return { from, to };
}
