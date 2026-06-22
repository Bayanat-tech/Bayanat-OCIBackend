import { Request, Response } from "express";
import oracledb from "oracledb";
// @ts-ignore
const AdmZip = require("adm-zip");
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const money = (v: any) => {
  const n = Number(v);
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
};
const text = (v: any) => (v == null ? "" : String(v));
const num  = (v: any) => Number(v) || 0;

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
  default:    0,
  company:    1,   // navy bg, white bold 18
  title:      2,   // white bg, dark bold 14, centered
  section:    3,   // white bg, dark bold 11
  tableHead:  4,   // navy bg, white bold 11
  normal:     5,   // normal data
  numData:    6,   // right-align number #,##0.000
  l4Header:   7,   // grey bg, bold
  acHeader:   8,   // light bg, bold italic
  subTotal:   9,   // subtotal row
  subTotalNum:10,
  l4Total:    11,  // l4 total row
  l4TotalNum: 12,
  grandTotal: 13,  // grand total row
  grandTotalNum: 14,
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
    code7, code8, code9, code10, code11, code12, code13, code14,
    code15, code16,
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
  sheetName: string,
  frozenRows = 6
): Buffer {
  const NCOLS = colWidths.length;

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

  // Build sheet data XML
  let sheetDataXml = "";
  tableRows.forEach((row, ri) => {
    const rn = ri + 1;
    const ht =
      rn === 1 ? ` ht="24" customHeight="1"` :
      rn === 2 ? ` ht="20" customHeight="1"` :
      rn === frozenRows ? ` ht="28" customHeight="1"` : "";

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
    `<pane ySplit="${frozenRows}" topLeftCell="A${frozenRows + 1}" activePane="bottomLeft" state="frozen"/>` +
    `</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${colXml}</cols>` +
    `<sheetData>${sheetDataXml}</sheetData>` +
    mergeXml +
    `</worksheet>`;

  // ── Styles XML (15 styles) ────────────────────────────────────────────────
  // Fonts: 0=default 1=company(white bold 18) 2=title(dark bold 14)
  //        3=section(dark bold 11) 4=tableHead(white bold 11) 5=normal
  //        6=numData 7=l4Header(dark bold 11) 8=acHeader(dark bold 10 italic)
  //        9=subTotal(dark bold 10) 10=l4Total(dark bold 11) 11=grandTotal(dark bold 12)
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
    <font><b/><i/><sz val="10"/><color rgb="FF185FA5"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="12"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
  </fonts>
  <fills count="8">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF3F3F3"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEEF4FB"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="4">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF94A3B8"/></left>
      <right style="thin"><color rgb="FF94A3B8"/></right>
      <top style="thin"><color rgb="FF94A3B8"/></top>
      <bottom style="thin"><color rgb="FF94A3B8"/></bottom>
    </border>
    <border>
      <left style="thin"><color rgb="FF1E3A5F"/></left>
      <right style="thin"><color rgb="FF1E3A5F"/></right>
      <top style="thin"><color rgb="FF1E3A5F"/></top>
      <bottom style="thin"><color rgb="FF1E3A5F"/></bottom>
    </border>
    <border>
      <left style="medium"><color rgb="FF555555"/></left>
      <right style="medium"><color rgb="FF555555"/></right>
      <top style="medium"><color rgb="FF555555"/></top>
      <bottom style="medium"><color rgb="FF555555"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="15">
    <!-- 0: default -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <!-- 1: company (navy bg, white bold 18, centered) -->
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 2: title (white bg, dark bold 14, centered) -->
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 3: section (white bg, dark bold 11) -->
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <!-- 4: tableHead (navy bg, white bold 11, centered, wrap) -->
    <xf numFmtId="0" fontId="4" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
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
    <!-- 7: l4Header (grey bg, dark bold 11) -->
    <xf numFmtId="0" fontId="7" fillId="5" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <!-- 8: acHeader (white bg, blue bold italic 10) -->
    <xf numFmtId="0" fontId="8" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <!-- 9: subTotal text -->
    <xf numFmtId="0" fontId="9" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <!-- 10: subTotal num -->
    <xf numFmtId="164" fontId="9" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 11: l4Total text (light grey bg, bold 11) -->
    <xf numFmtId="0" fontId="10" fillId="6" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <!-- 12: l4Total num -->
    <xf numFmtId="164" fontId="10" fillId="6" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 13: grandTotal text (blue tint bg, bold 12) -->
    <xf numFmtId="0" fontId="11" fillId="7" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <!-- 14: grandTotal num -->
    <xf numFmtId="164" fontId="11" fillId="7" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1">
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

// ─── Shared header rows builder ───────────────────────────────────────────────
function buildHeaderRows(
  title: string,
  loginid: string,
  code2: string,
  code6: string,
  code7: string,
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

  // Row 4 — As on date | Division | Date type
  rows.push([
    xc(
      `As on : ${text(code6)}   |   Division : ${text(code2) || "All"}   |   ${text(code7) === "due" ? "Due Date Wise" : "INV Date Wise"}`,
      "section"
    ),
    ...Array(NCOLS - 1).fill(skip),
  ]);

  // Row 5 — Spacer
  rows.push(Array(NCOLS).fill(skip));

  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1 & 2 ── DETAIL reports (InvDetail + DueDetail)
//          Columns: Inv No | Inv Date | Inv Amt | Un-Alloc | age×7 | Total | Salesman
// ═══════════════════════════════════════════════════════════════════════════════
const AGE_LABELS = ["Below 30", "30-60", "60-90", "90-120", "120-160", "160-200", "Above 200"];

function buildDetailExcelRows(
  rows: any[],
  loginid: string,
  code2: string,
  code6: string,
  code7: string,
  title: string
): { tableRows: (XlCell | null)[][]; colWidths: number[] } {
  // 13 columns: InvNo | InvDate | InvAmt | UnAlloc | age×7 | Total | Salesman
  const NCOLS = 13;
  const colWidths = [18, 10, 12, 12, 10, 10, 10, 10, 10, 10, 10, 12, 14];

  const tableRows = buildHeaderRows(title, loginid, code2, code6, code7, NCOLS);

  // Row 6 — Table header
  tableRows.push([
    xc("A/C Code / Inv No", "tableHead"),
    xc("Inv Date",          "tableHead"),
    xc("Inv Amount",        "tableHead"),
    xc("Un-Allocated",      "tableHead"),
    ...AGE_LABELS.map((l) => xc(l, "tableHead")),
    xc("Total",             "tableHead"),
    xc("Salesperson",       "tableHead"),
  ]);

  // Group: l4 → ac → inv rows
  type DetailRow = (typeof rows)[0];
  type AccGroup  = { ac_code: string; ac_name: string; credit_period: string; credit_amount: string; rows: DetailRow[] };
  type L4Group   = { l4_code: string; l4_description: string; accounts: Map<string, AccGroup> };

  const l4Map = new Map<string, L4Group>();
  rows.forEach((r) => {
    const l4Key = text(r.l4_code);
    if (!l4Map.has(l4Key)) l4Map.set(l4Key, { l4_code: l4Key, l4_description: text(r.l4_description), accounts: new Map() });
    const l4 = l4Map.get(l4Key)!;
    const acKey = text(r.ac_code);
    if (!l4.accounts.has(acKey)) {
      l4.accounts.set(acKey, {
        ac_code: acKey, ac_name: text(r.ac_name),
        credit_period: text(r.credit_period || ""),
        credit_amount: text(r.credit_amount || ""),
        rows: [],
      });
    }
    l4.accounts.get(acKey)!.rows.push(r);
  });

  let grandOrgAmt = 0, grandUnalloc = 0;
  let grand30 = 0, grand60 = 0, grand90 = 0, grand120 = 0, grand160 = 0, grand200 = 0, grandAbove = 0;
  let grandTotal = 0;

  l4Map.forEach((l4) => {
    // L4 header row
    tableRows.push([
      xc(`${l4.l4_code}  ${l4.l4_description}`, "l4Header"),
      ...Array(NCOLS - 1).fill(skip),
    ]);

    let l4OrgAmt = 0, l4Unalloc = 0;
    let l430 = 0, l460 = 0, l490 = 0, l4120 = 0, l4160 = 0, l4200 = 0, l4Above = 0, l4Total = 0;

    l4.accounts.forEach((ac) => {
      // AC header row
      tableRows.push([
        xc(`${ac.ac_code}  ${ac.ac_name}  |  Credit Period: ${ac.credit_period}  Credit Limit: ${ac.credit_amount}`, "acHeader"),
        ...Array(NCOLS - 1).fill(skip),
      ]);

      let acOrgAmt = 0, acUnalloc = 0;
      let ac30 = 0, ac60 = 0, ac90 = 0, ac120 = 0, ac160 = 0, ac200 = 0, acAbove = 0, acTotal = 0;

      ac.rows.forEach((r) => {
        const orgAmt   = num(r.org_amt);
        const unalloc  = num(r.un_allocated_amt);
        const a30 = num(r.age_30), a60 = num(r.age_60), a90 = num(r.age_90);
        const a120 = num(r.age_120), a160 = num(r.age_160), a200 = num(r.age_200);
        const aAbove = num(r.age_above);
        const rowTotal = a30 + a60 + a90 + a120 + a160 + a200 + aAbove;

        acOrgAmt += orgAmt; acUnalloc += unalloc;
        ac30 += a30; ac60 += a60; ac90 += a90;
        ac120 += a120; ac160 += a160; ac200 += a200; acAbove += aAbove;
        acTotal += rowTotal;

        tableRows.push([
          xc(`  ${text(r.inv_no)}`, "normal"),
          xc(formatDateStr(r.inv_date), "normal"),
          xc(formatBalance(orgAmt),   "numData"),
          xc(formatBalance(unalloc),  "numData"),
          xc(formatBalance(a30),      "numData"),
          xc(formatBalance(a60),      "numData"),
          xc(formatBalance(a90),      "numData"),
          xc(formatBalance(a120),     "numData"),
          xc(formatBalance(a160),     "numData"),
          xc(formatBalance(a200),     "numData"),
          xc(formatBalance(aAbove),   "numData"),
          xc(formatBalance(rowTotal), "numData"),
          xc(text(r.salesman_name), "normal"),
        ]);
      });

      // AC subtotal
      tableRows.push([
        xc(`Total for ${ac.ac_name}`, "subTotal"),
        xc("", "subTotal"),
        xc(formatBalance(acOrgAmt),  "subTotalNum"),
        xc(formatBalance(acUnalloc), "subTotalNum"),
        xc(formatBalance(ac30),      "subTotalNum"),
        xc(formatBalance(ac60),      "subTotalNum"),
        xc(formatBalance(ac90),      "subTotalNum"),
        xc(formatBalance(ac120),     "subTotalNum"),
        xc(formatBalance(ac160),     "subTotalNum"),
        xc(formatBalance(ac200),     "subTotalNum"),
        xc(formatBalance(acAbove),   "subTotalNum"),
        xc(formatBalance(acTotal),   "subTotalNum"),
        xc("",        "subTotal"),
      ]);

      l4OrgAmt += acOrgAmt; l4Unalloc += acUnalloc;
      l430 += ac30; l460 += ac60; l490 += ac90;
      l4120 += ac120; l4160 += ac160; l4200 += ac200; l4Above += acAbove;
      l4Total += acTotal;
    });

    // L4 total
    tableRows.push([
      xc(`Total for ${l4.l4_description}`, "l4Total"),
      xc("", "l4Total"),
      xc(formatBalance(l4OrgAmt),  "l4TotalNum"),
      xc(formatBalance(l4Unalloc), "l4TotalNum"),
      xc(formatBalance(l430),      "l4TotalNum"),
      xc(formatBalance(l460),      "l4TotalNum"),
      xc(formatBalance(l490),      "l4TotalNum"),
      xc(formatBalance(l4120),     "l4TotalNum"),
      xc(formatBalance(l4160),     "l4TotalNum"),
      xc(formatBalance(l4200),     "l4TotalNum"),
      xc(formatBalance(l4Above),   "l4TotalNum"),
      xc(formatBalance(l4Total)         ,   "l4TotalNum"),  
      xc("",        "l4Total"),
    ]);
    tableRows.push(Array(NCOLS).fill(skip)); // spacer

    grandOrgAmt += l4OrgAmt; grandUnalloc += l4Unalloc;
    grand30 += l430; grand60 += l460; grand90 += l490;
    grand120 += l4120; grand160 += l4160; grand200 += l4200; grandAbove += l4Above;
    grandTotal += l4Total;
  });

  // Grand total
  tableRows.push([
    xc("Grand Total", "grandTotal"),
    xc("", "grandTotal"),
    xc(formatBalance(grandOrgAmt),  "grandTotalNum"),
    xc(formatBalance(grandUnalloc), "grandTotalNum"),
    xc(formatBalance(grand30),      "grandTotalNum"),
    xc(formatBalance(grand60),      "grandTotalNum"),
    xc(formatBalance(grand90),      "grandTotalNum"),
    xc(formatBalance(grand120)  ,     "grandTotalNum"),
    xc(formatBalance(grand160),     "grandTotalNum"),
    xc(formatBalance(grand200),     "grandTotalNum"),
    xc(formatBalance(grandAbove),   "grandTotalNum"),
    xc(formatBalance(grandTotal),   "grandTotalNum"),
    xc("",           "grandTotal"),
  ]);

  return { tableRows, colWidths };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3 & 4 ── SUMMARY reports (InvSummary + DueSummary)
//          Columns: AC Code | Salesman | Dept | Credit Limit | Credit Period | Un-Alloc | age×7 | Total
// ═══════════════════════════════════════════════════════════════════════════════
function buildSummaryExcelRows(
  rows: any[],
  loginid: string,
  code2: string,
  code6: string,
  code7: string,
  title: string
): { tableRows: (XlCell | null)[][]; colWidths: number[] } {
  // 14 columns
  const NCOLS = 14;
  const colWidths = [22, 14, 8, 12, 10, 12, 10, 10, 10, 10, 10, 10, 10, 12];

  const tableRows = buildHeaderRows(title, loginid, code2, code6, code7, NCOLS);

  // Row 6 — Table header
  tableRows.push([
    xc("A/C Code",      "tableHead"),
    xc("Salesperson",   "tableHead"),
    xc("Dept",          "tableHead"),
    xc("Credit Limit",  "tableHead"),
    xc("Credit Period", "tableHead"),
    xc("Un-Allocated",  "tableHead"),
    ...AGE_LABELS.map((l) => xc(l, "tableHead")),
    xc("Total",         "tableHead"),
  ]);

  // Group by l4
  type SummaryRow = (typeof rows)[0];
  type L4Group = { l4_code: string; l4_description: string; rows: SummaryRow[] };
  const l4Map = new Map<string, L4Group>();
  rows.forEach((r) => {
    const l4Key = text(r.l4_code);
    if (!l4Map.has(l4Key)) l4Map.set(l4Key, { l4_code: l4Key, l4_description: text(r.l4_description), rows: [] });
    l4Map.get(l4Key)!.rows.push(r);
  });

  let grandUnalloc = 0;
  let grand30 = 0, grand60 = 0, grand90 = 0, grand120 = 0, grand160 = 0, grand200 = 0, grandAbove = 0;
  let grandTotal = 0;

  l4Map.forEach((l4) => {
    // L4 header
    tableRows.push([
      xc(`${l4.l4_code}  ${l4.l4_description}`, "l4Header"),
      ...Array(NCOLS - 1).fill(skip),
    ]);

    let l4Unalloc = 0;
    let l430 = 0, l460 = 0, l490 = 0, l4120 = 0, l4160 = 0, l4200 = 0, l4Above = 0, l4Total = 0;

    l4.rows.forEach((r) => {
      const unalloc = num(r.un_allocated_amt);
      const a30 = num(r.age_30), a60 = num(r.age_60), a90 = num(r.age_90);
      const a120 = num(r.age_120), a160 = num(r.age_160), a200 = num(r.age_200);
      const aAbove = num(r.age_above);
      const rowTotal = a30 + a60 + a90 + a120 + a160 + a200 + aAbove;

      l4Unalloc += unalloc;
      l430 += a30; l460 += a60; l490 += a90;
      l4120 += a120; l4160 += a160; l4200 += a200; l4Above += aAbove;
      l4Total += rowTotal;

      tableRows.push([
        xc(`${text(r.ac_code)}  ${text(r.ac_name)}`, "normal"),
        xc(text(r.salesman_name),  "normal"),
        xc(text(r.dept_code),      "normal"),
        xc(num(r.credit_amount),   "numData"),
        xc(text(r.credit_period),  "normal"),
        xc(formatBalance(unalloc),  "numData"),
        xc(formatBalance(a30),      "numData"),
        xc(formatBalance(a60),      "numData"),
        xc(formatBalance(a90),      "numData"),
        xc(formatBalance(a120),     "numData"),
        xc(formatBalance(a160),     "numData"),
        xc(formatBalance(a200),     "numData"),
        xc(formatBalance(aAbove),   "numData"),
        xc(formatBalance(rowTotal), "numData"),
      ]);
    });

    // L4 total
    tableRows.push([
      xc(`Total for ${l4.l4_description}`, "l4Total"),
      ...Array(4).fill(xc("", "l4Total")),
      xc(formatBalance(l4Unalloc), "l4TotalNum"),
      xc(formatBalance(l430),      "l4TotalNum"),
      xc(formatBalance(l460),      "l4TotalNum"),
      xc(formatBalance(l490),      "l4TotalNum"),
      xc(formatBalance(l4120),     "l4TotalNum"),
      xc(formatBalance(l4160),     "l4TotalNum"),
      xc(formatBalance(l4200),     "l4TotalNum"),
      xc(formatBalance(l4Above),   "l4TotalNum"),
      xc(formatBalance(l4Total)         ,   "l4TotalNum"),
    ]);
    tableRows.push(Array(NCOLS).fill(skip));

    grandUnalloc += l4Unalloc;
    grand30 += l430; grand60 += l460; grand90 += l490;
    grand120 += l4120; grand160 += l4160; grand200 += l4200; grandAbove += l4Above;
    grandTotal += l4Total;
  });

  // Grand total
  tableRows.push([
    xc("Grand Total", "grandTotal"),
    ...Array(4).fill(xc("", "grandTotal")),
    xc(formatBalance(grandUnalloc), "grandTotalNum"),
    xc(formatBalance(grand30),      "grandTotalNum"),
    xc(formatBalance(grand60),      "grandTotalNum"),
    xc(formatBalance(grand90),      "grandTotalNum"),
    xc(formatBalance(grand120),     "grandTotalNum"),
    xc(formatBalance(grand160)  ,     "grandTotalNum"),
    xc(formatBalance(grand200),     "grandTotalNum"),
    xc(formatBalance(grandAbove),   "grandTotalNum"),
    xc(formatBalance(grandTotal),   "grandTotalNum"),
  ]);

  return { tableRows, colWidths };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5 ── OUTSTANDING LIST
//      Columns: Inv No | Inv Date | Inv Amount | Un-Allocated | Inv Balance | Group
// ═══════════════════════════════════════════════════════════════════════════════
function buildOutstandingExcelRows(
  rows: any[],
  loginid: string,
  code2: string,
  code6: string
): { tableRows: (XlCell | null)[][]; colWidths: number[] } {
  const NCOLS = 6;
  const colWidths = [22, 12, 14, 14, 14, 10];

  // Header rows (no code7 date-type for outstanding)
  const tableRows: (XlCell | null)[][] = [];
  tableRows.push([xc("AL MADINA LOGISTICS SERVICES COMPANY", "company"), ...Array(NCOLS - 1).fill(skip)]);
  tableRows.push([xc("Outstanding List Report", "title"), ...Array(NCOLS - 1).fill(skip)]);
  tableRows.push([
    xc(`Date : ${formatDateStr(new Date())}`, "section"),
    xc("", "section"),
    xc(`User : ${loginid}`, "section"),
    ...Array(NCOLS - 3).fill(skip),
  ]);
  tableRows.push([
    xc(`As on : ${text(code6)}   |   Division : ${text(code2) || "All"}`, "section"),
    ...Array(NCOLS - 1).fill(skip),
  ]);
  tableRows.push(Array(NCOLS).fill(skip));

  // Table header
  tableRows.push([
    xc("A/C Code / Inv No", "tableHead"),
    xc("Inv Date",          "tableHead"),
    xc("Inv Amount",        "tableHead"),
    xc("Un-Allocated",      "tableHead"),
    xc("Inv Balance",       "tableHead"),
    xc("Group",             "tableHead"),
  ]);

  // Group: l4 → ac → inv rows
  type DetailRow = (typeof rows)[0];
  type AccGroup  = { ac_code: string; ac_name: string; rows: DetailRow[] };
  type L4Group   = { l4_code: string; l4_description: string; accounts: Map<string, AccGroup> };

  const l4Map = new Map<string, L4Group>();
  rows.forEach((r) => {
    const l4Key = text(r.l4_code);
    if (!l4Map.has(l4Key)) l4Map.set(l4Key, { l4_code: l4Key, l4_description: text(r.l4_description), accounts: new Map() });
    const l4 = l4Map.get(l4Key)!;
    const acKey = text(r.ac_code);
    if (!l4.accounts.has(acKey)) {
      l4.accounts.set(acKey, { ac_code: acKey, ac_name: text(r.ac_name), rows: [] });
    }
    l4.accounts.get(acKey)!.rows.push(r);
  });

  let grandUnalloc = 0, grandBalance = 0;

  l4Map.forEach((l4) => {
    tableRows.push([
      xc(`${l4.l4_code}  ${l4.l4_description}`, "l4Header"),
      ...Array(NCOLS - 1).fill(skip),
    ]);

    let l4Unalloc = 0, l4Balance = 0;

    l4.accounts.forEach((ac) => {
      tableRows.push([
        xc(`${ac.ac_code}  ${ac.ac_name}`, "acHeader"),
        ...Array(NCOLS - 1).fill(skip),
      ]);

      let acUnalloc = 0, acBalance = 0;

      ac.rows.forEach((r) => {
        const orgAmt  = num(r.org_amt);
        const unalloc = num(r.un_allocated_amt);
        const balance = num(r.balance_amount);
        acUnalloc += unalloc;
        acBalance += balance;

        tableRows.push([
          xc(`  ${text(r.inv_no)}`,         "normal"),
          xc(formatDateStr(r.inv_date),     "normal"),
          xc(formatBalance(orgAmt),                        "numData"),
          xc(formatBalance(unalloc),                       "numData"),
          xc(formatBalance(balance),                       "numData"),
          xc("",                            "normal"),
        ]);
      });

      // AC subtotal
      tableRows.push([
        xc(`Total for ${ac.ac_name}`, "subTotal"),
        xc("",                        "subTotal"),
        xc("",                        "subTotal"),
        xc(formatBalance(acUnalloc),                 "subTotalNum"),
        xc(formatBalance(acBalance),                 "subTotalNum"),
        xc("",                        "subTotal"),
      ]);

      l4Unalloc += acUnalloc;
      l4Balance += acBalance;
    });

    // L4 total
    tableRows.push([
      xc(`Total for ${l4.l4_description}`, "l4Total"),
      xc("", "l4Total"),
      xc("", "l4Total"),
      xc(formatBalance(l4Unalloc), "l4TotalNum"),
      xc(formatBalance(l4Balance), "l4TotalNum"),
      xc("",        "l4Total"),
    ]);
    tableRows.push(Array(NCOLS).fill(skip));

    grandUnalloc += l4Unalloc;
    grandBalance += l4Balance;
  });

  // Grand total
  tableRows.push([
    xc("Grand Total", "grandTotal"),
    xc("",            "grandTotal"),
    xc("",            "grandTotal"),
    xc(formatBalance(grandUnalloc),  "grandTotalNum"),
    xc(formatBalance(grandBalance),  "grandTotalNum"),
    xc("",            "grandTotal"),
  ]);

  return { tableRows, colWidths };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTROLLERS
// ═════════════════════════════════════════════════════════════════════════════════    

// ── 1. INV Date Wise Detail ───────────────────────────────────────────────────
export const exportInvDetailExcel = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    const { loginid, code2, code6, code7 } = req.body;
    const { rows, connection: conn } = await fetchRows(req, "Account_Report_VW_PERIODWISE_INV_DETAIL");
    connection = conn;

    const { tableRows, colWidths } = buildDetailExcelRows(
      rows, text(loginid) || "ADMIN", text(code2), text(code6), text(code7),
      "Period Wise Ageing — INV Date Wise Detail"
    );
    const buffer = buildExcelBuffer(tableRows, colWidths, "INV Detail");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="PeriodWise_InvDetail.xlsx"`);
    res.send(buffer);
  } catch (error: any) {
    console.error("InvDetail Excel Error:", error);
    res.status(500).json({ success: false, message: "Unable to generate Excel", details: error.message });
  } finally {
    if (connection) { try { await connection.close(); } catch (e) { console.error(e); } }
  }
};

// ── 2. INV Date Wise Summary ──────────────────────────────────────────────────
export const exportInvSummaryExcel = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    const { loginid, code2, code6, code7 } = req.body;
    const { rows, connection: conn } = await fetchRows(req, "Account_Report_VW_PERIODWISE_INV_SUMMARY");
    connection = conn;

    const { tableRows, colWidths } = buildSummaryExcelRows(
      rows, text(loginid) || "ADMIN", text(code2), text(code6), text(code7),
      "Period Wise Ageing — INV Date Wise Summary"
    );
    const buffer = buildExcelBuffer(tableRows, colWidths, "INV Summary");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="PeriodWise_InvSummary.xlsx"`);
    res.send(buffer);
  } catch (error: any) {
    console.error("InvSummary Excel Error:", error);
    res.status(500).json({ success: false, message: "Unable to generate Excel", details: error.message });
  } finally {
    if (connection) { try { await connection.close(); } catch (e) { console.error(e); } }
  }
};

// ── 3. Due Date Wise Detail ───────────────────────────────────────────────────
export const exportDueDetailExcel = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    const { loginid, code2, code6, code7 } = req.body;
    const { rows, connection: conn } = await fetchRows(req, "Account_Report_VW_PERIODWISE_DUEDATE_DETAIL");
    connection = conn;

    const { tableRows, colWidths } = buildDetailExcelRows(
      rows, text(loginid) || "ADMIN", text(code2), text(code6), text(code7),
      "Period Wise Ageing — Due Date Wise Detail"
    );
    const buffer = buildExcelBuffer(tableRows, colWidths, "Due Detail");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="PeriodWise_DueDetail.xlsx"`);
    res.send(buffer);
  } catch (error: any) {
    console.error("DueDetail Excel Error:", error);
    res.status(500).json({ success: false, message: "Unable to generate Excel", details: error.message });
  } finally {
    if (connection) { try { await connection.close(); } catch (e) { console.error(e); } }
  }
};

// ── 4. Due Date Wise Summary ──────────────────────────────────────────────────
export const exportDueSummaryExcel = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    const { loginid, code2, code6, code7 } = req.body;
    const { rows, connection: conn } = await fetchRows(req, "Account_Report_VW_PERIODWISE_DUEDATE_SUMMARY");
    connection = conn;

    const { tableRows, colWidths } = buildSummaryExcelRows(
      rows, text(loginid) || "ADMIN", text(code2), text(code6), text(code7),
      "Period Wise Ageing — Due Date Wise Summary"
    );
    const buffer = buildExcelBuffer(tableRows, colWidths, "Due Summary");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="PeriodWise_DueSummary.xlsx"`);
    res.send(buffer);
  } catch (error: any) {
    console.error("DueSummary Excel Error:", error);
    res.status(500).json({ success: false, message: "Unable to generate Excel", details: error.message });
  } finally {
    if (connection) { try { await connection.close(); } catch (e) { console.error(e); } }
  }
};

// ── 5. Outstanding List ───────────────────────────────────────────────────────
export const exportOutstandingListExcel = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    const { loginid, code2, code6 } = req.body;
    const { rows, connection: conn } = await fetchRows(req, "Account_Report_VW_PERIODWISE_OUTSTD_LIST");
    connection = conn;

    const { tableRows, colWidths } = buildOutstandingExcelRows(
      rows, text(loginid) || "ADMIN", text(code2), text(code6)
    );
    const buffer = buildExcelBuffer(tableRows, colWidths, "Outstanding List");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="PeriodWise_OutstandingList.xlsx"`);
    res.send(buffer);
  } catch (error: any) {
    console.error("OutstandingList Excel Error:", error);
    res.status(500).json({ success: false, message: "Unable to generate Excel", details: error.message });
  } finally {
    if (connection) { try { await connection.close(); } catch (e) { console.error(e); } }
  }
};