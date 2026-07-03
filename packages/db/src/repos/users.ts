import type { Db } from "../pool.js";
import type { UserRow } from "../types.js";

export async function byEmail(db: Db, email: string): Promise<UserRow | null> {
  const res = await db.query<UserRow>(
    `SELECT * FROM users WHERE lower(email) = lower($1) AND is_active`,
    [email],
  );
  return res.rows[0] ?? null;
}

/** Binds the Google identity subject to a provisioned user on first login. */
export async function bindGoogleSub(db: Db, userId: string, sub: string): Promise<void> {
  await db.query(
    `UPDATE users SET google_sub = $1 WHERE id = $2 AND google_sub IS NULL`,
    [sub, userId],
  );
}

export async function list(db: Db): Promise<UserRow[]> {
  const res = await db.query<UserRow>(`SELECT * FROM users ORDER BY full_name`);
  return res.rows;
}
