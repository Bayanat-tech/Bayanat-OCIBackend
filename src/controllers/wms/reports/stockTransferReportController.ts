import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";

// ─── DB Helpers ─────────────────────────────────────────────────────────────
// (unchanged from the original — same tenant resolution / connection pattern
//  used across the Trial Balance drilldown controller)

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
    try {
      await conn.close();
    } catch (e) {
      console.warn("Close conn error:", e);
    }
}

interface RawSqlApiParams {
  sql: string;
  binds?: Record<string, any>;
  req: RequestWithUser;
}

const raw_sql_api = async ({ sql, binds = {}, req }: RawSqlApiParams) => {
  let conn: oracledb.Connection | undefined;
  try {
    conn = await getConn(req);
    const result = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return result;
  } catch (err) {
    console.error("Error executing raw SQL:", err);
    throw err;
  } finally {
    await closeConn(conn);
  }
};

// The stock-transfer query is identical for the HTML view and the Excel
// export, so it's shared here. Logic (bind values, joins, filters) is
// untouched from the original — only the two consumers below changed.
function buildStockTransferSql(company_code: unknown, prin_code: unknown, stn_no: unknown) {
  return `SELECT
        TS_STN.STN_NO,
        TS_STN.STN_DATE,
        TS_STN.PRIN_CODE,
        TS_STN.DESCRIPTION,
        TS_STN.CONFIRMED,
        TS_STN.CONFIRMED_DATE,
        TS_STNDETAIL.SERIAL_NO,
        TS_STNDETAIL.PROD_CODE,
        TS_STNDETAIL.FROM_SITE,
        TS_STNDETAIL.TO_SITE,
        TS_STNDETAIL.FROM_LOC_START,
        TS_STNDETAIL.FROM_LOC_END,
        TS_STNDETAIL.TO_LOC_START,
        TS_STNDETAIL.TO_LOC_END,
        TS_STNDETAIL.QTY_PUOM,
        TS_STNDETAIL.P_UOM,
        TS_STNDETAIL.QTY_LUOM,
        TS_STNDETAIL.L_UOM,
        TS_STNDETAIL.PROCESSED,
        TS_STNDETAIL.CONFIRMED
    FROM
        TS_STN,
        TS_STNDETAIL
    WHERE
        TS_STN.STN_NO = TS_STNDETAIL.STN_NO
        AND TS_STN.PRIN_CODE = TS_STNDETAIL.PRIN_CODE
        AND TS_STN.COMPANY_CODE = TS_STNDETAIL.COMPANY_CODE
        AND TS_STN.COMPANY_CODE = ${company_code}
        AND TS_STN.PRIN_CODE = ${prin_code}
    AND TS_STN.STN_NO = ${stn_no}`;
}

// ─── Formatting helpers ───────────────────────────────────────────────────

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function formatDate(value: any): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy} ${d.getHours() === 0 && d.getMinutes() === 0 ? "00:00" : formatTime(d)}`;
}

function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mi}`;
}

function formatReportTimestamp(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dd = String(d.getDate()).padStart(2, "0");
  const mon = months[d.getMonth()];
  const yyyy = d.getFullYear();
  let hours = d.getHours();
  const ampm = hours >= 12 ? "pm" : "am";
  hours = hours % 12 || 12;
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mon}/${yyyy} ${hours}:${mi} ${ampm}`;
}

function yesNo(val: any): string {
  if (val === null || val === undefined) return "No";
  const s = String(val).trim().toUpperCase();
  return s === "Y" || s === "1" || s === "YES" || s === "TRUE" ? "Yes" : "No";
}

function escapeHtml(val: any): string {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── Shared HTML shell ────────────────────────────────────────────────────
// This mirrors the Trial Balance drilldown page shell (buildPage): the same
// al madina logo block, meta-row layout, divider rules, print media query,
// end-of-report line and footer — so Stock Transfer visually matches the
// other reports instead of using its own bespoke header/table styling.

function buildPage(opts: {
  title: string;
  username: string;
  reportName: string;
  infoBlockHtml: string;
  tableHtml: string;
}): string {
  const { title, username, reportName, infoBlockHtml, tableHtml } = opts;

  const printDateTime = formatReportTimestamp(new Date());

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
    .meta-label { font-weight: 700; width: 70px; flex-shrink: 0; }
    .info-block {
      display: flex;
      justify-content: space-between;
      border-top: 1px solid #ccc;
      border-bottom: 1px solid #ccc;
      padding: 8px 0;
      margin-bottom: 12px;
    }
    .info-left div, .info-right div { margin-bottom: 4px; }
    .info-left .label, .info-right .label { font-weight: 700; margin-right: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
    th {
      border: 1px solid #000;
      padding: 2px 6px;
      line-height: 1.2;
      text-align: center;
      font-weight: 700;
      background: #fff;
    }
    th.right { text-align: right; }
    td { border: 1px solid #ccc; padding: 1px 6px; line-height: 1.3; }
    td.center { text-align: center; }
    td.left   { text-align: left; }
    td.num    { text-align: right; font-variant-numeric: tabular-nums; }
    tr.status-row td {
      border-top: none;
      border-bottom: 1px solid #ccc;
      font-style: italic;
      color: #555;
      padding-top: 0;
      padding-bottom: 2px;
      line-height: 1.2;
    }
    tr.total-row td { border: 2px solid #000; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; background: #f8f8f8; }
    tr.total-row td.empty { border: 1px solid #ccc; background: #fff; }
    .end-of-report { text-align: center; margin-top: 12px; margin-bottom: 6px; font-size: 11px; border-top: 1px solid #ccc; padding-top: 6px; }
    .report-footer { display: flex; justify-content: space-between; font-size: 10px; color: #666; border-top: 1px solid #ccc; padding-top: 4px; margin-top: 6px; }
    @media print {
      body { background: white; }
      .sheet { border: 0; margin: 0; width: auto; min-height: auto; padding: 0; }
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
      tbody tr { page-break-inside: avoid; }
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

    ${infoBlockHtml}

    ${tableHtml}

    <div class="end-of-report">End of Report</div>
    <div class="report-footer">
      <span>Report: ${escapeHtml(reportName)}</span>
      <span>Powered by Bayanat Technology</span>
    </div>
  </div>
</body>
</html>`;
}

// ─── HTML report ──────────────────────────────────────────────────────────

export const stockTransferReportHtml = async (req: RequestWithUser, res: Response) => {
  const { stn_no, prin_code, company_code } = req.query;

  const sql = buildStockTransferSql(company_code, prin_code, stn_no);
  const result = await raw_sql_api({ sql, req });

  const rows: any[] = result.rows || [];
  const header = rows[0]; // header fields are the same on every row
  const userName = req.user?.loginid ?? "";

  const bodyRows =
    rows
      .map(
        (row: any) => `
        <tr>
          <td class="center">${escapeHtml(row.SERIAL_NO)}</td>
          <td class="left">${escapeHtml(row.PROD_CODE)}</td>
          <td class="center">${escapeHtml(row.FROM_SITE)}</td>
          <td class="center">${escapeHtml(row.FROM_LOC_START)}</td>
          <td class="center">${escapeHtml(row.FROM_LOC_END)}</td>
          <td class="center">${escapeHtml(row.TO_SITE)}</td>
          <td class="center">${escapeHtml(row.TO_LOC_START)}</td>
          <td class="center">${escapeHtml(row.TO_LOC_END)}</td>
          <td class="num">${escapeHtml(row.QTY_PUOM)}</td>
          <td class="center">${escapeHtml(row.P_UOM)}</td>
          <td class="num">${escapeHtml(row.QTY_LUOM)}</td>
          <td class="center">${escapeHtml(row.L_UOM)}</td>
        </tr>
        <tr class="status-row">
          <td class="center"></td>
          <td colspan="11">Status: ${yesNo(row.DTL_CONFIRMED) === "Yes" ? "Confirmed" : "Not Confirmed"}</td>
        </tr>`,
      )
      .join("") || `<tr><td colspan="12" class="center" style="color:#666">No data found</td></tr>`;

  const infoBlockHtml = `
    <div class="info-block">
      <div class="info-left">
        <div><span class="label">Principal:</span>${escapeHtml(header?.PRIN_CODE)} ${escapeHtml(header?.PRIN_NAME)}</div>
        <div><span class="label">Transfer No.:</span>${escapeHtml(header?.STN_NO)}
             &nbsp;&nbsp;<span class="label">Date :</span>${formatDate(header?.STN_DATE)}</div>
        <div><span class="label">Description:</span>${escapeHtml(header?.DESCRIPTION)}</div>
      </div>
      <div class="info-right">
        <div><span class="label">Confirmed :</span>${yesNo(header?.HDR_CONFIRMED)}</div>
        <div><span class="label">Confirm Date :</span>${formatDate(header?.HDR_CONFIRMED_DATE)}</div>
      </div>
    </div>`;

  const tableHtml = `
    <table>
      <thead>
        <tr>
          <th rowspan="2">No.</th>
          <th rowspan="2">Product</th>
          <th colspan="3">From Site</th>
          <th colspan="3">To Site</th>
          <th colspan="4">Quantity</th>
        </tr>
        <tr>
          <th>Fr.Site</th>
          <th>Loc Start</th>
          <th>Loc End</th>
          <th>To Site</th>
          <th>Loc Start</th>
          <th>Loc End</th>
          <th>Qty Puom</th>
          <th>Uom</th>
          <th>Qty Luom</th>
          <th>Uom</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
      </tbody>
    </table>`;

  const title = `Stock transfer entry  |  STN #${text(header?.STN_NO ?? stn_no)}`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(
    buildPage({
      title,
      username: userName,
      reportName: "rpt_transfer_entry",
      infoBlockHtml,
      tableHtml,
    }),
  );
};

// ─── Excel export ─────────────────────────────────────────────────────────
// Same raw-XLSX-via-AdmZip approach used by the Trial Balance drilldown
// export (buildXlsxBuffer / buildDetailExcel) — no external xlsx-writer
// dependency, styled cells via inline styleSheet + cellXfs indices.

const excelStyles = {
  title: {
    font: { bold: true, sz: 13, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "1A5F4A" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: {
      top: { style: "thin", color: { rgb: "1A5F4A" } },
      bottom: { style: "thin", color: { rgb: "1A5F4A" } },
      left: { style: "thin", color: { rgb: "1A5F4A" } },
      right: { style: "thin", color: { rgb: "1A5F4A" } },
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
      top: { style: "thin", color: { rgb: "1A5F4A" } },
      bottom: { style: "thin", color: { rgb: "1A5F4A" } },
      left: { style: "thin", color: { rgb: "1A5F4A" } },
      right: { style: "thin", color: { rgb: "1A5F4A" } },
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
  statusRow: {
    font: { italic: true, color: { rgb: "555555" } },
    alignment: { vertical: "top" },
    border: { bottom: { style: "thin", color: { rgb: "E2E8F0" } } },
  },
};

const styleIdBySignature = new Map<string, number>([
  [JSON.stringify(excelStyles.title), 1],
  [JSON.stringify(excelStyles.meta), 2],
  [JSON.stringify(excelStyles.tableHead), 3],
  [JSON.stringify(excelStyles.normal), 4],
  [JSON.stringify(excelStyles.number), 5],
  [JSON.stringify(excelStyles.statusRow), 6],
]);

type Cell = { v: string | number; s?: Record<string, unknown> };
type SheetRow = (Cell | string | number | null | undefined)[];

function cell(v: string | number, s?: Record<string, unknown>): Cell {
  return { v, s };
}

/**
 * Builds the Stock Transfer Excel workbook: header/meta rows, an info block
 * (Principal / Transfer No / Description / Confirmed), then the line-item
 * table with a status line under every row — mirroring the HTML layout.
 */
function buildStockTransferExcel(header: any, rows: any[], username: string): Buffer {
  const printDateTime = formatReportTimestamp(new Date());
  const stnNo = text(header?.STN_NO);

  const titleRow: SheetRow = [cell("al madina LOGISTICS - Stock Transfer Entry", excelStyles.title)];
  const metaRows: SheetRow[] = [
    [],
    [cell("Title :", excelStyles.meta), `Stock transfer entry | STN #${stnNo}`],
    [cell("Date :", excelStyles.meta), printDateTime],
    [cell("User :", excelStyles.meta), username],
    [],
    [cell("Principal :", excelStyles.meta), `${text(header?.PRIN_CODE)} ${text(header?.PRIN_NAME)}`],
    [cell("Transfer No. :", excelStyles.meta), stnNo],
    [cell("Doc Date :", excelStyles.meta), formatDate(header?.STN_DATE)],
    [cell("Description :", excelStyles.meta), text(header?.DESCRIPTION)],
    [cell("Confirmed :", excelStyles.meta), yesNo(header?.HDR_CONFIRMED)],
    [cell("Confirm Date :", excelStyles.meta), formatDate(header?.HDR_CONFIRMED_DATE)],
    [],
  ];

  const tableHead: SheetRow = [
    "No.", "Product", "Fr.Site", "Fr.Loc Start", "Fr.Loc End",
    "To Site", "To.Loc Start", "To.Loc End", "Qty Puom", "P.Uom", "Qty Luom", "L.Uom",
  ].map((h) => cell(h, excelStyles.tableHead));

  const sheetRows: SheetRow[] = [titleRow, ...metaRows, tableHead];
  const dataStartRow = sheetRows.length + 1;

  rows.forEach((row) => {
    sheetRows.push([
      cell(text(row.SERIAL_NO), excelStyles.normal),
      cell(text(row.PROD_CODE), excelStyles.normal),
      cell(text(row.FROM_SITE), excelStyles.normal),
      cell(text(row.FROM_LOC_START), excelStyles.normal),
      cell(text(row.FROM_LOC_END), excelStyles.normal),
      cell(text(row.TO_SITE), excelStyles.normal),
      cell(text(row.TO_LOC_START), excelStyles.normal),
      cell(text(row.TO_LOC_END), excelStyles.normal),
      cell(Number(row.QTY_PUOM) || 0, excelStyles.number),
      cell(text(row.P_UOM), excelStyles.normal),
      cell(Number(row.QTY_LUOM) || 0, excelStyles.number),
      cell(text(row.L_UOM), excelStyles.normal),
    ]);
    sheetRows.push([
      cell("", excelStyles.statusRow),
      cell(`Status: ${yesNo(row.DTL_CONFIRMED) === "Yes" ? "Confirmed" : "Not Confirmed"}`, excelStyles.statusRow),
    ]);
  });

  if (!rows.length) sheetRows.push([cell("", excelStyles.normal), cell("No data found", excelStyles.normal)]);

  return buildXlsxBuffer(sheetRows, "Stock Transfer", [
    { wch: 8 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 8 },
  ], [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 11 } },
    { s: { r: 2, c: 1 }, e: { r: 2, c: 11 } },
  ]);
}

function buildXlsxBuffer(
  sheetRows: SheetRow[],
  sheetName: string,
  cols: { wch: number }[],
  merges: { s: { r: number; c: number }; e: { r: number; c: number } }[],
): Buffer {
  const XLSX_COL_LETTER = (c: number) => {
    let s = "";
    let n = c;
    while (n >= 0) {
      s = String.fromCharCode((n % 26) + 65) + s;
      n = Math.floor(n / 26) - 1;
    }
    return s;
  };
  const encodeCell = (r: number, c: number) => `${XLSX_COL_LETTER(c)}${r + 1}`;
  const encodeRange = (m: { s: { r: number; c: number }; e: { r: number; c: number } }) =>
    `${encodeCell(m.s.r, m.s.c)}:${encodeCell(m.e.r, m.e.c)}`;

  const getStyleId = (s?: Record<string, unknown>) => {
    if (!s) return 0;
    return styleIdBySignature.get(JSON.stringify(s)) || 0;
  };

  const colXml = cols
    .map((col, i) => `<col min="${i + 1}" max="${i + 1}" width="${Number(col.wch || 12)}" customWidth="1"/>`)
    .join("");

  let sheetData = "";
  let maxCol = 0;
  sheetRows.forEach((row, r) => {
    const cells: string[] = [];
    row.forEach((raw, c) => {
      maxCol = Math.max(maxCol, c);
      if (raw === null || raw === undefined || raw === "") return;
      const isCellObj = typeof raw === "object";
      const value = isCellObj ? (raw as Cell).v : raw;
      const styleId = isCellObj ? getStyleId((raw as Cell).s) : 0;
      const ref = encodeCell(r, c);
      const attrs = `r="${ref}"${styleId ? ` s="${styleId}"` : ""}`;
      if (typeof value === "number") {
        cells.push(`<c ${attrs}><v>${value}</v></c>`);
      } else {
        cells.push(`<c ${attrs} t="inlineStr"><is><t>${escapeXml(value ?? "")}</t></is></c>`);
      }
    });
    if (cells.length) sheetData += `<row r="${r + 1}">${cells.join("")}</row>`;
  });

  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${encodeRange(m)}"/>`).join("")}</mergeCells>`
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
  <fonts count="4">
    <font><sz val="10"/><name val="Arial"/></font>
    <font><b/><sz val="13"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF000000"/><name val="Arial"/></font>
    <font><i/><sz val="10"/><color rgb="FF555555"/><name val="Arial"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1A5F4A"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF1A5F4A"/></left><right style="thin"><color rgb="FF1A5F4A"/></right>
      <top style="thin"><color rgb="FF1A5F4A"/></top><bottom style="thin"><color rgb="FF1A5F4A"/></bottom>
      <diagonal/>
    </border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="7">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
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
  zip.addFile("[Content_Types].xml", Buffer.from(contentTypes));
  zip.addFile("_rels/.rels", Buffer.from(rels));
  zip.addFile("xl/workbook.xml", Buffer.from(workbookXml));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheetXml));
  zip.addFile("xl/styles.xml", Buffer.from(stylesXml));
  return zip.toBuffer();
}

function sendExcel(res: Response, buffer: Buffer, filename: string) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.end(buffer);
}

export const stockTransferReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const { stn_no, prin_code, company_code } = req.query;
    const sql = buildStockTransferSql(company_code, prin_code, stn_no);
    const result = await raw_sql_api({ sql, req });

    const rows: any[] = result.rows || [];
    const header = rows[0];
    const userName = req.user?.loginid ?? "";

    const buffer = buildStockTransferExcel(header, rows, userName);
    sendExcel(res, buffer, `stock_transfer_${text(stn_no)}.xlsx`);
  } catch (error: any) {
    console.error("Stock Transfer Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// ─── Stock Confirmation report ("Confirmation report" / rpt_transfer_confirmed)
// ─────────────────────────────────────────────────────────────────────────
//
// Source query (as supplied) — TS_BATCH is the confirmed movement detail,
// grouped per line item (PACKDET_NO) into a "Move from" / "Move to" pair,
// matching the layout of the stock_confirmation.pdf reference:
//
//   No | Product              | Site Code | Location | Exp Date | Batch No | Lot No | Qty Puom | Uom | Qty Luom | Uom | Quantity
//   1    8140F02-MOA ... UPPP:1
//        Move from              C1          030902     01/05/15                       18         BAGS  18         BAGS  18
//        Move to                C1          012202     01/05/15                       18         BAGS  18         BAGS  18
//                                                                                       36                36                36   <- totals
//
// NOTE ON THE SQL: TS_STN.ALLOCATED/CONFIRMED and TS_BATCH.ALLOCATED/CONFIRMED
// are selected WITHOUT aliases. Oracle/node-oracledb will collapse those to a
// single ALLOCATED / CONFIRMED key per row (the batch-level value wins), so
// `header?.CONFIRMED` below is not reliably the header's confirmation flag —
// same class of issue as PRIN_NAME missing from the Stock Transfer query.
// Recommend aliasing in the SQL: TS_STN.CONFIRMED AS HDR_CONFIRMED,
// TS_STN.ALLOCATED AS HDR_ALLOCATED — the code below prefers HDR_CONFIRMED /
// HDR_ALLOCATED if present and falls back to CONFIRMED / ALLOCATED otherwise.

function buildStockConfirmationSql(stn_no: string, prin_code: string, company_code: string): string {
  return `
SELECT
    TS_STN.STN_NO,
    TS_STN.PRIN_CODE,
    TS_STN.DESCRIPTION,
    TS_STN.STN_DATE,
    TS_STN.ALLOCATED,
    TS_STN.ALLOCATED_DATE,
    TS_STN.CONFIRMED,
    TS_STN.CONFIRMED_DATE,

    TS_BATCH.PROD_CODE,
    TS_BATCH.TXN_TYPE,
    TS_BATCH.SITE_CODE,
    TS_BATCH.LOCATION_CODE,
    TS_BATCH.QTY_PUOM,
    TS_BATCH.P_UOM,
    TS_BATCH.QTY_LUOM,
    TS_BATCH.L_UOM,
    TS_BATCH.QUANTITY,
    TS_BATCH.PACKDET_NO,
    TS_BATCH.APPLIED_KEYNO,
    TS_BATCH.ALLOCATED,
    TS_BATCH.CONFIRMED,
    TS_BATCH.LOT_NO,
    TS_BATCH.MFG_DATE,
    TS_BATCH.EXP_DATE,
    TS_BATCH.BATCH_NO,

    MS_PRODUCT.PROD_NAME,
    MS_PRODUCT.UPPP

FROM
    TS_BATCH,
    TS_STN,
    MS_PRODUCT

WHERE
    TS_BATCH.COMPANY_CODE = TS_STN.COMPANY_CODE
    AND TS_BATCH.PRIN_CODE = TS_STN.PRIN_CODE
    AND TS_BATCH.STN_NO = TS_STN.STN_NO
    AND TS_BATCH.CONFIRMED = 'Y'

    AND TS_STN.PRIN_CODE = MS_PRODUCT.PRIN_CODE
    AND TS_STN.COMPANY_CODE = MS_PRODUCT.COMPANY_CODE
    AND TS_BATCH.PROD_CODE = MS_PRODUCT.PROD_CODE
    AND TS_BATCH.COMPANY_CODE = MS_PRODUCT.COMPANY_CODE
    AND TS_BATCH.PRIN_CODE = MS_PRODUCT.PRIN_CODE

    AND TS_STN.COMPANY_CODE = ${company_code}
    AND TS_STN.PRIN_CODE = ${prin_code}
    AND TS_STN.STN_NO = ${stn_no}
  `;
}

// TXN_TYPE → action label. ADJUST THESE to match the real TS_BATCH.TXN_TYPE
// codes in your schema — 'O'/'I' (and a few common synonyms) are assumed
// here based on the "Move from" / "Move to" pairing seen in the PDF.
const TXN_TYPE_LABELS: Record<string, string> = {
  O: "Move from",
  OUT: "Move from",
  FROM: "Move from",
  "1": "Move from",
  I: "Move to",
  IN: "Move to",
  TO: "Move to",
  "2": "Move to",
};

function txnTypeLabel(v: any): string {
  const key = String(v ?? "").trim().toUpperCase();
  return TXN_TYPE_LABELS[key] ?? key;
}

function moveSortWeight(v: any): number {
  const label = txnTypeLabel(v);
  if (label === "Move from") return 0;
  if (label === "Move to") return 1;
  return 2;
}

interface ConfirmationLine {
  packdetNo: string;
  prodCode: string;
  prodName: string;
  uppp: string;
  rows: any[];
}

function groupConfirmationRows(rows: any[]): ConfirmationLine[] {
  const groups = new Map<string, ConfirmationLine>();
  const order: string[] = [];

  for (const row of rows) {
    const key = text(row.PACKDET_NO ?? `${row.PROD_CODE}-${row.APPLIED_KEYNO}`);
    if (!groups.has(key)) {
      groups.set(key, {
        packdetNo: key,
        prodCode: text(row.PROD_CODE),
        prodName: text(row.PROD_NAME),
        uppp: text(row.UPPP),
        rows: [],
      });
      order.push(key);
    }
    groups.get(key)!.rows.push(row);
  }

  order.forEach((key) => {
    groups.get(key)!.rows.sort((a, b) => moveSortWeight(a.TXN_TYPE) - moveSortWeight(b.TXN_TYPE));
  });

  // PACKDET_NO is typically numeric — sort numerically when possible so line
  // numbers render in the same order as the PDF, falling back to insertion
  // order for non-numeric keys.
  return order
    .map((key) => groups.get(key)!)
    .sort((a, b) => {
      const na = Number(a.packdetNo);
      const nb = Number(b.packdetNo);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return 0;
    });
}

// ─── HTML report ──────────────────────────────────────────────────────────

export const stockConfirmationReportHtml = async (req: RequestWithUser, res: Response) => {
  const { stn_no, prin_code, company_code } = req.query;

  const sql = buildStockConfirmationSql(stn_no, prin_code, company_code);
  const result = await raw_sql_api({
    sql,
    req,
  });
  const rows: any[] = result.rows || [];
  const header = rows[0];
  const userName = req.user?.loginid ?? "";

  const headerConfirmed = header?.HDR_CONFIRMED ?? header?.CONFIRMED;
  const headerAllocated = header?.HDR_ALLOCATED ?? header?.ALLOCATED;

  const lines = groupConfirmationRows(rows);

  let no = 0;
  const bodyRows =
    lines
      .map((line) => {
        no += 1;
        const detailRows = line.rows
          .map((row) => {
            const qtyPuom = Number(row.QTY_PUOM) || 0;
            const qtyLuom = Number(row.QTY_LUOM) || 0;
            const quantity = Number(row.QUANTITY) || 0;
            return `
        <tr>
          <td class="center"></td>
          <td class="left" style="font-weight:700">${escapeHtml(txnTypeLabel(row.TXN_TYPE))}</td>
          <td class="center">${escapeHtml(row.SITE_CODE)}</td>
          <td class="center">${escapeHtml(row.LOCATION_CODE)}</td>
          <td class="center">${formatDate(row.EXP_DATE || row.exp_date)}</td>
          <td class="center">${escapeHtml(row.BATCH_NO ?? row.batch_no)}</td>
          <td class="center">${escapeHtml(row.LOT_NO ?? row.lot_no)}</td>
          <td class="num">${escapeHtml(qtyPuom)}</td>
          <td class="center">${escapeHtml(row.P_UOM)}</td>
          <td class="num">${escapeHtml(qtyLuom)}</td>
          <td class="center">${escapeHtml(row.L_UOM)}</td>
          <td class="num">${escapeHtml(quantity)}</td>
        </tr>`;
          })
          .join("");

        const totals = line.rows.reduce(
          (acc, row) => ({
            qtyPuom: acc.qtyPuom + (Number(row.QTY_PUOM) || 0),
            qtyLuom: acc.qtyLuom + (Number(row.QTY_LUOM) || 0),
            quantity: acc.quantity + (Number(row.QUANTITY) || 0),
          }),
          { qtyPuom: 0, qtyLuom: 0, quantity: 0 },
        );

        return `
        <tr>
          <td class="center">${no}</td>
          <td class="left" colspan="6">${escapeHtml(line.prodCode)} ${escapeHtml(line.prodName)}</td>
          <td class="right" colspan="5">UPPP:${escapeHtml(line.uppp)}</td>
        </tr>
        ${detailRows}
        <tr class="total-row">
          <td class="empty" colspan="7"></td>
          <td>${escapeHtml(totals.qtyPuom)}</td>
          <td class="empty"></td>
          <td>${escapeHtml(totals.qtyLuom)}</td>
          <td class="empty"></td>
          <td>${escapeHtml(totals.quantity)}</td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="12" class="center" style="color:#666">No data found</td></tr>`;

  const infoBlockHtml = `
    <div class="info-block">
      <div class="info-left">
        <div><span class="label">Principal:</span>${escapeHtml(header?.PRIN_CODE)}</div>
        <div><span class="label">Transfer No.:</span>${escapeHtml(header?.STN_NO)}
             &nbsp;&nbsp;<span class="label">Date :</span>${formatDate(header?.STN_DATE)}</div>
        <div><span class="label">Description:</span>${escapeHtml(header?.DESCRIPTION)}</div>
      </div>
      <div class="info-right">
        <div><span class="label">Confirmed :</span>${yesNo(headerConfirmed)}</div>
        <div><span class="label">Confirm Date :</span>${formatDate(header?.CONFIRMED_DATE)}</div>
      </div>
    </div>`;

  const tableHtml = `
    <table>
      <thead>
        <tr>
          <th style="width:32px">No.</th>
          <th>Product</th>
          <th style="width:56px">Site Code</th>
          <th style="width:65px">Location</th>
          <th style="width:70px">Exp Date</th>
          <th style="width:65px">Batch No</th>
          <th style="width:60px">Lot No</th>
          <th style="width:65px">Qty Puom</th>
          <th style="width:45px">Uom</th>
          <th style="width:65px">Qty Luom</th>
          <th style="width:45px">Uom</th>
          <th style="width:65px">Quantity</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
      </tbody>
    </table>`;

  const title = `Confirmation report  |  STN #${text(header?.STN_NO ?? stn_no)}`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(
    buildPage({
      title,
      username: userName,
      reportName: "rpt_transfer_confirmed",
      infoBlockHtml,
      tableHtml,
    }),
  );
};

// ─── Excel export ─────────────────────────────────────────────────────────

function buildStockConfirmationExcel(header: any, lines: ConfirmationLine[], username: string): Buffer {
  const printDateTime = formatReportTimestamp(new Date());
  const stnNo = text(header?.STN_NO);
  const headerConfirmed = header?.HDR_CONFIRMED ?? header?.CONFIRMED;

  const titleRow: SheetRow = [cell("al madina LOGISTICS - Confirmation Report", excelStyles.title)];
  const metaRows: SheetRow[] = [
    [],
    [cell("Title :", excelStyles.meta), `Confirmation report | STN #${stnNo}`],
    [cell("Date :", excelStyles.meta), printDateTime],
    [cell("User :", excelStyles.meta), username],
    [],
    [cell("Principal :", excelStyles.meta), text(header?.PRIN_CODE)],
    [cell("Transfer No. :", excelStyles.meta), stnNo],
    [cell("Doc Date :", excelStyles.meta), formatDate(header?.STN_DATE)],
    [cell("Description :", excelStyles.meta), text(header?.DESCRIPTION)],
    [cell("Confirmed :", excelStyles.meta), yesNo(headerConfirmed)],
    [cell("Confirm Date :", excelStyles.meta), formatDate(header?.CONFIRMED_DATE)],
    [],
  ];

  const tableHead: SheetRow = [
    "No.", "Product", "Site Code", "Location", "Exp Date", "Batch No", "Lot No",
    "Qty Puom", "P.Uom", "Qty Luom", "L.Uom", "Quantity",
  ].map((h) => cell(h, excelStyles.tableHead));

  const sheetRows: SheetRow[] = [titleRow, ...metaRows, tableHead];

  lines.forEach((line, idx) => {
    sheetRows.push([
      cell(idx + 1, excelStyles.normal),
      cell(`${line.prodCode} ${line.prodName}  (UPPP:${line.uppp})`, excelStyles.normal),
    ]);

    const totals = { qtyPuom: 0, qtyLuom: 0, quantity: 0 };
    line.rows.forEach((row) => {
      const qtyPuom = Number(row.QTY_PUOM) || 0;
      const qtyLuom = Number(row.QTY_LUOM) || 0;
      const quantity = Number(row.QUANTITY) || 0;
      totals.qtyPuom += qtyPuom;
      totals.qtyLuom += qtyLuom;
      totals.quantity += quantity;

      sheetRows.push([
        cell("", excelStyles.normal),
        cell(txnTypeLabel(row.TXN_TYPE), excelStyles.normal),
        cell(text(row.SITE_CODE), excelStyles.normal),
        cell(text(row.LOCATION_CODE), excelStyles.normal),
        cell(formatDate(row.EXP_DATE || row.exp_date), excelStyles.normal),
        cell(text(row.BATCH_NO ?? row.batch_no), excelStyles.normal),
        cell(text(row.LOT_NO ?? row.lot_no), excelStyles.normal),
        cell(qtyPuom, excelStyles.number),
        cell(text(row.P_UOM), excelStyles.normal),
        cell(qtyLuom, excelStyles.number),
        cell(text(row.L_UOM), excelStyles.normal),
        cell(quantity, excelStyles.number),
      ]);
    });

    sheetRows.push([
      cell("", excelStyles.normal), cell("", excelStyles.normal), cell("", excelStyles.normal),
      cell("", excelStyles.normal), cell("", excelStyles.normal), cell("", excelStyles.normal),
      cell("", excelStyles.normal),
      cell(totals.qtyPuom, excelStyles.number),
      cell("", excelStyles.normal),
      cell(totals.qtyLuom, excelStyles.number),
      cell("", excelStyles.normal),
      cell(totals.quantity, excelStyles.number),
    ]);
  });

  if (!lines.length) sheetRows.push([cell("", excelStyles.normal), cell("No data found", excelStyles.normal)]);

  return buildXlsxBuffer(sheetRows, "Confirmation", [
    { wch: 6 }, { wch: 30 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 10 },
  ], [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 11 } },
    { s: { r: 2, c: 1 }, e: { r: 2, c: 11 } },
  ]);
}

export const stockConfirmationReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const { stn_no, prin_code, company_code } = req.query;
    const sql = buildStockConfirmationSql(stn_no, prin_code, company_code);
    console.log("Stock Confirmation SQL:", sql);
    const result = await raw_sql_api({
      sql,
      req,
    });

    const rows: any[] = result.rows || [];
    const header = rows[0];
    const userName = req.user?.loginid ?? "";
    const lines = groupConfirmationRows(rows);

    const buffer = buildStockConfirmationExcel(header, lines, userName);
    sendExcel(res, buffer, `stock_confirmation_${text(stn_no)}.xlsx`);
  } catch (error: any) {
    console.error("Stock Confirmation Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};