// src/controllers/wms/reports/LabourCardExpiryReport.controller.ts
//
// HR Labour Card Expiry Listing Report — HTML/print endpoint
// Visual style matches the Freight Expense preview:
//   • navy header row (white text, no cell borders)
//   • group/status strip rows in pale steel-blue (#eaf0f8)
//   • plain data rows, thin bottom border, no zebra, no status tint
//   • ALL data cells same weight (400), colour and size
//   • bold-navy sub totals (#f1f5f9) and grand total (#e2e8f0)

import { Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import {
  reportHeader,
  reportFooter,
  reportAppliedFilters,
  buildReportDocument,
} from "../../common/report_common";

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
    try {
      await conn.close();
    } catch (e) {
      console.warn("Close conn error:", e);
    }
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

function escapeHtml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function fmtDate(value: unknown): string {
  if (!value) return "";
  const d = new Date(value as any);
  if (Number.isNaN(d.getTime())) return text(value).slice(0, 10);
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dd}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

function parseDate(value: unknown): Date | null {
  const v = text(value).trim();
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toYmd(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

// ─── Param Parser ────────────────────────────────────────────────────────────

function allIfBlank(value: unknown): string {
  const v = text(value).trim();
  return v || "All";
}

function parseParams(req: RequestWithUser) {
  const src = { ...(req.query as Record<string, any>), ...(req.body || {}) };

  const userCompany = text(req.user?.company_code).trim();
  const companyCode = userCompany || text(src.company_code).trim() || "";

  const rawStatus = text(src.emp_status).trim().toUpperCase();
  const empStatus = rawStatus === "A" ? "A" : "All";

  return {
    companyCode,
    divCode: allIfBlank(src.div_code),
    deptCode: allIfBlank(src.dept_code),
    sectCode: allIfBlank(src.section_code ?? src.sect_code),
    gradeCode: allIfBlank(src.grade_code),
    desgCode: allIfBlank(src.desg_code),
    employeeCode: allIfBlank(src.employee_code),
    empStatus,
    fromDate: parseDate(src.from_date),
    toDate: parseDate(src.to_date),
    loginId: text(req.user?.loginid || (req.user as any)?.username || ""),
  };
}

// ─── Data Loader ─────────────────────────────────────────────────────────────

const REPORT_PARAMETER = "Hr_Report_LABOUR_CARD_EXPIRY_LISTING";

async function loadLabourCardData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);

  console.log("[LabourCardExpiry] params:", {
    companyCode: params.companyCode,
    divCode: params.divCode,
    deptCode: params.deptCode,
    sectCode: params.sectCode,
    gradeCode: params.gradeCode,
    desgCode: params.desgCode,
    employeeCode: params.employeeCode,
    empStatus: params.empStatus,
    fromDate: params.fromDate?.toISOString(),
    toDate: params.toDate?.toISOString(),
  });

  if (!params.companyCode) {
    throw Object.assign(new Error("company_code is required"), { status: 400 });
  }
  if (!params.fromDate || !params.toDate) {
    throw Object.assign(new Error("from_date and to_date are required"), { status: 400 });
  }
  if (params.fromDate > params.toDate) {
    throw Object.assign(new Error("'From Date' cannot be greater than 'To Date'"), {
      status: 400,
    });
  }

  const conn = await getConn(req);

  try {
    const binds: Record<string, any> = {
      p_parameter: REPORT_PARAMETER,
      p_loginid: params.loginId,
      p_number1: null,
      p_number2: null,
      p_number3: null,
      p_number4: null,
      p_date1: toYmd(params.fromDate),
      p_date2: toYmd(params.toDate),
      p_date3: null,
      p_date4: null,
      p_return_string: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    const codes = [
      params.companyCode,
      params.divCode,
      params.deptCode,
      params.sectCode,
      params.gradeCode,
      params.desgCode,
      params.employeeCode,
      params.empStatus,
    ];
    for (let i = 1; i <= 20; i++) {
      binds[`p_code${i}`] = i <= codes.length ? codes[i - 1] : null;
    }

    const codeArgs = Array.from({ length: 20 }, (_, i) => `:p_code${i + 1}`).join(", ");

    const procResult = await conn.execute(
      `BEGIN
         PROC_BUILD_DYNAMIC_SQL_HR_REPORT(
           :p_parameter, :p_loginid,
           ${codeArgs},
           :p_number1, :p_number2, :p_number3, :p_number4,
           :p_date1, :p_date2, :p_date3, :p_date4,
           :p_return_string
         );
       END;`,
      binds,
    );

    const builtSql = text((procResult.outBinds as any)?.p_return_string).trim();

    console.log("[LabourCardExpiry] Built SQL:", builtSql);

    if (!builtSql || builtSql.toUpperCase() === "INVALID PARAMETER VALUE") {
      throw Object.assign(new Error("Report procedure returned no query"), { status: 500 });
    }

    const result = await conn.execute(builtSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    console.log("[LabourCardExpiry] Rows returned:", (result.rows as any[])?.length ?? 0);

    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Extra CSS — matches the Freight Expense preview ─────────────────────────
//
//   navy          = #00378c  (header bar, title, group text, totals)
//   groupStrip    = #eaf0f8  (status group rows — pale steel blue)
//   subtotalStrip = #f1f5f9  (Sub Total rows)
//   grandStrip    = #e2e8f0  (Grand Total row)
//   rowBg         = #fcfdfe  (data rows)
//   rule          = #e2e8f0  (thin bottom border under each row)

const LABOUR_CARD_EXTRA_CSS = `
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }

  body, table.lc-table {
    font-family: Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  }

  /* ── Title ──────────────────────────────────────────────────────────── */
  .doc-title-row {
    display: flex; justify-content: space-between; align-items: flex-start;
    margin: 4px 0 10px 0;
  }
  body .doc-title-row h1 {
    margin: 0;
    font-size: 16px;
    font-weight: 800;
    color: #00378c !important;   /* beats report_common's print override (#0b4ca1) */
    letter-spacing: 0;
  }

  /* ── Reset the base table so nothing fights our rules ───────────────── */
  table.lc-table,
  table.data-table.lc-table {
    width: 100%;
    max-width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 10.5px;
    margin-top: 6px;
    border: 0;
  }

  /* ── Navy header ────────────────────────────────────────────────────── */
  table.lc-table thead th,
  table.data-table.lc-table thead th {
    background: #00378c !important;
    color: #ffffff !important;
    font-weight: 700;
    font-size: 10.5px;
    letter-spacing: 0;
    padding: 10px 8px;
    text-align: left;
    vertical-align: middle;
    border: 0 !important;
    box-shadow: inset 0 0 0 1000px #00378c;
    white-space: normal;
    overflow-wrap: break-word;
    word-break: normal;
  }
  table.lc-table thead th.num-head,
  table.data-table.lc-table thead th.num-head { text-align: right; }
  table.lc-table thead th.center-head,
  table.data-table.lc-table thead th.center-head { text-align: center; }

  /* ── Data rows — every cell: same weight, colour, size ─────────────── */
  table.lc-table tbody td,
  table.data-table.lc-table tbody td {
    padding: 6px 8px;
    border: 0;
    border-bottom: 1px solid #e2e8f0 !important;
    color: #1e293b;
    font-size: 10.5px;
    font-weight: 400;
    background: #fcfdfe;
    vertical-align: middle;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  table.data-table.lc-table tbody tr:nth-child(even) td { background: #fcfdfe; }

  /* ── Alignment ─────────────────────────────────────────────────────── */
  .center { text-align: center; }
  .left   { text-align: left; }
  .right  { text-align: right; }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* Two-line cells inherit the cell's weight/colour/size — nothing special */
  .lc-table .l1,
  .lc-table .l2 {
    display: block;
    font-weight: inherit;
    font-size: inherit;
    color: inherit;
  }

  /* ── Group (status) strip ──────────────────────────────────────────── */
  table.lc-table tbody tr.group-row td,
  table.data-table.lc-table tbody tr.group-row td {
    background: #eaf0f8 !important;
    color: #00378c !important;
    font-size: 12px;
    font-weight: 800;
    padding: 7px 8px;
    border-bottom: 1px solid #e2e8f0 !important;
  }

  /* ── Sub Total / Grand Total ───────────────────────────────────────── */
  table.lc-table tbody tr.subtotal-row td,
  table.data-table.lc-table tbody tr.subtotal-row td {
    background: #f1f5f9 !important;
    color: #00378c !important;
    font-weight: 700;
    text-align: right;
  }
  table.lc-table tbody tr.grand-total-row td,
  table.data-table.lc-table tbody tr.grand-total-row td {
    background: #e2e8f0 !important;
    color: #00378c !important;
    font-weight: 800;
    text-align: right;
    border-bottom: 1px solid #cbd5e1 !important;
  }

  /* ── Empty state ───────────────────────────────────────────────────── */
  .lc-empty {
    border: 1px dashed #cbd5e1;
    background: #f8fafc;
    text-align: center;
    padding: 40px 12px;
    margin-top: 14px;
    color: #64748b;
    font-weight: 700;
  }

  /* ── Screen-only compact sizing (print unaffected) ─────────────────── */
  @media screen {
    body .doc-title-row h1 { font-size: 13px; }
    table.lc-table, table.data-table.lc-table { font-size: 9.5px; }
    table.lc-table thead th,
    table.data-table.lc-table thead th { font-size: 9.5px; padding: 7px 6px; }
    table.lc-table tbody td,
    table.data-table.lc-table tbody td { padding: 5px 6px; font-size: 9.5px; }
    table.lc-table tbody tr.group-row td,
    table.data-table.lc-table tbody tr.group-row td { font-size: 10.5px; padding: 5px 6px; }
  }

  /* ── Print: keep navy header + strips, avoid row splits ────────────── */
  @media print {
    body .doc-title-row h1 { color: #00378c !important; }

    table.lc-table thead,
    table.data-table.lc-table thead { display: table-header-group; }
    table.lc-table tr,
    table.data-table.lc-table tr    { page-break-inside: avoid; }
    table.lc-table tr.group-row     { break-after: avoid; }

    table.lc-table thead th,
    table.data-table.lc-table thead th {
      background: #00378c !important;
      color: #ffffff !important;
      box-shadow: inset 0 0 0 1000px #00378c;
    }
  }
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Loads Inter so the PDF renderer doesn't fall back to a wide system font. */
const FONT_LINK = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">`;

/** Inline wrapping rules: inline !important beats any stylesheet rule. */
const WRAP =
  "white-space:normal !important;word-break:break-word !important;overflow-wrap:anywhere !important;min-width:0;";

/** Two-line cell; skips a blank line so nothing leaves a gap. Styling comes from the cell. */
function twoLine(first: unknown, second: unknown): string {
  const a = text(first).trim();
  const b = text(second).trim();
  return (
    (a ? `<span class="l1" style="display:block;${WRAP}">${escapeHtml(a)}</span>` : "") +
    (b ? `<span class="l2" style="display:block;${WRAP}">${escapeHtml(b)}</span>` : "")
  );
}

// ─── Body Renderer ────────────────────────────────────────────────────────────

const COL_COUNT = 8;

function renderLabourCardBody(rows: ReportRow[], filtersHtml = ""): string {
  const heading = `
    ${FONT_LINK}
    <div class="doc-title-row">
      <div><h1>Labour Card Expiry Listing</h1></div>
    </div>`;

  if (!rows.length) {
    return `
      ${heading}
      ${filtersHtml}
      <div class="lc-empty">No data found</div>
    `;
  }

  // Group by status, preserving first-appearance order
  const groups = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const key = text(r.status).trim() || "Other";
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  let sno = 0;
  const bodyRows = Array.from(groups.entries())
    .map(([status, list]) => {
      const groupRow = `
        <tr class="group-row">
          <td colspan="${COL_COUNT}">${escapeHtml(status)}</td>
        </tr>`;

      const dataRows = list
        .map((r) => {
          sno += 1;
          const employee = [text(r.employee_code), text(r.rpt_name)]
            .filter(Boolean)
            .join(" - ");
          return `
        <tr>
          <td class="num">${sno}</td>
          <td style="${WRAP}">${escapeHtml(employee)}</td>
          <td style="${WRAP}">${twoLine(r.dept_name, r.div_name)}</td>
          <td style="${WRAP}">${twoLine(r.section_name, r.desg_name)}</td>
          <td style="${WRAP}">${escapeHtml(r.labourcard_no)}</td>
          <td class="center">${escapeHtml(fmtDate(r.labourcard_valid_from))}</td>
          <td class="center">${escapeHtml(fmtDate(r.labourcard_valid_to))}</td>
          <td class="num">${escapeHtml(r.days_remaining)}</td>
        </tr>`;
        })
        .join("");

      const subTotal = `
        <tr class="subtotal-row">
          <td colspan="${COL_COUNT}">Sub Total (${escapeHtml(status)} - ${list.length} Records):</td>
        </tr>`;

      return groupRow + dataRows + subTotal;
    })
    .join("");

  const grandTotal = `
        <tr class="grand-total-row">
          <td colspan="${COL_COUNT}">GRAND TOTAL (${rows.length} Records):</td>
        </tr>`;

  return `
    ${heading}
    ${filtersHtml}
    <table class="lc-table" style="table-layout:fixed;width:100%;max-width:100%;">
      <colgroup>
        <col style="width:4%">
        <col style="width:18%">
        <col style="width:19%">
        <col style="width:19%">
        <col style="width:12%">
        <col style="width:10%">
        <col style="width:10%">
        <col style="width:8%">
      </colgroup>
      <thead>
        <tr>
          <th class="num-head">SNo.</th>
          <th>Employee</th>
          <th>Department / Division</th>
          <th>Section / Designation</th>
          <th>Labour Card No.</th>
          <th class="center-head">Valid From</th>
          <th class="center-head">Valid To</th>
          <th class="num-head">Valid Days</th>
        </tr>
      </thead>
      <tbody>${bodyRows}${grandTotal}</tbody>
    </table>
  `;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export const getLabourCardExpiryReportHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadLabourCardData(req);

    const headerHtml = await reportHeader({ company_code: params.companyCode, req });
    const filtersHtml = reportAppliedFilters([
      { label: "Division", value: [params.divCode] },
      { label: "Department", value: [params.deptCode] },
      { label: "Section", value: [params.sectCode] },
      { label: "Grade", value: [params.gradeCode] },
      { label: "Designation", value: [params.desgCode] },
      { label: "Employee", value: [params.employeeCode] },
      {
        label: "Labour Card Expiry",
        value: [`${fmtDate(params.fromDate)} - ${fmtDate(params.toDate)}`],
      },
      {
        label: "Employee Status",
        value: [params.empStatus === "A" ? "Active Employees" : "All Employees"],
      },
    ]);
    const bodyHtml = renderLabourCardBody(rows, filtersHtml);
    const footerHtml = reportFooter({
      reportName: "rpt_hr_expiry_labourcard_rpt",
      userName: params.loginId,
      endLabel: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: "HR Labour Card Expiry Listing",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: LABOUR_CARD_EXTRA_CSS,
      autoPrint: req.query.print !== "false",
      showPrintButton: true,
      orientation: "portrait",
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Labour Card Expiry Report HTML error:", error);

    const oraNum = error?.errorNum;
    const oraCode = oraNum ? `ORA-${String(oraNum).padStart(5, "0")}` : undefined;

    res.status(error.status || 500).json({
      success: false,
      code: oraCode,
      message: error.message || "Unable to generate report",
    });
  }
};