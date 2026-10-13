// src/pages/hr/Reports/AbsenceReportHtml.ts
//
// HR Absence Report — HTML/print endpoint
//
// Same backend pattern as RetirementReportHtml.ts: it calls
// PROC_BUILD_DYNAMIC_SQL_HR_REPORT with the parameter
// 'Hr_Report_EMPLOYEE_ABSENCE' and lets the stored procedure build the
// dynamic SQL. The endpoint then executes that SQL and renders HTML.
//
// UI filter mapping (matches the AbsenceReport screen):
//   company_code   → P_CODE1   (defaults to logged-in user's company, 'All' if blank)
//   div_code       → P_CODE2
//   dept_code      → P_CODE3
//   section_code   → P_CODE4
//   employee_code  → P_CODE5
//   history ('Y'/'N') → P_CODE7
//   pay_month      → P_NUMBER1   (1..12, UI value is numeric)
//   pay_year       → P_NUMBER2   (e.g. 2026)

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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const MONTH_LABELS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function fmtDate(value: unknown): string {
  if (!value) return "";
  const d = new Date(value as any);
  if (Number.isNaN(d.getTime())) return text(value).slice(0, 10);
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dd}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

// ─── Param Parser ────────────────────────────────────────────────────────────

function allIfBlank(value: unknown): string {
  const v = text(value).trim();
  return v || "All";
}

function toNumber(value: unknown): number | null {
  const v = text(value).trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseParams(req: RequestWithUser) {
  const src = { ...(req.query as Record<string, any>), ...(req.body || {}) };

  // Prefer the logged-in user's company, but TRIM in case DB has trailing spaces.
  const userCompany = text(req.user?.company_code).trim();
  const companyCode = userCompany || text(src.company_code).trim() || "";

  return {
    companyCode,
    divCode: allIfBlank(src.div_code),
    deptCode: allIfBlank(src.dept_code),
    sectCode: allIfBlank(src.section_code ?? src.sect_code),
    employeeCode: allIfBlank(src.employee_code),
    payMonth: toNumber(src.pay_month),
    payYear: toNumber(src.pay_year),
    history: text(src.history).trim().toUpperCase() === "Y" ? "Y" : "N",
    loginId: text(req.user?.loginid || (req.user as any)?.username || ""),
  };
}

// ─── Data Loader ─────────────────────────────────────────────────────────────

const REPORT_PARAMETER = "Hr_Report_EMPLOYEE_ABSENCE";

async function loadAbsenceData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);

  console.log("[AbsenceReport] params:", {
    companyCode: params.companyCode,
    divCode: params.divCode,
    deptCode: params.deptCode,
    sectCode: params.sectCode,
    employeeCode: params.employeeCode,
    payMonth: params.payMonth,
    payYear: params.payYear,
    history: params.history,
  });

  if (!params.companyCode) {
    throw Object.assign(new Error("company_code is required"), { status: 400 });
  }
  if (!params.payMonth || !params.payYear) {
    throw Object.assign(new Error("pay_month and pay_year are required"), { status: 400 });
  }
  if (params.payMonth < 1 || params.payMonth > 12) {
    throw Object.assign(new Error("pay_month must be between 1 and 12"), { status: 400 });
  }

  const conn = await getConn(req);

  try {
    const binds: Record<string, any> = {
      p_parameter: REPORT_PARAMETER,
      p_loginid: params.loginId,
      p_number1: params.payMonth,   // Pay Month
      p_number2: params.payYear,    // Pay Year
      p_number3: null,
      p_number4: null,
      p_date1: null,                // not used for this report
      p_date2: null,
      p_date3: null,
      p_date4: null,
      p_return_string: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    // Order matters — matches the parameter positions inside
    // PROC_BUILD_DYNAMIC_SQL_HR_REPORT for the ABSENCE report:
    //   p_code1 = company
    //   p_code2 = division
    //   p_code3 = department
    //   p_code4 = section
    //   p_code5 = employee code
    //   p_code7 = history ('Y'/'N')
    const codes = [
      params.companyCode,
      params.divCode,
      params.deptCode,
      params.sectCode,
      params.employeeCode,
      null,             // p_code6 (unused)
      params.history,   // p_code7
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

    console.log("[AbsenceReport] Built SQL:", builtSql);

    if (!builtSql || builtSql.toUpperCase() === "INVALID PARAMETER VALUE") {
      throw Object.assign(new Error("Report procedure returned no query"), { status: 500 });
    }

    const result = await conn.execute(builtSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    console.log("[AbsenceReport] Rows returned:", (result.rows as any[])?.length ?? 0);

    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Extra CSS ────────────────────────────────────────────────────────────────

const ABSENCE_EXTRA_CSS = `
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

  .abs-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
    margin-top: 8px;
  }
  .abs-table th,
  .abs-table td {
    border: 1px solid #94a3b8;
    padding: 3px 5px;
    text-align: left;
    vertical-align: top;
  }
  .abs-table th {
    background: #f1f5f9;
    font-weight: 700;
    white-space: nowrap;
  }
  .abs-table td.num { text-align: right; }
  .abs-table td.days { font-weight: 700; text-align: right; }
  .abs-table thead { display: table-header-group; }
  .abs-table tr { page-break-inside: avoid; }

  .abs-total {
    margin-top: 8px;
    font-size: 10.5px;
    font-weight: 700;
  }
`;

// ─── Body Renderer ────────────────────────────────────────────────────────────
//
// Columns align with the SQL produced by
// PROC_BUILD_DYNAMIC_SQL_HR_REPORT 'Hr_Report_EMPLOYEE_ABSENCE':
//   EMPLOYEE_CODE, EMPLOYEE_ID, RPT_NAME, COMPANY_CODE, COMP_NAME,
//   DIV_CODE, DIV_NAME, DEPT_CODE, DEPT_NAME, SECTION_CODE, SECTION_NAME,
//   PAY_MONTH, PAY_YEAR, PAY_YEAR_MONTH, ATTEND_TYPE, COMPUTE_NO_OF_DAYS
//
// `normalize()` lowercases every column name.

function renderAbsenceBody(rows: ReportRow[], filtersHtml = ""): string {
  const heading = `<div class="rpt-title">ABSENCE REPORT</div>`;

  if (!rows.length) {
    return `
      ${heading}
      ${filtersHtml}
      <p class="center muted">No data found</p>
    `;
  }

  const bodyRows = rows
    .map(
      (r, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td>${escapeHtml(r.employee_code ?? r.employee_id)}</td>
          <td>${escapeHtml(r.rpt_name)}</td>
          <td>${escapeHtml(r.div_name)}</td>
          <td>${escapeHtml(r.dept_name)}</td>
          <td>${escapeHtml(r.section_name)}</td>
          <td>${escapeHtml(r.desg_name)}</td>
          <td class="num">${escapeHtml(r.pay_month)}</td>
          <td class="num">${escapeHtml(r.pay_year)}</td>
          <td>${escapeHtml(r.attend_type)}</td>
          <td class="days">${escapeHtml(r.compute_no_of_days)}</td>
        </tr>`,
    )
    .join("");

  return `
    ${heading}
    ${filtersHtml}
    <table class="abs-table">
      <thead>
        <tr>
          <th style="width:32px">#</th>
          <th style="width:110px">Employee</th>
          <th>Employee Name</th>
          <th style="width:120px">Division</th>
          <th style="width:140px">Department</th>
          <th style="width:140px">Section</th>
          <th style="width:140px">Designation</th>
          <th style="width:60px">Month</th>
          <th style="width:60px">Year</th>
          <th style="width:90px">Attend Type</th>
          <th style="width:80px">Days</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
    <div class="abs-total">Total: ${rows.length}</div>
  `;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export const getAbsenceReportHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadAbsenceData(req);

    const monthLabel =
      params.payMonth && params.payMonth >= 1 && params.payMonth <= 12
        ? MONTH_LABELS[params.payMonth - 1]
        : "";

    const headerHtml = await reportHeader({ company_code: params.companyCode, req });
    const filtersHtml = reportAppliedFilters([
      { label: "Division", value: [params.divCode] },
      { label: "Department", value: [params.deptCode] },
      { label: "Section", value: [params.sectCode] },
      { label: "Employee", value: [params.employeeCode] },
      { label: "Pay Month", value: [monthLabel || String(params.payMonth ?? "")] },
      { label: "Pay Year", value: [String(params.payYear ?? "")] },
      { label: "History", value: [params.history] },
    ]);
    const bodyHtml = renderAbsenceBody(rows, filtersHtml);
    const footerHtml = reportFooter({
      reportName: "rpt_absence",
      userName: params.loginId,
      endLabel: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: "Absence Report",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: ABSENCE_EXTRA_CSS,
      autoPrint: req.query.print !== "false",
      showPrintButton: true,
      orientation: "portrait",
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Absence Report HTML error:", error);

    const oraNum = error?.errorNum;
    const oraCode = oraNum ? `ORA-${String(oraNum).padStart(5, "0")}` : undefined;

    res.status(error.status || 500).json({
      success: false,
      code: oraCode,
      message: error.message || "Unable to generate report",
    });
  }
};