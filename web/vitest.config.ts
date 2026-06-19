import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Minimal Vitest setup for Stage 4 (F7) email tests.
//
// Why a config is required:
//   1. `server-only` throws when imported outside a React Server Component
//      bundle. Our server modules import it as a guard, so it must be
//      aliased to a no-op stub to be unit-testable in plain Node.
//   2. The project uses the `@/*` path alias (see tsconfig.json) which
//      Vitest must mirror so `vi.mock("@/server/...")` and `@/` imports
//      resolve the same way the app does.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "server-only": fileURLToPath(
        new URL("./test/server-only-stub.ts", import.meta.url),
      ),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
