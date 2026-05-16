import "server-only";
import { z } from "zod";

// One canonical schema for everything the server reads from process.env.
// Anything not listed here is invisible to our typed env consumer.
//
// IMPORTANT: NEXT_PUBLIC_* values are inlined into the client bundle by Next.js.
// They MUST NOT contain secrets. Server-only secrets (e.g. SUPABASE_SERVICE_ROLE_KEY,
// SMTP credentials) belong in non-prefixed vars and must be added below before use.
const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  NEXT_PUBLIC_SITE_URL: z
    .string()
    .url("NEXT_PUBLIC_SITE_URL must be a valid URL")
    .default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function parseEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    // Throwing at import time means the server fails fast at boot
    // rather than mysteriously at the first failing request.
    throw new Error(
      `❌ Invalid environment variables:\n${issues}\n\n` +
        `See web/.env.local.example for the required shape.`,
    );
  }
  return parsed.data;
}

export const env: ServerEnv = parseEnv();
