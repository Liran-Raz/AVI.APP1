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
  // Set by Vercel on every deployment ("production" / "preview" /
  // "development"); absent outside Vercel. Used to tell a real production
  // deployment apart from a preview (preview intentionally has no Upstash
  // env and must not fail closed — see rate-limit.ts).
  VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
  // Rate limiting (F2) — server-only. OPTIONAL in the schema, but a missing
  // config is only tolerated outside production: dev uses the in-memory
  // limiter, preview fails open with a loud log, and PRODUCTION FAILS
  // CLOSED (auth endpoints refuse to run unprotected — see rate-limit.ts).
  // Never prefix with NEXT_PUBLIC_ — these are secrets.
  UPSTASH_REDIS_REST_URL: z
    .string()
    .url("UPSTASH_REDIS_REST_URL must be a valid URL")
    .optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  // Encrypted file storage (DEV-032) — server-only, all OPTIONAL. The key
  // provider reads these directly from process.env (like the email adapter) so
  // the feature stays inert until configured; they are declared here for typing
  // and web/.env.local.example. NEVER prefix NEXT_PUBLIC_ — key material / ARNs.
  //   Production: Google Cloud KMS master key (me-west1 / Tel-Aviv) + a
  //   service-account JSON (base64) on Vercel; the Cloud Run media service uses
  //   its ambient identity instead. Dev/test: AVI_MASTER_KEK_B64 (base64 of a
  //   32-byte key). See web/src/server/keys/key-provider.factory.ts.
  AVI_GCP_KMS_KEY_NAME: z.string().min(1).optional(),
  AVI_GCP_SA_KEY_B64: z.string().min(1).optional(),
  AVI_MASTER_KEK_B64: z.string().min(1).optional(),
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
