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
const REPORT_CODE = "rpt_hr_emp_resumption";
const REPORT_TITLE = "Employees Leave Resumption Report";

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
const days = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1));

// ─── Types ────────────────────────────────────────────────────────────────────

interface ResumptionRow {
    employee_code: string;
    rpt_name: string;
    div_code: string;
    div_name: string;
    dept_code: string;
    dept_name: string;
    section_code: string;
    section_name: string;
    leave_no: string;
    leave_type: string;
    leave_type_desc: string;
    reason: string;
    start_date: any;
    end_date: any;
    leave_days: number;
    resume_date: any;
    resume_approved: string;
    resume_approved_by: string;
}

interface ResumptionParams {
    loginid: string;
    companyCode: string;
    division: string;      // comma separated codes or "" (= All)
    department: string;
    section: string;
    employeeCode: string;
    leaveFrom: string;     // YYYY-MM-DD or ""
    leaveTo: string;
    resumeFrom: string;
    resumeTo: string;
}

// ─── Resolve request body ─────────────────────────────────────────────────────
// code1 company, code2 division, code3 department, code4 section, code5 employee code(s)
// date1/date2 = Leave From / To, date3/date4 = Leave Resume From / To  (YYYY-MM-DD)

const csvOrEmpty = (v: any): string => {
    const s = text(v).trim();
    return !s || s.toLowerCase() === "all" ? "" : s;
};

function resolveParams(body: any): ResumptionParams {
    const { loginid, company_code, code1, code2, code3, code4, code5, date1, date2, date3, date4 } = body;
    return {
        loginid:      loginid || "ADMIN",
        companyCode:  text(company_code || code1),
        division:     csvOrEmpty(code2),
        department:   csvOrEmpty(code3),
        section:      csvOrEmpty(code4),
        employeeCode: csvOrEmpty(code5),
        leaveFrom:    text(date1).slice(0, 10),
        leaveTo:      text(date2).slice(0, 10),
        resumeFrom:   text(date3).slice(0, 10),
        resumeTo:     text(date4).slice(0, 10),
    };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const titleLine = (p: ResumptionParams) => `${REPORT_TITLE} ( Division : ${p.division || ALL} )`;

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

/**
 * Inclusive date range on a column: col >= from AND col < to + 1 day.
 * Empty from/to (UI shows 00/00/0000) = no restriction on that side.
 */
function addDateRange(
    col: string, from: string, to: string, prefix: string,
    binds: Record<string, any>, where: string[]
) {
    if (from) {
        binds[`${prefix}_from`] = from;
        where.push(`${col} >= TO_DATE(:${prefix}_from, 'YYYY-MM-DD')`);
    }
    if (to) {
        binds[`${prefix}_to`] = to;
        where.push(`${col} < TO_DATE(:${prefix}_to, 'YYYY-MM-DD') + 1`);
    }
}

// ─── Fetch rows ───────────────────────────────────────────────────────────────

async function fetchRows(body: any): Promise<{ rows: ResumptionRow[]; connection: any }> {
    const p = resolveParams(body);

    let tenantId = getCurrentTenantId();
    if (!tenantId && p.loginid) tenantId = await TenantManager.getTenantForUser(p.loginid);
    if (!tenantId) throw new Error("Tenant not found");

    [p.leaveFrom, p.leaveTo, p.resumeFrom, p.resumeTo].forEach((d) => {
        if (d && !ISO_DATE.test(d)) throw new Error("Invalid date.");
    });

    const connection = await TenantManager.getConnection(tenantId);

    try {
        const binds: Record<string, any> = {};
        const where: string[] = [
            "D.HDR_LVE_SLNO = H.HDR_LVE_SLNO",
            "H.COMPANY_CODE = V.COMPANY_CODE",
            "V.HDR_LVE_SLNO = H.HDR_LVE_SLNO",
            "V.EMPLOYEE_ID  = H.EMPLOYEE_ID",
            "H.COMPANY_CODE = D.COMPANY_CODE",
            "D.EMPLOYEE_ID  = H.EMPLOYEE_ID",
            "T.COMPANY_CODE = D.COMPANY_CODE",
            "T.LEAVE_TYPE   = D.LEAVE_TYPE",
            "H.RESUME_WORK  = 'Y'",
        ];

        if (p.companyCode && p.companyCode.toLowerCase() !== "all") {
            binds.as_companycode = p.companyCode;
            where.push("V.COMPANY_CODE = :as_companycode");
        }
        addInClause("V.DIV_CODE",      p.division,     "div",  binds, where);
        addInClause("V.DEPT_CODE",     p.department,   "dept", binds, where);
        addInClause("V.SECTION_CODE",  p.section,      "sect", binds, where);
        addInClause("V.EMPLOYEE_CODE", p.employeeCode, "emp",  binds, where);

        addDateRange("H.LEAVE_START_DATE",   p.leaveFrom,  p.leaveTo,  "lve", binds, where);
        addDateRange("H.ACTUAL_RESUME_DATE", p.resumeFrom, p.resumeTo, "res", binds, where);

        const sql = `
            SELECT V.EMPLOYEE_CODE,
                   V.RPT_NAME,
                   V.DIV_CODE, V.DIV_NAME,
                   V.DEPT_CODE, V.DEPT_NAME,
                   V.SECTION_CODE, V.SECTION_NAME,
                   H.HDR_LVE_SLNO,
                   H.LVE_DOC_NO,
                   H.ACTUAL_RESUME_DATE,
                   H.RESUME_APPROVED,
                   H.RESUME_APPROVED_BY,
                   D.LEAVE_TYPE,
                   T.LEAVE_TYPE_DESC,
                   D.LEAVE_START_DATE,
                   D.LEAVE_END_DATE,
                   D.LEAVE_DAYS,
                   D.LEAVE_REASON
              FROM HR_EMP_LEAVE_DET D,
                   HR_EMP_LEAVE_HDR H,
                   VW_HR_EMP_LEAVE_SEARCH V,
                   MS_HR_LEAVE_TYPES T
             WHERE ${where.join("\n               AND ")}
             ORDER BY V.COMPANY_CODE ASC, V.DIV_CODE ASC, V.DEPT_CODE ASC,
                      V.SECTION_CODE ASC, V.EMPLOYEE_CODE ASC, H.HDR_LVE_SLNO DESC`;

        const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });

        const rows: ResumptionRow[] = (result.rows as any[]).map((row) => {
            const r = Object.keys(row).reduce((acc: any, key) => {
                acc[key.toLowerCase()] = row[key];
                return acc;
            }, {});
            return {
                employee_code:      text(r.employee_code),
                rpt_name:           text(r.rpt_name),
                div_code:           text(r.div_code),
                div_name:           text(r.div_name),
                dept_code:          text(r.dept_code),
                dept_name:          text(r.dept_name),
                section_code:       text(r.section_code),
                section_name:       text(r.section_name),
                leave_no:           text(r.lve_doc_no),
                leave_type:         text(r.leave_type),
                leave_type_desc:    text(r.leave_type_desc),
                reason:             text(r.leave_reason),
                start_date:         r.leave_start_date,
                end_date:           r.leave_end_date,
                leave_days:         num(r.leave_days),
                resume_date:        r.actual_resume_date,
                resume_approved:    text(r.resume_approved).toUpperCase() === "Y" ? "Yes" : "No",
                resume_approved_by: text(r.resume_approved_by),
            };
        });

        return { rows, connection };
    } catch (err) {
        try { await connection.close(); } catch (e) { console.error(e); }
        throw err;
    }
}

// ─── Grouping: Division → Employee → leave rows ───────────────────────────────

interface EmpGroup {
    code: string; name: string;
    dept_code: string; dept_name: string;
    section_code: string; section_name: string;
    rows: ResumptionRow[];
}
interface DivGroup { div_code: string; div_name: string; employees: EmpGroup[] }

function buildGroups(rows: ResumptionRow[]): DivGroup[] {
    const divs = new Map<string, DivGroup>();

    rows.forEach((r) => {
        let div = divs.get(r.div_code);
        if (!div) {
            div = { div_code: r.div_code, div_name: r.div_name, employees: [] };
            divs.set(r.div_code, div);
        }
        let emp = div.employees.find((e) => e.code === r.employee_code);
        if (!emp) {
            emp = {
                code: r.employee_code, name: r.rpt_name,
                dept_code: r.dept_code, dept_name: r.dept_name,
                section_code: r.section_code, section_name: r.section_name,
                rows: [],
            };
            div.employees.push(emp);
        }
        emp.rows.push(r);
    });

    return [...divs.values()];
}

const filterRows = (p: ResumptionParams): { label: string; value: string }[] => [
    { label: "Division",      value: p.division     || ALL },
    { label: "Department",    value: p.department   || ALL },
    { label: "Section",       value: p.section      || ALL },
    { label: "Employee Code", value: p.employeeCode || ALL },
    { label: "Leave",         value: `${dateOrAll(p.leaveFrom)} – ${dateOrAll(p.leaveTo)}` },
    { label: "Leave Resume",  value: `${dateOrAll(p.resumeFrom)} – ${dateOrAll(p.resumeTo)}` },
];

const NCOLS = 9;

// ─── Excel HTML (.xls) ────────────────────────────────────────────────────────

function buildExcelHtml(rows: ResumptionRow[], p: ResumptionParams): string {
    const reportDate = formatDateStr(new Date());

    let body = "";
    buildGroups(rows).forEach((g) => {
        body += `<tr><td colspan="${NCOLS}" style="font-weight:bold;background:#eef3fb;color:#00378c">
            Division: ${escapeHtml(g.div_code)} ${escapeHtml(g.div_name)}</td></tr>`;
        g.employees.forEach((e) => {
            body += `<tr><td colspan="${NCOLS}" style="font-weight:bold;background:#f1f5f9">
                Employee: ${escapeHtml(e.code)} &nbsp; ${escapeHtml(e.name)} &nbsp;|&nbsp;
                Department: ${escapeHtml(e.dept_name)} &nbsp;|&nbsp;
                Section: ${escapeHtml(e.section_name)}</td></tr>`;
            e.rows.forEach((x) => {
                body += `<tr>
          <td>${escapeHtml(x.leave_no)}</td>
          <td>${escapeHtml(x.leave_type_desc || x.leave_type)}</td>
          <td>${escapeHtml(x.reason)}</td>
          <td style="text-align:center">${escapeHtml(formatDateStr(x.start_date))}</td>
          <td style="text-align:center">${escapeHtml(formatDateStr(x.end_date))}</td>
          <td style="text-align:right">${escapeHtml(days(x.leave_days))}</td>
          <td style="text-align:center">${escapeHtml(formatDateStr(x.resume_date))}</td>
          <td style="text-align:center">${escapeHtml(x.resume_approved)}</td>
          <td>${escapeHtml(x.resume_approved_by)}</td>
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
<x:ExcelWorksheet><x:Name>Leave Resumption</x:Name>
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
  <tr><td style="border:none;font-size:13pt;font-weight:700;color:#00378c" colspan="3">${escapeHtml(titleLine(p))}</td></tr>
  ${filterRows(p).map((f) => `<tr><td class="meta-lbl" style="border:none">${escapeHtml(f.label)} :</td><td style="border:none" colspan="2">${escapeHtml(f.value)}</td></tr>`).join("")}
  <tr><td class="meta-lbl" style="border:none">Printed on :</td><td style="border:none" colspan="2">${reportDate}</td></tr>
  <tr><td class="meta-lbl" style="border:none">User :</td><td style="border:none" colspan="2">${escapeHtml(p.loginid)}</td></tr>
  <tr><td class="meta-lbl" style="border:none">Report :</td><td style="border:none" colspan="2">${REPORT_CODE}</td></tr>
</table>
<br>
<table>
  <thead>
    <tr>
      <th>Leave No.</th><th>Leave Type</th><th>Reason</th>
      <th>From</th><th>To</th><th>Leave Days</th>
      <th>Resume Date</th><th>Approved</th><th>Approved By</th>
    </tr>
  </thead>
  <tbody>${body}</tbody>
</table>
</body></html>`;
}

// ─── Layout CSS (A4 landscape – 9 columns) ────────────────────────────────────

const RESUMPTION_EXTRA_CSS = `
  @page { size: A4 landscape; margin: 6mm 10mm 12mm 10mm; }

  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
  html, body { width: 100%; max-width: 100%; overflow-x: hidden; }
  body::before, body::after { display: none !important; content: none !important; }

  .company-header { border-bottom: 2px solid #00378c; padding: 0 0 10px 0; margin: 0 0 8px 0; }
  .company-name       { font-size: 16px; font-weight: 700; color: #172033; margin: 0 0 2px 0; }
  .company-address    { font-size: 9.5px; line-height: 1.4; }
  .company-logo-wrap  { max-width: 180px; }
  .company-logo       { max-height: 56px; max-width: 180px; }

  h1.report-title { margin: 18px 0 10px 0; font-size: 18px; font-weight: 700; color: #00378c !important; }
  .applied-filters { font-size: 10.5px; margin-bottom: 16px; }

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
    text-transform: none; text-align: center; white-space: nowrap !important;
  }

  table.data-table tbody tr.div-row td {
    background: #eef3fb !important; padding: 8px 6px; border-bottom: 1px solid #cbd5e1 !important;
    text-align: left; font-size: 10.5px; font-weight: 700; color: #00378c;
  }
  table.data-table tbody tr.emp-row td {
    background: #f1f5f9 !important; color: #1e293b !important; padding: 6px;
    border-bottom: 1px solid #cbd5e1 !important; text-align: left;
  }
  .emp-top  { display: flex; gap: 14px; font-size: 10.5px; font-weight: 700; }
  .emp-code { color: #00378c; min-width: 110px; }
  .emp-org  { display: flex; gap: 24px; font-size: 9.5px; font-weight: 600; color: #475569; margin-top: 2px; }

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

// % widths – adds up to 100
const WIDTHS = [10, 13, 19, 9, 9, 7, 10, 9, 14];

function renderBody(rows: ResumptionRow[], p: ResumptionParams): string {
    let tableRows = "";

    if (!rows.length) {
        tableRows = `<tr class="empty-row"><td colspan="${NCOLS}">${escapeHtml(NO_DATA_MESSAGE)}</td></tr>`;
    } else {
        buildGroups(rows).forEach((g) => {
            tableRows += `<tr class="div-row"><td colspan="${NCOLS}">Division: &nbsp; ${escapeHtml(g.div_name || g.div_code)}</td></tr>`;

            g.employees.forEach((e) => {
                tableRows += `<tr class="emp-row"><td colspan="${NCOLS}">
                  <div class="emp-top"><span class="emp-code">Employee: &nbsp; ${escapeHtml(e.code)}</span><span>${escapeHtml(e.name)}</span></div>
                  <div class="emp-org"><span>Department: ${escapeHtml(e.dept_name)}</span><span>Section: ${escapeHtml(e.section_name)}</span></div>
                </td></tr>`;

                e.rows.forEach((x) => {
                    tableRows += `
        <tr class="data-row">
          <td class="center nw">${escapeHtml(x.leave_no)}</td>
          <td class="left">${escapeHtml(x.leave_type_desc || x.leave_type)}</td>
          <td class="left">${escapeHtml(x.reason)}</td>
          <td class="center nw">${escapeHtml(formatDateStr(x.start_date))}</td>
          <td class="center nw">${escapeHtml(formatDateStr(x.end_date))}</td>
          <td class="right nw">${escapeHtml(days(x.leave_days))}</td>
          <td class="center nw">${escapeHtml(formatDateStr(x.resume_date))}</td>
          <td class="center nw">${escapeHtml(x.resume_approved)}</td>
          <td class="left">${escapeHtml(x.resume_approved_by)}</td>
        </tr>`;
                });
            });
        });
        tableRows += `<tr class="end-row"><td colspan="${NCOLS}">End of Report</td></tr>`;
    }

    const colgroup = WIDTHS.map((w) => `<col style="width:${w}%"/>`).join("");

    return `
    <h1 class="report-title">${escapeHtml(titleLine(p))}</h1>
    ${reportAppliedFilters(filterRows(p))}

    <table class="data-table">
      <colgroup>${colgroup}</colgroup>
      <thead>
        <tr>
          <th>Leave No.</th>
          <th>Leave Type</th>
          <th>Reason</th>
          <th>From</th>
          <th>To</th>
          <th>Leave Days</th>
          <th>Resume Date</th>
          <th>Approved</th>
          <th>Approved By</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  `;
}

// ─── HTML Controller ──────────────────────────────────────────────────────────

export const getLeaveResumptionReport = async (req: RequestWithUser, res: Response): Promise<void> => {
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
            extraCss: RESUMPTION_EXTRA_CSS,
            autoPrint: req.query.print !== "false",
            showPrintButton: true,
            fontMode: "native",
        });

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.status(200).send(html);
    } catch (error: any) {
        console.error("Leave Resumption Report Error:", error);
        res.status(500).json({ success: false, message: "Unable to generate report", details: error.message });
    } finally {
        if (connection) try { await connection.close(); } catch (e) { console.error(e); }
    }
};

// ─── Excel Controller ─────────────────────────────────────────────────────────

export const exportLeaveResumptionReportExcel = async (req: Request, res: Response): Promise<void> => {
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
            `attachment; filename="LeaveResumption_${new Date().toISOString().slice(0, 10)}.xls"`
        );
        res.status(200).send(excelHtml);
    } catch (error: any) {
        console.error("Leave Resumption Report Excel Error:", error);
        res.status(500).json({ success: false, message: "Unable to export report", details: error.message });
    } finally {
        if (connection) try { await connection.close(); } catch (e) { console.error(e); }
    }
};

