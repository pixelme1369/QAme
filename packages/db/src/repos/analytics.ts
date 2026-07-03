import type { Db } from "../pool.js";

/** Effective score = manager override when present, else the AI score. */
const EFFECTIVE_SCORE = `COALESCE(r.override_score, r.overall_score)`;
const EFFECTIVE_AUTOFAIL = `COALESCE(r.override_auto_failed, r.auto_failed)`;

export interface AgentPerformanceRow {
  agent_id: string;
  agent_name: string;
  calls_scored: number;
  avg_score: number | null;
  auto_fail_rate: number | null;
  critical_flags: number;
  coaching_open: number;
}

/** Leaderboard rollup per agent over a window. */
export async function agentLeaderboard(
  db: Db,
  accountId: string,
  from: Date,
  to: Date,
): Promise<AgentPerformanceRow[]> {
  const res = await db.query<AgentPerformanceRow>(
    `SELECT a.id AS agent_id,
            a.full_name AS agent_name,
            count(r.id)::int AS calls_scored,
            round(avg(${EFFECTIVE_SCORE}), 1)::float AS avg_score,
            round(avg(CASE WHEN ${EFFECTIVE_AUTOFAIL} THEN 1 ELSE 0 END) * 100, 1)::float
              AS auto_fail_rate,
            (SELECT count(*)::int FROM flags fl
               JOIN calls c2 ON c2.id = fl.call_id
              WHERE c2.agent_id = a.id AND fl.severity = 'critical'
                AND fl.created_at BETWEEN $2 AND $3) AS critical_flags,
            (SELECT count(*)::int FROM coaching_notes cn
              WHERE cn.agent_id = a.id AND cn.status <> 'resolved') AS coaching_open
       FROM agents a
       LEFT JOIN calls c ON c.agent_id = a.id AND c.recorded_at BETWEEN $2 AND $3
       LEFT JOIN call_scorecard_results r ON r.call_id = c.id
      WHERE a.account_id = $1 AND a.is_active
      GROUP BY a.id, a.full_name
      ORDER BY avg_score DESC NULLS LAST`,
    [accountId, from, to],
  );
  return res.rows;
}

export interface ScoreTrendPoint {
  day: string;
  calls_scored: number;
  avg_score: number | null;
  auto_fail_rate: number | null;
}

/** Daily score trend, optionally per agent or campaign. */
export async function scoreTrend(
  db: Db,
  opts: { accountId: string; agentId?: string; campaignId?: string; from: Date; to: Date },
): Promise<ScoreTrendPoint[]> {
  const res = await db.query<ScoreTrendPoint>(
    `SELECT to_char(date_trunc('day', c.recorded_at), 'YYYY-MM-DD') AS day,
            count(r.id)::int AS calls_scored,
            round(avg(${EFFECTIVE_SCORE}), 1)::float AS avg_score,
            round(avg(CASE WHEN ${EFFECTIVE_AUTOFAIL} THEN 1 ELSE 0 END) * 100, 1)::float
              AS auto_fail_rate
       FROM calls c
       JOIN call_scorecard_results r ON r.call_id = c.id
      WHERE c.account_id = $1
        AND ($2::uuid IS NULL OR c.agent_id = $2)
        AND ($3::uuid IS NULL OR c.campaign_id = $3)
        AND c.recorded_at BETWEEN $4 AND $5
      GROUP BY 1 ORDER BY 1`,
    [opts.accountId, opts.agentId ?? null, opts.campaignId ?? null, opts.from, opts.to],
  );
  return res.rows;
}

export interface CategoryBreakdownRow {
  category_name: string;
  avg_score: number | null;
}

/** Average per-category sub-score, unpacked from the stored JSONB rollup. */
export async function categoryBreakdown(
  db: Db,
  opts: { accountId: string; agentId?: string; from: Date; to: Date },
): Promise<CategoryBreakdownRow[]> {
  const res = await db.query<CategoryBreakdownRow>(
    `SELECT cs->>'name' AS category_name,
            round(avg((cs->>'score')::numeric), 1)::float AS avg_score
       FROM calls c
       JOIN call_scorecard_results r ON r.call_id = c.id
       CROSS JOIN LATERAL jsonb_array_elements(r.category_scores) AS cs
      WHERE c.account_id = $1
        AND ($2::uuid IS NULL OR c.agent_id = $2)
        AND c.recorded_at BETWEEN $3 AND $4
      GROUP BY 1 ORDER BY 1`,
    [opts.accountId, opts.agentId ?? null, opts.from, opts.to],
  );
  return res.rows;
}

export interface OutcomeDistributionRow {
  outcome: string;
  count: number;
}

export async function outcomeDistribution(
  db: Db,
  opts: { accountId: string; agentId?: string; from: Date; to: Date },
): Promise<OutcomeDistributionRow[]> {
  const res = await db.query<OutcomeDistributionRow>(
    `SELECT COALESCE(r.override_outcome, r.outcome) AS outcome, count(*)::int AS count
       FROM calls c
       JOIN call_scorecard_results r ON r.call_id = c.id
      WHERE c.account_id = $1
        AND ($2::uuid IS NULL OR c.agent_id = $2)
        AND c.recorded_at BETWEEN $3 AND $4
      GROUP BY 1 ORDER BY count DESC`,
    [opts.accountId, opts.agentId ?? null, opts.from, opts.to],
  );
  return res.rows;
}

export interface OverviewStats {
  calls_total: number;
  calls_scored: number;
  avg_score: number | null;
  auto_fail_rate: number | null;
  override_rate: number | null;
}

/**
 * Team/account overview. override_rate doubles as the live AI-drift signal:
 * a rising share of manager overrides means the rubric or model needs review.
 */
export async function overview(
  db: Db,
  accountId: string,
  from: Date,
  to: Date,
): Promise<OverviewStats> {
  const res = await db.query<OverviewStats>(
    `SELECT count(c.id)::int AS calls_total,
            count(r.id)::int AS calls_scored,
            round(avg(${EFFECTIVE_SCORE}), 1)::float AS avg_score,
            round(avg(CASE WHEN ${EFFECTIVE_AUTOFAIL} THEN 1 ELSE 0 END) * 100, 1)::float
              AS auto_fail_rate,
            round(avg(CASE WHEN r.override_score IS NOT NULL THEN 1 ELSE 0 END) * 100, 1)::float
              AS override_rate
       FROM calls c
       LEFT JOIN call_scorecard_results r ON r.call_id = c.id
      WHERE c.account_id = $1 AND c.recorded_at BETWEEN $2 AND $3`,
    [accountId, from, to],
  );
  return res.rows[0]!;
}
