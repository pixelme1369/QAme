import type { Db } from "../pool.js";
import type { CategoryScore, CriterionScoreRow, FlagRow, ResultRow } from "../types.js";

export interface NewCriterionScore {
  criterionId: string;
  passed: boolean | null;
  score: number | null;
  rationale: string;
  evidenceQuote: string | null;
  evidenceStartMs: number | null;
}

export interface NewFlag {
  type: FlagRow["type"];
  severity: FlagRow["severity"];
  source: FlagRow["source"];
  label: string;
  detail: string | null;
}

export interface NewResult {
  callId: string;
  templateId: string;
  overallScore: number;
  autoFailed: boolean;
  outcome: string;
  outcomeRationale: string;
  callSummary: string;
  categoryScores: CategoryScore[];
  aiModel: string;
  promptVersion: string;
  criterionScores: NewCriterionScore[];
  flags: NewFlag[];
}

/** Persists the full scoring outcome atomically. Idempotent on call_id. */
export async function insert(db: Db, r: NewResult): Promise<string | null> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query<{ id: string }>(
      `INSERT INTO call_scorecard_results
         (call_id, template_id, overall_score, auto_failed, outcome,
          outcome_rationale, call_summary, category_scores, ai_model, prompt_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (call_id) DO NOTHING
       RETURNING id`,
      [
        r.callId,
        r.templateId,
        r.overallScore,
        r.autoFailed,
        r.outcome,
        r.outcomeRationale,
        r.callSummary,
        JSON.stringify(r.categoryScores),
        r.aiModel,
        r.promptVersion,
      ],
    );
    const resultId = res.rows[0]?.id;
    if (!resultId) {
      await client.query("ROLLBACK");
      return null;
    }
    for (const cs of r.criterionScores) {
      await client.query(
        `INSERT INTO call_criterion_scores
           (result_id, criterion_id, passed, score, rationale, evidence_quote, evidence_start_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [resultId, cs.criterionId, cs.passed, cs.score, cs.rationale, cs.evidenceQuote, cs.evidenceStartMs],
      );
    }
    for (const f of r.flags) {
      await client.query(
        `INSERT INTO flags (call_id, type, severity, source, label, detail)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [r.callId, f.type, f.severity, f.source, f.label, f.detail],
      );
    }
    await client.query("COMMIT");
    return resultId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getByCallId(db: Db, callId: string): Promise<ResultRow | null> {
  const res = await db.query<ResultRow>(
    `SELECT * FROM call_scorecard_results WHERE call_id = $1`,
    [callId],
  );
  return res.rows[0] ?? null;
}

export interface CriterionScoreDetail extends CriterionScoreRow {
  criterion_name: string;
  guidance: string;
  scoring_type: string;
  is_auto_fail: boolean;
  category_name: string;
}

export async function criterionScores(db: Db, resultId: string): Promise<CriterionScoreDetail[]> {
  const res = await db.query<CriterionScoreDetail>(
    `SELECT ccs.*, cr.name AS criterion_name, cr.guidance, cr.scoring_type,
            cr.is_auto_fail, cat.name AS category_name
       FROM call_criterion_scores ccs
       JOIN scorecard_criteria cr ON cr.id = ccs.criterion_id
       JOIN scorecard_categories cat ON cat.id = cr.category_id
      WHERE ccs.result_id = $1
      ORDER BY cat.sort_order, cr.sort_order`,
    [resultId],
  );
  return res.rows;
}

export async function flagsForCall(db: Db, callId: string): Promise<FlagRow[]> {
  const res = await db.query<FlagRow>(
    `SELECT * FROM flags WHERE call_id = $1 ORDER BY created_at`,
    [callId],
  );
  return res.rows;
}

export interface OverrideInput {
  callId: string;
  userId: string;
  score: number;
  autoFailed: boolean;
  outcome: string;
  reason: string;
}

/**
 * Manager override with mandatory justification. The original AI score is
 * never touched; the override lands in dedicated columns and the audit log.
 */
export async function override(db: Db, o: OverrideInput): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query<{ id: string }>(
      `UPDATE call_scorecard_results
          SET override_score = $1, override_auto_failed = $2, override_outcome = $3,
              override_reason = $4, override_by = $5, override_at = now()
        WHERE call_id = $6
        RETURNING id`,
      [o.score, o.autoFailed, o.outcome, o.reason, o.userId, o.callId],
    );
    const resultId = res.rows[0]?.id;
    if (!resultId) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, detail)
       VALUES ($1, 'score_override', 'call_scorecard_result', $2, $3)`,
      [o.userId, resultId, JSON.stringify({ score: o.score, autoFailed: o.autoFailed, outcome: o.outcome, reason: o.reason })],
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
