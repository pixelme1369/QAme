import { z } from "zod";

/**
 * All configuration comes from the environment (Cloud Run env vars +
 * Secret Manager references). Fails fast at boot on anything missing —
 * no in-code defaults for secrets, ever.
 */
const configSchema = z.object({
  PORT: z.coerce.number().default(8080),

  // Recordings bucket (private; service account has objectViewer).
  RECORDINGS_BUCKET: z.string().min(1),

  // AssemblyAI
  ASSEMBLYAI_API_KEY: z.string().min(1),
  // Shared secret AssemblyAI echoes back on its webhook.
  ASSEMBLYAI_WEBHOOK_SECRET: z.string().min(1),
  // Public base URL of this service, used to build webhook callback URLs.
  PUBLIC_BASE_URL: z.string().url(),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1),
  SCORING_MODEL: z.string().default("claude-opus-4-8"),

  // Event transport between pipeline stages:
  //   pubsub — each stage transition goes through its own topic (production)
  //   inline — stages run in-process (local dev, tests)
  EVENT_MODE: z.enum(["pubsub", "inline"]).default("pubsub"),
  PUBSUB_TOPIC_TRANSCRIBED: z.string().default("call-transcribed"),

  // OIDC audience expected on Pub/Sub push requests. Empty disables
  // verification (local dev only).
  PUSH_AUTH_AUDIENCE: z.string().optional(),
  PUSH_AUTH_SERVICE_ACCOUNT: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`invalid configuration: ${missing}`);
  }
  return parsed.data;
}
