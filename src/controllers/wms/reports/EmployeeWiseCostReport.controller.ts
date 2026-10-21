// src/controllers/wms/reports/EmployeeWiseCostReport.controller.ts

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

// DB Helpers
async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid) tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenantId) throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
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
    }, {}),
  );
}

// Formatters
function text(value: unknown): string { return value == null ? "" : String(value); }
function escapeHtml(value: unknown): string { return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
function fmtAmount(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${abs})` : abs;
}

// Param Parser
function allIfBlank(value: unknown): string { const v = text(value).trim(); return v || "All"; }

function parseParams(req: RequestWithUser) {
  const src = { ...(req.query as Record<string, any>), ...(req.body || {}) };
  const userCompany = text(req.user?.company_code).trim();
  const companyCode = userCompany || text(src.company_code).trim() || "";

  return {
    companyCode,
    divCode: allIfBlank(src.div_code),
    deptCode: allIfBlank(src.dept_code),
    sectCode: allIfBlank(src.section_code ?? src.sect_code),
    employeeCode: allIfBlank(src.employee_id ?? src.employee_code),
    payMonth: text(src.pay_month).trim(),
    payYear: text(src.pay_year).trim(),
    source: allIfBlank(src.source),
    reportType: allIfBlank(src.report_type),
    loginId: text(req.user?.loginid || (req.user as any)?.username || ""),
  };
}

// Data Loader
async function loadData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);
  if (!params.companyCode) throw Object.assign(new Error("company_code is required"), { status: 400 });

  const conn = await getConn(req);
  try {
    const binds: Record<string, any> = {
      p_parameter: "Hr_Report_EMPLOYEE_WISE_COST",
      p_loginid: params.loginId,
      p_code1: params.companyCode,
      p_code2: params.divCode,
      p_code3: params.deptCode,
      p_code4: params.sectCode,
      p_code5: params.employeeCode,
      p_code6: params.source,
      p_code7: "N",
      p_code8: params.reportType,
      p_number1: params.payMonth ? Number(params.payMonth) : null,
      p_number2: params.payYear ? Number(params.payYear) : null,
      p_number3: null, p_number4: null,
      p_date1: { val: null, type: oracledb.DATE },
      p_date2: { val: null, type: oracledb.DATE },
      p_date3: { val: null, type: oracledb.DATE },
      p_date4: { val: null, type: oracledb.DATE },
      p_return_string: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    for (let i = 9; i <= 20; i++) binds[`p_code${i}`] = null;
    const codeArgs = Array.from({ length: 20 }, (_, i) => `:p_code${i + 1}`).join(", ");

    const procResult = await conn.execute(
      `BEGIN PROC_BUILD_DYNAMIC_SQL_HR_REPORT(
         :p_parameter, :p_loginid, ${codeArgs},
         :p_number1, :p_number2, :p_number3, :p_number4,
         :p_date1, :p_date2, :p_date3, :p_date4, :p_return_string
       ); END;`,
      binds,
    );

    const builtSql = text((procResult.outBinds as any)?.p_return_string).trim();
    if (!builtSql || builtSql.toUpperCase() === "INVALID PARAMETER VALUE") throw Object.assign(new Error("Report procedure returned no query"), { status: 500 });

    const result = await conn.execute(builtSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// CSS
const EXTRA_CSS = `
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
  body, table.cost-table { font-family: Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif; }
  .doc-title-row { display: flex; justify-content: space-between; align-items: flex-start; margin: 4px 0 10px 0; }
  body .doc-title-row h1 { margin: 0; font-size: 16px; font-weight: 800; color: #000 !important; letter-spacing: 0; }
  table.cost-table { width: 100%; max-width: 100%; border-collapse: collapse; table-layout: auto; font-size: 10px; margin-top: 6px; border: 0; }
  
  table.cost-table thead th { background: #00378c !important; color: #ffffff !important; font-weight: 700; font-size: 10px; padding: 8px 6px; text-align: left; border: 0 !important; box-shadow: inset 0 0 0 1000px #00378c; border-right: 1px solid #1e40af !important; }
  table.cost-table thead th.num-head { text-align: right; }
  
  table.cost-table tbody td { padding: 5px 6px; border: 0; border-bottom: 1px solid #e2e8f0 !important; color: #1e293b; font-size: 10px; font-weight: 400; background: #fcfdfe; }
  table.cost-table tbody tr.group-header-row td { background: #f1f5f9 !important; font-weight: bold; color: #00378c; padding: 8px; text-transform: uppercase; border-bottom: 2px solid #cbd5e1 !important; }
  
  .center { text-align: center; } .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .cost-empty { border: 1px dashed #cbd5e1; background: #f8fafc; text-align: center; padding: 40px 12px; margin-top: 14px; color: #64748b; font-weight: 700; }
  
  @media print { table.cost-table thead { display: table-header-group; } table.cost-table tr { page-break-inside: avoid; } }
`;
const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">`;

// Body Renderer (Matches the screenshot exactly)
function renderBody(rows: ReportRow[], filtersHtml = "", params: any): string {
  const heading = `
    ${FONT_LINK}
    <div class="doc-title-row" style="border-bottom: 2px solid #00378c; padding-bottom: 5px; margin-bottom: 10px;">
      <div>
        <h1 style="margin: 0; font-size: 18px; color: #000 !important;">Employee -wise Cost Report - ${params.payMonth || ""} - ${params.payYear || ""}</h1>
        <div style="font-size: 11px; color: #555; margin-top: 4px;">
          <strong>Date:</strong> ${new Date().toLocaleString()} <br/>
          <strong>User:</strong> ${params.loginId} <br/>
          <strong>Source:</strong> ${params.source}
        </div>
      </div>
      <div style="text-align: right; font-size: 11px; color: #555;">
        Page 1 of 1
      </div>
    </div>`;

  if (!rows.length) {
    return `${heading}${filtersHtml}<div class="cost-empty">No data found</div>`;
  }

  const headRow1 = `
    <tr>
      <th rowspan="2" class="num-head" style="width: 40px;">Sl No.</th>
      <th rowspan="2" style="width: 90px;">Employee Code</th>
      <th rowspan="2" style="width: 250px;">Employee Name</th>
      <th rowspan="2" class="num-head">Gross Pay</th>
      <th colspan="2" class="num-head center">Gratuity</th>
      <th colspan="2" class="num-head center">PASI</th>
      <th colspan="2" class="num-head center">Annual Leave</th>
      <th colspan="2" class="num-head center">Airfare</th>
      <th rowspan="2" class="num-head">Total Cost</th>
    </tr>
  `;
  
  const headRow2 = `
    <tr>
      <th class="num-head">Unit</th><th class="num-head">Amnt</th>
      <th class="num-head">Unit</th><th class="num-head">Amnt</th>
      <th class="num-head">Unit</th><th class="num-head">Amnt</th>
      <th class="num-head">Unit</th><th class="num-head">Amnt</th>
    </tr>
  `;

  let bodyRows = "";
  let currentGroup = "";
  let slNo = 1;

  rows.forEach((r) => {
    const groupKey = `${r.div_name || ""} - ${r.dept_name || ""} - ${r.desg_name || ""}`;
    
    if (groupKey !== currentGroup) {
      currentGroup = groupKey;
      slNo = 1;
      bodyRows += `
        <tr class="group-header-row">
          <td colspan="13" style="background: #f1f5f9; font-weight: bold; color: #00378c; padding: 8px; text-transform: uppercase;">
            ${escapeHtml(groupKey)}
          </td>
        </tr>
      `;
    }

    bodyRows += `
      <tr>
        <td class="num">${slNo++}</td>
        <td>${escapeHtml(r.employee_code)}</td>
        <td>${escapeHtml(r.employee_name)}</td>
        <td class="num">${fmtAmount(Number(r.gross_pay) || 0)}</td>
        
        <td class="num">${r.gratuity_unit || "0.00"}</td>
        <td class="num">${fmtAmount(Number(r.gratuity_amt) || 0)}</td>
        
        <td class="num">${r.pasi_unit || "0.00"}</td>
        <td class="num">${fmtAmount(Number(r.pasi_amt) || 0)}</td>
        
        <td class="num">${r.al_unit || "0.00"}</td>
        <td class="num">${fmtAmount(Number(r.al_amt) || 0)}</td>
        
        <td class="num">${r.airfare_unit || "0.00"}</td>
        <td class="num">${fmtAmount(Number(r.airfare_amt) || 0)}</td>
        
        <td class="num" style="font-weight: bold;">${fmtAmount(Number(r.total_cost) || 0)}</td>
      </tr>
    `;
  });

  return `
    ${heading}
    ${filtersHtml}
    <table class="cost-table">
      <thead>${headRow1}${headRow2}</thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

// Route Handler
export const getHrEmployeeWiseCostHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadData(req);
    const headerHtml = await reportHeader({ company_code: params.companyCode, req });
    
    const filtersHtml = reportAppliedFilters([
      { label: "Division", value: [params.divCode] },
      { label: "Department", value: [params.deptCode] },
      { label: "Section", value: [params.sectCode] },
      { label: "Employee", value: [params.employeeCode] },
    ]);

    const bodyHtml = renderBody(rows, filtersHtml, params);
    const footerHtml = reportFooter({ reportName: "rpt_emp_acrual_cost_new", userName: params.loginId, endLabel: "Powered by Bayanat Technology" });

    const html = buildReportDocument({ title: "Employee Wise Cost", headerHtml, bodyHtml, footerHtml, extraCss: EXTRA_CSS, autoPrint: req.query.print !== "false", showPrintButton: true, orientation: "landscape" });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Emp Cost HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};