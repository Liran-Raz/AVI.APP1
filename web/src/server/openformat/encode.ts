import "server-only";

// ============================================================
// OPEN FORMAT (מבנה אחיד) v1.31 — low-level field encoders.
// Spec: "הוראות להפקת קבצים במבנה אחיד", רשות המסים, 10.05.2009, v1.31.
//
// Records are fixed-width. Encoding rules (spec §2.3-2.4):
//   - numeric fields  ("9(n)")      — digits only, zero-padded on the LEFT
//     (right-aligned). Optional field with no value → all zeros.
//   - alphanumeric    ("X(n)")      — value first, space-padded on the RIGHT
//     (left-aligned, logical order). Optional with no value → all spaces.
//   - signed amounts  ("X9(i)V99")  — leading sign char ('+'/'-') then the
//     integer digits zero-padded to i, then the decimals with NO point:
//     1245.65 → "+0124565" (spec §2.4 examples). Field length = 1 + i + dec.
//   - dates  — 9(8) YYYYMMDD; times — 9(4) HHMM (24h).
//   - every record ends with CR+LF, NOT counted in the record length (§2.4 ט).
//
// The file charset is ISO-8859-8-i — logical Hebrew order (INI field 1029=1).
// Composition happens on JS strings; every sanitized char maps to exactly one
// ISO-8859-8 byte, so string positions == byte positions (asserted in tests).
// ============================================================

/**
 * Map characters that Hebrew business text commonly contains but ISO-8859-8
 * cannot represent onto encodable equivalents. Anything else that survives to
 * iconv-lite becomes '?' (its single-byte fallback), which keeps positions
 * intact but loses information — so the common cases are handled here.
 */
const CHAR_FALLBACKS: ReadonlyMap<string, string> = new Map([
  ["״", '"'], // ״ gershayim
  ["׳", "'"], // ׳ geresh
  ["“", '"'],
  ["”", '"'],
  ["‘", "'"],
  ["’", "'"],
  ["–", "-"], // en dash
  ["—", "-"], // em dash
  ["…", "..."],
  [" ", " "], // nbsp
  ["‎", ""], // LRM / RLM / ALM direction marks — logical text needs none
  ["‏", ""],
  ["؜", ""],
  ["₪", 'ש"ח'], // ₪ is not in ISO-8859-8
]);

/** Sanitize free text for ISO-8859-8: strip controls, map typographics. */
export function sanitizeText(value: string): string {
  let out = "";
  for (const ch of value) {
    // Astral chars (emoji etc.) are 2 JS code units; `for..of` yields the
    // pair as one unit — replace with a single '?' to keep width predictable.
    if (ch.length > 1) {
      out += "?";
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      out += " "; // tabs/newlines inside a field would corrupt the record
      continue;
    }
    if (code < 0x20 || code === 0x7f) continue;
    const mapped = CHAR_FALLBACKS.get(ch);
    out += mapped !== undefined ? mapped : ch;
  }
  return out;
}

/** X(n): left-aligned, space-padded; truncated when longer than the field. */
export function encodeAlpha(value: string | null | undefined, len: number): string {
  const clean = value ? sanitizeText(value).trim() : "";
  return clean.length >= len ? clean.slice(0, len) : clean.padEnd(len, " ");
}

/**
 * 9(n): unsigned integer, zero-padded left. Accepts a non-negative integer or
 * a digit string; null/undefined/"" → all zeros (spec: optional numeric with
 * no value is filled with zeros). Throws on overflow — a numeric field that
 * cannot hold its value would silently corrupt books data.
 */
export function encodeNum(
  value: number | string | null | undefined,
  len: number,
): string {
  if (value === null || value === undefined || value === "") {
    return "0".repeat(len);
  }
  let digits: string;
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`encodeNum: expected a non-negative integer, got ${value}`);
    }
    digits = String(value);
  } else {
    digits = value;
    if (!/^\d+$/.test(digits)) {
      throw new Error(`encodeNum: expected digits, got "${value}"`);
    }
  }
  if (digits.length > len) {
    throw new Error(`encodeNum: value "${digits}" overflows 9(${len})`);
  }
  return digits.padStart(len, "0");
}

/**
 * X9(i)V9..9: signed scaled amount. `scaled` is the value in the smallest
 * unit (agorot for dec=2). Total width = 1 (sign) + intDigits + dec.
 * null → all spaces (an alphanumeric field with no value, e.g. the foreign-
 * currency fields on an ILS document).
 */
export function encodeAmount(
  scaled: number | null | undefined,
  intDigits: number,
  dec: number,
): string {
  const width = 1 + intDigits + dec;
  if (scaled === null || scaled === undefined) return " ".repeat(width);
  if (!Number.isSafeInteger(scaled)) {
    throw new Error(`encodeAmount: expected an integer of the smallest unit, got ${scaled}`);
  }
  const sign = scaled < 0 ? "-" : "+";
  const abs = Math.abs(scaled);
  const base = 10 ** dec;
  const whole = Math.floor(abs / base);
  const frac = abs % base;
  const wholeStr = String(whole);
  if (wholeStr.length > intDigits) {
    throw new Error(`encodeAmount: ${scaled} overflows X9(${intDigits})V9(${dec})`);
  }
  return (
    sign + wholeStr.padStart(intDigits, "0") + String(frac).padStart(dec, "0")
  );
}

/**
 * Parse a decimal string (Postgres numeric serialization, e.g. "2.5000" or
 * "-1.25") into an integer scaled by 10^dec, without float math. Extra
 * fractional digits beyond `dec` must be zeros — money/quantity data is never
 * silently rounded.
 */
export function decimalStringToScaled(value: string, dec: number): number {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new Error(`decimalStringToScaled: not a decimal: "${value}"`);
  const [, sign, wholeRaw, fracRaw = ""] = m;
  const fracPadded = (fracRaw + "0".repeat(dec)).slice(0, dec);
  const dropped = fracRaw.slice(dec);
  if (dropped.replace(/0/g, "").length > 0) {
    throw new Error(
      `decimalStringToScaled: "${value}" has more than ${dec} meaningful decimal digits`,
    );
  }
  const scaled = Number(wholeRaw) * 10 ** dec + Number(fracPadded || "0");
  if (!Number.isSafeInteger(scaled)) {
    throw new Error(`decimalStringToScaled: "${value}" is out of safe range`);
  }
  return sign === "-" ? -scaled : scaled;
}

/** 9(8) date: accepts "YYYY-MM-DD" and emits "YYYYMMDD"; null → zeros. */
export function encodeDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "00000000";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) throw new Error(`encodeDate: expected YYYY-MM-DD, got "${isoDate}"`);
  return m[1] + m[2] + m[3];
}

/** 9(4) time: accepts "HHMM" or "HH:MM"; null → zeros. */
export function encodeTime(time: string | null | undefined): string {
  if (!time) return "0000";
  const m = /^(\d{2}):?(\d{2})$/.exec(time);
  if (!m) throw new Error(`encodeTime: expected HHMM, got "${time}"`);
  return m[1] + m[2];
}

/**
 * Digits-only coercion for identifier fields that are TEXT in the DB but
 * numeric in the spec (cheque bank/branch/account numbers, tax ids). Strips
 * separators; when the digits overflow the field, keeps the RIGHTMOST digits
 * (bank-account semantics) and reports a warning via the callback.
 */
export function digitsForNumField(
  raw: string | null | undefined,
  len: number,
  onWarn?: (message: string) => void,
): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.length > len) {
    onWarn?.(`הערך "${raw}" ארוך משדה 9(${len}) — נשמרו ${len} הספרות האחרונות`);
    return digits.slice(-len);
  }
  return digits;
}
