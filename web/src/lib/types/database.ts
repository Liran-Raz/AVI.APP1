// Re-export of the canonical DB types from @/server/db/database.types.
//
// Why this file exists:
//   The canonical types live under src/server/, which is meant for
//   server-only code. Client components that legitimately need DB row
//   shapes (e.g., AppShell receiving Profile/Organization as props from
//   a Server Component) import from THIS path instead of reaching into
//   src/server/. The types are erased at compile time so nothing
//   server-only ends up in the client bundle.
//
// If you are writing server code (route handler, service, repository),
// prefer importing directly from "@/server/db/database.types".

export * from "@/server/db/database.types";
