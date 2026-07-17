import { describe, expect, it } from "vitest";

import { mfaConfirmSchema, mfaVerifySchema } from "./auth.schema";

// DEV-013 — the TOTP code field is the one auth input a user types under
// time pressure; the schema must accept exactly 6 digits (with tolerant
// whitespace trimming) and nothing else.
describe("mfaVerifySchema (TOTP code)", () => {
  it("accepts exactly 6 digits", () => {
    expect(mfaVerifySchema.parse({ code: "123456" }).code).toBe("123456");
  });

  it("trims surrounding whitespace (mobile keyboards add it)", () => {
    expect(mfaVerifySchema.parse({ code: " 123456 " }).code).toBe("123456");
  });

  it.each(["12345", "1234567", "12345a", "12 456", "", "abcdef"])(
    "rejects %j",
    (code) => {
      expect(mfaVerifySchema.safeParse({ code }).success).toBe(false);
    },
  );
});

describe("mfaConfirmSchema (enrollment confirmation)", () => {
  const factorId = "3f2b8a1c-9d4e-4f6a-8b2c-1d3e5f7a9b0c";

  it("accepts a uuid factorId + 6-digit code", () => {
    expect(
      mfaConfirmSchema.safeParse({ factorId, code: "000000" }).success,
    ).toBe(true);
  });

  it("rejects a non-uuid factorId", () => {
    expect(
      mfaConfirmSchema.safeParse({ factorId: "not-a-uuid", code: "123456" })
        .success,
    ).toBe(false);
  });

  it("rejects a missing code", () => {
    expect(mfaConfirmSchema.safeParse({ factorId }).success).toBe(false);
  });
});
