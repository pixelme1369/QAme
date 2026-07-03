import type { Db } from "../pool.js";
import type { ProcessingErrorRow } from "../types.js";

export interface NewProcessingError {
  callId: string | null;
  stage: string;
  errorCode: string;
  message: string;
  detail?: Record<string, unknown>;
}

/** Every pipeline failure lands here — visible in the ops console, never dropped. */
export async function recordError(db: Db, e: NewProcessingError): Promise<void> {
  await db.query(
    `INSERT INTO processing_errors (call_id, stage, error_code, message, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [e.callId, e.stage, e.errorCode, e.message, e.detail ? JSON.stringify(e.detail) : null],
  );
}

export async function listErrors(
  db: Db,
  opts: { resolved?: boolean; limit: number },
): Promise<ProcessingErrorRow[]> {
  const res = await db.query<ProcessingErrorRow>(
    `SELECT * FROM processing_errors
      WHERE ($1::boolean IS NULL OR resolved = $1)
      ORDER BY occurred_at DESC
      LIMIT $2`,
    [opts.resolved ?? null, opts.limit],
  );
  return res.rows;
}

export async function resolveError(db: Db, id: string): Promise<void> {
  await db.query(`UPDATE processing_errors SET resolved = true WHERE id = $1`, [id]);
}

export interface PipelineHealth {
  by_status: Array<{ status: string; count: number }>;
  unresolved_errors: number;
  scored_last_24h: number;
  failed_last_24h: number;
}

export async function pipelineHealth(db: Db): Promise<PipelineHealth> {
  const byStatus = await db.query<{ status: string; count: string }>(
    `SELECT status, count(*)::text FROM calls GROUP BY status`,
  );
  const errs = await db.query<{ count: string }>(
    `SELECT count(*)::text FROM processing_errors WHERE NOT resolved`,
  );
  const scored = await db.query<{ count: string }>(
    `SELECT count(*)::text FROM calls
      WHERE status = 'scored' AND status_updated_at > now() - interval '24 hours'`,
  );
  const failed = await db.query<{ count: string }>(
    `SELECT count(*)::text FROM calls
      WHERE status = 'failed' AND status_updated_at > now() - interval '24 hours'`,
  );
  return {
    by_status: byStatus.rows.map((r) => ({ status: r.status, count: Number(r.count) })),
    unresolved_errors: Number(errs.rows[0]?.count ?? 0),
    scored_last_24h: Number(scored.rows[0]?.count ?? 0),
    failed_last_24h: Number(failed.rows[0]?.count ?? 0),
  };
}
