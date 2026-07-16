import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type { Database } from "@/server/db/database.types";
import type {
  DocumentLine,
  DocumentPayment,
  InvoiceDocType,
  InvoiceDocument,
  VatRate,
} from "@/server/db/domain.types";

// Documents repository (DEV-026 R2) — the only layer that reads/writes the
// documents tables or calls the document RPCs. Every query filters org_id
// explicitly (defense in depth on top of RLS); drafts are the only rows the
// client role can write (DB triggers reject the rest), and the legal state
// transitions go through the SECURITY DEFINER RPCs from migration 0027.

type DocumentInsert = Database["public"]["Tables"]["documents"]["Insert"];
type DocumentUpdate = Database["public"]["Tables"]["documents"]["Update"];
type LineInsert = Database["public"]["Tables"]["document_lines"]["Insert"];
type PaymentInsert = Database["public"]["Tables"]["document_payments"]["Insert"];

export type ListDocumentsOptions = {
  docType?: InvoiceDocType;
  status: "draft" | "issued" | "cancelled" | "all";
  search?: string;
  limit: number;
  offset: number;
};

export async function findManyByOrgId(
  orgId: string,
  opts: ListDocumentsOptions,
): Promise<InvoiceDocument[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("documents")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (opts.docType) query = query.eq("doc_type", opts.docType);
  if (opts.status !== "all") query = query.eq("status", opts.status);
  if (opts.search) {
    // Sanitized by the validator. Match buyer name; a purely numeric term
    // also matches the document number.
    const term = opts.search;
    if (/^\d+$/.test(term)) {
      query = query.or(`buyer_name.ilike.%${term}%,number.eq.${term}`);
    } else {
      query = query.ilike("buyer_name", `%${term}%`);
    }
  }

  query = query.range(opts.offset, opts.offset + opts.limit - 1);
  const { data, error } = await query;
  if (error) throw error;
  return (data as unknown as InvoiceDocument[]) ?? [];
}

export async function findByIdAndOrgId(
  id: string,
  orgId: string,
): Promise<InvoiceDocument | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as InvoiceDocument | null) ?? null;
}

export async function findLines(
  documentId: string,
  orgId: string,
): Promise<DocumentLine[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("document_lines")
    .select("*")
    .eq("document_id", documentId)
    .eq("org_id", orgId)
    .order("line_no", { ascending: true });
  if (error) throw error;
  return (data as unknown as DocumentLine[]) ?? [];
}

export async function findPayments(
  documentId: string,
  orgId: string,
): Promise<DocumentPayment[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("document_payments")
    .select("*")
    .eq("document_id", documentId)
    .eq("org_id", orgId)
    .order("line_no", { ascending: true });
  if (error) throw error;
  return (data as unknown as DocumentPayment[]) ?? [];
}

export async function create(input: DocumentInsert): Promise<InvoiceDocument> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("documents")
    .insert(input as never)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as InvoiceDocument;
}

export async function updateByIdAndOrgId(
  id: string,
  orgId: string,
  patch: DocumentUpdate,
): Promise<InvoiceDocument | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("documents")
    .update(patch as never)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as InvoiceDocument | null) ?? null;
}

export async function deleteByIdAndOrgId(
  id: string,
  orgId: string,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("documents")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) throw error;
}

// Replace-all children (draft-only by RLS + triggers). Delete then insert —
// not transactional over PostgREST, which is acceptable for DRAFTS (worst
// case the user re-saves); issue-time validation recomputes everything.
export async function replaceLines(
  documentId: string,
  orgId: string,
  lines: LineInsert[],
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const del = await supabase
    .from("document_lines")
    .delete()
    .eq("document_id", documentId)
    .eq("org_id", orgId);
  if (del.error) throw del.error;
  if (lines.length === 0) return;
  const ins = await supabase.from("document_lines").insert(lines as never);
  if (ins.error) throw ins.error;
}

export async function replacePayments(
  documentId: string,
  orgId: string,
  payments: PaymentInsert[],
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const del = await supabase
    .from("document_payments")
    .delete()
    .eq("document_id", documentId)
    .eq("org_id", orgId);
  if (del.error) throw del.error;
  if (payments.length === 0) return;
  const ins = await supabase.from("document_payments").insert(payments as never);
  if (ins.error) throw ins.error;
}

// ============================================================
// Legal transitions — SECURITY DEFINER RPCs (0027). The DB validates
// membership + role + state; the service adds the capability gate.
// ============================================================

export async function rpcIssueDocument(
  documentId: string,
): Promise<{ number: number; issued_at: string }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("issue_document", {
    p_document_id: documentId,
  } as never);
  if (error) throw error;
  const rows = data as unknown as Array<{ number: number; issued_at: string }>;
  if (!rows || rows.length === 0) throw new Error("issue_document returned no row");
  return rows[0];
}

export async function rpcCancelDocument(
  documentId: string,
  reason: string,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_document", {
    p_document_id: documentId,
    p_reason: reason,
  } as never);
  if (error) throw error;
}

export async function rpcCreateCreditNote(documentId: string): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_credit_note", {
    p_document_id: documentId,
  } as never);
  if (error) throw error;
  return data as unknown as string;
}

// ============================================================
// VAT rates (global read-only reference)
// ============================================================

export async function findVatRates(): Promise<VatRate[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("vat_rates")
    .select("*")
    .order("effective_from", { ascending: true });
  if (error) throw error;
  return (data as unknown as VatRate[]) ?? [];
}
