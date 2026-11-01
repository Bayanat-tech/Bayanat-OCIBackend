// src/controllers/wms/reports/SalaryRegister.controller.ts

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
      p_parameter: parameterForMode(params.reportMode),
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

    if (!builtSql || builtSql.toUpperCase() === "INVALID PARAMETER VALUE") {
      throw Object.assign(new Error("Report procedure returned no query"), { status: 500 });
    }

    const result = await conn.execute(builtSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Extra CSS ────────────────────────────────────────────────────────────────

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
    display: flex; justify-content: space-between; align-items: flex-end;
    margin: 4px 0 10px 0;
  }
  body .doc-title-row h1 {
    margin: 0;
    font-size: 16px;
    font-weight: 800;
    color: #00378c !important;
    letter-spacing: 0;
  }

  .table-container {
    width: 100%;
    overflow-x: auto; /* Allows scrolling if it overflows on screen */
  }

  table.sal-table {
    width: 1100px; /* Fixed width wider than page to force scaling */
    table-layout: fixed; /* Forces browser to respect column widths */
    border-collapse: collapse;
    font-size: 9px;
    margin-top: 6px;
    border: 1px solid #94a3b8;
  }

  table.sal-table thead th {
    background: #00378c !important;
    color: #ffffff !important;
    font-weight: 700;
    font-size: 8px; /* Smaller font for headers */
    letter-spacing: 0;
    padding: 6px 4px;
    text-align: left;
    vertical-align: middle;
    border: 0 !important;
    border-right: 1px solid rgba(255, 255, 255, 0.45) !important;
    box-shadow: inset 0 0 0 1000px #00378c;
    white-space: normal;
    overflow-wrap: break-word;
  }
  table.sal-table thead th.num-head { text-align: right; }
  
  /* Group Headers */
  .super-head {
    background: #002560 !important;
    text-align: center !important;
    border-bottom: 1px solid #00378c !important;
    font-size: 9px;
    padding: 4px !important;
  }

  table.sal-table tbody td {
    padding: 4px 4px;
    border: 0;
    border-bottom: 1px solid #94a3b8 !important;
    border-right: 1px solid #94a3b8 !important;
    color: #1e293b;
    font-size: 8.5px;
    font-weight: 400;
    background: #fcfdfe;
    vertical-align: middle;
    white-space: normal;
    overflow-wrap: anywhere;
    overflow: hidden;
  }

  /* Department Grouping Rows */
  .dept-group-row td {
    background: #e2e8f0 !important;
    color: #00378c !important;
    font-weight: 700 !important;
    text-align: left !important;
    font-size: 10px !important;
    padding: 4px 6px !important;
    border-bottom: 1px solid #cbd5e1 !important;
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

  /* Signatures */
  .signatures-row {
    display: flex;
    justify-content: space-between;
    margin-top: 120px;
    padding: 0 10px;
  }
  .signature-box {
    width: 30%;
    text-align: center;
    font-size: 11px;
    font-weight: 600;
    color: #1e293b;
  }
  .signature-line {
    border-top: 1px solid #000;
    margin-bottom: 6px;
    padding-top: 5px;
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

function renderSalaryRegisterBody(rows: ReportRow[], filtersHtml = "", params: any): string {
  const periodStr = `${MONTHS[params.payMonth - 1]} ${params.payYear}`;
  
    const heading = `
    ${FONT_LINK}
    <div class="doc-title-row">
      <div><h1>Salary Register - ${periodStr}</h1></div>
    </div>`;
    
  if (!rows.length) {
    return `
      ${heading}
      ${filtersHtml}
      <div class="sal-empty">No data found</div>
    `;
  }

  const cols = detectColumns(rows);

  // Exclude department column from the main grid since we group by it
  const displayCols = cols.filter(c => c.key !== "dept_name");

  // Build Super Headers (Earnings / Deductions)
  let superHeaderHtml = `<th rowspan="2" class="num-head" style="vertical-align: middle; width: 4%;">SNo.</th>`;
  
  // Hardcoded layout to match your exact design
  const earningsCount = 9; // EMPLOYEE_NAME, EMPLOYEE_CODE, BASIC, HRA, INC, OA, TA, TEL_ALLOW, EARN_SUB_TOTAL
  const deductionsCount = 2; // PTDED, DED_SUB_TOTAL

  superHeaderHtml += `<th colspan="${earningsCount}" class="super-head">Earnings</th>`;
  superHeaderHtml += `<th colspan="${deductionsCount}" class="super-head">Deductions</th>`;
  superHeaderHtml += `<th rowspan="2" class="num-head" style="vertical-align: middle; width: 9%;">Grand Total</th>`;

  // Manually assign widths. Total = 4 (SNo) + 14 + 9 + 7 + 5x6.5 + 9 + 6.5 + 9 + 9 (Grand Total) = 100%
  const getWidth = (key: string) => {
    if (key === 'employee_name') return '14%';
    if (key === 'employee_code') return '9%';
    if (key === 'basic') return '7%';
    if (key === 'earn_sub_total') return '9%';
    if (key === 'ded_sub_total') return '9%';
    return '6.5%'; // default for other numeric columns
  };

  const dataCols = displayCols.filter(c => c.key !== "grand_total"); // Grand total is handled in super header

  // table-layout: fixed only reads widths from the first row / <col>, and the first row
  // here is made of colspan cells, so widths on the sub-header <th>s are ignored.
  // <colgroup> sets them reliably.
  const colGroupHtml = `
    <colgroup>
      <col style="width: 4%;">
      ${dataCols.map(c => `<col style="width: ${getWidth(c.key)};">`).join("")}
      <col style="width: 9%;">
    </colgroup>`;

  // Build Sub Headers (Column Names)
  const subHeaderHtml = dataCols
    .map(c => `<th class="${c.kind === "amount" ? "num-head" : ""}" style="width: ${getWidth(c.key)};">${escapeHtml(c.label)}</th>`)
    .join("");

  const cell = (c: (typeof cols)[number], v: unknown): string => {
    if (c.kind === "amount") return `<td class="num">${fmtAmount(Number(v) || 0)}</td>`;
    if (c.kind === "date") return `<td class="center">${escapeHtml(fmtDate(v))}</td>`;
    return `<td>${escapeHtml(v)}</td>`;
  };

  // Group rows by Department
  const groupedRows = new Map<string, ReportRow[]>();
  let currentSno = 1;

  rows.forEach(r => {
    const dept = r.dept_name ? String(r.dept_name).trim() : "UNKNOWN DEPARTMENT";
    if (!groupedRows.has(dept)) {
      groupedRows.set(dept, []);
    }
    groupedRows.get(dept)!.push(r);
  });

  let bodyRowsHtml = "";
  
  for (const [deptName, deptRows] of groupedRows.entries()) {
    // Department Header Row
    const colSpanTotal = displayCols.length + 1; // +1 for SNo
    bodyRowsHtml += `
      <tr class="dept-group-row">
        <td colspan="${colSpanTotal}">${escapeHtml(deptName)}</td>
      </tr>
    `;

    // Employee Rows
    deptRows.forEach((r) => {
      bodyRowsHtml += `
        <tr>
          <td class="num">${currentSno++}</td>
          ${displayCols.map((c) => cell(c, r[c.key])).join("")}
        </tr>`;
    });
  }

  // Grand Total Row
  // colspan="3" already covers SNo + employee_name + employee_code, so skip those 2 text columns here
  const totalCells = displayCols
    .filter(c => c.key !== "grand_total")
    .slice(2)
    .map((c) => {
      if (!c.total) return `<td></td>`;
      const sum = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
      return `<td class="num">${fmtAmount(sum)}</td>`;
    })
    .join("");

  // Calculate total grand total
  const grandTotalSum = rows.reduce((s, r) => s + (Number(r['grand_total']) || 0), 0);

  const grandTotalRow = `
        <tr class="grand-total-row">
          <td colspan="3" class="num">TOTAL (${rows.length} Employees)</td>
          ${totalCells}
          <td class="num">${fmtAmount(grandTotalSum)}</td>
        </tr>`;

  // Signatures
  const signaturesHtml = `
    <div class="signatures-row">
      <div class="signature-box">
        <div class="signature-line"></div>
        Prepared By
      </div>
      <div class="signature-box">
        <div class="signature-line"></div>
        Reviewed By
      </div>
      <div class="signature-box">
        <div class="signature-line"></div>
        Approved By
      </div>
    </div>
  `;

  return `
    ${heading}
    ${filtersHtml}
    <div class="table-container">
      <table class="sal-table">
        ${colGroupHtml}
        <thead>
          <tr>${superHeaderHtml}</tr>
          <tr>${subHeaderHtml}</tr>
        </thead>
        <tbody>
          ${bodyRowsHtml}
          ${grandTotalRow}
        </tbody>
      </table>
    </div>
    ${signaturesHtml}
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
    const bodyHtml = renderSalaryRegisterBody(rows, filtersHtml, params);
    const footerHtml = reportFooter({
      reportName: "rpt_salary_register",
      userName: params.loginId,
      endLabel: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: `Salary Register - ${MONTHS[params.payMonth - 1]} ${params.payYear}`,
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