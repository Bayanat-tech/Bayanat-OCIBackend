// src/controllers/wms/reports/LabourCardExpiryReport.controller.ts
//
// HR Labour Card Expiry Listing Report — HTML/print endpoint
// Built on report_common (data-table, report-title, applied filters, header/footer).
// Layout matches the legacy report (rpt_hr_expiry_labourcard_rpt).

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

/** Date -> 'YYYY-MM-DD' string (the format PROC_BUILD_DYNAMIC_SQL_HR_REPORT expects). */
function toYmd(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

// ─── Param Parser ────────────────────────────────────────────────────────────

function allIfBlank(value: unknown): string {
  const v = text(value).trim();
  return v || "All";
}

function parseParams(req: RequestWithUser) {
  const src = { ...(req.query as Record<string, any>), ...(req.body || {}) };

  const userCompany = text(req.user?.company_code).trim();
  const companyCode = userCompany || text(src.company_code).trim() || "";

  // emp_status: 'A' = active only (exclude resigned), anything else / blank = 'All'
  const rawStatus = text(src.emp_status).trim().toUpperCase();
  const empStatus = rawStatus === "A" ? "A" : "All";

  return {
    companyCode,
    divCode: allIfBlank(src.div_code),
    deptCode: allIfBlank(src.dept_code),
    sectCode: allIfBlank(src.section_code ?? src.sect_code),
    gradeCode: allIfBlank(src.grade_code),
    desgCode: allIfBlank(src.desg_code),
    employeeCode: allIfBlank(src.employee_code),
    empStatus,
    fromDate: parseDate(src.from_date),
    toDate: parseDate(src.to_date),
    loginId: text(req.user?.loginid || (req.user as any)?.username || ""),
  };
}

// ─── Data Loader ─────────────────────────────────────────────────────────────

const REPORT_PARAMETER = "Hr_Report_LABOUR_CARD_EXPIRY_LISTING";

async function loadLabourCardData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);

  console.log("[LabourCardExpiry] params:", {
    companyCode: params.companyCode,
    divCode: params.divCode,
    deptCode: params.deptCode,
    sectCode: params.sectCode,
    gradeCode: params.gradeCode,
    desgCode: params.desgCode,
    employeeCode: params.employeeCode,
    empStatus: params.empStatus,
    fromDate: params.fromDate?.toISOString(),
    toDate: params.toDate?.toISOString(),
  });

  if (!params.companyCode) {
    throw Object.assign(new Error("company_code is required"), { status: 400 });
  }
  if (!params.fromDate || !params.toDate) {
    throw Object.assign(new Error("from_date and to_date are required"), { status: 400 });
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
      p_number1: null,
      p_number2: null,
      p_number3: null,
      p_number4: null,
      // Procedure declares P_DATE1..4 as VARCHAR2 ('YYYY-MM-DD') — bind strings.
      p_date1: toYmd(params.fromDate),
      p_date2: toYmd(params.toDate),
      p_date3: null,
      p_date4: null,
      p_return_string: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    // P_CODE1..P_CODE8:
    //   1 company, 2 division, 3 department, 4 section,
    //   5 grade,   6 designation, 7 employee code, 8 emp_status
    const codes = [
      params.companyCode,
      params.divCode,
      params.deptCode,
      params.sectCode,
      params.gradeCode,
      params.desgCode,
      params.employeeCode,
      params.empStatus,
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

    console.log("[LabourCardExpiry] Built SQL:", builtSql);

    if (!builtSql || builtSql.toUpperCase() === "INVALID PARAMETER VALUE") {
      throw Object.assign(new Error("Report procedure returned no query"), { status: 500 });
    }

    const result = await conn.execute(builtSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    console.log("[LabourCardExpiry] Rows returned:", (result.rows as any[])?.length ?? 0);

    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Extra CSS (only what report_common does not already provide) ────────────

const LABOUR_CARD_EXTRA_CSS = `
  .lc-title { text-align: center; letter-spacing: 3px; margin-bottom: 8px; }

  /* Fixed columns + wrapping so nothing overflows or clips */
  table.data-table.lc-table {
    table-layout: fixed;
    width: 100%;
    max-width: 100%;
  }
  table.data-table.lc-table th,
  table.data-table.lc-table td {
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
    border: 1px solid #94a3b8;
  }
  table.data-table.lc-table th { text-align: center; }
  table.data-table.lc-table td.ctr { text-align: center; }
  table.data-table.lc-table td.num { white-space: normal; }
  table.data-table.lc-table td.mono {
    font-family: "Courier New", monospace;
    word-break: break-all;
  }

  /* Two-line cells (Department/Division, Section/Designation) */
  .lc-table .l1 { display: block; font-weight: 600; }
  .lc-table .l2 { display: block; color: #475569; }

  /* Row status colours — !important so they beat report_common's print row striping */
  table.data-table.lc-table tbody tr.status-expired  td { background: #fee2e2 !important; }
  table.data-table.lc-table tbody tr.status-today    td { background: #fef3c7 !important; }
  table.data-table.lc-table tbody tr.status-critical td { background: #ffedd5 !important; }
  table.data-table.lc-table tbody tr.status-active   td { background: #dcfce7 !important; }

  .lc-total { margin-top: 8px; font-weight: 700; }
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusClass(raw: unknown): string {
  const s = text(raw).toLowerCase();
  if (s.includes("expired")) return "status-expired";
  if (s.includes("today")) return "status-today";
  if (s.includes("critical")) return "status-critical";
  if (s.includes("active")) return "status-active";
  return "";
}

/** Inline wrapping rules: inline !important beats any stylesheet rule. */
const WRAP =
  "white-space:normal !important;word-break:break-word !important;overflow-wrap:anywhere !important;min-width:0;";

/** Two-line cell; skips a blank line so nothing leaves a gap. */
function twoLine(first: unknown, second: unknown): string {
  const a = text(first).trim();
  const b = text(second).trim();
  return (
    (a ? `<span class="l1" style="display:block;font-weight:600;${WRAP}">${escapeHtml(a)}</span>` : "") +
    (b ? `<span class="l2" style="display:block;color:#475569;${WRAP}">${escapeHtml(b)}</span>` : "")
  );
}

// ─── Body Renderer ────────────────────────────────────────────────────────────

function renderLabourCardBody(rows: ReportRow[], filtersHtml = ""): string {
  const heading = `
    <div class="doc-title-row">
      <h1 class="report-title lc-title">LABOUR CARD EXPIRY LISTING</h1>
    </div>`;

  if (!rows.length) {
    return `
      ${heading}
      ${filtersHtml}
      <div class="empty">No data found</div>
    `;
  }

  const bodyRows = rows
    .map((r, i) => {
      const employee = [text(r.employee_code), text(r.rpt_name)].filter(Boolean).join(" - ");
      return `
        <tr class="${statusClass(r.status)}">
          <td class="num">${i + 1}</td>
          <td style="${WRAP}">${escapeHtml(employee)}</td>
          <td style="${WRAP}">${twoLine(r.dept_name, r.div_name)}</td>
          <td style="${WRAP}">${twoLine(r.section_name, r.desg_name)}</td>
          <td class="mono">${escapeHtml(r.labourcard_no)}</td>
          <td class="ctr">${escapeHtml(fmtDate(r.labourcard_valid_from))}</td>
          <td class="ctr">${escapeHtml(fmtDate(r.labourcard_valid_to))}</td>
          <td class="ctr">${escapeHtml(r.days_remaining)}</td>
        </tr>`;
    })
    .join("");

  return `
    ${heading}
    ${filtersHtml}
    <table class="data-table lc-table" style="table-layout:fixed;width:100%;max-width:100%;">
      <colgroup>
        <col style="width:5%">
        <col style="width:19%">
        <col style="width:20%">
        <col style="width:20%">
        <col style="width:12%">
        <col style="width:9%">
        <col style="width:9%">
        <col style="width:6%">
      </colgroup>
      <thead>
        <tr>
          <th>SNo.</th>
          <th>Employee</th>
          <th>Department<br/>Division</th>
          <th>Section<br/>Designation</th>
          <th>Labour Card No.</th>
          <th>Valid From</th>
          <th>Valid To</th>
          <th>Valid<br/>Days</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
    <div class="lc-total">Total: ${rows.length}</div>
  `;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export const getLabourCardExpiryReportHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadLabourCardData(req);

    const headerHtml = await reportHeader({ company_code: params.companyCode, req });
    const filtersHtml = reportAppliedFilters([
      { label: "Division", value: [params.divCode] },
      { label: "Department", value: [params.deptCode] },
      { label: "Section", value: [params.sectCode] },
      { label: "Grade", value: [params.gradeCode] },
      { label: "Designation", value: [params.desgCode] },
      { label: "Employee", value: [params.employeeCode] },
      {
        label: "Labour Card Expiry",
        value: [`${fmtDate(params.fromDate)} - ${fmtDate(params.toDate)}`],
      },
      {
        label: "Employee Status",
        value: [params.empStatus === "A" ? "Active Employees" : "All Employees"],
      },
    ]);
    const bodyHtml = renderLabourCardBody(rows, filtersHtml);
    const footerHtml = reportFooter({
      reportName: "rpt_hr_expiry_labourcard_rpt",
      userName: params.loginId,
      endLabel: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: "HR Labour Card Expiry Listing",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: LABOUR_CARD_EXTRA_CSS,
      autoPrint: req.query.print !== "false",
      showPrintButton: true,
      orientation: "portrait",
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Labour Card Expiry Report HTML error:", error);

    const oraNum = error?.errorNum;
    const oraCode = oraNum ? `ORA-${String(oraNum).padStart(5, "0")}` : undefined;

    res.status(error.status || 500).json({
      success: false,
      code: oraCode,
      message: error.message || "Unable to generate report",
    });
  }
};