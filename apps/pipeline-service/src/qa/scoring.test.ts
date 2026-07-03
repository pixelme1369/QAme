import { describe, expect, it } from "vitest";
import type { ScorecardTemplate, ScoringOutput } from "@qame/scorecard-schema";
import { computeScore, deriveFlags } from "./scoring.js";

const template: ScorecardTemplate = {
  id: "11111111-1111-1111-1111-111111111111",
  accountId: "22222222-2222-2222-2222-222222222222",
  name: "Test",
  version: 1,
  status: "active",
  categories: [
    {
      id: "33333333-3333-3333-3333-333333333333",
      name: "Compliance",
      weight: 40,
      sortOrder: 0,
      criteria: [
        {
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          name: "Recording disclosure",
          guidance: "g",
          scoringType: "pass_fail",
          weight: 1,
          isAutoFail: true,
          sortOrder: 0,
        },
        {
          id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          name: "Script adherence",
          guidance: "g",
          scoringType: "scale",
          weight: 1,
          isAutoFail: false,
          sortOrder: 1,
        },
      ],
    },
    {
      id: "44444444-4444-4444-4444-444444444444",
      name: "Soft skills",
      weight: 60,
      sortOrder: 1,
      criteria: [
        {
          id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
          name: "Tone",
          guidance: "g",
          scoringType: "scale",
          weight: 1,
          isAutoFail: false,
          sortOrder: 0,
        },
      ],
    },
  ],
};

function output(overrides: Partial<Record<string, { passed?: boolean | null; score?: number | null }>> = {}): ScoringOutput {
  const j = (id: string, passed: boolean | null, score: number | null) => ({
    criterionId: id,
    passed: overrides[id]?.passed !== undefined ? overrides[id]!.passed! : passed,
    score: overrides[id]?.score !== undefined ? overrides[id]!.score! : score,
    rationale: "r",
    evidenceQuote: "q",
    evidenceStartMs: 100,
  });
  return {
    judgments: [
      j("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", true, null),
      j("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", null, 80),
      j("cccccccc-cccc-cccc-cccc-cccccccccccc", null, 90),
    ],
    outcome: "not_interested",
    outcomeRationale: "r",
    callSummary: "s",
  };
}

describe("computeScore", () => {
  it("computes weighted overall score", () => {
    const computed = computeScore(template, output());
    // Compliance = (100 + 80) / 2 = 90; Soft = 90.
    // Overall = (90*40 + 90*60) / 100 = 90.
    expect(computed.overallScore).toBe(90);
    expect(computed.autoFailed).toBe(false);
    expect(computed.categoryScores).toEqual([
      expect.objectContaining({ name: "Compliance", score: 90 }),
      expect.objectContaining({ name: "Soft skills", score: 90 }),
    ]);
  });

  it("auto-fails on a failed critical criterion regardless of overall score", () => {
    const computed = computeScore(
      template,
      output({ "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa": { passed: false } }),
    );
    // Score still computed: compliance = (0 + 80)/2 = 40; overall = 40*.4+90*.6 = 70.
    expect(computed.overallScore).toBe(70);
    expect(computed.autoFailed).toBe(true);
    expect(computed.autoFailedCriteria).toEqual([
      { criterionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name: "Recording disclosure" },
    ]);
  });

  it("a passed auto-fail criterion does not auto-fail", () => {
    const computed = computeScore(template, output());
    expect(computed.autoFailedCriteria).toHaveLength(0);
  });
});

describe("deriveFlags", () => {
  it("emits a critical compliance flag per auto-fail", () => {
    const out = output({ "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa": { passed: false } });
    const computed = computeScore(template, out);
    const flags = deriveFlags(template, out, computed);
    expect(flags).toContainEqual(
      expect.objectContaining({
        type: "compliance",
        severity: "critical",
        label: "Auto-fail: Recording disclosure",
      }),
    );
  });

  it("flags do_not_call outcomes as critical", () => {
    const out: ScoringOutput = { ...output(), outcome: "do_not_call" };
    const computed = computeScore(template, out);
    const flags = deriveFlags(template, out, computed);
    expect(flags).toContainEqual(
      expect.objectContaining({ type: "outcome", severity: "critical" }),
    );
  });
});
