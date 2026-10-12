import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import {
  buildReportDocument,
  reportAppliedFilters,
  reportFooter,
  reportHeader,
} from "../../common/report_common";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

export interface TInboundActivityRow {
  COMPANY_CODE: string; PRIN_CODE: string; JOB_NO: string; INVOICE_NO: string;
  ACT_CODE: string; SRNO: number; OTHER_SERVICES: string | null; JOB_TYPE: string;
  CONSOLIDATED_INVNO: string | null; CANCELLED: string | null;
  TRANSPORTER_CODE: string | null; VEHICLE_NO: string | null;
  ACTIVITY_GROUP_CODE: string | null; PRIN_NAME: string;
  BILL: number; COST: number; BILL_RATE: number; QUANTITY: number; COST_RATE: number;
  SO_NO: string | null; PO_NO: string | null; DEST_PORT_NAME: string | null; PORT_NAME: string | null;
  DESCRIPTION1: string | null; PORT_CODE: string | null; DESTINATION_PORT: string | null;
  TRANSPORT_MODE: string | null; QTY: number | null; CBM: number | null;
  REMARKS: string | null; TRANSPORTER_NAME: string | null;
}

const NO_DATA_MESSAGE = "No Job found for the selected criteria.";

// ─── DB helpers ───────────────────────────────────────────────────────────────

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

function numFmt(value: unknown, decimals = 2): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "\u2014";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** "OMSLL  Salalah" style: code and name joined with " - ", skipping blanks */
function joinParts(...parts: unknown[]): string {
  return parts.map(text).map((p) => p.trim()).filter(Boolean).join(" - ");
}

// ─── Data loader ──────────────────────────────────────────────────────────────
// One job can have several activity lines (tn_invoice_det rows) — header-level
// fields (job/prin/movement/remarks) repeat identically on every row, so we
// read them off rows[0] and treat the full result set as the activity detail.
// If the job has no activity lines this returns [] (the report then shows
// "No records found", same as the DN Summary report).

async function loadInboundActivityData(
  req: RequestWithUser,
  jobNo: string,
  prinCode: string
): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const result = await conn.execute(
      `SELECT
         tn_invoice_det.company_code, tn_invoice_det.prin_code, tn_invoice_det.job_no,
         tn_invoice_det.invoice_no, tn_invoice_det.act_code, tn_invoice_det.srno,
         tn_invoice_det.other_services, tn_invoice_det.job_type,
         tn_invoice_det.consolidated_invno, tn_invoice_det.cancelled,
         tn_invoice_det.transporter_code, tn_invoice_det.vehicle_no,
         ms_activity.activity_group_code, ms_principal.prin_name,
         tn_invoice_det.bill, tn_invoice_det.cost, tn_invoice_det.bill_rate,
         tn_invoice_det.quantity, tn_invoice_det.cost_rate,
         (select max(order_no) from to_order
           where company_code = tn_invoice_det.company_code
             and prin_code = tn_invoice_det.prin_code
             and job_no = tn_invoice_det.job_no) so_no,
         (select max(po_no) from ti_packdet
           where company_code = tn_invoice_det.company_code
             and prin_code = tn_invoice_det.prin_code
             and job_no = tn_invoice_det.job_no) po_no,
         ti_job.description1, ti_job.port_code,
         (select PORT_NAME from ms_port where port_code = ti_job.port_code ) as PORT_NAME,
         (select PORT_NAME from ms_port where port_code = ti_job.destination_port ) as DEST_PORT_NAME,
         ti_job.destination_port, ti_job.transport_mode,
         (select sum(quantity) from vw_trans
           where company_code = tn_invoice_det.company_code
             and prin_code = tn_invoice_det.prin_code
             and job_no = tn_invoice_det.job_no) qty,
         (select sum(quantity * volume) from vw_trans
           where company_code = tn_invoice_det.company_code
             and prin_code = tn_invoice_det.prin_code
             and job_no = tn_invoice_det.job_no) cbm,
         ti_job.remarks,
         (select transporter_name from ms_transporter
           where transporter_code = tn_invoice_det.transporter_code) transporter_name
       FROM tn_invoice_det, ms_activity, ms_principal, ti_job
       WHERE ( tn_invoice_det.company_code = ms_activity.company_code )
         AND ( tn_invoice_det.act_code = ms_activity.activity_code )
         AND ( tn_invoice_det.company_code = ms_principal.company_code )
         AND ( tn_invoice_det.prin_code = ms_principal.prin_code )
         AND ( tn_invoice_det.company_code = ti_job.company_code )
         AND ( tn_invoice_det.prin_code = ti_job.prin_code )
         AND ( tn_invoice_det.job_no = ti_job.job_no )
         AND ( tn_invoice_det.company_code = :company_code )
         AND ( tn_invoice_det.prin_code = :prin_code )
         AND ( tn_invoice_det.job_no = :job_no )
       ORDER BY tn_invoice_det.srno`,
      { company_code: req.user.company_code, job_no: jobNo, prin_code: prinCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Activity table columns (single header row; ONE alignment per column) ────

type ColAlign = "left" | "center" | "right";

interface ActColumn { label: string; align: ColAlign; width: number } // width in %, sums to 100

const ACT_COLUMNS: ActColumn[] = [
  { label: "Code",        align: "left",  width: 14 },
  { label: "Description", align: "left",  width: 42 },
  { label: "Quantity",    align: "right", width: 14 },
  { label: "Supplier",    align: "left",  width: 30 },
];

// ─── Layout CSS – same look as the Quotation List PDF ────────────────────────
// Used together with fontMode: "native", so the sizes below are the real sizes.
// Letterhead / footer come from report_common; this only styles the body.
// NOTE: row selectors include "tbody" so they out-rank the zebra rule
// (tbody tr:nth-child(even) td) in report_common.

const INBOUND_SERVICE_ACTIVITY_EXTRA_CSS = `
  @page { size: A4 landscape; margin: 6mm 12mm 12mm 12mm; }

  /* Make Chrome print background colors */
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  /* Letterhead – navy rule under the header, Enquiry sizes */
  .company-header {
    border-bottom: 2px solid #00378c;
    padding: 0 0 10px 0;
    margin: 0 0 8px 0;
  }
  .company-name       { font-size: 18px; font-weight: 700; color: #172033; margin: 0 0 2px 0; }
  .company-address    { font-size: 11px; line-height: 1.4; }
  .company-logo-wrap  { max-width: 180px; }
  .company-logo       { max-height: 56px; max-width: 180px; }

  /* Title + filter strip */
  h1.report-title {
    margin: 24px 0 14px 0;
    font-size: 20px;
    font-weight: 700;
    color: #00378c !important;
  }
  .applied-filters { font-size: 10px; margin-bottom: 18px; }

  /* Section strip (Sign-off) */
  .group-title {
    background: #eaf0f8 !important;
    color: #00378c !important;
    font-size: 13px;
    font-weight: 700;
    padding: 8px 8px;
    margin: 16px 0 4px 0;
  }

  /* Label / value grid (3 columns) */
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0 28px;
    margin: 0 0 14px 0;
  }
  .field {
    display: flex;
    align-items: baseline;
    min-height: 24px;
    padding: 4px 6px;
    border-bottom: 1px solid #e2e8f0;
    font-size: 10.5px;
    line-height: 1.3;
  }
  .field .label {
    flex: 0 0 110px;
    padding-right: 8px;
    color: #475569;
    font-weight: 700;
  }
  .field .label::after { content: ":"; }
  .field--empty .label::after { content: ""; }
  .field .value { color: #1e293b; overflow-wrap: anywhere; }

  .filter-header {
    padding: 4px 6px;
    font-size: 11px;
    font-weight: 700;
    color: #00378c;
  }

  /* Data table */
  table.data-table {
    width: 100%;
    table-layout: fixed;
    font-size: 10.5px;
    margin-top: 0;
    border-collapse: collapse;
  }
  table.data-table th,
  table.data-table td {
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  table.data-table .left   { text-align: left   !important; }
  table.data-table .center { text-align: center !important; }
  table.data-table .right  { text-align: right  !important; font-variant-numeric: tabular-nums; }

  /* Header: solid navy bar, white bold text */
  table.data-table thead tr th {
    background: #00378c !important;
    color: #ffffff !important;
    font-weight: 700;
    font-size: 10.5px;
    padding: 12px 8px;
    border: 0 !important;
    text-transform: none;
  }

  /* Section banners: User / Product */
  table.data-table tbody tr.group-header-row td { font-weight: 700; color: #00378c !important; text-align: left; }
  table.data-table tbody tr.user-row td { background: #eaf0f8 !important; font-size: 13px; padding: 11px 8px; }
  table.data-table tbody tr.prod-row td { background: #f4f7fc !important; font-size: 10.5px; padding: 7px 8px 7px 16px; }

  /* Data rows */
  table.data-table tbody tr.data-row td {
    background: #fafcfe !important;
    font-size: 10.5px;
    padding: 9px 8px;
    border-bottom: 1px solid #e2e8f0 !important;
    color: #1e293b;
  }

  /* Totals – shaded, bold navy, right aligned */
  table.data-table tbody tr.subtotal-row td {
    background: #e2e8f0 !important; color: #00378c !important; font-weight: 700; font-size: 10.5px; padding: 8px 8px;
  }
  table.data-table tbody tr.grand-total-row td {
    background: #dbe4f0 !important; color: #00378c !important; font-weight: 700; font-size: 10.5px; padding: 9px 8px;
    border-bottom: 1px solid #cbd5e1 !important;
  }

  @media print {
    body::before { display: none !important; }
    table.data-table thead { display: table-header-group; }
    table.data-table tr { break-inside: avoid; page-break-inside: avoid; }
    table.data-table tr.group-header-row { break-after: avoid; page-break-after: avoid; }
    table.data-table tr.subtotal-row,
    table.data-table tr.grand-total-row  { break-before: avoid; page-break-before: avoid; }
    .info-grid   { break-inside: avoid; }
    .group-title { break-after: avoid; }
    .report-footer { font-size: 10px; }
  }
`;
// Lets the React parent page trigger printing through postMessage.
const PRINT_LISTENER_SCRIPT = `
  <script>
    window.addEventListener("message", function (e) {
      if (e.data === "print") window.print();
    });
  </script>`;

// ─── HTML body renderer ─────────────────────────────────────────────────────

function renderBodyHtml(
  rows: ReportRow[],
  reportTitle: string,
  jobNo: string,
  prinCode: string
): string {
  const C = ACT_COLUMNS;
  const colgroup    = C.map((c) => `<col style="width:${c.width}%" />`).join("");
  const headerCells = C.map((c) => `<th class="${c.align}">${escapeHtml(c.label)}</th>`).join("");

  // ── No activity lines: same behaviour as DN Summary ("No records found") ──
  if (!rows.length) {
    const emptyFilters = reportAppliedFilters([
      { label: "Job No",    value: jobNo },
      { label: "Principal", value: prinCode },
    ]);

    return `
      <h1 class="report-title">${escapeHtml(reportTitle)}</h1>
      ${emptyFilters}
      <table class="data-table">
        <colgroup>${colgroup}</colgroup>
        <thead><tr>${headerCells}</tr></thead>
        <tbody>
          <tr>
            <td colspan="${C.length}" class="center" style="padding: 20px; text-align: center;">
              ${escapeHtml(NO_DATA_MESSAGE)}
            </td>
          </tr>
        </tbody>
      </table>
      ${PRINT_LISTENER_SCRIPT}
    `;
  }

  const d = rows[0];

  const jobText  = `${text(d.job_type)} ${text(d.job_no)}`.trim();
  const prinText = joinParts(d.prin_code, d.prin_name);

  const field = (label: string, value: unknown) =>
    `<div class="field"><span class="label">${escapeHtml(label)}</span> <span class="value">${escapeHtml(text(value) || "\u2014")}</span></div>`;

  const emptyField = `<div class="field field--empty"><span class="label"></span><span class="value"></span></div>`;
  const col = (items: string[], n: number) =>
    items.concat(Array(Math.max(0, n - items.length)).fill(emptyField)).join("");

  const filtersHtml = reportAppliedFilters([
    { label: "Job No",     value: jobText },
    { label: "Principal",  value: text(d.prin_code) },
    { label: "Invoice No", value: text(d.invoice_no) },
  ]);

  const infoLeft = [
    field("Job No",     jobText),
    field("Principal",  prinText),
    field("Invoice No", d.invoice_no),
  ];
  const infoRight = [
    field("Ref #", d.description1),
    field("SO No", d.so_no),
    field("PO No", d.po_no),
  ];

  const moveLeft = [
    `<div class="filter-header">Movement</div>`,
    field("Type of Movement", d.transport_mode),
    field("From",             joinParts(d.port_code, d.port_name)),
    field("To",               joinParts(d.destination_port, d.dest_port_name)),
    field("Quantity",         numFmt(d.qty, 0)),
    field("Volume (CBM)",     numFmt(d.cbm, 3)),
  ];
  const moveRight = [
    `<div class="filter-header">Remarks</div>`,
    field("Remarks", d.remarks),
  ];

  const activityRows = rows.map((r) =>
    `<tr class="data-row">` +
    `<td class="${C[0].align}">${escapeHtml(text(r.act_code) || "\u2014")}</td>` +
    `<td class="${C[1].align}">${escapeHtml(text(r.other_services) || "\u2014")}</td>` +
    `<td class="${C[2].align} num">${escapeHtml(numFmt(r.quantity, 3))}</td>` +
    `<td class="${C[3].align}">${escapeHtml(text(r.transporter_name) || "\u2014")}</td>` +
    `</tr>`
  ).join("");

  return `
    <h1 class="report-title">${escapeHtml(reportTitle)}</h1>
    ${filtersHtml}

    <div class="group-title">Job Information</div>
    <div class="info-grid">
      <div>${col(infoLeft, 3)}</div>
      <div>${col(infoRight, 3)}</div>
    </div>

    <div class="group-title">Activities</div>
    <table class="data-table">
      <colgroup>${colgroup}</colgroup>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${activityRows}</tbody>
    </table>

    <div class="group-title">Movement &amp; Remarks</div>
    <div class="info-grid">
      <div>${moveLeft.join("")}</div>
      <div>${moveRight.join("")}</div>
    </div>
    ${PRINT_LISTENER_SCRIPT}
  `;
}

async function renderHtml(
  req: RequestWithUser,
  rows: ReportRow[],
  reportTitle: string,
  loginId: string,
  autoPrint: boolean,
  jobNo: string,
  prinCode: string
): Promise<string> {
  // company code comes from the data when available, else from the logged-in user
  const companyCode = text(rows[0]?.company_code) || text(req.user?.company_code);

  const headerHtml = await reportHeader({ company_code: companyCode, req });
  const bodyHtml   = renderBodyHtml(rows, reportTitle, jobNo, prinCode);
  const footerHtml = reportFooter({
    reportName: "rpt_inbound_service_activity",
    userName:   loginId,
    endLabel:   "Powered by Bayanat Technology",
  });

  return buildReportDocument({
    title: `${reportTitle} - ${jobNo}`,
    headerHtml,
    bodyHtml,
    footerHtml,
    extraCss: INBOUND_SERVICE_ACTIVITY_EXTRA_CSS,
    autoPrint,
    showPrintButton: true,
    fontMode: "native",
  });
}

// ─── Excel builder ────────────────────────────────────────────────────────────
// Same palette / Arial font as the other reports.
// STYLE_ID values must stay in sync with <cellXfs> order in stylesXml below.

const STYLE_ID = {
  default:      0,
  title:        1,  // blue bold 14, no fill
  sectionTitle: 2,  // blue bold on #eaf0f8
  label:        3,  // slate bold, right-aligned
  value:        4,  // dark, wrapping
  tableHeader:  5,  // white on #00378c, centered
  tableCell:    6,  // left, light bottom border
  tableCellNum: 7,  // right, #,##0.000, light bottom border
  footer:       8,  // italic grey, right
} as const;

type StyleKey = keyof typeof STYLE_ID;

interface XlCell { v: unknown; s: number }

function xc(v: unknown, style: StyleKey): XlCell {
  return { v, s: STYLE_ID[style] };
}

function buildExcelBuffer(rows: ReportRow[], reportTitle: string): Buffer {
  const d     = rows[0];
  const NCOLS = 4;
  const skip  = null;

  type Row = (XlCell | null)[];
  const xlRows: Row[] = [];
  const blank = (): Row => Array(NCOLS).fill(skip);

  const spanRow = (label: string, style: StyleKey) => {
    const row = blank();
    row[0] = xc(label, style);
    xlRows.push(row);
  };

  const jobText  = `${text(d.job_type)} ${text(d.job_no)}`.trim();
  const prinText = joinParts(d.prin_code, d.prin_name);

  spanRow(`${reportTitle} \u2014 Job ${jobText}`, "title");
  xlRows.push(blank());

  spanRow("JOB INFORMATION", "sectionTitle");

  const leftInfo: [string, unknown][] = [
    ["Job No",     jobText],
    ["Principal",  prinText],
    ["Invoice No", d.invoice_no],
  ];
  const rightInfo: [string, unknown][] = [
    ["Ref #", d.description1],
    ["SO No", d.so_no],
    ["PO No", d.po_no],
  ];
  for (let i = 0; i < Math.max(leftInfo.length, rightInfo.length); i++) {
    const [ll, lv] = leftInfo[i]  ?? ["", ""];
    const [rl, rv] = rightInfo[i] ?? ["", ""];
    xlRows.push([xc(ll, "label"), xc(lv, "value"), xc(rl, "label"), xc(rv, "value")]);
  }

  xlRows.push(blank());

  spanRow("ACTIVITIES", "sectionTitle");
  xlRows.push(ACT_COLUMNS.map((c) => xc(c.label, "tableHeader")));
  for (const r of rows) {
    xlRows.push([
      xc(text(r.act_code)         || "\u2014", "tableCell"),
      xc(text(r.other_services)   || "\u2014", "tableCell"),
      xc(Number(r.quantity) || 0,              "tableCellNum"),
      xc(text(r.transporter_name) || "\u2014", "tableCell"),
    ]);
  }

  xlRows.push(blank());

  // MOVEMENT (A:B) | REMARKS (C:D)
  xlRows.push([xc("MOVEMENT", "sectionTitle"), skip, xc("REMARKS", "sectionTitle"), skip]);

  const movement: [string, unknown][] = [
    ["Type of Movement", d.transport_mode],
    ["From",             joinParts(d.port_code, d.port_name)],
    ["To",               joinParts(d.destination_port, d.dest_port_name)],
    ["Quantity",         numFmt(d.qty, 0)],
    ["Volume (CBM)",     numFmt(d.cbm, 3)],
  ];
  for (let i = 0; i < movement.length; i++) {
    const [ml, mv] = movement[i];
    xlRows.push([
      xc(ml, "label"),
      xc(mv, "value"),
      i === 0 ? xc(text(d.remarks) || "\u2014", "value") : skip,
      skip,
    ]);
  }

  xlRows.push(blank());
  {
    const row = blank();
    row[NCOLS - 1] = xc("Powered by Bayanat Technology", "footer");
    xlRows.push(row);
  }

  const COL_WIDTHS = [20, 36, 20, 28];

  const colXml = COL_WIDTHS
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

  // merge each run of "value followed by nulls" into one merged range
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
        if (end > spanStart) {
          merges.push(
            `${String.fromCharCode(65 + spanStart)}${rn}:${String.fromCharCode(65 + end)}${rn}`
          );
        }
        spanStart = -1;
      } else if (cell !== null) {
        spanStart = ci;
      }
    });
  });

  let sheetDataXml = "";
  xlRows.forEach((row, ri) => {
    const rn = ri + 1;
    const ht = rn === 1 ? ` ht="24" customHeight="1"` : "";
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

  // ── Styles XML — order must match STYLE_ID above ──────────────────────────
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.000"/></numFmts>
  <fonts count="7">
    <font><sz val="10"/><color rgb="FF1E293B"/><name val="Arial"/></font>
    <font><b/><sz val="14"/><color rgb="FF00378C"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF00378C"/><name val="Arial"/></font>
    <font><b/><sz val="9"/><color rgb="FF475569"/><name val="Arial"/></font>
    <font><sz val="10"/><color rgb="FF1E293B"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><i/><sz val="8"/><color rgb="FF64748B"/><name val="Arial"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF00378C"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF0F8"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="4">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF00378C"/></left><right style="thin"><color rgb="FF00378C"/></right>
      <top style="thin"><color rgb="FF00378C"/></top><bottom style="thin"><color rgb="FF00378C"/></bottom>
      <diagonal/>
    </border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="9">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Service Activity" sheetId="1" r:id="rId1"/></sheets>
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

export const getWmsInboundServiceActivityReportHtml = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo       = text(req.params.job_no || req.query.job_no);
    const prinCode    = text(req.query.prin_code || req.params.prin_code);
    const reportTitle = text(req.query.title) || "Inbound Service Activity Report";
    const autoPrint   = req.query.print === "true";

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }

    // Empty result is NOT an error: the report renders "No records found" (like DN Summary)
    const activityRows = await loadInboundActivityData(req, jobNo, prinCode);
    const html = await renderHtml(
      req, activityRows, reportTitle, text(req.user?.loginid), autoPrint, jobNo, prinCode
    );
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Inbound Service Activity HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getWmsInboundServiceActivityReportExcel = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo       = text(req.params.job_no || req.query.job_no);
    const prinCode    = text(req.query.prin_code || req.params.prin_code);
    const reportTitle = text(req.query.title) || "Inbound Service Activity Report";

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }
    const activityRows = await loadInboundActivityData(req, jobNo, prinCode);

    // Same as DN Summary Excel: nothing to export -> friendly message, no file
    if (!activityRows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }

    const buffer = buildExcelBuffer(activityRows, reportTitle);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Inbound_Service_Activity_${jobNo}.xlsx"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("Inbound Service Activity Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};