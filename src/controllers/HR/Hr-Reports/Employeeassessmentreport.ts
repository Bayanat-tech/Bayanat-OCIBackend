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
const DASH = "\u2014";
const ALL = "All";

const text = (v: any): string => (v == null ? "" : String(v));

const formatDateStr = (v: any): string => {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    if (d.getFullYear() <= 1970) return "";
    return d.toLocaleDateString("en-GB");
};

const dateOrDash = (v: any): string => formatDateStr(v) || DASH;

const escapeHtml = (v: unknown): string =>
    text(v)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

const valueOrDash = (v: any): string => (text(v).trim() ? text(v) : DASH);

const ratingText = (v: any): string => {
    if (v == null || v === "") return DASH;
    const n = Number(v);
    return Number.isNaN(n) ? DASH : n.toFixed(2);
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface AssessmentRow {
    company_code:     string;
    employee_id:      string;
    employee_code:    string;
    rpt_name:         string;
    desg_name:        string;
    overall_rating:   number | null;
    assessment_scale: string;
    prom_recomend:    string;
    title_grade:      string;
}

interface AssessmentParams {
    loginid:     string;
    companyCode: string;
    division:    string;
    department:  string;
    section:     string;
    employee:    string;
    date_from:   string;
    date_to:     string;
    emp_type:    string;
}

// ─── Resolve request body ─────────────────────────────────────────────────────
// code1 = company, code2 = division, code3 = department, code4 = section,
// code5 = employee id, code9 = "A" (active) | "ALL", date1/date2 = period (YYYY-MM-DD)

function resolveParams(body: any): AssessmentParams {
    const { loginid, company_code, code1, code2, code3, code4, code5, code9, date1, date2 } = body;
    return {
        loginid:     loginid || "ADMIN",
        companyCode: text(company_code || code1),
        division:    code2 || "",
        department:  code3 || "",
        section:     code4 || "",
        employee:    code5 || "",
        date_from:   date1 || "",
        date_to:     date2 || "",
        emp_type:    code9 || "A",
    };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

// ─── Fetch rows (the legacy SELECT, with bind variables) ──────────────────────

async function fetchAssessmentRows(
    body: any
): Promise<{ rows: AssessmentRow[]; connection: any }> {
    const p = resolveParams(body);

    let tenantId = getCurrentTenantId();
    if (!tenantId && p.loginid) tenantId = await TenantManager.getTenantForUser(p.loginid);
    if (!tenantId) throw new Error("Tenant not found");

    if (!ISO_DATE.test(p.date_from) || !ISO_DATE.test(p.date_to)) {
        throw new Error("Financial year From and To dates are required.");
    }

    const connection = await TenantManager.getConnection(tenantId);

    try {
        const binds = {
            as_companycode: p.companyCode || ALL,
            as_divcode:     p.division    || ALL,
            as_deptcode:    p.department  || ALL,
            as_sectcode:    p.section     || ALL,
            as_empid:       p.employee    || ALL,
            date_from:      p.date_from.slice(0, 10),
            date_to:        p.date_to.slice(0, 10),
            as_empstatus:   p.emp_type === "A" ? "A" : ALL,
        };

        const sql = `
            SELECT H.COMPANY_CODE,
                   H.EMPLOYEE_ID,
                   V.EMPLOYEE_CODE,
                   V.RPT_NAME,
                   V.DESG_NAME,
                   H.OVERALL_RATING,
                   H.ASSESSMENT_SCALE,
                   H.PROM_RECOMEND,
                   H.TITLE_GRADE
              FROM HR_ASSESSMENT_PROCESS H
              JOIN VW_HR_EMPLOYEE V
                ON H.COMPANY_CODE = V.COMPANY_CODE
               AND H.EMPLOYEE_ID  = V.EMPLOYEE_ID
             WHERE (H.COMPANY_CODE = :as_companycode OR 'All' = :as_companycode)
               AND (V.DIV_CODE     = :as_divcode     OR 'All' = :as_divcode)
               AND (V.DEPT_CODE    = :as_deptcode    OR 'All' = :as_deptcode)
               AND (V.SECTION_CODE = :as_sectcode    OR 'All' = :as_sectcode)
               AND (H.EMPLOYEE_ID  = :as_empid       OR 'All' = :as_empid)
               AND H.PERIOD_FROM >= TO_DATE(:date_from, 'YYYY-MM-DD')
               AND H.PERIOD_TO   <= TO_DATE(:date_to,   'YYYY-MM-DD')
               AND ('All' = :as_empstatus OR V.EMP_STATUS IN ('C', 'P'))
             ORDER BY V.EMPLOYEE_CODE`;

        const result = await connection.execute(sql, binds, {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
        });

        const rows: AssessmentRow[] = (result.rows as any[]).map((row) =>
            Object.keys(row).reduce((acc: any, key) => {
                acc[key.toLowerCase()] = row[key];
                return acc;
            }, {})
        );

        return { rows, connection };
    } catch (err) {
        try { await connection.close(); } catch (e) { console.error(e); }
        throw err;
    }
}

// ─── Excel HTML (.xls) ────────────────────────────────────────────────────────

function buildAssessmentExcelHtml(rows: AssessmentRow[], params: AssessmentParams): string {
    const reportDate  = formatDateStr(new Date());
    const generatedBy = text(params.loginid) || "Unknown User";

    const excelRows = rows.map((r, i) => `<tr style="background:#fafcfe">
          <td style="text-align:center">${i + 1}</td>
          <td style="font-weight:bold;color:#00378c">${escapeHtml(r.employee_code)}</td>
          <td>${escapeHtml(r.rpt_name)}</td>
          <td>${escapeHtml(r.desg_name)}</td>
          <td style="text-align:center">${ratingText(r.overall_rating)}</td>
          <td style="text-align:center">${escapeHtml(valueOrDash(r.assessment_scale))}</td>
          <td>${escapeHtml(valueOrDash(r.prom_recomend))}</td>
          <td>${escapeHtml(valueOrDash(r.title_grade))}</td>
        </tr>`).join("");

    return `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
<x:ExcelWorksheet><x:Name>Employee Assessment</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
  body  { font-family: Calibri, Arial, sans-serif; font-size: 10pt; color: #1e293b; }
  table { border-collapse: collapse; width: 100%; }
  th    { background: #00378c; color: #ffffff; font-weight: bold; padding: 8px 8px;
          border: 1px solid #00378c; font-size: 10pt; text-align: center; }
  td    { padding: 6px 8px; border: 1px solid #e2e8f0; font-size: 10pt; vertical-align: middle; }
  .meta-lbl { font-weight: bold; color: #475569; width: 110px; }
  .meta-val { color: #1e293b; }
</style>
</head>
<body>
<table style="border:none;width:auto;margin-bottom:6px">
  <tr><td style="border:none;font-size:16pt;font-weight:800;color:#172033;padding:0 0 2px 0" colspan="2">HR DEPARTMENT</td></tr>
  <tr><td style="border:none;font-size:13pt;font-weight:700;color:#00378c;padding:0 0 10px 0" colspan="2">Employee Assessment Report</td></tr>
  <tr><td class="meta-lbl" style="border:none">Period :</td>     <td class="meta-val" style="border:none"><b>${dateOrDash(params.date_from)} – ${dateOrDash(params.date_to)}</b></td></tr>
  <tr><td class="meta-lbl" style="border:none">Division :</td>   <td class="meta-val" style="border:none">${escapeHtml(params.division) || "All"}</td></tr>
  <tr><td class="meta-lbl" style="border:none">Department :</td> <td class="meta-val" style="border:none">${escapeHtml(params.department) || "All"}</td></tr>
  <tr><td class="meta-lbl" style="border:none">Section :</td>    <td class="meta-val" style="border:none">${escapeHtml(params.section) || "All"}</td></tr>
  <tr><td class="meta-lbl" style="border:none">Employee :</td>   <td class="meta-val" style="border:none">${escapeHtml(params.employee) || "All"}</td></tr>
  <tr><td class="meta-lbl" style="border:none">Emp. Type :</td>  <td class="meta-val" style="border:none">${params.emp_type === "A" ? "Active Employees" : "All Employees"}</td></tr>
  <tr><td class="meta-lbl" style="border:none">Printed on :</td> <td class="meta-val" style="border:none">${reportDate}</td></tr>
  <tr><td class="meta-lbl" style="border:none">User :</td>       <td class="meta-val" style="border:none">${escapeHtml(generatedBy)}</td></tr>
</table>
<br>
<table>
  <thead>
    <tr>
      <th style="width:30px">#</th>
      <th style="width:90px">Employee Code</th>
      <th style="min-width:160px">Employee Name</th>
      <th style="width:140px">Designation</th>
      <th style="width:80px">Overall Rating</th>
      <th style="width:110px">Assessment Scale</th>
      <th style="min-width:180px">Promotion Recommendation</th>
      <th style="min-width:180px">Title / Grade Recommendation</th>
    </tr>
  </thead>
  <tbody>
    ${excelRows || `<tr><td colspan="8" style="text-align:center;padding:20px;color:#64748b">${escapeHtml(NO_DATA_MESSAGE)}</td></tr>`}
  </tbody>
  <tfoot>
    <tr>
      <td colspan="8" style="padding:8px;font-weight:bold;text-align:right;background:#dbe4f0;border-top:1px solid #cbd5e1;color:#00378c">
        Total: ${rows.length} Records
      </td>
    </tr>
  </tfoot>
</table>
</body></html>`;
}

// ─── Layout CSS (same look as the Visa Expiry / Freight PDFs) ─────────────────

const ASSESSMENT_EXTRA_CSS = `
  @page { size: A4 landscape; margin: 6mm 12mm 12mm 12mm; }

  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    box-sizing: border-box;
  }

  html, body { width: 100%; max-width: 100%; overflow-x: hidden; }

  body::before,
  body::after { display: none !important; content: none !important; }

  .company-header {
    border-bottom: 2px solid #00378c;
    padding: 0 0 10px 0;
    margin: 0 0 8px 0;
  }
  .company-name       { font-size: 16px; font-weight: 700; color: #172033; margin: 0 0 2px 0; }
  .company-address    { font-size: 9.5px; line-height: 1.4; }
  .company-logo-wrap  { max-width: 180px; }
  .company-logo       { max-height: 56px; max-width: 180px; }

  h1.report-title {
    margin: 28px 0 14px 0;
    font-size: 18px;
    font-weight: 700;
    color: #00378c !important;
  }
  .applied-filters { font-size: 10.5px; margin-bottom: 28px; }

  table.data-table {
    width: 100%;
    table-layout: fixed;
    font-size: 10.5px;
    margin-top: 0;
    border-collapse: collapse;
  }
  table.data-table th,
  table.data-table td {
    overflow: visible;
    overflow-wrap: anywhere;
    word-break: break-word;
    white-space: normal !important;
    min-width: 0;
  }

  table.data-table .left   { text-align: left   !important; }
  table.data-table .center { text-align: center !important; }
  table.data-table .right  { text-align: right  !important; font-variant-numeric: tabular-nums; }

  table.data-table thead tr th {
    background: #00378c !important;
    color: #ffffff !important;
    font-weight: 700;
    font-size: 10.5px;
    padding: 12px 6px;
    border: 0 !important;
    text-transform: none;
    white-space: normal !important;
  }

  table.data-table tbody tr.data-row td {
    background: #fafcfe !important;
    font-size: 10.5px;
    font-weight: 400;
    padding: 9px 6px;
    border-bottom: 1px solid #e2e8f0 !important;
    color: #1e293b;
    vertical-align: middle;
    white-space: normal !important;
  }
  table.data-table tbody tr.data-row td.nw {
    white-space: nowrap !important;
    font-variant-numeric: tabular-nums;
  }
  table.data-table tbody tr.data-row td.primary-text { color: #00378c; font-weight: 700; }

  table.data-table tbody tr.grand-total-row td {
    background: #dbe4f0 !important;
    color: #00378c !important;
    font-weight: 700;
    font-size: 10.5px;
    padding: 9px 8px;
    text-align: right;
    border-bottom: 1px solid #cbd5e1 !important;
  }

  table.data-table tbody tr.empty-row td {
    padding: 20px;
    text-align: center;
    color: #64748b;
    background: #fafcfe !important;
  }

  .report-footer {
    width: 100% !important;
    max-width: 100% !important;
    padding-right: 2px;
    font-size: 9px;
    overflow: visible !important;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .report-footer * { max-width: 100%; }

  @media print {
    table.data-table thead { display: table-header-group; }
    table.data-table tr { break-inside: avoid; page-break-inside: avoid; }
    .report-footer { font-size: 9px; }
  }
`;

// ─── Body ─────────────────────────────────────────────────────────────────────

// % widths – add up to 100
const COL_WIDTHS = [10, 20, 17, 8, 12, 17, 16];

function renderAssessmentBody(rows: AssessmentRow[], params: AssessmentParams): string {
    let tableRows = rows.map((r) => `
        <tr class="data-row">
          <td class="left nw primary-text">${escapeHtml(r.employee_code)}</td>
          <td class="left">${escapeHtml(r.rpt_name)}</td>
          <td class="left">${escapeHtml(r.desg_name)}</td>
          <td class="center nw">${escapeHtml(ratingText(r.overall_rating))}</td>
          <td class="center">${escapeHtml(valueOrDash(r.assessment_scale))}</td>
          <td class="left">${escapeHtml(valueOrDash(r.prom_recomend))}</td>
          <td class="left">${escapeHtml(valueOrDash(r.title_grade))}</td>
        </tr>`).join("");

    if (!rows.length) {
        tableRows = `<tr class="empty-row"><td colspan="7">${escapeHtml(NO_DATA_MESSAGE)}</td></tr>`;
    } else {
        tableRows += `
        <tr class="grand-total-row">
          <td colspan="7">Total: ${rows.length} Records</td>
        </tr>`;
    }

    const filtersHtml = reportAppliedFilters([
        { label: "Period",     value: `${dateOrDash(params.date_from)} – ${dateOrDash(params.date_to)}` },
        { label: "Division",   value: params.division   || "All" },
        { label: "Department", value: params.department || "All" },
        { label: "Section",    value: params.section    || "All" },
        { label: "Employee",   value: params.employee   || "All" },
        { label: "Emp. Type",  value: params.emp_type === "A" ? "Active Employees" : "All Employees" },
    ]);

    const colgroup = COL_WIDTHS.map((w) => `<col style="width:${w}%"/>`).join("");

    return `
    <h1 class="report-title">Employee Assessment Report</h1>
    ${filtersHtml}

    <table class="data-table">
      <colgroup>${colgroup}</colgroup>
      <thead>
        <tr>
          <th class="left">Employee Code</th>
          <th class="left">Employee Name</th>
          <th class="left">Designation</th>
          <th class="center">Overall Rating</th>
          <th class="center">Assessment Scale</th>
          <th class="left">Promotion Recommendation</th>
          <th class="left">Title / Grade Recommendation</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  `;
}

// ─── HTML Controller ──────────────────────────────────────────────────────────

export const getEmployeeAssessmentReport = async (req: RequestWithUser, res: Response): Promise<void> => {
    let connection: any;
    try {
        const { rows, connection: conn } = await fetchAssessmentRows(req.body);
        connection = conn;

        const params      = resolveParams(req.body);
        const companyCode = params.companyCode || req.user?.company_code || "";

        const printed    = new Date().toLocaleString("en-US");
        const headerHtml = await reportHeader({ company_code: companyCode, req });
        const bodyHtml   = renderAssessmentBody(rows, params);
        const footerHtml = reportFooter({
            reportName: "Employee Assessment Report",
            userName:   params.loginid,
            endLabel:   "Powered by Bayanat Technology",
            extraLeft:  `Print: ${escapeHtml(printed)} | User: ${escapeHtml(params.loginid)}`,
        });

        const html = buildReportDocument({
            title: "Employee Assessment Report",
            headerHtml,
            bodyHtml,
            footerHtml,
            extraCss: ASSESSMENT_EXTRA_CSS,
            autoPrint: req.query.print !== "false",
            showPrintButton: true,
            fontMode: "native",
        });

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.status(200).send(html);
    } catch (error: any) {
        console.error("Employee Assessment Report Error:", error);
        res.status(500).json({ success: false, message: "Unable to generate report", details: error.message });
    } finally {
        if (connection) try { await connection.close(); } catch (e) { console.error(e); }
    }
};

// ─── Excel Controller ─────────────────────────────────────────────────────────

export const exportEmployeeAssessmentReportExcel = async (req: Request, res: Response): Promise<void> => {
    let connection: any;
    try {
        const { rows, connection: conn } = await fetchAssessmentRows(req.body);
        connection = conn;

        if (!rows.length) {
            res.status(200).json({ success: false, message: "No data found for the selected criteria." });
            return;
        }

        const excelHtml = buildAssessmentExcelHtml(rows, resolveParams(req.body));

        res.setHeader("Content-Type", "application/vnd.ms-excel");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="EmployeeAssessmentReport_${new Date().toISOString().slice(0, 10)}.xls"`
        );
        res.status(200).send(excelHtml);
    } catch (error: any) {
        console.error("Employee Assessment Report Excel Error:", error);
        res.status(500).json({ success: false, message: "Unable to export report", details: error.message });
    } finally {
        if (connection) try { await connection.close(); } catch (e) { console.error(e); }
    }
};