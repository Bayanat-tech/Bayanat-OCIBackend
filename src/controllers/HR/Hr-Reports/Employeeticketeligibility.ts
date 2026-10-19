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
const REPORT_TITLE = "Employee Ticket Eligibility";

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

const valueOrDash = (v: any): string => (text(v).trim() ? text(v) : DASH);
const num = (v: any): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (v: number): string => v.toFixed(3);
const int = (v: number): string => String(Math.round(v));

// ─── Types ────────────────────────────────────────────────────────────────────

type GroupBy = "DESIGNATION" | "GRADE_DESIGNATION" | "DIVISION" | "DEPARTMENT" | "SECTION";

interface TicketRow {
    employee_id: string;
    employee_code: string;
    rpt_name: string;
    dept_name: string;
    div_name: string;
    section_name: string;
    grade_name: string;
    desg_name: string;
    adult: number | null;
    adult_fair: number | null;
    child: number | null;
    child_fair: number | null;
    infant: number | null;
    infant_fair: number | null;
    ticket_eligible_period: number | null;
    airport_name: string;
}

interface TicketParams {
    loginid: string;
    companyCode: string;
    division: string;      // comma separated codes or "" (= All)
    department: string;
    section: string;
    grade: string;
    designation: string;
    formalDesignation: string;
    groupBy: GroupBy;
    join_from: string;     // YYYY-MM-DD or ""
    join_to: string;
}

const GROUP_LABEL: Record<GroupBy, string> = {
    DESIGNATION: "Designation",
    GRADE_DESIGNATION: "Grade + Designation",
    DIVISION: "Division",
    DEPARTMENT: "Department",
    SECTION: "Section",
};

// ─── Resolve request body ─────────────────────────────────────────────────────
// code1 company, code2 division, code3 department, code4 section, code5 grade,
// code6 designation, code7 formal (labour) designation, code8 group criteria,
// date1/date2 join date from/to (YYYY-MM-DD, optional).
// Multi-select fields arrive as "A,B,C" or "All".

const csvOrEmpty = (v: any): string => {
    const s = text(v).trim();
    return !s || s.toLowerCase() === "all" ? "" : s;
};

function resolveParams(body: any): TicketParams {
    const { loginid, company_code, code1, code2, code3, code4, code5, code6, code7, code8, date1, date2 } = body;
    const g = text(code8).toUpperCase() as GroupBy;
    return {
        loginid: loginid || "ADMIN",
        companyCode: text(company_code || code1),
        division: csvOrEmpty(code2),
        department: csvOrEmpty(code3),
        section: csvOrEmpty(code4),
        grade: csvOrEmpty(code5),
        designation: csvOrEmpty(code6),
        formalDesignation: csvOrEmpty(code7),
        groupBy: GROUP_LABEL[g] ? g : "DESIGNATION",
        join_from: text(date1).slice(0, 10),
        join_to: text(date2).slice(0, 10),
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

// ─── Fetch rows (your SQL, with bind variables) ───────────────────────────────

async function fetchTicketRows(body: any): Promise<{ rows: TicketRow[]; connection: any }> {
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
            "E.EMPLOYEE_ID = V.EMPLOYEE_ID",
            "E.TICKET_ELIGIBILITY = 'Y'",
            "E.EMP_STATUS IN ('C', 'P')",
        ];

        if (p.companyCode) {
            binds.as_companycode = p.companyCode;
            where.push("E.COMPANY_CODE = :as_companycode");
        }
        addInClause("E.DIV_CODE", p.division, "div", binds, where);
        addInClause("E.DEPT_CODE", p.department, "dept", binds, where);
        addInClause("E.SECTION_CODE", p.section, "sect", binds, where);
        addInClause("E.GRADE_CODE", p.grade, "grd", binds, where);
        addInClause("E.DESG_CODE", p.designation, "desg", binds, where);
        addInClause("E.LABOUR_DESG_CODE", p.formalDesignation, "ldes", binds, where);

        if (p.join_from) {
            binds.adt_join_from = p.join_from;
            where.push("E.JOIN_DATE >= TO_DATE(:adt_join_from, 'YYYY-MM-DD')");
        }
        if (p.join_to) {
            binds.adt_join_to = p.join_to;
            // inclusive of the "To" day
            where.push("E.JOIN_DATE < TO_DATE(:adt_join_to, 'YYYY-MM-DD') + 1");
        }

        const sql = `
            SELECT E.EMPLOYEE_ID,
                   E.EMPLOYEE_CODE,
                   E.RPT_NAME,
                   E.TA_NO ADULT,
                   V.DEPT_NAME,
                   V.DIV_NAME,
                   V.SECTION_NAME,
                   V.GRADE_NAME,
                   V.DESG_NAME,
                   E.DESG_CODE,
                   (SELECT ADULT_TICKET_FAIR  FROM MS_HR_AIRPORT
  WHERE AIRPORT_CODE = E.AIRPORT_CODE AND COMPANY_CODE = E.COMPANY_CODE) ADULT_FAIR,
E.TC_NO CHILD,
(SELECT CHILD_TICKET_FAIR  FROM MS_HR_AIRPORT
  WHERE AIRPORT_CODE = E.AIRPORT_CODE AND COMPANY_CODE = E.COMPANY_CODE) CHILD_FAIR,
E.TI_NO INFANT,
                  (SELECT INFANT_TICKET_FAIR FROM MS_HR_AIRPORT
  WHERE AIRPORT_CODE = E.AIRPORT_CODE AND COMPANY_CODE = E.COMPANY_CODE) INFANT_FAIR,
TICKET_ELIGIBLE_PERIOD,
E.AIRPORT_CODE,
             (SELECT AIRPORT_NAME       FROM MS_HR_AIRPORT
  WHERE AIRPORT_CODE = E.AIRPORT_CODE AND COMPANY_CODE = E.COMPANY_CODE) AIRPORT_NAME
              FROM MS_HR_EMPLOYEE E,
                   VW_HR_EMPLOYEE V
             WHERE ${where.join("\n               AND ")}
             ORDER BY E.EMPLOYEE_CODE`;

        const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });

        const rows: TicketRow[] = (result.rows as any[]).map((row) =>
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

// ─── Grouping + totals ────────────────────────────────────────────────────────

interface Totals {
    adultNo: number; adultFare: number;
    childNo: number; childFare: number;
    infantNo: number; infantFare: number;
    airNo: number; airFare: number;
}
const emptyTotals = (): Totals => ({
    adultNo: 0, adultFare: 0, childNo: 0, childFare: 0,
    infantNo: 0, infantFare: 0, airNo: 0, airFare: 0,
});

/** Per-row figures. Fare columns = number of tickets x airport fare. Airfare = all three combined. */
function rowFigures(r: TicketRow): Totals {
    const adultNo = num(r.adult), adultFare = adultNo * num(r.adult_fair);
    const childNo = num(r.child), childFare = childNo * num(r.child_fair);
    const infantNo = num(r.infant), infantFare = infantNo * num(r.infant_fair);
    return {
        adultNo, adultFare, childNo, childFare, infantNo, infantFare,
        airNo: adultNo + childNo + infantNo,
        airFare: adultFare + childFare + infantFare,
    };
}

function addTotals(t: Totals, f: Totals) {
    (Object.keys(t) as (keyof Totals)[]).forEach((k) => { t[k] += f[k]; });
}

function groupLabel(r: TicketRow, g: GroupBy): string {
    const v = (s: any) => text(s).trim() || DASH;
    switch (g) {
        case "GRADE_DESIGNATION": return `${v(r.grade_name)} / ${v(r.desg_name)}`;
        case "DIVISION": return v(r.div_name);
        case "DEPARTMENT": return v(r.dept_name);
        case "SECTION": return v(r.section_name);
        default: return v(r.desg_name);
    }
}

interface Group { label: string; rows: { row: TicketRow; fig: Totals }[]; totals: Totals }

function buildGroups(rows: TicketRow[], g: GroupBy): { groups: Group[]; grand: Totals } {
    const map = new Map<string, Group>();
    const grand = emptyTotals();

    [...rows]
        .sort((a, b) =>
            groupLabel(a, g).localeCompare(groupLabel(b, g)) ||
            text(a.employee_code).localeCompare(text(b.employee_code)))
        .forEach((row) => {
            const label = groupLabel(row, g);
            let grp = map.get(label);
            if (!grp) { grp = { label, rows: [], totals: emptyTotals() }; map.set(label, grp); }
            const fig = rowFigures(row);
            grp.rows.push({ row, fig });
            addTotals(grp.totals, fig);
            addTotals(grand, fig);
        });

    return { groups: [...map.values()], grand };
}

const filterRows = (p: TicketParams): { label: string; value: string }[] => [
    { label: "Join Date", value: `${dateOrAll(p.join_from)} – ${dateOrAll(p.join_to)}` },
    { label: "Division", value: p.division || ALL },
    { label: "Department", value: p.department || ALL },
    { label: "Section", value: p.section || ALL },
    { label: "Grade", value: p.grade || ALL },
    { label: "Designation", value: p.designation || ALL },
    { label: "Formal Desg.", value: p.formalDesignation || ALL },
    { label: "Group By", value: GROUP_LABEL[p.groupBy] },
];

// ─── Excel HTML (.xls) ────────────────────────────────────────────────────────

function buildExcelHtml(rows: TicketRow[], params: TicketParams): string {
    const reportDate = formatDateStr(new Date());
    const { groups, grand } = buildGroups(rows, params.groupBy);

    const totalCells = (t: Totals, style: string) => `
        <td style="${style};text-align:right">${int(t.adultNo)}</td>
        <td style="${style};text-align:right">${money(t.adultFare)}</td>
        <td style="${style};text-align:right">${int(t.childNo)}</td>
        <td style="${style};text-align:right">${money(t.childFare)}</td>
        <td style="${style};text-align:right">${int(t.infantNo)}</td>
        <td style="${style};text-align:right">${money(t.infantFare)}</td>
        <td style="${style};text-align:right">${int(t.airNo)}</td>
        <td style="${style};text-align:right">${money(t.airFare)}</td>`;

    let body = "";
    groups.forEach((g) => {
        body += `<tr><td colspan="13" style="font-weight:bold;color:#00378c;background:#eef3fb">${escapeHtml(g.label)}</td></tr>`;
        g.rows.forEach(({ row: r, fig }, i) => {
            body += `<tr>
          <td style="text-align:center">${i + 1}</td>
          <td style="font-weight:bold;color:#00378c">${escapeHtml(r.employee_code)}</td>
          <td>${escapeHtml(r.rpt_name)}</td>
          <td style="text-align:center">${escapeHtml(valueOrDash(r.ticket_eligible_period))}</td>
          <td>${escapeHtml(valueOrDash(r.airport_name))}</td>
          <td style="text-align:right">${int(fig.adultNo)}</td><td style="text-align:right">${money(fig.adultFare)}</td>
          <td style="text-align:right">${int(fig.childNo)}</td><td style="text-align:right">${money(fig.childFare)}</td>
          <td style="text-align:right">${int(fig.infantNo)}</td><td style="text-align:right">${money(fig.infantFare)}</td>
          <td style="text-align:right">${int(fig.airNo)}</td><td style="text-align:right">${money(fig.airFare)}</td>
        </tr>`;
        });
        body += `<tr><td colspan="5" style="font-weight:bold;text-align:right;background:#f1f5f9">Sub Total</td>${totalCells(g.totals, "font-weight:bold;background:#f1f5f9")}</tr>`;
    });
    body += `<tr><td colspan="5" style="font-weight:bold;text-align:right;background:#dbe4f0;color:#00378c">Grand Total (${rows.length} Records)</td>${totalCells(grand, "font-weight:bold;background:#dbe4f0;color:#00378c")}</tr>`;

    return `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
<x:ExcelWorksheet><x:Name>Ticket Eligibility</x:Name>
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
  ${filterRows(params).map((f) => `<tr><td class="meta-lbl" style="border:none">${escapeHtml(f.label)} :</td><td style="border:none" colspan="2">${escapeHtml(f.value)}</td></tr>`).join("")}
  <tr><td class="meta-lbl" style="border:none">Printed on :</td><td style="border:none" colspan="2">${reportDate}</td></tr>
  <tr><td class="meta-lbl" style="border:none">User :</td><td style="border:none" colspan="2">${escapeHtml(params.loginid)}</td></tr>
</table>
<br>
<table>
  <thead>
    <tr>
      <th rowspan="2">SI No.</th><th rowspan="2">Employee Code</th><th rowspan="2">Employee Name</th>
      <th rowspan="2">Ticket Eligible Period</th><th rowspan="2">Airport Name</th>
      <th colspan="2">Ticket Adult</th><th colspan="2">Ticket Child</th>
      <th colspan="2">Ticket Infant</th><th colspan="2">Airfare</th>
    </tr>
    <tr>
      <th>Number</th><th>Fair</th><th>Number</th><th>Fair</th>
      <th>Number</th><th>Fair</th><th>Number</th><th>Fair</th>
    </tr>
  </thead>
  <tbody>${body}</tbody>
</table>
</body></html>`;
}

// ─── Layout CSS (same look as the Assessment PDF) ─────────────────────────────

const TICKET_EXTRA_CSS = `
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
  table.data-table .right  { text-align: right  !important; font-variant-numeric: tabular-nums; }

  table.data-table thead tr th {
    background: #00378c !important; color: #ffffff !important; font-weight: 700;
    font-size: 10px; padding: 9px 4px; border: 1px solid #ffffff55 !important;
    text-transform: none; white-space: normal !important; text-align: center;
  }

  table.data-table tbody tr.group-row td {
    background: #eef3fb !important; color: #00378c !important; font-weight: 700;
    font-size: 10.5px; padding: 8px 6px; border-bottom: 1px solid #cbd5e1 !important; text-align: left;
  }
  table.data-table tbody tr.data-row td {
    background: #fafcfe !important; font-size: 10px; padding: 7px 4px;
    border-bottom: 1px solid #e2e8f0 !important; color: #1e293b; vertical-align: middle;
  }
  table.data-table tbody tr.data-row td.nw { white-space: nowrap !important; font-variant-numeric: tabular-nums; }
  table.data-table tbody tr.data-row td.primary-text { color: #00378c; font-weight: 700; }

  table.data-table tbody tr.sub-total-row td {
    background: #f1f5f9 !important; color: #1e293b !important; font-weight: 700;
    padding: 7px 4px; border-bottom: 1px solid #cbd5e1 !important; text-align: right;
  }
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
const COL_WIDTHS = [4, 9, 17, 7, 13, 6, 6, 6, 6, 6, 6, 7, 7];

function renderBody(rows: TicketRow[], params: TicketParams): string {
    const cell = (v: number, fare = false) =>
        `<td class="right nw">${fare ? money(v) : int(v)}</td>`;
    const totalCells = (t: Totals) =>
        cell(t.adultNo) + cell(t.adultFare, true) + cell(t.childNo) + cell(t.childFare, true) +
        cell(t.infantNo) + cell(t.infantFare, true) + cell(t.airNo) + cell(t.airFare, true);

    let tableRows = "";
    if (!rows.length) {
        tableRows = `<tr class="empty-row"><td colspan="13">${escapeHtml(NO_DATA_MESSAGE)}</td></tr>`;
    } else {
        const { groups, grand } = buildGroups(rows, params.groupBy);
        groups.forEach((g) => {
            tableRows += `<tr class="group-row"><td colspan="13">${escapeHtml(g.label)}</td></tr>`;
            g.rows.forEach(({ row: r, fig }, i) => {
                tableRows += `
        <tr class="data-row">
          <td class="center nw">${i + 1}</td>
          <td class="left nw primary-text">${escapeHtml(r.employee_code)}</td>
          <td class="left">${escapeHtml(r.rpt_name)}</td>
          <td class="center">${escapeHtml(valueOrDash(r.ticket_eligible_period))}</td>
          <td class="left">${escapeHtml(valueOrDash(r.airport_name))}</td>
          ${totalCells(fig)}
        </tr>`;
            });
            tableRows += `<tr class="sub-total-row"><td colspan="5">Sub Total</td>${totalCells(g.totals)}</tr>`;
        });
        tableRows += `<tr class="grand-total-row"><td colspan="5">Grand Total (${rows.length} Records)</td>${totalCells(grand)}</tr>`;
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
          <th rowspan="2">SI No.</th>
          <th rowspan="2">Employee Code</th>
          <th rowspan="2">Employee Name</th>
          <th rowspan="2">Ticket Eligible Period</th>
          <th rowspan="2">Airport Name</th>
          <th colspan="2">Ticket Adult</th>
          <th colspan="2">Ticket Child</th>
          <th colspan="2">Ticket Infant</th>
          <th colspan="2">Airfare</th>
        </tr>
        <tr>
          <th>Number</th><th>Fair</th>
          <th>Number</th><th>Fair</th>
          <th>Number</th><th>Fair</th>
          <th>Number</th><th>Fair</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  `;
}

// ─── HTML Controller ──────────────────────────────────────────────────────────

export const getEmployeeTicketEligibilityReport = async (req: RequestWithUser, res: Response): Promise<void> => {
    let connection: any;
    try {
        const { rows, connection: conn } = await fetchTicketRows(req.body);
        connection = conn;

        const params = resolveParams(req.body);
        const companyCode = params.companyCode || req.user?.company_code || "";

        const printed = new Date().toLocaleString("en-US");
        const headerHtml = await reportHeader({ company_code: companyCode, req });
        const bodyHtml = renderBody(rows, params);
        const footerHtml = reportFooter({
            reportName: REPORT_TITLE,
            userName: params.loginid,
            endLabel: "Powered by Bayanat Technology",
            extraLeft: `Print: ${escapeHtml(printed)} | User: ${escapeHtml(params.loginid)}`,
        });

        const html = buildReportDocument({
            title: REPORT_TITLE,
            headerHtml,
            bodyHtml,
            footerHtml,
            extraCss: TICKET_EXTRA_CSS,
            autoPrint: req.query.print !== "false",
            showPrintButton: true,
            fontMode: "native",
        });

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.status(200).send(html);
    } catch (error: any) {
        console.error("Employee Ticket Eligibility Report Error:", error);
        res.status(500).json({ success: false, message: "Unable to generate report", details: error.message });
    } finally {
        if (connection) try { await connection.close(); } catch (e) { console.error(e); }
    }
};

// ─── Excel Controller ─────────────────────────────────────────────────────────

export const exportEmployeeTicketEligibilityReportExcel = async (req: Request, res: Response): Promise<void> => {
    let connection: any;
    try {
        const { rows, connection: conn } = await fetchTicketRows(req.body);
        connection = conn;

        if (!rows.length) {
            res.status(200).json({ success: false, message: "No data found for the selected criteria." });
            return;
        }

        const excelHtml = buildExcelHtml(rows, resolveParams(req.body));

        res.setHeader("Content-Type", "application/vnd.ms-excel");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="EmployeeTicketEligibility_${new Date().toISOString().slice(0, 10)}.xls"`
        );
        res.status(200).send(excelHtml);
    } catch (error: any) {
        console.error("Employee Ticket Eligibility Report Excel Error:", error);
        res.status(500).json({ success: false, message: "Unable to export report", details: error.message });
    } finally {
        if (connection) try { await connection.close(); } catch (e) { console.error(e); }
    }
};