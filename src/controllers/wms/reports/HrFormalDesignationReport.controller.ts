// src/controllers/wms/reports/FormalDesignationReport.controller.ts

import { Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import {
  reportHeader,
  reportFooter,
  buildReportDocument,
} from "../../common/report_common";

type ReportRow = Record<string, any>;

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid)
    tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenantId)
    throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
  return TenantManager.getConnection(tenantId);
}

async function closeConn(conn?: oracledb.Connection) {
  if (conn) try { await conn.close(); } catch (e) { console.warn(e); }
}

function normalize(rows: any[] = []): ReportRow[] {
  return rows.map((row) =>
    Object.keys(row).reduce((acc: ReportRow, key) => {
      acc[key.toLowerCase()] = row[key];
      return acc;
    }, {})
  );
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function escapeHtml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseParams(req: RequestWithUser) {
  const pick = (v: unknown) => (v == null ? "" : String(v).trim());
  return {
    companyCode: req.user?.company_code || pick(req.body?.company_code) || pick(req.query?.company_code) || "",
    labourDesgCode: pick(req.body?.labour_desg_code) || "All",
    loginId: pick(req.user?.loginid || (req.user as any)?.username),
  };
}

const REPORT_PARAMETER = "MST_HR_LABOUR_DESIGNATION";

async function loadData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);
  if (!params.companyCode) throw Object.assign(new Error("company_code required"), { status: 400 });

  const conn = await getConn(req);
  try {
    const binds: Record<string, any> = {
      p_parameter: REPORT_PARAMETER,
      p_loginid: params.loginId,
      p_code1: params.companyCode,
      p_code2: params.labourDesgCode,
      p_number1: 0, p_number2: 0, p_number3: 0, p_number4: 0,
      p_date1: { val: null, type: oracledb.DATE },
      p_date2: { val: null, type: oracledb.DATE },
      p_date3: { val: null, type: oracledb.DATE },
      p_date4: { val: null, type: oracledb.DATE },
      p_return_string: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };
    
    for (let i = 3; i <= 20; i++) binds[`p_code${i}`] = null;
    const codeArgs = Array.from({ length: 20 }, (_, i) => `:p_code${i + 1}`).join(", ");

    const procResult = await conn.execute(
      `BEGIN PROC_BUILD_DYNAMIC_SQL_HR_REPORT(
         :p_parameter, :p_loginid, ${codeArgs},
         :p_number1, :p_number2, :p_number3, :p_number4,
         :p_date1, :p_date2, :p_date3, :p_date4, :p_return_string
       ); END;`, binds
    );

    const builtSql = text((procResult.outBinds as any)?.p_return_string).trim();
    if (!builtSql || builtSql.toUpperCase() === "INVALID PARAMETER VALUE") {
      throw Object.assign(new Error("No query returned"), { status: 500 });
    }

    const result = await conn.execute(builtSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── CSS (Matches Section Master Table Style) ─────────────────────────────────

const EXTRA_CSS = `
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }

  @page { size: A4 portrait; }

  .memo-title {
    text-align: center;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 4px;
    padding: 5px 0;
    margin: 0 0 10px;
    border-bottom: 1px solid #cbd5e1;
    text-transform: uppercase;
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
`;

// ─── HTML Body Renderer ───────────────────────────────────────────────────────

function renderBody(rows: ReportRow[]): string {
  const heading = `<div class="memo-title">List of Formal Designations</div>`;
  
  if (!rows.length) {
    return `${heading}<p style="text-align:center;color:#666;margin-top:20px;">No data found</p>`;
  }

  const linesHtml = rows.map(r => {
    const status = escapeHtml(r.status) === 'A' || escapeHtml(r.status) === 'Y' ? 'Active' : escapeHtml(r.status);
    
    return `
      <tr>
        <td class="center" style="width: 15%;">${escapeHtml(r.labour_desg_code)}</td>
        <td style="width: 45%;">${escapeHtml(r.labour_desg_name)}</td>
        <td class="center" style="width: 20%;">${escapeHtml(r.labour_desg_short_name)}</td>
        <td class="center" style="width: 20%;">${status}</td>
      </tr>
    `;
  }).join("");

  return `
    ${heading}
    <table class="lines-table">
      <thead>
        <tr>
          <th style="text-align: center;">Labour Designation</th>
          <th>Name</th>
          <th style="text-align: center;">Short Name</th>
          <th style="text-align: center;">Status</th>
        </tr>
      </thead>
      <tbody>
        ${linesHtml}
      </tbody>
    </table>
  `;
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export const getFormalDesignationReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadData(req);
    const headerHtml = await reportHeader({ company_code: params.companyCode, req });
    const bodyHtml = renderBody(rows);
    const footerHtml = reportFooter({ 
      reportName: "rpt_hr_labour_desg", 
      userName: params.loginId, 
      endLabel: "End of Report" 
    });

    const html = buildReportDocument({
      title: "Formal Designation Master",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: EXTRA_CSS,
      autoPrint: req.query.print !== "false",
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Formal Designation Report error:", error);
    res.status(error.status || 500).json({ 
      success: false, 
      message: error.message || "Unable to generate report" 
    });
  }
};