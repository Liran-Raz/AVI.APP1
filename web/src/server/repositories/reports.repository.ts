import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type {
  DocumentLine,
  DocumentPayment,
  InvoiceDocument,
} from "@/server/db/domain.types";

// Reports repository (DEV-026 R4) — read-only queries over the invoicing
// tables for the reports page and the מבנה-אחיד export. Every query filters
// org_id explicitly (defense in depth on top of RLS) and touches only
// documents with legal weight: issued + cancelled, never drafts.
//
// Paging: PostgREST caps a response at the project's max-rows (default 1000),
// so a single .limit() is NOT enough for books data — reads page in fixed
// batches until a short page. A hard ceiling guards against runaway ranges;
// the service turns a truncated read into a loud error (books exports must
// never be silently partial).

const PAGE_SIZE = 1000;
export const MAX_REPORT_DOCUMENTS = 20_000;

export type DocumentWithChildren = InvoiceDocument & {
  document_lines: DocumentLine[];
  document_payments: DocumentPayment[];
};

/** True when the range holds more documents than the export ceiling. */
export type RangeDocumentsResult<T> = {
  rows: T[];
  truncated: boolean;
};

export async function findDocumentsInRange(
  orgId: string,
  from: string,
  to: string,
): Promise<RangeDocumentsResult<InvoiceDocument>> {
  const supabase = await createSupabaseServerClient();
  const rows: InvoiceDocument[] = [];
  for (let page = 0; rows.length < MAX_REPORT_DOCUMENTS; page++) {
    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .eq("org_id", orgId)
      .in("status", ["issued", "cancelled"])
      .gte("doc_date", from)
      .lte("doc_date", to)
      .order("doc_type", { ascending: true })
      .order("number", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data as unknown as InvoiceDocument[]) ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/** Slim lookup for base-document references (330 → the credited document). */
export async function findDocumentsByIds(
  orgId: string,
  ids: string[],
): Promise<Array<{ id: string; doc_type: string; number: number | null }>> {
  if (ids.length === 0) return [];
  const supabase = await createSupabaseServerClient();
  const out: Array<{ id: string; doc_type: string; number: number | null }> = [];
  // Chunk the IN() list — hundreds of ids would bloat the querystring.
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase
      .from("documents")
      .select("id, doc_type, number")
      .eq("org_id", orgId)
      .in("id", ids.slice(i, i + 100));
    if (error) throw error;
    out.push(
      ...((data as unknown as Array<{ id: string; doc_type: string; number: number | null }>) ?? []),
    );
  }
  return out;
}

export async function findDocumentsWithChildrenInRange(
  orgId: string,
  from: string,
  to: string,
): Promise<RangeDocumentsResult<DocumentWithChildren>> {
  const supabase = await createSupabaseServerClient();
  const rows: DocumentWithChildren[] = [];
  for (let page = 0; rows.length < MAX_REPORT_DOCUMENTS; page++) {
    const { data, error } = await supabase
      .from("documents")
      .select("*, document_lines(*), document_payments(*)")
      .eq("org_id", orgId)
      .in("status", ["issued", "cancelled"])
      .gte("doc_date", from)
      .lte("doc_date", to)
      .order("doc_type", { ascending: true })
      .order("number", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data as unknown as DocumentWithChildren[]) ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}
