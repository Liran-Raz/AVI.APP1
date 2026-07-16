import "server-only";

import iconv from "iconv-lite";
import JSZip from "jszip";

import {
  buildA000,
  buildA100,
  buildC100,
  buildD110,
  buildD120,
  buildIniSummary,
  buildZ900,
  type OpenFormatDocument,
  type OpenFormatInput,
} from "./records";

// ============================================================
// OPEN FORMAT (מבנה אחיד) v1.31 — export assembly.
//
// Produces INI.TXT + BKMVDATA.TXT (fixed-width, ISO-8859-8-i logical, CRLF
// after EVERY record incl. the last — spec §2.4 ט), packaged per spec §2.2:
//
//   OPENFRMT\<8-digit-vat>.<YY>\<MMDDhhmm>\INI.TXT
//   OPENFRMT\<8-digit-vat>.<YY>\<MMDDhhmm>\BKMVDATA.zip   (containing BKMVDATA.TXT)
//
// (§2.2(ד): the data file itself is compressed into an archive named
// BKMVDATA; the zip suffix follows the compressing software.) The whole tree
// is wrapped in one downloadable ZIP so the user extracts it at a drive root.
// ============================================================

const CRLF = "\r\n";
const CHARSET = "iso88598"; // ISO-8859-8; the "-i" variant = same bytes, logical order

export type OpenFormatCounts = {
  C100: number;
  D110: number;
  D120: number;
  /** Total BKMVDATA records including A100 + Z900 (fields 1002/1155). */
  total: number;
};

export type OpenFormatBuildResult = {
  /** Pre-encoding record texts — one string per record, no CRLF. For tests. */
  iniRecords: string[];
  dataRecords: string[];
  iniBytes: Buffer;
  dataBytes: Buffer;
  /** The spec directory (inside the download): OPENFRMT/<vat8>.<YY>/<MMDDhhmm> */
  specDir: string;
  /** Value written to INI field 1012 (notional extraction path, backslashes). */
  savedPath: string;
  counts: OpenFormatCounts;
  /** Non-fatal data issues (digits truncated, etc.) — surfaced in the UI. */
  warnings: string[];
};

/** Sort: by type, then number — stable series order within the file. */
function documentSortKey(d: OpenFormatDocument): [string, number] {
  return [d.docType, d.number];
}

export function buildOpenFormat(input: OpenFormatInput): OpenFormatBuildResult {
  if (!/^\d{9}$/.test(input.business.vatId)) {
    throw new Error("openformat: business vatId must be exactly 9 digits");
  }
  if (!/^\d{15}$/.test(input.primaryId)) {
    throw new Error("openformat: primaryId must be exactly 15 digits");
  }
  if (!/^\d{8}$/.test(input.generatedDirSegment)) {
    throw new Error("openformat: generatedDirSegment must be MMDDhhmm");
  }

  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);

  const docs = [...input.documents].sort((a, b) => {
    const [ta, na] = documentSortKey(a);
    const [tb, nb] = documentSortKey(b);
    return ta === tb ? na - nb : ta.localeCompare(tb);
  });

  // §2.2(ב): directory named by the FIRST 8 digits of the vat id, then '.',
  // then two digits of the production year.
  const vat8 = input.business.vatId.slice(0, 8);
  const yy = input.generatedDate.slice(2, 4);
  const dirName = `${vat8}.${yy}`;
  const specDir = `OPENFRMT/${dirName}/${input.generatedDirSegment}`;
  const savedPath = `\\OPENFRMT\\${dirName}\\${input.generatedDirSegment}`;

  // ---- BKMVDATA.TXT ------------------------------------------------------
  const dataRecords: string[] = [];
  const counts: OpenFormatCounts = { C100: 0, D110: 0, D120: 0, total: 0 };

  let recordNo = 0;
  const next = () => ++recordNo;

  dataRecords.push(buildA100(input, next()));

  let docLinkNo = 0;
  for (const doc of docs) {
    docLinkNo += 1;
    dataRecords.push(buildC100(input, doc, next(), docLinkNo, warn));
    counts.C100 += 1;
    for (const line of doc.lines) {
      dataRecords.push(buildD110(input, doc, line, next(), docLinkNo));
      counts.D110 += 1;
    }
    for (const payment of doc.payments) {
      dataRecords.push(buildD120(input, doc, payment, next(), docLinkNo, warn));
      counts.D120 += 1;
    }
  }

  const total = recordNo + 1; // +1 for Z900 itself (1155 counts open+close too)
  dataRecords.push(buildZ900(input, next(), total));
  counts.total = total;

  // ---- INI.TXT -----------------------------------------------------------
  const iniRecords: string[] = [buildA000(input, total, savedPath)];
  // §3.2: one summary row per record type that EXISTS in BKMVDATA.TXT.
  if (counts.C100 > 0) iniRecords.push(buildIniSummary("C100", counts.C100));
  if (counts.D110 > 0) iniRecords.push(buildIniSummary("D110", counts.D110));
  if (counts.D120 > 0) iniRecords.push(buildIniSummary("D120", counts.D120));

  const iniBytes = iconv.encode(iniRecords.join(CRLF) + CRLF, CHARSET);
  const dataBytes = iconv.encode(dataRecords.join(CRLF) + CRLF, CHARSET);

  return { iniRecords, dataRecords, iniBytes, dataBytes, specDir, savedPath, counts, warnings };
}

/**
 * Package the built export as one downloadable ZIP:
 *   OPENFRMT/<vat8>.<YY>/<MMDDhhmm>/INI.TXT
 *   OPENFRMT/<vat8>.<YY>/<MMDDhhmm>/BKMVDATA.zip  (contains BKMVDATA.TXT)
 *   קרא-אותי.txt (extraction instructions, at the zip root)
 */
export async function zipOpenFormat(build: OpenFormatBuildResult): Promise<Buffer> {
  const inner = new JSZip();
  inner.file("BKMVDATA.TXT", build.dataBytes);
  const innerBytes = await inner.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });

  const outer = new JSZip();
  outer.file(`${build.specDir}/INI.TXT`, build.iniBytes);
  outer.file(`${build.specDir}/BKMVDATA.zip`, innerBytes);
  outer.file(
    "קרא-אותי.txt",
    [
      "קובצי ממשק פתוח (מבנה אחיד v1.31)",
      "",
      "יש לחלץ את תיקיית OPENFRMT אל שורש כונן (לדוגמה C:\\ או F:\\),",
      `כך שיתקבל הנתיב: <כונן>:${build.savedPath}`,
      "",
      "התיקייה מכילה:",
      "  INI.TXT      — קובץ תמצית נתוני ההפקה",
      "  BKMVDATA.zip — קובץ המידע העסקי (BKMVDATA.TXT מכווץ, לפי סעיף 2.2(ד) להוראות)",
      "",
      "את הקבצים ניתן לבדוק בסימולטור באתר רשות המסים (misim.gov.il).",
    ].join("\r\n"),
  );

  return outer.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}
