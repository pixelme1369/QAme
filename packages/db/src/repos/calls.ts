import type { Db } from "../pool.js";
import type { CallRow, CallStatus } from "../types.js";

export interface NewCall {
  accountId: string;
  gcsObjectPath: string;
  gcsBucket: string;
  recordedAt: Date;
  phoneNumber: string;
  direction?: "outbound" | "inbound";
  agentId?: string | null;
  campaignId?: string | null;
}

/**
 * Idempotent insert keyed on gcs_object_path. Returns the row when this call
 * created it, or null when the recording was already ingested (Pub/Sub
 * redelivery, event replay) — the caller then skips the pipeline kick-off.
 */
export async function insertIfNew(db: Db, call: NewCall): Promise<CallRow | null> {
  const res = await db.query<CallRow>(
    `INSERT INTO calls
       (account_id, gcs_object_path, gcs_bucket, recorded_at, phone_number,
        direction, agent_id, campaign_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (gcs_object_path) DO NOTHING
     RETURNING *`,
    [
      call.accountId,
      call.gcsObjectPath,
      call.gcsBucket,
      call.recordedAt,
      call.phoneNumber,
      call.direction ?? "outbound",
      call.agentId ?? null,
      call.campaignId ?? null,
    ],
  );
  return res.rows[0] ?? null;
}

/**
 * Conditional state transition. Returns false when the call was not in the
 * expected state — the signal that another worker already handled this stage,
 * so the caller drops the (redelivered) event instead of double-processing.
 */
export async function transition(
  db: Db,
  callId: string,
  from: CallStatus | CallStatus[],
  to: CallStatus,
): Promise<boolean> {
  const fromList = Array.isArray(from) ? from : [from];
  const res = await db.query(
    `UPDATE calls SET status = $1, status_updated_at = now()
     WHERE id = $2 AND status = ANY($3)`,
    [to, callId, fromList],
  );
  return (res.rowCount ?? 0) === 1;
}

export async function getById(db: Db, id: string): Promise<CallRow | null> {
  const res = await db.query<CallRow>(`SELECT * FROM calls WHERE id = $1`, [id]);
  return res.rows[0] ?? null;
}

export async function setDuration(db: Db, id: string, seconds: number): Promise<void> {
  await db.query(`UPDATE calls SET duration_seconds = $1 WHERE id = $2`, [seconds, id]);
}

export async function setAgent(db: Db, id: string, agentId: string | null): Promise<void> {
  await db.query(`UPDATE calls SET agent_id = $1 WHERE id = $2`, [agentId, id]);
}

export interface CallQueueFilters {
  accountId?: string;
  agentId?: string;
  campaignId?: string;
  status?: CallStatus;
  outcome?: string;
  autoFailed?: boolean;
  flagType?: string;
  minScore?: number;
  maxScore?: number;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

export interface CallQueueItem extends CallRow {
  agent_name: string | null;
  campaign_name: string | null;
  overall_score: string | null;
  auto_failed: boolean | null;
  outcome: string | null;
  override_score: string | null;
  flag_count: number;
  critical_flag_count: number;
}

/** The Call Queue: one query powering the analysts' daily triage view. */
export async function queue(
  db: Db,
  f: CallQueueFilters,
): Promise<{ items: CallQueueItem[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.accountId) where.push(`c.account_id = ${p(f.accountId)}`);
  if (f.agentId) where.push(`c.agent_id = ${p(f.agentId)}`);
  if (f.campaignId) where.push(`c.campaign_id = ${p(f.campaignId)}`);
  if (f.status) where.push(`c.status = ${p(f.status)}`);
  if (f.outcome) where.push(`r.outcome = ${p(f.outcome)}`);
  if (f.autoFailed !== undefined) {
    where.push(`COALESCE(r.override_auto_failed, r.auto_failed) = ${p(f.autoFailed)}`);
  }
  if (f.minScore !== undefined) {
    where.push(`COALESCE(r.override_score, r.overall_score) >= ${p(f.minScore)}`);
  }
  if (f.maxScore !== undefined) {
    where.push(`COALESCE(r.override_score, r.overall_score) <= ${p(f.maxScore)}`);
  }
  if (f.from) where.push(`c.recorded_at >= ${p(f.from)}`);
  if (f.to) where.push(`c.recorded_at <= ${p(f.to)}`);
  if (f.flagType) {
    where.push(
      `EXISTS (SELECT 1 FROM flags fl WHERE fl.call_id = c.id AND fl.type = ${p(f.flagType)})`,
    );
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const countRes = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total
       FROM calls c
       LEFT JOIN call_scorecard_results r ON r.call_id = c.id
     ${whereSql}`,
    params,
  );

  const limitP = p(f.limit);
  const offsetP = p(f.offset);
  const res = await db.query<CallQueueItem>(
    `SELECT c.*,
            a.full_name AS agent_name,
            cp.name AS campaign_name,
            r.overall_score, r.auto_failed, r.outcome, r.override_score,
            (SELECT count(*)::int FROM flags fl WHERE fl.call_id = c.id) AS flag_count,
            (SELECT count(*)::int FROM flags fl
              WHERE fl.call_id = c.id AND fl.severity = 'critical') AS critical_flag_count
       FROM calls c
       LEFT JOIN agents a ON a.id = c.agent_id
       LEFT JOIN campaigns cp ON cp.id = c.campaign_id
       LEFT JOIN call_scorecard_results r ON r.call_id = c.id
     ${whereSql}
     ORDER BY c.recorded_at DESC
     LIMIT ${limitP} OFFSET ${offsetP}`,
    params,
  );
  return { items: res.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}

/** Calls stuck mid-pipeline longer than the threshold — for the ops console. */
export async function stuck(db: Db, olderThanMinutes: number): Promise<CallRow[]> {
  const res = await db.query<CallRow>(
    `SELECT * FROM calls
      WHERE status NOT IN ('scored', 'failed')
        AND status_updated_at < now() - ($1 || ' minutes')::interval
      ORDER BY status_updated_at ASC
      LIMIT 200`,
    [String(olderThanMinutes)],
  );
  return res.rows;
}
