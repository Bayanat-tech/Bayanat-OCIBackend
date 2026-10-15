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

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportType = "VACATION" | "SEPARATION";

interface VsRow {
    employee_code: string;
    employee_name: string;
    net_salary: number;
    annual_leave: number;
    gratuity: number;
    airfare: number;
    total: number;
}

interface VsParams {
    loginid: string;
    companyCode: string;
    reportType: ReportType;
    payMonth: number;
    payYear: number;
}

// ─── Resolve request body ─────────────────────────────────────────────────────
// code1 company, code2 report type (VACATION | SEPARATION),
// number1 pay month (1-12), number2 pay year.

function resolveParams(body: any): VsParams {
    const { loginid, company_code, code1, code2, number1, number2 } = body;
    return {
        loginid:     loginid || "ADMIN",
        companyCode: text(company_code || code1),
        reportType:  text(code2).toUpperCase() === "SEPARATION" ? "SEPARATION" : "VACATION",
        payMonth:    Number(number1),
        payYear:     Number(number2),
    };
}

const isVacation = (p: VsParams) => p.reportType === "VACATION";
const periodLabel = (p: VsParams) => `${MONTHS[p.payMonth - 1] ?? ""} ${p.payYear}`;
const reportTitle = (p: VsParams) =>
    `${isVacation(p) ? "Vacation" : "Separation"} Report - ${periodLabel(p)}`;
const reportCode = (p: VsParams) =>
    isVacation(p) ? "rpt_hr_vacation_details_new" : "rpt_hr_separatn_details";

// ─── SQL ──────────────────────────────────────────────────────────────────────

const VACATION_SQL = `
    SELECT COMPANY_CODE,
           EMPLOYEE_CODE,
           EMPLOYEE_ID,
           EMP_NAME,
           PAY_MONTH,
           PAY_YEAR,
           NET_SALARY
      FROM VW_HR_VACATION_SETTTLEMENT
     WHERE COMPANY_CODE = :as_companycode
       AND PAY_MONTH    = :vl_paymonth
       AND PAY_YEAR     = :vl_payyear
     ORDER BY EMPLOYEE_CODE`;

const SEPARATION_SQL = `
    SELECT VW_HR_EMPLOYEE.EMPLOYEE_CODE,
           HR_EMP_PAY_CALC_HDR.EMPLOYEE_ID,
           VW_HR_EMPLOYEE.RPT_NAME,
           NET_SALARY,
           SUM(CASE HR_EMP_FINAL_SETTLEMENT.ACCRUAL_TYPE
                    WHEN 'AL' THEN HR_EMP_FINAL_SETTLEMENT.SETTLEMENT_AMOUNT ELSE 0 END) AL,
           SUM(CASE HR_EMP_FINAL_SETTLEMENT.ACCRUAL_TYPE
                    WHEN 'GR' THEN HR_EMP_FINAL_SETTLEMENT.SETTLEMENT_AMOUNT ELSE 0 END) GR,
           SUM(CASE HR_EMP_FINAL_SETTLEMENT.ACCRUAL_TYPE
                    WHEN 'TI' THEN HR_EMP_FINAL_SETTLEMENT.SETTLEMENT_AMOUNT
                    WHEN 'TC' THEN HR_EMP_FINAL_SETTLEMENT.SETTLEMENT_AMOUNT
                    WHEN 'TA' THEN HR_EMP_FINAL_SETTLEMENT.SETTLEMENT_AMOUNT ELSE 0 END) TA
      FROM HR_EMP_PAY_CALC_HDR,
           VW_HR_EMPLOYEE,
           HR_EMP_FINAL_SETTLEMENT
     WHERE HR_EMP_PAY_CALC_HDR.EMPLOYEE_ID = VW_HR_EMPLOYEE.EMPLOYEE_ID
       AND HR_EMP_PAY_CALC_HDR.EMPLOYEE_ID = HR_EMP_FINAL_SETTLEMENT.EMPLOYEE_ID
       AND HR_EMP_PAY_CALC_HDR.EMPLOYEE_ID IN (
             SELECT EMPLOYEE_ID
               FROM HR_EMP_PAY_CALC_DTL
              WHERE SOURCE_FLAG  = 'S'
                AND PAY_MONTH    = :vl_paymonth
                AND PAY_YEAR     = :vl_payyear
                AND COMPANY_CODE = :as_companycode)
     GROUP BY VW_HR_EMPLOYEE.EMPLOYEE_CODE,
              HR_EMP_PAY_CALC_HDR.EMPLOYEE_ID,
              VW_HR_EMPLOYEE.RPT_NAME,
              NET_SALARY
     ORDER BY VW_HR_EMPLOYEE.EMPLOYEE_CODE`;

// ─── Fetch rows ───────────────────────────────────────────────────────────────

async function fetchRows(body: any): Promise<{ rows: VsRow[]; connection: any }> {
    const p = resolveParams(body);

    let tenantId = getCurrentTenantId();
    if (!tenantId && p.loginid) tenantId = await TenantManager.getTenantForUser(p.loginid);
    if (!tenantId) throw new Error("Tenant not found");

    if (!p.companyCode) throw new Error("Company code is required.");
    if (!Number.isInteger(p.payMonth) || p.payMonth < 1 || p.payMonth > 12) throw new Error("Invalid pay month.");
    if (!Number.isInteger(p.payYear) || p.payYear < 1900 || p.payYear > 2200) throw new Error("Invalid pay year.");

    const connection = await TenantManager.getConnection(tenantId);

    try {
        const binds = {
            as_companycode: p.companyCode,
            vl_paymonth: p.payMonth,
            vl_payyear: p.payYear,
        };

        const result = await connection.execute(
            isVacation(p) ? VACATION_SQL : SEPARATION_SQL,
            binds,
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const raw: any[] = (result.rows as any[]).map((row) =>
            Object.keys(row).reduce((acc: any, key) => {
                acc[key.toLowerCase()] = row[key];
                return acc;
            }, {})
        );

        const rows: VsRow[] = raw.map((r) => {
            const net = num(r.net_salary);
            if (isVacation(p)) {
                return {
                    employee_code: text(r.employee_code),
                    employee_name: text(r.emp_name),
                    net_salary: net,
                    annual_leave: 0, gratuity: 0, airfare: 0,
                    total: net,
                };
            }
            const al = num(r.al), gr = num(r.gr), ta = num(r.ta);
            return {
                employee_code: text(r.employee_code),
                employee_name: text(r.rpt_name),
                net_salary: net,
                annual_leave: al, gratuity: gr, airfare: ta,
                total: net + al + gr + ta,
            };
        });

        return { rows, connection };
    } catch (err) {
        try { await connection.close(); } catch (e) { console.error(e); }
        throw err;
    }
}

// ─── Totals / filters ─────────────────────────────────────────────────────────

function grandTotals(rows: VsRow[]) {
    return rows.reduce(
        (t, r) => ({
            net_salary: t.net_salary + r.net_salary,
            annual_leave: t.annual_leave + r.annual_leave,
            gratuity: t.gratuity + r.gratuity,
            airfare: t.airfare + r.airfare,
            total: t.total + r.total,
        }),
        { net_salary: 0, annual_leave: 0, gratuity: 0, airfare: 0, total: 0 }
    );
}

const filterRows = (p: VsParams): { label: string; value: string }[] => [
    { label: "Report Type", value: isVacation(p) ? "Vacation" : "Separation" },
    { label: "Pay Month",   value: MONTHS[p.payMonth - 1] ?? "" },
    { label: "Pay Year",    value: String(p.payYear) },
];

// ─── Excel HTML (.xls) ────────────────────────────────────────────────────────

function buildExcelHtml(rows: VsRow[], p: VsParams): string {
    const vac = isVacation(p);
    const reportDate = formatDateStr(new Date());
    const t = grandTotals(rows);
    const colCount = vac ? 4 : 8;

    const body = rows
        .map((r, i) => `<tr>
          <td style="text-align:center">${i + 1}</td>
          <td style="font-weight:bold;color:#00378c">${escapeHtml(r.employee_code)}</td>
          <td>${escapeHtml(r.employee_name)}</td>
          <td style="text-align:right">${money(r.net_salary)}</td>
          ${vac ? "" : `<td style="text-align:right">${money(r.annual_leave)}</td>
          <td style="text-align:right">${money(r.gratuity)}</td>
          <td style="text-align:right">${money(r.airfare)}</td>
          <td style="text-align:right">${money(r.total)}</td>`}
        </tr>`)
        .join("");

    const totalRow = `<tr>
          <td colspan="3" style="font-weight:bold;text-align:right;background:#dbe4f0;color:#00378c">Grand Total (${rows.length} Records)</td>
          <td style="font-weight:bold;text-align:right;background:#dbe4f0">${money(t.net_salary)}</td>
          ${vac ? "" : `<td style="font-weight:bold;text-align:right;background:#dbe4f0">${money(t.annual_leave)}</td>
          <td style="font-weight:bold;text-align:right;background:#dbe4f0">${money(t.gratuity)}</td>
          <td style="font-weight:bold;text-align:right;background:#dbe4f0">${money(t.airfare)}</td>
          <td style="font-weight:bold;text-align:right;background:#dbe4f0">${money(t.total)}</td>`}
        </tr>`;

    return `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
<x:ExcelWorksheet><x:Name>${vac ? "Vacation" : "Separation"}</x:Name>
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
  ${filterRows(p).map((f) => `<tr><td class="meta-lbl" style="border:none">${escapeHtml(f.label)} :</td><td style="border:none" colspan="2">${escapeHtml(f.value)}</td></tr>`).join("")}
  <tr><td class="meta-lbl" style="border:none">Printed on :</td><td style="border:none" colspan="2">${reportDate}</td></tr>
  <tr><td class="meta-lbl" style="border:none">User :</td><td style="border:none" colspan="2">${escapeHtml(p.loginid)}</td></tr>
</table>
<br>
<table>
  <thead>
    <tr>
      <th>SI No.</th><th>Employee Code</th><th>Employee Name</th><th>Net Salary</th>
      ${vac ? "" : "<th>Annual Leave</th><th>Gratuity</th><th>Airfare</th><th>Total Amount</th>"}
    </tr>
  </thead>
  <tbody>${body}${totalRow}</tbody>
</table>
</body></html>`;
}

// ─── Layout CSS ───────────────────────────────────────────────────────────────

const VS_EXTRA_CSS = `
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

  table.data-table { width: 100%; table-layout: fixed; font-size: 10.5px; margin-top: 0; border-collapse: collapse; }
  table.data-table th, table.data-table td {
    overflow: visible; overflow-wrap: anywhere; word-break: break-word;
    white-space: normal !important; min-width: 0;
  }
  table.data-table .left   { text-align: left   !important; }
  table.data-table .center { text-align: center !important; }
  table.data-table .right  { text-align: right  !important; font-variant-numeric: tabular-nums; }

  table.data-table thead tr th {
    background: #00378c !important; color: #ffffff !important; font-weight: 700;
    font-size: 10.5px; padding: 9px 4px; border: 1px solid #ffffff55 !important;
    text-transform: none; white-space: normal !important; text-align: center;
  }
  table.data-table tbody tr.data-row td {
    background: #fafcfe !important; font-size: 10.5px; padding: 7px 4px;
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

// % widths – each set adds up to 100
const VAC_WIDTHS = [8, 20, 52, 20];
const SEP_WIDTHS = [6, 12, 28, 13, 12, 10, 9, 10];

function renderBody(rows: VsRow[], p: VsParams): string {
    const vac = isVacation(p);
    const colCount = vac ? 4 : 8;
    const amt = (v: number) => `<td class="right nw">${money(v)}</td>`;

    let tableRows = "";
    if (!rows.length) {
        tableRows = `<tr class="empty-row"><td colspan="${colCount}">${escapeHtml(NO_DATA_MESSAGE)}</td></tr>`;
    } else {
        rows.forEach((r, i) => {
            tableRows += `
        <tr class="data-row">
          <td class="center nw">${i + 1}</td>
          <td class="left nw primary-text">${escapeHtml(r.employee_code)}</td>
          <td class="left">${escapeHtml(r.employee_name)}</td>
          ${amt(r.net_salary)}
          ${vac ? "" : amt(r.annual_leave) + amt(r.gratuity) + amt(r.airfare) + amt(r.total)}
        </tr>`;
        });

        const t = grandTotals(rows);
        tableRows += `
        <tr class="grand-total-row">
          <td colspan="3">Grand Total (${rows.length} Records)</td>
          ${amt(t.net_salary)}
          ${vac ? "" : amt(t.annual_leave) + amt(t.gratuity) + amt(t.airfare) + amt(t.total)}
        </tr>`;
    }

    const colgroup = (vac ? VAC_WIDTHS : SEP_WIDTHS).map((w) => `<col style="width:${w}%"/>`).join("");

    return `
    <h1 class="report-title">${escapeHtml(reportTitle(p))}</h1>
    ${reportAppliedFilters(filterRows(p))}

    <table class="data-table">
      <colgroup>${colgroup}</colgroup>
      <thead>
        <tr>
          <th>SI No.</th>
          <th>Employee Code</th>
          <th>Employee Name</th>
          <th>Net Salary</th>
          ${vac ? "" : "<th>Annual Leave</th><th>Gratuity</th><th>Airfare</th><th>Total Amount</th>"}
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  `;
}

// ─── HTML Controller ──────────────────────────────────────────────────────────

export const getVacationSeparationReport = async (req: RequestWithUser, res: Response): Promise<void> => {
    let connection: any;
    try {
        const { rows, connection: conn } = await fetchRows(req.body);
        connection = conn;

        const params      = resolveParams(req.body);
        const companyCode = params.companyCode || req.user?.company_code || "";
        const title       = reportTitle(params);

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
            title,
            headerHtml,
            bodyHtml,
            footerHtml,
            extraCss: VS_EXTRA_CSS,
            autoPrint: req.query.print !== "false",
            showPrintButton: true,
            fontMode: "native",
        });

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.status(200).send(html);
    } catch (error: any) {
        console.error("Vacation/Separation Report Error:", error);
        res.status(500).json({ success: false, message: "Unable to generate report", details: error.message });
    } finally {
        if (connection) try { await connection.close(); } catch (e) { console.error(e); }
    }
};

// ─── Excel Controller ─────────────────────────────────────────────────────────

export const exportVacationSeparationReportExcel = async (req: Request, res: Response): Promise<void> => {
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
            `attachment; filename="${isVacation(params) ? "Vacation" : "Separation"}Report_${params.payYear}${String(params.payMonth).padStart(2, "0")}.xls"`
        );
        res.status(200).send(excelHtml);
    } catch (error: any) {
        console.error("Vacation/Separation Report Excel Error:", error);
        res.status(500).json({ success: false, message: "Unable to export report", details: error.message });
    } finally {
        if (connection) try { await connection.close(); } catch (e) { console.error(e); }
    }
};

