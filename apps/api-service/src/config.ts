import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().default(8081),
  // OAuth client ID of the dashboard's Google sign-in; ID-token audience.
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  // Origin of the dashboard for CORS (e.g. https://qa.example.com).
  DASHBOARD_ORIGIN: z.string().min(1),
  RECORDINGS_BUCKET: z.string().min(1),
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
