import { describe, expect, it } from "vitest";

import { sanitizeNextPath } from "@/lib/safe-path";

describe("sanitizeNextPath", () => {
  it("accepts ordinary same-origin paths", () => {
    expect(sanitizeNextPath("/tasks")).toBe("/tasks");
    expect(sanitizeNextPath("/invite/accept?token=abc123")).toBe(
      "/invite/accept?token=abc123",
    );
    expect(sanitizeNextPath("/settings#notifications")).toBe(
      "/settings#notifications",
    );
  });

  it("rejects protocol-relative open-redirects (//host)", () => {
    expect(sanitizeNextPath("//evil.com")).toBe("/onboarding");
    expect(sanitizeNextPath("//evil.com/path")).toBe("/onboarding");
  });

  it("rejects backslash open-redirects (/\\host — browsers normalize \\ to /)", () => {
    expect(sanitizeNextPath("/\\evil.com")).toBe("/onboarding");
    expect(sanitizeNextPath("/foo\\bar")).toBe("/onboarding");
  });

  it("rejects absolute URLs and non-slash values", () => {
    expect(sanitizeNextPath("https://evil.com")).toBe("/onboarding");
    expect(sanitizeNextPath("javascript:alert(1)")).toBe("/onboarding");
    expect(sanitizeNextPath("tasks")).toBe("/onboarding");
  });

  it("rejects whitespace and empty/nullish values, using the fallback", () => {
    expect(sanitizeNextPath("/ta sks")).toBe("/onboarding");
    expect(sanitizeNextPath("")).toBe("/onboarding");
    expect(sanitizeNextPath(null)).toBe("/onboarding");
    expect(sanitizeNextPath(undefined)).toBe("/onboarding");
  });

  it("honors a custom fallback (login uses /tasks)", () => {
    expect(sanitizeNextPath("//evil.com", "/tasks")).toBe("/tasks");
    expect(sanitizeNextPath(null, "/tasks")).toBe("/tasks");
    expect(sanitizeNextPath("/dashboard", "/tasks")).toBe("/dashboard");
  });
});
