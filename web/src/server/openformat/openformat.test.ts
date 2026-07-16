import { describe, expect, it } from "vitest";

import iconv from "iconv-lite";
import JSZip from "jszip";

import {
  decimalStringToScaled,
  encodeAlpha,
  encodeAmount,
  encodeNum,
  sanitizeText,
} from "./encode";
import type {
  OpenFormatDocument,
  OpenFormatInput,
} from "./records";
import { buildOpenFormat, zipOpenFormat } from "./build";

// ============================================================
// Byte-exact tests for the מבנה-אחיד v1.31 engine. Position/length/value
// assertions are transcribed from the spec tables and its worked examples
// (spec §2.4 examples for signed amounts; record lengths from §2.5(ה)).
// ============================================================

describe("openformat/encode", () => {
  it("encodes signed amounts exactly like the spec §2.4 examples (x9(5)v99)", () => {
    // ‎-12345.65 → "-1234565" ; 1245.65 → "+0124565" ; 1245 → "+0124500"
    expect(encodeAmount(-1234565, 5, 2)).toBe("-1234565");
    expect(encodeAmount(124565, 5, 2)).toBe("+0124565");
    expect(encodeAmount(124500, 5, 2)).toBe("+0124500");
  });

  it("emits signed zero for a zero amount and spaces for a null amount", () => {
    expect(encodeAmount(0, 12, 2)).toBe("+" + "0".repeat(14));
    expect(encodeAmount(null, 12, 2)).toBe(" ".repeat(15));
  });

  it("throws on amount overflow instead of corrupting the record", () => {
    expect(() => encodeAmount(10 ** 8, 5, 2)).toThrow(/overflows/);
  });

  it("zero-pads numeric fields and space-pads alphanumeric fields", () => {
    expect(encodeNum(1234, 9)).toBe("000001234");
    expect(encodeNum("0005", 4)).toBe("0005");
    expect(encodeNum(null, 4)).toBe("0000");
    expect(() => encodeNum(12345, 4)).toThrow(/overflows/);
    expect(encodeAlpha("אאא", 5)).toBe("אאא  ");
    expect(encodeAlpha(null, 3)).toBe("   ");
    expect(encodeAlpha("אבגדה", 3)).toBe("אבג");
  });

  it("sanitizes characters ISO-8859-8 cannot carry", () => {
    expect(sanitizeText('רו״ח בע׳מ')).toBe(`רו"ח בע'מ`);
    expect(sanitizeText("100 ₪ לשעה")).toBe('100 ש"ח לשעה');
    expect(sanitizeText("קו – ארוך")).toBe("קו - ארוך");
    expect(sanitizeText("שלום 🙂 עולם")).toBe("שלום ? עולם");
    expect(sanitizeText("שורה\r\nחדשה")).toBe("שורה  חדשה");
  });

  it("parses Postgres numeric strings without float drift", () => {
    expect(decimalStringToScaled("2.5000", 4)).toBe(25000);
    expect(decimalStringToScaled("2.5", 4)).toBe(25000);
    expect(decimalStringToScaled("3", 4)).toBe(30000);
    expect(decimalStringToScaled("1.2345", 4)).toBe(12345);
    expect(decimalStringToScaled("-1.25", 2)).toBe(-125);
    expect(decimalStringToScaled("1.23450", 4)).toBe(12345);
    expect(() => decimalStringToScaled("1.23456", 4)).toThrow(/decimal digits/);
  });
});

// ---------------------------------------------------------------------------

function fixtureInput(overrides?: Partial<OpenFormatInput>): OpenFormatInput {
  const invoice: OpenFormatDocument = {
    docType: "305",
    number: 2001,
    docDate: "2026-05-31",
    valueDate: null,
    issueDate: "2026-06-05",
    issueTime: "0930",
    buyerName: "לקוח בדיקה בע\"מ",
    buyerAddress: "הרצל 10, תל אביב",
    buyerPhone: "03-1234567",
    buyerTaxId: "512345678",
    buyerKey: "512345678",
    cancelled: false,
    amounts: {
      beforeDiscountAgorot: 120000, // ₪1,200.00
      discountAgorot: 20000, // ₪200.00 discount
      netAgorot: 100000, // ₪1,000.00
      vatAgorot: 18000, // 18%
      totalAgorot: 118000,
      withholdingAgorot: 0,
    },
    lines: [
      {
        lineNo: 1,
        catalogId: null,
        description: "שירותי הנהלת חשבונות",
        unit: null,
        quantity: "2.0000",
        unitPriceAgorot: 50000,
        lineDiscountAgorot: 0,
        lineTotalAgorot: 100000,
        vatRateBp: 1800,
        baseDocType: null,
        baseDocNumber: null,
      },
      {
        lineNo: 2,
        catalogId: "SRV-7",
        description: "ייעוץ",
        unit: "שעה",
        quantity: "0.5000",
        unitPriceAgorot: 40000,
        lineDiscountAgorot: 0,
        lineTotalAgorot: 20000,
        vatRateBp: 1800,
        baseDocType: null,
        baseDocNumber: null,
      },
    ],
    payments: [],
  };

  const receipt: OpenFormatDocument = {
    docType: "400",
    number: 501,
    docDate: "2026-06-10",
    valueDate: "2026-06-10",
    issueDate: "2026-06-10",
    issueTime: "1215",
    buyerName: "משלם במזומן",
    buyerAddress: null,
    buyerPhone: null,
    buyerTaxId: null,
    buyerKey: "C-11",
    cancelled: false,
    amounts: {
      // הבהרה 4: received 1000 after 250 withheld at source → 1219/1221/1223
      // carry 1000, 1224 carries +250, 1220/1222 carry zero.
      beforeDiscountAgorot: 100000,
      discountAgorot: 0,
      netAgorot: 100000,
      vatAgorot: 0,
      totalAgorot: 100000,
      withholdingAgorot: 25000,
    },
    lines: [],
    payments: [
      {
        lineNo: 1,
        method: 2, // המחאה
        amountAgorot: 60000,
        dueDate: "2026-07-01",
        bankNo: "12",
        branchNo: "600",
        accountNo: "12-345-678",
        chequeNo: "0004321",
        cardCompany: null,
        cardTxType: null,
      },
      {
        lineNo: 2,
        method: 1, // מזומן
        amountAgorot: 40000,
        dueDate: null,
        bankNo: null,
        branchNo: null,
        accountNo: null,
        chequeNo: null,
        cardCompany: null,
        cardTxType: null,
      },
    ],
  };

  const credit: OpenFormatDocument = {
    docType: "330",
    number: 7,
    docDate: "2026-06-20",
    valueDate: null,
    issueDate: "2026-06-20",
    issueTime: "1600",
    buyerName: "לקוח בדיקה בע\"מ",
    buyerAddress: null,
    buyerPhone: null,
    buyerTaxId: "512345678",
    buyerKey: "512345678",
    cancelled: false,
    amounts: {
      beforeDiscountAgorot: 118000,
      discountAgorot: 0,
      netAgorot: 100000,
      vatAgorot: 18000,
      totalAgorot: 118000,
      withholdingAgorot: 0,
    },
    lines: [
      {
        lineNo: 1,
        catalogId: null,
        description: "זיכוי עבור חשבונית מס 2001",
        unit: null,
        quantity: "1.0000",
        unitPriceAgorot: 100000,
        lineDiscountAgorot: 0,
        lineTotalAgorot: 100000,
        vatRateBp: 1800,
        baseDocType: "305",
        baseDocNumber: "2001",
      },
    ],
    payments: [],
  };

  return {
    business: {
      vatId: "002233445",
      name: "משרד רואי חשבון אבי",
      companyId: null,
      deductionsFileId: null,
      addressStreet: "הרצל 1",
      addressCity: "תל אביב",
      addressZip: "6800000",
    },
    software: {
      registrationNumber: null,
      name: "AVI.APP",
      version: "1.0",
      producerVatId: "300000000",
      producerName: "אבי אפליקציות",
    },
    dateFrom: "2026-01-01",
    dateTo: "2026-12-31",
    generatedDate: "2026-07-16",
    generatedTime: "1030",
    generatedDirSegment: "07161030",
    primaryId: "123456789012345",
    documents: [receipt, credit, invoice], // deliberately unsorted
    ...overrides,
  };
}

describe("openformat/build", () => {
  it("emits records at the exact spec lengths", () => {
    const b = buildOpenFormat(fixtureInput());
    const byCode = (code: string) =>
      b.dataRecords.filter((r) => r.startsWith(code));
    expect(byCode("A100")[0]).toHaveLength(95);
    expect(byCode("Z900")[0]).toHaveLength(110);
    for (const r of byCode("C100")) expect(r).toHaveLength(444);
    for (const r of byCode("D110")) expect(r).toHaveLength(339);
    for (const r of byCode("D120")) expect(r).toHaveLength(222);
    expect(b.iniRecords[0]).toHaveLength(466);
    for (const r of b.iniRecords.slice(1)) expect(r).toHaveLength(19);
  });

  it("orders, numbers and counts records correctly", () => {
    const b = buildOpenFormat(fixtureInput());
    // Sorted by type then number: 305/2001 (+2 lines), 330/7 (+1 line),
    // 400/501 (+2 payments). A100 first, Z900 last.
    const codes = b.dataRecords.map((r) => r.slice(0, 4));
    expect(codes).toEqual([
      "A100",
      "C100", "D110", "D110",
      "C100", "D110",
      "C100", "D120", "D120",
      "Z900",
    ]);
    // Running record numbers (field 2, 9(9), cols 5-13) are 1..N in order.
    const runningNos = b.dataRecords.map((r) => Number(r.slice(4, 13)));
    expect(runningNos).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(b.counts).toEqual({ C100: 3, D110: 3, D120: 2, total: 10 });
    // Z900 1155 (cols 46-60) = total including A100+Z900.
    const z900 = b.dataRecords.at(-1)!;
    expect(z900.slice(45, 60)).toBe("000000000000010");
    // INI 1002 (cols 10-24) equals the same total.
    expect(b.iniRecords[0].slice(9, 24)).toBe("000000000000010");
    // INI summaries: code (1-4) + count 9(15) (5-19).
    expect(b.iniRecords.slice(1)).toEqual([
      "C100000000000000003",
      "D110000000000000003",
      "D120000000000000002",
    ]);
  });

  it("builds C100 fields at their spec positions", () => {
    const b = buildOpenFormat(fixtureInput());
    const c100 = b.dataRecords[1]; // the 305
    expect(c100.slice(0, 4)).toBe("C100");
    expect(c100.slice(13, 22)).toBe("002233445"); // 1202 vat
    expect(c100.slice(22, 25)).toBe("305"); // 1203 doc type
    expect(c100.slice(25, 45)).toBe("2001".padEnd(20, " ")); // 1204 doc number
    expect(c100.slice(45, 53)).toBe("20260605"); // 1205 production date
    expect(c100.slice(53, 57)).toBe("0930"); // 1206 production time
    expect(c100.slice(57, 107).trimEnd()).toBe('לקוח בדיקה בע"מ'); // 1207
    expect(c100.slice(252, 261)).toBe("512345678"); // 1215 buyer vat
    expect(c100.slice(261, 269)).toBe("00000000"); // 1216 value date (none)
    expect(c100.slice(269, 284)).toBe(" ".repeat(15)); // 1217 מט"ח — blank
    expect(c100.slice(284, 287)).toBe("   "); // 1218 currency code — blank
    expect(c100.slice(287, 302)).toBe("+00000000120000"); // 1219 ₪1,200.00
    expect(c100.slice(302, 317)).toBe("-00000000020000"); // 1220 discount − (הבהרה 5)
    expect(c100.slice(317, 332)).toBe("+00000000100000"); // 1221 ₪1,000.00
    expect(c100.slice(332, 347)).toBe("+00000000018000"); // 1222 VAT ₪180.00
    expect(c100.slice(347, 362)).toBe("+00000000118000"); // 1223 total ₪1,180.00
    expect(c100.slice(362, 374)).toBe("+00000000000"); // 1224 withholding zero
    expect(c100.slice(374, 389).trimEnd()).toBe("512345678"); // 1225 buyer key
    expect(c100.slice(399, 400)).toBe(" "); // 1228 not cancelled
    expect(c100.slice(400, 408)).toBe("20260531"); // 1230 document date
    expect(c100.slice(424, 431)).toBe("0000001"); // 1234 link no (doc #1)
    expect(c100).toHaveLength(444);
  });

  it("applies הבהרה 4 to receipts: withholding positive, zeros elsewhere", () => {
    const b = buildOpenFormat(fixtureInput());
    const receipt = b.dataRecords[6];
    expect(receipt.slice(22, 25)).toBe("400");
    // הבהרה 4's worked example: 1219/1221/1223 carry the net received amount,
    // 1224 carries the withholding with a PLUS sign, 1220/1222 carry zero.
    expect(receipt.slice(287, 302)).toBe("+00000000100000"); // 1219 ₪1,000.00
    expect(receipt.slice(302, 317)).toBe("+00000000000000"); // 1220 zero (not −)
    expect(receipt.slice(332, 347)).toBe("+00000000000000"); // 1222 VAT zero
    expect(receipt.slice(347, 362)).toBe("+00000000100000"); // 1223 ₪1,000.00
    expect(receipt.slice(362, 374)).toBe("+00000025000"); // 1224 ₪250.00, plus
  });

  it("builds D110 with base-document reference and quantity V9999", () => {
    const b = buildOpenFormat(fixtureInput());
    const creditLine = b.dataRecords[5]; // D110 of the 330
    expect(creditLine.slice(0, 4)).toBe("D110");
    expect(creditLine.slice(22, 25)).toBe("330");
    expect(creditLine.slice(49, 52)).toBe("305"); // 1256 base type
    expect(creditLine.slice(52, 72).trimEnd()).toBe("2001"); // 1257 base number
    expect(creditLine.slice(203, 223).trimEnd()).toBe("יחידה"); // 1263 default unit
    expect(creditLine.slice(223, 240)).toBe("+0000000000010000"); // 1264 qty 1.0000
    expect(creditLine.slice(285, 289)).toBe("1800"); // 1268 VAT bp
    expect(creditLine.slice(296, 304)).toBe("20260620"); // 1272 doc date
    expect(creditLine.slice(304, 311)).toBe("0000002"); // 1273 link → doc #2
  });

  it("builds D120 cheque fields only for cheques", () => {
    const b = buildOpenFormat(fixtureInput());
    const cheque = b.dataRecords[7];
    const cash = b.dataRecords[8];
    expect(cheque.slice(49, 50)).toBe("2"); // 1306 method
    expect(cheque.slice(50, 60)).toBe("0000000012"); // 1307 bank
    expect(cheque.slice(60, 70)).toBe("0000000600"); // 1308 branch
    expect(cheque.slice(70, 85)).toBe("000000012345678"); // 1309 account (digits only)
    expect(cheque.slice(85, 95)).toBe("0000004321"); // 1310 cheque no
    expect(cheque.slice(95, 103)).toBe("20260701"); // 1311 due date
    expect(cheque.slice(103, 118)).toBe("+00000000060000"); // 1312 ₪600.00
    expect(cash.slice(49, 50)).toBe("1");
    expect(cash.slice(50, 60)).toBe("0000000000"); // no bank for cash
    expect(cash.slice(95, 103)).toBe("00000000"); // no due date
  });

  it("marks cancelled documents with 1228=1 and keeps them in the counts", () => {
    const input = fixtureInput();
    input.documents[0].cancelled = true; // the receipt
    const b = buildOpenFormat(input);
    const receipt = b.dataRecords[6];
    expect(receipt.slice(399, 400)).toBe("1");
    expect(b.counts.C100).toBe(3);
  });

  it("encodes to ISO-8859-8 logical order with CRLF after every record", () => {
    const b = buildOpenFormat(fixtureInput());
    // String and byte lengths agree (single-byte charset) per record + CRLF.
    const expectedDataLen = b.dataRecords.reduce((n, r) => n + r.length + 2, 0);
    expect(b.dataBytes.length).toBe(expectedDataLen);
    expect(b.dataBytes.subarray(-2)).toEqual(Buffer.from([0x0d, 0x0a]));
    // Hebrew survives the round-trip (logical order — NOT visually reversed).
    const decoded = iconv.decode(b.dataBytes, "iso88598");
    expect(decoded).toContain("שירותי הנהלת חשבונות");
    // א is 0xE0: the first Hebrew byte of "אבי..." inside the INI business name.
    const decodedIni = iconv.decode(b.iniBytes, "iso88598");
    expect(decodedIni).toContain("משרד רואי חשבון אבי");
  });

  it("A000 carries the registration placeholder, flags and range", () => {
    const b = buildOpenFormat(fixtureInput());
    const a000 = b.iniRecords[0];
    expect(a000.slice(0, 4)).toBe("A000");
    expect(a000.slice(24, 33)).toBe("002233445"); // 1003
    expect(a000.slice(33, 48)).toBe("123456789012345"); // 1004 primary id
    expect(a000.slice(48, 56)).toBe("&OF1.31&"); // 1005
    expect(a000.slice(56, 64)).toBe("00000000"); // 1006 — not registered yet
    expect(a000.slice(64, 84).trimEnd()).toBe("AVI.APP"); // 1007
    expect(a000.slice(133, 134)).toBe("2"); // 1011 multi-year
    expect(a000.slice(184, 185)).toBe("0"); // 1013 — documents-only system
    expect(a000.slice(366, 374)).toBe("20260101"); // 1024 from
    expect(a000.slice(374, 382)).toBe("20261231"); // 1025 to
    expect(a000.slice(394, 395)).toBe("0"); // 1028 Hebrew
    expect(a000.slice(395, 396)).toBe("1"); // 1029 ISO-8859-8-i
    expect(a000.slice(416, 419)).toBe("ILS"); // 1032
    expect(a000.slice(419, 420)).toBe("0"); // 1034 no branches
  });

  it("collects warnings instead of failing on messy identifier data", () => {
    const input = fixtureInput();
    input.documents[0].payments[0].accountNo = "12345678901234567890"; // 20 digits
    const b = buildOpenFormat(input);
    expect(b.warnings.length).toBe(1);
    expect(b.warnings[0]).toContain("הספרות האחרונות");
    const cheque = b.dataRecords[7];
    expect(cheque.slice(70, 85)).toBe("678901234567890"); // rightmost 15 kept
  });

  it("packages the spec directory tree inside the download zip", async () => {
    const b = buildOpenFormat(fixtureInput());
    expect(b.specDir).toBe("OPENFRMT/00223344.26/07161030");
    expect(b.savedPath).toBe("\\OPENFRMT\\00223344.26\\07161030");
    const zipBytes = await zipOpenFormat(b);
    const outer = await JSZip.loadAsync(zipBytes);
    const ini = outer.file("OPENFRMT/00223344.26/07161030/INI.TXT");
    const innerZip = outer.file("OPENFRMT/00223344.26/07161030/BKMVDATA.zip");
    expect(ini).toBeTruthy();
    expect(innerZip).toBeTruthy();
    const iniBytes = await ini!.async("nodebuffer");
    expect(iniBytes.equals(b.iniBytes)).toBe(true);
    const inner = await JSZip.loadAsync(await innerZip!.async("nodebuffer"));
    const data = await inner.file("BKMVDATA.TXT")!.async("nodebuffer");
    expect(data.equals(b.dataBytes)).toBe(true);
  });
});
