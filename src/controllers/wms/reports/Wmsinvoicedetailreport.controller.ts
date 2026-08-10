import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

export interface InvoiceDetailRow {
  T_TYPE: string; JOB_NO: string; PROD_CODE: string; PROD_NAME: string;
  SITE_IND: string | null; TXN_DATE: string | null; INV_DATE: string | null;
  QTY: number | null; DAYSCHARGED: number | null; VOLUME: number | null;
  AMOUNT: number; ACT_GROUP_NAME: string | null; PRIN_CODE: string;
  CPU: number | null; VAT_AMT: number | null; SITE_CODE: string | null;
  DIV_CODE: string;
}

interface InvoiceMeta {
  invoiceNo: string;
  prinCode: string;
  prinName: string;
  periodFrom: string;
  periodTo: string;
}

interface ActivityGroup {
  groupName: string;
  jobs: JobCluster[];
  groupAmount: number;
  groupVat: number;
}

interface JobCluster {
  jobNo: string;
  docRef: string;
  rows: ReportRow[];
  subAmount: number;
  subVat: number;
}

// ─── DB helpers (shared pattern — move to a common module if one already exists) ──

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid)
    tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenantId)
    throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
  return TenantManager.getConnection(tenantId);
}

async function closeConn(conn?: oracledb.Connection) {
  if (conn) try { await conn.close(); } catch (e) { console.warn("Close conn error:", e); }
}

function normalize(rows: any[] = []): ReportRow[] {
  return rows.map((row) =>
    Object.keys(row).reduce((acc: ReportRow, key) => {
      acc[key.toLowerCase()] = row[key];
      return acc;
    }, {})
  );
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function dateText(value: unknown): string {
  if (!value) return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value).substring(0, 10);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function escapeHtml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeXml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function numFmt(value: unknown, decimals = 3): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.000";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ─── Data loader ──────────────────────────────────────────────────────────────
// Union of three billing sources, now served via VW_INVOICE_DETAIL:
//   t_type '2' = MNSTORAGE_DET   (recurring storage charges)
//   t_type '3' = TO_STORAGETXN   (one-off storage transactions)
//   t_type '1' = TN_INVOICE_DET  (job/activity based billing)
// All three branches are aligned by POSITION, not by alias — the column names
// below come from the first branch (t_type '2'). Two mapping quirks carried
// over from the source query, kept intentionally:
//   • t_type '1' rows carry their DOC_REF value in the SITE_IND column
//     position (there is no dedicated doc-ref column in that branch).
//   • t_type '3' folds its doc_ref directly into the JOB_NO string
//     ("<job_type>-<job_no>  Ref:<doc_ref>") rather than a separate column.
// If MNSTORAGE_DET (t_type '2') actually has its own reference/import number
// column (the sample PDF shows one, e.g. "IMP-1026074956"), add it to the
// t_type '2' branch as JOB_NO instead of the current empty string literal
// (that change now belongs in the VW_INVOICE_DETAIL view definition, not here).
//
// IMPORTANT: the view can't carry bind-parameter filters itself, so
// company_code / prin_code / consolidated_invno filtering happens here.
// consolidated_invno is applied ONLY to t_type '2'/'3' rows — t_type '1'
// (TN_INVOICE_DET) never had that filter in the original query, so it's
// deliberately excluded from that condition below. Filtering it the same
// way as the other branches would silently drop all job-cost lines.

const INVOICE_DETAIL_SQL = `
SELECT *
  FROM VW_INVOICE_DETAIL
 WHERE company_code = :as_companycode
   AND prin_code    = :as_princode
   AND (
         t_type = '1'
         OR nvl(consolidated_invno, ' ') = :as_consolidated_invno
       )`;

async function loadInvoiceDetailData(
  req: RequestWithUser,
  prinCode: string,
  consolidatedInvNo: string
): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    console.log('DEBUG invoice detail:', { 
  company_code: req.user.company_code, 
  prin_code: prinCode, 
  invoice_no: consolidatedInvNo 
});
    const result = await conn.execute(
      INVOICE_DETAIL_SQL,
      {
        as_companycode: req.user.company_code,
        as_princode: prinCode,
        as_consolidated_invno: consolidatedInvNo,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const rows = normalize(result.rows as any[]);
    if (!rows.length)
      throw Object.assign(new Error("No billable items found for this invoice"), { status: 500 });
    return rows;
  } finally {
    await closeConn(conn);
  }
}

// ─── Grouping ─────────────────────────────────────────────────────────────────
const STORAGE_GROUP_LABEL = "DC- WAREHOUSE STORAGE";

function docRefOf(row: ReportRow): string {
  // t_type '1' stores its doc_ref in the site_ind position (see SQL comment above).
  return row.t_type === "1" ? text(row.site_ind) : "";
}

function billingDateOf(row: ReportRow): unknown {
  return row.txn_date ?? row.inv_date;
}

function groupRows(rows: ReportRow[]): { groups: ActivityGroup[]; grandAmount: number; grandVat: number } {
  const groupMap = new Map<string, Map<string, JobCluster>>();

  for (const row of rows) {
    const groupName =
      row.t_type === "2" || row.t_type === "3"
        ? STORAGE_GROUP_LABEL
        : text(row.act_group_name).trim() || "OTHER SERVICES";
    const jobKey = `${text(row.job_no)}|${docRefOf(row)}`;

    if (!groupMap.has(groupName)) groupMap.set(groupName, new Map());
    const jobs = groupMap.get(groupName)!;
    if (!jobs.has(jobKey)) {
      jobs.set(jobKey, { jobNo: text(row.job_no), docRef: docRefOf(row), rows: [], subAmount: 0, subVat: 0 });
    }
    const cluster = jobs.get(jobKey)!;
    cluster.rows.push(row);
    cluster.subAmount += Number(row.amount) || 0;
    cluster.subVat += Number(row.vat_amt) || 0;
  }

  let grandAmount = 0;
  let grandVat = 0;
  const groups: ActivityGroup[] = [];
  for (const [groupName, jobs] of groupMap) {
    const jobList = Array.from(jobs.values());
    const groupAmount = jobList.reduce((s, j) => s + j.subAmount, 0);
    const groupVat = jobList.reduce((s, j) => s + j.subVat, 0);
    grandAmount += groupAmount;
    grandVat += groupVat;
    groups.push({ groupName, jobs: jobList, groupAmount, groupVat });
  }
  return { groups, grandAmount, grandVat };
}

// ─── HTML renderer ────────────────────────────────────────────────────────────

function renderHtml(rows: ReportRow[], meta: InvoiceMeta, loginId: string, autoPrint: boolean): string {
  const { groups, grandAmount, grandVat } = groupRows(rows);
  const printDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });

  const rowLine = (row: ReportRow) => `
    <tr class="item-row">
      <td class="c-job">
        <span class="job-no">${escapeHtml(row.job_no) || "—"}</span>
        <span class="job-desc">${escapeHtml(row.prod_code)}${row.prod_name ? " " + escapeHtml(row.prod_name) : ""}</span>
      </td>
      <td>${escapeHtml(docRefOf(row)) || "—"}</td>
      <td>${escapeHtml(dateText(billingDateOf(row)))}</td>
      <td class="c-num">${escapeHtml(numFmt(row.qty))}</td>
      <td class="c-num">${escapeHtml(numFmt(row.volume))}</td>
      <td class="c-num">${escapeHtml(numFmt(row.cpu))}</td>
      <td class="c-num c-amount">${escapeHtml(numFmt(row.amount))}</td>
      <td class="c-num">${escapeHtml(numFmt(row.vat_amt))}</td>
    </tr>`;

  const jobBlock = (job: JobCluster) => `
    ${job.rows.map(rowLine).join("")}
    <tr class="subtotal-row">
      <td colspan="6" class="st-label">Total :</td>
      <td class="c-num c-amount">${escapeHtml(numFmt(job.subAmount))}</td>
      <td class="c-num">${escapeHtml(numFmt(job.subVat))}</td>
    </tr>`;

  const groupBlock = (group: ActivityGroup) => `
    <tr class="group-row"><td colspan="8">${escapeHtml(group.groupName)}</td></tr>
    ${group.jobs.map(jobBlock).join("")}
    <tr class="grouptotal-row">
      <td colspan="6" class="gt-label">Group Total :</td>
      <td class="c-num c-amount">${escapeHtml(numFmt(group.groupAmount))}</td>
      <td class="c-num">${escapeHtml(numFmt(group.groupVat))}</td>
    </tr>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Invoice Detail Report - ${escapeHtml(meta.invoiceNo)}</title>
  <style>
    @page { size: A4; margin: 10mm 12mm; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Segoe UI", Calibri, Arial, sans-serif; font-size: 13px; color: #111827;
           background: #eef1f6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sheet { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff;
             padding: 10mm 12mm; border: 1px solid #c4cdd9; }
    .rpt-header { background: #1e1b4b; color: #fff; text-align: center; font-size: 15px;
                  font-weight: 700; letter-spacing: .10em; padding: 10px 16px;
                  text-transform: uppercase; border-radius: 3px 3px 0 0; }
    .rpt-sub { text-align: center; font-size: 10.5px; color: #6b7280; padding: 6px 0 12px;
               border-bottom: 2px solid #1e1b4b; margin-bottom: 14px; }
    .meta-box { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 32px;
                background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px;
                padding: 10px 14px; margin-bottom: 16px; }
    .meta-row { display: flex; font-size: 11px; }
    .meta-label { color: #6b7280; min-width: 100px; }
    .meta-value { font-weight: 600; color: #111827; }

    table { width: 100%; border-collapse: collapse; }
    thead th { background: #1e1b4b; color: #fff; padding: 7px 6px; font-size: 9px;
               font-weight: 700; text-align: left; border: 1px solid #312e81; white-space: nowrap; }
    thead th.c-num { text-align: right; }
    tbody td { padding: 6px; font-size: 10.5px; border: 1px solid #e5e7eb; vertical-align: top; }
    .c-num { text-align: right; white-space: nowrap; }
    .c-amount { font-weight: 700; color: #111827; }
    .c-job { min-width: 150px; }
    .job-no { display: block; font-weight: 700; color: #111827; }
    .job-desc { display: block; font-size: 9.5px; color: #6b7280; margin-top: 1px; }

    .group-row td { background: #eef2ff; color: #4338ca; font-weight: 700; font-size: 10px;
                     text-transform: uppercase; letter-spacing: .04em; border: 1px solid #c7d2fe; }
    .subtotal-row td { background: #f8fafc; font-weight: 600; border-top: 1.5px solid #cbd5e1; }
    .st-label { text-align: right; color: #4b5563; }
    .grouptotal-row td { background: #f1f5f9; font-weight: 700; border-top: 1.5px solid #94a3b8; }
    .gt-label { text-align: right; color: #1e1b4b; }
    .grandtotal-row td { background: #1e1b4b; color: #fff; font-weight: 700;
                          border-top: 2px solid #1e1b4b; }
    .grandtotal-label { text-align: right; }

    .sign-block { display: grid; grid-template-columns: 1fr 1fr; gap: 0 40px;
                  margin-top: 28px; page-break-inside: avoid; }
    .sign-label { font-size: 9.5px; font-weight: 700; color: #1e1b4b; text-transform: uppercase;
                  letter-spacing: .05em; margin-bottom: 26px; }
    .sign-line { border-bottom: 1px solid #9ca3af; height: 1px; }

    .rpt-footer { margin-top: 16px; border-top: 1px solid #e2e8f0; padding-top: 7px;
                  display: flex; justify-content: space-between; font-size: 9px; color: #9ca3af; }
    @media print {
      body { background: #fff; }
      .sheet { border: none; margin: 0; width: auto; min-height: auto; padding: 0; }
      .item-row, .subtotal-row, .grouptotal-row, .group-row { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <main class="sheet">
    <div class="rpt-header">Invoice Detail Report</div>
    <div class="rpt-sub">For the Period ${escapeHtml(dateText(meta.periodFrom))} — ${escapeHtml(dateText(meta.periodTo))}</div>

    <div class="meta-box">
      <div class="meta-row"><span class="meta-label">Date</span><span class="meta-value">${escapeHtml(printDate)}</span></div>
      <div class="meta-row"><span class="meta-label">User</span><span class="meta-value">${escapeHtml(loginId)}</span></div>
      <div class="meta-row"><span class="meta-label">Principal</span><span class="meta-value">${escapeHtml(meta.prinCode)} — ${escapeHtml(meta.prinName)}</span></div>
      <div class="meta-row"><span class="meta-label">Invoice Sr.No</span><span class="meta-value">${escapeHtml(meta.invoiceNo)}</span></div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Job No. / Description</th>
          <th>Doc Ref.</th>
          <th>Billing Date</th>
          <th class="c-num">Qty.</th>
          <th class="c-num">Vol/Wt/Plt/Case</th>
          <th class="c-num">Rate</th>
          <th class="c-num">Amount</th>
          <th class="c-num">VAT</th>
        </tr>
      </thead>
      <tbody>
        ${groups.map(groupBlock).join("")}
        <tr class="grandtotal-row">
          <td colspan="6" class="grandtotal-label">Grand Total :</td>
          <td class="c-num">${escapeHtml(numFmt(grandAmount))}</td>
          <td class="c-num">${escapeHtml(numFmt(grandVat))}</td>
        </tr>
      </tbody>
    </table>

    <div class="sign-block">
      <div>
        <div class="sign-label">Checked By</div>
        <div class="sign-line"></div>
      </div>
      <div>
        <div class="sign-label">Approved By</div>
        <div class="sign-line"></div>
      </div>
    </div>

    <div class="rpt-footer">
      <span>End of Report</span>
      <span>Powered by Bayanat Technology</span>
    </div>
  </main>
  <script>
    window.addEventListener("message", (e) => {
      if (e.data === "print") window.print();
    });
    ${autoPrint ? `window.addEventListener("load", () => setTimeout(() => window.print(), 300));` : ""}
  </script>
</body>
</html>`;
}

// ─── Excel builder ────────────────────────────────────────────────────────────
// Uses AdmZip (already in the project) — same pattern as the Adjustment
// Confirmation and Job Details reports. STYLE_ID must stay in sync with the
// <cellXfs> order in stylesXml below.

const STYLE_ID = {
  default:      0,
  header:       1, // white text, dark-indigo bg, centered
  meta:         2, // gray label
  metaValue:    3, // dark bold
  tableHeader:  4, // white text, dark-indigo bg, small, centered
  groupRow:     5, // indigo text, lavender bg
  cell:         6, // plain bordered cell
  subtotal:     7, // light gray bg, bold
  groupTotal:   8, // slate bg, bold
  grandTotal:   9, // indigo bg, white bold
} as const;

type StyleKey = keyof typeof STYLE_ID;
interface XlCell { v: unknown; s: number }
function xc(v: unknown, style: StyleKey): XlCell {
  return { v, s: STYLE_ID[style] };
}

function buildExcelBuffer(rows: ReportRow[], meta: InvoiceMeta, loginId: string): Buffer {
  const NCOLS = 8;
  const skip = null;
  type Row = (XlCell | null)[];
  const xlRows: Row[] = [];

  xlRows.push([xc(`Invoice Detail Report — ${text(meta.invoiceNo)}`, "header"), skip, skip, skip, skip, skip, skip, skip]);
  xlRows.push([xc(`Period: ${dateText(meta.periodFrom)} - ${dateText(meta.periodTo)}`, "meta"), skip, skip, skip, skip, skip, skip, skip]);
  xlRows.push(Array(NCOLS).fill(skip));

  xlRows.push([xc("Principal", "meta"), xc(`${text(meta.prinCode)} - ${text(meta.prinName)}`, "metaValue"), skip, xc("Invoice Sr.No", "meta"), xc(meta.invoiceNo, "metaValue"), skip, skip, skip]);
  xlRows.push([xc("User", "meta"), xc(loginId, "metaValue"), skip, skip, skip, skip, skip, skip]);
  xlRows.push(Array(NCOLS).fill(skip));

  xlRows.push([
    xc("Job No.", "tableHeader"), xc("Description", "tableHeader"), xc("Doc Ref.", "tableHeader"),
    xc("Billing Date", "tableHeader"), xc("Qty.", "tableHeader"), xc("Vol/Wt/Plt/Case", "tableHeader"),
    xc("Rate", "tableHeader"), xc("Amount / VAT", "tableHeader"),
  ]);

  const { groups, grandAmount, grandVat } = groupRows(rows);
  for (const group of groups) {
    xlRows.push([xc(group.groupName, "groupRow"), skip, skip, skip, skip, skip, skip, skip]);
    for (const job of group.jobs) {
      for (const row of job.rows) {
        xlRows.push([
          xc(job.jobNo || "—", "cell"),
          xc(`${text(row.prod_code)} ${text(row.prod_name)}`.trim(), "cell"),
          xc(docRefOf(row) || "—", "cell"),
          xc(dateText(billingDateOf(row)), "cell"),
          xc(Number(row.qty) || 0, "cell"),
          xc(Number(row.volume) || 0, "cell"),
          xc(Number(row.cpu) || 0, "cell"),
          xc(`${numFmt(row.amount)} / ${numFmt(row.vat_amt)}`, "cell"),
        ]);
      }
      xlRows.push([xc("Total", "subtotal"), skip, skip, skip, skip, skip, skip, xc(`${numFmt(job.subAmount)} / ${numFmt(job.subVat)}`, "subtotal")]);
    }
    xlRows.push([xc("Group Total", "groupTotal"), skip, skip, skip, skip, skip, skip, xc(`${numFmt(group.groupAmount)} / ${numFmt(group.groupVat)}`, "groupTotal")]);
  }
  xlRows.push([xc("Grand Total", "grandTotal"), skip, skip, skip, skip, skip, skip, xc(`${numFmt(grandAmount)} / ${numFmt(grandVat)}`, "grandTotal")]);

  const COL_WIDTHS = [18, 30, 14, 14, 10, 14, 10, 20];
  const colXml = COL_WIDTHS.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");

  const merges: string[] = [];
  xlRows.forEach((row, ri) => {
    const rn = ri + 1;
    let spanStart = -1;
    row.forEach((cell, ci) => {
      if (cell !== null && spanStart === -1) {
        spanStart = ci;
      } else if (cell === null && spanStart !== -1) {
        let end = ci;
        while (end + 1 < row.length && row[end + 1] === null) end++;
        if (end > spanStart) merges.push(`${String.fromCharCode(65 + spanStart)}${rn}:${String.fromCharCode(65 + end)}${rn}`);
        spanStart = -1;
      } else if (cell !== null) {
        spanStart = ci;
      }
    });
  });

  let sheetDataXml = "";
  xlRows.forEach((row, ri) => {
    const rn = ri + 1;
    const ht = rn === 1 ? ` ht="22" customHeight="1"` : "";
    let rowXml = `<row r="${rn}"${ht}>`;
    row.forEach((cell, ci) => {
      if (cell === null) return;
      const ref = `${String.fromCharCode(65 + ci)}${rn}`;
      if (typeof cell.v === "number") {
        rowXml += `<c r="${ref}" s="${cell.s}"><v>${cell.v}</v></c>`;
      } else {
        rowXml += `<c r="${ref}" s="${cell.s}" t="inlineStr"><is><t>${escapeXml(cell.v ?? "")}</t></is></c>`;
      }
    });
    rowXml += `</row>`;
    sheetDataXml += rowXml;
  });

  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
           xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colXml}</cols>
  <sheetData>${sheetDataXml}</sheetData>
  ${mergeXml}
</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="8">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><sz val="9"/><color rgb="FF6B7280"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF111827"/><name val="Calibri"/></font>
    <font><b/><sz val="9"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="9"/><color rgb="FF4338CA"/><name val="Calibri"/></font>
    <font><sz val="9"/><color rgb="FF374151"/><name val="Calibri"/></font>
    <font><b/><sz val="9"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="7">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E1B4B"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEEF2FF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right>
      <top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="10">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="0" fontId="7" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Invoice Detail" sheetId="1" r:id="rId1"/></sheets>
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

// ─── Route handlers ───────────────────────────────────────────────────────────

// Only prin_code and invoice_no (consolidated_invno) are required — company_code
// is never taken from the request, it comes from the authenticated tenant
// context (req.user.company_code) exactly like the ADJ_CONFIRM controller.
// prin_name and the period range are cosmetic only: prin_name defaults to the
// prin_code if not supplied, and the period is derived from the min/max
// billing date actually present in the returned rows.

function readRequiredParams(req: RequestWithUser): { prinCode: string; invoiceNo: string } {
  return {
    prinCode: text(req.query.prin_code || req.params.prin_code),
    invoiceNo: text(req.query.invoice_no || req.params.invoice_no),
  };
}

function buildMeta(prinCode: string, invoiceNo: string, prinNameParam: string, rows: ReportRow[]): InvoiceMeta {
  const dates = rows
    .map((r) => billingDateOf(r))
    .filter(Boolean)
    .map((d) => new Date(String(d)).getTime())
    .filter((t) => !Number.isNaN(t));

  return {
    invoiceNo,
    prinCode,
    prinName: prinNameParam || prinCode,
    periodFrom: dates.length ? new Date(Math.min(...dates)).toISOString() : "",
    periodTo: dates.length ? new Date(Math.max(...dates)).toISOString() : "",
  };
}

export const getWmsInvoiceDetailReportHtml = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { prinCode, invoiceNo } = readRequiredParams(req);
    const autoPrint = req.query.print === "true";

    if (!prinCode || !invoiceNo) {
      res.status(400).json({ success: false, message: "prin_code and invoice_no are required" });
      return;
    }
    const rows = await loadInvoiceDetailData(req, prinCode, invoiceNo);
    const meta = buildMeta(prinCode, invoiceNo, text(req.query.prin_name), rows);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderHtml(rows, meta, text(req.user?.loginid), autoPrint));
  } catch (error: any) {
    console.error("WMS Invoice Detail HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getWmsInvoiceDetailReportExcel = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { prinCode, invoiceNo } = readRequiredParams(req);

    if (!prinCode || !invoiceNo) {
      res.status(400).json({ success: false, message: "prin_code and invoice_no are required" });
      return;
    }
    const rows = await loadInvoiceDetailData(req, prinCode, invoiceNo);
    const meta = buildMeta(prinCode, invoiceNo, text(req.query.prin_name), rows);
    const buffer = buildExcelBuffer(rows, meta, text(req.user?.loginid));

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Invoice_${meta.invoiceNo}_Detail.xlsx"`);
    res.end(buffer); // res.end() prevents Express buffer re-encoding
  } catch (error: any) {
    console.error("WMS Invoice Detail Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};