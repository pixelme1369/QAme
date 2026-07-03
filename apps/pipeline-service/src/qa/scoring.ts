import type {
  Criterion,
  ScorecardTemplate,
  ScoringOutput,
} from "@qame/scorecard-schema";

/**
 * Deterministic scoring: the AI judges criteria; this module applies policy.
 * The weighted arithmetic and the auto-fail decision are plain code — the
 * model is never allowed to do the math or make the final pass/fail call.
 * This is the CallMiner/Observe.AI "zero tolerance" pattern: one critical
 * compliance breach fails the call regardless of everything else.
 */

export interface CategoryScoreComputed {
  categoryId: string;
  name: string;
  weight: number;
  /** 0-100 weighted average of the category's criteria. */
  score: number;
}

export interface ComputedScore {
  overallScore: number;
  autoFailed: boolean;
  autoFailedCriteria: Array<{ criterionId: string; name: string }>;
  categoryScores: CategoryScoreComputed[];
}

function normalized(criterion: Criterion, judgment: { passed: boolean | null; score: number | null }): number {
  if (criterion.scoringType === "pass_fail") {
    return judgment.passed ? 100 : 0;
  }
  return judgment.score ?? 0;
}

export function computeScore(
  template: ScorecardTemplate,
  output: ScoringOutput,
): ComputedScore {
  const judgmentById = new Map(output.judgments.map((j) => [j.criterionId, j]));

  const categoryScores: CategoryScoreComputed[] = [];
  const autoFailedCriteria: Array<{ criterionId: string; name: string }> = [];

  for (const category of template.categories) {
    let weightSum = 0;
    let acc = 0;
    for (const criterion of category.criteria) {
      const judgment = judgmentById.get(criterion.id);
      // validateScoringOutput guarantees presence; belt-and-braces here.
      if (!judgment) throw new Error(`no judgment for criterion ${criterion.id}`);
      acc += normalized(criterion, judgment) * criterion.weight;
      weightSum += criterion.weight;
      if (criterion.isAutoFail && judgment.passed === false) {
        autoFailedCriteria.push({ criterionId: criterion.id, name: criterion.name });
      }
    }
    categoryScores.push({
      categoryId: category.id,
      name: category.name,
      weight: category.weight,
      score: round2(weightSum > 0 ? acc / weightSum : 0),
    });
  }

  const totalWeight = categoryScores.reduce((s, c) => s + c.weight, 0);
  const overall =
    totalWeight > 0
      ? categoryScores.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight
      : 0;

  return {
    overallScore: round2(overall),
    autoFailed: autoFailedCriteria.length > 0,
    autoFailedCriteria,
    categoryScores,
  };
}

/**
 * Flags derived from the computed result — normalized, filterable signals
 * for the call queue. All deterministic; the AI does not emit flags.
 */
export interface DerivedFlag {
  type: "compliance" | "soft_skill" | "outcome";
  severity: "info" | "warning" | "critical";
  source: "ai" | "system";
  label: string;
  detail: string | null;
}

export function deriveFlags(
  template: ScorecardTemplate,
  output: ScoringOutput,
  computed: ComputedScore,
): DerivedFlag[] {
  const flags: DerivedFlag[] = [];

  for (const failed of computed.autoFailedCriteria) {
    flags.push({
      type: "compliance",
      severity: "critical",
      source: "system",
      label: `Auto-fail: ${failed.name}`,
      detail:
        output.judgments.find((j) => j.criterionId === failed.criterionId)?.rationale ?? null,
    });
  }

  // Non-auto-fail pass_fail compliance misses are warnings.
  for (const cat of template.categories) {
    for (const crit of cat.criteria) {
      if (crit.isAutoFail || crit.scoringType !== "pass_fail") continue;
      const j = output.judgments.find((x) => x.criterionId === crit.id);
      if (j && j.passed === false) {
        flags.push({
          type: cat.sortOrder === 0 ? "compliance" : "soft_skill",
          severity: "warning",
          source: "system",
          label: `Failed: ${crit.name}`,
          detail: j.rationale,
        });
      }
    }
  }

  for (const cs of computed.categoryScores) {
    if (cs.score < 50) {
      flags.push({
        type: "soft_skill",
        severity: "warning",
        source: "system",
        label: `Low category score: ${cs.name} (${cs.score})`,
        detail: null,
      });
    }
  }

  if (output.outcome === "do_not_call") {
    flags.push({
      type: "outcome",
      severity: "critical",
      source: "ai",
      label: "Customer requested do-not-call",
      detail: output.outcomeRationale,
    });
  }
  if (output.outcome === "sale" || output.outcome === "appointment_set") {
    flags.push({
      type: "outcome",
      severity: "info",
      source: "ai",
      label: `Positive outcome: ${output.outcome}`,
      detail: null,
    });
  }

  return flags;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
