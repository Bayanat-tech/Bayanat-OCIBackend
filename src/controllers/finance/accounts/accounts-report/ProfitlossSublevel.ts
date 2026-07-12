import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../../interfaces/common.interface";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function text(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

function amount(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtNumber(n: number): string {
  const abs = Math.abs(n);
  const fmt = abs.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
  return n < 0 ? `(${fmt})` : fmt;
}

function dateText(v: unknown): string {
  if (!v) return "";
  const d = new Date(String(v));
  return isNaN(d.getTime())
    ? String(v).substring(0, 10)
    : d.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
}

function escapeHtml(v: unknown): string {
  return text(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeXml(v: unknown): string {
  return text(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalize(rows: any[] = []): ReportRow[] {
  return rows.map((row) =>
    Object.keys(row).reduce((acc: ReportRow, key) => {
      acc[key.toLowerCase()] = row[key];
      return acc;
    }, {})
  );
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid)
    tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenantId)
    throw Object.assign(
      new Error("Unable to determine tenant database"),
      { status: 400 }
    );
  return TenantManager.getConnection(tenantId);
}

async function closeConn(conn?: oracledb.Connection) {
  if (conn) try { await conn.close(); } catch (e) { console.warn("closeConn:", e); }
}

// ─── Param parser ─────────────────────────────────────────────────────────────

function parseCommon(req: RequestWithUser) {
  const companyCode = text(req.body.company_code || req.user?.company_code);
  const fromDate = text(req.body.from_date);
  const toDate = text(req.body.to_date);
  const divisionCode = text(req.body.division_code || "All");

  if (!companyCode || !fromDate || !toDate)
    throw Object.assign(
      new Error("company_code, from_date, and to_date are required"),
      { status: 400 }
    );

  return { companyCode, fromDate, toDate, divisionCode };
}

// ─── Shared page shell ────────────────────────────────────────────────────────

const PAGE_CSS = `
  @page { size: A4 landscape; margin: 10mm; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, sans-serif; font-size: 11px; color: #000;
    background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet {
    min-width: 260mm; margin: 14px auto; background: #fff;
    padding: 8mm 10mm; border: 1px solid #000; border-radius: 0;
  }
  .logo-area { margin-bottom: 10px; }
  .divider-thick { border-top: 2px solid #000; margin: 7px 0 4px; }
  .divider-thin  { border-top: 1px solid #000; margin: 4px 0 8px; }
  .meta-grid {
    display: grid; grid-template-columns: auto 1fr auto 1fr;
    gap: 2px 8px; font-size: 11px; margin-bottom: 6px;
  }
  .meta-label { font-weight: 700; white-space: nowrap; }
  .drill-hint {
    font-size: 10px; color: #000; background: #fff;
    border: 1px solid #000; border-radius: 0;
    padding: 4px 10px; margin-bottom: 8px;
    display: inline-flex; align-items: center; gap: 6px;
  }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th {
    border: 1px solid #000; padding: 4px 8px;
    font-weight: 700; background: #fff; color: #000;
  }
  th.left  { text-align: left; }
  th.right { text-align: right; }
  th.center { text-align: center; }
  td { border: 1px solid #000; padding: 3px 8px; vertical-align: top; }
  td.center { text-align: center; }
  td.left   { text-align: left; }
  td.num    { text-align: right; font-variant-numeric: tabular-nums; font-family: "Courier New", monospace; }
  td.code   { font-family: monospace; font-size: 10px; }
  td.bold   { font-weight: 700; }
  tr.ac-header td {
    background: #fff; font-weight: 700; color: #000;
    border-top: 2px solid #000; border-bottom: 1px solid #000;
    padding: 4px 8px;
  }
  tr.subtotal-row td {
    background: #fff; font-weight: 700;
    border-top: 1px solid #000;
  }
  tr.closing-row td {
    background: #fff; font-weight: 700;
    border-top: 1px solid #000;
  }
  tr.grand-total-row td {
    background: #fff; color: #000; font-weight: 700;
    font-size: 12px; border-top: 2px solid #000;
    border-bottom: 2px solid #000;
  }
  tr.total-row td {
    border: 2px solid #000; font-weight: 700; background: #fff;
  }
  tr.total-row td.empty { border: 1px solid #000; background: #fff; }
  tr.data-row:hover td { background: #f5f5f5; cursor: pointer; }
  .balance-neg { color: #000; font-weight: 700; }
  .end-of-report {
    text-align: center; margin-top: 10px; margin-bottom: 4px;
    font-size: 10px; border-top: 1px solid #000; padding-top: 5px; color: #000;
  }
  .report-footer {
    display: flex; justify-content: space-between;
    font-size: 10px; color: #000;
    border-top: 1px solid #000; padding-top: 4px; margin-top: 4px;
  }
  @media print {
    body { background: #fff; }
    .sheet { border: none; margin: 0; width: auto; padding: 0; border-radius: 0; }
    .drill-hint { display: none !important; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tbody tr { page-break-inside: avoid; }
  }
`;

const LOGO_SVG = `
 <svg width="160" height="50" viewBox="0 0 360 112" xmlns="http://www.w3.org/2000/svg" style="display:block">
        <rect width="360" height="112" rx="4" fill="#1a5f4a"/>
        <text x="16" y="46" font-family="Arial" font-size="26" font-weight="700" fill="#d4a017">al madina المدينة</text>
        <text x="16" y="72" font-family="Arial" font-size="15" font-weight="400" fill="#d4a017" letter-spacing="4">LOGISTICS اللوجستية</text>
        <polygon points="310,20 355,56 310,92" fill="#d4a017"/>
      </svg>`;

function buildPage(opts: {
  title: string;
  reportName: string;
  tableHtml: string;
  drillScript?: string;
  showDrillHint?: boolean;
  hintText?: string;
  companyCode: string;
  fromDate: string;
  toDate: string;
  divisionCode: string;
  loginId: string;
  extraMeta?: string;
}): string {
  const {
    title, reportName, tableHtml, drillScript = "",
    showDrillHint = false, hintText = "",
    fromDate, toDate, divisionCode, loginId, extraMeta = "",
  } = opts;

  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(title)}</title>
  <style>${PAGE_CSS}</style>
</head>
<body>
  <div class="sheet">
    <div class="logo-area">${LOGO_SVG}</div>
    <div class="divider-thick"></div>
    <div class="meta-grid">
      <span class="meta-label">Title :</span><span>${escapeHtml(title)}</span>
      <span class="meta-label">Date :</span><span>${escapeHtml(printDateTime)}</span>
      <span class="meta-label">Period :</span><span>${escapeHtml(dateText(fromDate))} &ndash; ${escapeHtml(dateText(toDate))}</span>
      <span class="meta-label">User :</span><span>${escapeHtml(loginId)}</span>
      <span class="meta-label">Division :</span><span>${escapeHtml(divisionCode)}</span>
      <span class="meta-label">Report :</span><span>${escapeHtml(reportName)}</span>
      ${extraMeta}
    </div>
    <div class="divider-thin"></div>
    ${showDrillHint ? `
    <div class="drill-hint">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      ${escapeHtml(hintText)}
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

// ─── XLSX styles ──────────────────────────────────────────────────────────────

const SUMMARY_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.000"/></numFmts>
  <fonts count="5">
    <font><sz val="10"/><name val="Arial"/></font>
    <font><b/><sz val="13"/><color rgb="FF000000"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF000000"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF000000"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF000000"/><name val="Arial"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="4">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF000000"/></left>
      <right style="thin"><color rgb="FF000000"/></right>
      <top style="thin"><color rgb="FF000000"/></top>
      <bottom style="thin"><color rgb="FF000000"/></bottom>
      <diagonal/>
    </border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border>
    <border>
      <left style="medium"><color rgb="FF000000"/></left>
      <right style="medium"><color rgb="FF000000"/></right>
      <top style="medium"><color rgb="FF000000"/></top>
      <bottom style="medium"><color rgb="FF000000"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="8">
    <xf numFmtId="0"   fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0"   fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0"   fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0"   fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0"   fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="0"   fontId="4" fillId="0" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="164" fontId="4" fillId="0" borderId="3" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// ─── XLSX zip builder ─────────────────────────────────────────────────────────

function buildXlsxZip(sheetXml: string, stylesXml: string, sheetName: string): Buffer {
  const safe = sheetName.replace(/[\\/?*[\]]/g, "_").substring(0, 31);

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(safe)}" sheetId="1" r:id="rId1"/></sheets>
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
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml"          ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml"            ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
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

// ─── Response helpers ─────────────────────────────────────────────────────────

function sendHtml(res: Response, html: string) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
}

function sendExcel(res: Response, buffer: Buffer, filename: string) {
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.end(buffer);
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEVEL 2 — Account Summary
// Columns: A/C Code | A/C Name | Debit | Credit | Closing
// FIXES APPLIED: doc_date < TO_DATE(:toDate)+1 (inclusive range),
//                NVL(cancelled,'N') <> 'Y' (NULL-safe)
// ═══════════════════════════════════════════════════════════════════════════════

const L2_SQL = `
  SELECT
    TR_AC_DETAIL.company_code,
    TR_AC_DETAIL.ac_code,
    MAX(MS_ACCODES.ac_name)                                          ac_name,
    SUM(CASE WHEN sign_ind > 0 THEN lcur_amount ELSE 0 END)          debit_amount,
    SUM(CASE WHEN sign_ind < 0 THEN lcur_amount ELSE 0 END)          credit_amount,
    SUM(ROUND(lcur_amount * sign_ind, 3))                            closing_amount,
    TR_AC_DETAIL.div_code
  FROM
    TR_AC_DETAIL,
    MS_ACCODES
  WHERE
        TR_AC_DETAIL.ac_code      = MS_ACCODES.ac_code
    AND TR_AC_DETAIL.company_code = :companyCode
    AND TR_AC_DETAIL.doc_date    >= TO_DATE(:fromDate, 'YYYY-MM-DD')
    AND TR_AC_DETAIL.doc_date    <  TO_DATE(:toDate,   'YYYY-MM-DD') + 1
    AND MS_ACCODES.pl_bl_code     = :plCode
    AND TR_AC_DETAIL.doc_type    <> 'EJV'
    AND NVL(TR_AC_DETAIL.cancelled, 'N') <> 'Y'
    AND ('All' = :divisionCode OR TR_AC_DETAIL.div_code = :divisionCode)
  GROUP BY
    TR_AC_DETAIL.div_code,
    TR_AC_DETAIL.company_code,
    TR_AC_DETAIL.ac_code
  ORDER BY
    TR_AC_DETAIL.ac_code
`;

export const getPnlDrilldownL2 = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { companyCode, fromDate, toDate, divisionCode } = parseCommon(req);
    const plCode = text(req.body.pl_code);
    if (!plCode) throw Object.assign(new Error("pl_code is required"), { status: 400 });

    conn = await getConn(req);
    const result = await conn.execute(
      L2_SQL,
      { companyCode, fromDate, toDate, plCode, divisionCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const rows = normalize(result.rows as any[]);

    const totals = rows.reduce(
      (acc, r) => ({
        debit:   acc.debit   + amount(r.debit_amount),
        credit:  acc.credit  + amount(r.credit_amount),
        closing: acc.closing + amount(r.closing_amount),
      }),
      { debit: 0, credit: 0, closing: 0 }
    );

    const dataRows = rows.map((r) =>
      `<tr class="data-row" data-accode="${escapeHtml(r.ac_code)}">
        <td class="center code">${escapeHtml(r.ac_code)}</td>
        <td class="left">${escapeHtml(r.ac_name)}</td>
        <td class="num">${escapeHtml(fmtNumber(amount(r.debit_amount)))}</td>
        <td class="num">${escapeHtml(fmtNumber(amount(r.credit_amount)))}</td>
        <td class="num bold">${escapeHtml(fmtNumber(amount(r.closing_amount)))}</td>
      </tr>`
    ).join("") || `<tr><td colspan="5" class="center" style="color:#000;padding:20px">No data found</td></tr>`;

    const tableHtml = `
      <table>
        <thead>
          <tr>
            <th class="center" style="width:120px">A/C Code</th>
            <th class="left">A/C Name</th>
            <th class="right" style="width:130px">Debit</th>
            <th class="right" style="width:130px">Credit</th>
            <th class="right" style="width:130px">Closing</th>
          </tr>
        </thead>
        <tbody>${dataRows}</tbody>
        <tfoot>
          <tr class="total-row">
            <td class="empty" colspan="2" style="text-align:left;padding-left:10px;font-weight:700"></td>
            <td class="num bold">${escapeHtml(fmtNumber(totals.debit))}</td>
            <td class="num bold">${escapeHtml(fmtNumber(totals.credit))}</td>
            <td class="num bold">${escapeHtml(fmtNumber(totals.closing))}</td>
          </tr>
        </tfoot>
      </table>`;

    // Drill L2 -> L3
    const drillScript = `
    <script>
      (function () {
        var COMPANY_CODE  = ${JSON.stringify(companyCode)};
        var FROM_DATE     = ${JSON.stringify(fromDate)};
        var TO_DATE       = ${JSON.stringify(toDate)};
        var DIVISION_CODE = ${JSON.stringify(divisionCode)};

        document.querySelectorAll("tr.data-row[data-accode]").forEach(function (tr) {
          tr.addEventListener("click", function () {
            var acCode = tr.getAttribute("data-accode");
            window.parent.postMessage({
              type:          "PNL_DRILL_DOWN",
              drillLevel:    "l3",
              company_code:  COMPANY_CODE,
              from_date:     FROM_DATE,
              to_date:       TO_DATE,
              division_code: DIVISION_CODE,
              ac_code:       acCode,
            }, "*");
          });
        });
      })();
    </script>`;

    const title = `Profit & Loss for the Period ${dateText(fromDate)} - ${dateText(toDate)} ( Division : ${divisionCode}) (${plCode})`;

    sendHtml(
      res,
      buildPage({
        title,
        reportName: "rpt_profit_loss",
        tableHtml,
        drillScript,
        showDrillHint: true,
        hintText: "Click any row to drill down to transaction detail",
        companyCode,
        fromDate,
        toDate,
        divisionCode,
        loginId: req.user?.loginid ?? "",
      })
    );
  } catch (error: any) {
    console.error("P&L Drilldown L2 error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  } finally {
    await closeConn(conn);
  }
};

export const getPnlDrilldownL2Excel = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { companyCode, fromDate, toDate, divisionCode } = parseCommon(req);
    const plCode = text(req.body.pl_code);
    if (!plCode) throw Object.assign(new Error("pl_code is required"), { status: 400 });

    conn = await getConn(req);
    const result = await conn.execute(
      L2_SQL,
      { companyCode, fromDate, toDate, plCode, divisionCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const rows = normalize(result.rows as any[]);

    const totals = rows.reduce(
      (acc, r) => ({
        debit:   acc.debit   + amount(r.debit_amount),
        credit:  acc.credit  + amount(r.credit_amount),
        closing: acc.closing + amount(r.closing_amount),
      }),
      { debit: 0, credit: 0, closing: 0 }
    );

    const printDateTime = new Date().toLocaleString("en-GB", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });

    const SHD = 1, SMT = 2, STH = 3, STX = 4, SNM = 5, STL = 6, STN = 7;

    const colWidths = [14, 40, 16, 16, 16];
    const colXml = colWidths
      .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
      .join("");

    const sheetData_rows: any[][] = [
      [`AL MADINA LOGISTICS — P&L Account Summary (PL: ${plCode})`, "", "", "", ""],
      [],
      [`Period: ${dateText(fromDate)} – ${dateText(toDate)}  |  Division: ${divisionCode}  |  User: ${req.user?.loginid ?? ""}  |  Date: ${printDateTime}`, "", "", "", ""],
      [],
      ["A/C Code", "A/C Name", "Debit", "Credit", "Closing"],
    ];

    const DATA_START = sheetData_rows.length + 1;
    rows.forEach((r) => {
      sheetData_rows.push([
        text(r.ac_code),
        text(r.ac_name),
        amount(r.debit_amount),
        amount(r.credit_amount),
        amount(r.closing_amount),
      ]);
    });
    if (!rows.length) sheetData_rows.push(["", "No data found", "", "", ""]);

    const TOTAL_ROW = sheetData_rows.length + 1;
    sheetData_rows.push(["", "", totals.debit, totals.credit, totals.closing]);

    function xc(v: unknown, s: number, ref: string): string {
      if (typeof v === "number") return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
      return `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${escapeXml(v ?? "")}</t></is></c>`;
    }

    const merges = ["A1:E1", "A3:E3", `A${TOTAL_ROW}:B${TOTAL_ROW}`];
    let sheetData = "";

    sheetData_rows.forEach((row, ri) => {
      const rn = ri + 1;
      if (!row || !row.length) return;
      let rowXml = `<row r="${rn}"${rn === 1 ? ` ht="22" customHeight="1"` : ""}>`;
      row.forEach((v, ci) => {
        if (v === "" || v === null || v === undefined) return;
        const ref = String.fromCharCode(65 + ci) + rn;
        let s = 0;
        if (rn === 1) s = SHD;
        else if (rn === 3) s = SMT;
        else if (rn === 5) s = STH;
        else if (rn === TOTAL_ROW) s = ci < 2 ? STL : STN;
        else if (rn >= DATA_START && ci >= 2) s = SNM;
        else if (rn >= DATA_START) s = STX;
        rowXml += xc(v, s, ref);
      });
      rowXml += "</row>";
      sheetData += rowXml;
    });

    const mergeXml = `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`;

    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colXml}</cols>
  <sheetData>${sheetData}</sheetData>
  ${mergeXml}
</worksheet>`;

    const buffer = buildXlsxZip(sheetXml, SUMMARY_STYLES_XML, "Account Summary");
    sendExcel(res, buffer, `pnl_l2_${plCode}_${fromDate}_${toDate}.xlsx`.replace(/\//g, "-"));
  } catch (error: any) {
    console.error("P&L Drilldown L2 Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  } finally {
    await closeConn(conn);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// LEVEL 3 — Transaction Detail (Ledger)
// Columns: A/C Code | Type | Doc No. | Doc Date | Chq No. | Chq Date | Bank | Debit | Credit | Balance
// FIXES APPLIED: doc_date < TO_DATE(:toDate)+1 (inclusive range),
//                NVL(cancelled,'N') <> 'Y' (NULL-safe)
// ═══════════════════════════════════════════════════════════════════════════════

const L3_SQL = `
  SELECT
    d.COMPANY_CODE,
    d.DOC_TYPE,
    d.DOC_NO,
    d.DOC_DATE,
    d.AC_CODE,
    d.REMARKS,
    d.SIGN_IND,
    d.LCUR_AMOUNT,
    d.CHEQUE_NO,
    d.CHEQUE_DATE,
    a.AC_NAME,
    b.AC_NAME  bank_ac_name,
    000000000.000 op_balance,
    d.DIV_CODE
  FROM
    TR_AC_DETAIL d,
    MS_ACCODES   a,
    MS_ACCODES   b
  WHERE
        d.ac_code       = a.ac_code(+)
    AND d.bank_ac_code  = b.ac_code(+)
    AND d.company_code  = :companyCode
    AND d.ac_code       = :acCode
    AND d.doc_date     >= TO_DATE(:fromDate, 'YYYY-MM-DD')
    AND d.doc_date     <  TO_DATE(:toDate,   'YYYY-MM-DD') + 1
    AND NVL(d.cancelled, 'N') <> 'Y'
    AND d.doc_type     <> 'UJV'
    AND ('All' = :divisionCode OR d.div_code = :divisionCode)
  ORDER BY
    d.doc_date,
    d.doc_no
`;

export const getPnlDrilldownL3 = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { companyCode, fromDate, toDate, divisionCode } = parseCommon(req);
    const acCode = text(req.body.ac_code);
    if (!acCode) throw Object.assign(new Error("ac_code is required"), { status: 400 });

    conn = await getConn(req);
    const result = await conn.execute(
      L3_SQL,
      { companyCode, acCode, fromDate, toDate, divisionCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const rows = normalize(result.rows as any[]);

    const acName = text(rows[0]?.ac_name ?? "");
    const opening = 0;
    let runBalance = opening;
    let totalDebit = 0;
    let totalCredit = 0;

    const txRows = rows.map((r) => {
      const signInd = amount(r.sign_ind);
      const lcur    = Math.abs(amount(r.lcur_amount));
      const debit   = signInd >= 0 ? lcur : 0;
      const credit  = signInd <  0 ? lcur : 0;
      runBalance   += debit - credit;
      totalDebit   += debit;
      totalCredit  += credit;

      const balClass = runBalance < 0 ? " balance-neg" : "";
      return `<tr>
        <td class="center code">${escapeHtml(text(r.doc_no ?? ""))}</td>
        <td class="center">${escapeHtml(text(r.doc_type))}</td>
        <td class="center">${escapeHtml(text(r.doc_no ?? ""))}</td>
        <td class="center">${escapeHtml(dateText(r.doc_date))}</td>
        <td class="center">${escapeHtml(text(r.cheque_no ?? ""))}</td>
        <td class="center">${escapeHtml(dateText(r.cheque_date))}</td>
        <td class="left">${escapeHtml(text(r.bank_ac_name ?? ""))}</td>
        <td class="num">${debit  > 0 ? escapeHtml(fmtNumber(debit))  : ""}</td>
        <td class="num">${credit > 0 ? escapeHtml(fmtNumber(credit)) : ""}</td>
        <td class="num${balClass}">${escapeHtml(fmtNumber(runBalance))}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="10" class="center" style="color:#000;padding:20px">No transactions found</td></tr>`;

    const closing = runBalance;

    const tableHtml = `
      <table>
        <thead>
          <tr>
            <th class="center" style="width:90px">A/C Code</th>
            <th class="center" style="width:45px">Type</th>
            <th class="center" style="width:70px">Doc No.</th>
            <th class="center" style="width:82px">Doc Date</th>
            <th class="center" style="width:75px">Chq No.</th>
            <th class="center" style="width:82px">Chq Date</th>
            <th class="left">Bank</th>
            <th class="right" style="width:100px">Debit</th>
            <th class="right" style="width:100px">Credit</th>
            <th class="right" style="width:110px">Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr class="ac-header">
            <td class="code bold">${escapeHtml(acCode)}</td>
            <td colspan="5" class="bold">${escapeHtml(acName)}</td>
            <td class="center bold">Opening</td>
            <td class="num bold">${escapeHtml(fmtNumber(opening))}</td>
            <td></td>
            <td></td>
          </tr>
          ${txRows}
          <tr class="subtotal-row">
            <td colspan="7" class="right bold" style="padding-right:12px">Total :</td>
            <td class="num bold">${escapeHtml(fmtNumber(totalDebit))}</td>
            <td class="num bold">${escapeHtml(fmtNumber(totalCredit))}</td>
            <td></td>
          </tr>
          <tr class="closing-row">
            <td colspan="7" class="right bold" style="padding-right:12px">Closing</td>
            <td class="num bold">${escapeHtml(fmtNumber(closing))}</td>
            <td></td>
            <td></td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="grand-total-row">
            <td colspan="6" class="bold" style="padding-left:12px">Grand Total :</td>
            <td></td>
            <td class="num bold">${escapeHtml(fmtNumber(totalDebit))}</td>
            <td class="num bold">${escapeHtml(fmtNumber(totalCredit))}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>`;

    const title = `Profit & Loss for the Period ${dateText(fromDate)} - ${dateText(toDate)} ( Division : ${divisionCode}) (Ledger of${acCode})`;

    sendHtml(
      res,
      buildPage({
        title,
        reportName: "rpt_profit_loss",
        tableHtml,
        drillScript: "",
        showDrillHint: false,
        companyCode,
        fromDate,
        toDate,
        divisionCode,
        loginId: req.user?.loginid ?? "",
        extraMeta: `<span class="meta-label">Currency :</span><span>OMR</span><span></span><span></span>`,
      })
    );
  } catch (error: any) {
    console.error("P&L Drilldown L3 error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  } finally {
    await closeConn(conn);
  }
};

export const getPnlDrilldownL3Excel = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { companyCode, fromDate, toDate, divisionCode } = parseCommon(req);
    const acCode = text(req.body.ac_code);
    if (!acCode) throw Object.assign(new Error("ac_code is required"), { status: 400 });

    conn = await getConn(req);
    const result = await conn.execute(
      L3_SQL,
      { companyCode, acCode, fromDate, toDate, divisionCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const rows = normalize(result.rows as any[]);

    const acName = text(rows[0]?.ac_name ?? "");
    const printDateTime = new Date().toLocaleString("en-GB", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });

    const SHD = 1, SMT = 2, STH = 3, STX = 4, SNM = 5, STL = 6, STN = 7;
    const colWidths = [10, 8, 10, 12, 12, 12, 22, 14, 14, 14];
    const colXml = colWidths
      .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
      .join("");

    const sheetData_rows: any[][] = [
      [`AL MADINA LOGISTICS — P&L Transaction Detail (${acCode} — ${acName})`, ...Array(9).fill("")],
      [],
      [`Period: ${dateText(fromDate)} – ${dateText(toDate)}  |  Division: ${divisionCode}  |  User: ${req.user?.loginid ?? ""}  |  Date: ${printDateTime}`, ...Array(9).fill("")],
      [],
      ["A/C Code", "Type", "Doc No.", "Doc Date", "Chq No.", "Chq Date", "Bank", "Debit", "Credit", "Balance"],
    ];

    const DATA_START = sheetData_rows.length + 1;
    let runBalance = 0;
    let totalDebit = 0;
    let totalCredit = 0;

    for (const r of rows) {
      const signInd = amount(r.sign_ind);
      const lcur    = Math.abs(amount(r.lcur_amount));
      const debit   = signInd >= 0 ? lcur : 0;
      const credit  = signInd <  0 ? lcur : 0;
      runBalance   += debit - credit;
      totalDebit   += debit;
      totalCredit  += credit;

      sheetData_rows.push([
        acCode,
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
    if (!rows.length) sheetData_rows.push(["No transactions found", ...Array(9).fill("")]);

    const TOTAL_ROW = sheetData_rows.length + 1;
    sheetData_rows.push([`Total — ${acName}`, "", "", "", "", "", "", totalDebit, totalCredit, runBalance]);

    function xc(v: unknown, s: number, ref: string): string {
      if (typeof v === "number") return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
      return `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${escapeXml(v ?? "")}</t></is></c>`;
    }

    const merges = ["A1:J1", "A3:J3", `A${TOTAL_ROW}:G${TOTAL_ROW}`];
    let sheetData = "";

    sheetData_rows.forEach((row, ri) => {
      const rn = ri + 1;
      if (!row || !row.length) return;
      let rowXml = `<row r="${rn}"${rn === 1 ? ` ht="20" customHeight="1"` : ""}>`;
      row.forEach((v, ci) => {
        if (v === "" || v === null || v === undefined) return;
        const ref = String.fromCharCode(65 + ci) + rn;
        let s = 0;
        if (rn === 1) s = SHD;
        else if (rn === 3) s = SMT;
        else if (rn === 5) s = STH;
        else if (rn === TOTAL_ROW) s = ci < 7 ? STL : STN;
        else if (rn >= DATA_START && ci >= 7) s = SNM;
        else if (rn >= DATA_START) s = STX;
        rowXml += xc(v, s, ref);
      });
      rowXml += "</row>";
      sheetData += rowXml;
    });

    const mergeXml = `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`;

    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colXml}</cols>
  <sheetData>${sheetData}</sheetData>
  ${mergeXml}
</worksheet>`;

    const buffer = buildXlsxZip(sheetXml, SUMMARY_STYLES_XML, "Transaction Detail");
    sendExcel(res, buffer, `pnl_l3_${acCode}_${fromDate}_${toDate}.xlsx`.replace(/\//g, "-"));
  } catch (error: any) {
    console.error("P&L Drilldown L3 Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  } finally {
    await closeConn(conn);
  }
};