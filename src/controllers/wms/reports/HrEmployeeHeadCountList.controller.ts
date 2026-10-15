// src/controllers/wms/reports/EmployeeHeadCountReport.controller.ts
//
// HR Employee Head Count List — HTML/print endpoint
// Visual style matches the Labour Card Expiry / Freight Expense preview:
//   • navy header row (white text, no cell borders)
//   • plain data rows, thin bottom border, no zebra
//   • ALL data cells same weight (400), colour and size
//   • bold-navy grand total (#e2e8f0)
//
// Frontend sends:
//   GET /api/wms/reports/hr/employee-head-count/html
//     ?company_code=...&from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
//     &report_mode=DIVISION_WISE|DEPARTMENT_WISE|LOCAL_EXPAT|BUDGETED_VARIANCE|MANPOWER_DEPT|...
//     &print=false

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

// ─── Report-mode → procedure parameter mapping ───────────────────────────────

const REPORT_MODE_TO_PARAMETER: Record<string, string> = {
  DIVISION_WISE:           "Hr_Report_HEAD_COUNT_DIVISION",
  DEPARTMENT_WISE:         "Hr_Report_HEAD_COUNT_DEPARTMENT",
  NATIONALITY_WISE:        "Hr_Report_HEAD_COUNT_NATIONALITY",
  LOCAL_EXPAT:             "Hr_Report_HEAD_COUNT_LOCAL_EXPAT",
  MONTHLY_JOINERS:         "Hr_Report_HEAD_COUNT_MONTHLY_JOINERS",
  MONTHLY_LEAVERS:         "Hr_Report_HEAD_COUNT_MONTHLY_LEAVERS",
  MONTHLY_JOINERS_OPENING: "Hr_Report_HEAD_COUNT_MONTHLY_JOINERS_OPENING",
  BUDGETED_VARIANCE:       "Hr_Report_HEAD_COUNT_BUDGETED_VARIANCE",
  MANPOWER_DEPT:           "Hr_Report_HEAD_COUNT_MANPOWER_DEPT",
};

const REPORT_MODE_LABEL: Record<string, string> = {
  DIVISION_WISE:           "Division wise Head count summary",
  DEPARTMENT_WISE:         "Department wise Head count summary",
  NATIONALITY_WISE:        "Nationality wise Head count summary",
  LOCAL_EXPAT:             "Local/Expat Head count summary",
  MONTHLY_JOINERS:         "Organization Head Count Month-wise Joiners",
  MONTHLY_LEAVERS:         "Organization Head Count Month-wise Leavers",
  MONTHLY_JOINERS_OPENING: "Organization Head Count Month-wise Joiners with opening Balance",
  BUDGETED_VARIANCE:       "Budgeted Plan Variance",
  MANPOWER_DEPT:           "ManPower Department wise",
};

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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

/** Date -> 'YYYY-MM-DD' string (the format PROC_BUILD_DYNAMIC_SQL_HR_REPORT expects). */
function toYmd(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function num(value: unknown, digits = 0): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(digits);
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

  // Normalise report_mode — accept exact keys, fall back to DIVISION_WISE
  const rawMode = text(src.report_mode).trim().toUpperCase();
  const reportMode = REPORT_MODE_TO_PARAMETER[rawMode] ? rawMode : "DIVISION_WISE";

  return {
    companyCode,
    reportMode,
    reportModeLabel: REPORT_MODE_LABEL[reportMode] ?? reportMode,
    fromDate: parseDate(src.from_date),
    toDate: parseDate(src.to_date),
    loginId: text(req.user?.loginid || (req.user as any)?.username || ""),
  };
}

// ─── Data Loader ─────────────────────────────────────────────────────────────

async function loadHeadCountData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);

  console.log("[EmployeeHeadCount] params:", {
    companyCode: params.companyCode,
    reportMode: params.reportMode,
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

  const parameter = REPORT_MODE_TO_PARAMETER[params.reportMode];
  if (!parameter) {
    throw Object.assign(new Error(`Unknown report_mode: ${params.reportMode}`), {
      status: 400,
    });
  }

  const conn = await getConn(req);

  try {
    const binds: Record<string, any> = {
      p_parameter: parameter,
      p_loginid: params.loginId,

      // P_CODE1 = company. Others unused by head count branches — leave null.
      p_code1: params.companyCode,
      p_code2: null,
      p_code3: null,
      p_code4: null,
      p_code5: null,
      p_code6: null,
      p_code7: null,
      p_code8: null,
      p_code9: null,
      p_code10: null,
      p_code11: null,
      p_code12: null,
      p_code13: null,
      p_code14: null,
      p_code15: null,
      p_code16: null,
      p_code17: null,
      p_code18: null,
      p_code19: null,
      p_code20: null,

      p_number1: null,
      p_number2: null,
      p_number3: null,
      p_number4: null,

      // Procedure declares P_DATE1..4 as VARCHAR2 ('YYYY-MM-DD') — bind strings,
      // NOT oracledb.DATE (that gets NLS-formatted and parsed as year 0001).
      p_date1: toYmd(params.fromDate),
      p_date2: toYmd(params.toDate),
      p_date3: null,
      p_date4: null,

      p_return_string: {
        dir: oracledb.BIND_OUT,
        type: oracledb.STRING,
        maxSize: 32767,
      },
    };

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

    console.log("[EmployeeHeadCount] Built SQL:", builtSql);

    if (!builtSql || builtSql.toUpperCase() === "INVALID PARAMETER VALUE") {
      throw Object.assign(new Error("Report procedure returned no query"), { status: 500 });
    }

    const result = await conn.execute(builtSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    console.log("[EmployeeHeadCount] Rows returned:", (result.rows as any[])?.length ?? 0);

    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Extra CSS — matches the Labour Card Expiry / Freight Expense preview ────
//
//   navy          = #00378c  (header bar, title, totals)
//   grandStrip    = #e2e8f0  (Grand Total row)
//   rowBg         = #fcfdfe  (data rows)
//   rule          = #e2e8f0  (thin bottom border under each row)

const HEAD_COUNT_EXTRA_CSS = `
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }

  body, table.hc-table {
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
  .doc-subtitle {
    margin-top: 2px;
    font-size: 11px;
    font-weight: 400;
    color: #64748b;
  }

  /* ── Table reset ────────────────────────────────────────────────────── */
  table.hc-table {
    width: 100%;
    max-width: 100%;
    border-collapse: collapse;
    font-size: 10.5px;
    margin-top: 6px;
    border: 0;
  }

  /* ── Navy header ────────────────────────────────────────────────────── */
  table.hc-table thead th {
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
  table.hc-table thead th.num-head { text-align: right; }

  /* ── Data rows — every cell: same weight, colour, size ─────────────── */
  table.hc-table tbody td {
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
  table.hc-table tbody tr:nth-child(even) td { background: #fcfdfe; }

  /* ── Alignment ─────────────────────────────────────────────────────── */
  .center { text-align: center; }
  .left   { text-align: left; }
  .right  { text-align: right; }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* ── Grand Total ───────────────────────────────────────────────────── */
  table.hc-table tbody tr.grand-total-row td {
    background: #e2e8f0 !important;
    color: #00378c !important;
    font-weight: 800;
    text-align: right;
    border-bottom: 1px solid #cbd5e1 !important;
  }

  /* ── Empty state ───────────────────────────────────────────────────── */
  .hc-empty {
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
    .doc-subtitle { font-size: 9.5px; }
    table.hc-table { font-size: 9.5px; }
    table.hc-table thead th { font-size: 9.5px; padding: 7px 6px; }
    table.hc-table tbody td { padding: 5px 6px; font-size: 9.5px; }
  }

  /* ── Print: keep navy header, avoid row splits ─────────────────────── */
  @media print {
    body .doc-title-row h1 { color: #00378c !important; }

    table.hc-table thead { display: table-header-group; }
    table.hc-table tr    { page-break-inside: avoid; }

    table.hc-table thead th {
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

type Head = { label: string; num?: boolean; width?: string };

function headHtml(heads: Head[]): string {
  return heads
    .map(
      (h) =>
        `<th${h.num ? ` class="num-head"` : ""}${h.width ? ` style="width:${h.width}"` : ""}>${escapeHtml(h.label)}</th>`,
    )
    .join("");
}

function tableHtml(heads: Head[], bodyRows: string, grandTotalRow: string): string {
  return `
    <table class="hc-table">
      <thead><tr>${headHtml(heads)}</tr></thead>
      <tbody>${bodyRows}${grandTotalRow}</tbody>
    </table>`;
}

/** Grand total row where the label spans every column. */
function grandTotalFull(colCount: number, count: number): string {
  return `
        <tr class="grand-total-row">
          <td colspan="${colCount}">GRAND TOTAL (${count} Records):</td>
        </tr>`;
}

/** Grand total row with the label spanning leading columns and a total in the last one. */
function grandTotalWithSum(labelCols: number, count: number, total: number): string {
  return `
        <tr class="grand-total-row">
          <td colspan="${labelCols}">GRAND TOTAL (${count} Records):</td>
          <td class="num">${total}</td>
        </tr>`;
}

// ─── Body Renderers (one per mode) ───────────────────────────────────────────

function renderDivisionWise(rows: ReportRow[]): string {
  const total = rows.reduce((s, r) => s + Number(r.head_count || 0), 0);
  const body = rows
    .map(
      (r, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td>${escapeHtml(r.div_name)}</td>
          <td class="num">${escapeHtml(r.head_count)}</td>
        </tr>`,
    )
    .join("");
  return tableHtml(
    [
      { label: "SNo.", num: true, width: "6%" },
      { label: "Division" },
      { label: "Head Count", num: true, width: "20%" },
    ],
    body,
    grandTotalWithSum(2, rows.length, total),
  );
}

function renderDepartmentWise(rows: ReportRow[]): string {
  const total = rows.reduce((s, r) => s + Number(r.head_count || 0), 0);
  const body = rows
    .map(
      (r, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td>${escapeHtml(r.div_name)}</td>
          <td>${escapeHtml(r.dept_name)}</td>
          <td class="num">${escapeHtml(r.head_count)}</td>
        </tr>`,
    )
    .join("");
  return tableHtml(
    [
      { label: "SNo.", num: true, width: "6%" },
      { label: "Division" },
      { label: "Department" },
      { label: "Head Count", num: true, width: "20%" },
    ],
    body,
    grandTotalWithSum(3, rows.length, total),
  );
}

function renderLocalExpat(rows: ReportRow[]): string {
  const body = rows
    .map(
      (r, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td>${escapeHtml(r.company_code)}</td>
          <td>${escapeHtml(r.div_name)}</td>
          <td>${escapeHtml(r.dept_name)}</td>
          <td class="num">${escapeHtml(r.omani_male)}</td>
          <td class="num">${escapeHtml(r.omani_female)}</td>
          <td class="num">${escapeHtml(r.omani_other)}</td>
          <td class="num">${escapeHtml(r.expat_male)}</td>
          <td class="num">${escapeHtml(r.expat_female)}</td>
          <td class="num">${escapeHtml(r.expat_other)}</td>
          <td class="num">${escapeHtml(r.emp_count)}</td>
          <td class="num">${escapeHtml(num(r.omani_perc, 2))}%</td>
        </tr>`,
    )
    .join("");
  return tableHtml(
    [
      { label: "SNo.", num: true, width: "4%" },
      { label: "Company" },
      { label: "Division" },
      { label: "Department" },
      { label: "Omani M", num: true },
      { label: "Omani F", num: true },
      { label: "Omani O", num: true },
      { label: "Expat M", num: true },
      { label: "Expat F", num: true },
      { label: "Expat O", num: true },
      { label: "Total", num: true },
      { label: "Omani %", num: true },
    ],
    body,
    grandTotalFull(12, rows.length),
  );
}

function renderBudgetedVariance(rows: ReportRow[]): string {
  const body = rows
    .map(
      (r, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td class="num">${escapeHtml(r.bud_month)}</td>
          <td>${escapeHtml(r.dept_code)}</td>
          <td>${escapeHtml(r.dept_name)}</td>
          <td>${escapeHtml(r.desg_code)}</td>
          <td class="num">${escapeHtml(r.budgeted)}</td>
          <td class="num">${escapeHtml(r.cur_month_budgt)}</td>
          <td class="num">${escapeHtml(r.joiners)}</td>
          <td class="num">${escapeHtml(r.leavers)}</td>
          <td class="num">${escapeHtml(r.actuals)}</td>
          <td class="num">${escapeHtml(r.prev_month_actuals)}</td>
        </tr>`,
    )
    .join("");
  return tableHtml(
    [
      { label: "SNo.", num: true, width: "4%" },
      { label: "Month", num: true },
      { label: "Dept" },
      { label: "Dept Name" },
      { label: "Desg" },
      { label: "Budgeted (YTD)", num: true },
      { label: "Current Month", num: true },
      { label: "Joiners", num: true },
      { label: "Leavers", num: true },
      { label: "Actuals", num: true },
      { label: "Prev Month", num: true },
    ],
    body,
    grandTotalFull(11, rows.length),
  );
}

function renderManpowerDept(rows: ReportRow[]): string {
  const body = rows
    .map(
      (r, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td>${escapeHtml(r.company_code)}</td>
          <td>${escapeHtml(r.div_code)}</td>
          <td>${escapeHtml(r.dept_code)}</td>
          <td>${escapeHtml(r.section_code)}</td>
          <td class="num">${escapeHtml(r.prev_year_cnt)}</td>
          <td class="num">${escapeHtml(r.join_addn_cnt)}</td>
          <td class="num">${escapeHtml(r.transfer_addn_cnt)}</td>
          <td class="num">${escapeHtml(r.promotion_addn_cnt)}</td>
          <td class="num">${escapeHtml(r.leave_addn_cnt)}</td>
          <td class="num">${escapeHtml(r.transfer_redn_cnt)}</td>
          <td class="num">${escapeHtml(r.promotion_redn_cnt)}</td>
        </tr>`,
    )
    .join("");
  return tableHtml(
    [
      { label: "SNo.", num: true, width: "4%" },
      { label: "Company" },
      { label: "Division" },
      { label: "Department" },
      { label: "Section" },
      { label: "Prev Year", num: true },
      { label: "Joins", num: true },
      { label: "Transfers", num: true },
      { label: "Promotions", num: true },
      { label: "Leave", num: true },
      { label: "Transfers −", num: true },
      { label: "Promotions −", num: true },
    ],
    body,
    grandTotalFull(12, rows.length),
  );
}

function renderGeneric(rows: ReportRow[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const heads: Head[] = [
    { label: "SNo.", num: true, width: "4%" },
    ...cols.map((c) => ({ label: c.replace(/_/g, " ").toUpperCase() })),
  ];
  const body = rows
    .map(
      (r, i) =>
        `<tr><td class="num">${i + 1}</td>` +
        cols.map((c) => `<td>${escapeHtml(r[c])}</td>`).join("") +
        `</tr>`,
    )
    .join("");
  return tableHtml(heads, body, grandTotalFull(cols.length + 1, rows.length));
}

function renderHeadCountBody(
  mode: string,
  rows: ReportRow[],
  filtersHtml: string,
  subtitle: string,
): string {
  const heading = `
    ${FONT_LINK}
    <div class="doc-title-row">
      <div>
        <h1>HR Employee Head Count List</h1>
        <div class="doc-subtitle">${escapeHtml(subtitle)}</div>
      </div>
    </div>`;

  if (!rows.length) {
    return `
      ${heading}
      ${filtersHtml}
      <div class="hc-empty">No data found</div>
    `;
  }

  let inner: string;
  switch (mode) {
    case "DIVISION_WISE":
      inner = renderDivisionWise(rows);
      break;
    case "DEPARTMENT_WISE":
      inner = renderDepartmentWise(rows);
      break;
    case "LOCAL_EXPAT":
      inner = renderLocalExpat(rows);
      break;
    case "BUDGETED_VARIANCE":
      inner = renderBudgetedVariance(rows);
      break;
    case "MANPOWER_DEPT":
      inner = renderManpowerDept(rows);
      break;
    default:
      // NATIONALITY_WISE / MONTHLY_JOINERS / MONTHLY_LEAVERS / MONTHLY_JOINERS_OPENING
      // fall back to a generic column-driven table until their SQL is added.
      inner = renderGeneric(rows);
  }

  return `
    ${heading}
    ${filtersHtml}
    ${inner}
  `;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export const getEmployeeHeadCountReportHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadHeadCountData(req);

    const headerHtml = await reportHeader({
      company_code: params.companyCode,
      req,
    });

    const filtersHtml = reportAppliedFilters([
      { label: "Report Mode", value: [params.reportModeLabel] },
      {
        label: "From Date",
        value: [params.fromDate ? fmtDate(params.fromDate) : "-"],
      },
      {
        label: "To Date",
        value: [params.toDate ? fmtDate(params.toDate) : "-"],
      },
    ]);

    const bodyHtml = renderHeadCountBody(
      params.reportMode,
      rows,
      filtersHtml,
      params.reportModeLabel,
    );

    const footerHtml = reportFooter({
      reportName: "rpt_employee_head_count",
      userName: params.loginId,
      endLabel: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: "HR Employee Head Count List",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: HEAD_COUNT_EXTRA_CSS,
      autoPrint: req.query.print !== "false",
      showPrintButton: true,
      orientation: "landscape", // wider tables (Local/Expat, Budgeted) read better
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Employee Head Count Report HTML error:", error);

    const oraNum = error?.errorNum;
    const oraCode = oraNum ? `ORA-${String(oraNum).padStart(5, "0")}` : undefined;

    res.status(error.status || 500).json({
      success: false,
      code: oraCode,
      message: error.message || "Unable to generate report",
    });
  }
};