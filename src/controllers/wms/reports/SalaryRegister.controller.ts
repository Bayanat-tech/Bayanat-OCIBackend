// src/controllers/wms/reports/SalaryRegister.controller.ts
//
// HR Salary Register — HTML/print endpoint
// Modeled on RetirementReport.controller.ts (same proc, same visual style).
// Columns are rendered dynamically from whatever the built SQL returns, so the
// report follows the DB query without frontend/backend column drift.

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

function fmtDate(value: unknown): string {
  if (!value) return "";
  const d = new Date(value as any);
  if (Number.isNaN(d.getTime())) return text(value).slice(0, 10);
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dd}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

function fmtAmount(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${abs})` : abs;
}

// ─── Param Parser ────────────────────────────────────────────────────────────

const REPORT_MODE_LABELS: Record<string, string> = {
  TIMESHEET: "Time Sheet",
  PAYROLL: "Pay Roll",
  VACATION: "Vacation Settlement",
  SEPARATION: "Separation",
  LEAVE_ENCASHMENT: "Leave Encashment",
  ALL: "All",
};

function allIfBlank(value: unknown): string {
  const v = text(value).trim();
  return v || "All";
}

function parseParams(req: RequestWithUser) {
  const src = { ...(req.query as Record<string, any>), ...(req.body || {}) };

  // Prefer the logged-in user's company, but TRIM in case DB has trailing spaces.
  const userCompany = text(req.user?.company_code).trim();
  const companyCode = userCompany || text(src.company_code).trim() || "";

  const payMonth = Number(text(src.pay_month).trim());
  const payYear = Number(text(src.pay_year).trim());
  const reportMode = text(src.report_mode).trim().toUpperCase() || "PAYROLL";

  return {
    companyCode,
    divCode: allIfBlank(src.div_code),
    deptCode: allIfBlank(src.dept_code),
    sectCode: allIfBlank(src.section_code ?? src.sect_code),
    employeeCode: allIfBlank(src.employee_code),
    payMonth: Number.isFinite(payMonth) ? payMonth : 0,
    payYear: Number.isFinite(payYear) ? payYear : 0,
    earnDed: allIfBlank(src.earn_ded),
    historyReport: text(src.history_report).trim().toUpperCase() === "Y" ? "Y" : "N",
    reportMode,
    loginId: text(req.user?.loginid || (req.user as any)?.username || ""),
  };
}

// ─── Parameter Dispatcher ────────────────────────────────────────────────────
//
// The procedure PROC_BUILD_DYNAMIC_SQL_HR_REPORT has ONE `WHEN` branch per
// report mode. The controller picks the branch name based on `report_mode`.

function parameterForMode(mode: string): string {
  switch ((mode || "PAYROLL").toUpperCase()) {
    case "TIMESHEET":        return "Hr_Report_SALARY_REGISTER_TIMESHEET";
    case "PAYROLL":          return "Hr_Report_SALARY_REGISTER_PAYROLL";
    case "VACATION":         return "Hr_Report_SALARY_REGISTER_VACATION";
    case "SEPARATION":       return "Hr_Report_SALARY_REGISTER_SEPARATION";
    case "LEAVE_ENCASHMENT": return "Hr_Report_SALARY_REGISTER_LEAVE_ENCASHMENT";
    case "ALL":              return "Hr_Report_SALARY_REGISTER_ALL";
    default:                 return "Hr_Report_SALARY_REGISTER_PAYROLL";
  }
}

// ─── Data Loader ─────────────────────────────────────────────────────────────

async function loadSalaryRegisterData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);

  console.log("[SalaryRegister] params:", params);
  console.log("[SalaryRegister] proc parameter:", parameterForMode(params.reportMode));

  if (!params.companyCode) {
    throw Object.assign(new Error("company_code is required"), { status: 400 });
  }
  if (params.payMonth < 1 || params.payMonth > 12) {
    throw Object.assign(new Error("pay_month must be between 1 and 12"), { status: 400 });
  }
  if (params.payYear < 1900 || params.payYear > 9999) {
    throw Object.assign(new Error("pay_year must be a valid 4-digit year"), { status: 400 });
  }

  const conn = await getConn(req);

  try {
    const binds: Record<string, any> = {
      p_parameter: parameterForMode(params.reportMode),   // ← dispatches per mode
      p_loginid: params.loginId,
      p_number1: params.payMonth,
      p_number2: params.payYear,
      p_number3: null,
      p_number4: null,
      p_date1: { val: null, type: oracledb.DATE },
      p_date2: { val: null, type: oracledb.DATE },
      p_date3: { val: null, type: oracledb.DATE },
      p_date4: { val: null, type: oracledb.DATE },
      p_return_string: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    const codes = [
      params.companyCode,
      params.divCode,
      params.deptCode,
      params.sectCode,
      params.employeeCode,
      params.earnDed,
      params.historyReport,
      params.reportMode,
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

    console.log("[SalaryRegister] Built SQL:", builtSql);

    if (!builtSql || builtSql.toUpperCase() === "INVALID PARAMETER VALUE") {
      throw Object.assign(new Error("Report procedure returned no query"), { status: 500 });
    }

    const result = await conn.execute(builtSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    console.log("[SalaryRegister] Rows returned:", (result.rows as any[])?.length ?? 0);

    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Extra CSS — same look as the Retirement report ──────────────────────────

const SALARY_EXTRA_CSS = `
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }

  body, table.sal-table {
    font-family: Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  }

  .doc-title-row {
    display: flex; justify-content: space-between; align-items: flex-start;
    margin: 4px 0 10px 0;
  }
  body .doc-title-row h1 {
    margin: 0;
    font-size: 16px;
    font-weight: 800;
    color: #00378c !important;
    letter-spacing: 0;
  }

  table.sal-table {
    width: 100%;
    max-width: 100%;
    border-collapse: collapse;
    table-layout: auto;
    font-size: 10px;
    margin-top: 6px;
    border: 0;
  }

  table.sal-table thead th {
    background: #00378c !important;
    color: #ffffff !important;
    font-weight: 700;
    font-size: 10px;
    letter-spacing: 0;
    padding: 8px 6px;
    text-align: left;
    vertical-align: middle;
    border: 0 !important;
    box-shadow: inset 0 0 0 1000px #00378c;
    white-space: normal;
    overflow-wrap: break-word;
  }
  table.sal-table thead th.num-head { text-align: right; }

  table.sal-table tbody td {
    padding: 5px 6px;
    border: 0;
    border-bottom: 1px solid #e2e8f0 !important;
    color: #1e293b;
    font-size: 10px;
    font-weight: 400;
    background: #fcfdfe;
    vertical-align: middle;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .center { text-align: center; }
  .left   { text-align: left; }
  .right  { text-align: right; }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  table.sal-table tbody tr.grand-total-row td {
    background: #e2e8f0 !important;
    color: #00378c !important;
    font-weight: 800;
    border-bottom: 1px solid #cbd5e1 !important;
  }

  .sal-empty {
    border: 1px dashed #cbd5e1;
    background: #f8fafc;
    text-align: center;
    padding: 40px 12px;
    margin-top: 14px;
    color: #64748b;
    font-weight: 700;
  }

  @media screen {
    body .doc-title-row h1 { font-size: 13px; }
    table.sal-table { font-size: 9px; }
    table.sal-table thead th { font-size: 9px; padding: 6px 5px; }
    table.sal-table tbody td { padding: 4px 5px; font-size: 9px; }
  }

  @media print {
    body .doc-title-row h1 { color: #00378c !important; }

    table.sal-table thead { display: table-header-group; }
    table.sal-table tr    { page-break-inside: avoid; }

    table.sal-table thead th {
      background: #00378c !important;
      color: #ffffff !important;
      box-shadow: inset 0 0 0 1000px #00378c;
    }
  }
`;

const FONT_LINK = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">`;

// ─── Column detection ────────────────────────────────────────────────────────

type ColKind = "text" | "date" | "amount";

// Numeric columns that must NOT be summed in the grand total
const NO_TOTAL_RE = /(^|_)(id|code|no|sno|year|month|days?|age)$/i;

function detectColumns(rows: ReportRow[]) {
  const keys = Object.keys(rows[0] || {});
  return keys.map((key) => {
    const sample = rows.map((r) => r[key]).filter((v) => v != null && v !== "");
    let kind: ColKind = "text";
    if (sample.length && sample.every((v) => v instanceof Date)) kind = "date";
    else if (sample.length && sample.every((v) => typeof v === "number")) kind = "amount";
    return {
      key,
      kind,
      label: key.replace(/_/g, " ").toUpperCase(),
      total: kind === "amount" && !NO_TOTAL_RE.test(key),
    };
  });
}

// ─── Body Renderer ────────────────────────────────────────────────────────────

function renderSalaryRegisterBody(rows: ReportRow[], filtersHtml = ""): string {
  const heading = `
    ${FONT_LINK}
    <div class="doc-title-row">
      <div><h1>Salary Register</h1></div>
    </div>`;

  if (!rows.length) {
    return `
      ${heading}
      ${filtersHtml}
      <div class="sal-empty">No data found</div>
    `;
  }

  const cols = detectColumns(rows);

  const headCells =
    `<th class="num-head">SNo.</th>` +
    cols
      .map(
        (c) =>
          `<th class="${c.kind === "amount" ? "num-head" : ""}">${escapeHtml(c.label)}</th>`,
      )
      .join("");

  const cell = (c: (typeof cols)[number], v: unknown): string => {
    if (c.kind === "amount") return `<td class="num">${fmtAmount(Number(v) || 0)}</td>`;
    if (c.kind === "date") return `<td class="center">${escapeHtml(fmtDate(v))}</td>`;
    return `<td>${escapeHtml(v)}</td>`;
  };

  const bodyRows = rows
    .map(
      (r, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          ${cols.map((c) => cell(c, r[c.key])).join("")}
        </tr>`,
    )
    .join("");

  const totalCells = cols
    .map((c) => {
      if (!c.total) return `<td></td>`;
      const sum = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
      return `<td class="num">${fmtAmount(sum)}</td>`;
    })
    .join("");

  const grandTotal = `
        <tr class="grand-total-row">
          <td colspan="1" class="num">TOTAL (${rows.length})</td>
          ${totalCells}
        </tr>`;

  return `
    ${heading}
    ${filtersHtml}
    <table class="sal-table">
      <thead><tr>${headCells}</tr></thead>
      <tbody>${bodyRows}${grandTotal}</tbody>
    </table>
  `;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export const getSalaryRegisterHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadSalaryRegisterData(req);

    const headerHtml = await reportHeader({ company_code: params.companyCode, req });
    const filtersHtml = reportAppliedFilters([
      { label: "Division", value: [params.divCode] },
      { label: "Department", value: [params.deptCode] },
      { label: "Section", value: [params.sectCode] },
      { label: "Employee", value: [params.employeeCode] },
      { label: "Pay Period", value: [`${MONTHS[params.payMonth - 1]} ${params.payYear}`] },
      { label: "Earn / Ded", value: [params.earnDed] },
      { label: "History", value: [params.historyReport === "Y" ? "Yes" : "No"] },
      {
        label: "Report Type",
        value: [REPORT_MODE_LABELS[params.reportMode] || params.reportMode],
      },
    ]);
    const bodyHtml = renderSalaryRegisterBody(rows, filtersHtml);
    const footerHtml = reportFooter({
      reportName: "rpt_salary_register",
      userName: params.loginId,
      endLabel: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: "Salary Register",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: SALARY_EXTRA_CSS,
      autoPrint: req.query.print !== "false",
      showPrintButton: true,
      orientation: "landscape",
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Salary Register HTML error:", error);

    const oraNum = error?.errorNum;
    const oraCode = oraNum ? `ORA-${String(oraNum).padStart(5, "0")}` : undefined;

    res.status(error.status || 500).json({
      success: false,
      code: oraCode,
      message: error.message || "Unable to generate report",
    });
  }
};