import { z } from "zod";

/**
 * Shared contract for the QA scorecard: the rubric structure stored in
 * Postgres, and the schema-forced output the AI scoring engine must return.
 * Both the pipeline-service (scoring) and the dashboard (scorecard admin)
 * build against this package so the contract can never drift.
 */

// ---------------------------------------------------------------------------
// Rubric structure
// ---------------------------------------------------------------------------

export const SCORING_TYPES = ["pass_fail", "scale"] as const;
export type ScoringType = (typeof SCORING_TYPES)[number];

export const CALL_OUTCOMES = [
  "sale",
  "appointment_set",
  "callback_scheduled",
  "not_interested",
  "do_not_call",
  "no_contact",
  "wrong_number",
  "customer_service",
  "other",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const criterionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  /** Rubric guidance injected verbatim into the AI scoring prompt. */
  guidance: z.string().min(1),
  scoringType: z.enum(SCORING_TYPES),
  /** Relative weight of this criterion within its category. */
  weight: z.number().positive(),
  /** A failed pass_fail criterion with this flag fails the whole call. */
  isAutoFail: z.boolean(),
  sortOrder: z.number().int(),
});
export type Criterion = z.infer<typeof criterionSchema>;

export const categorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  /** Relative weight of this category in the overall score. */
  weight: z.number().positive(),
  sortOrder: z.number().int(),
  criteria: z.array(criterionSchema).min(1),
});
export type Category = z.infer<typeof categorySchema>;

export const scorecardTemplateSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  name: z.string().min(1),
  version: z.number().int().positive(),
  status: z.enum(["draft", "active", "retired"]),
  categories: z.array(categorySchema).min(1),
});
export type ScorecardTemplate = z.infer<typeof scorecardTemplateSchema>;

/** Auto-fail criteria must be pass/fail — the flag is meaningless on a scale. */
export function validateTemplate(template: ScorecardTemplate): string[] {
  const problems: string[] = [];
  for (const cat of template.categories) {
    for (const crit of cat.criteria) {
      if (crit.isAutoFail && crit.scoringType !== "pass_fail") {
        problems.push(
          `criterion "${crit.name}" is auto-fail but not pass_fail`,
        );
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// AI scoring output contract (schema-forced tool input)
// ---------------------------------------------------------------------------

export const criterionJudgmentSchema = z.object({
  criterionId: z.string(),
  /** pass_fail: true/false. */
  passed: z.boolean().nullable(),
  /** scale: 0–100. */
  score: z.number().min(0).max(100).nullable(),
  rationale: z.string().min(1),
  /** Verbatim quote from the transcript supporting the judgment. */
  evidenceQuote: z.string().nullable(),
  /** Millisecond offset of the evidence utterance, from the transcript. */
  evidenceStartMs: z.number().int().nonnegative().nullable(),
});
export type CriterionJudgment = z.infer<typeof criterionJudgmentSchema>;

export const scoringOutputSchema = z.object({
  judgments: z.array(criterionJudgmentSchema).min(1),
  outcome: z.enum(CALL_OUTCOMES),
  outcomeRationale: z.string().min(1),
  callSummary: z.string().min(1),
});
export type ScoringOutput = z.infer<typeof scoringOutputSchema>;

/**
 * Builds the JSON Schema for the schema-forced scoring tool, specialized to
 * the exact criteria of the template being applied. `criterionId` is an enum
 * of the real criterion ids so the model cannot invent or omit criteria
 * without failing validation.
 */
export function buildScoringToolInputSchema(
  template: ScorecardTemplate,
): Record<string, unknown> {
  const criterionIds = template.categories.flatMap((c) =>
    c.criteria.map((cr) => cr.id),
  );
  return {
    type: "object",
    additionalProperties: false,
    required: ["judgments", "outcome", "outcomeRationale", "callSummary"],
    properties: {
      judgments: {
        type: "array",
        description:
          "Exactly one judgment per criterion in the rubric, in any order.",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "criterionId",
            "passed",
            "score",
            "rationale",
            "evidenceQuote",
            "evidenceStartMs",
          ],
          properties: {
            criterionId: { type: "string", enum: criterionIds },
            passed: {
              type: ["boolean", "null"],
              description:
                "For pass_fail criteria: true or false. Null for scale criteria.",
            },
            score: {
              type: ["number", "null"],
              description:
                "For scale criteria: 0-100. Null for pass_fail criteria.",
            },
            rationale: {
              type: "string",
              description:
                "One to three sentences explaining the judgment, grounded in the transcript.",
            },
            evidenceQuote: {
              type: ["string", "null"],
              description:
                "Verbatim quote from the transcript that supports the judgment. Null only when the criterion is judged by absence of speech.",
            },
            evidenceStartMs: {
              type: ["number", "null"],
              description:
                "start_ms of the utterance the evidence quote comes from, copied from the transcript. Null when evidenceQuote is null.",
            },
          },
        },
      },
      outcome: {
        type: "string",
        enum: [...CALL_OUTCOMES],
        description: "The business outcome of the call.",
      },
      outcomeRationale: {
        type: "string",
        description: "One sentence justifying the outcome classification.",
      },
      callSummary: {
        type: "string",
        description: "Two to four sentence neutral summary of the call.",
      },
    },
  };
}

/**
 * Validates raw tool output from the model against the template: every
 * criterion judged exactly once, and the value shape matches the criterion's
 * scoring type. Returns the validated output or throws with a precise reason
 * (the caller records it as a processing error — never a silent fallback).
 */
export function validateScoringOutput(
  raw: unknown,
  template: ScorecardTemplate,
): ScoringOutput {
  const parsed = scoringOutputSchema.parse(raw);
  const byId = new Map(
    template.categories.flatMap((c) => c.criteria.map((cr) => [cr.id, cr])),
  );
  const seen = new Set<string>();
  for (const j of parsed.judgments) {
    const crit = byId.get(j.criterionId);
    if (!crit) throw new Error(`unknown criterionId ${j.criterionId}`);
    if (seen.has(j.criterionId)) {
      throw new Error(`duplicate judgment for criterion ${j.criterionId}`);
    }
    seen.add(j.criterionId);
    if (crit.scoringType === "pass_fail" && j.passed === null) {
      throw new Error(`criterion ${crit.name} is pass_fail but passed is null`);
    }
    if (crit.scoringType === "scale" && j.score === null) {
      throw new Error(`criterion ${crit.name} is scale but score is null`);
    }
  }
  const missing = [...byId.keys()].filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new Error(`missing judgments for criteria: ${missing.join(", ")}`);
  }
  return parsed;
}
