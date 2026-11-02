import { Request, Response } from "express";
import oracledb from "oracledb";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import TenantManager from "../../../database/TenantManager";
import { RequestWithUser } from "../../../interfaces/common.interface";
import {
    buildReportDocument,
    reportAppliedFilters,
    reportFooter,
    reportHeader,
} from "../../common/report_common";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NO_DATA_MESSAGE = "No records found for the selected criteria.";
const ALL = "All";

const text = (v: any): string => (v == null ? "" : String(v));

const formatDateStr = (v: any): string => {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    if (d.getFullYear() <= 1970) return "";
    return d.toLocaleDateString("en-GB");
};
const dateOrAll = (v: any): string => formatDateStr(v) || ALL;

const escapeHtml = (v: unknown): string =>
    text(v)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

const num = (v: any): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const qty = (v: number): string => v.toFixed(2);

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = "LIST" | "CURRENT";

interface LeaveRow {
    employee_code: string;
    rpt_name: string;
    div_code: string;
    div_name: string;
    dept_code: string;
    dept_name: string;
    section_code: string;
    section_name: string;
    leave_type: string;
    leave_type_desc: string;
    pay_year: string;
    allowed: number;
    taken: number;
    available: number;
    requested: number;
    approved: number;
    accrued: number;
}

interface LeaveParams {
    loginid: string;
    companyCode: string;
    division: string;     // comma separated codes or "" (= All)
    department: string;
    section: string;
    employeeCode: string;
    leaveType: string;
    mode: Mode;
    from: string;         // YYYY-MM-DD or ""
    to: string;
}

// ─── Resolve request body ─────────────────────────────────────────────────────
// code1 company, code2 division, code3 department, code4 section, code5 employee code(s),
// code6 leave type(s), code7 mode (LIST | CURRENT), date1/date2 = From / To (YYYY-MM-DD).

const csvOrEmpty = (v: any): string => {
    const s = text(v).trim();
    return !s || s.toLowerCase() === "all" ? "" : s;
};

function resolveParams(body: any): LeaveParams {
    const { loginid, company_code, code1, code2, code3, code4, code5, code6, code7, date1, date2 } = body;
    return {
        loginid:      loginid || "ADMIN",
        companyCode:  text(company_code || code1),
        division:     csvOrEmpty(code2),
        department:   csvOrEmpty(code3),
        section:      csvOrEmpty(code4),
        employeeCode: csvOrEmpty(code5),
        leaveType:    csvOrEmpty(code6),
        mode:         text(code7).toUpperCase() === "CURRENT" ? "CURRENT" : "LIST",
        from:         text(date1).slice(0, 10),
        to:           text(date2).slice(0, 10),
    };
}

const isCurrent = (p: LeaveParams) => p.mode === "CURRENT";
const reportTitle = (p: LeaveParams) => (isCurrent(p) ? "Yearly Leave Balance" : "Yearly Leave Balance List");
const reportCode = (p: LeaveParams) => (isCurrent(p) ? "rpt_emp_yrly_lve_balance" : "rpt_emp_yrly_lve_balance_list");
const periodLine = (p: LeaveParams) =>
    `LEAVE BALANCE FOR THE PERIOD OF ${dateOrAll(p.from)} AND ${dateOrAll(p.to)}`;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Adds "col IN (:p0,:p1,..)" with bind variables; no clause when the list is empty (= All). */
function addInClause(col: string, csv: string, prefix: string, binds: Record<string, any>, where: string[]) {
    const items = csv.split(",").map((s) => s.trim()).filter(Boolean);
    if (!items.length) return;
    const names = items.map((v, i) => {
        binds[`${prefix}${i}`] = v;
        return `:${prefix}${i}`;
    });
    where.push(`${col} IN (${names.join(", ")})`);
}

// ─── Fetch rows (your two SQLs, with bind variables) ──────────────────────────

async function fetchRows(body: any): Promise<{ rows: LeaveRow[]; connection: any }> {
    const p = resolveParams(body);

    let tenantId = getCurrentTenantId();
    if (!tenantId && p.loginid) tenantId = await TenantManager.getTenantForUser(p.loginid);
    if (!tenantId) throw new Error("Tenant not found");

    if ((p.from && !ISO_DATE.test(p.from)) || (p.to && !ISO_DATE.test(p.to))) {
        throw new Error("Invalid date.");
    }

    const connection = await TenantManager.getConnection(tenantId);

    try {
        const binds: Record<string, any> = {};
        const where: string[] = [];
        let sql: string;

        if (!isCurrent(p)) {
            // ── Yearly Leave Balance List  (VW_HR_EMP_YEARLY_LEAVE_BALANCE) ──
            where.push("V.EMP_STATUS IN ('P', 'C')");
            if (p.companyCode && p.companyCode.toLowerCase() !== "all") {
                binds.as_companycode = p.companyCode;
                where.push("V.COMPANY_CODE = :as_companycode");
            }
            addInClause("V.DIV_CODE",      p.division,     "div",  binds, where);
            addInClause("V.DEPT_CODE",     p.department,   "dept", binds, where);
            addInClause("V.SECTION_CODE",  p.section,      "sect", binds, where);
            addInClause("V.EMPLOYEE_CODE", p.employeeCode, "emp",  binds, where);
            addInClause("V.LEAVE_TYPE",    p.leaveType,    "lt",   binds, where);

            sql = `
                SELECT V.EMPLOYEE_CODE,
                       V.RPT_NAME,
                       V.DIV_CODE, V.DIV_NAME,
                       V.DEPT_CODE, V.DEPT_NAME,
                       V.SECTION_CODE, V.SECTION_NAME,
                       V.LEAVE_TYPE,
                       V.LEAVE_TYPE_DESC,
                       V.MAX_NO_OF_LEAVES,
                       V.NO_OF_LEAVES_TAKEN,
                       V.NO_OF_LEAVES_AVAILABLE,
                       V.NO_OF_LEAVES_ACCRUED
                  FROM VW_HR_EMP_YEARLY_LEAVE_BALANCE V
                 WHERE ${where.join("\n                   AND ")}
                 ORDER BY V.DIV_CODE, V.DEPT_CODE, V.SECTION_CODE, V.EMPLOYEE_CODE, V.LEAVE_TYPE_DESC`;
        } else {
            // ── Current Leave Balance  (HR_EMP_YEARLY_LEAVE_BALANCE) ──
            where.push(
                "B.COMPANY_CODE = E.COMPANY_CODE",
                "B.EMPLOYEE_ID  = E.EMPLOYEE_ID",
                "B.COMPANY_CODE = T.COMPANY_CODE",
                "B.LEAVE_TYPE   = T.LEAVE_TYPE",
                "B.STATUS = 'A'"
            );
            if (p.companyCode && p.companyCode.toLowerCase() !== "all") {
                binds.as_companycode = p.companyCode;
                where.push("E.COMPANY_CODE = :as_companycode");
            }
            addInClause("E.DIV_CODE",      p.division,     "div",  binds, where);
            addInClause("E.DEPT_CODE",     p.department,   "dept", binds, where);
            addInClause("E.SECTION_CODE",  p.section,      "sect", binds, where);
            addInClause("E.EMPLOYEE_CODE", p.employeeCode, "emp",  binds, where);
            addInClause("T.LEAVE_TYPE",    p.leaveType,    "lt",   binds, where);

            if (p.from) {
                binds.adt_from = p.from;
                where.push("TRUNC(B.FIN_YEAR_START) = TO_DATE(:adt_from, 'YYYY-MM-DD')");
            }
            if (p.to) {
                binds.adt_to = p.to;
                where.push("TRUNC(B.FIN_YEAR_END) = TO_DATE(:adt_to, 'YYYY-MM-DD')");
            }

            sql = `
                SELECT E.EMPLOYEE_CODE,
                       E.RPT_NAME,
                       E.DIV_CODE, E.DIV_NAME,
                       E.DEPT_CODE, E.DEPT_NAME,
                       E.SECTION_CODE, E.SECTION_NAME,
                       B.LEAVE_TYPE,
                       T.LEAVE_TYPE_DESC,
                       B.PAY_YEAR,
                       B.MAX_NO_OF_LEAVES,
                       B.NO_OF_LEAVES_TAKEN,
                       B.NO_OF_LEAVES_AVAILABLE,
                       B.LEAVES_REQUESTED,
                       B.LEAVES_APPROVED,
                       B.NO_OF_LEAVES_ACCRUED
                  FROM HR_EMP_YEARLY_LEAVE_BALANCE B,
                       VW_HR_EMPLOYEE E,
                       MS_HR_LEAVE_TYPES T
                 WHERE ${where.join("\n                   AND ")}
                 ORDER BY E.DIV_CODE, E.DEPT_CODE, E.SECTION_CODE, E.EMPLOYEE_CODE, B.PAY_YEAR, B.LEAVE_TYPE`;
        }

        const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });

        const rows: LeaveRow[] = (result.rows as any[]).map((row) => {
            const r = Object.keys(row).reduce((acc: any, key) => {
                acc[key.toLowerCase()] = row[key];
                return acc;
            }, {});
            return {
                employee_code:   text(r.employee_code),
                rpt_name:        text(r.rpt_name),
                div_code:        text(r.div_code),
                div_name:        text(r.div_name),
                dept_code:       text(r.dept_code),
                dept_name:       text(r.dept_name),
                section_code:    text(r.section_code),
                section_name:    text(r.section_name),
                leave_type:      text(r.leave_type),
                leave_type_desc: text(r.leave_type_desc),
                pay_year:        text(r.pay_year),
                allowed:         num(r.max_no_of_leaves),
                taken:           num(r.no_of_leaves_taken),
                available:       num(r.no_of_leaves_available),
                requested:       num(r.leaves_requested),
                approved:        num(r.leaves_approved),
                accrued:         num(r.no_of_leaves_accrued),
            };
        });

        return { rows, connection };
    } catch (err) {
        try { await connection.close(); } catch (e) { console.error(e); }
        throw err;
    }
}

// ─── Grouping: Division / Department / Section  →  Employee  →  leave rows ────

interface EmpGroup { code: string; name: string; rows: LeaveRow[] }
interface OrgGroup {
    div_code: string; div_name: string;
    dept_code: string; dept_name: string;
    section_code: string; section_name: string;
    employees: EmpGroup[];
}

function buildGroups(rows: LeaveRow[]): OrgGroup[] {
    const orgs = new Map<string, OrgGroup>();

    rows.forEach((r) => {
        const key = `${r.div_code}|${r.dept_code}|${r.section_code}`;
        let org = orgs.get(key);
        if (!org) {
            org = {
                div_code: r.div_code, div_name: r.div_name,
                dept_code: r.dept_code, dept_name: r.dept_name,
                section_code: r.section_code, section_name: r.section_name,
                employees: [],
            };
            orgs.set(key, org);
        }
        let emp = org.employees.find((e) => e.code === r.employee_code);
        if (!emp) { emp = { code: r.employee_code, name: r.rpt_name, rows: [] }; org.employees.push(emp); }
        emp.rows.push(r);
    });

    return [...orgs.values()];
}

const filterRows = (p: LeaveParams): { label: string; value: string }[] => [
    { label: "Report Type",   value: isCurrent(p) ? "Current Leave Balance" : "Yearly Leave Balance List" },
    { label: "Period",        value: `${dateOrAll(p.from)} – ${dateOrAll(p.to)}` },
    { label: "Division",      value: p.division     || ALL },
    { label: "Department",    value: p.department   || ALL },
    { label: "Section",       value: p.section      || ALL },
    { label: "Employee Code", value: p.employeeCode || ALL },
    { label: "Leave Type",    value: p.leaveType    || ALL },
];

const orgLine = (label: string, code: string, name: string) =>
    `<div class="org-line"><span class="org-lbl">${label}:</span><span class="org-code">${escapeHtml(code)}</span><span class="org-name">${escapeHtml(name)}</span></div>`;

// ─── Excel HTML (.xls) ────────────────────────────────────────────────────────

function buildExcelHtml(rows: LeaveRow[], p: LeaveParams): string {
    const cur = isCurrent(p);
    const ncols = cur ? 9 : 6;
    const reportDate = formatDateStr(new Date());
    const r = "text-align:right";

    let body = "";
    buildGroups(rows).forEach((g) => {
        body += `<tr><td colspan="${ncols}" style="font-weight:bold;background:#eef3fb;color:#00378c">
            Division: ${escapeHtml(g.div_code)} ${escapeHtml(g.div_name)} &nbsp;|&nbsp;
            Department: ${escapeHtml(g.dept_code)} ${escapeHtml(g.dept_name)} &nbsp;|&nbsp;
            Section: ${escapeHtml(g.section_code)} ${escapeHtml(g.section_name)}</td></tr>`;
        g.employees.forEach((e) => {
            body += `<tr><td colspan="${ncols}" style="font-weight:bold;background:#f1f5f9">Employee: ${escapeHtml(e.code)} &nbsp; ${escapeHtml(e.name)}</td></tr>`;
            e.rows.forEach((x) => {
                body += `<tr>
          ${cur ? `<td style="text-align:center">${escapeHtml(x.pay_year)}</td>` : ""}
          <td>${escapeHtml(x.leave_type)}</td>
          <td>${escapeHtml(x.leave_type_desc)}</td>
          <td style="${r}">${qty(x.allowed)}</td>
          <td style="${r}">${qty(x.taken)}</td>
          <td style="${r}">${qty(x.available)}</td>
          ${cur ? `<td style="${r}">${qty(x.requested)}</td><td style="${r}">${qty(x.approved)}</td>` : ""}
          <td style="${r}">${qty(x.accrued)}</td>
        </tr>`;
            });
        });
    });

    return `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
<x:ExcelWorksheet><x:Name>Leave Balance</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
  body  { font-family: Calibri, Arial, sans-serif; font-size: 10pt; color: #1e293b; }
  table { border-collapse: collapse; }
  th    { background: #00378c; color: #ffffff; font-weight: bold; padding: 8px; border: 1px solid #00378c; text-align: center; }
  td    { padding: 6px 8px; border: 1px solid #e2e8f0; vertical-align: middle; }
  .meta-lbl { font-weight: bold; color: #475569; width: 110px; }
</style>
</head>
<body>
<table style="border:none;margin-bottom:6px">
  <tr><td style="border:none;font-size:16pt;font-weight:800;color:#172033" colspan="3">HR DEPARTMENT</td></tr>
  <tr><td style="border:none;font-size:13pt;font-weight:700;color:#00378c" colspan="3">${escapeHtml(reportTitle(p))}</td></tr>
  <tr><td style="border:none;font-weight:bold" colspan="3">${escapeHtml(periodLine(p))}</td></tr>
  ${filterRows(p).map((f) => `<tr><td class="meta-lbl" style="border:none">${escapeHtml(f.label)} :</td><td style="border:none" colspan="2">${escapeHtml(f.value)}</td></tr>`).join("")}
  <tr><td class="meta-lbl" style="border:none">Printed on :</td><td style="border:none" colspan="2">${reportDate}</td></tr>
  <tr><td class="meta-lbl" style="border:none">User :</td><td style="border:none" colspan="2">${escapeHtml(p.loginid)}</td></tr>
  <tr><td class="meta-lbl" style="border:none">Report :</td><td style="border:none" colspan="2">${reportCode(p)}</td></tr>
</table>
<br>
<table>
  <thead>
    <tr>
      ${cur ? "<th>Period</th>" : ""}<th>Leave Code</th><th>Leave Type</th>
      <th>Allowed</th><th>Taken</th><th>Available</th>
      ${cur ? "<th>Requested</th><th>Approved</th>" : ""}<th>Accrued</th>
    </tr>
  </thead>
  <tbody>${body}</tbody>
</table>
</body></html>`;
}

// ─── Layout CSS ───────────────────────────────────────────────────────────────

const LEAVE_EXTRA_CSS = `
  @page { size: A4 portrait; margin: 6mm 12mm 12mm 12mm; }

  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
  html, body { width: 100%; max-width: 100%; overflow-x: hidden; }
  body::before, body::after { display: none !important; content: none !important; }

  .company-header { border-bottom: 2px solid #00378c; padding: 0 0 10px 0; margin: 0 0 8px 0; }
  .company-name       { font-size: 16px; font-weight: 700; color: #172033; margin: 0 0 2px 0; }
  .company-address    { font-size: 9.5px; line-height: 1.4; }
  .company-logo-wrap  { max-width: 180px; }
  .company-logo       { max-height: 56px; max-width: 180px; }

  h1.report-title { margin: 28px 0 10px 0; font-size: 18px; font-weight: 700; color: #00378c !important; }
  .period-line { font-size: 10.5px; font-weight: 700; margin: 0 0 12px 0; }
  .applied-filters { font-size: 10.5px; margin-bottom: 22px; }

  table.data-table { width: 100%; table-layout: fixed; font-size: 10px; margin-top: 0; border-collapse: collapse; }
  table.data-table th, table.data-table td {
    overflow: visible; overflow-wrap: anywhere; word-break: break-word;
    white-space: normal !important; min-width: 0;
  }
  table.data-table .left   { text-align: left   !important; }
  table.data-table .center { text-align: center !important; }
  table.data-table .right  { text-align: right  !important; font-variant-numeric: tabular-nums; }

  table.data-table thead tr th {
    background: #00378c !important; color: #ffffff !important; font-weight: 700;
    font-size: 10px; padding: 9px 4px; border: 1px solid #ffffff55 !important;
    text-transform: none;  white-space: nowrap !important; text-align: center;
  }

  table.data-table tbody tr.org-row td {
    background: #eef3fb !important; padding: 8px 6px; border-bottom: 1px solid #cbd5e1 !important; text-align: left;
  }
  .org-line { display: flex; gap: 10px; font-size: 10.5px; font-weight: 700; color: #00378c; line-height: 1.55; }
  .org-lbl  { width: 78px; }
  .org-code { width: 48px; }
  .org-name { flex: 1; }

  table.data-table tbody tr.emp-row td {
    background: #f1f5f9 !important; color: #1e293b !important; font-weight: 700;
    font-size: 10.5px; padding: 6px; border-bottom: 1px solid #cbd5e1 !important; text-align: left;
  }
  table.data-table tbody tr.emp-row td .emp-code { color: #00378c; margin-right: 14px; }
  table.data-table tbody tr.data-row td {
    background: #fafcfe !important; font-size: 10px; padding: 5px 4px;
    border-bottom: 1px solid #e2e8f0 !important; color: #1e293b; vertical-align: middle;
  }
  table.data-table tbody tr.data-row td.nw { white-space: nowrap !important; }
  table.data-table tbody tr.end-row td {
    background: #dbe4f0 !important; color: #00378c !important; font-weight: 700;
    padding: 9px 6px; text-align: right; border-bottom: 1px solid #cbd5e1 !important;
  }
  table.data-table tbody tr.empty-row td { padding: 20px; text-align: center; color: #64748b; background: #fafcfe !important; }

  .report-footer {
    width: 100% !important; max-width: 100% !important; padding-right: 2px; font-size: 9px;
    overflow: visible !important; overflow-wrap: anywhere; word-break: break-word;
  }
  .report-footer * { max-width: 100%; }

  @media print {
    table.data-table thead { display: table-header-group; }
    table.data-table tr { break-inside: avoid; page-break-inside: avoid; }
  }
`;

// ─── Body ─────────────────────────────────────────────────────────────────────

// % widths – each set adds up to 100
const LIST_WIDTHS = [10, 38, 13, 13, 13, 13];
const CUR_WIDTHS  = [8, 9, 24, 11, 9, 11, 10, 9, 9];

function renderBody(rows: LeaveRow[], p: LeaveParams): string {
    const cur = isCurrent(p);
    const ncols = cur ? 9 : 6;
    const n = (v: number) => `<td class="right nw">${qty(v)}</td>`;

    let tableRows = "";
    if (!rows.length) {
        tableRows = `<tr class="empty-row"><td colspan="${ncols}">${escapeHtml(NO_DATA_MESSAGE)}</td></tr>`;
    } else {
        buildGroups(rows).forEach((g) => {
            tableRows += `<tr class="org-row"><td colspan="${ncols}">
              ${orgLine("Division", g.div_code, g.div_name)}
              ${orgLine("Department", g.dept_code, g.dept_name)}
              ${orgLine("Section", g.section_code, g.section_name)}
            </td></tr>`;

            g.employees.forEach((e) => {
                tableRows += `<tr class="emp-row"><td colspan="${ncols}"><span class="emp-code">Employee: &nbsp; ${escapeHtml(e.code)}</span>${escapeHtml(e.name)}</td></tr>`;
                e.rows.forEach((x) => {
                    tableRows += `
        <tr class="data-row">
          ${cur ? `<td class="center nw">${escapeHtml(x.pay_year)}</td>` : ""}
          <td class="center nw">${escapeHtml(x.leave_type)}</td>
          <td class="left">${escapeHtml(x.leave_type_desc)}</td>
          ${n(x.allowed)}${n(x.taken)}${n(x.available)}
          ${cur ? n(x.requested) + n(x.approved) : ""}
          ${n(x.accrued)}
        </tr>`;
                });
            });
        });
        tableRows += `<tr class="end-row"><td colspan="${ncols}">End of Report</td></tr>`;
    }

    const colgroup = (cur ? CUR_WIDTHS : LIST_WIDTHS).map((w) => `<col style="width:${w}%"/>`).join("");

    return `
    <h1 class="report-title">${escapeHtml(reportTitle(p))}</h1>
    <div class="period-line">${escapeHtml(periodLine(p))}</div>
    ${reportAppliedFilters(filterRows(p))}

    <table class="data-table">
      <colgroup>${colgroup}</colgroup>
      <thead>
        <tr>
          ${cur ? "<th>Period</th>" : ""}
          <th>Leave Code</th>
          <th>Leave Type</th>
          <th>Allowed</th>
          <th>Taken</th>
          <th>Available</th>
          ${cur ? "<th>Requested</th><th>Approved</th>" : ""}
          <th>Accrued</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  `;
}

// ─── HTML Controller ──────────────────────────────────────────────────────────

export const getYearlyLeaveBalanceReport = async (req: RequestWithUser, res: Response): Promise<void> => {
    let connection: any;
    try {
        const { rows, connection: conn } = await fetchRows(req.body);
        connection = conn;

        const params      = resolveParams(req.body);
        const companyCode = params.companyCode || req.user?.company_code || "";

        const printed    = new Date().toLocaleString("en-US");
        const headerHtml = await reportHeader({ company_code: companyCode, req });
        const bodyHtml   = renderBody(rows, params);
        const footerHtml = reportFooter({
            reportName: reportCode(params),
            userName:   params.loginid,
            endLabel:   "Powered by Bayanat Technology",
            extraLeft:  `Print: ${escapeHtml(printed)} | User: ${escapeHtml(params.loginid)}`,
        });

        const html = buildReportDocument({
            title: reportTitle(params),
            headerHtml,
            bodyHtml,
            footerHtml,
            extraCss: LEAVE_EXTRA_CSS,
            autoPrint: req.query.print !== "false",
            showPrintButton: true,
            fontMode: "native",
        });

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.status(200).send(html);
    } catch (error: any) {
        console.error("Yearly Leave Balance Report Error:", error);
        res.status(500).json({ success: false, message: "Unable to generate report", details: error.message });
    } finally {
        if (connection) try { await connection.close(); } catch (e) { console.error(e); }
    }
};

// ─── Excel Controller ─────────────────────────────────────────────────────────

export const exportYearlyLeaveBalanceReportExcel = async (req: Request, res: Response): Promise<void> => {
    let connection: any;
    try {
        const { rows, connection: conn } = await fetchRows(req.body);
        connection = conn;

        if (!rows.length) {
            res.status(200).json({ success: false, message: "No data found for the selected criteria." });
            return;
        }

        const params = resolveParams(req.body);
        const excelHtml = buildExcelHtml(rows, params);

        res.setHeader("Content-Type", "application/vnd.ms-excel");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${isCurrent(params) ? "CurrentLeaveBalance" : "YearlyLeaveBalanceList"}_${new Date().toISOString().slice(0, 10)}.xls"`
        );
        res.status(200).send(excelHtml);
    } catch (error: any) {
        console.error("Yearly Leave Balance Report Excel Error:", error);
        res.status(500).json({ success: false, message: "Unable to export report", details: error.message });
    } finally {
        if (connection) try { await connection.close(); } catch (e) { console.error(e); }
    }
};