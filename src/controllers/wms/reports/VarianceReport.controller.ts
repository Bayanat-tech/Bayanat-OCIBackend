// src/controllers/wms/reports/HrVarianceReport.controller.ts

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

function fmtAmount(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${abs})` : abs;
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

  return {
    companyCode,
    divCode: allIfBlank(src.div_code),
    deptCode: allIfBlank(src.dept_code),
    sectCode: allIfBlank(src.section_code ?? src.sect_code),
    employeeCode: allIfBlank(src.employee_code),
    currentPayMonth: allIfBlank(src.curr_pay_month),
    previousPayMonth: allIfBlank(src.prev_pay_month),
    payYear: allIfBlank(src.pay_year),
    reportType: allIfBlank(src.report_type),
    historyReport: text(src.history_report).trim().toUpperCase() === "Y" ? "Y" : "N",
    showDifferenceOnly: text(src.as_difference_only).trim().toUpperCase() === "Y" ? "Y" : "N",
    loginId: text(req.user?.loginid || (req.user as any)?.username || ""),
  };
}

// ─── Data Loader ─────────────────────────────────────────────────────────────

async function loadVarianceReportData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);

  console.log("[VarianceReport] params:", params);

  if (!params.companyCode) {
    throw Object.assign(new Error("company_code is required"), { status: 400 });
  }

  const conn = await getConn(req);

  try {
    const binds: Record<string, any> = {
      p_parameter: "Hr_Report_VARIANCE_REPORT", // Must match the WHEN block in your procedure
      p_loginid: params.loginId,
      
      // Mapped per your procedure parameters
      p_code1: params.companyCode,
      p_code2: params.divCode,
      p_code3: params.deptCode,
      p_code4: params.sectCode,
      p_code5: params.employeeCode,
      p_code6: params.currentPayMonth,
      p_code7: params.previousPayMonth,
      p_code8: params.payYear,
      p_code9: params.reportType,
      p_code10: params.showDifferenceOnly,
      p_code11: params.historyReport,

      p_number1: null,
      p_number2: null,
      p_number3: null,
      p_number4: null,
      p_date1: { val: null, type: oracledb.DATE },
      p_date2: { val: null, type: oracledb.DATE },
      p_date3: { val: null, type: oracledb.DATE },
      p_date4: { val: null, type: oracledb.DATE },
      p_return_string: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    // Fill remaining p_code parameters with null just in case
    for (let i = 12; i <= 20; i++) {
      binds[`p_code${i}`] = null;
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

    console.log("[VarianceReport] Built SQL:", builtSql);

    if (!builtSql || builtSql.toUpperCase() === "INVALID PARAMETER VALUE") {
      throw Object.assign(new Error("Report procedure returned no query"), { status: 500 });
    }

    const result = await conn.execute(builtSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    console.log("[VarianceReport] Rows returned:", (result.rows as any[])?.length ?? 0);

    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── CSS for HTML Report ─────────────────────────────────────────────────────

const VARIANCE_EXTRA_CSS = `
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }
  body, table.var-table { font-family: Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif; }
  .doc-title-row { display: flex; justify-content: space-between; align-items: flex-start; margin: 4px 0 10px 0; }
  body .doc-title-row h1 { margin: 0; font-size: 16px; font-weight: 800; color: #00378c !important; letter-spacing: 0; }
  
  table.var-table { width: 100%; max-width: 100%; border-collapse: collapse; table-layout: auto; font-size: 10px; margin-top: 6px; border: 0; }
  table.var-table thead th { background: #00378c !important; color: #ffffff !important; font-weight: 700; font-size: 10px; padding: 8px 6px; text-align: left; border: 0 !important; box-shadow: inset 0 0 0 1000px #00378c; }
  table.var-table thead th.num-head { text-align: right; }
  
  table.var-table tbody td { padding: 5px 6px; border: 0; border-bottom: 1px solid #e2e8f0 !important; color: #1e293b; font-size: 10px; font-weight: 400; background: #fcfdfe; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .center { text-align: center; }
  
  table.var-table tbody tr.grand-total-row td { background: #e2e8f0 !important; color: #00378c !important; font-weight: 800; border-bottom: 1px solid #cbd5e1 !important; }

  .var-empty { border: 1px dashed #cbd5e1; background: #f8fafc; text-align: center; padding: 40px 12px; margin-top: 14px; color: #64748b; font-weight: 700; }

  @media print {
    table.var-table thead { display: table-header-group; }
    table.var-table tr { page-break-inside: avoid; }
    table.var-table thead th { background: #00378c !important; color: #ffffff !important; box-shadow: inset 0 0 0 1000px #00378c; }
  }
`;

const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">`;

// ─── Column detection ────────────────────────────────────────────────────────

type ColKind = "text" | "date" | "amount";
const NO_TOTAL_RE = /(^|_)(id|code|no|sno|year|month|days?|age)$/i;

function detectColumns(rows: ReportRow[]) {
  const keys = Object.keys(rows[0] || {});
  return keys.map((key) => {
    const sample = rows.map((r) => r[key]).filter((v) => v != null && v !== "");
    let kind: ColKind = "text";
    if (sample.length && sample.every((v) => typeof v === "number")) kind = "amount";
    return {
      key,
      kind,
      label: key.replace(/_/g, " ").toUpperCase(),
      total: kind === "amount" && !NO_TOTAL_RE.test(key),
    };
  });
}

// ─── Body Renderer ────────────────────────────────────────────────────────────

function renderVarianceReportBody(rows: ReportRow[], filtersHtml = ""): string {
  const heading = `${FONT_LINK}<div class="doc-title-row"><div><h1>HR Variance Report</h1></div></div>`;

  if (!rows.length) {
    return `${heading}${filtersHtml}<div class="var-empty">No data found</div>`;
  }

  const cols = detectColumns(rows);

  const headCells =
    `<th class="num-head">SNo.</th>` +
    cols.map((c) => `<th class="${c.kind === "amount" ? "num-head" : ""}">${escapeHtml(c.label)}</th>`).join("");

  const cell = (c: (typeof cols)[number], v: unknown): string => {
    if (c.kind === "amount") return `<td class="num">${fmtAmount(Number(v) || 0)}</td>`;
    return `<td>${escapeHtml(v)}</td>`;
  };

  const bodyRows = rows.map((r, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        ${cols.map((c) => cell(c, r[c.key])).join("")}
      </tr>`).join("");

  const totalCells = cols.map((c) => {
    if (!c.total) return `<td></td>`;
    const sum = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
    return `<td class="num">${fmtAmount(sum)}</td>`;
  }).join("");

  const grandTotal = `<tr class="grand-total-row"><td class="num">TOTAL (${rows.length})</td>${totalCells}</tr>`;

  return `
    ${heading}
    ${filtersHtml}
    <table class="var-table">
      <thead><tr>${headCells}</tr></thead>
      <tbody>${bodyRows}${grandTotal}</tbody>
    </table>
  `;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export const getHrVarianceReportHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadVarianceReportData(req);

    const headerHtml = await reportHeader({ company_code: params.companyCode, req });
    
    const filtersHtml = reportAppliedFilters([
      { label: "Division", value: [params.divCode] },
      { label: "Department", value: [params.deptCode] },
      { label: "Section", value: [params.sectCode] },
      { label: "Employee", value: [params.employeeCode] },
      { label: "Pay Year", value: [params.payYear] },
      { label: "Current Month", value: [params.currentPayMonth] },
      { label: "Previous Month", value: [params.previousPayMonth] },
      { label: "Report Type", value: [params.reportType] },
    ]);

    const bodyHtml = renderVarianceReportBody(rows, filtersHtml);
    const footerHtml = reportFooter({
      reportName: "rpt_hr_variance",
      userName: params.loginId,
      endLabel: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: "HR Variance Report",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: VARIANCE_EXTRA_CSS,
      autoPrint: req.query.print !== "false",
      showPrintButton: true,
      orientation: "landscape",
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("HR Variance Report HTML error:", error);
    const oraNum = error?.errorNum;
    const oraCode = oraNum ? `ORA-${String(oraNum).padStart(5, "0")}` : undefined;

    res.status(error.status || 500).json({
      success: false,
      code: oraCode,
      message: error.message || "Unable to generate report",
    });
  }
};