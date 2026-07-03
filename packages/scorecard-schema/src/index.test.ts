import { describe, expect, it } from "vitest";
import {
  buildScoringToolInputSchema,
  validateScoringOutput,
  validateTemplate,
  type ScorecardTemplate,
} from "./index.js";

const template: ScorecardTemplate = {
  id: "11111111-1111-1111-1111-111111111111",
  accountId: "22222222-2222-2222-2222-222222222222",
  name: "T",
  version: 1,
  status: "active",
  categories: [
    {
      id: "33333333-3333-3333-3333-333333333333",
      name: "C",
      weight: 100,
      sortOrder: 0,
      criteria: [
        {
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          name: "PF",
          guidance: "g",
          scoringType: "pass_fail",
          weight: 1,
          isAutoFail: true,
          sortOrder: 0,
        },
        {
          id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          name: "SC",
          guidance: "g",
          scoringType: "scale",
          weight: 1,
          isAutoFail: false,
          sortOrder: 1,
        },
      ],
    },
  ],
};

const goodOutput = {
  judgments: [
    {
      criterionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      passed: true,
      score: null,
      rationale: "r",
      evidenceQuote: "q",
      evidenceStartMs: 0,
    },
    {
      criterionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      passed: null,
      score: 75,
      rationale: "r",
      evidenceQuote: "q",
      evidenceStartMs: 10,
    },
  ],
  outcome: "not_interested",
  outcomeRationale: "r",
  callSummary: "s",
};

describe("buildScoringToolInputSchema", () => {
  it("embeds real criterion ids as an enum", () => {
    const schema = buildScoringToolInputSchema(template) as {
      properties: { judgments: { items: { properties: { criterionId: { enum: string[] } } } } };
    };
    expect(schema.properties.judgments.items.properties.criterionId.enum).toEqual([
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    ]);
  });
});

describe("validateScoringOutput", () => {
  it("accepts a complete, well-typed output", () => {
    expect(() => validateScoringOutput(goodOutput, template)).not.toThrow();
  });

  it("rejects a missing criterion", () => {
    const partial = { ...goodOutput, judgments: [goodOutput.judgments[0]] };
    expect(() => validateScoringOutput(partial, template)).toThrow(/missing judgments/);
  });

  it("rejects duplicated criteria", () => {
    const dup = {
      ...goodOutput,
      judgments: [...goodOutput.judgments, goodOutput.judgments[0]],
    };
    expect(() => validateScoringOutput(dup, template)).toThrow(/duplicate/);
  });

  it("rejects wrong value shape for the scoring type", () => {
    const wrong = {
      ...goodOutput,
      judgments: [
        { ...goodOutput.judgments[0], passed: null },
        goodOutput.judgments[1],
      ],
    };
    expect(() => validateScoringOutput(wrong, template)).toThrow(/pass_fail/);
  });

  it("rejects unknown outcome values", () => {
    const bad = { ...goodOutput, outcome: "mystery" };
    expect(() => validateScoringOutput(bad, template)).toThrow();
  });
});

describe("validateTemplate", () => {
  it("flags auto-fail on scale criteria", () => {
    const invalid: ScorecardTemplate = structuredClone(template);
    invalid.categories[0]!.criteria[1]!.isAutoFail = true;
    expect(validateTemplate(invalid)).toHaveLength(1);
    expect(validateTemplate(template)).toHaveLength(0);
  });
});
