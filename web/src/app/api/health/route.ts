import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const EXPECTED_TABLES = [
  "organizations",
  "profiles",
  "clients",
  "client_contacts",
  "tasks",
  "notifications",
] as const;

export async function GET() {
  try {
    const supabase = await createClient();

    const results = await Promise.all(
      EXPECTED_TABLES.map(async (table) => {
        const { error, count } = await supabase
          .from(table)
          .select("*", { count: "exact", head: true });
        return { table, exists: !error, count: count ?? 0, error: error?.message };
      }),
    );

    const allExist = results.every((r) => r.exists);

    return NextResponse.json({
      status: allExist ? "healthy" : "partial",
      message: allExist
        ? "✅ כל הטבלאות קיימות — Supabase מוכן לעבודה"
        : "⚠️ חלק מהטבלאות חסרות",
      tables: results,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        status: "connection_failed",
        message: "❌ לא הצלחנו להתחבר ל-Supabase",
        error: message,
      },
      { status: 500 },
    );
  }
}
