import type {
  Category,
  Criterion,
  ScorecardTemplate,
  ScoringType,
} from "@qame/scorecard-schema";
import type { Db } from "../pool.js";

interface TemplateHeadRow {
  id: string;
  account_id: string;
  name: string;
  version: number;
  status: "draft" | "active" | "retired";
  created_at: Date;
}

interface CategoryRow {
  id: string;
  template_id: string;
  name: string;
  weight: string;
  sort_order: number;
}

interface CriterionRow {
  id: string;
  category_id: string;
  name: string;
  guidance: string;
  scoring_type: ScoringType;
  weight: string;
  is_auto_fail: boolean;
  sort_order: number;
}

async function hydrate(db: Db, head: TemplateHeadRow): Promise<ScorecardTemplate> {
  const catRes = await db.query<CategoryRow>(
    `SELECT * FROM scorecard_categories WHERE template_id = $1 ORDER BY sort_order`,
    [head.id],
  );
  const critRes = await db.query<CriterionRow>(
    `SELECT cr.* FROM scorecard_criteria cr
       JOIN scorecard_categories cat ON cat.id = cr.category_id
      WHERE cat.template_id = $1
      ORDER BY cr.sort_order`,
    [head.id],
  );
  const criteriaByCat = new Map<string, Criterion[]>();
  for (const c of critRes.rows) {
    const list = criteriaByCat.get(c.category_id) ?? [];
    list.push({
      id: c.id,
      name: c.name,
      guidance: c.guidance,
      scoringType: c.scoring_type,
      weight: Number(c.weight),
      isAutoFail: c.is_auto_fail,
      sortOrder: c.sort_order,
    });
    criteriaByCat.set(c.category_id, list);
  }
  const categories: Category[] = catRes.rows.map((cat) => ({
    id: cat.id,
    name: cat.name,
    weight: Number(cat.weight),
    sortOrder: cat.sort_order,
    criteria: criteriaByCat.get(cat.id) ?? [],
  }));
  return {
    id: head.id,
    accountId: head.account_id,
    name: head.name,
    version: head.version,
    status: head.status,
    categories,
  };
}

/** The template the pipeline scores new calls against. */
export async function getActive(db: Db, accountId: string): Promise<ScorecardTemplate | null> {
  const res = await db.query<TemplateHeadRow>(
    `SELECT * FROM scorecard_templates WHERE account_id = $1 AND status = 'active'`,
    [accountId],
  );
  const head = res.rows[0];
  return head ? hydrate(db, head) : null;
}

/** Historical scores stay meaningful: fetch the exact version a call was judged against. */
export async function getById(db: Db, templateId: string): Promise<ScorecardTemplate | null> {
  const res = await db.query<TemplateHeadRow>(
    `SELECT * FROM scorecard_templates WHERE id = $1`,
    [templateId],
  );
  const head = res.rows[0];
  return head ? hydrate(db, head) : null;
}

export async function listByAccount(db: Db, accountId: string): Promise<TemplateHeadRow[]> {
  const res = await db.query<TemplateHeadRow>(
    `SELECT * FROM scorecard_templates
      WHERE account_id = $1 ORDER BY name, version DESC`,
    [accountId],
  );
  return res.rows;
}

export interface NewTemplateInput {
  accountId: string;
  name: string;
  createdBy: string | null;
  categories: Array<{
    name: string;
    weight: number;
    sortOrder: number;
    criteria: Array<{
      name: string;
      guidance: string;
      scoringType: ScoringType;
      weight: number;
      isAutoFail: boolean;
      sortOrder: number;
    }>;
  }>;
}

/**
 * Publishes a new rubric version atomically: retires the current active
 * template and activates the new one. Every scored call keeps pointing at the
 * version it was judged against.
 */
export async function publishVersion(db: Db, input: NewTemplateInput): Promise<string> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const verRes = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next
         FROM scorecard_templates WHERE account_id = $1 AND name = $2`,
      [input.accountId, input.name],
    );
    const version = verRes.rows[0]?.next ?? 1;
    await client.query(
      `UPDATE scorecard_templates SET status = 'retired'
        WHERE account_id = $1 AND status = 'active'`,
      [input.accountId],
    );
    const tplRes = await client.query<{ id: string }>(
      `INSERT INTO scorecard_templates (account_id, name, version, status, created_by)
       VALUES ($1, $2, $3, 'active', $4) RETURNING id`,
      [input.accountId, input.name, version, input.createdBy],
    );
    const templateId = tplRes.rows[0]!.id;
    for (const cat of input.categories) {
      const catRes = await client.query<{ id: string }>(
        `INSERT INTO scorecard_categories (template_id, name, weight, sort_order)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [templateId, cat.name, cat.weight, cat.sortOrder],
      );
      const categoryId = catRes.rows[0]!.id;
      for (const crit of cat.criteria) {
        await client.query(
          `INSERT INTO scorecard_criteria
             (category_id, name, guidance, scoring_type, weight, is_auto_fail, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            categoryId,
            crit.name,
            crit.guidance,
            crit.scoringType,
            crit.weight,
            crit.isAutoFail,
            crit.sortOrder,
          ],
        );
      }
    }
    await client.query("COMMIT");
    return templateId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
