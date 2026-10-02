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
    FREIGHT_COLORS as C,
} from "../../common/report_common";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const text = (v: any): string => (v == null ? "" : String(v));

const formatDateStr = (v: any): string => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-GB");
};

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

// ─── Excel HTML (standalone .xls export – own self-contained styling) ────────

function buildVisaExpiryExcelHtml(rows: VisaRow[], params: VisaReportParams): string {
    const reportDate  = formatDateStr(new Date());
    const generatedBy = text(params.loginid) || "Unknown User";

    let totalExpired  = 0;
    let totalExpiring = 0;
    let totalValid    = 0;

    const excelRows = rows.map((r, i) => {
        const daysNum = Number(r.days_remaining);
        const bgColor = daysNum < 0 ? "#FFF5F5" : daysNum <= 30 ? "#FFFDF0" : "#FFFFFF";
        const dayColor = daysNum < 0 ? "color:#C00000;font-weight:bold" : daysNum <= 30 ? "color:#B45309;font-weight:bold" : "";
        if (daysNum < 0) totalExpired++;
        else if (daysNum <= 30) totalExpiring++;
        else totalValid++;

        return `<tr style="background:${bgColor}">
          <td style="text-align:center">${i + 1}</td>
          <td style="font-weight:bold">${escapeHtml(r.employee_code)}</td>
          <td>${escapeHtml(r.rpt_name)}</td>
          <td>${escapeHtml(r.dept_name)}</td>
          <td style="text-align:center">${escapeHtml(r.div_name)}</td>
          <td>${escapeHtml(r.section_name)}</td>
          <td>${escapeHtml(r.desg_name)}</td>
          <td>${escapeHtml(r.sponsor_name)}</td>
          <td style="text-align:center">${formatDateStr(r.visa_valid_from)}</td>
          <td style="text-align:center;${dayColor}">${formatDateStr(r.visa_valid_to)}</td>
          <td style="text-align:center;${dayColor}">${daysNum}</td>
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
  body  { font-family: Calibri, Arial, sans-serif; font-size: 10pt; }
  table { border-collapse: collapse; width: 100%; }
  th    { background: #1e3a8a; color: #ffffff; font-weight: bold; padding: 7px 8px;
          border: 1px solid #1e3a8a; font-size: 9pt; text-align: center; }
  td    { padding: 6px 8px; border: 1px solid #d1d5db; font-size: 10pt; vertical-align: middle; }
  .meta-lbl { font-weight: bold; color: #475569; width: 110px; }
  .meta-val { color: #1e293b; }
</style>
</head>
<body>
<table style="border:none;width:auto;margin-bottom:6px">
  <tr><td style="border:none;font-size:16pt;font-weight:800;color:#1e3a8a;padding:0 0 2px 0" colspan="2">AL MADINA LOGISTICS</td></tr>
  <tr><td style="border:none;font-size:13pt;font-weight:700;color:#1e293b;padding:0 0 10px 0" colspan="2">Visa Expiry Listing Report</td></tr>
  <tr><td class="meta-lbl" style="border:none">Period :</td>       <td class="meta-val" style="border:none"><b>${formatDateStr(params.date_from)} – ${formatDateStr(params.date_to)}</b></td></tr>
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
      <th style="width:70px">Division</th>
      <th style="width:80px">Section</th>
      <th style="width:120px">Designation</th>
      <th style="width:110px">Sponsor</th>
      <th style="width:80px">Visa From</th>
      <th style="width:80px">Visa To</th>
      <th style="width:65px">Days Rem.</th>
    </tr>
  </thead>
  <tbody>
    ${excelRows || `<tr><td colspan="11" style="text-align:center;padding:20px;color:#94a3b8">No records found.</td></tr>`}
  </tbody>
  <tfoot>
    <tr>
      <td colspan="11" style="padding:8px;font-weight:bold;background:#f1f5f9;border-top:2px solid #1e3a8a;color:#1e293b">
        Total Records: ${rows.length} &nbsp;|&nbsp;
        <span style="color:#C00000">Expired: ${totalExpired}</span> &nbsp;|&nbsp;
        <span style="color:#B45309">Expiring Soon: ${totalExpiring}</span> &nbsp;|&nbsp;
        <span style="color:#15803d">Valid: ${totalValid}</span>
      </td>
    </tr>
  </tfoot>
</table>
</body></html>`;
}

// ─── Report-only CSS (only what report_common does NOT already provide) ──────
// Header, footer, title, applied-filters, data-table, .center/.strong/.muted
// all come from report_common – nothing is overridden here.

const VISA_EXTRA_CSS = `
  /* Landscape – 11 columns. Common @page margins/page-number are kept. */
  @page { size: A4 landscape; margin: 8mm 10mm 12mm 10mm; }

  /* Common .paper is 210mm (portrait) – widen for landscape preview */
  .paper { max-width: 297mm; }

  /* Compact – must fit BOTH portrait (194mm) and landscape (277mm) */
  table.data-table.visa-table { table-layout: fixed; }
  table.data-table.visa-table th {
    font-size: 9px;
    padding: 6px 3px;
    white-space: nowrap;
    overflow: hidden;
  }
  table.data-table.visa-table td {
    font-size: 9px;
    padding: 5px 3px;
    overflow: hidden;
    overflow-wrap: break-word;
    word-break: break-word;
  }
  /* codes / dates / numbers never wrap or spill into next column */
  table.data-table.visa-table td.nw,
  .mono { white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.data-table.visa-table td.nw { text-overflow: clip; }

  /* Row highlighting (beats zebra rows on screen + print) */
  table.data-table tbody tr.row-exp  td { background: #fff5f5 !important; }
  table.data-table tbody tr.row-warn td { background: #fffbeb !important; }
  .days-exp  { color: #c00000; font-weight: 800; }
  .days-warn { color: #b45309; font-weight: 800; }

  /* Summary bar */
  .summary-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
    margin-top: 10px;
    padding: 7px 10px;
    background: ${C.subtotalBg};
    border-top: 2px solid ${C.navy};
    color: ${C.navy};
    font-weight: 800;
    break-inside: avoid;
  }
  .summary-bar .dot-exp  { color: #c00000; }
  .summary-bar .dot-warn { color: #b45309; }
  .summary-bar .dot-ok   { color: #15803d; }

  @media print {
    table.data-table.visa-table thead { display: table-header-group; }
  }
`;

// ─── Body ─────────────────────────────────────────────────────────────────────

function renderVisaBody(rows: VisaRow[], params: VisaReportParams): string {
    let totalExpired  = 0;
    let totalExpiring = 0;
    let totalValid    = 0;

    const tableRows = rows.map((r, i) => {
        const daysNum = Number(r.days_remaining);
        let rowCls = "";
        let daysCls = "";
        if (daysNum < 0)        { totalExpired++;  rowCls = "row-exp";  daysCls = "days-exp";  }
        else if (daysNum <= 30) { totalExpiring++; rowCls = "row-warn"; daysCls = "days-warn"; }
        else                    { totalValid++; }

        return `
        <tr class="${rowCls}">
          <td class="center">${i + 1}</td>
          <td class="strong nw">${escapeHtml(r.employee_code)}</td>
          <td>${escapeHtml(r.rpt_name)}</td>
          <td>${escapeHtml(r.dept_name)}</td>
          <td class="center">${escapeHtml(r.div_name)}</td>
          <td>${escapeHtml(r.section_name)}</td>
          <td>${escapeHtml(r.desg_name)}</td>
          <td>${escapeHtml(r.sponsor_name)}</td>
          <td class="center mono">${escapeHtml(formatDateStr(r.visa_valid_from))}</td>
          <td class="center mono ${daysCls}">${escapeHtml(formatDateStr(r.visa_valid_to))}</td>
          <td class="center mono ${daysCls}">${Number.isNaN(daysNum) ? "" : daysNum}</td>
        </tr>`;
    }).join("") || `<tr><td colspan="11" class="center muted">No records found.</td></tr>`;

    const filtersHtml = reportAppliedFilters([
        { label: "Period",     value: `${formatDateStr(params.date_from)} – ${formatDateStr(params.date_to)}` },
        { label: "Division",   value: params.division   || "All" },
        { label: "Department", value: params.department || "All" },
        { label: "Emp. Type",  value: params.emp_type === "A" ? "Active Employees" : "All Employees" },
    ]);

    return `
    <div class="doc-title-row">
      <h1>Visa Expiry Listing Report</h1>
    </div>
    ${filtersHtml}

    <table class="data-table visa-table">
      <colgroup>
        <col style="width:3%"/>
        <col style="width:10%"/>
        <col style="width:15%"/>
        <col style="width:11%"/>
        <col style="width:7%"/>
        <col style="width:9%"/>
        <col style="width:12%"/>
        <col style="width:10%"/>
        <col style="width:8.5%"/>
        <col style="width:8.5%"/>
        <col style="width:6%"/>
      </colgroup>
      <thead>
        <tr>
          <th class="center">#</th>
          <th>Emp. Code</th>
          <th>Employee Name</th>
          <th>Department</th>
          <th class="center">Division</th>
          <th>Section</th>
          <th>Designation</th>
          <th>Sponsor</th>
          <th class="center">Visa From</th>
          <th class="center">Visa To</th>
          <th class="center">Days</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>

    <div class="summary-bar">
      <span>Total Records: ${rows.length}</span>
      <span class="dot-exp">&#9679; Expired: ${totalExpired}</span>
      <span class="dot-warn">&#9679; Expiring Soon: ${totalExpiring}</span>
      <span class="dot-ok">&#9679; Valid: ${totalValid}</span>
    </div>
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

export const getVisaExpiryReport = async (req: RequestWithUser, res: Response): Promise<void> => {
    let connection: any;
    try {
        const { rows, connection: conn } = await fetchVisaRows(req.body);
        connection = conn;

        if (!rows.length) {
            res.status(200).json({ success: false, message: "No data found for the selected criteria." });
            return;
        }

        const params = resolveParams(req.body);
        const companyCode = params.companyCode || req.user?.company_code || "";

        const headerHtml = await reportHeader({ company_code: companyCode, req });
        const bodyHtml = renderVisaBody(rows, params);
        const footerHtml = reportFooter({
            reportName: "Visa Expiry Listing Report",
            userName: params.loginid,
            endLabel: "Powered by Bayanat Technology",
        });

        const html = buildReportDocument({
            title: "Visa Expiry Listing Report",
            headerHtml,
            bodyHtml,
            footerHtml,
            extraCss: VISA_EXTRA_CSS,
            autoPrint: req.query.print !== "false",
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