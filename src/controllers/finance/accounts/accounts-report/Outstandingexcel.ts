import { Request, Response } from "express";
import oracledb from "oracledb";
// @ts-ignore
const AdmZip = require("adm-zip");
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const text = (v: any) => (v == null ? "" : String(v));
const num  = (v: any) => Number(v) || 0;

const money = (v: any) => {
  const n = Number(v);
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
};

const formatDateStr = (v: any) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

const formatBalance = (value: number) =>
  value < 0 ? `(${money(Math.abs(value))})` : money(value);

function escapeXml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── Style IDs ────────────────────────────────────────────────────────────────
const STYLE_ID = {
  default:       0,
  company:       1,   // navy bg, white bold 18
  title:         2,   // white bg, dark bold 14, centered
  section:       3,   // white bg, dark bold 11
  tableHead:     4,   // navy bg, white bold 11
  normal:        5,   // normal data
  numData:       6,   // right-align #,##0.000
  acHeader:      7,   // grey bg, bold 11
  acTotal:       8,   // ac subtotal text
  acTotalNum:    9,   // ac subtotal num
  grandTotal:    10,  // grand total text
  grandTotalNum: 11,  // grand total num
  negNum:        12,  // negative balance red
  negTotalNum:   13,  // negative in total row red bold
} as const;
type StyleKey = keyof typeof STYLE_ID;

interface XlCell { v: unknown; s: number }
const xc = (v: unknown, style: StyleKey): XlCell => ({ v, s: STYLE_ID[style] });
const skip = null;

// ─── Shared DB fetch ──────────────────────────────────────────────────────────
async function fetchRows(req: Request, parameter: string) {
  const {
    loginid,
    code1, code2, code3, code4, code5, code6,
    code7, code8, code9, code10, code11, code12,
    code13, code14, code15, code16,
  } = req.body;

  let tenantId = getCurrentTenantId();
  if (!tenantId && loginid) tenantId = await TenantManager.getTenantForUser(loginid);
  if (!tenantId) throw new Error("Tenant not found");

  const connection = await TenantManager.getConnection(tenantId);
  try {
    const binds: any = {
      parameter,
      loginid: loginid || "ADMIN",
      code1:  code1  || null, code2:  code2  || null,
      code3:  code3  || null, code4:  code4  || null,
      code5:  code5  || null, code6:  code6  || null,
      code7:  code7  || null, code8:  code8  || null,
      code9:  code9  || null, code10: code10 || null,
      code11: code11 || null, code12: code12 || null,
      code13: code13 || null, code14: code14 || null,
      code15: code15 || null, code16: code16 || null,
      code17: null, code18: null, code19: null, code20: null,
      number1: null, number2: null, number3: null, number4: null,
      date1: null, date2: null, date3: null, date4: null,
      out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    const result = await connection.execute(
      `DECLARE
         v_sql VARCHAR2(32767);
       BEGIN
         PROC_BUILD_DYNAMIC_SQL_COMMON20(
           :parameter, :loginid,
           :code1,  :code2,  :code3,  :code4,  :code5,
           :code6,  :code7,  :code8,  :code9,  :code10,
           :code11, :code12, :code13, :code14, :code15,
           :code16, :code17, :code18, :code19, :code20,
           :number1, :number2, :number3, :number4,
           :date1,   :date2,   :date3,   :date4,
           v_sql
         );
         :out_sql := v_sql;
       END;`,
      binds
    );

    const rawSql = (result.outBinds as any).out_sql;
    if (!rawSql) throw new Error("Procedure did not return a valid SQL query.");
    console.log(`[${parameter}] Excel SQL:`, rawSql);

    const dataResult = await connection.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const rows = (dataResult.rows as any[]).map((row) =>
      Object.keys(row).reduce((acc: any, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );
    return { rows, connection };
  } catch (e) {
    await connection.close();
    throw e;
  }
}

// ─── Shared Excel ZIP builder ─────────────────────────────────────────────────
function buildExcelBuffer(
  tableRows: (XlCell | null)[][],
  colWidths: number[],
  sheetName: string
): Buffer {
  const colXml = colWidths.map((w, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`
  ).join("");

  // Build merges
  const merges: string[] = [];
  tableRows.forEach((row, ri) => {
    const rn = ri + 1;
    let ci = 0;
    while (ci < row.length) {
      if (row[ci] !== null) {
        let end = ci + 1;
        while (end < row.length && row[end] === null) end++;
        if (end - 1 > ci) {
          merges.push(
            String.fromCharCode(65 + ci) + rn + ":" +
            String.fromCharCode(65 + end - 1) + rn
          );
        }
        ci = end;
      } else { ci++; }
    }
  });

  let sheetDataXml = "";
  tableRows.forEach((row, ri) => {
    const rn = ri + 1;
    const ht =
      rn === 1 ? ` ht="24" customHeight="1"` :
      rn === 2 ? ` ht="20" customHeight="1"` :
      rn === 6 ? ` ht="28" customHeight="1"` : "";

    let rowXml = `<row r="${rn}"${ht}>`;
    row.forEach((cell, ci) => {
      if (cell === null) return;
      const ref = String.fromCharCode(65 + ci) + rn;
      if (typeof cell.v === "number") {
        rowXml += `<c r="${ref}" s="${cell.s}"><v>${cell.v}</v></c>`;
      } else {
        rowXml += `<c r="${ref}" s="${cell.s}" t="inlineStr"><is><t>${escapeXml(cell.v ?? "")}</t></is></c>`;
      }
    });
    rowXml += "</row>";
    sheetDataXml += rowXml;
  });

  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetViews><sheetView workbookViewId="0">` +
    `<pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/>` +
    `</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${colXml}</cols>` +
    `<sheetData>${sheetDataXml}</sheetData>` +
    mergeXml +
    `</worksheet>`;

  // ── Styles XML ────────────────────────────────────────────────────────────
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="12">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF374151"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF374151"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFC0392B"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FFC0392B"/><name val="Calibri"/></font>
  </fonts>
  <fills count="7">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF3F3F3"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE8F0FB"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF94A3B8"/></left>
      <right style="thin"><color rgb="FF94A3B8"/></right>
      <top style="thin"><color rgb="FF94A3B8"/></top>
      <bottom style="thin"><color rgb="FF94A3B8"/></bottom>
    </border>
    <border>
      <left style="medium"><color rgb="FF333333"/></left>
      <right style="medium"><color rgb="FF333333"/></right>
      <top style="medium"><color rgb="FF333333"/></top>
      <bottom style="medium"><color rgb="FF333333"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="14">
    <!-- 0: default -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <!-- 1: company (navy bg, white bold 18, centered) -->
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 2: title (white bg, dark bold 14, centered, wrap) -->
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <!-- 3: section (white bg, dark bold 11) -->
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <!-- 4: tableHead (navy bg, white bold 11, centered, wrap) -->
    <xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <!-- 5: normal data -->
    <xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="top"/>
    </xf>
    <!-- 6: numData (right-align, #,##0.000) -->
    <xf numFmtId="164" fontId="6" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1">
      <alignment horizontal="right" vertical="top"/>
    </xf>
    <!-- 7: acHeader (grey bg, dark bold 11) -->
    <xf numFmtId="0" fontId="7" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <!-- 8: acTotal text (grey bg, bold 10) -->
    <xf numFmtId="0" fontId="8" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 9: acTotal num (grey bg, bold, right-align) -->
    <xf numFmtId="164" fontId="8" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 10: grandTotal text (blue tint bg, bold 11) -->
    <xf numFmtId="0" fontId="9" fillId="6" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 11: grandTotal num (blue tint bg, bold 11, right-align) -->
    <xf numFmtId="164" fontId="9" fillId="6" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 12: negNum (red, right-align) -->
    <xf numFmtId="164" fontId="11" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1">
      <alignment horizontal="right" vertical="top"/>
    </xf>
    <!-- 13: negTotalNum (red bold, right-align, in total rows) -->
    <xf numFmtId="164" fontId="10" fillId="6" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
  </cellXfs>
  <numFmts count="1">
    <numFmt numFmtId="164" formatCode="#,##0.000"/>
  </numFmts>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`;

  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml",        Buffer.from(contentTypes));
  zip.addFile("_rels/.rels",                Buffer.from(rels));
  zip.addFile("xl/workbook.xml",            Buffer.from(workbookXml));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels));
  zip.addFile("xl/worksheets/sheet1.xml",   Buffer.from(sheetXml));
  zip.addFile("xl/styles.xml",              Buffer.from(stylesXml));
  return zip.toBuffer();
}

// ─── Shared header rows (rows 1–6) — used by SUMMARY only ─────────────────────
function buildHeaderRows(
  title: string,
  loginid: string,
  currCode: string,
  asOnDate: string,
  NCOLS: number
): (XlCell | null)[][] {
  const rows: (XlCell | null)[][] = [];

  // Row 1 — Company
  rows.push([xc("AL MADINA LOGISTICS SERVICES COMPANY", "company"), ...Array(NCOLS - 1).fill(skip)]);

  // Row 2 — Title
  rows.push([xc(title, "title"), ...Array(NCOLS - 1).fill(skip)]);

  // Row 3 — Date | User
  const mid = Math.floor(NCOLS / 2);
  rows.push([
    xc(`Date : ${formatDateStr(new Date())}`, "section"),
    ...Array(mid - 1).fill(skip),
    xc(`User : ${loginid}`, "section"),
    ...Array(NCOLS - mid - 1).fill(skip),
  ]);

  // Row 4 — Currency | As on date
  rows.push([
    xc(`Currency : ${currCode}   |   As on : ${asOnDate}`, "section"),
    ...Array(NCOLS - 1).fill(skip),
  ]);

  // Row 5 — Spacer
  rows.push(Array(NCOLS).fill(skip));

  // Row 6 — Table header
  rows.push([
    xc("Div",           "tableHead"),
    xc("Ac Code",       "tableHead"),
    xc("A/C Name",      "tableHead"),
    xc("Cr Period",     "tableHead"),
    xc("Credit Amount", "tableHead"),
    xc("Debit",         "tableHead"),
    xc("Credit",        "tableHead"),
    xc("Balance",       "tableHead"),
  ]);

  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1 ── OUTSTANDING DETAIL Excel builder  (NEW — per-customer statement blocks,
//      matching the new HTML/PDF layout: Doc Type / Doc No / Doc Date /
//      Doc Ref No / Narration / Debit / Credit / running Balance)
// ═══════════════════════════════════════════════════════════════════════════════
function buildOutstandingDetailRows(
  rows: any[],
  loginid: string,
  currCode: string,
  asOnDate: string
): (XlCell | null)[][] {
  const NCOLS = 8; // Doc Type | Doc No | Doc Date | Doc Ref No | Narration | Debit | Credit | Balance
  const tableRows: (XlCell | null)[][] = [];
  const todayStr = formatDateStr(new Date());

  // ── Group by ac_code (one statement block per customer) ──────────────────
  type DetailRow = (typeof rows)[0];
  type AcGroup = {
    ac_code: string; ac_name: string;
    address1: string; address2: string; address3: string;
    phone: string; email: string; fax: string; contact_person: string;
    cr_period: string; cr_amt: string;
    rows: DetailRow[];
  };
  const acMap = new Map<string, AcGroup>();

  rows.forEach((r) => {
    const acKey = text(r.ac_code);
    if (!acMap.has(acKey)) {
      acMap.set(acKey, {
        ac_code:        acKey,
        ac_name:        text(r.ac_name),
        address1:       text(r.address1),
        address2:       text(r.address2),
        address3:       text(r.address3),
        phone:          text(r.phone),
        email:          text(r.party_email),
        fax:            text(r.fax),
        contact_person: text(r.contact_person),
        cr_period:      text(r.cr_period),
        cr_amt:         text(r.cr_amt),
        rows:           [],
      });
    }
    acMap.get(acKey)!.rows.push(r);
  });

  const acEntries = Array.from(acMap.values());

  acEntries.forEach((ac) => {
    // ── Mini header (repeated per customer, like a new "page") ─────────────
    tableRows.push([xc("AL MADINA LOGISTICS SERVICES COMPANY", "company"), ...Array(NCOLS - 1).fill(skip)]);
    tableRows.push([xc(`Outstanding Statement as on ${asOnDate}`, "title"), ...Array(NCOLS - 1).fill(skip)]);
    tableRows.push([
      xc(`Date : ${todayStr}   |   Currency : ${currCode}   |   User : ${loginid}`, "section"),
      ...Array(NCOLS - 1).fill(skip),
    ]);
    tableRows.push(Array(NCOLS).fill(skip)); // spacer

    // ── Customer block ───────────────────────────────────────────────────
    tableRows.push([xc(`${ac.ac_code}   ${ac.ac_name}`, "acHeader"), ...Array(NCOLS - 1).fill(skip)]);

    const addressLine = [ac.address1, ac.address2, ac.address3].filter((a) => a).join(", ");
    if (addressLine) {
      tableRows.push([xc(addressLine, "normal"), ...Array(NCOLS - 1).fill(skip)]);
    }

    tableRows.push([
      xc(`Ph : ${ac.phone}   Email : ${ac.email}   Fax : ${ac.fax}`, "normal"),
      ...Array(3).fill(skip),
      xc(`Credit Period : ${ac.cr_period}`, "normal"),
      ...Array(2).fill(skip),
      xc(`Credit Amount : ${money(ac.cr_amt)}`, "normal"),
    ]);

    tableRows.push([xc(`Attn : ${ac.contact_person}`, "normal"), ...Array(NCOLS - 1).fill(skip)]);
    tableRows.push(Array(NCOLS).fill(skip)); // spacer

    // ── Table header ─────────────────────────────────────────────────────
    tableRows.push([
      xc("Doc Type",     "tableHead"),
      xc("Doc No.",      "tableHead"),
      xc("Doc Date",     "tableHead"),
      xc("Doc Ref No.",  "tableHead"),
      xc("Narration",    "tableHead"),
      xc("Debit",        "tableHead"),
      xc("Credit",       "tableHead"),
      xc("Balance",      "tableHead"),
    ]);

    // ── Transaction rows — running balance per customer ────────────────────
    let runningBalance = 0;
    ac.rows.forEach((r) => {
      const amount = num(r.amount);
      const debit  = amount > 0 ? amount : 0;
      const credit = amount < 0 ? Math.abs(amount) : 0;
      runningBalance += debit - credit;

      tableRows.push([
        xc(text(r.doc_type), "normal"),
        xc(text(r.inv_no),   "normal"),
        xc(formatDateStr(r.inv_date), "normal"),
        xc(text(r.doc_no),   "normal"),
        xc(text(r.remarks),  "normal"),
        xc(formatBalance(debit),  "numData"),
        xc(formatBalance(credit), "numData"),
        xc(formatBalance(runningBalance), runningBalance < 0 ? "negNum" : "numData"),
      ]);
    });

    if (ac.rows.length === 0) {
      tableRows.push([
        xc("No outstanding records found.", "normal"),
        ...Array(NCOLS - 1).fill(skip),
      ]);
    }

    // ── Spacer between customer blocks ─────────────────────────────────────
    tableRows.push(Array(NCOLS).fill(skip));
    tableRows.push(Array(NCOLS).fill(skip));
  });

  // ── End of report ──────────────────────────────────────────────────────
  tableRows.push([xc("End of Report", "section"), ...Array(NCOLS - 1).fill(skip)]);

  return tableRows;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2 ── OUTSTANDING SUMMARY Excel builder  (UNCHANGED)
//      Flat rows (one per ac_code) → grand total
// ═══════════════════════════════════════════════════════════════════════════════
function buildSummaryRows(
  rows: any[],
  loginid: string,
  currCode: string,
  asOnDate: string
): (XlCell | null)[][] {
  const NCOLS = 8;
  const tableRows = buildHeaderRows(
    `Outstanding Statement Summary as on ${asOnDate}`,
    loginid, currCode, asOnDate, NCOLS
  );

  let grandDebit = 0, grandCredit = 0, grandBalance = 0;

  rows.forEach((r) => {
    const amount  = num(r.amount);
    const debit   = amount > 0 ? amount : 0;
    const credit  = amount < 0 ? Math.abs(amount) : 0;
    const balance = debit - credit;

    grandDebit   += debit;
    grandCredit  += credit;
    grandBalance += balance;

    tableRows.push([
      xc(text(r.div_code),  "normal"),
      xc(text(r.ac_code),   "normal"),
      xc(text(r.ac_name),   "normal"),
      xc(text(r.cr_period), "normal"),
      xc(num(r.cr_amt),     "numData"),
      xc(formatBalance(debit),             "numData"),
      xc(formatBalance(credit),            "numData"),
      xc(formatBalance(balance),           balance < 0 ? "negNum" : "numData"),
    ]);
  });

  // Grand total
  if (rows.length > 0) {
    tableRows.push([
      xc("Total", "grandTotal"),
      ...Array(4).fill(xc("", "grandTotal")),
      xc(formatBalance(grandDebit),   "grandTotalNum"),
      xc(formatBalance(grandCredit),  "grandTotalNum"),
      xc(formatBalance(grandBalance), grandBalance < 0 ? "negTotalNum" : "grandTotalNum"),
    ]);
  }

  return tableRows;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTROLLERS
// ═══════════════════════════════════════════════════════════════════════════════

const DETAIL_COL_WIDTHS  = [10, 18, 12, 16, 32, 14, 14, 16]; // Doc Type|No|Date|Ref|Narration|Debit|Credit|Balance
const SUMMARY_COL_WIDTHS = [8, 14, 26, 10, 14, 14, 14, 16];  // Div|Ac Code|A/C Name|Cr Period|Cr Amt|Debit|Credit|Balance

// ── 1. Outstanding Detail (NEW per-customer statement format) ────────────────
export const exportOutstandingDetailExcel = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    const { loginid, code5, code6 } = req.body;
    const { rows, connection: conn } = await fetchRows(req, "Account_Report_Outstanding_Detail");
    connection = conn;

    const tableRows = buildOutstandingDetailRows(
      rows,
      text(loginid) || "ADMIN",
      text(code5) || "OMR",
      formatDateStr(code6) || text(code6)
    );
    const buffer = buildExcelBuffer(tableRows, DETAIL_COL_WIDTHS, "Outstanding Detail");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="OutstandingDetail.xlsx"`);
    res.send(buffer);
  } catch (error: any) {
    console.error("Outstanding Detail Excel Error:", error);
    res.status(500).json({ success: false, message: "Unable to generate Excel", details: error.message });
  } finally {
    if (connection) { try { await connection.close(); } catch (e) { console.error(e); } }
  }
};

// ── 2. Outstanding Summary (UNCHANGED) ────────────────────────────────────────
export const exportOutstandingSummaryExcel = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    const { loginid, code5, code6 } = req.body;
    const { rows, connection: conn } = await fetchRows(req, "Account_Report_Outstanding_Summary");
    connection = conn;

    const tableRows = buildSummaryRows(
      rows,
      text(loginid) || "ADMIN",
      text(code5) || "OMR",
      text(code6)
    );
    const buffer = buildExcelBuffer(tableRows, SUMMARY_COL_WIDTHS, "Outstanding Summary");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="OutstandingSummary.xlsx"`);
    res.send(buffer);
  } catch (error: any) {
    console.error("Outstanding Summary Excel Error:", error);
    res.status(500).json({ success: false, message: "Unable to generate Excel", details: error.message });
  } finally {
    if (connection) { try { await connection.close(); } catch (e) { console.error(e); } }
  }
};