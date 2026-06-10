import { Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

export interface TJobDetails {
  COMPANY_CODE: string;
  DIV_CODE: string;
  PRIN_CODE: string;
  JOB_NO: string;
  JOB_DATE: string;
  JOB_TYPE: string;
  JOB_CLASS: string;
  DEPT_CODE: string;
  TRANSPORT_MODE_DESC: string;
  TRANSPORT_MODE: string;
  DOC_REF: string | null;
  PORT_CODE: string | null;
  DESCRIPTION1: string | null;
  DESCRIPTION2: string | null;
  PRIN_REF1: string | null;
  PRIN_REF2: string | null;
  REMARKS: string | null;
  ETA: string | null;
  ATA: string | null;
  ETD: string | null;
  SCHEDULE_DATE: string | null;
  PAYMENT_TERMS: string | null;
  CURR_CODE: string;
  EX_RATE: number;
  FRIEGHT_VALUE: number;
  INSURANCE_VALUE: number;
  CUST_CODE: string | null;
  CONTAINER_FLAG: string | null;
  CONTAINER: string | null;
  CONTAINER_DATE: string | null;
  PACKDET: string;
  PACKDET_DATE: string | null;
  ALLOCATED: string;
  ALLOCATE_DATE: string | null;
  CANCELED: string;
  CANCEL_DATE: string | null;
  CONFIRMED: string;
  CONFIRM_DATE: string | null;
  GRN_NO: string | null;
  GRN_DATE: string | null;
  INVOICED: string;
  INVOICE_DATE: string | null;
  COMPLETED: string | null;
  COMPLETE_DATE: string | null;
  CREATED_BY: string;
  CREATED_AT: string;
  EXP_JOBNO: string | null;
  PICKED: string;
  PICKED_DATE: string | null;
  ORDER_DATE: string | null;
  ORDERED: string;
  REF_CUSTOMS: string | null;
  REF_CUSTOMS_DATE: string | null;
  CANCELED_BY: string | null;
  CANCEL_REMARKS: string | null;
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

function dateText(value: unknown): string {
  if (!value) return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value).substring(0, 10);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function escapeHtml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function numFmt(value: unknown, decimals = 2): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ─── Progress columns definition ─────────────────────────────────────────────

const PROGRESS_COLS: { label: string; flag: string; dateKey: string }[] = [
  { label: "Job",       flag: "",            dateKey: "job_date" },
  { label: "Container", flag: "container_flag", dateKey: "container_date" },
  { label: "Packdet",   flag: "packdet",     dateKey: "packdet_date" },
  { label: "Allocate",  flag: "allocated",   dateKey: "allocate_date" },
  { label: "Confirm",   flag: "confirmed",   dateKey: "confirm_date" },
  { label: "Completed", flag: "completed",   dateKey: "complete_date" },
  { label: "Invoiced",  flag: "invoiced",    dateKey: "invoice_date" },
];

// ─── Data loader ──────────────────────────────────────────────────────────────

async function loadJobData(
  req: RequestWithUser,
  jobNo: string,
  prinCode: string
): Promise<ReportRow> {
  const conn = await getConn(req);
  console.log('jobNo:',jobNo,'prin_code:',prinCode,'company_Code',req.user.company_code);
  try {
    const result = await conn.execute(
      `SELECT *
       FROM VW_BOWM_JOBTXN
       WHERE 
       COMPANY_CODE = '${req.user.company_code}'
       AND job_no       = :job_no
         AND prin_code    = :prin_code`,
      { job_no: jobNo, prin_code: prinCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = normalize(result.rows as any[]);
    if (!rows.length)
      throw Object.assign(new Error("Job not found"), { status: 404 });
    return rows[0];
  } finally {
    await closeConn(conn);
  }
}

// ─── HTML renderer ────────────────────────────────────────────────────────────

function renderHtml(
  d: ReportRow,
  reportTitle: string,
  loginId: string,
  autoPrint: boolean
): string {
  const printDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  // ── Progress table rows ──
  const progressCells = PROGRESS_COLS.map((col) => {
    const dateVal = dateText(d[col.dateKey]);
    const isDone = col.flag ? text(d[col.flag]) === "Y" : !!d[col.dateKey];
    return `
      <td class="prog-cell${isDone ? " done" : ""}">
        <span class="prog-date">${isDone ? escapeHtml(dateVal) : ""}</span>
      </td>`;
  }).join("");

  // ── Field helper (macro-expanded inline) ──
  const field = (label: string, value: unknown) => `
    <div class="field-row">
      <span class="f-label">${escapeHtml(label)}</span>
      <span class="f-value">${escapeHtml(value) || '<span class="nil"></span>'}</span>
    </div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(reportTitle)} – ${escapeHtml(d.job_no)}</title>
  <style>
    /* ── Reset & base ──────────────────────────────── */
    @page { size: A4; margin: 10mm 12mm; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Segoe UI", Calibri, Arial, sans-serif;
      font-size: 13px;
      color: #111827;
      background: #eef1f6;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ── Sheet ─────────────────────────────────────── */
    .sheet {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      background: #fff;
      padding: 10mm 12mm;
      border: 1px solid #c4cdd9;
    }

    /* ── Header bar ────────────────────────────────── */
    .rpt-header {
      background: #1e1b4b;
      color: #fff;
      text-align: center;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.10em;
      padding: 10px 16px;
      text-transform: uppercase;
      border-radius: 3px 3px 0 0;
    }

    /* ── Meta row ──────────────────────────────────── */
    .rpt-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 2px 10px;
      border-bottom: 2px solid #1e1b4b;
      font-size: 10.5px;
      color: #4b5563;
      margin-bottom: 14px;
    }
    .rpt-meta strong { color: #111827; font-weight: 600; }
    .meta-badge {
      padding: 2px 12px;
      border-radius: 10px;
      font-size: 9.5px;
      font-weight: 700;
      background: #ede9fe;
      color: #4c1d95;
      letter-spacing: 0.04em;
    }
    .meta-badge.cancelled {
      background: #fee2e2;
      color: #991b1b;
    }

    /* ── Section label ─────────────────────────────── */
    .section-label {
      font-size: 9.5px;
      font-weight: 700;
      color: #1e1b4b;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 7px;
      padding-bottom: 4px;
      border-bottom: 1.5px solid #1e1b4b;
    }

    /* ── Field rows ────────────────────────────────── */
    .field-row {
      display: flex;
      align-items: baseline;
      padding: 3.5px 0;
      border-bottom: 1px solid #f1f5f9;
    }
    .field-row:last-child { border-bottom: none; }
    .f-label {
      font-size: 10px;
      color: #6b7280;
      min-width: 128px;
      padding-right: 8px;
      text-align: right;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .f-value {
      font-size: 11px;
      font-weight: 600;
      color: #111827;
    }
    .nil { font-weight: 400; color: #9ca3af; }

    /* ── Two-column grid ───────────────────────────── */
    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 32px;
      margin-bottom: 14px;
    }

    /* ── Box (shaded panel) ────────────────────────── */
    .box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 10px 14px;
      margin-bottom: 14px;
    }
    .box-title {
      font-size: 10px;
      font-weight: 700;
      color: #1e1b4b;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      margin-bottom: 8px;
      padding-bottom: 5px;
      border-bottom: 1px solid #e2e8f0;
    }
    .box-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 24px;
    }

    /* ── Progress table ────────────────────────────── */
    .progress-title {
      font-size: 10px;
      font-weight: 700;
      color: #1e1b4b;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 14px 0 8px;
      padding-bottom: 4px;
      border-bottom: 2px solid #1e1b4b;
    }
    table { width: 100%; border-collapse: collapse; }
    thead th {
      background: #1e1b4b;
      color: #fff;
      padding: 7px 8px;
      font-size: 9.5px;
      font-weight: 700;
      text-align: center;
      border: 1px solid #312e81;
    }
    .prog-cell {
      border: 1px solid #d1d5db;
      padding: 7px 8px;
      text-align: center;
      background: #fff;
    }
    .prog-cell.done {
      background: #f0fdf4;
    }
    .prog-check {
      display: block;
      font-size: 13px;
      color: #16a34a;
      line-height: 1;
      margin-bottom: 3px;
    }
    .prog-date {
      display: block;
      font-size: 9.5px;
      color: #374151;
    }
    .prog-cell:not(.done) .prog-date { color: #9ca3af; }

    /* ── Footer ─────────────────────────────────────── */
    .rpt-footer {
      margin-top: 14px;
      border-top: 1px solid #e2e8f0;
      padding-top: 7px;
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: #9ca3af;
    }
    .rpt-footer code { font-family: "Courier New", monospace; font-size: 9px; color: #6b7280; }

    /* ── Print toolbar (screen only) ───────────────── */
    .toolbar {
      position: fixed;
      top: 14px;
      right: 14px;
      display: flex;
      gap: 8px;
      z-index: 10;
    }
    .toolbar button {
      border: 1px solid #d1d5db;
      border-radius: 7px;
      padding: 8px 16px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      font-family: "Segoe UI", Calibri, Arial, sans-serif;
    }
    .btn-print { background: #fff; color: #111827; }
    .btn-print:hover { background: #f3f4f6; }
    .btn-pdf   { background: #1e1b4b; color: #fff; border-color: #1e1b4b; }
    .btn-pdf:hover { background: #312e81; }

    @media print {
      body { background: #fff; }
      .sheet { border: none; margin: 0; width: auto; min-height: auto; padding: 0; }
      .toolbar { display: none; }
    }
  </style>
</head>
<body>

  <div class="toolbar">
    <button class="btn-print" onclick="window.print()">🖨 Print</button>
    <button class="btn-pdf" onclick="
      var w = window.open('', '_blank');
      w.document.write(document.documentElement.outerHTML);
      w.document.close();
      setTimeout(function(){ w.print(); }, 500);
    ">⬇ Save as PDF</button>
  </div>

  <main class="sheet">

    <!-- ── Header bar ── -->
    <div class="rpt-header">${escapeHtml(reportTitle)}</div>

    <!-- ── Meta row ── -->
    <div class="rpt-meta">
      <span>Print Date:&nbsp;<strong>${escapeHtml(printDate)}</strong></span>
      <span>Print User:&nbsp;<strong>${escapeHtml(loginId)}</strong></span>
    </div>

    <!-- ── Job Information ── -->
    <div class="section-label">Job Information</div>
    <div class="two-col">
      <div>
        ${field("Job No",          d.job_no)}
        ${field("Job Date",        dateText(d.job_date))}
        ${field("Department",      d.dept_code)}
        ${field("Transport Mode",  d.transport_mode_desc || d.transport_mode)}
        ${field("Document Ref",    d.doc_ref)}
        ${field("Principal",       d.prin_code)}
      </div>
      <div>
        ${field("Cancel Date",     dateText(d.cancel_date))}
        ${field("Cancelled By",    d.canceled_by)}
        ${field("Created By",      d.created_by)}
      </div>
    </div>

    <!-- ── References & Remarks ── -->
    <div class="section-label">References &amp; Remarks</div>
    <div class="box" style="margin-bottom:14px;">
      ${field("Description",    d.description1)}
      ${field("Description 2",  d.description2)}
      ${field("Principal Ref",  d.prin_ref1)}
      ${field("Other Ref",      d.prin_ref2)}
      ${field("Remarks",        d.remarks)}
    </div>

    <!-- ── FIRS Details (two shaded panels) ── -->
    <div class="section-label">FIRS Details</div>
    <div class="box-grid" style="gap:16px; margin-bottom:14px; display:grid; grid-template-columns:1fr 1fr;">
      <div class="box" style="margin-bottom:0;">
        <div class="box-title">Logistics</div>
        ${field("Port Code",      d.port_code)}
        ${field("ETA",            dateText(d.eta))}
        ${field("ATA",            dateText(d.ata))}
        ${field("ETD",            dateText(d.etd))}
        ${field("Schedule Date",  dateText(d.schedule_date))}
      </div>
      <div class="box" style="margin-bottom:0;">
        <div class="box-title">Financial</div>
        ${field("Payment Terms",   d.payment_terms)}
        ${field("Currency",        d.curr_code)}
        ${field("Exchange Rate",   numFmt(d.ex_rate, 4))}
        ${field("Freight Value",   numFmt(d.frieght_value))}
        ${field("Insurance Value", numFmt(d.insurance_value))}
      </div>
    </div>

    <!-- ── Job Progress ── -->
    <div class="progress-title">Job Progress</div>
    <table>
      <thead>
        <tr>
          ${PROGRESS_COLS.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        <tr>${progressCells}</tr>
      </tbody>
    </table>

    <!-- ── Footer ── -->
    <div class="rpt-footer">
      <span>Object: <code>${escapeHtml(d.company_code)}-${escapeHtml(d.job_no)}</code></span>
      <span>Powered by Bayanat Technology</span>
    </div>

  </main>

  ${autoPrint
    ? `<script>window.addEventListener("load", () => setTimeout(() => window.print(), 300));</script>`
    : ""}
</body>
</html>`;
}

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * GET /api/wms/reports/job-details/:job_no
 *
 * Query params (all optional if defaults are acceptable):
 *   company_code   – falls back to req.user.company_code or "BSG"
 *   prin_code      – required if not in params
 *   title          – report title shown in header (default: "WMS Job Details Report")
 *   print          – "true" | "false"  (auto-triggers browser print dialog)
 *
 * Opens a self-contained, print-ready HTML page in the browser.
 * The user clicks "Print" or "Save as PDF" to download/print.
 */
export const getWmsJobDetailsReportHtml = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo = text(req.params.job_no || req.query.job_no);
    // const companyCode =
    //   text(req.query.company_code) || text(req.user?.company_code) || "BSG";
    const prinCode = text(req.query.prin_code || req.params.prin_code);
    const reportTitle = text(req.query.title) || "WMS Job Details Report";
    const autoPrint = req.query.print !== "false";

    if (!jobNo || !prinCode) {
      res.status(400).json({
        success: false,
        message: "job_no and prin_code are required",
      });
      return;
    }

    const jobData = await loadJobData(req, jobNo , prinCode);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderHtml(jobData, reportTitle, text(req.user?.loginid), autoPrint));
  } catch (error: any) {
    console.error("WMS Job Details Report error:", error);
    res
      .status(error.status || 500)
      .json({ success: false, message: error.message || "Unable to generate report" });
  }
};