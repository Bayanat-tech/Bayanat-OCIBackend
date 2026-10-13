// src/pages/hr/Reports/RetirementReportHtml.ts (or controllers/wms/reports/RetirementReport.controller.ts)
//
// HR Retirement Report — HTML/print endpoint

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

// ─── Extra CSS ────────────────────────────────────────────────────────────────

const RETIREMENT_EXTRA_CSS = `
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

  .ret-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
    margin-top: 8px;
  }
  .ret-table th,
  .ret-table td {
    border: 1px solid #94a3b8;
    padding: 3px 5px;
    text-align: left;
    vertical-align: top;
  }
  .ret-table th {
    background: #f1f5f9;
    font-weight: 700;
    white-space: nowrap;
  }
  .ret-table td.num { text-align: right; }
  .ret-table td.ret { font-weight: 700; }
  .ret-table thead { display: table-header-group; }
  .ret-table tr { page-break-inside: avoid; }

  .ret-total {
    margin-top: 8px;
    font-size: 10.5px;
    font-weight: 700;
  }
`;

// ─── Body Renderer ────────────────────────────────────────────────────────────

function renderRetirementBody(rows: ReportRow[], filtersHtml = ""): string {
  const heading = `<div class="rpt-title">RETIREMENT REPORT</div>`;

  if (!rows.length) {
    return `
      ${heading}
      ${filtersHtml}
      <p class="center muted">No data found</p>
    `;
  }

  const bodyRows = rows
    .map(
      (r, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td>${escapeHtml(r.employee_code ?? r.emplyee_code)}</td>
          <td>${escapeHtml(r.rpt_name)}</td>
          <td>${escapeHtml(fmtDate(r.birth_date))}</td>
          <td class="num">${escapeHtml(r.age)}</td>
          <td>${escapeHtml(fmtDate(r.join_date))}</td>
          <td class="ret">${escapeHtml(fmtDate(r.date_of_retirement))}</td>
        </tr>`,
    )
    .join("");

  return `
    ${heading}
    ${filtersHtml}
    <table class="ret-table">
      <thead>
        <tr>
          <th style="width:32px">#</th>
          <th style="width:110px">Employee</th>
          <th>Employee Name</th>
          <th style="width:110px">Date of Birth</th>
          <th style="width:80px">Current Age</th>
          <th style="width:110px">Join Date</th>
          <th style="width:130px">Date of Retirement</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
    <div class="ret-total">Total: ${rows.length}</div>
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