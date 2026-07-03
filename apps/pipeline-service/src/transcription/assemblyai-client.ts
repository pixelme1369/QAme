import { z } from "zod";
import type { Config } from "../config.js";

/**
 * Thin AssemblyAI REST client. Diarized (speaker_labels) transcription with
 * webhook completion — the pipeline never polls.
 */

const BASE = "https://api.assemblyai.com/v2";

const submitResponseSchema = z.object({ id: z.string() });

export const aaiUtteranceSchema = z.object({
  speaker: z.string(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
  confidence: z.number().nullable().optional(),
});
export type AaiUtterance = z.infer<typeof aaiUtteranceSchema>;

export const aaiTranscriptSchema = z.object({
  id: z.string(),
  status: z.enum(["queued", "processing", "completed", "error"]),
  text: z.string().nullable(),
  error: z.string().nullable().optional(),
  audio_duration: z.number().nullable().optional(),
  confidence: z.number().nullable().optional(),
  language_code: z.string().nullable().optional(),
  utterances: z.array(aaiUtteranceSchema).nullable().optional(),
});
export type AaiTranscript = z.infer<typeof aaiTranscriptSchema>;

export class AssemblyAiClient {
  constructor(private readonly config: Config) {}

  private headers(): Record<string, string> {
    return {
      authorization: this.config.ASSEMBLYAI_API_KEY,
      "content-type": "application/json",
    };
  }

  /**
   * Submits a transcription job. callId travels in the webhook URL so the
   * completion callback maps back to our call without provider-side state.
   */
  async submit(audioUrl: string, callId: string): Promise<string> {
    const webhookUrl = `${this.config.PUBLIC_BASE_URL}/webhooks/assemblyai?callId=${encodeURIComponent(callId)}`;
    const res = await fetch(`${BASE}/transcript`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        audio_url: audioUrl,
        speaker_labels: true,
        speakers_expected: 2,
        webhook_url: webhookUrl,
        webhook_auth_header_name: "x-webhook-secret",
        webhook_auth_header_value: this.config.ASSEMBLYAI_WEBHOOK_SECRET,
      }),
    });
    if (!res.ok) {
      throw new Error(`assemblyai submit failed: ${res.status} ${await res.text()}`);
    }
    return submitResponseSchema.parse(await res.json()).id;
  }

  async get(transcriptId: string): Promise<AaiTranscript> {
    const res = await fetch(`${BASE}/transcript/${transcriptId}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`assemblyai get failed: ${res.status} ${await res.text()}`);
    }
    return aaiTranscriptSchema.parse(await res.json());
  }
}
