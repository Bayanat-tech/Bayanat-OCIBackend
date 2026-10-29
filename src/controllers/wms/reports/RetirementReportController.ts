// src/controllers/wms/reports/RetirementReport.controller.ts
//
// HR Retirement Report — HTML/print endpoint
// Visual style matches the Labour Card Expiry / Freight Expense preview:
//   • navy header row (white text, no cell borders)
//   • plain data rows, thin bottom border, no zebra
//   • ALL data cells same weight (400), colour and size
//   • bold-navy grand total (#e2e8f0)

import { Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import {
  reportHeader,
  reportFooter,
  reportAppliedFilters,
  buildReportDocument,
} from "../../common/report_common";

type ReportRow = Record<string, any>;

// ─── DB Helpers ───────────────────────────────────────────────────────────────

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid)
    tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenantId)
    throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
  return TenantManager.getConnection(tenantId);
}

async function closeConn(conn?: oracledb.Connection) {
  if (conn)
    try {
      await conn.close();
    } catch (e) {
      console.warn("Close conn error:", e);
    }
}

function normalize(rows: any[] = []): ReportRow[] {
  return rows.map((row) =>
    Object.keys(row).reduce((acc: ReportRow, key) => {
      acc[key.toLowerCase()] = row[key];
      return acc;
    }, {}),
  );
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function escapeHtml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(value: unknown): string {
  if (!value) return "";
  const d = new Date(value as any);
  if (Number.isNaN(d.getTime())) return text(value).slice(0, 10);
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dd}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

function parseDate(value: unknown): Date | null {
  const v = text(value).trim();
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Returns "YYYY-MM-DD" (first 10 chars) if the value looks like an ISO date, else "". */
function isoDateStr(value: unknown): string {
  const v = text(value).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}

// ─── Param Parser ────────────────────────────────────────────────────────────

function allIfBlank(value: unknown): string {
  const v = text(value).trim();
  return v || "All";
}

function parseParams(req: RequestWithUser) {
  const src = { ...(req.query as Record<string, any>), ...(req.body || {}) };

  // Prefer the logged-in user's company, but TRIM in case DB has trailing spaces.
  const userCompany = text(req.user?.company_code).trim();
  const companyCode = userCompany || text(src.company_code).trim() || "";

  return {
    companyCode,
    divCode: allIfBlank(src.div_code),
    deptCode: allIfBlank(src.dept_code),
    sectCode: allIfBlank(src.section_code ?? src.sect_code),
    employeeCode: allIfBlank(src.employee_code),
    fromDate: parseDate(src.from_date),
    toDate: parseDate(src.to_date),
    // 'YYYY-MM-DD' text – the procedure's P_DATE1..4 are VARCHAR2 and parse this exact format
    fromDateStr: isoDateStr(src.from_date),
    toDateStr: isoDateStr(src.to_date),
    loginId: text(req.user?.loginid || (req.user as any)?.username || ""),
  };
}

// ─── Data Loader ─────────────────────────────────────────────────────────────

const REPORT_PARAMETER = "Hr_Report_RETIREMENT_REPORT";

async function loadRetirementData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);

  console.log("[RetirementReport] params:", {
    companyCode: params.companyCode,
    divCode: params.divCode,
    deptCode: params.deptCode,
    sectCode: params.sectCode,
    employeeCode: params.employeeCode,
    fromDate: params.fromDateStr,
    toDate: params.toDateStr,
  });

  if (!params.companyCode) {
    throw Object.assign(new Error("company_code is required"), { status: 400 });
  }
  if (!params.fromDate || !params.toDate || !params.fromDateStr || !params.toDateStr) {
    throw Object.assign(new Error("from_date and to_date are required (YYYY-MM-DD)"), {
      status: 400,
    });
  }
  if (params.fromDate > params.toDate) {
    throw Object.assign(new Error("'From Date' cannot be greater than 'To Date'"), {
      status: 400,
    });
  }

  const conn = await getConn(req);

  try {
    const binds: Record<string, any> = {
      p_parameter: REPORT_PARAMETER,
      p_loginid: params.loginId,
      p_number1: { val: null, type: oracledb.NUMBER },
      p_number2: { val: null, type: oracledb.NUMBER },
      p_number3: { val: null, type: oracledb.NUMBER },
      p_number4: { val: null, type: oracledb.NUMBER },
      // Procedure params are VARCHAR2 ('YYYY-MM-DD') – send text, NOT oracledb.DATE
      p_date1: { val: params.fromDateStr, type: oracledb.STRING },
      p_date2: { val: params.toDateStr, type: oracledb.STRING },
      p_date3: { val: null, type: oracledb.STRING },
      p_date4: { val: null, type: oracledb.STRING },
      p_return_string: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    const codes = [
      params.companyCode,
      params.divCode,
      params.deptCode,
      params.sectCode,
      params.employeeCode,
    ];
    for (let i = 1; i <= 20; i++) {
      binds[`p_code${i}`] = i <= codes.length ? codes[i - 1] : null;
    }

    const codeArgs = Array.from({ length: 20 }, (_, i) => `:p_code${i + 1}`).join(", ");

    const procResult = await conn.execute(
      `BEGIN
         PROC_BUILD_DYNAMIC_SQL_HR_REPORT(
           :p_parameter, :p_loginid,
           ${codeArgs},
           :p_number1, :p_number2, :p_number3, :p_number4,
           :p_date1, :p_date2, :p_date3, :p_date4,
           :p_return_string
         );
       END;`,
      binds,
    );

    const builtSql = text((procResult.outBinds as any)?.p_return_string).trim();

    console.log("[RetirementReport] Built SQL:", builtSql);

    if (!builtSql || builtSql.toUpperCase() === "INVALID PARAMETER VALUE") {
      throw Object.assign(new Error("Report procedure returned no query"), { status: 500 });
    }

    const result = await conn.execute(builtSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    console.log("[RetirementReport] Rows returned:", (result.rows as any[])?.length ?? 0);

    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Extra CSS — matches the Labour Card Expiry / Freight Expense preview ────
//
//   navy          = #00378c  (header bar, title, totals)
//   grandStrip    = #e2e8f0  (Grand Total row)
//   rowBg         = #fcfdfe  (data rows)
//   rule          = #e2e8f0  (thin bottom border under each row)

const RETIREMENT_EXTRA_CSS = `
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }

  body, table.ret-table {
    font-family: Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  }

  /* ── Title ──────────────────────────────────────────────────────────── */
  .doc-title-row {
    display: flex; justify-content: space-between; align-items: flex-start;
    margin: 4px 0 10px 0;
  }
  body .doc-title-row h1 {
    margin: 0;
    font-size: 16px;
    font-weight: 800;
    color: #00378c !important;   /* beats report_common's print override (#0b4ca1) */
    letter-spacing: 0;
  }

  /* ── Table reset ────────────────────────────────────────────────────── */
  table.ret-table {
    width: 100%;
    max-width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 10.5px;
    margin-top: 6px;
    border: 0;
  }

  /* ── Navy header ────────────────────────────────────────────────────── */
  table.ret-table thead th {
    background: #00378c !important;
    color: #ffffff !important;
    font-weight: 700;
    font-size: 10.5px;
    letter-spacing: 0;
    padding: 10px 8px;
    text-align: left;
    vertical-align: middle;
    border: 0 !important;
    box-shadow: inset 0 0 0 1000px #00378c;
    white-space: normal;
    overflow-wrap: break-word;
    word-break: normal;
  }
  table.ret-table thead th.num-head { text-align: right; }
  table.ret-table thead th.center-head { text-align: center; }

  /* ── Data rows — every cell: same weight, colour, size ─────────────── */
  table.ret-table tbody td {
    padding: 6px 8px;
    border: 0;
    border-bottom: 1px solid #e2e8f0 !important;
    color: #1e293b;
    font-size: 10.5px;
    font-weight: 400;
    background: #fcfdfe;
    vertical-align: middle;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  /* ── Alignment ─────────────────────────────────────────────────────── */
  .center { text-align: center; }
  .left   { text-align: left; }
  .right  { text-align: right; }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* ── Grand Total ───────────────────────────────────────────────────── */
  table.ret-table tbody tr.grand-total-row td {
    background: #e2e8f0 !important;
    color: #00378c !important;
    font-weight: 800;
    text-align: right;
    border-bottom: 1px solid #cbd5e1 !important;
  }

  /* ── Empty state ───────────────────────────────────────────────────── */
  .ret-empty {
    border: 1px dashed #cbd5e1;
    background: #f8fafc;
    text-align: center;
    padding: 40px 12px;
    margin-top: 14px;
    color: #64748b;
    font-weight: 700;
  }

  /* ── Screen-only compact sizing (print unaffected) ─────────────────── */
  @media screen {
    body .doc-title-row h1 { font-size: 13px; }
    table.ret-table { font-size: 9.5px; }
    table.ret-table thead th { font-size: 9.5px; padding: 7px 6px; }
    table.ret-table tbody td { padding: 5px 6px; font-size: 9.5px; }
  }

  /* ── Print: keep navy header, avoid row splits ─────────────────────── */
  @media print {
    body .doc-title-row h1 { color: #00378c !important; }

    table.ret-table thead { display: table-header-group; }
    table.ret-table tr    { page-break-inside: avoid; }

    table.ret-table thead th {
      background: #00378c !important;
      color: #ffffff !important;
      box-shadow: inset 0 0 0 1000px #00378c;
    }
  }
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Loads Inter so the PDF renderer doesn't fall back to a wide system font. */
const FONT_LINK = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">`;

// ─── Body Renderer ────────────────────────────────────────────────────────────

const COL_COUNT = 7;

function renderRetirementBody(rows: ReportRow[], filtersHtml = ""): string {
  const heading = `
    ${FONT_LINK}
    <div class="doc-title-row">
      <div><h1>Retirement Report</h1></div>
    </div>`;

  if (!rows.length) {
    return `
      ${heading}
      ${filtersHtml}
      <div class="ret-empty">No data found</div>
    `;
  }

  const bodyRows = rows
    .map(
      (r, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td>${escapeHtml(r.employee_code ?? r.emplyee_code)}</td>
          <td>${escapeHtml(r.rpt_name)}</td>
          <td class="center">${escapeHtml(fmtDate(r.birth_date))}</td>
          <td class="num">${escapeHtml(r.age)}</td>
          <td class="center">${escapeHtml(fmtDate(r.join_date))}</td>
          <td class="center">${escapeHtml(fmtDate(r.date_of_retirement))}</td>
        </tr>`,
    )
    .join("");

  const grandTotal = `
        <tr class="grand-total-row">
          <td colspan="${COL_COUNT}">GRAND TOTAL (${rows.length} Records):</td>
        </tr>`;

  return `
    ${heading}
    ${filtersHtml}
    <table class="ret-table" style="table-layout:fixed;width:100%;max-width:100%;">
      <colgroup>
        <col style="width:5%">
        <col style="width:13%">
        <col style="width:28%">
        <col style="width:14%">
        <col style="width:10%">
        <col style="width:14%">
        <col style="width:16%">
      </colgroup>
      <thead>
        <tr>
          <th class="num-head">SNo.</th>
          <th>Employee</th>
          <th>Employee Name</th>
          <th class="center-head">Date of Birth</th>
          <th class="num-head">Current Age</th>
          <th class="center-head">Join Date</th>
          <th class="center-head">Date of Retirement</th>
        </tr>
      </thead>
      <tbody>${bodyRows}${grandTotal}</tbody>
    </table>
  `;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export const getRetirementReportHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadRetirementData(req);

    const headerHtml = await reportHeader({ company_code: params.companyCode, req });
    const filtersHtml = reportAppliedFilters([
      { label: "Division", value: [params.divCode] },
      { label: "Department", value: [params.deptCode] },
      { label: "Section", value: [params.sectCode] },
      { label: "Employee", value: [params.employeeCode] },
      {
        label: "Retirement Between",
        value: [`${fmtDate(params.fromDate)} - ${fmtDate(params.toDate)}`],
      },
    ]);
    const bodyHtml = renderRetirementBody(rows, filtersHtml);
    const footerHtml = reportFooter({
      reportName: "rpt_retirement",
      userName: params.loginId,
      endLabel: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: "Retirement Report",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: RETIREMENT_EXTRA_CSS,
      autoPrint: req.query.print !== "false",
      showPrintButton: true,
      orientation: "portrait",
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Retirement Report HTML error:", error);

    const oraNum = error?.errorNum;
    const oraCode = oraNum ? `ORA-${String(oraNum).padStart(5, "0")}` : undefined;

    res.status(error.status || 500).json({
      success: false,
      code: oraCode,
      message: error.message || "Unable to generate report",
    });
  }
};