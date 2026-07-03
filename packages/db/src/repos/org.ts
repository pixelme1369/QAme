import type { Db } from "../pool.js";
import type { AgentRow } from "../types.js";

export interface AccountRow {
  id: string;
  external_id: string;
  name: string;
  is_active: boolean;
  created_at: Date;
}

export async function accountByExternalId(db: Db, externalId: string): Promise<AccountRow | null> {
  const res = await db.query<AccountRow>(
    `SELECT * FROM accounts WHERE external_id = $1 AND is_active`,
    [externalId],
  );
  return res.rows[0] ?? null;
}

export async function listAccounts(db: Db): Promise<AccountRow[]> {
  const res = await db.query<AccountRow>(`SELECT * FROM accounts ORDER BY name`);
  return res.rows;
}

export async function listAgents(db: Db, accountId: string): Promise<AgentRow[]> {
  const res = await db.query<AgentRow>(
    `SELECT * FROM agents WHERE account_id = $1 AND is_active ORDER BY full_name`,
    [accountId],
  );
  return res.rows;
}

export async function agentById(db: Db, id: string): Promise<AgentRow | null> {
  const res = await db.query<AgentRow>(`SELECT * FROM agents WHERE id = $1`, [id]);
  return res.rows[0] ?? null;
}

export interface CampaignRow {
  id: string;
  account_id: string;
  name: string;
  is_active: boolean;
}

export async function listCampaigns(db: Db, accountId: string): Promise<CampaignRow[]> {
  const res = await db.query<CampaignRow>(
    `SELECT * FROM campaigns WHERE account_id = $1 AND is_active ORDER BY name`,
    [accountId],
  );
  return res.rows;
}
