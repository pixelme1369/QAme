import type { ScorecardTemplate } from "@qame/scorecard-schema";
import type { UtteranceRow } from "@qame/db";

/**
 * Builds the scoring prompt. Layout is deliberate for prompt caching:
 * the fixed instruction block + rubric (stable per template version) form
 * the system prompt and carry the cache breakpoint; the per-call transcript
 * goes in the user turn, after the cached prefix. At thousands of calls/day
 * against one rubric this serves the instruction block from cache on nearly
 * every request.
 */

/** Bumped whenever prompt wording changes — stored on every result so score
 * populations are comparable across prompt revisions. */
export const PROMPT_VERSION = "2026-07-03.1";

const INSTRUCTIONS = `You are a call-quality analyst for an outbound contact center. You will receive a diarized transcript of one recorded call and a QA rubric. Judge each rubric criterion independently, strictly against what is actually in the transcript.

Rules:
- Judge only from the transcript. Never assume speech that is not present. If required language is absent, the criterion fails — absence of evidence is failure for required disclosures.
- Each criterion states whether it is pass/fail or a 0-100 scale. For pass/fail set "passed" and leave "score" null; for scale set "score" and leave "passed" null.
- For every judgment, quote the transcript verbatim in "evidenceQuote" and copy that utterance's start_ms into "evidenceStartMs". Use null for both only when the judgment rests on the absence of speech (e.g. a missing disclosure), and say so in the rationale.
- Rationales are one to three sentences, factual, no hedging.
- Do not compute any overall score, do not decide whether the call passes overall, and do not apply weights — the application does that. Your job is per-criterion judgment and outcome classification only.
- Classify the business outcome of the call from the allowed list, using the customer's actual words as the basis.
- Lines are labeled agent: / customer: with a [start_ms] prefix. Trust these labels.`;

export function buildSystemPrompt(template: ScorecardTemplate): string {
  const rubric = template.categories
    .map((cat) => {
      const criteria = cat.criteria
        .map(
          (cr) =>
            `- id: ${cr.id}\n  name: ${cr.name}\n  type: ${cr.scoringType}${cr.isAutoFail ? " (critical compliance rule)" : ""}\n  guidance: ${cr.guidance}`,
        )
        .join("\n");
      return `Category: ${cat.name}\n${criteria}`;
    })
    .join("\n\n");
  return `${INSTRUCTIONS}\n\n=== RUBRIC (${template.name} v${template.version}) ===\n\n${rubric}`;
}

export function buildTranscriptMessage(utterances: UtteranceRow[]): string {
  const lines = utterances.map(
    (u) => `[${u.start_ms}] ${u.speaker}: ${u.text}`,
  );
  return `=== CALL TRANSCRIPT ===\n${lines.join("\n")}\n=== END TRANSCRIPT ===\n\nScore every rubric criterion and classify the outcome using the submit_scorecard tool.`;
}
