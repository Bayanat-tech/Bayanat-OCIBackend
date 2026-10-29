// src/controllers/wms/reports/SectionMasterReport.controller.ts
//
// Section Master Report — HTML/print endpoint
//
//  • Uses the same DB helper / tenant resolution as the Absent Memo report.
//  • Calls PROC_BUILD_DYNAMIC_SQL_HR_REPORT with parameter 'MST_HR_MS_HR_SECTION'.
//  • Renders a standard table layout matching the Absent Memo styling.

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

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Request Param Parser ────────────────────────────────────────────────────

function parseParams(req: RequestWithUser) {
  const pick = (v: unknown) => (v == null ? "" : String(v).trim());
  return {
    companyCode:
      req.user?.company_code ||
      pick(req.body?.company_code) ||
      pick(req.query?.company_code) ||
      "",
    divCode: pick(req.body?.div_code) || "All",
    deptCode: pick(req.body?.dept_code) || "All",
    sectionCode: pick(req.body?.section_code) || "All",
    loginId: pick(req.user?.loginid || (req.user as any)?.username),
  };
}

// ─── Data Loader (via stored procedure) ──────────────────────────────────────

const REPORT_PARAMETER = "MST_HR_MS_HR_SECTION";

async function loadSectionData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);

  if (!params.companyCode) {
    throw Object.assign(new Error("company_code is required"), { status: 400 });
  }

  const conn = await getConn(req);

  try {
    // Step 1: procedure builds the SELECT text
    const binds: Record<string, any> = {
      p_parameter: REPORT_PARAMETER,
      p_loginid: params.loginId,
      p_code1: params.companyCode,
      p_code2: params.divCode,
      p_code3: params.deptCode,
      p_code4: params.sectionCode,
      p_number1: 0,
      p_number2: 0,
      p_number3: 0,
      p_number4: 0,
      p_date1: { val: null, type: oracledb.DATE },
      p_date2: { val: null, type: oracledb.DATE },
      p_date3: { val: null, type: oracledb.DATE },
      p_date4: { val: null, type: oracledb.DATE },
      p_return_string: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };
    
    for (let i = 5; i <= 20; i++) binds[`p_code${i}`] = null;

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

    if (!builtSql || builtSql.toUpperCase() === "INVALID PARAMETER VALUE") {
      throw Object.assign(new Error("Report procedure returned no query"), { status: 500 });
    }

    // Step 2: run the SELECT the procedure returned
    const result = await conn.execute(builtSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Section Master CSS (Matches Absent Memo Table Style) ─────────────────────

const SECTION_EXTRA_CSS = `
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }

  @page { size: A4 landscape; }

  .memo-title {
    text-align: center;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 4px;
    padding: 5px 0;
    margin: 0 0 10px;
    border-bottom: 1px solid #cbd5e1;
  }

  table.lines-table { 
    width: 100%; 
    border-collapse: collapse; 
    margin: 18px 0 0; 
  }
  table.lines-table th {
    padding: 5px 8px;
    background: #00378c;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    text-align: left;
  }
  table.lines-table td { 
    padding: 6px 8px; 
    font-size: 9.5px; 
    vertical-align: middle; 
  }
  table.lines-table .num { text-align: right; }
  table.lines-table .center { text-align: center; }
  table.lines-table tr.total td {
    border-top: 1px solid #1e293b;
    border-bottom: 1px solid #1e293b;
    font-weight: 700;
    font-size: 9.5px;
  }
`;

// ─── HTML Body Renderer ───────────────────────────────────────────────────────

function renderSectionBody(rows: ReportRow[], filtersHtml = ""): string {
  const heading = `<div class="memo-title">LIST OF SECTIONS</div>`;

  if (!rows.length) {
    return `
      ${heading}
      ${filtersHtml}
      <p style="text-align:center;color:#666;margin-top:20px;">No data found</p>
    `;
  }

  const linesHtml = rows.map((r) => {
    const status = escapeHtml(r.status) === 'A' || escapeHtml(r.status) === 'Y' ? 'Active' : escapeHtml(r.status);
    
    return `
      <tr>
        <td class="center">${escapeHtml(r.section_code)}</td>
        <td>${escapeHtml(r.section_name)}</td>
        <td class="center">${escapeHtml(r.sect_head_id)}</td>
        <td>${escapeHtml(r.sect_addr1)}</td>
        <td class="center">${escapeHtml(r.staff_cntrl_ac_group)}</td>
        <td class="center">${escapeHtml(r.staff_loan_ac_group)}</td>
        <td class="center">${escapeHtml(r.salary_expense_ac_code)}</td>
        <td class="center">${status}</td>
      </tr>
    `;
  }).join("");

  return `
    ${heading}
    ${filtersHtml}
    <table class="lines-table">
      <thead>
        <tr>
          <th style="width: 8%; text-align: center;">Section</th>
          <th style="width: 25%;">Section Name</th>
          <th style="width: 10%; text-align: center;">Head</th>
          <th style="width: 25%;">Address</th>
          <th style="width: 8%; text-align: center;">Staff<br/>Control A/C</th>
          <th style="width: 8%; text-align: center;">Staff<br/>Loan A/C</th>
          <th style="width: 8%; text-align: center;">Salary<br/>Exp A/C</th>
          <th style="width: 8%; text-align: center;">Status</th>
        </tr>
      </thead>
      <tbody>
        ${linesHtml}
      </tbody>
    </table>
  `;
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

export const getSectionMasterReportHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadSectionData(req);

    const headerHtml = await reportHeader({ company_code: params.companyCode, req });
    
    // Hide filters to match the clean look
    const filtersHtml = ""; 
    
    const bodyHtml = renderSectionBody(rows, filtersHtml);
    const footerHtml = reportFooter({
      reportName: "rpt_hr_section",
      userName: params.loginId,
      endLabel: "End of Report",
    });

    const html = buildReportDocument({
      title: "List of Sections",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: SECTION_EXTRA_CSS,
      autoPrint: req.query.print !== "false",
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Section Master Report HTML error:", error);

    const oraNum = error?.errorNum;
    const oraCode = oraNum ? `ORA-${String(oraNum).padStart(5, "0")}` : undefined;

    res.status(error.status || 500).json({
      success: false,
      code: oraCode,
      message: error.message || "Unable to generate report",
    });
  }
};