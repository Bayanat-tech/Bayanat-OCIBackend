// src/controllers/wms/reports/EmployeeHeadCountReport.controller.ts
//
// HR Employee Head Count List — HTML/print endpoint
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

      p_date1: { val: params.fromDate, type: oracledb.DATE },
      p_date2: { val: params.toDate, type: oracledb.DATE },
      p_date3: { val: null, type: oracledb.DATE },
      p_date4: { val: null, type: oracledb.DATE },

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

// ─── Extra CSS ────────────────────────────────────────────────────────────────

const HEAD_COUNT_EXTRA_CSS = `
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }

  .rpt-title {
    text-align: center;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 3px;
    padding: 5px 0;
    margin: 0 0 10px;
    border-bottom: 1px solid #cbd5e1;
  }
  .rpt-subtitle {
    text-align: center;
    font-size: 11px;
    color: #475569;
    font-weight: 600;
    margin: 0 0 10px;
    letter-spacing: 0.5px;
  }

  .hc-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
    margin-top: 8px;
  }
  .hc-table th,
  .hc-table td {
    border: 1px solid #94a3b8;
    padding: 4px 6px;
    text-align: left;
    vertical-align: middle;
  }
  .hc-table th {
    background: #f1f5f9;
    font-weight: 700;
    white-space: nowrap;
  }
  .hc-table td.num { text-align: right; }
  .hc-table td.ctr { text-align: center; }
  .hc-table td.bold { font-weight: 700; }
  .hc-table thead { display: table-header-group; }
  .hc-table tr { page-break-inside: avoid; }
  .hc-table tbody tr:nth-child(even) td { background: #f8fafc; }

  .hc-total {
    margin-top: 8px;
    font-size: 10.5px;
    font-weight: 700;
  }
`;

// ─── Body Renderers (one per mode) ───────────────────────────────────────────

function renderDivisionWise(rows: ReportRow[]): string {
  const total = rows.reduce((s, r) => s + Number(r.head_count || 0), 0);
  const body = rows
    .map(
      (r, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td>${escapeHtml(r.div_name)}</td>
          <td class="num bold">${escapeHtml(r.head_count)}</td>
        </tr>`,
    )
    .join("");
  return `
    <table class="hc-table">
      <thead>
        <tr>
          <th style="width:36px">#</th>
          <th>Division</th>
          <th style="width:120px">Head Count</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
    <div class="hc-total">Total Head Count: ${total}</div>
  `;
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
          <td class="num bold">${escapeHtml(r.head_count)}</td>
        </tr>`,
    )
    .join("");
  return `
    <table class="hc-table">
      <thead>
        <tr>
          <th style="width:36px">#</th>
          <th>Division</th>
          <th>Department</th>
          <th style="width:120px">Head Count</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
    <div class="hc-total">Total Head Count: ${total}</div>
  `;
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
          <td class="num bold">${escapeHtml(r.emp_count)}</td>
          <td class="num">${escapeHtml(num(r.omani_perc, 2))}%</td>
        </tr>`,
    )
    .join("");
  return `
    <table class="hc-table">
      <thead>
        <tr>
          <th style="width:36px">#</th>
          <th>Company</th>
          <th>Division</th>
          <th>Department</th>
          <th>Omani M</th>
          <th>Omani F</th>
          <th>Omani O</th>
          <th>Expat M</th>
          <th>Expat F</th>
          <th>Expat O</th>
          <th>Total</th>
          <th>Omani %</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
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
  return `
    <table class="hc-table">
      <thead>
        <tr>
          <th style="width:36px">#</th>
          <th>Month</th>
          <th>Dept</th>
          <th>Dept Name</th>
          <th>Desg</th>
          <th>Budgeted (YTD)</th>
          <th>Current Month</th>
          <th>Joiners</th>
          <th>Leavers</th>
          <th>Actuals</th>
          <th>Prev Month</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
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
  return `
    <table class="hc-table">
      <thead>
        <tr>
          <th style="width:36px">#</th>
          <th>Company</th>
          <th>Division</th>
          <th>Department</th>
          <th>Section</th>
          <th>Prev Year</th>
          <th>Joins</th>
          <th>Transfers</th>
          <th>Promotions</th>
          <th>Leave</th>
          <th>Transfers −</th>
          <th>Promotions −</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function renderGeneric(rows: ReportRow[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const head = cols.map((c) => `<th>${escapeHtml(c.replace(/_/g, " ").toUpperCase())}</th>`).join("");
  const body = rows
    .map(
      (r, i) =>
        `<tr><td class="num">${i + 1}</td>` +
        cols.map((c) => `<td>${escapeHtml(r[c])}</td>`).join("") +
        `</tr>`,
    )
    .join("");
  return `
    <table class="hc-table">
      <thead><tr><th style="width:36px">#</th>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function renderHeadCountBody(
  mode: string,
  rows: ReportRow[],
  filtersHtml: string,
  subtitle: string,
): string {
  const heading = `<div class="rpt-title">HR EMPLOYEE HEAD COUNT LIST</div>`;
  const sub = `<div class="rpt-subtitle">${escapeHtml(subtitle)}</div>`;

  if (!rows.length) {
    return `
      ${heading}
      ${sub}
      ${filtersHtml}
      <p class="center muted">No data found</p>
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
    ${sub}
    ${filtersHtml}
    ${inner}
    <div class="hc-total">Total Records: ${rows.length}</div>
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