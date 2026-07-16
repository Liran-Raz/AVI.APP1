import { describe, expect, it } from "vitest";

import {
  agorotToInputValue,
  computeLineTotalAgorot,
  computeVatAgorot,
  formatAgorot,
  parseSheqelToAgorot,
} from "./money";

describe("parseSheqelToAgorot (string-based — no float drift)", () => {
  it("parses plain and formatted amounts", () => {
    expect(parseSheqelToAgorot("1234.56")).toBe(123456);
    expect(parseSheqelToAgorot("1,234.56")).toBe(123456);
    expect(parseSheqelToAgorot("₪ 12")).toBe(1200);
    expect(parseSheqelToAgorot("0.1")).toBe(10);
    expect(parseSheqelToAgorot("0.05")).toBe(5);
  });

  it("rejects invalid, negative, or >2-decimal input (no silent rounding)", () => {
    expect(parseSheqelToAgorot("")).toBeNull();
    expect(parseSheqelToAgorot("abc")).toBeNull();
    expect(parseSheqelToAgorot("-5")).toBeNull();
    expect(parseSheqelToAgorot("1.234")).toBeNull();
    expect(parseSheqelToAgorot("1.2.3")).toBeNull();
  });

  it("round-trips with agorotToInputValue", () => {
    expect(agorotToInputValue(123456)).toBe("1234.56");
    expect(parseSheqelToAgorot(agorotToInputValue(509))).toBe(509);
    expect(agorotToInputValue(5)).toBe("0.05");
  });
});

describe("line/VAT math mirrors the DB (round half away from zero)", () => {
  it("computes line totals from fractional quantities", () => {
    expect(computeLineTotalAgorot(2, 10000, 0)).toBe(20000);
    expect(computeLineTotalAgorot(1.5, 333, 0)).toBe(500); // 499.5 → 500
    expect(computeLineTotalAgorot(3, 1000, 500)).toBe(2500);
  });

  it("computes VAT at 18% (2025+) and 17% (legacy)", () => {
    expect(computeVatAgorot(10000, 1800)).toBe(1800);
    expect(computeVatAgorot(9999, 1800)).toBe(1800); // 1799.82 → 1800
    expect(computeVatAgorot(10000, 1700)).toBe(1700);
    expect(computeVatAgorot(10000, 0)).toBe(0); // עוסק פטור
  });
});

describe("formatAgorot", () => {
  it("formats agorot as he-IL ILS", () => {
    const out = formatAgorot(123456);
    expect(out).toContain("1,234.56");
    expect(out).toContain("₪");
  });
});
