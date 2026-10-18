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
const REPORT_TITLE = "Employee Payroll Process Fail List";
const REPORT_CODE = "rpt_emp_sal_process_fail";
const ALL_MONTHS = 0;
const ALL_YEARS = 0;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const text = (v: any): string => (v == null ? "" : String(v));

const formatDateStr = (v: any): string => {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    if (d.getFullYear() <= 1970) return "";
    return d.toLocaleDateString("en-GB");
};

const escapeHtml = (v: unknown): string =>
    text(v)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

// ─── Types ────────────────────────────────────────────────────────────────────

interface FailRow {
    employee_code: string;
    rpt_name: string;
    grade_name: string;
    desg_name: string;
    join_date: any;
    remarks: string;
    div_code: string;
    div_name: string;
    dept_code: string;
    dept_name: string;
    section_code: string;
    section_name: string;
    pay_month: number;
    pay_year: number;
}

interface FailParams {
    loginid: string;
    companyCode: string;
    division: string;    // comma separated codes or "" (= All)
    department: string;
    section: string;
    payMonth: number;    // 0 = All
    payYear: number;     // 0 = All
}

// ─── Resolve request body ─────────────────────────────────────────────────────
// code1 company, code2 division, code3 department, code4 section,
// number1 pay month (0 = All), number2 pay year (0 = All).

const csvOrEmpty = (v: any): string => {
    const s = text(v).trim();
    return !s || s.toLowerCase() === "all" ? "" : s;
};

function resolveParams(body: any): FailParams {
    const { loginid, company_code, code1, code2, code3, code4, number1, number2 } = body;
    const m = Number(number1);
    const y = Number(number2);
    return {
        loginid:     loginid || "ADMIN",
        companyCode: text(company_code || code1),
        division:    csvOrEmpty(code2),
        department:  csvOrEmpty(code3),
        section:     csvOrEmpty(code4),
        payMonth:    Number.isFinite(m) && m > 0 ? m : ALL_MONTHS,
        payYear:     Number.isFinite(y) && y > 0 ? y : ALL_YEARS,
    };
}

const periodOf = (month: number, year: number) => `${MONTHS[month - 1] ?? ""} / ${year}`;
const filterPeriod = (p: FailParams) =>
    `${p.payMonth === ALL_MONTHS ? ALL : MONTHS[p.payMonth - 1]} ${p.payYear === ALL_YEARS ? ALL : p.payYear}`;

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

// ─── Fetch rows (your SQL, with bind variables) ───────────────────────────────

async function fetchRows(body: any): Promise<{ rows: FailRow[]; connection: any }> {
    const p = resolveParams(body);

    let tenantId = getCurrentTenantId();
    if (!tenantId && p.loginid) tenantId = await TenantManager.getTenantForUser(p.loginid);
    if (!tenantId) throw new Error("Tenant not found");

    if (p.payMonth !== ALL_MONTHS && (!Number.isInteger(p.payMonth) || p.payMonth < 1 || p.payMonth > 12)) {
        throw new Error("Invalid pay month.");
    }
    if (p.payYear !== ALL_YEARS && (!Number.isInteger(p.payYear) || p.payYear < 1900 || p.payYear > 2200)) {
        throw new Error("Invalid pay year.");
    }

    const connection = await TenantManager.getConnection(tenantId);

    try {
        const binds: Record<string, any> = {};
        const where: string[] = [
            "V.COMPANY_CODE = H.COMPANY_CODE",
            "V.EMPLOYEE_ID  = H.EMPLOYEE_ID",
            "(NVL(H.PROCESS_FAIL, 'N') = 'Y' OR NVL(H.SAL_PROCESSED, 'N') = 'N')",
        ];

        if (p.companyCode && p.companyCode.toLowerCase() !== "all") {
            binds.company_code = p.companyCode;
            where.push("V.COMPANY_CODE = :company_code");
        }
        addInClause("V.DIV_CODE",     p.division,   "div",  binds, where);
        addInClause("V.DEPT_CODE",    p.department, "dept", binds, where);
        addInClause("V.SECTION_CODE", p.section,    "sect", binds, where);

        if (p.payMonth !== ALL_MONTHS) {
            binds.pay_month = p.payMonth;
            where.push("H.PAY_MONTH = :pay_month");
        }
        if (p.payYear !== ALL_YEARS) {
            binds.pay_year = p.payYear;
            where.push("H.PAY_YEAR = :pay_year");
        }

        const sql = `
            SELECT V.EMPLOYEE_CODE,
                   V.RPT_NAME,
                   V.GRADE_NAME,
                   V.DESG_NAME,
                   V.DIV_CODE,
                   V.DIV_NAME,
                   V.DEPT_CODE,
                   V.DEPT_NAME,
                   V.SECTION_CODE,
                   V.SECTION_NAME,
                   V.JOIN_DATE,
                   H.PAY_MONTH,
                   H.PAY_YEAR,
                   H.REMARKS
              FROM VW_HR_EMPLOYEE V,
                   VW_HR_PAYCALC_HDR_AND_HISTORY H
             WHERE ${where.join("\n               AND ")}
             ORDER BY V.DIV_CODE NULLS FIRST,
                      V.DEPT_CODE NULLS FIRST,
                      V.SECTION_CODE NULLS FIRST,
                      H.PAY_YEAR,
                      H.PAY_MONTH,
                      V.EMPLOYEE_CODE`;

        const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });

        const rows: FailRow[] = (result.rows as any[]).map((row) => {
            const r = Object.keys(row).reduce((acc: any, key) => {
                acc[key.toLowerCase()] = row[key];
                return acc;
            }, {});
            return {
                employee_code: text(r.employee_code),
                rpt_name:      text(r.rpt_name),
                grade_name:    text(r.grade_name),
                desg_name:     text(r.desg_name),
                join_date:     r.join_date,
                remarks:       text(r.remarks),
                div_code:      text(r.div_code),
                div_name:      text(r.div_name),
                dept_code:     text(r.dept_code),
                dept_name:     text(r.dept_name),
                section_code:  text(r.section_code),
                section_name:  text(r.section_name),
                pay_month:     Number(r.pay_month),
                pay_year:      Number(r.pay_year),
            };
        });

        return { rows, connection };
    } catch (err) {
        try { await connection.close(); } catch (e) { console.error(e); }
        throw err;
    }
}

// ─── Grouping: Division / Department / Section  →  Period  →  rows ────────────

interface PeriodGroup { label: string; rows: FailRow[] }
interface OrgGroup {
    div_code: string; div_name: string;
    dept_code: string; dept_name: string;
    section_code: string; section_name: string;
    periods: PeriodGroup[];
}

function buildGroups(rows: FailRow[]): OrgGroup[] {
    const orgs = new Map<string, OrgGroup>();

    rows.forEach((r) => {
        const key = `${r.div_code}|${r.dept_code}|${r.section_code}`;
        let org = orgs.get(key);
        if (!org) {
            org = {
                div_code: r.div_code, div_name: r.div_name,
                dept_code: r.dept_code, dept_name: r.dept_name,
                section_code: r.section_code, section_name: r.section_name,
                periods: [],
            };
            orgs.set(key, org);
        }
        const label = periodOf(r.pay_month, r.pay_year);
        let per = org.periods.find((x) => x.label === label);
        if (!per) { per = { label, rows: [] }; org.periods.push(per); }
        per.rows.push(r);
    });

    return [...orgs.values()];
}

const filterRows = (p: FailParams): { label: string; value: string }[] => [
    { label: "Pay Period",  value: filterPeriod(p) },
    { label: "Division",    value: p.division   || ALL },
    { label: "Department",  value: p.department || ALL },
    { label: "Section",     value: p.section    || ALL },
];

const orgLine = (label: string, code: string, name: string) =>
    `<div class="org-line"><span class="org-lbl">${label}:</span><span class="org-code">${escapeHtml(code)}</span><span class="org-name">${escapeHtml(name)}</span></div>`;

// ─── Excel HTML (.xls) ────────────────────────────────────────────────────────

function buildExcelHtml(rows: FailRow[], p: FailParams): string {
    const reportDate = formatDateStr(new Date());
    const groups = buildGroups(rows);

    let body = "";
    let sl = 0;
    groups.forEach((g) => {
        body += `<tr><td colspan="7" style="font-weight:bold;background:#eef3fb;color:#00378c">
            Division: ${escapeHtml(g.div_code)} ${escapeHtml(g.div_name)} &nbsp;|&nbsp;
            Department: ${escapeHtml(g.dept_code)} ${escapeHtml(g.dept_name)} &nbsp;|&nbsp;
            Section: ${escapeHtml(g.section_code)} ${escapeHtml(g.section_name)}</td></tr>`;
        g.periods.forEach((per) => {
            body += `<tr><td colspan="7" style="font-weight:bold;background:#f1f5f9">Period: ${escapeHtml(per.label)}</td></tr>`;
            per.rows.forEach((r) => {
                sl += 1;
                body += `<tr>
          <td style="text-align:center">${sl}</td>
          <td style="font-weight:bold;color:#00378c">${escapeHtml(r.employee_code)}</td>
          <td>${escapeHtml(r.rpt_name)}</td>
          <td>${escapeHtml(r.grade_name)}</td>
          <td>${escapeHtml(r.desg_name)}</td>
          <td style="text-align:center">${escapeHtml(formatDateStr(r.join_date))}</td>
          <td>${escapeHtml(r.remarks)}</td>
        </tr>`;
            });
        });
    });
    body += `<tr><td colspan="7" style="font-weight:bold;text-align:right;background:#dbe4f0;color:#00378c">Total Records: ${rows.length}</td></tr>`;

    return `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
<x:ExcelWorksheet><x:Name>Process Fail List</x:Name>
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
  <tr><td style="border:none;font-size:13pt;font-weight:700;color:#00378c" colspan="3">${REPORT_TITLE}</td></tr>
  ${filterRows(p).map((f) => `<tr><td class="meta-lbl" style="border:none">${escapeHtml(f.label)} :</td><td style="border:none" colspan="2">${escapeHtml(f.value)}</td></tr>`).join("")}
  <tr><td class="meta-lbl" style="border:none">Printed on :</td><td style="border:none" colspan="2">${reportDate}</td></tr>
  <tr><td class="meta-lbl" style="border:none">User :</td><td style="border:none" colspan="2">${escapeHtml(p.loginid)}</td></tr>
  <tr><td class="meta-lbl" style="border:none">Report :</td><td style="border:none" colspan="2">${REPORT_CODE}</td></tr>
</table>
<br>
<table>
  <thead>
    <tr>
      <th>SI No.</th><th>Employee Code</th><th>Employee Name</th><th>Grade</th>
      <th>Designation</th><th>Join Date</th><th>Reason</th>
    </tr>
  </thead>
  <tbody>${body}</tbody>
</table>
</body></html>`;
}

// ─── Layout CSS ───────────────────────────────────────────────────────────────

const FAIL_EXTRA_CSS = `
  @page { size: A4 landscape; margin: 6mm 12mm 12mm 12mm; }

  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
  html, body { width: 100%; max-width: 100%; overflow-x: hidden; }
  body::before, body::after { display: none !important; content: none !important; }

  .company-header { border-bottom: 2px solid #00378c; padding: 0 0 10px 0; margin: 0 0 8px 0; }
  .company-name       { font-size: 16px; font-weight: 700; color: #172033; margin: 0 0 2px 0; }
  .company-address    { font-size: 9.5px; line-height: 1.4; }
  .company-logo-wrap  { max-width: 180px; }
  .company-logo       { max-height: 56px; max-width: 180px; }

  h1.report-title { margin: 28px 0 14px 0; font-size: 18px; font-weight: 700; color: #00378c !important; }
  .applied-filters { font-size: 10.5px; margin-bottom: 28px; }

  table.data-table { width: 100%; table-layout: fixed; font-size: 10px; margin-top: 0; border-collapse: collapse; }
  table.data-table th, table.data-table td {
    overflow: visible; overflow-wrap: anywhere; word-break: break-word;
    white-space: normal !important; min-width: 0;
  }
  table.data-table .left   { text-align: left   !important; }
  table.data-table .center { text-align: center !important; }

  table.data-table thead tr th {
    background: #00378c !important; color: #ffffff !important; font-weight: 700;
    font-size: 10px; padding: 9px 4px; border: 1px solid #ffffff55 !important;
    text-transform: none; white-space: normal !important; text-align: center;
  }

  table.data-table tbody tr.org-row td {
    background: #eef3fb !important; padding: 8px 6px; border-bottom: 1px solid #cbd5e1 !important; text-align: left;
  }
  .org-line { display: flex; gap: 10px; font-size: 10.5px; font-weight: 700; color: #00378c; line-height: 1.55; }
  .org-lbl  { width: 78px; }
  .org-code { width: 48px; }
  .org-name { flex: 1; }

  table.data-table tbody tr.period-row td {
    background: #f1f5f9 !important; color: #1e293b !important; font-weight: 700;
    font-size: 10.5px; padding: 6px; border-bottom: 1px solid #cbd5e1 !important; text-align: left;
  }
  table.data-table tbody tr.data-row td {
    background: #fafcfe !important; font-size: 10px; padding: 6px 4px;
    border-bottom: 1px solid #e2e8f0 !important; color: #1e293b; vertical-align: middle;
  }
  table.data-table tbody tr.data-row td.nw { white-space: nowrap !important; }
  table.data-table tbody tr.data-row td.primary-text { color: #00378c; font-weight: 700; }
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

// % widths – add up to 100
const COL_WIDTHS = [4, 11, 21, 15, 15, 9, 25];

function renderBody(rows: FailRow[], p: FailParams): string {
    let tableRows = "";

    if (!rows.length) {
        tableRows = `<tr class="empty-row"><td colspan="7">${escapeHtml(NO_DATA_MESSAGE)}</td></tr>`;
    } else {
        let sl = 0;
        buildGroups(rows).forEach((g) => {
            tableRows += `<tr class="org-row"><td colspan="7">
              ${orgLine("Division", g.div_code, g.div_name)}
              ${orgLine("Department", g.dept_code, g.dept_name)}
              ${orgLine("Section", g.section_code, g.section_name)}
            </td></tr>`;

            g.periods.forEach((per) => {
                tableRows += `<tr class="period-row"><td colspan="7">Period: &nbsp; ${escapeHtml(per.label)}</td></tr>`;
                per.rows.forEach((r) => {
                    sl += 1;
                    tableRows += `
        <tr class="data-row">
          <td class="center nw">${sl}</td>
          <td class="left nw primary-text">${escapeHtml(r.employee_code)}</td>
          <td class="left">${escapeHtml(r.rpt_name)}</td>
          <td class="left">${escapeHtml(r.grade_name)}</td>
          <td class="left">${escapeHtml(r.desg_name)}</td>
          <td class="center nw">${escapeHtml(formatDateStr(r.join_date))}</td>
          <td class="left">${escapeHtml(r.remarks)}</td>
        </tr>`;
                });
            });
        });
        tableRows += `<tr class="end-row"><td colspan="7">Total Records: ${rows.length} &nbsp;&nbsp; | &nbsp;&nbsp; End of Report</td></tr>`;
    }

    const colgroup = COL_WIDTHS.map((w) => `<col style="width:${w}%"/>`).join("");

    return `
    <h1 class="report-title">${REPORT_TITLE}</h1>
    ${reportAppliedFilters(filterRows(p))}

    <table class="data-table">
      <colgroup>${colgroup}</colgroup>
      <thead>
        <tr>
          <th>SI No.</th>
          <th>Employee Code</th>
          <th>Employee Name</th>
          <th>Grade</th>
          <th>Designation</th>
          <th>Join Date</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  `;
}

// ─── HTML Controller ──────────────────────────────────────────────────────────

export const getEmployeeSalaryNotProcessedReport = async (req: RequestWithUser, res: Response): Promise<void> => {
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
            reportName: REPORT_CODE,
            userName:   params.loginid,
            endLabel:   "Powered by Bayanat Technology",
            extraLeft:  `Print: ${escapeHtml(printed)} | User: ${escapeHtml(params.loginid)}`,
        });

        const html = buildReportDocument({
            title: REPORT_TITLE,
            headerHtml,
            bodyHtml,
            footerHtml,
            extraCss: FAIL_EXTRA_CSS,
            autoPrint: req.query.print !== "false",
            showPrintButton: true,
            fontMode: "native",
        });

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.status(200).send(html);
    } catch (error: any) {
        console.error("Employee Salary Not Processed Report Error:", error);
        res.status(500).json({ success: false, message: "Unable to generate report", details: error.message });
    } finally {
        if (connection) try { await connection.close(); } catch (e) { console.error(e); }
    }
};

// ─── Excel Controller ─────────────────────────────────────────────────────────

export const exportEmployeeSalaryNotProcessedReportExcel = async (req: Request, res: Response): Promise<void> => {
    let connection: any;
    try {
        const { rows, connection: conn } = await fetchRows(req.body);
        connection = conn;

        if (!rows.length) {
            res.status(200).json({ success: false, message: "No data found for the selected criteria." });
            return;
        }

        const excelHtml = buildExcelHtml(rows, resolveParams(req.body));

        res.setHeader("Content-Type", "application/vnd.ms-excel");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="EmployeePayrollProcessFail_${new Date().toISOString().slice(0, 10)}.xls"`
        );
        res.status(200).send(excelHtml);
    } catch (error: any) {
        console.error("Employee Salary Not Processed Report Excel Error:", error);
        res.status(500).json({ success: false, message: "Unable to export report", details: error.message });
    } finally {
        if (connection) try { await connection.close(); } catch (e) { console.error(e); }
    }
};