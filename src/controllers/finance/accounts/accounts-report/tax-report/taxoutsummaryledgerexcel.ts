import { Request, Response } from "express";
import oracledb from "oracledb";
// @ts-ignore
const AdmZip = require("adm-zip");
import TenantManager from "../../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../../middleware/tenantContext.middleware";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const money = (v: any) => {
  const n = Number(v);
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
};
const text = (v: any) => (v == null ? "" : String(v));
const formatDateStr = (v: any) => {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-GB");
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

// ─── Shared DB fetch ──────────────────────────────────────────────────────────
async function fetchRows(req: Request) {
  const {
    parameter, loginid,
    code1, code2, code3, code4, code5, code6, code7, code8, code20,
  } = req.body;

  let tenantId = getCurrentTenantId();
  if (!tenantId && loginid) tenantId = await TenantManager.getTenantForUser(loginid);
  if (!tenantId) throw new Error("Tenant not found");

  const connection = await TenantManager.getConnection(tenantId);
  try {
    const binds: any = {
      parameter: parameter || "Account_Tax_Report_VAT_OUT_ACCOUNT_LEDGER_SUMMARY_REPORT",
      loginid: loginid || "ADMIN",
      code1: code1 || null, code2: code2 || null, code3: code3 || null,
      code4: code4 || null, code5: code5 || null, code6: code6 || null,
      code7: code7 || null, code8: code8 || null, code20: code20 || null,
      out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };
    for (let i = 9; i <= 20; i++) binds[`code${i}`] = req.body[`code${i}`] || null;
    for (let i = 1; i <= 4; i++) {
      binds[`number${i}`] = req.body[`number${i}`] || null;
      if (i > 2) binds[`date${i}`] = req.body[`date${i}`] || null;
    }
    binds.date1 = null;
    binds.date2 = null;

    const result = await connection.execute(
      `DECLARE v_sql VARCHAR2(32767); BEGIN PROC_BUILD_DYNAMIC_SQL_COMMON20(
          :parameter, :loginid,
          :code1, :code2, :code3, :code4, :code5, :code6, :code7, :code8, :code9, :code10,
          :code11, :code12, :code13, :code14, :code15, :code16, :code17, :code18, :code19, :code20,
          :number1, :number2, :number3, :number4,
          :date1, :date2, :date3, :date4,
          v_sql); :out_sql := v_sql; END;`,
      binds
    );

    const rawSql = (result.outBinds as any).out_sql;
    if (!rawSql) throw new Error("The procedure did not return a valid SQL query.");
    console.log("Generated SQL for Tax Invoice Summary Report:", rawSql);

    const dataResult = await connection.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return {
      rows: (dataResult.rows as any[]).map((row) =>
        Object.keys(row).reduce((acc: any, key) => {
          acc[key.toLowerCase()] = row[key];
          return acc;
        }, {})
      ),
      connection,
    };
  } catch (e) {
    await connection.close();
    throw e;
  }
}

// ─── Excel Style IDs ──────────────────────────────────────────────────────────
const STYLE_ID = {
  default:   0,
  company:   1,
  title:     2,
  section:   3,
  tableHead: 4,
  normal:    5,
  numData:   6,
} as const;
type StyleKey = keyof typeof STYLE_ID;
interface XlCell { v: unknown; s: number }
function xc(v: unknown, style: StyleKey): XlCell { return { v, s: STYLE_ID[style] }; }

// ─── Excel Buffer Builder ─────────────────────────────────────────────────────
function buildTaxSummaryExcelBuffer(rows: any[], loginid: string, parameter: string): Buffer {
  type Row = (XlCell | null)[];
  const skip = null;
  const NCOLS = 5;

  const tableRows: Row[] = [];

  // Row 1 — Company
  tableRows.push([xc("AL MADINA LOGISTICS SERVICES COMPANY", "company"), ...Array(NCOLS - 1).fill(skip)]);

  // Row 2 — Report Title
  tableRows.push([xc("Tax Register Summary Report", "title"), ...Array(NCOLS - 1).fill(skip)]);

  // Row 3 — Date | User  (date spans cols 1–2, user spans cols 4–5)
  tableRows.push([
    xc(`Date : ${formatDateStr(new Date())}`, "section"),
    skip,
    skip,
    xc(`User : ${loginid}`, "section"),
    skip,
  ]);

  // Row 4 — Parameter
  tableRows.push([xc(`Report : ${text(parameter)}`, "section"), ...Array(NCOLS - 1).fill(skip)]);

  // Row 5 — Spacer
  tableRows.push(Array(NCOLS).fill(skip));

  // Row 6 — Table Header
  tableRows.push([
    xc("Ac Code",                  "tableHead"),
    xc("Ac Name",                  "tableHead"),
    xc("Invoice Amount",           "tableHead"),
    xc("Taxable Invoice Amount",   "tableHead"),
    xc("Tax Amount",               "tableHead"),
  ]);

  // ── Totals ────────────────────────────────────────────────────────────────
  let totalInvAmount     = 0;
  let totalTaxableInvAmt = 0;
  let totalTaxAmount     = 0;

  // Data rows
  rows.forEach((r) => {
    const invAmount     = Number(r.inv_amount)      || 0;
    const taxableInvAmt = Number(r.taxable_inv_amt) || 0;
    const taxAmount     = Number(r.tax_amount)      || 0;

    totalInvAmount     += invAmount;
    totalTaxableInvAmt += taxableInvAmt;
    totalTaxAmount     += taxAmount;

    tableRows.push([
      xc(text(r.ac_code), "normal"),
      xc(text(r.ac_name), "normal"),
      xc(formatBalance(invAmount),       "numData"),
      xc(formatBalance(taxableInvAmt),   "numData"),
      xc(formatBalance(taxAmount),       "numData"),
    ]);
  });

  // Grand Total row
  tableRows.push([
    xc("TOTAL", "company"),
    skip,
    xc(formatBalance(totalInvAmount),     "numData"),
    xc(formatBalance(totalTaxableInvAmt), "numData"),
    xc(formatBalance(totalTaxAmount),     "numData"),
  ]);

  // ── Build merges ────────────────────────────────────────────────────────────
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
      } else {
        ci++;
      }
    }
  });

  // ── Build sheet XML ──────────────────────────────────────────────────────────
  const COL_WIDTHS = [18, 42, 20, 24, 18];
  const colXml = COL_WIDTHS.map((w, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`
  ).join("");

  let sheetDataXml = "";
  tableRows.forEach((row, ri) => {
    const rn = ri + 1;
    const ht =
      rn === 1 ? ` ht="24" customHeight="1"` :
      rn === 2 ? ` ht="20" customHeight="1"` :
      rn === 6 ? ` ht="30" customHeight="1"` : "";

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

  // ── Styles XML ───────────────────────────────────────────────────────────────
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="7">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF374151"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF374151"/><name val="Calibri"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="none"/></fill>
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
      <left style="thin"><color rgb="FF1E3A5F"/></left>
      <right style="thin"><color rgb="FF1E3A5F"/></right>
      <top style="thin"><color rgb="FF1E3A5F"/></top>
      <bottom style="thin"><color rgb="FF1E3A5F"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="7">
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
      <alignment vertical="top" wrapText="1"/>
    </xf>
    <!-- 6: numData (right-align, #,##0.000) -->
    <xf numFmtId="164" fontId="6" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1">
      <alignment horizontal="right" vertical="top"/>
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
    `<sheets><sheet name="Tax Summary" sheetId="1" r:id="rId1"/></sheets>` +
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

// ─── HTML Controller ──────────────────────────────────────────────────────────
export const getTaxInvoiceSummaryReport = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    const { parameter, loginid } = req.body;
    const { rows, connection: conn } = await fetchRows(req);
    connection = conn;

    let totalInvAmount = 0, totalTaxableInvAmt = 0, totalTaxAmount = 0;
    let tableBodyHtml = "";

    rows.forEach((r) => {
      const invAmount     = Number(r.inv_amount)      || 0;
      const taxableInvAmt = Number(r.taxable_inv_amt) || 0;
      const taxAmount     = Number(r.tax_amount)      || 0;

      totalInvAmount     += invAmount;
      totalTaxableInvAmt += taxableInvAmt;
      totalTaxAmount     += taxAmount;

      tableBodyHtml += `
        <tr class="data-row">
          <td>${text(r.ac_code)}</td>
          <td>${text(r.ac_name)}</td>
          <td class="num">${formatBalance(invAmount)}</td>
          <td class="num">${formatBalance(taxableInvAmt)}</td>
          <td class="num">${formatBalance(taxAmount)}</td>
        </tr>`;
    });

    tableBodyHtml += `
      <tr class="grand-total-row">
        <td colspan="2" style="text-align:right"><strong>Total :</strong></td>
        <td class="num"><strong>${formatBalance(totalInvAmount)}</strong></td>
        <td class="num"><strong>${formatBalance(totalTaxableInvAmt)}</strong></td>
        <td class="num"><strong>${formatBalance(totalTaxAmount)}</strong></td>
      </tr>`;

    const reportTitle = "Tax Register Summary Report";
    const generatedBy = text(loginid) || "Unknown User";
    const reportDate  = formatDateStr(new Date());

    const reportHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${reportTitle}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; padding: 10px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #e5e7eb; color: #1f2937; }
    .page { width: 180mm; max-width: 180mm; min-height: 190mm; margin: 10px auto; padding: 14px; background: #fff; border-radius: 8px; box-shadow: 0 8px 20px rgba(15,23,42,0.08); box-sizing: border-box; }
    .header-brand { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e3a5f; padding-bottom: 8px; margin-bottom: 8px; }
    .report-title { font-size: 14px; font-weight: 800; color: #0f172a; }
    .brand-name { font-size: 18px; font-weight: 800; letter-spacing: 0.1em; color: #0d4d89; text-align: right; }
    .brand-subtitle { font-size: 10px; letter-spacing: 0.1em; color: #334155; text-align: right; }
    .header-meta { border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px 12px; margin-bottom: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 2px 60px; }
    .header-meta .row { display: flex; align-items: baseline; gap: 8px; font-size: 11px; }
    .header-meta .lbl { font-weight: 700; color: #374151; min-width: 55px; }
    .header-meta .val { color: #111827; }
    .report-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .report-table th, .report-table td { border: 1px solid #94a3b8; padding: 4px 6px; font-size: 9.5px; vertical-align: middle; word-break: break-word; overflow-wrap: break-word; }
    .report-table thead th { background: #1e3a5f; color: #fff; font-weight: 700; text-align: center; white-space: normal; line-height: 1.3; }
    .report-table th:nth-child(1), .report-table td:nth-child(1) { width: 15%; }
    .report-table th:nth-child(2), .report-table td:nth-child(2) { width: 37%; }
    .report-table th:nth-child(3), .report-table td:nth-child(3) { width: 16%; text-align: right; }
    .report-table th:nth-child(4), .report-table td:nth-child(4) { width: 16%; text-align: right; }
    .report-table th:nth-child(5), .report-table td:nth-child(5) { width: 16%; text-align: right; }
    .data-row td { background: #fff; }
    .data-row:nth-child(even) td { background: #f8fafc; }
    .data-row:hover td { background: #eff6ff; }
    .grand-total-row td { background: #1e3a5f; color: #fff; font-weight: 700; font-size: 10px; border-top: 2px solid #0d4d89; }
    .num { text-align: right; font-family: 'Courier New', monospace; }
    .summary-section { margin-top: 14px; display: flex; justify-content: flex-end; }
    .summary-table { border-collapse: collapse; min-width: 320px; }
    .summary-table td { padding: 4px 10px; font-size: 11px; border: 1px solid #cbd5e1; }
    .summary-table .s-label { font-weight: 700; color: #374151; text-align: right; background: #f1f5f9; white-space: nowrap; }
    .summary-table .s-value { text-align: right; font-family: 'Courier New', monospace; font-weight: 700; color: #0f172a; background: #fff; min-width: 110px; }
    .footer { margin-top: 10px; text-align: center; font-size: 9px; border-top: 1px solid #e2e8f0; padding-top: 4px; color: #64748b; }
    .no-print { margin-bottom: 10px; text-align: right; }
    .button { display: inline-flex; align-items: center; gap: 6px; padding: 7px 18px; border-radius: 999px; border: none; background: #0d4d89; color: white; font-weight: 700; cursor: pointer; font-size: 12px; }
    .button:hover { background: #1d4ed8; }
    @media print {
      body { background: #fff; padding: 0; }
      .page { width: 100% !important; max-width: 100% !important; min-height: 0 !important; margin: 0 !important; padding: 5mm !important; box-shadow: none !important; border-radius: 0 !important; }
      .no-print { display: none; }
      thead { display: table-header-group; }
      tr { page-break-inside: avoid; break-inside: avoid; }
      .grand-total-row { page-break-inside: avoid; break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button class="button" onclick="window.print()">🖨 Print / Save PDF</button>
  </div>
  <div class="page">
    <div class="header-brand">
      <div class="report-title">${reportTitle}</div>
      <div>
        <div class="brand-name">AL MADINA</div>
        <div class="brand-subtitle">LOGISTICS</div>
      </div>
    </div>
    <div class="header-meta">
      <div class="row"><span class="lbl">Title :</span><span class="val">${reportTitle}</span></div>
      <div class="row"><span class="lbl">Report :</span><span class="val">${text(parameter)}</span></div>
      <div class="row"><span class="lbl">Date :</span><span class="val">${reportDate}</span></div>
      <div class="row"><span class="lbl">User :</span><span class="val">${generatedBy}</span></div>
    </div>
    <table class="report-table">
      <thead>
        <tr>
          <th>Ac Code</th>
          <th>Ac Name</th>
          <th class="num">Invoice<br/>Amount</th>
          <th class="num">Taxable Invoice<br/>Amount</th>
          <th class="num">Tax<br/>Amount</th>
        </tr>
      </thead>
      <tbody>${tableBodyHtml || '<tr><td colspan="5" style="text-align:center;padding:36px 0;color:#64748b;">No records found for the selected criteria.</td></tr>'}</tbody>
    </table>
    <div class="summary-section">
      <table class="summary-table">
        <tr><td class="s-label">Total Invoice Amount :</td><td class="s-value">${formatBalance(totalInvAmount)}</td></tr>
        <tr><td class="s-label">Total Taxable Invoice Amount :</td><td class="s-value">${formatBalance(totalTaxableInvAmt)}</td></tr>
        <tr><td class="s-label">Total Tax Amount :</td><td class="s-value">${formatBalance(totalTaxAmount)}</td></tr>
      </table>
    </div>
    <div class="footer">Generated by ${generatedBy} &bull; ${reportDate} &bull; Currency: OMR</div>
  </div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html");
    res.status(200).send(reportHtml);

  } catch (error: any) {
    console.error("Tax Invoice Summary Report Error:", error);
    res.status(500).json({ success: false, message: "Unable to generate report", details: error.message });
  } finally {
    if (connection) { try { await connection.close(); } catch (e) { console.error(e); } }
  }
};

// ─── Excel Controller ─────────────────────────────────────────────────────────
export const exportTaxInvoiceSummaryExcel = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    const { parameter, loginid } = req.body;
    const { rows, connection: conn } = await fetchRows(req);
    connection = conn;

    const buffer = buildTaxSummaryExcelBuffer(rows, text(loginid) || "ADMIN", text(parameter));

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="TaxRegisterSummaryReport.xlsx"`);
    res.send(buffer);

  } catch (error: any) {
    console.error("Tax Invoice Summary Excel Error:", error);
    res.status(500).json({ success: false, message: "Unable to generate Excel", details: error.message });
  } finally {
    if (connection) { try { await connection.close(); } catch (e) { console.error(e); } }
  }
};