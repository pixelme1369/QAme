import type { Db } from "../pool.js";
import type { CoachingNoteRow } from "../types.js";

export interface NewCoachingNote {
  callId: string;
  agentId: string;
  assignedTo: string | null;
  createdBy: string;
  note: string;
}

export async function create(db: Db, n: NewCoachingNote): Promise<CoachingNoteRow> {
  const res = await db.query<CoachingNoteRow>(
    `INSERT INTO coaching_notes (call_id, agent_id, assigned_to, created_by, note)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [n.callId, n.agentId, n.assignedTo, n.createdBy, n.note],
  );
  return res.rows[0]!;
}

export async function forCall(db: Db, callId: string): Promise<CoachingNoteRow[]> {
  const res = await db.query<CoachingNoteRow>(
    `SELECT * FROM coaching_notes WHERE call_id = $1 ORDER BY created_at DESC`,
    [callId],
  );
  return res.rows;
}

export async function forAgent(db: Db, agentId: string): Promise<CoachingNoteRow[]> {
  const res = await db.query<CoachingNoteRow>(
    `SELECT * FROM coaching_notes WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [agentId],
  );
  return res.rows;
}

export async function setStatus(
  db: Db,
  id: string,
  status: CoachingNoteRow["status"],
): Promise<boolean> {
  const res = await db.query(
    `UPDATE coaching_notes SET status = $1, updated_at = now() WHERE id = $2`,
    [status, id],
  );
  return (res.rowCount ?? 0) === 1;
}
