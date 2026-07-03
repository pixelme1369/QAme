import Anthropic from "@anthropic-ai/sdk";
import {
  buildScoringToolInputSchema,
  validateScoringOutput,
  type ScorecardTemplate,
  type ScoringOutput,
} from "@qame/scorecard-schema";
import type { UtteranceRow } from "@qame/db";
import type { Config } from "../config.js";
import { buildSystemPrompt, buildTranscriptMessage } from "./prompt-builder.js";

/**
 * The AI judgment call. Output is schema-forced: the model must invoke the
 * submit_scorecard tool (tool_choice forced, strict schema with the real
 * criterion ids as an enum), and the result is validated server-side against
 * the template before anything downstream trusts it. Free text is never
 * parsed for a decision.
 */
export class ScoringClient {
  private readonly anthropic: Anthropic;

  constructor(private readonly config: Config) {
    this.anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  }

  async score(
    template: ScorecardTemplate,
    utterances: UtteranceRow[],
  ): Promise<{ output: ScoringOutput; model: string }> {
    const response = await this.anthropic.messages.create({
      model: this.config.SCORING_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: [
        {
          type: "text",
          text: buildSystemPrompt(template),
          // Instruction block + rubric are stable per template version:
          // cached across every call scored against this rubric.
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [
        {
          name: "submit_scorecard",
          description:
            "Submit the completed QA scorecard: one judgment per rubric criterion plus the call outcome classification.",
          strict: true,
          input_schema: buildScoringToolInputSchema(
            template,
          ) as Anthropic.Tool["input_schema"],
        },
      ],
      tool_choice: { type: "tool", name: "submit_scorecard" },
      messages: [
        { role: "user", content: buildTranscriptMessage(utterances) },
      ],
    });

    if (response.stop_reason === "refusal") {
      throw new Error("model refused to score this call");
    }
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) {
      throw new Error(
        `no tool_use block in scoring response (stop_reason=${response.stop_reason})`,
      );
    }
    const output = validateScoringOutput(toolUse.input, template);
    return { output, model: response.model };
  }
}
