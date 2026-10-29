// src/controllers/wms/reports/EmployeeDetails.controller.ts

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

// ─────────────────────────────────────────────────────────────
// DB Helpers
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────
function text(value: unknown): string { return value == null ? "" : String(value); }
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

// ─────────────────────────────────────────────────────────────
// Status mapping (accepts both codes and names)
// ─────────────────────────────────────────────────────────────
const STATUS_CODE: Record<string, string> = {
  c: "C", confirmed: "C",
  p: "P", probation: "P",
  s: "S", separated: "S",
};
const STATUS_LABEL: Record<string, string> = { C: "Confirmed", P: "Probation", S: "Separated" };
const toStatusCode = (v: string): string => STATUS_CODE[text(v).trim().toLowerCase()] ?? "All";

// ─────────────────────────────────────────────────────────────
// Param Parser
// ─────────────────────────────────────────────────────────────
function allIfBlank(value: unknown): string { const v = text(value).trim(); return v || "All"; }

// Timezone-safe: "2026-01-01" -> local date (not UTC midnight)
function parseDate(str: any): Date | null {
  const s = text(str).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
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
    gradeCode: allIfBlank(src.grade_code),
    desgCode: allIfBlank(src.desg_code),
    employeeCode: allIfBlank(src.employee_id ?? src.employee_code),
    joinFrom: parseDate(src.join_from),
    joinTo: parseDate(src.join_to),
    empStatus: allIfBlank(src.emp_status),
    empAmendment: text(src.emp_amendment).trim().toUpperCase() === "Y" ? "Y" : "N",
    loginId: text(req.user?.loginid || (req.user as any)?.username || ""),
  };
}

// ─────────────────────────────────────────────────────────────
// Duplicate guards
// ─────────────────────────────────────────────────────────────
// 1) remove fully identical rows
function dedupeRows(rows: ReportRow[]): ReportRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = JSON.stringify(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// 2) keep one row per employee (used when "Employee Amendment" is NOT ticked)
function dedupeByEmployee(rows: ReportRow[]): ReportRow[] {
  if (!rows.length) return rows;
  const keyCol = ["employee_id", "employee_code", "emp_code", "emp_id"].find((k) => k in rows[0]);
  if (!keyCol) return rows;
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = text(r[keyCol]);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ─────────────────────────────────────────────────────────────
// Data Loader
// ─────────────────────────────────────────────────────────────
async function loadData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);
  if (!params.companyCode) throw Object.assign(new Error("company_code is required"), { status: 400 });

  const conn = await getConn(req);
  try {
    const binds: Record<string, any> = {
      p_parameter: "Hr_Report_EMPLOYEE_DETAILS",
      p_loginid: params.loginId,
      p_code1: params.companyCode,
      p_code2: params.divCode,
      p_code3: params.deptCode,
      p_code4: params.sectCode,
      p_code5: params.gradeCode,
      p_code6: params.desgCode,
      p_code7: params.employeeCode,
      p_code8: toStatusCode(params.empStatus),
      p_code9: params.empAmendment,
      p_number1: null, p_number2: null, p_number3: null, p_number4: null,
      p_date1: { val: params.joinFrom, type: oracledb.DATE },
      p_date2: { val: params.joinTo, type: oracledb.DATE },
      p_date3: { val: null, type: oracledb.DATE },
      p_date4: { val: null, type: oracledb.DATE },
      p_return_string: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    for (let i = 10; i <= 20; i++) binds[`p_code${i}`] = null;
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
    if (!builtSql || builtSql.toUpperCase() === "INVALID PARAMETER VALUE") {
      throw Object.assign(new Error("Report procedure returned no query"), { status: 500 });
    }

    // Uncomment to debug duplicates / status filter:
    // console.log("Employee Details SQL:", builtSql);

    const result = await conn.execute(builtSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });

    let rows = dedupeRows(normalize(result.rows as any[]));
    if (params.empAmendment !== "Y") rows = dedupeByEmployee(rows);
    return rows;
  } finally {
    await closeConn(conn);
  }
}

// ─────────────────────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────────────────────
const EXTRA_CSS = `
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
  body, table.emp-table { font-family: Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif; }
  .doc-title-row { display: flex; justify-content: space-between; align-items: flex-start; margin: 4px 0 10px 0; }
  body .doc-title-row h1 { margin: 0; font-size: 16px; font-weight: 800; color: #00378c !important; letter-spacing: 0; }
  table.emp-table { width: 100%; max-width: 100%; border-collapse: collapse; table-layout: auto; font-size: 10px; margin-top: 6px; border: 0; }
  table.emp-table thead th { background: #00378c !important; color: #ffffff !important; font-weight: 700; font-size: 10px; padding: 8px 6px; text-align: left; border: 0 !important; box-shadow: inset 0 0 0 1000px #00378c; }
  table.emp-table tbody td { padding: 5px 6px; border: 0; border-bottom: 1px solid #e2e8f0 !important; color: #1e293b; font-size: 10px; font-weight: 400; background: #fcfdfe; }
  table.emp-table td, table.emp-table th { vertical-align: top; word-break: break-word; }
  table.emp-table thead th.center, table.emp-table tbody td.center { text-align: center; }
  table.emp-table thead th.num, table.emp-table tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.emp-table .nowrap { white-space: nowrap; }
  table.emp-table tbody tr:nth-child(even) td { background: #f6f9fd; }
  .emp-empty { border: 1px dashed #cbd5e1; background: #f8fafc; text-align: center; padding: 40px 12px; margin-top: 14px; color: #64748b; font-weight: 700; }
  @media print { table.emp-table thead { display: table-header-group; } table.emp-table tr { page-break-inside: avoid; } }
`;
const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">`;

// ─────────────────────────────────────────────────────────────
// Body Renderer
// ─────────────────────────────────────────────────────────────
function colKind(key: string, rows: ReportRow[]): "num" | "date" | "center" | "text" {
  const sample = rows.map((r) => r[key]).find((v) => v != null && v !== "");
  if (sample instanceof Date || (typeof sample === "string" && /^\d{4}-\d{2}-\d{2}/.test(sample))) return "date";
  if (/(_code|_id|_no|_status)$/.test(key)) return "center";
  if (typeof sample === "number") return "num";
  return "text";
}

function renderBody(rows: ReportRow[], filtersHtml = ""): string {
  const heading = `${FONT_LINK}<div class="doc-title-row"><div><h1>Employee Details Report</h1></div></div>`;

  if (!rows.length) {
    return `${heading}${filtersHtml}<div class="emp-empty">No data found</div>`;
  }

  const keys = Object.keys(rows[0]);
  const kinds = keys.map((k) => colKind(k, rows));
  const cls = (kind: string) =>
    kind === "num" ? "num" : kind === "date" || kind === "center" ? "center nowrap" : "";

  const headCells =
    `<th class="center">SNo.</th>` +
    keys.map((k, i) => `<th class="${cls(kinds[i])}">${escapeHtml(k.replace(/_/g, " ").toUpperCase())}</th>`).join("");

  const bodyRows = rows
    .map((r, idx) => {
      const cells = keys
        .map((k, i) => {
          const v = r[k];
          const display = kinds[i] === "date" ? fmtDate(v) : text(v);
          return `<td class="${cls(kinds[i])}">${escapeHtml(display)}</td>`;
        })
        .join("");
      return `<tr><td class="center">${idx + 1}</td>${cells}</tr>`;
    })
    .join("");

  return `${heading}${filtersHtml}<table class="emp-table"><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

// ─────────────────────────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────────────────────────
export const getHrEmployeeDetailsHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadData(req);
    const headerHtml = await reportHeader({ company_code: params.companyCode, req });

    const filtersHtml = reportAppliedFilters([
      { label: "Division", value: [params.divCode] },
      { label: "Department", value: [params.deptCode] },
      { label: "Section", value: [params.sectCode] },
      { label: "Grade", value: [params.gradeCode] },
      { label: "Designation", value: [params.desgCode] },
      { label: "Employee", value: [params.employeeCode] },
      { label: "Status", value: [STATUS_LABEL[toStatusCode(params.empStatus)] ?? "All"] },
      { label: "Amendment", value: [params.empAmendment === "Y" ? "Yes" : "No"] },
    ]);

    const bodyHtml = renderBody(rows, filtersHtml);
    const footerHtml = reportFooter({
      reportName: "rpt_hr_employee_details",
      userName: params.loginId,
      endLabel: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: "Employee Details",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: EXTRA_CSS,
      autoPrint: req.query.print !== "false",
      showPrintButton: true,
      orientation: "landscape",
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Emp Details HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};