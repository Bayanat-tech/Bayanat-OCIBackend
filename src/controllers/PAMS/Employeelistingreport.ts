
import { Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../interfaces/common.interface";
import { buildReportDocument, reportFooter, reportHeader } from "../ALMS/report_common_pr";

type ReportRow = Record<string, any>;

interface ReqParams {
  loginid: string;
  company_code: string;
  period: string;       
  division: string;     
  department: string;  
  designation: string;  
  employee: string;     
  period_label: string;
  division_label: string;
  department_label: string;
  designation_label: string;
  employee_label: string;
}

const DISPATCH_PARAM = "emp_listing_data";   // WHEN block in PROC_BUILD_DYNAMIC_SQL_PAMS
const REPORT_TITLE = "EMPLOYEE APPRAISAL LISTING REPORT";
const REPORT_NAME = "rep_employee_appraisal_listing";

// ─── helpers ────────────────────────────────────────────────────────────────
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
    Object.keys(row).reduce((acc: ReportRow, key) => { acc[key.toLowerCase()] = row[key]; return acc; }, {})
  );
}
const text = (v: unknown): string => (v == null ? "" : String(v));
const escapeHtml = (v: unknown): string =>
  text(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

function extractParams(req: RequestWithUser): ReqParams {
  const b = req.body || {};
  const all = (v: unknown) => text(v) || "ALL";
  return {
    loginid: text(req.user?.loginid) || text(b.loginid) || "ADMIN",
    company_code: text(b.company_code),
    period: all(b.period),
    division: all(b.division),
    department: all(b.department),
    designation: all(b.designation),
    employee: all(b.employee),
    period_label: text(b.period_label),
    division_label: text(b.division_label),
    department_label: text(b.department_label),
    designation_label: text(b.designation_label),
    employee_label: text(b.employee_label),
  };
}

// ─── data ───────────────────────────────────────────────────────────────────
async function loadData(req: RequestWithUser, p: ReqParams): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const binds: any = {
      parameter: DISPATCH_PARAM,
      loginid: p.loginid,
      code1: p.company_code || null,
      code2: p.division,
      code3: p.department,
      code4: p.period,
      code5: `${p.designation}$${p.employee}`,
      code6: null,
      number1: null, number2: null, number3: null, number4: null,
      date1: null, date2: null, date3: null, date4: null,
      out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    // PROC_BUILD_DYNAMIC_SQL_PAMS(P_PARAMETER, P_LOGINID, P_CODE1..6, P_NUMBER1..4, P_DATE1..4, P_RETURN_STRING OUT)
    const result = await conn.execute(
      `BEGIN
         PROC_BUILD_DYNAMIC_SQL_PAMS(
           :parameter, :loginid,
           :code1, :code2, :code3, :code4, :code5, :code6,
           :number1, :number2, :number3, :number4,
           :date1, :date2, :date3, :date4,
           :out_sql
         );
       END;`,
      binds
    );
    const rawSql = (result.outBinds as any).out_sql;
    if (!rawSql) throw new Error("Procedure did not return a valid SQL query.");

    const dataResult = await conn.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return normalize(dataResult.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── HTML body (compact: ~100 employees per A4 portrait page) ──────────────
const EL_EXTRA_CSS = `
  @page { size: A4 portrait; margin: 8mm; }
  .pr-register { width: 100%; font-size: 7.5px; line-height: 1.05; color: #1e293b; }
  .pr-register table.data-table { width: 100% !important; table-layout: fixed; }
  .pr-register table.data-table td, .pr-register table.data-table th { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

const S0 = {
  total: "background:#f4f7fb !important;color:#0b3d91 !important;font-weight:700;padding:2px 4px;border-top:1px solid #c5d5ea;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
  grand: "background:#cfe0f5 !important;color:#0b3d91 !important;font-weight:700;padding:3px 4px;border-top:2px solid #0b4ca1;font-size:8.5px;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
  th: "background:#e8f0fa !important;color:#0b4ca1 !important;font-weight:700;font-size:7.5px;padding:2px 4px;text-align:left;border-bottom:2px solid #0b4ca1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;height:auto;line-height:1.05;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
  thC: "background:#e8f0fa !important;color:#0b4ca1 !important;font-weight:700;font-size:7.5px;padding:2px 4px;text-align:center;border-bottom:2px solid #0b4ca1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;height:auto;line-height:1.05;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
  td: "padding:1px 4px;border-bottom:1px solid #e2e8f0;vertical-align:middle;line-height:1.05;font-size:7.5px;height:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:0;",
  tdC: "padding:1px 4px;border-bottom:1px solid #e2e8f0;vertical-align:middle;text-align:center;line-height:1.05;font-size:7.5px;height:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:0;",
};

// Inline !important so the shared report CSS (report_common_pr) cannot override widths / wrapping / row height
const imp = (css: string) => css.replace(/\s*(?:!important)?\s*;/g, " !important;");
const S = Object.fromEntries(Object.entries(S0).map(([k, v]) => [k, imp(v)])) as typeof S0;

function renderBody(rows: ReportRow[], p: ReqParams): string {
  // Division column only when no single division is selected
  const showDiv = p.division === "ALL";

  // [SL, Period, Employee, (Division), Department, Designation, Rating]
  const widths = showDiv ? [5, 9, 24, 16, 14, 25, 7] : [5, 9, 30, 0, 20, 29, 7];
  const wl = widths.filter((w) => w > 0);
  const cols = wl.map((w) => `<col style="width:${w}%"/>`).join("");
  const W = (i: number) => `width:${wl[i]}% !important;`;
  const colCount = widths.filter((w) => w > 0).length;

  const lines = rows.map((r, i) => {
    const rating = r.final_rating === null || r.final_rating === undefined || r.final_rating === "" ? "-" : text(r.final_rating);
    const emp = `${text(r.employee_code)} - ${text(r.employee_name)}`;
    const dept = text(r.dept_name || r.dept_code);
    const desg = text(r.desg_name || r.desg_code);
    const div = text(r.div_name || r.div_code);
    return `
      <tr>
        <td class="center" style="${S.tdC}">${i + 1}</td>
        <td class="center" style="${S.tdC}">${escapeHtml(r.period_number) || "-"}</td>
        <td style="${S.td}" title="${escapeHtml(emp)}">${escapeHtml(emp)}</td>
        ${showDiv ? `<td style="${S.td}" title="${escapeHtml(div)}">${escapeHtml(div)}</td>` : ""}
        <td style="${S.td}" title="${escapeHtml(dept)}">${escapeHtml(dept)}</td>
        <td style="${S.td}" title="${escapeHtml(desg)}">${escapeHtml(desg)}</td>
        <td class="center" style="${S.tdC}"><b>${escapeHtml(rating)}</b></td>
      </tr>`;
  }).join("");

  return `
  <div class="pr-register">
    <table class="pr-title-line pr-title-tight"><tbody><tr><td><h1 class="report-title">${escapeHtml(REPORT_TITLE)}</h1></td></tr></tbody></table>${rows.length === 0
      ? `<div class="empty">No records found for the selected criteria.</div>`
      : `
    <table class="data-table el-listing${showDiv ? " el-listing-div" : ""}" style="margin-top:4px;border-collapse:collapse !important;width:100% !important;table-layout:fixed !important;">
      <colgroup>${cols}</colgroup>
      <thead>
        <tr>
          <th class="center" style="${S.thC}${W(0)}">SL</th>
          <th class="center" style="${S.thC}${W(1)}">Period</th>
          <th style="${S.th}${W(2)}">Employee</th>
          ${showDiv ? `<th style="${S.th}${W(3)}">Division</th>` : ""}
          <th style="${S.th}${W(showDiv ? 4 : 3)}">Department</th>
          <th style="${S.th}${W(showDiv ? 6 : 5)}">Designation</th>
          <th class="center" style="${S.thC}${W(showDiv ? 6 : 5)}">Rating</th>
        </tr>
      </thead>
      <tbody>${lines}
        <tr class="grand-total-row">
          <td colspan="${colCount - 1}" style="${S.grand}">Total Employees</td>
          <td style="${S.grand} text-align:center;">${rows.length}</td>
        </tr>
      </tbody>
    </table>`}
  </div>`;
}

// ─── route handler ──────────────────────────────────────────────────────────
export const getEmployeeListingReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadData(req, params);

    const companyCode =
      params.company_code || text(req.user?.company_code) || text(req.query.company_code) || "BSG";

    // Logo + company name/address come from here (same as the PR Register report)
    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: REPORT_NAME,
      userName: params.loginid,
      endLabel: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: REPORT_TITLE,
      headerHtml,
      bodyHtml: renderBody(rows, params),
      footerHtml,
      extraCss: EL_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Employee Listing HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};