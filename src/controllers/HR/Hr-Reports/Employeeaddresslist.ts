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
const REPORT_TITLE = "Employee Address List";

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

const valueOrDash = (v: any): string => (text(v).trim() ? text(v).trim() : DASH);

// ─── Types ────────────────────────────────────────────────────────────────────

interface AddressRow {
    employee_id: string;
    employee_code: string;
    employee_name: string;
    rpt_name: string;
    join_date: any;
    desg_name: string;
    dept_name: string;
    section_name: string;
    phone_office: string;
    phone_office_extn: string;
    mobile_no: string;
    email_official: string;
}

interface AddressParams {
    loginid: string;
    companyCode: string;
    division: string;      // comma separated codes or "" (= All)
    department: string;
    section: string;
    grade: string;
    designation: string;
    employeeCode: string;  // comma separated codes or "" (= All)
    status: string;        // single status code or "" (= All)
    join_from: string;     // YYYY-MM-DD or ""
    join_to: string;
}

// ─── Resolve request body ─────────────────────────────────────────────────────
// code1 company, code2 division, code3 department, code4 section, code5 grade,
// code6 designation, code7 employee code, code8 status,
// date1/date2 join date from/to (YYYY-MM-DD, optional).

const csvOrEmpty = (v: any): string => {
    const s = text(v).trim();
    return !s || s.toLowerCase() === "all" ? "" : s;
};

function resolveParams(body: any): AddressParams {
    const { loginid, company_code, code1, code2, code3, code4, code5, code6, code7, code8, date1, date2 } = body;
    return {
        loginid:      loginid || "ADMIN",
        companyCode:  text(company_code || code1),
        division:     csvOrEmpty(code2),
        department:   csvOrEmpty(code3),
        section:      csvOrEmpty(code4),
        grade:        csvOrEmpty(code5),
        designation:  csvOrEmpty(code6),
        employeeCode: csvOrEmpty(code7),
        status:       csvOrEmpty(code8),
        join_from:    text(date1).slice(0, 10),
        join_to:      text(date2).slice(0, 10),
    };
}

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

// ─── Fetch rows ───────────────────────────────────────────────────────────────

async function fetchAddressRows(body: any): Promise<{ rows: AddressRow[]; connection: any }> {
    const p = resolveParams(body);

    let tenantId = getCurrentTenantId();
    if (!tenantId && p.loginid) tenantId = await TenantManager.getTenantForUser(p.loginid);
    if (!tenantId) throw new Error("Tenant not found");

    if ((p.join_from && !ISO_DATE.test(p.join_from)) || (p.join_to && !ISO_DATE.test(p.join_to))) {
        throw new Error("Invalid join date.");
    }

    const connection = await TenantManager.getConnection(tenantId);

    try {
        const binds: Record<string, any> = {};
        const where: string[] = [
            "E.COMPANY_CODE = N.COMPANY_CODE",
            "E.DESG_CODE    = N.DESG_CODE",
            "E.COMPANY_CODE = G.COMPANY_CODE",
            "E.GRADE_CODE   = G.GRADE_CODE",
            "E.COMPANY_CODE = D.COMPANY_CODE",
            "E.DIV_CODE     = D.DIV_CODE",
            "E.COMPANY_CODE = M.COMPANY_CODE",
            "E.DIV_CODE     = M.DIV_CODE",
            "E.DEPT_CODE    = M.DEPT_CODE",
            "E.COMPANY_CODE = S.COMPANY_CODE",
            "E.DIV_CODE     = S.DIV_CODE",
            "E.DEPT_CODE    = S.DEPT_CODE",
            "E.SECTION_CODE = S.SECTION_CODE",
        ];

        if (p.companyCode) {
            binds.as_companycode = p.companyCode;
            where.push("E.COMPANY_CODE = :as_companycode");
        }
        addInClause("E.DIV_CODE",      p.division,     "div",  binds, where);
        addInClause("E.DEPT_CODE",     p.department,   "dept", binds, where);
        addInClause("E.SECTION_CODE",  p.section,      "sect", binds, where);
        addInClause("E.GRADE_CODE",    p.grade,        "grd",  binds, where);
        addInClause("E.DESG_CODE",     p.designation,  "desg", binds, where);
        addInClause("E.EMPLOYEE_CODE", p.employeeCode, "emp",  binds, where);

        if (p.status) {
            binds.as_empstatus = p.status;
            where.push("E.EMP_STATUS = :as_empstatus");
        }
        if (p.join_from) {
            binds.adt_join_from = p.join_from;
            where.push("E.JOIN_DATE >= TO_DATE(:adt_join_from, 'YYYY-MM-DD')");
        }
        if (p.join_to) {
            binds.adt_join_to = p.join_to;
            // inclusive of the "To" day
            where.push("E.JOIN_DATE < TO_DATE(:adt_join_to, 'YYYY-MM-DD') + 1");
        }

        // NOTE: MS_HR_COMPANY was removed from the FROM list – it was never joined,
        // so it produced a cartesian product. Division is now also joined on company.
        const sql = `
            SELECT E.EMPLOYEE_ID,
                   E.EMPLOYEE_CODE,
                   TRIM(NVL(E.TITLE, '') || ' ' || NVL(E.FIRST_NAME, '') || ' ' || NVL(E.LAST_NAME, '')) EMPLOYEE_NAME,
                   E.RPT_NAME,
                   E.JOIN_DATE,
                   N.DESG_NAME,
                   M.DEPT_NAME,
                   S.SECTION_NAME,
                   E.PHONE_OFFICE,
                   E.PHONE_OFFICE_EXTN,
                   E.MOBILE_NO,
                   E.EMAIL_OFFICIAL
              FROM MS_HR_EMPLOYEE    E,
                   MS_HR_DESIGNATION N,
                   MS_HR_GRADE       G,
                   MS_HR_DIVISION    D,
                   MS_HR_DEPARTMENT  M,
                   MS_HR_SECTION     S
             WHERE ${where.join("\n               AND ")}
             ORDER BY E.EMPLOYEE_CODE`;

        const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });

        const rows: AddressRow[] = (result.rows as any[]).map((row) =>
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

const officePhone = (r: AddressRow): string => {
    const ph = text(r.phone_office).trim();
    const ex = text(r.phone_office_extn).trim();
    if (!ph && !ex) return DASH;
    return ex ? `${ph}${ph ? " " : ""}Extn: ${ex}` : ph;
};

const filterRows = (p: AddressParams): { label: string; value: string }[] => [
    { label: "Join Date",     value: `${dateOrAll(p.join_from)} – ${dateOrAll(p.join_to)}` },
    { label: "Division",      value: p.division     || ALL },
    { label: "Department",    value: p.department   || ALL },
    { label: "Section",       value: p.section      || ALL },
    { label: "Grade",         value: p.grade        || ALL },
    { label: "Designation",   value: p.designation  || ALL },
    { label: "Employee Code", value: p.employeeCode || ALL },
    { label: "Status",        value: p.status       || ALL },
];

// ─── Excel HTML (.xls) ────────────────────────────────────────────────────────

function buildExcelHtml(rows: AddressRow[], params: AddressParams): string {
    const reportDate = formatDateStr(new Date());

    const body = rows
        .map(
            (r, i) => `<tr>
          <td style="text-align:center">${i + 1}</td>
          <td style="font-weight:bold;color:#00378c">${escapeHtml(r.employee_code)}</td>
          <td>${escapeHtml(r.employee_name)}</td>
          <td style="text-align:center">${escapeHtml(valueOrDash(formatDateStr(r.join_date)))}</td>
          <td>${escapeHtml(valueOrDash(r.desg_name))}</td>
          <td>${escapeHtml(valueOrDash(r.dept_name))}</td>
          <td>${escapeHtml(valueOrDash(r.section_name))}</td>
          <td>${escapeHtml(officePhone(r))}</td>
          <td>${escapeHtml(valueOrDash(r.mobile_no))}</td>
          <td>${escapeHtml(valueOrDash(r.email_official))}</td>
        </tr>`
        )
        .join("");

    return `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
<x:ExcelWorksheet><x:Name>Address List</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
  body  { font-family: Calibri, Arial, sans-serif; font-size: 10pt; color: #1e293b; }
  table { border-collapse: collapse; }
  th    { background: #00378c; color: #ffffff; font-weight: bold; padding: 8px; border: 1px solid #00378c; text-align: center; }
  td    { padding: 6px 8px; border: 1px solid #e2e8f0; vertical-align: middle; mso-number-format:"\\@"; }
  .meta-lbl { font-weight: bold; color: #475569; width: 110px; }
</style>
</head>
<body>
<table style="border:none;margin-bottom:6px">
  <tr><td style="border:none;font-size:16pt;font-weight:800;color:#172033" colspan="3">HR DEPARTMENT</td></tr>
  <tr><td style="border:none;font-size:13pt;font-weight:700;color:#00378c" colspan="3">${REPORT_TITLE}</td></tr>
  ${filterRows(params).map((f) => `<tr><td class="meta-lbl" style="border:none">${escapeHtml(f.label)} :</td><td style="border:none" colspan="2">${escapeHtml(f.value)}</td></tr>`).join("")}
  <tr><td class="meta-lbl" style="border:none">Printed on :</td><td style="border:none" colspan="2">${reportDate}</td></tr>
  <tr><td class="meta-lbl" style="border:none">User :</td><td style="border:none" colspan="2">${escapeHtml(params.loginid)}</td></tr>
</table>
<br>
<table>
  <thead>
    <tr>
      <th>SI No.</th><th>Employee Code</th><th>Employee Name</th><th>Join Date</th>
      <th>Designation</th><th>Department</th><th>Section</th>
      <th>Phone (Office)</th><th>Mobile No.</th><th>Email-ID</th>
    </tr>
  </thead>
  <tbody>${body}
    <tr><td colspan="10" style="font-weight:bold;background:#dbe4f0;color:#00378c">Total Records : ${rows.length}</td></tr>
  </tbody>
</table>
</body></html>`;
}

// ─── Layout CSS ───────────────────────────────────────────────────────────────

const ADDRESS_EXTRA_CSS = `
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
    font-size: 10px; padding: 8px 4px; border: 1px solid #ffffff55 !important;
    text-transform: none; white-space: normal !important; text-align: center;
  }

  /* each employee = two lines: main details, then phone / mobile / email */
  table.data-table tbody tr.data-row td {
    background: #fafcfe !important; font-size: 10px; padding: 6px 4px;
    border-bottom: 1px solid #e2e8f0 !important; color: #1e293b; vertical-align: middle;
  }
  table.data-table tbody tr.data-row-sub td {
    background: #ffffff !important; font-size: 9.5px; padding: 5px 4px;
    border-bottom: 1px solid #cbd5e1 !important; color: #475569; vertical-align: middle;
  }
  table.data-table tbody tr.data-row td.nw { white-space: nowrap !important; font-variant-numeric: tabular-nums; }
  table.data-table tbody tr.data-row td.primary-text { color: #00378c; font-weight: 700; }

  table.data-table tbody tr.grand-total-row td {
    background: #dbe4f0 !important; color: #00378c !important; font-weight: 700;
    padding: 9px 6px; text-align: left; border-bottom: 1px solid #cbd5e1 !important;
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

// % widths – add up to 100  (Code, Name, Join Date, Designation, Department, Section)
const COL_WIDTHS = [10, 22, 10, 20, 19, 19];

function renderBody(rows: AddressRow[], params: AddressParams): string {
    let tableRows = "";
    if (!rows.length) {
        tableRows = `<tr class="empty-row"><td colspan="6">${escapeHtml(NO_DATA_MESSAGE)}</td></tr>`;
    } else {
        rows.forEach((r) => {
            tableRows += `
        <tr class="data-row">
          <td class="left nw primary-text" rowspan="2">${escapeHtml(r.employee_code)}</td>
          <td class="left" rowspan="2">${escapeHtml(r.employee_name)}</td>
          <td class="center nw">${escapeHtml(valueOrDash(formatDateStr(r.join_date)))}</td>
          <td class="left">${escapeHtml(valueOrDash(r.desg_name))}</td>
          <td class="left">${escapeHtml(valueOrDash(r.dept_name))}</td>
          <td class="left">${escapeHtml(valueOrDash(r.section_name))}</td>
        </tr>
        <tr class="data-row-sub">
          <td class="left" colspan="2">Ph: ${escapeHtml(officePhone(r))}</td>
          <td class="left">Mob: ${escapeHtml(valueOrDash(r.mobile_no))}</td>
          <td class="left">${escapeHtml(valueOrDash(r.email_official))}</td>
        </tr>`;
        });
        tableRows += `<tr class="grand-total-row"><td colspan="6">Total Records : ${rows.length}</td></tr>`;
    }

    const filtersHtml = reportAppliedFilters(filterRows(params));
    const colgroup = COL_WIDTHS.map((w) => `<col style="width:${w}%"/>`).join("");

    return `
    <h1 class="report-title">${REPORT_TITLE}</h1>
    ${filtersHtml}

    <table class="data-table">
      <colgroup>${colgroup}</colgroup>
      <thead>
        <tr>
          <th rowspan="2">Employee Code</th>
          <th rowspan="2">Employee Name</th>
          <th>Join Date</th>
          <th>Designation</th>
          <th>Department</th>
          <th>Section</th>
        </tr>
        <tr>
          <th colspan="2">Phone (Office)</th>
          <th>Mobile No.</th>
          <th>Email-ID</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  `;
}

// ─── HTML Controller ──────────────────────────────────────────────────────────

export const getEmployeeAddressListReport = async (req: RequestWithUser, res: Response): Promise<void> => {
    let connection: any;
    try {
        const { rows, connection: conn } = await fetchAddressRows(req.body);
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
            extraCss: ADDRESS_EXTRA_CSS,
            autoPrint: req.query.print !== "false",
            showPrintButton: true,
            fontMode: "native",
        });

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.status(200).send(html);
    } catch (error: any) {
        console.error("Employee Address List Report Error:", error);
        res.status(500).json({ success: false, message: "Unable to generate report", details: error.message });
    } finally {
        if (connection) try { await connection.close(); } catch (e) { console.error(e); }
    }
};

// ─── Excel Controller ─────────────────────────────────────────────────────────

export const exportEmployeeAddressListRepotExcel = async (req: Request, res: Response): Promise<void> => {
    let connection: any;
    try {
        const { rows, connection: conn } = await fetchAddressRows(req.body);
        connection = conn;

        if (!rows.length) {
            res.status(200).json({ success: false, message: "No data found for the selected criteria." });
            return;
        }

        const excelHtml = buildExcelHtml(rows, resolveParams(req.body));

        res.setHeader("Content-Type", "application/vnd.ms-excel");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="EmployeeAddressList_${new Date().toISOString().slice(0, 10)}.xls"`
        );
        res.status(200).send(excelHtml);
    } catch (error: any) {
        console.error("Employee Address List Report Excel Error:", error);
        res.status(500).json({ success: false, message: "Unable to export report", details: error.message });
    } finally {
        if (connection) try { await connection.close(); } catch (e) { console.error(e); }
    }
};