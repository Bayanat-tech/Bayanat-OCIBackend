// src/controllers/wms/reports/HrVarianceReport.controller.ts

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

// 3 decimals, minus sign for negatives, ".000" for zero (matches PowerBuilder)
function fmtNum(n: number): string {
  const s = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
  const body = s.startsWith("0.") ? s.slice(1) : s;
  return n < 0 && Math.abs(n) >= 0.0005 ? `-${body}` : body;
}

const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function monthLabel(value: string): string {
  const m = Number(value);
  return Number.isInteger(m) && m >= 1 && m <= 12 ? MONTH_NAMES[m - 1] : value;
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

  return {
    companyCode,
    divCode: allIfBlank(src.div_code),
    deptCode: allIfBlank(src.dept_code),
    sectCode: allIfBlank(src.section_code ?? src.sect_code),
    employeeCode: allIfBlank(src.employee_code),
    currentPayMonth: allIfBlank(src.curr_pay_month),
    previousPayMonth: allIfBlank(src.prev_pay_month),
    payYear: allIfBlank(src.pay_year),
    reportType: allIfBlank(src.report_type),
    historyReport: text(src.history_report).trim().toUpperCase() === "Y" ? "Y" : "N",
    showDifferenceOnly: text(src.as_difference_only).trim().toUpperCase() === "Y" ? "Y" : "N",
    loginId: text(req.user?.loginid || (req.user as any)?.username || ""),
  };
}

// ─── Populate staging table (SP_HR_PAYROLL_COMPARISON deletes, inserts and commits itself) ──

async function populateComparisonTable(
  conn: oracledb.Connection,
  params: ReturnType<typeof parseParams>,
): Promise<void> {
  const payMonth = Number(params.currentPayMonth);
  const payYear = Number(params.payYear);

  if (!Number.isInteger(payMonth) || payMonth < 1 || payMonth > 12) {
    throw Object.assign(new Error("Invalid current pay month"), { status: 400 });
  }
  if (!Number.isInteger(payYear)) {
    throw Object.assign(new Error("Invalid pay year"), { status: 400 });
  }

  try {
    await conn.execute(
      `BEGIN
         SP_HR_PAYROLL_COMPARISON(
           VS_COMPANYCODE  => :vs_companycode,
           VS_DIVCODE      => :vs_divcode,
           VS_DEPT_CODE    => :vs_dept_code,
           VS_SECTION_CODE => :vs_section_code,
           VS_EMPLOYEE_ID  => :vs_employee_id,
           VS_PAY_MONTH    => :vs_pay_month,
           VS_PAY_YEAR     => :vs_pay_year,
           VS_HISTORYYN    => :vs_historyyn
         );
       END;`,
      {
        vs_companycode: params.companyCode,
        vs_divcode: params.divCode,
        vs_dept_code: params.deptCode,
        vs_section_code: params.sectCode,
        vs_employee_id: params.employeeCode, // employee ID, or 'All'
        vs_pay_month: payMonth,
        vs_pay_year: payYear,
        vs_historyyn: params.historyReport,
      },
    );
  } catch (e) {
    try {
      await conn.rollback();
    } catch {}
    throw e;
  }
}

// ─── Data Loader ─────────────────────────────────────────────────────────────

async function loadVarianceReportData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);

  console.log("[VarianceReport] params:", params);

  if (!params.companyCode) {
    throw Object.assign(new Error("company_code is required"), { status: 400 });
  }

  const conn = await getConn(req);

  try {
    // Payroll Comparison only: fill REP_HR_PAYROLL_COMPARISON first
    if (params.reportType.toUpperCase() === "PAYROLL") {
      await populateComparisonTable(conn, params);
    }

    const binds: Record<string, any> = {
      p_parameter: "Hr_Report_VARIANCE_REPORT", // Must match the WHEN block in your procedure
      p_loginid: params.loginId,

      // Mapped per your procedure parameters
      p_code1: params.companyCode,
      p_code2: params.divCode,
      p_code3: params.deptCode,
      p_code4: params.sectCode,
      p_code5: params.employeeCode,
      p_code6: params.currentPayMonth,
      p_code7: params.previousPayMonth,
      p_code8: params.payYear,
      p_code9: params.reportType,
      p_code10: params.showDifferenceOnly,
      p_code11: params.historyReport,

      p_number1: null,
      p_number2: null,
      p_number3: null,
      p_number4: null,
      p_date1: { val: null, type: oracledb.DATE },
      p_date2: { val: null, type: oracledb.DATE },
      p_date3: { val: null, type: oracledb.DATE },
      p_date4: { val: null, type: oracledb.DATE },
      p_return_string: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    // Fill remaining p_code parameters with null just in case
    for (let i = 12; i <= 20; i++) {
      binds[`p_code${i}`] = null;
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

    console.log("[VarianceReport] Built SQL:", builtSql);

    if (!builtSql || builtSql.toUpperCase() === "INVALID PARAMETER VALUE") {
      throw Object.assign(new Error("Report procedure returned no query"), { status: 500 });
    }

    const result = await conn.execute(builtSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    console.log("[VarianceReport] Rows returned:", (result.rows as any[])?.length ?? 0);

    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── CSS for HTML Report ─────────────────────────────────────────────────────

const VARIANCE_EXTRA_CSS = `
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }
  body, table.var-table { font-family: Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif; }
  .doc-title-row { display: flex; justify-content: space-between; align-items: flex-start; margin: 4px 0 10px 0; }
  body .doc-title-row h1 { margin: 0; font-size: 16px; font-weight: 800; color: #00378c !important; letter-spacing: 0; }

  table.var-table { width: 100%; max-width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; margin-top: 6px; border: 0; }
  table.var-table thead th { background: #00378c !important; color: #ffffff !important; font-weight: 700; font-size: 10px; padding: 8px 6px; text-align: left; border: 0 !important; box-shadow: inset 0 0 0 1000px #00378c; }
  table.var-table thead th.num-head { text-align: right; }

  table.var-table tbody td { padding: 4px 6px; border: 0; color: #1e293b; font-size: 10px; font-weight: 400; background: #fcfdfe; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }

  table.var-table tbody tr.emp-row td { padding-top: 10px; font-weight: 800; font-size: 10.5px; color: #0f172a; border-top: 1px solid #e2e8f0; }
  table.var-table tbody tr.grp-row td { padding-left: 24px; font-weight: 600; color: #334155; }
  table.var-table tbody tr.comp-row td.comp { padding-left: 24px; }
  table.var-table tbody tr.net-row td { font-weight: 800; color: #00378c !important; border-top: 1px solid #94a3b8; border-bottom: 1px solid #94a3b8; background: #f1f5f9 !important; }
  table.var-table tbody tr.net-row td.net-label { text-align: right; }
  table.var-table tbody tr.tot-row td { background: #e2e8f0 !important; color: #00378c !important; font-weight: 800; }
  table.var-table tbody tr.tot-row td.net-label { text-align: right; }
  table.var-table tbody tr.tot-first td { border-top: 2px solid #00378c; }
  table.var-table tbody tr.tot-last td { border-bottom: 2px solid #00378c; }

  .var-empty { border: 1px dashed #cbd5e1; background: #f8fafc; text-align: center; padding: 40px 12px; margin-top: 14px; color: #64748b; font-weight: 700; }

  @media print {
    table.var-table thead { display: table-header-group; }
    table.var-table tr { page-break-inside: avoid; }
    table.var-table thead th { background: #00378c !important; color: #ffffff !important; box-shadow: inset 0 0 0 1000px #00378c; }
  }
`;

const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">`;

// ─── Grouping ────────────────────────────────────────────────────────────────

type EmpGroup = { code: string; name: string; rows: ReportRow[] };

const n = (v: unknown): number => Number(v) || 0;

function groupByEmployee(rows: ReportRow[]): EmpGroup[] {
  const map = new Map<string, EmpGroup>();
  for (const r of rows) {
    const id = text(r.employee_id);
    let g = map.get(id);
    if (!g) {
      g = { code: text(r.emp_code), name: text(r.emp_name), rows: [] };
      map.set(id, g);
    }
    g.rows.push(r);
  }
  return Array.from(map.values());
}

const earnDed = (r: ReportRow): string => text(r.earn_ded).trim().toUpperCase();

// ─── Body Renderer ────────────────────────────────────────────────────────────

function renderVarianceReportBody(
  rows: ReportRow[],
  filtersHtml: string,
  currLabel: string,
  prevLabel: string,
): string {
  const heading = `${FONT_LINK}<div class="doc-title-row"><div><h1>HR Variance Report</h1></div></div>`;

  if (!rows.length) {
    return `${heading}${filtersHtml}<div class="var-empty">No data found</div>`;
  }

  const numCells = (cur: number, pre: number, variance: number): string =>
    `<td class="num">${fmtNum(cur)}</td><td class="num">${fmtNum(pre)}</td><td class="num">${fmtNum(variance)}</td>`;

  // E and D first, then any other EARN_DED value in order of appearance
  const sectionKeys: string[] = ["E", "D"];
  for (const r of rows) {
    const k = earnDed(r);
    if (k && !sectionKeys.includes(k)) sectionKeys.push(k);
  }
  const sectionLabel = (k: string): string => (k === "E" ? "Earnings" : k === "D" ? "Deduction" : k);

  let totEarnCur = 0;
  let totEarnPre = 0;
  let totDedCur = 0;
  let totDedPre = 0;
  let body = "";

  for (const g of groupByEmployee(rows)) {
    body += `<tr class="emp-row"><td>${escapeHtml(g.code)}</td><td colspan="4">${escapeHtml(g.name)}</td></tr>`;

    let netCur = 0;
    let netPre = 0;

    for (const key of sectionKeys) {
      const secRows = g.rows.filter((r) => earnDed(r) === key);
      if (!secRows.length) continue;

      body += `<tr class="grp-row"><td colspan="5">${escapeHtml(sectionLabel(key))}</td></tr>`;

      for (const r of secRows) {
        const cur = n(r.cur_value);
        const pre = n(r.pre_value);

        if (key === "E") {
          netCur += cur;
          netPre += pre;
          totEarnCur += cur;
          totEarnPre += pre;
        } else if (key === "D") {
          netCur -= cur;
          netPre -= pre;
          totDedCur += cur;
          totDedPre += pre;
        } // other codes: shown, not in net or totals

        body += `
          <tr class="comp-row">
            <td></td>
            <td class="comp">${escapeHtml(text(r.pay_unit_name) || text(r.pay_unit))}</td>
            ${numCells(cur, pre, cur - pre)}
          </tr>`;
      }
    }

    body += `<tr class="net-row"><td colspan="2" class="net-label">Net Salary :</td>${numCells(netCur, netPre, netCur - netPre)}</tr>`;
  }

  const totCur = totEarnCur - totDedCur;
  const totPre = totEarnPre - totDedPre;

  body += `<tr class="tot-row tot-first"><td colspan="2" class="net-label">Total Earnings :</td>${numCells(totEarnCur, totEarnPre, totEarnCur - totEarnPre)}</tr>`;
  body += `<tr class="tot-row"><td colspan="2" class="net-label">Total Deduction :</td>${numCells(totDedCur, totDedPre, totDedCur - totDedPre)}</tr>`;
  body += `<tr class="tot-row tot-last"><td colspan="2" class="net-label">Total :</td>${numCells(totCur, totPre, totCur - totPre)}</tr>`;

  return `
    ${heading}
    ${filtersHtml}
    <table class="var-table">
      <colgroup>
        <col style="width:14%"><col style="width:38%"><col style="width:16%"><col style="width:16%"><col style="width:16%">
      </colgroup>
      <thead>
        <tr>
          <th>EMPLOYEE NAME</th>
          <th>PAY COMPONENT</th>
          <th class="num-head">${escapeHtml(currLabel)}</th>
          <th class="num-head">${escapeHtml(prevLabel)}</th>
          <th class="num-head">VARIANCE</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export const getHrVarianceReportHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadVarianceReportData(req);

    const headerHtml = await reportHeader({ company_code: params.companyCode, req });

    const filtersHtml = reportAppliedFilters([
      { label: "Division", value: [params.divCode] },
      { label: "Department", value: [params.deptCode] },
      { label: "Section", value: [params.sectCode] },
      { label: "Employee", value: [params.employeeCode] },
      { label: "Pay Year", value: [params.payYear] },
      { label: "Current Month", value: [params.currentPayMonth] },
      { label: "Previous Month", value: [params.previousPayMonth] },
      { label: "Report Type", value: [params.reportType] },
    ]);

    const bodyHtml = renderVarianceReportBody(
      rows,
      filtersHtml,
      monthLabel(params.currentPayMonth),
      monthLabel(params.previousPayMonth),
    );
    const footerHtml = reportFooter({
      reportName: "rpt_hr_variance",
      userName: params.loginId,
      endLabel: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: "HR Variance Report",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: VARIANCE_EXTRA_CSS,
      autoPrint: req.query.print !== "false",
      showPrintButton: true,
      orientation: "landscape",
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("HR Variance Report HTML error:", error);
    const oraNum = error?.errorNum;
    const oraCode = oraNum ? `ORA-${String(oraNum).padStart(5, "0")}` : undefined;

    res.status(error.status || 500).json({
      success: false,
      code: oraCode,
      message: error.message || "Unable to generate report",
    });
  }
};