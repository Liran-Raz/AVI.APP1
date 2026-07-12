import { describe, expect, it, vi } from "vitest";

// dmKey is a pure helper; mock the supabase module so importing the repo doesn't
// boot the server client / env.
vi.mock("@/server/db/supabase", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { dmKey } from "@/server/repositories/conversations.repository";

// dmKey MUST produce the same string as the SQL
//   least(a,b)::text || ':' || greatest(a,b)::text
// used by the migration's backfill, `_ensure_dm_conversation`, and the trigger —
// otherwise the app resolves a DM to the wrong conversation (or none).
describe("dmKey", () => {
  const A = "0a111111-1111-1111-1111-111111111111";
  const B = "0b222222-2222-2222-2222-222222222222"; // A < B lexicographically
  const F = "ffffffff-ffff-ffff-ffff-ffffffffffff";

  it("is symmetric — argument order does not matter", () => {
    expect(dmKey(A, B)).toBe(dmKey(B, A));
    expect(dmKey(A, F)).toBe(dmKey(F, A));
  });

  it("puts the smaller id first, matching SQL least/greatest on lowercase uuids", () => {
    expect(dmKey(A, B)).toBe(`${A}:${B}`);
    expect(dmKey(B, A)).toBe(`${A}:${B}`);
    expect(dmKey(F, A)).toBe(`${A}:${F}`);
  });

  it("normalizes case, so an uppercase/non-canonical id yields the SAME lowercase key the DB stored", () => {
    // Without the toLowerCase() normalization, an uppercase 'A' (0x41) would sort
    // before lowercase 'b' (0x62) and produce a different key than uuid::text.
    expect(dmKey(A.toUpperCase(), B)).toBe(dmKey(A, B));
    expect(dmKey(A, B.toUpperCase())).toBe(`${A}:${B}`);
    expect(dmKey(F.toUpperCase(), A)).toBe(`${A}:${F}`);
  });
});
