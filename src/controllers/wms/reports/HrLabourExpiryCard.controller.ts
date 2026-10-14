// src/pages/hr/Reports/LabourCardExpiryReportHtml.ts
// (or controllers/wms/reports/LabourCardExpiryReport.controller.ts)
//
// HR Labour Card Expiry Listing Report — HTML/print endpoint

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

// ─── Param Parser ────────────────────────────────────────────────────────────

function allIfBlank(value: unknown): string {
  const v = text(value).trim();
  return v || "All";
}

function parseParams(req: RequestWithUser) {
  const src = { ...(req.query as Record<string, any>), ...(req.body || {}) };

  // Prefer the logged-in user's company, TRIM in case DB has trailing spaces.
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
      p_date1: { val: params.fromDate, type: oracledb.DATE },
      p_date2: { val: params.toDate, type: oracledb.DATE },
      p_date3: { val: null, type: oracledb.DATE },
      p_date4: { val: null, type: oracledb.DATE },
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

// ─── Extra CSS ────────────────────────────────────────────────────────────────

const LABOUR_CARD_EXTRA_CSS = `
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }

  .rpt-title {
    text-align: center;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 3px;
    padding: 5px 0;
    margin: 0 0 10px;
    border-bottom: 1px solid #cbd5e1;
  }

  .lc-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5px;
    margin-top: 8px;
  }
  .lc-table th,
  .lc-table td {
    border: 1px solid #94a3b8;
    padding: 3px 5px;
    text-align: left;
    vertical-align: top;
  }
  .lc-table th {
    background: #f1f5f9;
    font-weight: 700;
    white-space: nowrap;
  }
  .lc-table td.num { text-align: right; }
  .lc-table td.ctr { text-align: center; }
  .lc-table td.mono { font-family: "Courier New", monospace; letter-spacing: 0.5px; }
  .lc-table thead { display: table-header-group; }
  .lc-table tr { page-break-inside: avoid; }

  /* Row status colouring */
  .lc-table tr.status-expired  td { background: #fee2e2; }
  .lc-table tr.status-today    td { background: #fef3c7; }
  .lc-table tr.status-critical td { background: #ffedd5; }
  .lc-table tr.status-active   td { background: #dcfce7; }

  .lc-badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 8px;
    font-size: 8.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .lc-badge.expired  { background: #dc2626; color: #fff; }
  .lc-badge.today    { background: #d97706; color: #fff; }
  .lc-badge.critical { background: #ea580c; color: #fff; }
  .lc-badge.active   { background: #16a34a; color: #fff; }

  .lc-total {
    margin-top: 8px;
    font-size: 10.5px;
    font-weight: 700;
  }
`;

// ─── Row Status Helper ────────────────────────────────────────────────────────

function statusClass(raw: unknown): string {
  const s = text(raw).toLowerCase();
  if (s.includes("expired")) return "status-expired";
  if (s.includes("today")) return "status-today";
  if (s.includes("critical")) return "status-critical";
  if (s.includes("active")) return "status-active";
  return "";
}

function statusBadgeClass(raw: unknown): string {
  const s = text(raw).toLowerCase();
  if (s.includes("expired")) return "expired";
  if (s.includes("today")) return "today";
  if (s.includes("critical")) return "critical";
  if (s.includes("active")) return "active";
  return "";
}

// ─── Body Renderer ────────────────────────────────────────────────────────────

function renderLabourCardBody(rows: ReportRow[], filtersHtml = ""): string {
  const heading = `<div class="rpt-title">LABOUR CARD EXPIRY LISTING</div>`;

  if (!rows.length) {
    return `
      ${heading}
      ${filtersHtml}
      <p class="center muted">No data found</p>
    `;
  }

  const bodyRows = rows
    .map((r, i) => {
      const rowCls = statusClass(r.status);
      const badgeCls = statusBadgeClass(r.status);
      return `
        <tr class="${rowCls}">
          <td class="num">${i + 1}</td>
          <td>${escapeHtml(r.employee_code)}</td>
          <td>${escapeHtml(r.rpt_name)}</td>
          <td>${escapeHtml(fmtDate(r.join_date))}</td>
          <td>${escapeHtml(r.div_name)}</td>
          <td>${escapeHtml(r.dept_name)}</td>
          <td>${escapeHtml(r.section_name)}</td>
          <td>${escapeHtml(r.desg_name)}</td>
          <td>${escapeHtml(r.grade_name)}</td>
          <td>${escapeHtml(r.sponsor_name)}</td>
          <td class="mono">${escapeHtml(r.labourcard_no)}</td>
          <td>${escapeHtml(fmtDate(r.labourcard_valid_from))}</td>
          <td>${escapeHtml(fmtDate(r.labourcard_valid_to))}</td>
          <td>${escapeHtml(fmtDate(r.visa_valid_from))}</td>
          <td>${escapeHtml(fmtDate(r.visa_valid_to))}</td>
          <td class="ctr">${escapeHtml(r.days_remaining)}</td>
          <td class="ctr">${
            r.status
              ? `<span class="lc-badge ${badgeCls}">${escapeHtml(r.status)}</span>`
              : ""
          }</td>
        </tr>`;
    })
    .join("");

  return `
    ${heading}
    ${filtersHtml}
    <table class="lc-table">
      <thead>
        <tr>
          <th style="width:26px">#</th>
          <th style="width:70px">Emp Code</th>
          <th>Employee Name</th>
          <th style="width:70px">Join Date</th>
          <th>Division</th>
          <th>Department</th>
          <th>Section</th>
          <th>Designation</th>
          <th>Grade</th>
          <th>Sponsor</th>
          <th style="width:90px">Labour Card No</th>
          <th style="width:70px">LC From</th>
          <th style="width:70px">LC To</th>
          <th style="width:70px">Visa From</th>
          <th style="width:70px">Visa To</th>
          <th style="width:50px">Days Left</th>
          <th style="width:70px">Status</th>
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
      reportName: "rpt_labour_card_expiry",
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
      orientation: "landscape", // 17 columns → landscape reads far better
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