import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { buildReportDocument, reportFooter, reportHeader } from "../../common/report_common";

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
    const rows = normalize(result.rows as any[]);
    if (!rows.length)
      throw Object.assign(new Error("Job not found"), { status: 404 });
    return rows;
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
// Letterhead / footer come from report_common; this only styles the body.
// Class names (.filter-summary, .group-title, .info-grid, .field/.label,
// .filter-header) are the ones prepareReportHtml() on the frontend knows, so
// the client-side PDF (createFreightPdf → fontVfs / Inter) and Excel export
// keep the identical design.

const INBOUND_SERVICE_ACTIVITY_EXTRA_CSS = `
  @page { size: A4 portrait; margin: 8mm 10mm; }
  .paper { max-width: none; }

  body, .paper, table.data-table {
    font-family: "Inter", "Segoe UI", Arial, sans-serif;
  }

  h1.report-title {
    margin: 0 0 6px 0;
    font-size: 17px;
    font-weight: 800;
    color: #00378c;
    line-height: 1.2;
  }

  .filter-summary {
    margin: 0 0 10px 0;
    padding: 5px 10px;
    font-size: 9.5px;
    line-height: 1.35;
    color: #475569;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-left: 4px solid #00378c;
  }
  .filter-summary strong { color: #00378c; font-weight: 700; }

  .group-title {
    margin: 10px 0 4px 0;
    padding: 5px 8px;
    font-size: 10.5px;
    font-weight: 700;
    color: #00378c;
    background: #eaf0f8;
  }

  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 24px;
    margin: 0 0 4px 0;
  }

  .field {
    display: flex;
    align-items: baseline;
    padding: 3px 4px;
    border-bottom: 1px solid #e2e8f0;
    font-size: 10px;
    line-height: 1.3;
  }
  .field .label {
    flex: 0 0 110px;
    padding-right: 8px;
    color: #475569;
    font-weight: 700;
  }
  .field .label::after { content: ":"; }
  .field .value {
    color: #1e293b;
    overflow-wrap: anywhere;
    word-break: break-word;
    white-space: pre-wrap;
  }

  .filter-header {
    margin: 2px 0 2px 0;
    padding: 2px 4px;
    font-size: 10px;
    font-weight: 700;
    color: #00378c;
  }

  table.data-table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    margin: 0;
    font-size: 10px;
    color: #1e293b;
  }
  table.data-table th,
  table.data-table td {
    padding: 4px 8px;
    overflow-wrap: anywhere;
    word-break: break-word;
    border-bottom: 1px solid #e2e8f0;
    line-height: 1.25;
  }
  table.data-table thead th {
    background: #00378c;
    color: #fff;
    font-weight: 700;
    font-size: 10px;
    border-bottom: none;
    padding: 6px 8px;
  }
  table.data-table .left   { text-align: left   !important; }
  table.data-table .center { text-align: center !important; }
  table.data-table .right  { text-align: right  !important; font-variant-numeric: tabular-nums; }
  table.data-table tr.data-row td { background: #fcfdfe; }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    table.data-table thead { display: table-header-group; }
    table.data-table tr, table.data-table td, table.data-table th {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .info-grid { break-inside: avoid; page-break-inside: avoid; }
    .group-title { break-after: avoid; page-break-after: avoid; }
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

function renderBodyHtml(rows: ReportRow[], reportTitle: string): string {
  const d = rows[0];

  const jobText = `${text(d.job_type)} ${text(d.job_no)}`.trim();
  const prinText = joinParts(d.prin_code, d.prin_name);

  const field = (label: string, value: unknown) =>
    `<div class="field"><span class="label">${escapeHtml(label)}</span> <span class="value">${escapeHtml(text(value) || "\u2014")}</span></div>`;

  const filterLine = [
    ["Job No",     jobText],
    ["Principal",  text(d.prin_code)],
    ["Invoice No", text(d.invoice_no)],
  ]
    .map(([k, v]) => `<strong>${escapeHtml(k)}:</strong> ${escapeHtml(v || "\u2014")}`)
    .join(" | ");

  const C = ACT_COLUMNS;
  const colgroup    = C.map((c) => `<col style="width:${c.width}%" />`).join("");
  const headerCells = C.map((c) => `<th class="${c.align}">${escapeHtml(c.label)}</th>`).join("");

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
    <div class="filter-summary"><strong>Job Details:</strong> ${filterLine}</div>

    <div class="group-title">Job Information</div>
    <div class="info-grid">
      <div>
        ${field("Job No",     jobText)}
        ${field("Principal",  prinText)}
        ${field("Invoice No", d.invoice_no)}
      </div>
      <div>
        ${field("Ref #", d.description1)}
        ${field("SO No", d.so_no)}
        ${field("PO No", d.po_no)}
      </div>
    </div>

    <div class="group-title">Activities</div>
    <table class="data-table">
      <colgroup>${colgroup}</colgroup>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${activityRows}</tbody>
    </table>

    <div class="group-title">Movement &amp; Remarks</div>
    <div class="info-grid">
      <div>
        <div class="filter-header">Movement</div>
        ${field("Type of Movement", d.transport_mode)}
        ${field("From",             joinParts(d.port_code, d.port_name))}
        ${field("To",               joinParts(d.destination_port, d.dest_port_name))}
        ${field("Quantity",         numFmt(d.qty, 0))}
        ${field("Volume (CBM)",     numFmt(d.cbm, 3))}
      </div>
      <div>
        <div class="filter-header">Remarks</div>
        ${field("Remarks", d.remarks)}
      </div>
    </div>
    ${PRINT_LISTENER_SCRIPT}
  `;
}

async function renderHtml(
  req: RequestWithUser,
  rows: ReportRow[],
  reportTitle: string,
  loginId: string,
  autoPrint: boolean
): Promise<string> {
  const d = rows[0];

  const headerHtml = await reportHeader({ company_code: text(d.company_code), req });
  const bodyHtml   = renderBodyHtml(rows, reportTitle);
  const footerHtml = reportFooter({
    reportName: "rpt_inbound_service_activity",
    userName:   loginId,
    endLabel:   "Powered by Bayanat Technology",
  });

  return buildReportDocument({
    title: `${reportTitle} - ${text(d.job_no)}`,
    headerHtml,
    bodyHtml,
    footerHtml,
    extraCss: INBOUND_SERVICE_ACTIVITY_EXTRA_CSS,
    autoPrint,
    showPrintButton: true,
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
    const activityRows = await loadInboundActivityData(req, jobNo, prinCode);
    const html = await renderHtml(req, activityRows, reportTitle, text(req.user?.loginid), autoPrint);
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
    const buffer       = buildExcelBuffer(activityRows, reportTitle);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Inbound_Service_Activity_${jobNo}.xlsx"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("Inbound Service Activity Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};