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
const REPORT_TITLE = "Monthly Salary Summary";
const ALL_MONTHS = 99;
const ALL_YEARS = 9999;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const text = (v: any): string => (v == null ? "" : String(v));

const formatDateStr = (v: any): string => {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString("en-GB");
};

const escapeHtml = (v: unknown): string =>
    text(v)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

const num = (v: any): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (v: number): string => v.toFixed(3);

// ─── Types ────────────────────────────────────────────────────────────────────

interface SalaryRow {
    employee_code: string;
    emp_name: string;
    net_salary: number;
    al: number;       // Annual leave accrual   (AL_BASIS_FACTOR)
    gr: number;       // Gratuity accrual       (GR_BASIS_FACTOR)
    ta: number;       // Airfare accrual        (TA_BASIS_FACTOR)
    pasi: number;     // Other accruals         (Pasi_Accrued)
}

interface SalaryParams {
    loginid: string;
    companyCode: string;
    division: string;     // comma separated codes or "" (= All)
    department: string;
    section: string;
    employeeCode: string;
    payMonth: number;     // 99 = All
    payYear: number;      // 9999 = All
}

// ─── Resolve request body ─────────────────────────────────────────────────────
// code1 company, code2 division, code3 department, code4 section, code5 employee code(s),
// number1 pay month (99 = All), number2 pay year (9999 = All).

const csvOrEmpty = (v: any): string => {
    const s = text(v).trim();
    return !s || s.toLowerCase() === "all" ? "" : s;
};

function resolveParams(body: any): SalaryParams {
    const { loginid, company_code, code1, code2, code3, code4, code5, number1, number2 } = body;
    const m = Number(number1);
    const y = Number(number2);
    return {
        loginid:      loginid || "ADMIN",
        companyCode:  text(company_code || code1),
        division:     csvOrEmpty(code2),
        department:   csvOrEmpty(code3),
        section:      csvOrEmpty(code4),
        employeeCode: csvOrEmpty(code5),
        payMonth:     Number.isFinite(m) && m > 0 ? m : ALL_MONTHS,
        payYear:      Number.isFinite(y) && y > 0 ? y : ALL_YEARS,
    };
}

const periodLabel = (p: SalaryParams) =>
    `${p.payMonth === ALL_MONTHS ? ALL : MONTHS[p.payMonth - 1] ?? ""} ${p.payYear === ALL_YEARS ? ALL : p.payYear}`;

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

async function fetchRows(body: any): Promise<{ rows: SalaryRow[]; connection: any }> {
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
            "H.COMPANY_CODE = E.COMPANY_CODE",
            "H.EMPLOYEE_ID  = E.EMPLOYEE_ID",
        ];

        if (p.companyCode && p.companyCode.toLowerCase() !== "all") {
            binds.as_companycode = p.companyCode;
            where.push("H.COMPANY_CODE = :as_companycode");
        }
        addInClause("E.DIV_CODE",      p.division,     "div",  binds, where);
        addInClause("E.DEPT_CODE",     p.department,   "dept", binds, where);
        addInClause("E.SECTION_CODE",  p.section,      "sect", binds, where);
        addInClause("E.EMPLOYEE_CODE", p.employeeCode, "emp",  binds, where);

        if (p.payMonth !== ALL_MONTHS) {
            binds.ai_pay_month = p.payMonth;
            where.push("H.PAY_MONTH = :ai_pay_month");
        }
        if (p.payYear !== ALL_YEARS) {
            binds.ai_pay_year = p.payYear;
            where.push("H.PAY_YEAR = :ai_pay_year");
        }

        const sql = `
            SELECT H.COMPANY_CODE,
                   H.EMPLOYEE_ID,
                   H.PAY_MONTH,
                   H.PAY_YEAR,
                   H.NET_SALARY,
                   E.RPT_NAME EMP_NAME,
                   E.EMPLOYEE_CODE,
                   E.DIV_CODE,
                   E.DEPT_CODE,
                   E.SECTION_CODE,
                   (SELECT SUM(NVL(A.ACCRUED_AMT, 0)) FROM HR_EMP_ACCRUAL_DTL A
                     WHERE A.ACCRUAL_TYPE = 'AL'
                       AND A.EMPLOYEE_ID  = H.EMPLOYEE_ID
                       AND A.PAY_YEAR     = H.PAY_YEAR
                       AND A.PAY_MONTH    = H.PAY_MONTH) AL_BASIS_FACTOR,
                   (SELECT SUM(NVL(A.ACCRUED_AMT, 0)) FROM HR_EMP_ACCRUAL_DTL A
                     WHERE A.ACCRUAL_TYPE = 'GR'
                       AND A.EMPLOYEE_ID  = H.EMPLOYEE_ID
                       AND A.PAY_YEAR     = H.PAY_YEAR
                       AND A.PAY_MONTH    = H.PAY_MONTH) GR_BASIS_FACTOR,
                   (SELECT SUM(NVL(A.ACCRUED_AMT, 0)) FROM HR_EMP_ACCRUAL_DTL A
                     WHERE A.ACCRUAL_TYPE IN ('TA', 'TC', 'TI')
                       AND A.EMPLOYEE_ID  = H.EMPLOYEE_ID
                       AND A.PAY_YEAR     = H.PAY_YEAR
                       AND A.PAY_MONTH    = H.PAY_MONTH) TA_BASIS_FACTOR,
                   (SELECT SUM(NVL(A.ACCRUED_AMT, 0)) FROM HR_EMP_ACCRUAL_DTL A
                     WHERE A.ACCRUAL_TYPE NOT IN ('AL', 'GR', 'TA', 'TC', 'TI')
                       AND A.EMPLOYEE_ID  = H.EMPLOYEE_ID
                       AND A.PAY_YEAR     = H.PAY_YEAR
                       AND A.PAY_MONTH    = H.PAY_MONTH) PASI_ACCRUED
              FROM HR_EMP_PAY_CALC_HDR H,
                   MS_HR_EMPLOYEE E
             WHERE ${where.join("\n               AND ")}
             ORDER BY H.PAY_YEAR, H.PAY_MONTH, E.EMPLOYEE_CODE`;

        const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });

        const rows: SalaryRow[] = (result.rows as any[]).map((row) => {
            const r = Object.keys(row).reduce((acc: any, key) => {
                acc[key.toLowerCase()] = row[key];
                return acc;
            }, {});
            return {
                employee_code: text(r.employee_code),
                emp_name:      text(r.emp_name),
                net_salary:    num(r.net_salary),
                al:            num(r.al_basis_factor),
                gr:            num(r.gr_basis_factor),
                ta:            num(r.ta_basis_factor),
                pasi:          num(r.pasi_accrued),
            };
        });

        return { rows, connection };
    } catch (err) {
        try { await connection.close(); } catch (e) { console.error(e); }
        throw err;
    }
}

// ─── Totals / filters ─────────────────────────────────────────────────────────

const totalsOf = (rows: SalaryRow[]) =>
    rows.reduce(
        (t, r) => ({
            net_salary: t.net_salary + r.net_salary,
            al: t.al + r.al,
            gr: t.gr + r.gr,
            ta: t.ta + r.ta,
            pasi: t.pasi + r.pasi,
        }),
        { net_salary: 0, al: 0, gr: 0, ta: 0, pasi: 0 }
    );

const filterRows = (p: SalaryParams): { label: string; value: string }[] => [
    { label: "Pay Period",    value: periodLabel(p) },
    { label: "Division",      value: p.division     || ALL },
    { label: "Department",    value: p.department   || ALL },
    { label: "Section",       value: p.section      || ALL },
    { label: "Employee Code", value: p.employeeCode || ALL },
];

// ─── Excel HTML (.xls) ────────────────────────────────────────────────────────

function buildExcelHtml(rows: SalaryRow[], p: SalaryParams): string {
    const reportDate = formatDateStr(new Date());
    const t = totalsOf(rows);

    const body = rows
        .map((r, i) => `<tr>
          <td style="text-align:center">${i + 1}</td>
          <td style="font-weight:bold;color:#00378c">${escapeHtml(r.employee_code)}</td>
          <td>${escapeHtml(r.emp_name)}</td>
          <td style="text-align:right">${money(r.net_salary)}</td>
          <td style="text-align:right">${money(r.al)}</td>
          <td style="text-align:right">${money(r.gr)}</td>
          <td style="text-align:right">${money(r.ta)}</td>
          <td style="text-align:right">${money(r.pasi)}</td>
        </tr>`)
        .join("");

    const tot = "font-weight:bold;text-align:right;background:#dbe4f0;color:#00378c";

    return `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
<x:ExcelWorksheet><x:Name>Salary Summary</x:Name>
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
  <tr><td style="border:none;font-size:13pt;font-weight:700;color:#00378c" colspan="3">${REPORT_TITLE} - ${escapeHtml(periodLabel(p))}</td></tr>
  ${filterRows(p).map((f) => `<tr><td class="meta-lbl" style="border:none">${escapeHtml(f.label)} :</td><td style="border:none" colspan="2">${escapeHtml(f.value)}</td></tr>`).join("")}
  <tr><td class="meta-lbl" style="border:none">Printed on :</td><td style="border:none" colspan="2">${reportDate}</td></tr>
  <tr><td class="meta-lbl" style="border:none">User :</td><td style="border:none" colspan="2">${escapeHtml(p.loginid)}</td></tr>
</table>
<br>
<table>
  <thead>
    <tr>
      <th>SI No.</th><th>Employee Code</th><th>Employee Name</th><th>Net Salary</th>
      <th>Annual Leave Accrual</th><th>Gratuity Accrual</th><th>Airfare Accrual</th><th>PASI Accrued</th>
    </tr>
  </thead>
  <tbody>
    ${body}
    <tr>
      <td colspan="3" style="${tot}">Grand Total (${rows.length} Records)</td>
      <td style="${tot}">${money(t.net_salary)}</td>
      <td style="${tot}">${money(t.al)}</td>
      <td style="${tot}">${money(t.gr)}</td>
      <td style="${tot}">${money(t.ta)}</td>
      <td style="${tot}">${money(t.pasi)}</td>
    </tr>
  </tbody>
</table>
</body></html>`;
}

// ─── Layout CSS ───────────────────────────────────────────────────────────────

const SALARY_EXTRA_CSS = `
  @page { size: A4 portrait; margin: 6mm 12mm 12mm 12mm; }

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
  table.data-table .right  { text-align: right  !important; font-variant-numeric: tabular-nums; }

  table.data-table thead tr th {
    background: #00378c !important; color: #ffffff !important; font-weight: 700;
    font-size: 10px; padding: 9px 4px; border: 1px solid #ffffff55 !important;
    text-transform: none; white-space: normal !important; text-align: center;
  }
  table.data-table tbody tr.data-row td {
    background: #fafcfe !important; font-size: 10px; padding: 7px 4px;
    border-bottom: 1px solid #e2e8f0 !important; color: #1e293b; vertical-align: middle;
  }
  table.data-table tbody tr.data-row td.nw { white-space: nowrap !important; font-variant-numeric: tabular-nums; }
  table.data-table tbody tr.data-row td.primary-text { color: #00378c; font-weight: 700; }
  table.data-table tbody tr.grand-total-row td {
    background: #dbe4f0 !important; color: #00378c !important; font-weight: 700;
    padding: 9px 4px; text-align: right; border-bottom: 1px solid #cbd5e1 !important;
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
const COL_WIDTHS = [5, 12, 27, 12, 11, 11, 11, 11];

function renderBody(rows: SalaryRow[], p: SalaryParams): string {
    const amt = (v: number) => `<td class="right nw">${money(v)}</td>`;

    let tableRows = "";
    if (!rows.length) {
        tableRows = `<tr class="empty-row"><td colspan="8">${escapeHtml(NO_DATA_MESSAGE)}</td></tr>`;
    } else {
        rows.forEach((r, i) => {
            tableRows += `
        <tr class="data-row">
          <td class="center nw">${i + 1}</td>
          <td class="left nw primary-text">${escapeHtml(r.employee_code)}</td>
          <td class="left">${escapeHtml(r.emp_name)}</td>
          ${amt(r.net_salary)}${amt(r.al)}${amt(r.gr)}${amt(r.ta)}${amt(r.pasi)}
        </tr>`;
        });
        const t = totalsOf(rows);
        tableRows += `
        <tr class="grand-total-row">
          <td colspan="3">Grand Total (${rows.length} Records)</td>
          ${amt(t.net_salary)}${amt(t.al)}${amt(t.gr)}${amt(t.ta)}${amt(t.pasi)}
        </tr>`;
    }

    const colgroup = COL_WIDTHS.map((w) => `<col style="width:${w}%"/>`).join("");

    return `
    <h1 class="report-title">${REPORT_TITLE} - ${escapeHtml(periodLabel(p))}</h1>
    ${reportAppliedFilters(filterRows(p))}

    <table class="data-table">
      <colgroup>${colgroup}</colgroup>
      <thead>
        <tr>
          <th>SI No.</th>
          <th>Employee Code</th>
          <th>Employee Name</th>
          <th>Net Salary</th>
          <th>Annual Leave Accrual</th>
          <th>Gratuity Accrual</th>
          <th>Airfare Accrual</th>
          <th>PASI Accrued</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  `;
}

// ─── HTML Controller ──────────────────────────────────────────────────────────

export const getMonthlySalarySummaryReport = async (req: RequestWithUser, res: Response): Promise<void> => {
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
            reportName: REPORT_TITLE,
            userName:   params.loginid,
            endLabel:   "Powered by Bayanat Technology",
            extraLeft:  `Print: ${escapeHtml(printed)} | User: ${escapeHtml(params.loginid)}`,
        });

        const html = buildReportDocument({
            title: REPORT_TITLE,
            headerHtml,
            bodyHtml,
            footerHtml,
            extraCss: SALARY_EXTRA_CSS,
            autoPrint: req.query.print !== "false",
            showPrintButton: true,
            fontMode: "native",
        });

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.status(200).send(html);
    } catch (error: any) {
        console.error("Monthly Salary Summary Report Error:", error);
        res.status(500).json({ success: false, message: "Unable to generate report", details: error.message });
    } finally {
        if (connection) try { await connection.close(); } catch (e) { console.error(e); }
    }
};

// ─── Excel Controller ─────────────────────────────────────────────────────────

export const exportMonthlySalarySummaryReportExcel = async (req: Request, res: Response): Promise<void> => {
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
            `attachment; filename="MonthlySalarySummary_${new Date().toISOString().slice(0, 10)}.xls"`
        );
        res.status(200).send(excelHtml);
    } catch (error: any) {
        console.error("Monthly Salary Summary Report Excel Error:", error);
        res.status(500).json({ success: false, message: "Unable to export report", details: error.message });
    } finally {
        if (connection) try { await connection.close(); } catch (e) { console.error(e); }
    }
};