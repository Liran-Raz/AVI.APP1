import "server-only";

import {
  decimalStringToScaled,
  digitsForNumField,
  encodeAlpha,
  encodeAmount,
  encodeDate,
  encodeNum,
  encodeTime,
} from "./encode";

// ============================================================
// OPEN FORMAT (מבנה אחיד) v1.31 — record builders.
//
// Every field below is transcribed 1:1 from the spec tables (הוראות להפקת
// קבצים במבנה אחיד v1.31, 10.05.2009): field id, kind and [start,end]
// columns. Cancelled fields (שדה מבוטל: 1227/1229/1232, 1269/1271,
// 1316-1319/1321, 1031/1033) have zero length and are omitted — the columns
// of the surviving fields already account for them. `composeRecord` asserts
// the fields tile the record contiguously, so a mistranscription fails fast
// (unit tests assert the byte positions again, against the spec examples).
//
// Records emitted by AVI.APP (a documents-only system — INI 1013=0):
//   INI.TXT      A000 + one summary row per record type present in the data
//   BKMVDATA.TXT A100, C100 (doc header), D110 (doc line), D120 (receipt
//                line), Z900. B100/B110/M100 are intentionally absent.
// ============================================================

type FieldValue =
  | { kind: "alpha"; value: string | null }
  | { kind: "num"; value: number | string | null }
  | { kind: "amount"; scaled: number | null; dec: 2 | 4 }
  | { kind: "date"; value: string | null }
  | { kind: "time"; value: string | null };

type Field = FieldValue & {
  id: number;
  cols: readonly [number, number];
};

/** Compose one fixed-width record; asserts the spec tiling + total length. */
function composeRecord(recordCode: string, totalLen: number, fields: Field[]): string {
  let out = "";
  let cursor = 1;
  for (const f of fields) {
    const [start, end] = f.cols;
    if (start !== cursor) {
      throw new Error(
        `${recordCode}: field ${f.id} starts at ${start}, expected ${cursor} — spec transcription bug`,
      );
    }
    const len = end - start + 1;
    let encoded: string;
    switch (f.kind) {
      case "alpha":
        encoded = encodeAlpha(f.value, len);
        break;
      case "num":
        encoded = encodeNum(f.value, len);
        break;
      case "amount":
        encoded = encodeAmount(f.scaled, len - 1 - f.dec, f.dec);
        break;
      case "date":
        encoded = encodeDate(f.value);
        break;
      case "time":
        encoded = encodeTime(f.value);
        break;
    }
    if (encoded.length !== len) {
      throw new Error(`${recordCode}: field ${f.id} encoded to ${encoded.length} chars, expected ${len}`);
    }
    out += encoded;
    cursor = end + 1;
  }
  if (out.length !== totalLen || cursor - 1 !== totalLen) {
    throw new Error(`${recordCode}: record is ${out.length} chars, spec says ${totalLen}`);
  }
  return out;
}

// ============================================================
// Input model — plain data, no DB types. The reports service maps DB rows
// into these; unit tests construct them directly.
// ============================================================

export type OpenFormatBusiness = {
  /** מספר עוסק מורשה — exactly 9 digits (validated by the caller). */
  vatId: string;
  name: string;
  /** ח.פ ברשם החברות (1015) — digits, or null for a non-company. */
  companyId: string | null;
  /** תיק ניכויים (1016) — digits or null. */
  deductionsFileId: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressZip: string | null;
};

export type OpenFormatSoftware = {
  /** 1006 מספר רישום התוכנה (8 digits); null until registration (R7). */
  registrationNumber: string | null;
  name: string; // 1007
  version: string; // 1008
  producerVatId: string | null; // 1009
  producerName: string | null; // 1010
};

export type OpenFormatLine = {
  lineNo: number; // 1255
  catalogId: string | null; // 1259
  description: string; // 1260
  unit: string | null; // 1263 — "יחידה" when empty (spec note)
  /** Postgres numeric serialization, e.g. "2.5000" — encoded to V9999. */
  quantity: string; // 1264
  unitPriceAgorot: number; // 1265
  lineDiscountAgorot: number; // 1266 (positive magnitude; emitted negative)
  lineTotalAgorot: number; // 1267
  vatRateBp: number; // 1268 — basis points (1800 → "1800" = 18.00%)
  baseDocType: string | null; // 1256 (numeric code, e.g. "305")
  baseDocNumber: string | null; // 1257
};

export type OpenFormatPayment = {
  lineNo: number; // 1305
  method: number; // 1306 — 1..9 per spec (matches document_payments.method)
  amountAgorot: number; // 1312
  dueDate: string | null; // 1311 YYYY-MM-DD
  bankNo: string | null; // 1307 (cheque only)
  branchNo: string | null; // 1308
  accountNo: string | null; // 1309
  chequeNo: string | null; // 1310
  cardCompany: number | null; // 1313
  cardTxType: number | null; // 1315
};

export type OpenFormatDocument = {
  docType: "305" | "320" | "330" | "400"; // 1203
  number: number; // → 1204 (emitted as plain digits)
  docDate: string; // 1230 — YYYY-MM-DD (the date printed on the document)
  valueDate: string | null; // 1216
  issueDate: string | null; // 1205 — production date (Asia/Jerusalem)
  issueTime: string | null; // 1206 — "HHMM"
  buyerName: string | null; // 1207
  buyerAddress: string | null; // 1208 (single line — street field)
  buyerPhone: string | null; // 1214
  buyerTaxId: string | null; // 1215 (digits)
  /** 1225 מפתח הלקוח אצל המוכר — stable per-client key (≤15 chars). */
  buyerKey: string | null;
  cancelled: boolean; // 1228
  amounts: {
    beforeDiscountAgorot: number; // 1219
    discountAgorot: number; // 1220 (positive magnitude; emitted negative)
    netAgorot: number; // 1221
    vatAgorot: number; // 1222
    totalAgorot: number; // 1223
    withholdingAgorot: number; // 1224 (emitted positive — הבהרה 4)
  };
  lines: OpenFormatLine[];
  payments: OpenFormatPayment[];
};

export type OpenFormatInput = {
  business: OpenFormatBusiness;
  software: OpenFormatSoftware;
  /** Inclusive doc_date range (multi-year software: fields 1024/1025). */
  dateFrom: string; // YYYY-MM-DD
  dateTo: string; // YYYY-MM-DD
  /** Production timestamp, pre-resolved in Asia/Jerusalem by the caller. */
  generatedDate: string; // YYYY-MM-DD → 1026
  generatedTime: string; // HHMM → 1027
  /** MMDDhhmm directory segment (spec §2.2) — derived from the same clock. */
  generatedDirSegment: string;
  /** 15-digit random primary identifier (1004/1103/1153) — הבהרה 2. */
  primaryId: string;
  documents: OpenFormatDocument[];
};

export const SYSTEM_CONSTANT = "&OF1.31&"; // 1005/1104/1154
export const COMPRESSION_SOFTWARE_NAME = "jszip"; // 1030

// ============================================================
// Record builders
// ============================================================

/** INI.TXT leading record — A000 (466 chars). */
export function buildA000(
  input: OpenFormatInput,
  totalBkmvRecords: number,
  savedPath: string,
): string {
  const { business, software } = input;
  return composeRecord("A000", 466, [
    { id: 1000, cols: [1, 4], kind: "alpha", value: "A000" },
    { id: 1001, cols: [5, 9], kind: "alpha", value: null }, // לשימוש עתידי
    { id: 1002, cols: [10, 24], kind: "num", value: totalBkmvRecords },
    { id: 1003, cols: [25, 33], kind: "num", value: business.vatId },
    { id: 1004, cols: [34, 48], kind: "num", value: input.primaryId },
    { id: 1005, cols: [49, 56], kind: "alpha", value: SYSTEM_CONSTANT },
    { id: 1006, cols: [57, 64], kind: "num", value: software.registrationNumber },
    { id: 1007, cols: [65, 84], kind: "alpha", value: software.name },
    { id: 1008, cols: [85, 104], kind: "alpha", value: software.version },
    { id: 1009, cols: [105, 113], kind: "num", value: software.producerVatId },
    { id: 1010, cols: [114, 133], kind: "alpha", value: software.producerName },
    { id: 1011, cols: [134, 134], kind: "num", value: 2 }, // רב-שנתית (date range)
    { id: 1012, cols: [135, 184], kind: "alpha", value: savedPath },
    { id: 1013, cols: [185, 185], kind: "num", value: 0 }, // אין הנהח"ש — מערכת מסמכים
    { id: 1014, cols: [186, 186], kind: "num", value: null }, // איזון — לא רלוונטי
    { id: 1015, cols: [187, 195], kind: "num", value: business.companyId },
    { id: 1016, cols: [196, 204], kind: "num", value: business.deductionsFileId },
    { id: 1017, cols: [205, 214], kind: "alpha", value: null },
    { id: 1018, cols: [215, 264], kind: "alpha", value: business.name },
    { id: 1019, cols: [265, 314], kind: "alpha", value: business.addressStreet },
    { id: 1020, cols: [315, 324], kind: "alpha", value: null }, // מס' בית — בתוך הרחוב
    { id: 1021, cols: [325, 354], kind: "alpha", value: business.addressCity },
    { id: 1022, cols: [355, 362], kind: "alpha", value: business.addressZip },
    { id: 1023, cols: [363, 366], kind: "num", value: null }, // שנת מס — חד-שנתית בלבד
    { id: 1024, cols: [367, 374], kind: "date", value: input.dateFrom },
    { id: 1025, cols: [375, 382], kind: "date", value: input.dateTo },
    { id: 1026, cols: [383, 390], kind: "date", value: input.generatedDate },
    { id: 1027, cols: [391, 394], kind: "time", value: input.generatedTime },
    { id: 1028, cols: [395, 395], kind: "num", value: 0 }, // שפה: עברית
    { id: 1029, cols: [396, 396], kind: "num", value: 1 }, // ISO-8859-8-i
    { id: 1030, cols: [397, 416], kind: "alpha", value: COMPRESSION_SOFTWARE_NAME },
    // 1031 מבוטל (0 chars)
    { id: 1032, cols: [417, 419], kind: "alpha", value: "ILS" },
    // 1033 מבוטל (0 chars)
    { id: 1034, cols: [420, 420], kind: "num", value: 0 }, // אין סניפים
    { id: 1035, cols: [421, 466], kind: "alpha", value: null },
  ]);
}

/** INI.TXT summary row (19 chars): record code + count (fields 1050/1051). */
export function buildIniSummary(recordCode: string, count: number): string {
  return composeRecord("INI-SUM", 19, [
    { id: 1050, cols: [1, 4], kind: "alpha", value: recordCode },
    { id: 1051, cols: [5, 19], kind: "num", value: count },
  ]);
}

/** BKMVDATA opening record — A100 (95 chars). */
export function buildA100(input: OpenFormatInput, recordNo: number): string {
  return composeRecord("A100", 95, [
    { id: 1100, cols: [1, 4], kind: "alpha", value: "A100" },
    { id: 1101, cols: [5, 13], kind: "num", value: recordNo },
    { id: 1102, cols: [14, 22], kind: "num", value: input.business.vatId },
    { id: 1103, cols: [23, 37], kind: "num", value: input.primaryId },
    { id: 1104, cols: [38, 45], kind: "alpha", value: SYSTEM_CONSTANT },
    { id: 1105, cols: [46, 95], kind: "alpha", value: null },
  ]);
}

/** BKMVDATA closing record — Z900 (110 chars). */
export function buildZ900(
  input: OpenFormatInput,
  recordNo: number,
  totalRecords: number,
): string {
  return composeRecord("Z900", 110, [
    { id: 1150, cols: [1, 4], kind: "alpha", value: "Z900" },
    { id: 1151, cols: [5, 13], kind: "num", value: recordNo },
    { id: 1152, cols: [14, 22], kind: "num", value: input.business.vatId },
    { id: 1153, cols: [23, 37], kind: "num", value: input.primaryId },
    { id: 1154, cols: [38, 45], kind: "alpha", value: SYSTEM_CONSTANT },
    { id: 1155, cols: [46, 60], kind: "num", value: totalRecords },
    { id: 1156, cols: [61, 110], kind: "alpha", value: null },
  ]);
}

/**
 * Document header — C100 (444 chars).
 *
 * Money-field policy (verified against הבהרות 4/5 and pinned down for the
 * simulator loop): every ILS money field carries a signed value (zero →
 * "+0…0" — הבהרה 4's example fills 0 explicitly); the discount (1220) is the
 * one value emitted NEGATIVE (הבהרה 5); the withholding (1224) is emitted
 * POSITIVE and does not reduce 1223 (הבהרה 4); only the foreign-currency
 * pair (1217/1218) is left blank — ILS documents never fill it.
 */
export function buildC100(
  input: OpenFormatInput,
  doc: OpenFormatDocument,
  recordNo: number,
  docLinkNo: number,
  warn: (message: string) => void,
): string {
  const a = doc.amounts;
  const buyerTaxId = digitsForNumField(doc.buyerTaxId, 9, warn);
  return composeRecord("C100", 444, [
    { id: 1200, cols: [1, 4], kind: "alpha", value: "C100" },
    { id: 1201, cols: [5, 13], kind: "num", value: recordNo },
    { id: 1202, cols: [14, 22], kind: "num", value: input.business.vatId },
    { id: 1203, cols: [23, 25], kind: "num", value: doc.docType },
    { id: 1204, cols: [26, 45], kind: "alpha", value: String(doc.number) },
    { id: 1205, cols: [46, 53], kind: "date", value: doc.issueDate },
    { id: 1206, cols: [54, 57], kind: "time", value: doc.issueTime },
    { id: 1207, cols: [58, 107], kind: "alpha", value: doc.buyerName },
    { id: 1208, cols: [108, 157], kind: "alpha", value: doc.buyerAddress },
    { id: 1209, cols: [158, 167], kind: "alpha", value: null },
    { id: 1210, cols: [168, 197], kind: "alpha", value: null },
    { id: 1211, cols: [198, 205], kind: "alpha", value: null },
    { id: 1212, cols: [206, 235], kind: "alpha", value: null },
    { id: 1213, cols: [236, 237], kind: "alpha", value: null },
    { id: 1214, cols: [238, 252], kind: "alpha", value: doc.buyerPhone },
    { id: 1215, cols: [253, 261], kind: "num", value: buyerTaxId },
    { id: 1216, cols: [262, 269], kind: "date", value: doc.valueDate },
    { id: 1217, cols: [270, 284], kind: "amount", scaled: null, dec: 2 }, // מט"ח — לא בשימוש
    { id: 1218, cols: [285, 287], kind: "alpha", value: null }, // קוד מט"ח
    { id: 1219, cols: [288, 302], kind: "amount", scaled: a.beforeDiscountAgorot, dec: 2 },
    { id: 1220, cols: [303, 317], kind: "amount", scaled: -a.discountAgorot, dec: 2 },
    { id: 1221, cols: [318, 332], kind: "amount", scaled: a.netAgorot, dec: 2 },
    { id: 1222, cols: [333, 347], kind: "amount", scaled: a.vatAgorot, dec: 2 },
    { id: 1223, cols: [348, 362], kind: "amount", scaled: a.totalAgorot, dec: 2 },
    { id: 1224, cols: [363, 374], kind: "amount", scaled: a.withholdingAgorot, dec: 2 },
    { id: 1225, cols: [375, 389], kind: "alpha", value: doc.buyerKey },
    { id: 1226, cols: [390, 399], kind: "alpha", value: null }, // שדה התאמה
    // 1227 מבוטל (0 chars)
    { id: 1228, cols: [400, 400], kind: "alpha", value: doc.cancelled ? "1" : null },
    // 1229 מבוטל (0 chars)
    { id: 1230, cols: [401, 408], kind: "date", value: doc.docDate },
    { id: 1231, cols: [409, 415], kind: "alpha", value: null }, // סניף — 1034=0
    // 1232 מבוטל (0 chars)
    { id: 1233, cols: [416, 424], kind: "alpha", value: null }, // מבצע הפעולה — רשות
    { id: 1234, cols: [425, 431], kind: "num", value: docLinkNo },
    { id: 1235, cols: [432, 444], kind: "alpha", value: null },
  ]);
}

/** Document line — D110 (339 chars). */
export function buildD110(
  input: OpenFormatInput,
  doc: OpenFormatDocument,
  line: OpenFormatLine,
  recordNo: number,
  docLinkNo: number,
): string {
  return composeRecord("D110", 339, [
    { id: 1250, cols: [1, 4], kind: "alpha", value: "D110" },
    { id: 1251, cols: [5, 13], kind: "num", value: recordNo },
    { id: 1252, cols: [14, 22], kind: "num", value: input.business.vatId },
    { id: 1253, cols: [23, 25], kind: "num", value: doc.docType },
    { id: 1254, cols: [26, 45], kind: "alpha", value: String(doc.number) },
    { id: 1255, cols: [46, 49], kind: "num", value: line.lineNo },
    { id: 1256, cols: [50, 52], kind: "num", value: line.baseDocType },
    { id: 1257, cols: [53, 72], kind: "alpha", value: line.baseDocNumber },
    { id: 1258, cols: [73, 73], kind: "num", value: null }, // סוג עסקה — רשות
    { id: 1259, cols: [74, 93], kind: "alpha", value: line.catalogId },
    { id: 1260, cols: [94, 123], kind: "alpha", value: line.description },
    { id: 1261, cols: [124, 173], kind: "alpha", value: null }, // שם היצרן — נספח ג' בלבד
    { id: 1262, cols: [174, 203], kind: "alpha", value: null }, // מס' סידורי של המוצר
    { id: 1263, cols: [204, 223], kind: "alpha", value: line.unit?.trim() || "יחידה" },
    {
      id: 1264,
      cols: [224, 240],
      kind: "amount",
      scaled: decimalStringToScaled(line.quantity, 4),
      dec: 4,
    },
    { id: 1265, cols: [241, 255], kind: "amount", scaled: line.unitPriceAgorot, dec: 2 },
    { id: 1266, cols: [256, 270], kind: "amount", scaled: -line.lineDiscountAgorot, dec: 2 },
    { id: 1267, cols: [271, 285], kind: "amount", scaled: line.lineTotalAgorot, dec: 2 },
    // 9(2)V99 — percent×100, i.e. basis points: 1800 → "1800" = 18.00%
    { id: 1268, cols: [286, 289], kind: "num", value: line.vatRateBp },
    // 1269 מבוטל (0 chars)
    { id: 1270, cols: [290, 296], kind: "alpha", value: null }, // סניף — 1034=0
    // 1271 מבוטל (0 chars)
    { id: 1272, cols: [297, 304], kind: "date", value: doc.docDate },
    { id: 1273, cols: [305, 311], kind: "num", value: docLinkNo },
    { id: 1274, cols: [312, 318], kind: "alpha", value: null }, // סניף מסמך בסיס
    { id: 1275, cols: [319, 339], kind: "alpha", value: null },
  ]);
}

/** Receipt/payment line — D120 (222 chars). */
export function buildD120(
  input: OpenFormatInput,
  doc: OpenFormatDocument,
  payment: OpenFormatPayment,
  recordNo: number,
  docLinkNo: number,
  warn: (message: string) => void,
): string {
  const isCheque = payment.method === 2;
  const chequeWarn = (msg: string) =>
    warn(`מסמך ${doc.docType}/${doc.number} תקבול ${payment.lineNo}: ${msg}`);
  return composeRecord("D120", 222, [
    { id: 1300, cols: [1, 4], kind: "alpha", value: "D120" },
    { id: 1301, cols: [5, 13], kind: "num", value: recordNo },
    { id: 1302, cols: [14, 22], kind: "num", value: input.business.vatId },
    { id: 1303, cols: [23, 25], kind: "num", value: doc.docType },
    { id: 1304, cols: [26, 45], kind: "alpha", value: String(doc.number) },
    { id: 1305, cols: [46, 49], kind: "num", value: payment.lineNo },
    { id: 1306, cols: [50, 50], kind: "num", value: payment.method },
    { id: 1307, cols: [51, 60], kind: "num", value: isCheque ? digitsForNumField(payment.bankNo, 10, chequeWarn) : null },
    { id: 1308, cols: [61, 70], kind: "num", value: isCheque ? digitsForNumField(payment.branchNo, 10, chequeWarn) : null },
    { id: 1309, cols: [71, 85], kind: "num", value: isCheque ? digitsForNumField(payment.accountNo, 15, chequeWarn) : null },
    { id: 1310, cols: [86, 95], kind: "num", value: isCheque ? digitsForNumField(payment.chequeNo, 10, chequeWarn) : null },
    { id: 1311, cols: [96, 103], kind: "date", value: payment.dueDate },
    { id: 1312, cols: [104, 118], kind: "amount", scaled: payment.amountAgorot, dec: 2 },
    { id: 1313, cols: [119, 119], kind: "num", value: payment.cardCompany },
    { id: 1314, cols: [120, 139], kind: "alpha", value: null }, // שם הכרטיס הנסלק
    { id: 1315, cols: [140, 140], kind: "num", value: payment.cardTxType },
    // 1316-1319 מבוטלים (0 chars)
    { id: 1320, cols: [141, 147], kind: "alpha", value: null }, // סניף — 1034=0
    // 1321 מבוטל (0 chars)
    { id: 1322, cols: [148, 155], kind: "date", value: doc.docDate },
    { id: 1323, cols: [156, 162], kind: "num", value: docLinkNo },
    { id: 1324, cols: [163, 222], kind: "alpha", value: null },
  ]);
}
