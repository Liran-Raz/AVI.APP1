// Money helpers (DEV-026). ALL amounts in the invoicing domain are integer
// AGOROT (bigint in the DB, number in JS — safe: ₪90 trillion fits in 2^53).
// Client-safe (no server imports). Parsing is STRING-BASED — never multiply
// floats (0.1+0.2 style drift is unacceptable in tax documents).

const ILS_FORMATTER = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 123456 (agorot) → "‏1,234.56 ₪" (he-IL). */
export function formatAgorot(agorot: number): string {
  return ILS_FORMATTER.format(agorot / 100);
}

/** 123456 (agorot) → "1234.56" — plain value for <input> fields. */
export function agorotToInputValue(agorot: number): string {
  const sign = agorot < 0 ? "-" : "";
  const abs = Math.abs(agorot);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${sign}${whole}.${cents.toString().padStart(2, "0")}`;
}

/**
 * Parse a user-typed ₪ amount ("1,234.5", "1234.56", "₪ 12") into agorot.
 * String-based (no float math). Returns null for invalid/negative input.
 * More than 2 decimal digits is rejected (no silent rounding of money).
 */
export function parseSheqelToAgorot(input: string): number | null {
  const cleaned = input.replace(/[₪,\s]/g, "");
  if (cleaned.length === 0) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [wholeRaw, centsRaw = ""] = cleaned.split(".");
  const whole = Number(wholeRaw);
  const cents = Number((centsRaw + "00").slice(0, 2));
  if (!Number.isSafeInteger(whole * 100)) return null;
  return whole * 100 + cents;
}

/** Line-total preview, mirroring the DB's issue-time math (round half away from zero). */
export function computeLineTotalAgorot(
  quantity: number,
  unitPriceAgorot: number,
  lineDiscountAgorot: number,
): number {
  return Math.round(quantity * unitPriceAgorot) - lineDiscountAgorot;
}

/** VAT preview in agorot from basis points (1800 = 18%). */
export function computeVatAgorot(netAgorot: number, rateBp: number): number {
  return Math.round((netAgorot * rateBp) / 10000);
}
