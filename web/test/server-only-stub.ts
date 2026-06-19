// Test stub for the `server-only` package.
//
// `server-only` deliberately throws when imported outside a React Server
// Component bundle. Our server modules import it as a guard. Under Vitest
// (plain Node) that guard would crash the import, so vitest.config.ts
// aliases `server-only` to this no-op module.
export {};
