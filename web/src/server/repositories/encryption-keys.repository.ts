import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import {
  KeyRaceError,
  type ClientKeyRecord,
  type InsertClientKeyInput,
  type InsertOfficeKeyInput,
  type KeyStore,
  type OfficeKeyRecord,
} from "@/server/keys/key-store";

// The concrete Supabase-backed KeyStore (DEV-032). It is the ONLY code that
// touches the fail-closed encryption_keys table, and it does so exclusively
// through the SECURITY DEFINER RPCs from migration 0031 (the table has zero
// client grants). The hierarchy depends on the KeyStore interface, so this is
// the single Supabase seam for the key layer.

type OfficeKeyRow = {
  id: string;
  wrapped_key: string | null;
  kms_key_id: string | null;
  algo: string;
  key_version: number;
};

type ClientKeyRow = {
  id: string;
  wrapped_key: string | null;
  wrap_iv: string | null;
  wrap_tag: string | null;
  wrapped_by_key_id: string | null;
  algo: string;
  key_version: number;
};

// The one-active-key partial-unique index (migration 0031) raises 23505 when
// two requests race to mint the same scope's key. Map it to KeyRaceError so the
// hierarchy re-reads the winner.
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

export function createSupabaseKeyStore(): KeyStore {
  return {
    async getActiveOfficeKey(orgId: string): Promise<OfficeKeyRecord | null> {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.rpc("attachments_get_office_key", {
        p_org_id: orgId,
      } as never);
      if (error) throw error;
      const row = (data as unknown as OfficeKeyRow[] | null)?.[0];
      // A shredded/absent key (wrapped_key null, or no kms marker) is "no key".
      if (!row || row.wrapped_key === null || row.kms_key_id === null) {
        return null;
      }
      return {
        id: row.id,
        wrappedKey: row.wrapped_key,
        kmsKeyId: row.kms_key_id,
        algo: row.algo,
        keyVersion: row.key_version,
      };
    },

    async insertOfficeKey(
      input: InsertOfficeKeyInput,
    ): Promise<{ id: string }> {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.rpc(
        "attachments_insert_office_key",
        {
          p_org_id: input.orgId,
          p_wrapped_key: input.wrappedKey,
          p_kms_key_id: input.kmsKeyId,
          p_algo: input.algo,
        } as never,
      );
      if (error) {
        if (isUniqueViolation(error)) throw new KeyRaceError();
        throw error;
      }
      return { id: data as unknown as string };
    },

    async getActiveClientKey(
      orgId: string,
      clientId: string,
    ): Promise<ClientKeyRecord | null> {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.rpc("attachments_get_client_key", {
        p_org_id: orgId,
        p_client_id: clientId,
      } as never);
      if (error) throw error;
      const row = (data as unknown as ClientKeyRow[] | null)?.[0];
      if (
        !row ||
        row.wrapped_key === null ||
        row.wrap_iv === null ||
        row.wrap_tag === null ||
        row.wrapped_by_key_id === null
      ) {
        return null; // shredded/absent/malformed
      }
      return {
        id: row.id,
        wrappedKey: row.wrapped_key,
        wrapIv: row.wrap_iv,
        wrapTag: row.wrap_tag,
        wrappedByKeyId: row.wrapped_by_key_id,
        algo: row.algo,
        keyVersion: row.key_version,
      };
    },

    async insertClientKey(
      input: InsertClientKeyInput,
    ): Promise<{ id: string }> {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.rpc(
        "attachments_insert_client_key",
        {
          p_org_id: input.orgId,
          p_client_id: input.clientId,
          p_wrapped_key: input.wrappedKey,
          p_wrap_iv: input.wrapIv,
          p_wrap_tag: input.wrapTag,
          p_wrapped_by_key_id: input.wrappedByKeyId,
          p_algo: input.algo,
        } as never,
      );
      if (error) {
        if (isUniqueViolation(error)) throw new KeyRaceError();
        throw error;
      }
      return { id: data as unknown as string };
    },
  };
}

// Crypto-shred a client's key (owner/manager only; enforced in the RPC). Not
// part of the KeyStore interface — it is a lifecycle action the service calls
// directly for client offboarding.
export async function revokeClientKey(
  orgId: string,
  clientId: string,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("attachments_revoke_client_key", {
    p_org_id: orgId,
    p_client_id: clientId,
  } as never);
  if (error) throw error;
}
