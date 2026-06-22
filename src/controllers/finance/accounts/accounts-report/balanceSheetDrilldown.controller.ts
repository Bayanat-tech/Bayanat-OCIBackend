import { Request, Response } from "express";
import oracledb = require("oracledb");
import * as XLSX from "xlsx";
const AdmZip = require("adm-zip");
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../../interfaces/common.interface";

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

// ─── Request Param Parsers ─────────────────────────────────────────────────────

function parseCommon(req: RequestWithUser) {
  const companyCode  = text(req.body.company_code  || req.user?.company_code);
  const asOnDate     = text(req.body.as_on_date);
  const divisionCode = text(req.body.division_code || "All");

  if (!companyCode || !asOnDate)
    throw Object.assign(
      new Error("company_code and as_on_date are required"),
      { status: 400 },
    );

  return { companyCode, asOnDate, divisionCode };
}

function parseCodeArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string" && raw.trim()) return raw.split(",").map(s => s.trim()).filter(Boolean);
  return [];
}

function sqlLiteralList(codes: string[]): string {
  return codes.length
    ? codes.map(c => `'${c.replace(/'/g, "''")}'`).join(",")
    : "'All'";
}

// ─── Excel Styles (shared with Trial Balance drilldown) ─────────────────────────

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
  [JSON.stringify(excelStyles.title),      1],
  [JSON.stringify(excelStyles.meta),       2],
  [JSON.stringify(excelStyles.tableHead),  3],
  [JSON.stringify(excelStyles.normal),     4],
  [JSON.stringify(excelStyles.number),     5],
  [JSON.stringify(excelStyles.totalLabel), 6],
  [JSON.stringify(excelStyles.totalNumber),7],
]);

function applyStyle(ws: XLSX.WorkSheet, row: number, col: number, style: Record<string, unknown>) {
  const ref = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
  if (!ws[ref]) ws[ref] = { t: "s", v: "" };
  (ws[ref] as any).s = style;
}

function styleRange(ws: XLSX.WorkSheet, row: number, startCol: number, endCol: number, style: Record<string, unknown>) {
  for (let col = startCol; col <= endCol; col++) applyStyle(ws, row, col, style);
}

function buildXlsxBuffer(ws: XLSX.WorkSheet, sheetName: string): Buffer {
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");

  const colXml = (ws["!cols"] || [])
    .map((col: any, i: number) => `<col min="${i + 1}" max="${i + 1}" width="${Number(col.wch || 12)}" customWidth="1"/>`)
    .join("");

  let sheetData = "";
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = ws[ref] as XLSX.CellObject | undefined;
      const styleId = cell ? styleIdBySignature.get(JSON.stringify((cell as any).s)) || 0 : 0;
      if (!cell && !styleId) continue;
      const attrs = `r="${ref}"${styleId ? ` s="${styleId}"` : ""}`;
      const value = cell?.v;
      if (typeof value === "number") {
        cells.push(`<c ${attrs}><v>${value}</v></c>`);
      } else {
        cells.push(`<c ${attrs} t="inlineStr"><is><t>${escapeXml(value ?? "")}</t></is></c>`);
      }
    }
    if (cells.length) sheetData += `<row r="${r + 1}">${cells.join("")}</row>`;
  }

  const merges = (ws["!merges"] || [])
    .map((m: any) => `<mergeCell ref="${XLSX.utils.encode_range(m)}"/>`)
    .join("");

  const mergeXml = merges ? `<mergeCells count="${(ws["!merges"] || []).length}">${merges}</mergeCells>` : "";

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
      <top style="thin"><color rgb="FF1A5F4A"/></top><bottom style="thin"><color rgb="FF1A5F4A"/></bottom><diagonal/>
    </border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>
    <border>
      <left style="medium"><color rgb="FF000000"/></left><right style="medium"><color rgb="FF000000"/></right>
      <top style="medium"><color rgb="FF000000"/></top><bottom style="medium"><color rgb="FF000000"/></bottom><diagonal/>
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

  const safeName = sheetName.replace(/[\\/?*\[\]]/g, "_").substring(0, 31);
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

// ─── Shared HTML Shell ────────────────────────────────────────────────────────────

function buildPage(opts: {
  title:        string;
  username:     string;
  reportName:   string;
  tableHtml:    string;
  drillLevel:   "ac" | "detail" | null;
  companyCode:  string;
  asOnDate:     string;
  divisionCode: string;
}): string {
  const { title, username, reportName, tableHtml, drillLevel, companyCode, asOnDate, divisionCode } = opts;

  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const CODE_FIELD_MAP: Record<string, string> = {
    ac:     "bl_code",
    detail: "ac_code",
  };

  const drillScript = drillLevel ? `
  <script>
    (function () {
      var DRILL_LEVEL   = ${JSON.stringify(drillLevel)};
      var COMPANY_CODE  = ${JSON.stringify(companyCode)};
      var AS_ON_DATE    = ${JSON.stringify(asOnDate)};
      var DIVISION_CODE = ${JSON.stringify(divisionCode)};
      var CODE_FIELD    = ${JSON.stringify(CODE_FIELD_MAP[drillLevel] ?? "")};

      document.querySelectorAll("tbody tr[data-code]").forEach(function (tr) {
        tr.style.cursor = "pointer";
        tr.addEventListener("mouseenter", function () { tr.style.background = "#f0f9f5"; });
        tr.addEventListener("mouseleave", function () { tr.style.background = ""; });
        tr.addEventListener("click", function () {
          var code = tr.getAttribute("data-code");
          window.parent.postMessage({
            type:          "DRILL_DOWN",
            drillLevel:    DRILL_LEVEL,
            company_code:  COMPANY_CODE,
            as_on_date:    AS_ON_DATE,
            division_code: DIVISION_CODE,
            code:          code,
            codeField:     CODE_FIELD,
          }, "*");
        });
      });
    })();
  </script>` : "";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      font-size: 12px;
      color: #000;
      background: #eef2f7;
    }
    .sheet {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      background: #fff;
      padding: 8mm;
      border: 1px solid #aab7c8;
    }
    .logo-area { margin-bottom: 16px; }
    .divider-thick { border-top: 2px solid #000; margin: 10px 0 6px; }
    .divider-thin  { border-top: 1px solid #000; margin: 6px 0 10px; }
    .meta-row { display: flex; align-items: baseline; font-size: 12px; margin-bottom: 3px; }
    .meta-label { font-weight: 700; width: 60px; flex-shrink: 0; }
    .drill-hint {
      font-size: 10px; color: #1a5f4a; background: #f0f9f5;
      border: 1px solid #a7d7c5; border-radius: 4px;
      padding: 4px 10px; margin-bottom: 8px;
      display: inline-flex; align-items: center; gap: 6px;
    }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
    th {
      border: 1px solid #000;
      padding: 3px 8px;
      text-align: center;
      font-weight: 700;
      background: #fff;
    }
    th.right { text-align: right; }
    td { border: 1px solid #ccc; padding: 2px 8px; }
    td.center { text-align: center; }
    td.left   { text-align: left; }
    td.num    { text-align: right; font-variant-numeric: tabular-nums; }
    td.mono   { font-family: monospace; font-size: 10px; }
    tr.total-row td { border: 2px solid #000; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; background: #f8f8f8; }
    tr.total-row td.empty { border: 1px solid #ccc; background: #fff; }
    .end-of-report { text-align: center; margin-top: 12px; margin-bottom: 6px; font-size: 11px; border-top: 1px solid #ccc; padding-top: 6px; }
    .report-footer { display: flex; justify-content: space-between; font-size: 10px; color: #666; border-top: 1px solid #ccc; padding-top: 4px; margin-top: 6px; }
    .balance-pos { color: #000; }
    .balance-neg { color: #c0392b; }
    @media print {
      body { background: white; }
      .sheet { border: 0; margin: 0; width: auto; min-height: auto; padding: 0; }
      .drill-hint { display: none !important; }
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
      tbody tr { page-break-inside: avoid; }
      .print-body-padding { padding-bottom: 40px !important; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="logo-area">
      <svg width="160" height="50" viewBox="0 0 360 112" xmlns="http://www.w3.org/2000/svg" style="display:block">
        <rect width="360" height="112" rx="4" fill="#1a5f4a"/>
        <text x="16" y="46" font-family="Arial" font-size="26" font-weight="700" fill="#d4a017">al madina المدينة</text>
        <text x="16" y="72" font-family="Arial" font-size="15" font-weight="400" fill="#d4a017" letter-spacing="4">LOGISTICS اللوجستية</text>
        <polygon points="310,20 355,56 310,92" fill="#d4a017"/>
      </svg>
    </div>
    <div class="divider-thick"></div>
    <div class="meta-row"><span class="meta-label">Title :</span><span>${escapeHtml(title)}</span></div>
    <div class="meta-row"><span class="meta-label">Date :</span><span>${escapeHtml(printDateTime)}</span></div>
    <div class="meta-row"><span class="meta-label">User :</span><span>${escapeHtml(username)}</span></div>
    <div class="divider-thin"></div>
    ${drillLevel ? `<div class="drill-hint">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      Click any row to drill down
    </div>` : ""}
    ${tableHtml}
    <div class="end-of-report">End of Report</div>
    <div class="report-footer">
      <span>Report: ${escapeHtml(reportName)}</span>
      <span>Powered by Bayanat Technology</span>
    </div>
  </div>
  ${drillScript}
</body>
</html>`;
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

// ─── AC Level Drilldown ───────────────────────────────────────────────────────

async function loadAcRows(
  req: RequestWithUser,
  companyCode: string,
  asOnDate: string,
  divisionCode: string,
  blCodes: string[],
): Promise<ReportRow[]> {
  const blIn = sqlLiteralList(blCodes);

  const sql = `
    SELECT
      TR_AC_DETAIL.company_code,
      TR_AC_DETAIL.ac_code,
      max(ac_name) ac_name,
      00000000000.000000 opening,
      sum(round(lcur_amount * sign_ind, 3)) amount,
      sum(case when sign_ind > 0 then lcur_amount else 0 end) debit_amount,
      sum(case when sign_ind < 0 then lcur_amount else 0 end) credit_amount,
      TR_AC_DETAIL.div_code
    FROM TR_AC_DETAIL, MS_ACCODES
    WHERE TR_AC_DETAIL.ac_code      = MS_ACCODES.ac_code
      AND TR_AC_DETAIL.company_code = :companyCode
      AND TR_AC_DETAIL.doc_date     < TO_DATE(:asOnDate, 'YYYY-MM-DD')
      AND ('All' IN (${blIn}) OR MS_ACCODES.pl_bl_code IN (${blIn}))
      AND TR_AC_DETAIL.doc_type    <> 'EJV'
      AND TR_AC_DETAIL.CANCELLED   <> 'Y'
      AND ('All' = :divisionCode OR TR_AC_DETAIL.div_code = :divisionCode)
    GROUP BY TR_AC_DETAIL.div_code, TR_AC_DETAIL.company_code, TR_AC_DETAIL.ac_code
    ORDER BY TR_AC_DETAIL.ac_code
  `;

  const conn = await getConn(req);
  try {
    const result = await conn.execute(sql,
      { companyCode, asOnDate, divisionCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

function renderAcTable(rows: ReportRow[]): { tableHtml: string; totals: { opening: number; debit: number; credit: number; amount: number } } {
  const totals = rows.reduce<{
    opening: number;
    debit: number;
    credit: number;
    amount: number;
  }>(
    (acc, r) => ({
      opening: acc.opening + amount(r.opening),
      debit:   acc.debit   + amount(r.debit_amount),
      credit:  acc.credit  + amount(r.credit_amount),
      amount:  acc.amount  + amount(r.amount),
    }),
    { opening: 0, debit: 0, credit: 0, amount: 0 },
  );

  const dataRows = rows.map(r => `
    <tr data-code="${escapeHtml(r.ac_code)}">
      <td class="center mono">${escapeHtml(r.ac_code)}</td>
      <td class="left">${escapeHtml(r.ac_name)}</td>
      <td class="num">${escapeHtml(fmtNumber(amount(r.opening)))}</td>
      <td class="num">${escapeHtml(fmtNumber(amount(r.debit_amount)))}</td>
      <td class="num">${escapeHtml(fmtNumber(amount(r.credit_amount)))}</td>
      <td class="num">${escapeHtml(fmtNumber(amount(r.amount)))}</td>
    </tr>`).join("") || `<tr><td colspan="6" class="center" style="color:#666">No data found</td></tr>`;

  const tableHtml = `
    <table>
      <thead><tr>
        <th style="width:110px">A/C Code</th><th>Account Name</th>
        <th class="right">Opening</th><th class="right">Debit Amount</th>
        <th class="right">Credit Amount</th><th class="right">Amount</th>
      </tr></thead>
      <tbody>${dataRows}</tbody>
      <tfoot><tr class="total-row">
        <td class="empty" colspan="2"></td>
        <td>${escapeHtml(fmtNumber(totals.opening))}</td>
        <td>${escapeHtml(fmtNumber(totals.debit))}</td>
        <td>${escapeHtml(fmtNumber(totals.credit))}</td>
        <td>${escapeHtml(fmtNumber(totals.amount))}</td>
      </tr></tfoot>
    </table>`;

  return { tableHtml, totals };
}

function buildSummaryExcel(
  rows: ReportRow[],
  codeField: string,
  codeHeader: string,
  sheetTitle: string,
  loginId: string,
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
    ["al madina LOGISTICS - Balance Sheet Drill-Down", "", "", "", "", ""],
    [],
    ["Title :", sheetTitle, "", "", "", ""],
    ["Date :", printDateTime, "", "", "", ""],
    ["User :", loginId, "", "", "", ""],
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

  return buildXlsxBuffer(ws, "BS Drill-Down");
}

export const getBalanceSheetDrilldownAc = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const { companyCode, asOnDate, divisionCode } = parseCommon(req);
    const blCodes = parseCodeArray(req.body.bl_code);
    const rows = await loadAcRows(req, companyCode, asOnDate, divisionCode, blCodes);
    const { tableHtml } = renderAcTable(rows);
    const blLabel = blCodes.length ? ` [BL: ${blCodes.join(", ")}]` : "";
    const title = `Account Breakdown${blLabel} | As on ${dateText(asOnDate)}`;

    sendHtml(res, buildPage({
      title,
      username: req.user?.loginid ?? "",
      reportName: "rpt_drilldown_balancesheet_ac",
      tableHtml,
      drillLevel: "detail",
      companyCode,
      asOnDate,
      divisionCode,
    }));
  } catch (error: any) {
    console.error("Balance Sheet Drilldown AC error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate drill-down" });
  }
};

export const getBalanceSheetDrilldownAcExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const { companyCode, asOnDate, divisionCode } = parseCommon(req);
    const blCodes = parseCodeArray(req.body.bl_code);
    const rows = await loadAcRows(req, companyCode, asOnDate, divisionCode, blCodes);
    const blLabel = blCodes.length ? ` [BL: ${blCodes.join(", ")}]` : "";
    const title = `Account Breakdown${blLabel} | As on ${dateText(asOnDate)}`;
    const buffer = buildSummaryExcel(rows, "ac_code", "A/C Code", title, req.user?.loginid ?? "");
    sendExcel(res, buffer, `balance_sheet_drilldown_ac_${companyCode}_${asOnDate}.xlsx`);
  } catch (error: any) {
    console.error("Balance Sheet Drilldown AC Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to export drill-down" });
  }
};

// ─── Detail Level Drilldown ────────────────────────────────────────────────────

async function loadDetailRows(
  req: RequestWithUser,
  companyCode: string,
  asOnDate: string,
  divisionCode: string,
  acCodes: string[],
): Promise<ReportRow[]> {
  const acIn = sqlLiteralList(acCodes);

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
      AND TR_AC_DETAIL.company_code = :companyCode
      AND ('All' IN (${acIn}) OR TR_AC_DETAIL.ac_code IN (${acIn}))
      AND TR_AC_DETAIL.doc_date    < TO_DATE(:asOnDate, 'YYYY-MM-DD')
      AND TR_AC_DETAIL.cancelled  <> 'Y'
      AND TR_AC_DETAIL.doc_type   <> 'UJV'
      AND ('All' = :divisionCode OR TR_AC_DETAIL.div_code = :divisionCode)
    ORDER BY TR_AC_DETAIL.ac_code, TR_AC_DETAIL.doc_date, TR_AC_DETAIL.doc_no
  `;

  const conn = await getConn(req);
  try {
    const result = await conn.execute(sql,
      { companyCode, asOnDate, divisionCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

function renderDetailTable(rows: ReportRow[]): { tableHtml: string; grandDebit: number; grandCredit: number } {
  const grouped = new Map<string, ReportRow[]>();
  rows.forEach(r => {
    const key = text(r.ac_code);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  });

  let grandDebit = 0;
  let grandCredit = 0;
  let bodyHtml = "";

  grouped.forEach((acRows, acCode) => {
    const acName = text(acRows[0]?.ac_name);
    const opening = amount(acRows[0]?.op_balance);
    let runBalance = opening;
    let acDebit = 0;
    let acCredit = 0;

    bodyHtml += `
      <tr style="background:#f0f9f5">
        <td class="center mono" style="font-weight:700">${escapeHtml(acCode)}</td>
        <td class="left" style="font-weight:700" colspan="6">${escapeHtml(acName)}</td>
        <td class="num" style="font-weight:700; color:#1a5f4a">Opening&nbsp;&nbsp;${escapeHtml(fmtNumber(opening))}</td>
        <td></td>
        <td class="num" style="font-weight:700">${escapeHtml(fmtNumber(opening))}</td>
      </tr>`;

    for (const r of acRows) {
      const debit = amount(r.sign_ind) >= 0 ? Math.abs(amount(r.lcur_amount)) : 0;
      const credit = amount(r.sign_ind) < 0 ? Math.abs(amount(r.lcur_amount)) : 0;
      runBalance += debit - credit;
      acDebit += debit;
      acCredit += credit;
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
          <td class="num">${debit > 0 ? escapeHtml(fmtNumber(debit)) : ""}</td>
          <td class="num">${credit > 0 ? escapeHtml(fmtNumber(credit)) : ""}</td>
          <td class="num ${balClass}">${escapeHtml(fmtNumber(runBalance))}</td>
        </tr>`;
    }

    grandDebit += acDebit;
    grandCredit += acCredit;

    bodyHtml += `
      <tr class="total-row">
        <td class="empty" colspan="7" style="text-align:left; padding-left:12px">Total — ${escapeHtml(acName)}</td>
        <td>${escapeHtml(fmtNumber(acDebit))}</td>
        <td>${escapeHtml(fmtNumber(acCredit))}</td>
        <td>${escapeHtml(fmtNumber(runBalance))}</td>
      </tr>
      <tr><td colspan="10" style="height:6px; border:0; background:transparent"></td></tr>`;
  });

  if (!rows.length) {
    bodyHtml = `<tr><td colspan="10" class="center" style="color:#666">No transactions found</td></tr>`;
  }

  const tableHtml = `
    <table>
      <thead><tr>
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
      </tr></thead>
      <tbody>${bodyHtml}</tbody>
      <tfoot><tr class="total-row">
        <td class="empty" colspan="7" style="text-align:left; padding-left:12px">Grand Total</td>
        <td>${escapeHtml(fmtNumber(grandDebit))}</td>
        <td>${escapeHtml(fmtNumber(grandCredit))}</td>
        <td></td>
      </tr></tfoot>
    </table>`;

  return { tableHtml, grandDebit, grandCredit };
}

function buildDetailExcel(rows: ReportRow[], sheetTitle: string, loginId: string): Buffer {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const headers = ["A/C Code", "Type", "Doc No.", "Doc Date", "Chq No.", "Chq Date", "Bank", "Debit", "Credit", "Balance"];
  const sheetRows: any[][] = [
    ["al madina LOGISTICS - Account Ledger", "", "", "", "", "", "", "", "", ""],
    [],
    ["Title :", sheetTitle, "", "", "", "", "", "", "", ""],
    ["Date :", printDateTime, "", "", "", "", "", "", "", ""],
    ["User :", loginId, "", "", "", "", "", "", "", ""],
    [],
    headers,
  ];

  const grouped = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const key = text(r.ac_code);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  let grandDebit = 0;
  let grandCredit = 0;

  grouped.forEach((acRows, acCode) => {
    const acName = text(acRows[0]?.ac_name);
    let runBalance = 0;
    let acDebit = 0;
    let acCredit = 0;

    sheetRows.push([`${acCode} — ${acName}`, "", "", "", "", "", "", "", "", ""]);

    for (const r of acRows) {
      const debit = amount(r.sign_ind) >= 0 ? Math.abs(amount(r.lcur_amount)) : 0;
      const credit = amount(r.sign_ind) < 0 ? Math.abs(amount(r.lcur_amount)) : 0;
      runBalance += debit - credit;
      acDebit += debit;
      acCredit += credit;

      sheetRows.push([
        text(r.ac_code), text(r.doc_type), text(r.doc_no ?? ""), dateText(r.doc_date),
        text(r.cheque_no ?? ""), dateText(r.cheque_date), text(r.bank_ac_name ?? ""),
        debit > 0 ? debit : "",
        credit > 0 ? credit : "",
        runBalance,
      ]);
    }

    grandDebit += acDebit;
    grandCredit += acCredit;
    sheetRows.push([`Total — ${acName}`, "", "", "", "", "", "", acDebit, acCredit, runBalance]);
    sheetRows.push([]);
  });

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

  for (let r = 8; r <= sheetRows.length; r++) {
    styleRange(ws, r, 8, 10, excelStyles.number);
  }

  return buildXlsxBuffer(ws, "Ledger Detail");
}

export const getBalanceSheetDrilldownDetail = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const { companyCode, asOnDate, divisionCode } = parseCommon(req);
    const acCodes = parseCodeArray(req.body.ac_code);
    const rows = await loadDetailRows(req, companyCode, asOnDate, divisionCode, acCodes);
    const { tableHtml } = renderDetailTable(rows);

    const acLabel = acCodes.length ? ` — ${acCodes.join(", ")}` : "";
    const title = `Account Ledger${acLabel} | As on ${dateText(asOnDate)}`;

    sendHtml(res, buildPage({
      title,
      username: req.user?.loginid ?? "",
      reportName: "rpt_drilldown_balancesheet_detail",
      tableHtml,
      drillLevel: null,
      companyCode,
      asOnDate,
      divisionCode,
    }));
  } catch (error: any) {
    console.error("Balance Sheet Drilldown Detail error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate drill-down" });
  }
};

export const getBalanceSheetDrilldownDetailExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const { companyCode, asOnDate, divisionCode } = parseCommon(req);
    const acCodes = parseCodeArray(req.body.ac_code);
    const rows = await loadDetailRows(req, companyCode, asOnDate, divisionCode, acCodes);
    const acLabel = acCodes.length ? ` — ${acCodes.join(", ")}` : "";
    const title = `Account Ledger${acLabel} | As on ${dateText(asOnDate)}`;
    const buffer = buildDetailExcel(rows, title, req.user?.loginid ?? "");
    sendExcel(res, buffer, `balance_sheet_drilldown_detail_${companyCode}_${asOnDate}.xlsx`);
  } catch (error: any) {
    console.error("Balance Sheet Drilldown Detail Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to export drill-down" });
  }
};
