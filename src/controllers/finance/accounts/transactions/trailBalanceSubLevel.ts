import { Response } from "express";
import oracledb from "oracledb";
import * as XLSX from "xlsx";
const AdmZip = require("adm-zip");
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../../interfaces/common.interface";
import {
  reportHeader,
  reportFooter,
  buildReportDocument,
} from "../../../common/report_common"; // adjust path to your shared report helpers module

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

// ─── DB Helpers ───────────────────────────────────────────────────────────────

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid)
    tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenantId)
    throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
  return TenantManager.getConnection(tenantId);
}

async function closeConn(conn?: oracledb.Connection) {
  if (conn)
    try { await conn.close(); } catch (e) { console.warn("Close conn error:", e); }
}

function normalize(rows: any[] = []): ReportRow[] {
  return rows.map((row) =>
    Object.keys(row).reduce((acc: ReportRow, key) => {
      acc[key.toLowerCase()] = row[key];
      return acc;
    }, {}),
  );
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function amount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmtNumber(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
  return n < 0 ? `(${formatted})` : formatted;
}

function dateText(value: unknown): string {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value).substring(0, 10);
  return date.toLocaleDateString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function escapeHtml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeXml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── Request Param Parser ─────────────────────────────────────────────────────

function parseCommon(req: RequestWithUser) {
  const companyCode  = text(req.body.company_code  || req.user?.company_code);
  const fromDate     = text(req.body.from_date);
  const toDate       = text(req.body.to_date);
  const divisionCode = text(req.body.division_code || "All");

  if (!companyCode || !fromDate || !toDate)
    throw Object.assign(
      new Error("company_code, from_date, and to_date are required"),
      { status: 400 },
    );

  return { companyCode, fromDate, toDate, divisionCode };
}

function parseCodeArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string" && raw.trim()) return raw.split(",").map(s => s.trim()).filter(Boolean);
  return [];
}

// ─── Excel Builder (shared for all drill levels) ──────────────────────────────

const excelStyles = {
  title: {
    font: { bold: true, sz: 13, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "1A5F4A" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: {
      top:    { style: "thin", color: { rgb: "1A5F4A" } },
      bottom: { style: "thin", color: { rgb: "1A5F4A" } },
      left:   { style: "thin", color: { rgb: "1A5F4A" } },
      right:  { style: "thin", color: { rgb: "1A5F4A" } },
    },
  },
  meta: {
    font: { bold: true, sz: 10, color: { rgb: "000000" } },
    alignment: { vertical: "center" },
  },
  tableHead: {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "1A5F4A" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: {
      top:    { style: "thin", color: { rgb: "1A5F4A" } },
      bottom: { style: "thin", color: { rgb: "1A5F4A" } },
      left:   { style: "thin", color: { rgb: "1A5F4A" } },
      right:  { style: "thin", color: { rgb: "1A5F4A" } },
    },
  },
  normal: {
    alignment: { vertical: "top", wrapText: true },
    border: { bottom: { style: "thin", color: { rgb: "E2E8F0" } } },
  },
  number: {
    alignment: { horizontal: "right", vertical: "top" },
    numFmt: "#,##0.000",
    border: { bottom: { style: "thin", color: { rgb: "E2E8F0" } } },
  },
  totalLabel: {
    font: { bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "F8F8F8" } },
    border: {
      top:    { style: "medium", color: { rgb: "000000" } },
      bottom: { style: "medium", color: { rgb: "000000" } },
      left:   { style: "medium", color: { rgb: "000000" } },
      right:  { style: "medium", color: { rgb: "000000" } },
    },
  },
  totalNumber: {
    font: { bold: true },
    fill: { fgColor: { rgb: "F8F8F8" } },
    alignment: { horizontal: "right" },
    numFmt: "#,##0.000",
    border: {
      top:    { style: "medium", color: { rgb: "000000" } },
      bottom: { style: "medium", color: { rgb: "000000" } },
      left:   { style: "medium", color: { rgb: "000000" } },
      right:  { style: "medium", color: { rgb: "000000" } },
    },
  },
};

const styleIdBySignature = new Map<string, number>([
  [JSON.stringify(excelStyles.title),       1],
  [JSON.stringify(excelStyles.meta),        2],
  [JSON.stringify(excelStyles.tableHead),   3],
  [JSON.stringify(excelStyles.normal),      4],
  [JSON.stringify(excelStyles.number),      5],
  [JSON.stringify(excelStyles.totalLabel),  6],
  [JSON.stringify(excelStyles.totalNumber), 7],
]);

function applyStyle(ws: XLSX.WorkSheet, row: number, col: number, style: Record<string, unknown>) {
  const ref = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
  if (!ws[ref]) ws[ref] = { t: "s", v: "" };
  (ws[ref] as any).s = style;
}

function styleRange(ws: XLSX.WorkSheet, row: number, startCol: number, endCol: number, style: Record<string, unknown>) {
  for (let col = startCol; col <= endCol; col++) applyStyle(ws, row, col, style);
}

/**
 * Builds a standard 6-column summary Excel sheet (code, name, opening, debit, credit, amount).
 * Used for L2, L3, L4, and AC drill levels.
 */
function buildSummaryExcel(
  rows:       ReportRow[],
  codeField:  string,
  codeHeader: string,
  sheetTitle: string,
  loginId:    string,
): Buffer {
  const totals = rows.reduce(
    (acc, r) => ({
      opening: acc.opening + amount(r.opening),
      debit:   acc.debit   + amount(r.debit_amount),
      credit:  acc.credit  + amount(r.credit_amount),
      amount:  acc.amount  + amount(r.amount),
    }),
    { opening: 0, debit: 0, credit: 0, amount: 0 },
  );

  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const sheetRows: any[][] = [
    ["al madina LOGISTICS - Trial Balance Drill-Down", "", "", "", "", ""],
    [],
    ["Title :",  sheetTitle,    "", "", "", ""],
    ["Date :",   printDateTime, "", "", "", ""],
    ["User :",   loginId,       "", "", "", ""],
    [],
    [codeHeader, "Account Name", "Opening", "Debit Amount", "Credit Amount", "Amount"],
  ];

  const dataStartRow = sheetRows.length + 1;
  rows.forEach(r => {
    sheetRows.push([
      text(r[codeField]),
      text(r.ac_name),
      amount(r.opening),
      amount(r.debit_amount),
      amount(r.credit_amount),
      amount(r.amount),
    ]);
  });

  if (!rows.length) sheetRows.push(["", "No data found", "", "", "", ""]);

  const totalRowIndex = sheetRows.length + 1;
  sheetRows.push(["", "", totals.opening, totals.debit, totals.credit, totals.amount]);

  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  ws["!cols"] = [{ wch: 12 }, { wch: 40 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
    { s: { r: 2, c: 1 }, e: { r: 2, c: 5 } },
    { s: { r: 3, c: 1 }, e: { r: 3, c: 5 } },
    { s: { r: 4, c: 1 }, e: { r: 4, c: 5 } },
    { s: { r: totalRowIndex - 1, c: 0 }, e: { r: totalRowIndex - 1, c: 1 } },
  ];

  styleRange(ws, 1, 1, 6, excelStyles.title);
  styleRange(ws, 3, 1, 2, excelStyles.meta);
  styleRange(ws, 4, 1, 2, excelStyles.meta);
  styleRange(ws, 5, 1, 2, excelStyles.meta);
  styleRange(ws, 7, 1, 6, excelStyles.tableHead);

  for (let r = dataStartRow; r < dataStartRow + Math.max(rows.length, 1); r++) {
    styleRange(ws, r, 1, 2, excelStyles.normal);
    styleRange(ws, r, 3, 6, excelStyles.number);
  }
  styleRange(ws, totalRowIndex, 1, 2, excelStyles.totalLabel);
  styleRange(ws, totalRowIndex, 3, 6, excelStyles.totalNumber);

  return buildXlsxBuffer(ws, "Drill-Down");
}

/**
 * Builds a detail-level Excel sheet (transaction ledger per account).
 */
function buildDetailExcel(
  rows:      ReportRow[],
  sheetTitle: string,
  loginId:   string,
): Buffer {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const headers = ["A/C Code", "Type", "Doc No.", "Doc Date", "Chq No.", "Chq Date", "Bank", "Debit", "Credit", "Balance"];

  const sheetRows: any[][] = [
    ["al madina LOGISTICS - Account Ledger", "", "", "", "", "", "", "", "", ""],
    [],
    ["Title :", sheetTitle, "", "", "", "", "", "", "", ""],
    ["Date :",  printDateTime, "", "", "", "", "", "", "", ""],
    ["User :",  loginId, "", "", "", "", "", "", "", ""],
    [],
    headers,
  ];

  const dataStartRow = sheetRows.length + 1;

  const grouped = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const key = text(r.ac_code);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  let grandDebit = 0;
  let grandCredit = 0;

  for (const [acCode, acRows] of grouped) {
    const acName    = text(acRows[0]?.ac_name);
    let   runBalance = 0;
    let   acDebit   = 0;
    let   acCredit  = 0;

    sheetRows.push([`${acCode} — ${acName}`, "", "", "", "", "", "", "", "", ""]);

    for (const r of acRows) {
      const debit  = amount(r.sign_ind) >= 0 ? Math.abs(amount(r.lcur_amount)) : 0;
      const credit = amount(r.sign_ind) < 0  ? Math.abs(amount(r.lcur_amount)) : 0;
      runBalance  += debit - credit;
      acDebit     += debit;
      acCredit    += credit;

      sheetRows.push([
        text(r.ac_code),
        text(r.doc_type),
        text(r.doc_no ?? ""),
        dateText(r.doc_date),
        text(r.cheque_no ?? ""),
        dateText(r.cheque_date),
        text(r.bank_ac_name ?? ""),
        debit  > 0 ? debit  : "",
        credit > 0 ? credit : "",
        runBalance,
      ]);
    }

    grandDebit  += acDebit;
    grandCredit += acCredit;

    sheetRows.push([`Total — ${acName}`, "", "", "", "", "", "", acDebit, acCredit, runBalance]);
    sheetRows.push([]);
  }

  if (!rows.length) sheetRows.push(["No transactions found", "", "", "", "", "", "", "", "", ""]);

  sheetRows.push(["Grand Total", "", "", "", "", "", "", grandDebit, grandCredit, ""]);

  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  ws["!cols"] = [
    { wch: 14 }, { wch: 8 }, { wch: 10 }, { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
  ];

  styleRange(ws, 1, 1, 10, excelStyles.title);
  styleRange(ws, 3, 1, 2, excelStyles.meta);
  styleRange(ws, 4, 1, 2, excelStyles.meta);
  styleRange(ws, 5, 1, 2, excelStyles.meta);
  styleRange(ws, 7, 1, 10, excelStyles.tableHead);

  for (let r = dataStartRow; r <= sheetRows.length; r++) {
    styleRange(ws, r, 8, 10, excelStyles.number);
  }

  return buildXlsxBuffer(ws, "Ledger Detail");
}

function buildXlsxBuffer(ws: XLSX.WorkSheet, sheetName: string): Buffer {
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");

  const getStyleId = (cell: XLSX.CellObject | undefined) => {
    const style = (cell as any)?.s;
    if (!style) return 0;
    return styleIdBySignature.get(JSON.stringify(style)) || 0;
  };

  const colXml = (ws["!cols"] || [])
    .map((col: any, i: number) =>
      `<col min="${i + 1}" max="${i + 1}" width="${Number(col.wch || 12)}" customWidth="1"/>`)
    .join("");

  let sheetData = "";
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const ref     = XLSX.utils.encode_cell({ r, c });
      const cell    = ws[ref] as XLSX.CellObject | undefined;
      const styleId = getStyleId(cell);
      if (!cell && !styleId) continue;
      const attrs = `r="${ref}"${styleId ? ` s="${styleId}"` : ""}`;
      const value = cell?.v;
      if (typeof value === "number") {
        cells.push(`<c ${attrs}><v>${value}</v></c>`);
      } else {
        cells.push(`<c ${attrs} t="inlineStr"><is><t>${escapeXml(value ?? "")}</t></is></c>`);
      }
    }
    if (cells.length) {
      sheetData += `<row r="${r + 1}">${cells.join("")}</row>`;
    }
  }

  const merges  = (ws["!merges"] || [])
    .map(m => `<mergeCell ref="${XLSX.utils.encode_range(m)}"/>`)
    .join("");
  const mergeXml = merges
    ? `<mergeCells count="${(ws["!merges"] || []).length}">${merges}</mergeCells>`
    : "";

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colXml}</cols>
  <sheetData>${sheetData}</sheetData>
  ${mergeXml}
</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.000"/></numFmts>
  <fonts count="5">
    <font><sz val="10"/><name val="Arial"/></font>
    <font><b/><sz val="13"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF000000"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Arial"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1A5F4A"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8F8F8"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="4">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF1A5F4A"/></left><right style="thin"><color rgb="FF1A5F4A"/></right>
      <top style="thin"><color rgb="FF1A5F4A"/></top><bottom style="thin"><color rgb="FF1A5F4A"/></bottom>
      <diagonal/>
    </border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>
    <border>
      <left style="medium"><color rgb="FF000000"/></left><right style="medium"><color rgb="FF000000"/></right>
      <top style="medium"><color rgb="FF000000"/></top><bottom style="medium"><color rgb="FF000000"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="8">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="0" fontId="4" fillId="3" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="164" fontId="4" fillId="3" borderId="3" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const safeName = sheetName.replace(/[\\/?*[\]]/g, "_").substring(0, 31);

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(safeName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml",        Buffer.from(contentTypes));
  zip.addFile("_rels/.rels",                Buffer.from(rels));
  zip.addFile("xl/workbook.xml",            Buffer.from(workbookXml));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels));
  zip.addFile("xl/worksheets/sheet1.xml",   Buffer.from(sheetXml));
  zip.addFile("xl/styles.xml",              Buffer.from(stylesXml));
  return zip.toBuffer();
}

// ─── Shared HTML helpers (common header / footer / CSS) ───────────────────────

/** Extra CSS specific to trial-balance drill-down */
const DRILLDOWN_EXTRA_CSS = `
  .report-title-block {
    margin: 0 0 10px 0;
  }
  .report-title {
    font-size: 14px;
    font-weight: 800;
    color: #0f172a;
    margin: 0 0 4px 0;
  }
  .report-meta {
    font-size: 10.5px;
    color: #334155;
    margin: 0 0 2px 0;
  }
  .report-meta strong {
    font-weight: 700;
    color: #0f172a;
  }
  .drill-hint {
    font-size: 10px;
    color: #0b4ca1;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 4px;
    padding: 4px 10px;
    margin: 8px 0 6px 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  table.data-table th.right { text-align: right; }
  table.data-table td.mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10px;
  }
  table.data-table tr.total-row td {
    border-top: 2px solid #0f172a;
    border-bottom: 2px solid #0f172a;
    font-weight: 700;
    background: #f8fafc;
  }
  table.data-table tr.total-row td.empty {
    border: 1px solid #e2e8f0;
    background: #fff;
  }
  table.data-table tr.group-header td {
    background: #f1f5f9;
    font-weight: 700;
  }
  .balance-pos { color: #0f172a; }
  .balance-neg { color: #c0392b; }
  .end-of-report {
    text-align: center;
    margin-top: 12px;
    margin-bottom: 6px;
    font-size: 11px;
    border-top: 1px solid #e2e8f0;
    padding-top: 6px;
    color: #64748b;
  }
  @media print {
    .drill-hint { display: none !important; }
  }
`;

type DrillLevel = "l3" | "l4" | "ac" | "detail" | null;

const CODE_FIELD_MAP: Record<string, string> = {
  l3:     "l2_code",
  l4:     "l3_code",
  ac:     "l4_code",
  detail: "ac_code",
};

function buildDrillScript(
  drillLevel: DrillLevel,
  companyCode: string,
  fromDate: string,
  toDate: string,
  divisionCode: string,
): string {
  if (!drillLevel) return "";
  return `
  <script>
    (function () {
      var DRILL_LEVEL   = ${JSON.stringify(drillLevel)};
      var COMPANY_CODE  = ${JSON.stringify(companyCode)};
      var FROM_DATE     = ${JSON.stringify(fromDate)};
      var TO_DATE       = ${JSON.stringify(toDate)};
      var DIVISION_CODE = ${JSON.stringify(divisionCode)};
      var CODE_FIELD    = ${JSON.stringify(CODE_FIELD_MAP[drillLevel] ?? "")};

      document.querySelectorAll("tbody tr[data-code]").forEach(function (tr) {
        tr.style.cursor = "pointer";
        tr.addEventListener("mouseenter", function () { tr.style.background = "#eff6ff"; });
        tr.addEventListener("mouseleave", function () { tr.style.background = ""; });
        tr.addEventListener("click", function () {
          var code = tr.getAttribute("data-code");
          window.parent.postMessage({
            type:          "DRILL_DOWN",
            drillLevel:    DRILL_LEVEL,
            company_code:  COMPANY_CODE,
            from_date:     FROM_DATE,
            to_date:       TO_DATE,
            division_code: DIVISION_CODE,
            code:          code,
            codeField:     CODE_FIELD,
          }, "*");
        });
      });
    })();
  </script>`;
}

/**
 * Builds the report body: title block + optional drill hint + table + end marker.
 */
function buildBodyHtml(opts: {
  title: string;
  fromDate: string;
  toDate: string;
  username: string;
  tableHtml: string;
  drillLevel: DrillLevel;
}): string {
  const { title, tableHtml, drillLevel } = opts;
  const drillHint = drillLevel
    ? `<div class="drill-hint no-print">
         <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
         Click any row to drill down
       </div>`
    : "";

  return `
    <div class="report-title-block">
      <div class="report-title">${escapeHtml(title)}</div>
    </div>
    ${drillHint}
    ${tableHtml}
  `;
}

/**
 * Assembles full HTML document using common header, footer, and CSS.
 */
async function buildDrilldownPage(opts: {
  req: RequestWithUser;
  title: string;
  reportName: string;
  tableHtml: string;
  drillLevel: DrillLevel;
  companyCode: string;
  fromDate: string;
  toDate: string;
  divisionCode: string;
}): Promise<string> {
  const {
    req, title, reportName, tableHtml, drillLevel,
    companyCode, fromDate, toDate, divisionCode,
  } = opts;

  const username = req.user?.loginid ?? "";
  const headerHtml = await reportHeader({ company_code: companyCode, req });
  const footerHtml = reportFooter({
    reportName,
    userName: username,
    endLabel: "End of report",
  });
  const bodyHtml =
    buildBodyHtml({ title, fromDate, toDate, username, tableHtml, drillLevel }) +
    buildDrillScript(drillLevel, companyCode, fromDate, toDate, divisionCode);

  return buildReportDocument({
    title,
    headerHtml,
    bodyHtml,
    footerHtml,
    extraCss: DRILLDOWN_EXTRA_CSS,
    showPrintButton: true,
  });
}

function sendHtml(res: Response, html: string) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
}

function sendExcel(res: Response, buffer: Buffer, filename: string) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.end(buffer);
}

// ─── Summary table builder (L2 / L3 / L4 / AC) ────────────────────────────────

function buildSummaryTableHtml(
  rows: ReportRow[],
  codeField: string,
  codeHeader: string,
  codeWidth: string,
): string {
  const totals = rows.reduce(
    (acc, r) => ({
      opening: acc.opening + amount(r.opening),
      debit:   acc.debit   + amount(r.debit_amount),
      credit:  acc.credit  + amount(r.credit_amount),
      amount:  acc.amount  + amount(r.amount),
    }),
    { opening: 0, debit: 0, credit: 0, amount: 0 },
  );

  const dataRows =
    rows
      .map(
        (r) => `
      <tr data-code="${escapeHtml(r[codeField])}">
        <td class="center">${escapeHtml(r[codeField])}</td>
        <td class="left">${escapeHtml(r.ac_name)}</td>
        <td class="num">${escapeHtml(fmtNumber(amount(r.opening)))}</td>
        <td class="num">${escapeHtml(fmtNumber(amount(r.debit_amount)))}</td>
        <td class="num">${escapeHtml(fmtNumber(amount(r.credit_amount)))}</td>
        <td class="num">${escapeHtml(fmtNumber(amount(r.amount)))}</td>
      </tr>`,
      )
      .join("") ||
    `<tr><td colspan="6" class="center muted">No data found</td></tr>`;

  return `
    <table class="data-table">
      <thead>
        <tr>
          <th style="width:${codeWidth}">${escapeHtml(codeHeader)}</th>
          <th>Account Name</th>
          <th class="right">Opening</th>
          <th class="right">Debit Amount</th>
          <th class="right">Credit Amount</th>
          <th class="right">Amount</th>
        </tr>
      </thead>
      <tbody>${dataRows}</tbody>
      <tfoot>
        <tr class="total-row">
          <td class="empty" colspan="2"></td>
          <td class="num">${escapeHtml(fmtNumber(totals.opening))}</td>
          <td class="num">${escapeHtml(fmtNumber(totals.debit))}</td>
          <td class="num">${escapeHtml(fmtNumber(totals.credit))}</td>
          <td class="num">${escapeHtml(fmtNumber(totals.amount))}</td>
        </tr>
      </tfoot>
    </table>`;
}

// ─── L2 Drilldown ─────────────────────────────────────────────────────────────

export const getDrilldownL2 = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { companyCode, fromDate, toDate, divisionCode } = parseCommon(req);
    const l2Codes = parseCodeArray(req.body.l2_code);
    const codeIn  = l2Codes.length
      ? l2Codes.map(c => `'${c.replace(/'/g, "''")}'`).join(",")
      : "'All'";

    const sql = `
      SELECT
        TR_AC_DETAIL.company_code,
        max(l2_description)        ac_name,
        ms_ac_l2.l2_code,
        00000000000.000000         opening,
        nvl(sum(amount * ex_rate * sign_ind), 0)                              amount,
        nvl(sum(CASE WHEN sign_ind < 0 THEN amount * ex_rate ELSE 0 END), 0)  credit_amount,
        nvl(sum(CASE WHEN sign_ind >= 0 THEN amount * ex_rate ELSE 0 END), 0) debit_amount
      FROM TR_AC_DETAIL, ms_ac_l2
      WHERE TR_AC_DETAIL.company_code = ms_ac_l2.company_code
        AND substr(ac_code, 1, 1)     = ms_ac_l2.l2_code
        AND TR_AC_DETAIL.company_code = :companyCode
        AND TR_AC_DETAIL.doc_date    >= TO_DATE(:fromDate, 'YYYY-MM-DD')
        AND TR_AC_DETAIL.doc_date    <  TO_DATE(:toDate,   'YYYY-MM-DD')
        AND ('All' IN (${codeIn}) OR ms_ac_l2.l2_code IN (${codeIn}))
        AND TR_AC_DETAIL.cancelled   <> 'Y'
        AND ('All' = :divisionCode OR TR_AC_DETAIL.div_code = :divisionCode)
      GROUP BY TR_AC_DETAIL.company_code, ms_ac_l2.l2_code
      ORDER BY ms_ac_l2.l2_code
    `;

    conn = await getConn(req);
    const result = await conn.execute(sql,
      { companyCode, fromDate, toDate, divisionCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const rows = normalize(result.rows as any[]);

    const tableHtml = buildSummaryTableHtml(rows, "l2_code", "L2 Code", "70px");
    const title = `L2 Trial Balance  |  ${dateText(fromDate)} – ${dateText(toDate)}`;
    const html = await buildDrilldownPage({
      req, title, reportName: "rpt_drilldown_l2_trialbalance", tableHtml,
      drillLevel: "l3", companyCode, fromDate, toDate, divisionCode,
    });
    sendHtml(res, html);
  } catch (error: any) {
    console.error("Drilldown L2 error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  } finally {
    await closeConn(conn);
  }
};

export const getDrilldownL2Excel = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { companyCode, fromDate, toDate, divisionCode } = parseCommon(req);
    const l2Codes = parseCodeArray(req.body.l2_code);
    const codeIn  = l2Codes.length ? l2Codes.map(c => `'${c.replace(/'/g, "''")}'`).join(",") : "'All'";

    const sql = `
      SELECT TR_AC_DETAIL.company_code, max(l2_description) ac_name, ms_ac_l2.l2_code,
        00000000000.000000 opening,
        nvl(sum(amount * ex_rate * sign_ind), 0) amount,
        nvl(sum(CASE WHEN sign_ind < 0 THEN amount * ex_rate ELSE 0 END), 0) credit_amount,
        nvl(sum(CASE WHEN sign_ind >= 0 THEN amount * ex_rate ELSE 0 END), 0) debit_amount
      FROM TR_AC_DETAIL, ms_ac_l2
      WHERE TR_AC_DETAIL.company_code = ms_ac_l2.company_code
        AND substr(ac_code, 1, 1) = ms_ac_l2.l2_code
        AND TR_AC_DETAIL.company_code = :companyCode
        AND TR_AC_DETAIL.doc_date >= TO_DATE(:fromDate, 'YYYY-MM-DD')
        AND TR_AC_DETAIL.doc_date <  TO_DATE(:toDate,   'YYYY-MM-DD')
        AND ('All' IN (${codeIn}) OR ms_ac_l2.l2_code IN (${codeIn}))
        AND TR_AC_DETAIL.cancelled <> 'Y'
        AND ('All' = :divisionCode OR TR_AC_DETAIL.div_code = :divisionCode)
      GROUP BY TR_AC_DETAIL.company_code, ms_ac_l2.l2_code ORDER BY ms_ac_l2.l2_code`;

    conn = await getConn(req);
    const result = await conn.execute(sql, { companyCode, fromDate, toDate, divisionCode }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const rows = normalize(result.rows as any[]);
    const title = `L2 Trial Balance | ${dateText(fromDate)} – ${dateText(toDate)}`;
    const buffer = buildSummaryExcel(rows, "l2_code", "L2 Code", title, req.user?.loginid ?? "");
    sendExcel(res, buffer, `drilldown_l2_${companyCode}_${fromDate}_${toDate}.xlsx`);
  } catch (error: any) {
    console.error("Drilldown L2 Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  } finally {
    await closeConn(conn);
  }
};

// ─── L3 Drilldown ─────────────────────────────────────────────────────────────

export const getDrilldownL3 = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { companyCode, fromDate, toDate, divisionCode } = parseCommon(req);
    const l2Codes = parseCodeArray(req.body.l2_code);
    const codeIn  = l2Codes.length ? l2Codes.map(c => `'${c.replace(/'/g, "''")}'`).join(",") : "'All'";

    const sql = `
      SELECT TR_AC_DETAIL.company_code,
        sum(amount * ex_rate * sign_ind) amount,
        ms_ac_l3.l3_code,
        max(l3_description) ac_name,
        00000000000.000000 opening,
        sum(CASE WHEN sign_ind > 0 THEN amount * ex_rate ELSE 0 END) debit_amount,
        sum(CASE WHEN sign_ind < 0 THEN amount * ex_rate ELSE 0 END) credit_amount
      FROM TR_AC_DETAIL, ms_ac_l3
      WHERE TR_AC_DETAIL.company_code = ms_ac_l3.company_code
        AND substr(ac_code, 1, 3)     = ms_ac_l3.l3_code
        AND TR_AC_DETAIL.company_code = :companyCode
        AND TR_AC_DETAIL.doc_date    >= TO_DATE(:fromDate, 'YYYY-MM-DD')
        AND TR_AC_DETAIL.doc_date    <  TO_DATE(:toDate,   'YYYY-MM-DD')
        AND ('All' IN (${codeIn}) OR substr(ms_ac_l3.l3_code, 1, 1) IN (${codeIn}))
        AND TR_AC_DETAIL.cancelled   <> 'Y'
        AND ('All' = :divisionCode OR tr_Ac_detail.div_code = :divisionCode)
      GROUP BY TR_AC_DETAIL.company_code, ms_ac_l3.l3_code
      ORDER BY ms_ac_l3.l3_code
    `;

    conn = await getConn(req);
    const result = await conn.execute(sql, { companyCode, fromDate, toDate, divisionCode }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const rows = normalize(result.rows as any[]);

    const l2Label = l2Codes.length ? ` [L2: ${l2Codes.join(", ")}]` : "";
    const tableHtml = buildSummaryTableHtml(rows, "l3_code", "L3 Code", "80px");
    const title = `L3 Trial Balance${l2Label}  |  ${dateText(fromDate)} – ${dateText(toDate)}`;
    const html = await buildDrilldownPage({
      req, title, reportName: "rpt_drilldown_l3_trialbalance", tableHtml,
      drillLevel: "l4", companyCode, fromDate, toDate, divisionCode,
    });
    sendHtml(res, html);
  } catch (error: any) {
    console.error("Drilldown L3 error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  } finally {
    await closeConn(conn);
  }
};

export const getDrilldownL3Excel = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { companyCode, fromDate, toDate, divisionCode } = parseCommon(req);
    const l2Codes = parseCodeArray(req.body.l2_code);
    const codeIn  = l2Codes.length ? l2Codes.map(c => `'${c.replace(/'/g, "''")}'`).join(",") : "'All'";

    const sql = `
      SELECT TR_AC_DETAIL.company_code, sum(amount * ex_rate * sign_ind) amount,
        ms_ac_l3.l3_code, max(l3_description) ac_name, 00000000000.000000 opening,
        sum(CASE WHEN sign_ind > 0 THEN amount * ex_rate ELSE 0 END) debit_amount,
        sum(CASE WHEN sign_ind < 0 THEN amount * ex_rate ELSE 0 END) credit_amount
      FROM TR_AC_DETAIL, ms_ac_l3
      WHERE TR_AC_DETAIL.company_code = ms_ac_l3.company_code
        AND substr(ac_code, 1, 3) = ms_ac_l3.l3_code
        AND TR_AC_DETAIL.company_code = :companyCode
        AND TR_AC_DETAIL.doc_date >= TO_DATE(:fromDate, 'YYYY-MM-DD')
        AND TR_AC_DETAIL.doc_date <  TO_DATE(:toDate,   'YYYY-MM-DD')
        AND ('All' IN (${codeIn}) OR substr(ms_ac_l3.l3_code, 1, 1) IN (${codeIn}))
        AND TR_AC_DETAIL.cancelled <> 'Y'
        AND ('All' = :divisionCode OR tr_Ac_detail.div_code = :divisionCode)
      GROUP BY TR_AC_DETAIL.company_code, ms_ac_l3.l3_code ORDER BY ms_ac_l3.l3_code`;

    conn = await getConn(req);
    const result = await conn.execute(sql, { companyCode, fromDate, toDate, divisionCode }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const rows = normalize(result.rows as any[]);
    const l2Label = l2Codes.length ? ` [L2: ${l2Codes.join(", ")}]` : "";
    const title = `L3 Trial Balance${l2Label} | ${dateText(fromDate)} – ${dateText(toDate)}`;
    const buffer = buildSummaryExcel(rows, "l3_code", "L3 Code", title, req.user?.loginid ?? "");
    sendExcel(res, buffer, `drilldown_l3_${companyCode}_${fromDate}_${toDate}.xlsx`);
  } catch (error: any) {
    console.error("Drilldown L3 Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  } finally {
    await closeConn(conn);
  }
};

// ─── L4 Drilldown ─────────────────────────────────────────────────────────────

export const getDrilldownL4 = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { companyCode, fromDate, toDate, divisionCode } = parseCommon(req);
    const l3Codes = parseCodeArray(req.body.l3_code);
    const codeIn  = l3Codes.length ? l3Codes.map(c => `'${c.replace(/'/g, "''")}'`).join(",") : "'All'";

    const sql = `
      SELECT TR_AC_DETAIL.company_code,
        sum(amount * ex_rate * sign_ind) amount,
        max(l4_description) ac_name,
        ms_ac_l4.l4_code,
        00000000000.000000 opening,
        sum(CASE WHEN sign_ind > 0 THEN amount * ex_rate ELSE 0 END) debit_amount,
        sum(CASE WHEN sign_ind < 0 THEN amount * ex_rate ELSE 0 END) credit_amount
      FROM TR_AC_DETAIL, ms_ac_l4
      WHERE TR_AC_DETAIL.company_code = ms_ac_l4.company_code
        AND substr(ac_code, 1, 5)     = ms_ac_l4.l4_code
        AND TR_AC_DETAIL.company_code = :companyCode
        AND TR_AC_DETAIL.doc_date    >= TO_DATE(:fromDate, 'YYYY-MM-DD')
        AND TR_AC_DETAIL.doc_date    <  TO_DATE(:toDate,   'YYYY-MM-DD')
        AND ('All' IN (${codeIn}) OR substr(ms_ac_l4.l4_code, 1, 3) IN (${codeIn}))
        AND TR_AC_DETAIL.cancelled   <> 'Y'
        AND ('All' = :divisionCode OR tr_ac_detail.div_code = :divisionCode)
      GROUP BY TR_AC_DETAIL.company_code, ms_ac_l4.l4_code
      ORDER BY ms_ac_l4.l4_code
    `;

    conn = await getConn(req);
    const result = await conn.execute(sql, { companyCode, fromDate, toDate, divisionCode }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const rows = normalize(result.rows as any[]);

    const l3Label = l3Codes.length ? ` [L3: ${l3Codes.join(", ")}]` : "";
    const tableHtml = buildSummaryTableHtml(rows, "l4_code", "L4 Code", "90px");
    const title = `L4 Trial Balance${l3Label}  |  ${dateText(fromDate)} – ${dateText(toDate)}`;
    const html = await buildDrilldownPage({
      req, title, reportName: "rpt_drilldown_l4_trialbalance", tableHtml,
      drillLevel: "ac", companyCode, fromDate, toDate, divisionCode,
    });
    sendHtml(res, html);
  } catch (error: any) {
    console.error("Drilldown L4 error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  } finally {
    await closeConn(conn);
  }
};

export const getDrilldownL4Excel = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { companyCode, fromDate, toDate, divisionCode } = parseCommon(req);
    const l3Codes = parseCodeArray(req.body.l3_code);
    const codeIn  = l3Codes.length ? l3Codes.map(c => `'${c.replace(/'/g, "''")}'`).join(",") : "'All'";

    const sql = `
      SELECT TR_AC_DETAIL.company_code, sum(amount * ex_rate * sign_ind) amount,
        max(l4_description) ac_name, ms_ac_l4.l4_code, 00000000000.000000 opening,
        sum(CASE WHEN sign_ind > 0 THEN amount * ex_rate ELSE 0 END) debit_amount,
        sum(CASE WHEN sign_ind < 0 THEN amount * ex_rate ELSE 0 END) credit_amount
      FROM TR_AC_DETAIL, ms_ac_l4
      WHERE TR_AC_DETAIL.company_code = ms_ac_l4.company_code
        AND substr(ac_code, 1, 5) = ms_ac_l4.l4_code
        AND TR_AC_DETAIL.company_code = :companyCode
        AND TR_AC_DETAIL.doc_date >= TO_DATE(:fromDate, 'YYYY-MM-DD')
        AND TR_AC_DETAIL.doc_date <  TO_DATE(:toDate,   'YYYY-MM-DD')
        AND ('All' IN (${codeIn}) OR substr(ms_ac_l4.l4_code, 1, 3) IN (${codeIn}))
        AND TR_AC_DETAIL.cancelled <> 'Y'
        AND ('All' = :divisionCode OR tr_ac_detail.div_code = :divisionCode)
      GROUP BY TR_AC_DETAIL.company_code, ms_ac_l4.l4_code ORDER BY ms_ac_l4.l4_code`;

    conn = await getConn(req);
    const result = await conn.execute(sql, { companyCode, fromDate, toDate, divisionCode }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const rows = normalize(result.rows as any[]);
    const l3Label = l3Codes.length ? ` [L3: ${l3Codes.join(", ")}]` : "";
    const title = `L4 Trial Balance${l3Label} | ${dateText(fromDate)} – ${dateText(toDate)}`;
    const buffer = buildSummaryExcel(rows, "l4_code", "L4 Code", title, req.user?.loginid ?? "");
    sendExcel(res, buffer, `drilldown_l4_${companyCode}_${fromDate}_${toDate}.xlsx`);
  } catch (error: any) {
    console.error("Drilldown L4 Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  } finally {
    await closeConn(conn);
  }
};

// ─── AC Summary Drilldown ─────────────────────────────────────────────────────

export const getDrilldownAc = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { companyCode, fromDate, toDate, divisionCode } = parseCommon(req);
    const l4Codes = parseCodeArray(req.body.l4_code);
    const acCodes = parseCodeArray(req.body.ac_code);

    const l4In = l4Codes.length ? l4Codes.map(c => `'${c.replace(/'/g, "''")}'`).join(",") : "'All'";
    const acIn = acCodes.length ? acCodes.map(c => `'${c.replace(/'/g, "''")}'`).join(",") : "'All'";

    const sql = `
      SELECT TR_AC_DETAIL.company_code, TR_AC_DETAIL.ac_code, max(ac_name) ac_name,
        00000000000.000000 opening,
        nvl(sum(lcur_amount * sign_ind), 0) amount,
        nvl(sum(CASE WHEN sign_ind > 0 THEN lcur_amount ELSE 0 END), 0) debit_amount,
        nvl(sum(CASE WHEN sign_ind < 0 THEN lcur_amount ELSE 0 END), 0) credit_amount
      FROM TR_AC_DETAIL, MS_ACCODES
      WHERE TR_AC_DETAIL.ac_code      = MS_ACCODES.ac_code
        AND TR_AC_DETAIL.company_code  = :companyCode
        AND TR_AC_DETAIL.doc_date     >= TO_DATE(:fromDate, 'YYYY-MM-DD')
        AND TR_AC_DETAIL.doc_date     <  TO_DATE(:toDate,   'YYYY-MM-DD')
        AND ('All' IN (${acIn}) OR TR_AC_DETAIL.ac_code IN (${acIn}))
        AND ('All' IN (${l4In}) OR MS_ACCODES.l4_code   IN (${l4In}))
        AND TR_AC_DETAIL.cancelled    <> 'Y'
        AND ('All' = :divisionCode OR tr_ac_detail.div_code = :divisionCode)
      GROUP BY TR_AC_DETAIL.company_code, TR_AC_DETAIL.ac_code
      ORDER BY TR_AC_DETAIL.ac_code
    `;

    conn = await getConn(req);
    const result = await conn.execute(sql, { companyCode, fromDate, toDate, divisionCode }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const rows = normalize(result.rows as any[]);

    const l4Label = l4Codes.length ? ` [L4: ${l4Codes.join(", ")}]` : "";

    const totals = rows.reduce(
      (acc, r) => ({
        opening: acc.opening + amount(r.opening),
        debit:   acc.debit   + amount(r.debit_amount),
        credit:  acc.credit  + amount(r.credit_amount),
        amount:  acc.amount  + amount(r.amount),
      }),
      { opening: 0, debit: 0, credit: 0, amount: 0 },
    );

    const dataRows =
      rows
        .map(
          (r) => `
      <tr data-code="${escapeHtml(r.ac_code)}">
        <td class="center mono">${escapeHtml(r.ac_code)}</td>
        <td class="left">${escapeHtml(r.ac_name)}</td>
        <td class="num">${escapeHtml(fmtNumber(amount(r.opening)))}</td>
        <td class="num">${escapeHtml(fmtNumber(amount(r.debit_amount)))}</td>
        <td class="num">${escapeHtml(fmtNumber(amount(r.credit_amount)))}</td>
        <td class="num">${escapeHtml(fmtNumber(amount(r.amount)))}</td>
      </tr>`,
        )
        .join("") ||
      `<tr><td colspan="6" class="center muted">No data found</td></tr>`;

    const tableHtml = `
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:110px">A/C Code</th>
            <th>Account Name</th>
            <th class="right">Opening</th>
            <th class="right">Debit Amount</th>
            <th class="right">Credit Amount</th>
            <th class="right">Amount</th>
          </tr>
        </thead>
        <tbody>${dataRows}</tbody>
        <tfoot>
          <tr class="total-row">
            <td class="empty" colspan="2"></td>
            <td class="num">${escapeHtml(fmtNumber(totals.opening))}</td>
            <td class="num">${escapeHtml(fmtNumber(totals.debit))}</td>
            <td class="num">${escapeHtml(fmtNumber(totals.credit))}</td>
            <td class="num">${escapeHtml(fmtNumber(totals.amount))}</td>
          </tr>
        </tfoot>
      </table>`;

    const title = `AC Trial Balance${l4Label}  |  ${dateText(fromDate)} – ${dateText(toDate)}`;
    const html = await buildDrilldownPage({
      req, title, reportName: "rpt_drilldown_ac_trialbalance", tableHtml,
      drillLevel: "detail", companyCode, fromDate, toDate, divisionCode,
    });
    sendHtml(res, html);
  } catch (error: any) {
    console.error("Drilldown AC error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  } finally {
    await closeConn(conn);
  }
};

export const getDrilldownAcExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { companyCode, fromDate, toDate, divisionCode } = parseCommon(req);
    const l4Codes = parseCodeArray(req.body.l4_code);
    const acCodes = parseCodeArray(req.body.ac_code);
    const l4In = l4Codes.length ? l4Codes.map(c => `'${c.replace(/'/g, "''")}'`).join(",") : "'All'";
    const acIn = acCodes.length ? acCodes.map(c => `'${c.replace(/'/g, "''")}'`).join(",") : "'All'";

    const sql = `
      SELECT TR_AC_DETAIL.company_code, TR_AC_DETAIL.ac_code, max(ac_name) ac_name,
        00000000000.000000 opening,
        nvl(sum(lcur_amount * sign_ind), 0) amount,
        nvl(sum(CASE WHEN sign_ind > 0 THEN lcur_amount ELSE 0 END), 0) debit_amount,
        nvl(sum(CASE WHEN sign_ind < 0 THEN lcur_amount ELSE 0 END), 0) credit_amount
      FROM TR_AC_DETAIL, MS_ACCODES
      WHERE TR_AC_DETAIL.ac_code = MS_ACCODES.ac_code
        AND TR_AC_DETAIL.company_code = :companyCode
        AND TR_AC_DETAIL.doc_date >= TO_DATE(:fromDate, 'YYYY-MM-DD')
        AND TR_AC_DETAIL.doc_date <  TO_DATE(:toDate,   'YYYY-MM-DD')
        AND ('All' IN (${acIn}) OR TR_AC_DETAIL.ac_code IN (${acIn}))
        AND ('All' IN (${l4In}) OR MS_ACCODES.l4_code   IN (${l4In}))
        AND TR_AC_DETAIL.cancelled <> 'Y'
        AND ('All' = :divisionCode OR tr_ac_detail.div_code = :divisionCode)
      GROUP BY TR_AC_DETAIL.company_code, TR_AC_DETAIL.ac_code ORDER BY TR_AC_DETAIL.ac_code`;

    conn = await getConn(req);
    const result = await conn.execute(sql, { companyCode, fromDate, toDate, divisionCode }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const rows = normalize(result.rows as any[]);
    const l4Label = l4Codes.length ? ` [L4: ${l4Codes.join(", ")}]` : "";
    const title = `AC Trial Balance${l4Label} | ${dateText(fromDate)} – ${dateText(toDate)}`;
    const buffer = buildSummaryExcel(rows, "ac_code", "A/C Code", title, req.user?.loginid ?? "");
    sendExcel(res, buffer, `drilldown_ac_${companyCode}_${fromDate}_${toDate}.xlsx`);
  } catch (error: any) {
    console.error("Drilldown AC Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  } finally {
    await closeConn(conn);
  }
};

// ─── Detail (Last Level) Drilldown ───────────────────────────────────────────

export const getDrilldownDetail = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { companyCode, fromDate, toDate, divisionCode } = parseCommon(req);
    const acCodes = parseCodeArray(req.body.ac_code);
    const acIn    = acCodes.length ? acCodes.map(c => `'${c.replace(/'/g, "''")}'`).join(",") : "'All'";

    const sql = `
      SELECT
        TR_AC_DETAIL.company_code, TR_AC_DETAIL.doc_type, TR_AC_DETAIL.doc_no,
        TR_AC_DETAIL.doc_date, TR_AC_DETAIL.ac_code, TR_AC_DETAIL.remarks,
        TR_AC_DETAIL.amount, TR_AC_DETAIL.sign_ind, TR_AC_DETAIL.curr_code,
        TR_AC_DETAIL.ex_rate, TR_AC_DETAIL.lcur_amount, TR_AC_DETAIL.pdc_ind,
        TR_AC_DETAIL.cheque_no, TR_AC_DETAIL.cheque_date, TR_AC_DETAIL.cheque_desc,
        TR_AC_DETAIL.pdc_cleared_date,
        MS_ACCODES_A.ac_name, MS_ACCODES_A.curr_code ac_curr_code,
        000000000.000 op_balance,
        TR_AC_DETAIL.div_code, TR_AC_DETAIL.bank_ac_code,
        MS_ACCODES_B.ac_name bank_ac_name
      FROM TR_AC_DETAIL, MS_ACCODES MS_ACCODES_A, MS_ACCODES MS_ACCODES_B
      WHERE TR_AC_DETAIL.ac_code      = MS_ACCODES_A.ac_code(+)
        AND TR_AC_DETAIL.bank_ac_code = MS_ACCODES_B.ac_code(+)
        AND TR_AC_DETAIL.company_code  = :companyCode
        AND ('All' IN (${acIn}) OR TR_AC_DETAIL.ac_code IN (${acIn}))
        AND TR_AC_DETAIL.doc_date     >= TO_DATE(:fromDate, 'YYYY-MM-DD')
        AND TR_AC_DETAIL.doc_date     <  TO_DATE(:toDate,   'YYYY-MM-DD')
        AND TR_AC_DETAIL.cancelled    <> 'Y'
        AND TR_AC_DETAIL.doc_type     <> 'UJV'
        AND ('All' = :divisionCode OR TR_AC_DETAIL.div_code = :divisionCode)
      ORDER BY TR_AC_DETAIL.ac_code, TR_AC_DETAIL.doc_date, TR_AC_DETAIL.doc_no
    `;

    conn = await getConn(req);
    const result = await conn.execute(sql, { companyCode, fromDate, toDate, divisionCode }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const rows = normalize(result.rows as any[]);

    const grouped = new Map<string, ReportRow[]>();
    for (const r of rows) {
      const key = text(r.ac_code);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(r);
    }

    let grandDebit = 0;
    let grandCredit = 0;
    let bodyHtml = "";

    for (const [acCode, acRows] of grouped) {
      const acName     = text(acRows[0]?.ac_name);
      const opening    = amount(acRows[0]?.op_balance);
      let   runBalance = opening;
      let   acDebit    = 0;
      let   acCredit   = 0;

      bodyHtml += `
        <tr class="group-header">
          <td class="center mono">${escapeHtml(acCode)}</td>
          <td class="left" colspan="6">${escapeHtml(acName)}</td>
          <td class="num primary-text">Opening&nbsp;&nbsp;${escapeHtml(fmtNumber(opening))}</td>
          <td></td>
          <td class="num">${escapeHtml(fmtNumber(opening))}</td>
        </tr>`;

      for (const r of acRows) {
        const debit  = amount(r.sign_ind) >= 0 ? Math.abs(amount(r.lcur_amount)) : 0;
        const credit = amount(r.sign_ind) < 0  ? Math.abs(amount(r.lcur_amount)) : 0;
        runBalance  += debit - credit;
        acDebit     += debit;
        acCredit    += credit;

        const balClass = runBalance < 0 ? "balance-neg" : "balance-pos";
        bodyHtml += `
          <tr>
            <td class="center mono">${escapeHtml(r.ac_code)}</td>
            <td class="center">${escapeHtml(r.doc_type)}</td>
            <td class="center">${escapeHtml(String(r.doc_no ?? ""))}</td>
            <td class="center">${escapeHtml(dateText(r.doc_date))}</td>
            <td class="center">${escapeHtml(String(r.cheque_no ?? ""))}</td>
            <td class="center">${escapeHtml(dateText(r.cheque_date))}</td>
            <td class="left">${escapeHtml(text(r.bank_ac_name))}</td>
            <td class="num">${debit  > 0 ? escapeHtml(fmtNumber(debit))  : ""}</td>
            <td class="num">${credit > 0 ? escapeHtml(fmtNumber(credit)) : ""}</td>
            <td class="num ${balClass}">${escapeHtml(fmtNumber(runBalance))}</td>
          </tr>`;
      }

      grandDebit  += acDebit;
      grandCredit += acCredit;

      bodyHtml += `
        <tr class="total-row">
          <td class="empty" colspan="7" style="text-align:left; padding-left:12px">Total — ${escapeHtml(acName)}</td>
          <td class="num">${escapeHtml(fmtNumber(acDebit))}</td>
          <td class="num">${escapeHtml(fmtNumber(acCredit))}</td>
          <td class="num">${escapeHtml(fmtNumber(runBalance))}</td>
        </tr>
        <tr><td colspan="10" style="height:6px; border:0; background:transparent"></td></tr>`;
    }

    if (!rows.length) {
      bodyHtml = `<tr><td colspan="10" class="center muted">No transactions found</td></tr>`;
    }

    const acLabel = acCodes.length ? ` — ${acCodes.join(", ")}` : "";
    const tableHtml = `
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:100px">A/C Code</th>
            <th style="width:50px">Type</th>
            <th style="width:65px">Doc No.</th>
            <th style="width:80px">Doc Date</th>
            <th style="width:80px">Chq No.</th>
            <th style="width:80px">Chq Date</th>
            <th>Bank</th>
            <th class="right" style="width:110px">Debit</th>
            <th class="right" style="width:110px">Credit</th>
            <th class="right" style="width:120px">Balance</th>
          </tr>
        </thead>
        <tbody>${bodyHtml}</tbody>
        <tfoot>
          <tr class="total-row">
            <td class="empty" colspan="7" style="text-align:left; padding-left:12px">Grand Total</td>
            <td class="num">${escapeHtml(fmtNumber(grandDebit))}</td>
            <td class="num">${escapeHtml(fmtNumber(grandCredit))}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>`;

    const title = `Account Ledger${acLabel}  |  ${dateText(fromDate)} – ${dateText(toDate)}`;
    const html = await buildDrilldownPage({
      req, title, reportName: "rpt_drilldown_detail_trailbalance", tableHtml,
      drillLevel: null, companyCode, fromDate, toDate, divisionCode,
    });
    sendHtml(res, html);
  } catch (error: any) {
    console.error("Drilldown Detail error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  } finally {
    await closeConn(conn);
  }
};

export const getDrilldownDetailExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { companyCode, fromDate, toDate, divisionCode } = parseCommon(req);
    const acCodes = parseCodeArray(req.body.ac_code);
    const acIn    = acCodes.length ? acCodes.map(c => `'${c.replace(/'/g, "''")}'`).join(",") : "'All'";

    const sql = `
      SELECT TR_AC_DETAIL.company_code, TR_AC_DETAIL.doc_type, TR_AC_DETAIL.doc_no,
        TR_AC_DETAIL.doc_date, TR_AC_DETAIL.ac_code, TR_AC_DETAIL.amount,
        TR_AC_DETAIL.sign_ind, TR_AC_DETAIL.lcur_amount,
        TR_AC_DETAIL.cheque_no, TR_AC_DETAIL.cheque_date,
        MS_ACCODES_A.ac_name, 000000000.000 op_balance,
        TR_AC_DETAIL.div_code, TR_AC_DETAIL.bank_ac_code,
        MS_ACCODES_B.ac_name bank_ac_name
      FROM TR_AC_DETAIL, MS_ACCODES MS_ACCODES_A, MS_ACCODES MS_ACCODES_B
      WHERE TR_AC_DETAIL.ac_code      = MS_ACCODES_A.ac_code(+)
        AND TR_AC_DETAIL.bank_ac_code = MS_ACCODES_B.ac_code(+)
        AND TR_AC_DETAIL.company_code  = :companyCode
        AND ('All' IN (${acIn}) OR TR_AC_DETAIL.ac_code IN (${acIn}))
        AND TR_AC_DETAIL.doc_date     >= TO_DATE(:fromDate, 'YYYY-MM-DD')
        AND TR_AC_DETAIL.doc_date     <  TO_DATE(:toDate,   'YYYY-MM-DD')
        AND TR_AC_DETAIL.cancelled    <> 'Y'
        AND TR_AC_DETAIL.doc_type     <> 'UJV'
        AND ('All' = :divisionCode OR TR_AC_DETAIL.div_code = :divisionCode)
      ORDER BY TR_AC_DETAIL.ac_code, TR_AC_DETAIL.doc_date, TR_AC_DETAIL.doc_no`;

    conn = await getConn(req);
    const result = await conn.execute(sql, { companyCode, fromDate, toDate, divisionCode }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const rows = normalize(result.rows as any[]);
    const acLabel = acCodes.length ? ` — ${acCodes.join(", ")}` : "";
    const title = `Account Ledger${acLabel} | ${dateText(fromDate)} – ${dateText(toDate)}`;
    const buffer = buildDetailExcel(rows, title, req.user?.loginid ?? "");
    sendExcel(res, buffer, `drilldown_detail_${companyCode}_${fromDate}_${toDate}.xlsx`);
  } catch (error: any) {
    console.error("Drilldown Detail Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  } finally {
    await closeConn(conn);
  }
};
