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

const text = (v: any): string => (v == null ? "" : String(v));

// Empty / placeholder dates (null, 01/01/1970 epoch) show as a dash
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface VisaRow {
    employee_code:   string;
    rpt_name:        string;
    div_name:        string;
    dept_name:       string;
    section_name:    string;
    desg_name:       string;
    sponsor_name:    string;
    visa_valid_from: string;
    visa_valid_to:   string;
    days_remaining:  number;
}

interface VisaReportParams {
    parameter:   string;
    loginid:     string;
    companyCode: string;
    division:    string;
    department:  string;
    date_from:   string;
    date_to:     string;
    emp_type:    string;
}

// ─── Shared: fetch rows from DB ───────────────────────────────────────────────

async function fetchVisaRows(body: any): Promise<{ rows: VisaRow[]; connection: any }> {
    const {
        parameter, loginid,
        code1, code2, code3, code4, code5,
        code6, code7, code8, code9,
        date1, date2,
    } = body;

    let tenantId = getCurrentTenantId();
    if (!tenantId && loginid) tenantId = await TenantManager.getTenantForUser(loginid);
    if (!tenantId) throw new Error("Tenant not found");

    const connection = await TenantManager.getConnection(tenantId);

    try {
        const binds: any = {
            parameter: parameter || "Hr_Report_VISA_EXPIRY_REPORT",
            loginid:   loginid   || "ADMIN",
            code1: code1 || null, code2: code2 || null, code3: code3 || null,
            code4: code4 || null, code5: code5 || null, code6: code6 || null,
            code7: code7 || null, code8: code8 || null, code9: code9 || null,
            out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
        };

        for (let i = 10; i <= 20; i++) binds[`code${i}`] = body[`code${i}`] || null;
        for (let i = 1;  i <= 4;  i++) binds[`number${i}`] = body[`number${i}`] || null;

        binds["date1"] = date1 ? new Date(date1) : null;
        binds["date2"] = date2 ? new Date(date2) : null;
        binds["date3"] = body["date3"] || null;
        binds["date4"] = body["date4"] || null;

        const result = await connection.execute(
            `DECLARE v_sql VARCHAR2(32767);
             BEGIN
               PROC_BUILD_DYNAMIC_SQL_COMMON20(
                 :parameter, :loginid,
                 :code1,:code2,:code3,:code4,:code5,:code6,:code7,:code8,:code9,:code10,
                 :code11,:code12,:code13,:code14,:code15,:code16,:code17,:code18,:code19,:code20,
                 :number1,:number2,:number3,:number4,
                 :date1,:date2,:date3,:date4,
                 v_sql
               );
               :out_sql := v_sql;
             END;`,
            binds
        );

        const rawSql = (result.outBinds as any).out_sql;
        console.log("[VisaExpiryReport] Generated SQL:", rawSql);
        if (!rawSql) throw new Error("PROC_BUILD_DYNAMIC_SQL_COMMON20 returned no SQL.");

        const dataResult = await connection.execute(rawSql, [], {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
        });

        const rows: VisaRow[] = (dataResult.rows as any[]).map((row) =>
            Object.keys(row).reduce((acc: any, key) => {
                acc[key.toLowerCase()] = row[key];
                return acc;
            }, {})
        );

        return { rows, connection };
    } catch (err) {
        // close here – caller never receives the connection when we throw
        try { await connection.close(); } catch (e) { console.error(e); }
        throw err;
    }
}

// ─── Excel HTML (standalone .xls export – same colours as the PDF) ───────────

function buildVisaExpiryExcelHtml(rows: VisaRow[], params: VisaReportParams): string {
    const reportDate  = formatDateStr(new Date());
    const generatedBy = text(params.loginid) || "Unknown User";

    let totalExpired  = 0;
    let totalExpiring = 0;
    let totalValid    = 0;

    const excelRows = rows.map((r, i) => {
        const daysNum = Number(r.days_remaining);
        // Same as Freight: every row uses the same background (#fafcfe)
        const dayColor = daysNum < 0
            ? "color:#b91c1c;font-weight:bold"
            : daysNum <= 30
                ? "color:#b45309;font-weight:bold"
                : "";
        if (daysNum < 0) totalExpired++;
        else if (daysNum <= 30) totalExpiring++;
        else totalValid++;

        return `<tr style="background:#fafcfe">
          <td style="text-align:center">${i + 1}</td>
          <td style="font-weight:bold;color:#00378c">${escapeHtml(r.employee_code)}</td>
          <td>${escapeHtml(r.rpt_name)}</td>
          <td>${escapeHtml(r.dept_name)}</td>
          <td>${escapeHtml(r.div_name)}</td>
          <td>${escapeHtml(r.section_name)}</td>
          <td>${escapeHtml(r.desg_name)}</td>
          <td>${escapeHtml(r.sponsor_name)}</td>
          <td style="text-align:center">${dateOrDash(r.visa_valid_from)}</td>
          <td style="text-align:center;${dayColor}">${dateOrDash(r.visa_valid_to)}</td>
          <td style="text-align:center;${dayColor}">${Number.isNaN(daysNum) ? DASH : daysNum}</td>
        </tr>`;
    }).join("");

    return `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
<x:ExcelWorksheet><x:Name>Visa Expiry Report</x:Name>
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
  <tr><td style="border:none;font-size:16pt;font-weight:800;color:#172033;padding:0 0 2px 0" colspan="2">AL MADINA LOGISTICS</td></tr>
  <tr><td style="border:none;font-size:13pt;font-weight:700;color:#00378c;padding:0 0 10px 0" colspan="2">Visa Expiry Listing Report</td></tr>
  <tr><td class="meta-lbl" style="border:none">Period :</td>       <td class="meta-val" style="border:none"><b>${dateOrDash(params.date_from)} – ${dateOrDash(params.date_to)}</b></td></tr>
  <tr><td class="meta-lbl" style="border:none">Division :</td>     <td class="meta-val" style="border:none">${escapeHtml(params.division) || "All"}</td></tr>
  <tr><td class="meta-lbl" style="border:none">Department :</td>   <td class="meta-val" style="border:none">${escapeHtml(params.department) || "All"}</td></tr>
  <tr><td class="meta-lbl" style="border:none">Emp. Type :</td>    <td class="meta-val" style="border:none">${params.emp_type === "A" ? "Active Employees" : "All Employees"}</td></tr>
  <tr><td class="meta-lbl" style="border:none">Printed on :</td>   <td class="meta-val" style="border:none">${reportDate}</td></tr>
  <tr><td class="meta-lbl" style="border:none">User :</td>         <td class="meta-val" style="border:none">${escapeHtml(generatedBy)}</td></tr>
</table>
<br>
<table>
  <thead>
    <tr>
      <th style="width:30px">#</th>
      <th style="width:90px">Emp. Code</th>
      <th style="min-width:140px">Employee Name</th>
      <th style="width:100px">Department</th>
      <th style="width:100px">Division</th>
      <th style="width:80px">Section</th>
      <th style="width:120px">Designation</th>
      <th style="width:110px">Sponsor</th>
      <th style="width:80px">Visa From</th>
      <th style="width:80px">Visa To</th>
      <th style="width:65px">Days</th>
    </tr>
  </thead>
  <tbody>
    ${excelRows || `<tr><td colspan="11" style="text-align:center;padding:20px;color:#64748b">${escapeHtml(NO_DATA_MESSAGE)}</td></tr>`}
  </tbody>
  <tfoot>
    <tr>
      <td colspan="11" style="padding:8px;font-weight:bold;text-align:right;background:#dbe4f0;border-top:1px solid #cbd5e1;color:#00378c">
        Total: ${rows.length} Records &nbsp;|&nbsp;
        <span style="color:#b91c1c">Expired: ${totalExpired}</span> &nbsp;|&nbsp;
        <span style="color:#b45309">Expiring Soon: ${totalExpiring}</span> &nbsp;|&nbsp;
        <span style="color:#15803d">Valid: ${totalValid}</span>
      </td>
    </tr>
  </tfoot>
</table>
</body></html>`;
}

// ─── Layout CSS – identical to the Freight "Enquiry List" PDF ────────────────
// Sizes: company 16px, title 18px, filter strip 10.5px, table text 10.5px, footer 9px.
// Colours: navy #00378c header, #eaf0f8 strips, #fafcfe rows (ALL rows same, no tint),
//          #e2e8f0 row lines, #dbe4f0 total row.
// Used with fontMode: "native".

const VISA_EXTRA_CSS = `
  @page { size: A4 landscape; margin: 6mm 12mm 12mm 12mm; }

  /* Make Chrome print background colors */
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    box-sizing: border-box;
  }

  html, body { width: 100%; max-width: 100%; overflow-x: hidden; }

  /* No page border (screen + print) – same as Freight */
  body::before,
  body::after { display: none !important; content: none !important; }

  /* Letterhead – navy rule under the header */
  .company-header {
    border-bottom: 2px solid #00378c;
    padding: 0 0 10px 0;
    margin: 0 0 8px 0;
  }
  .company-name       { font-size: 16px; font-weight: 700; color: #172033; margin: 0 0 2px 0; }
  .company-address    { font-size: 9.5px; line-height: 1.4; }
  .company-logo-wrap  { max-width: 180px; }
  .company-logo       { max-height: 56px; max-width: 180px; }

  /* Title + filter strip */
  h1.report-title {
    margin: 28px 0 14px 0;
    font-size: 18px;
    font-weight: 700;
    color: #00378c !important;
  }
  .applied-filters { font-size: 10.5px; margin-bottom: 28px; }

  /* Data table */
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
    white-space: normal !important;   /* wrap long text INSIDE its own column */
    min-width: 0;
  }

  table.data-table .left   { text-align: left   !important; }
  table.data-table .center { text-align: center !important; }
  table.data-table .right  { text-align: right  !important; font-variant-numeric: tabular-nums; }

  /* Header: solid navy bar, white bold text */
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

  /* Data rows – every row same colour (like Freight) */
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
  /* Codes / dates / numbers stay on one line */
  table.data-table tbody tr.data-row td.nw {
    white-space: nowrap !important;
    font-variant-numeric: tabular-nums;
  }
  table.data-table tbody tr.data-row td.primary-text { color: #00378c; font-weight: 700; }

  /* Status shown ONLY by text colour (no row background tint) */
  table.data-table tbody td.days-exp  { color: #b91c1c !important; font-weight: 700; }
  table.data-table tbody td.days-warn { color: #b45309 !important; font-weight: 700; }

  /* Total row – shaded, bold navy, right aligned (same as Enquiry "Total: n Records") */
  table.data-table tbody tr.grand-total-row td {
    background: #dbe4f0 !important;
    color: #00378c !important;
    font-weight: 700;
    font-size: 10.5px;
    padding: 9px 8px;
    text-align: right;
    border-bottom: 1px solid #cbd5e1 !important;
  }
  .grand-total-row .t-exp  { color: #b91c1c; }
  .grand-total-row .t-warn { color: #b45309; }
  .grand-total-row .t-ok   { color: #15803d; }
  .grand-total-row .t-sep  { color: #94a3b8; font-weight: 400; padding: 0 6px; }

  /* Empty state */
  table.data-table tbody tr.empty-row td {
    padding: 20px;
    text-align: center;
    color: #64748b;
    background: #fafcfe !important;
  }

  /* Footer – keep fully inside the page (fixes "Powered by Bayanat Technolog" cut) */
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

// % widths – add up to 100. Sized so the 10 columns also fit portrait without cut text.
const COL_WIDTHS = [11.5, 12, 11, 9, 9, 12, 9, 10.3, 10.3, 5.9];

function renderVisaBody(rows: VisaRow[], params: VisaReportParams): string {
    let totalExpired  = 0;
    let totalExpiring = 0;
    let totalValid    = 0;

    let tableRows = rows.map((r) => {
        const daysNum = Number(r.days_remaining);
        let daysCls = "";
        if (daysNum < 0)        { totalExpired++;  daysCls = "days-exp";  }
        else if (daysNum <= 30) { totalExpiring++; daysCls = "days-warn"; }
        else                    { totalValid++; }

        return `
        <tr class="data-row">
          <td class="left nw primary-text">${escapeHtml(r.employee_code)}</td>
          <td class="left">${escapeHtml(r.rpt_name)}</td>
          <td class="left">${escapeHtml(r.dept_name)}</td>
          <td class="left">${escapeHtml(r.div_name)}</td>
          <td class="left">${escapeHtml(r.section_name)}</td>
          <td class="left">${escapeHtml(r.desg_name)}</td>
          <td class="left">${escapeHtml(r.sponsor_name)}</td>
          <td class="center nw">${escapeHtml(dateOrDash(r.visa_valid_from))}</td>
          <td class="center nw ${daysCls}">${escapeHtml(dateOrDash(r.visa_valid_to))}</td>
          <td class="center nw ${daysCls}">${Number.isNaN(daysNum) ? DASH : daysNum}</td>
        </tr>`;
    }).join("");

    if (!rows.length) {
        tableRows = `<tr class="empty-row"><td colspan="10">${escapeHtml(NO_DATA_MESSAGE)}</td></tr>`;
    } else {
        const sep = `<span class="t-sep">|</span>`;
        tableRows += `
        <tr class="grand-total-row">
          <td colspan="10">
            Total: ${rows.length} Records ${sep}
            <span class="t-exp">Expired: ${totalExpired}</span> ${sep}
            <span class="t-warn">Expiring Soon: ${totalExpiring}</span> ${sep}
            <span class="t-ok">Valid: ${totalValid}</span>
          </td>
        </tr>`;
    }

    const filtersHtml = reportAppliedFilters([
        { label: "Period",     value: `${dateOrDash(params.date_from)} – ${dateOrDash(params.date_to)}` },
        { label: "Division",   value: params.division   || "All" },
        { label: "Department", value: params.department || "All" },
        { label: "Emp. Type",  value: params.emp_type === "A" ? "Active Employees" : "All Employees" },
    ]);

    const colgroup = COL_WIDTHS.map((w) => `<col style="width:${w}%"/>`).join("");

    return `
    <h1 class="report-title">Visa Expiry Listing Report</h1>
    ${filtersHtml}

    <table class="data-table">
      <colgroup>${colgroup}</colgroup>
      <thead>
        <tr>
          <th class="left">Emp. Code</th>
          <th class="left">Employee Name</th>
          <th class="left">Department</th>
          <th class="left">Division</th>
          <th class="left">Section</th>
          <th class="left">Designation</th>
          <th class="left">Sponsor</th>
          <th class="center">Visa From</th>
          <th class="center">Visa To</th>
          <th class="center">Days</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  `;
}

// ─── Resolve request body into VisaReportParams ──────────────────────────────

function resolveParams(body: any): VisaReportParams {
    const { parameter, loginid, company_code, code1, code2, code3, date1, date2, code9 } = body;
    return {
        parameter:   parameter || "Hr_Report_VISA_EXPIRY_REPORT",
        loginid:     loginid   || "ADMIN",
        companyCode: text(company_code || code1),
        division:    code2     || "",
        department:  code3     || "",
        date_from:   date1     || "",
        date_to:     date2     || "",
        emp_type:    code9     || "A",
    };
}

// ─── HTML Controller ──────────────────────────────────────────────────────────
// No rows is NOT an error: the report still renders and the table shows
// "No records found for the selected criteria." (same as DN Summary).

export const getVisaExpiryReport = async (req: RequestWithUser, res: Response): Promise<void> => {
    let connection: any;
    try {
        const { rows, connection: conn } = await fetchVisaRows(req.body);
        connection = conn;

        const params = resolveParams(req.body);
        const companyCode = params.companyCode || req.user?.company_code || "";

        const printed    = new Date().toLocaleString("en-US");
        const headerHtml = await reportHeader({ company_code: companyCode, req });
        const bodyHtml   = renderVisaBody(rows, params);
        const footerHtml = reportFooter({
            reportName: "Visa Expiry Listing Report",
            userName:   params.loginid,
            endLabel:   "Powered by Bayanat Technology",
            extraLeft:  `Print: ${escapeHtml(printed)} | User: ${escapeHtml(params.loginid)}`,
        });

        const html = buildReportDocument({
            title: "Visa Expiry Listing Report",
            headerHtml,
            bodyHtml,
            footerHtml,
            extraCss: VISA_EXTRA_CSS,
            autoPrint: req.query.print !== "false",
            showPrintButton: true,
            fontMode: "native",
        });

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.status(200).send(html);

    } catch (error: any) {
        console.error("Visa Expiry Report Error:", error);
        res.status(500).json({ success: false, message: "Unable to generate report", details: error.message });
    } finally {
        if (connection) try { await connection.close(); } catch (e) { console.error(e); }
    }
};

// ─── Excel Controller ─────────────────────────────────────────────────────────

export const exportVisaExpiryReportExcel = async (req: Request, res: Response): Promise<void> => {
    let connection: any;
    try {
        const { rows, connection: conn } = await fetchVisaRows(req.body);
        connection = conn;

        // Nothing to export -> friendly message, no file (same as DN Summary Excel)
        if (!rows.length) {
            res.status(200).json({ success: false, message: "No data found for the selected criteria." });
            return;
        }

        const excelHtml = buildVisaExpiryExcelHtml(rows, resolveParams(req.body));

        res.setHeader("Content-Type", "application/vnd.ms-excel");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="VisaExpiryReport_${new Date().toISOString().slice(0, 10)}.xls"`
        );
        res.status(200).send(excelHtml);

    } catch (error: any) {
        console.error("Visa Expiry Report Excel Error:", error);
        res.status(500).json({ success: false, message: "Unable to export report", details: error.message });
    } finally {
        if (connection) try { await connection.close(); } catch (e) { console.error(e); }
    }
};