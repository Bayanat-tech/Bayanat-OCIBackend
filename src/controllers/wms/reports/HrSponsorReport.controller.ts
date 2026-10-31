// src/controllers/wms/reports/HrSponsorReport.controller.ts

import { Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { reportHeader, reportFooter, reportAppliedFilters, buildReportDocument } from "../../common/report_common";

type ReportRow = Record<string, any>;

// ─── DB Helpers ───────────────────────────────────────────────────────────────

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid) tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenantId) throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
  return TenantManager.getConnection(tenantId);
}

async function closeConn(conn?: oracledb.Connection) {
  if (conn) try { await conn.close(); } catch (e) { console.warn("Close conn error:", e); }
}

function normalize(rows: any[] = []): ReportRow[] {
  return rows.map((row) => Object.keys(row).reduce((acc: ReportRow, key) => {
    acc[key.toLowerCase()] = row[key];
    return acc;
  }, {}));
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function text(value: unknown): string { return value == null ? "" : String(value); }
function escapeHtml(value: unknown): string { return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(value: unknown): string {
  if (!value) return "";
  const d = new Date(value as any);
  if (Number.isNaN(d.getTime())) return text(value).slice(0, 10);
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dd}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

// ─── Param Parser ────────────────────────────────────────────────────────────

function allIfBlank(value: unknown): string { const v = text(value).trim(); return v || "All"; }

function parseParams(req: RequestWithUser) {
  const src = { ...(req.query as Record<string, any>), ...(req.body || {}) };
  const userCompany = text(req.user?.company_code).trim();
  const companyCode = userCompany || text(src.company_code).trim() || "";
  const sponsorCode = allIfBlank(src.code2 ?? src.sponsor_code);
  return { companyCode, sponsorCode, loginId: text(req.user?.loginid || "") };
}

// ─── Data Loader ─────────────────────────────────────────────────────────────

async function loadData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);
  if (!params.companyCode) throw Object.assign(new Error("company_code is required"), { status: 400 });

  const conn = await getConn(req);
  try {
    const binds: Record<string, any> = {
      p_parameter: "Hr_Report_SPONSOR_MASTER",
      p_loginid: params.loginId,
      p_code1: params.companyCode,
      p_code2: params.sponsorCode,
      p_code3: null, p_code4: null, p_code5: null, p_code6: null, p_code7: null, p_code8: null, p_code9: null,
      p_code10: null, p_code11: null, p_code12: null, p_code13: null, p_code14: null, p_code15: null,
      p_code16: null, p_code17: null, p_code18: null, p_code19: null, p_code20: null,
      p_number1: null, p_number2: null, p_number3: null, p_number4: null,
      p_date1: { val: null, type: oracledb.DATE }, p_date2: { val: null, type: oracledb.DATE },
      p_date3: { val: null, type: oracledb.DATE }, p_date4: { val: null, type: oracledb.DATE },
      p_return_string: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    const codeArgs = Array.from({ length: 20 }, (_, i) => `:p_code${i + 1}`).join(", ");
    const procResult = await conn.execute(
      `BEGIN PROC_BUILD_DYNAMIC_SQL_HR_REPORT(:p_parameter, :p_loginid, ${codeArgs}, :p_number1, :p_number2, :p_number3, :p_number4, :p_date1, :p_date2, :p_date3, :p_date4, :p_return_string); END;`,
      binds,
    );

    const builtSql = text((procResult.outBinds as any)?.p_return_string).trim();
    if (!builtSql || builtSql.toUpperCase() === "INVALID PARAMETER VALUE") throw new Error("No query returned");

    const result = await conn.execute(builtSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Extra CSS (Matching Salary Register) ─────────────────────────────────────

const SPONSOR_EXTRA_CSS = `
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }

  body, table.sponsor-table {
    font-family: Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  }

  .doc-title-row {
    display: flex; justify-content: space-between; align-items: flex-end;
    margin: 4px 0 10px 0;
  }
  body .doc-title-row h1 {
    margin: 0;
    font-size: 16px;
    font-weight: 800;
    color: #00378c !important;
    letter-spacing: 0;
  }

  .table-container {
    width: 100%;
    overflow-x: auto;
  }

  table.sponsor-table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    font-size: 10px;
    margin-top: 6px;
    border: 1px solid #94a3b8;
  }

  /* Header style matching Salary Register */
  table.sponsor-table thead th {
    background: #00378c !important;
    color: #ffffff !important;
    font-weight: 700;
    font-size: 9px;
    letter-spacing: 0;
    padding: 8px 6px;
    text-align: left;
    vertical-align: middle;
    border: 0 !important;
    border-right: 1px solid rgba(255, 255, 255, 0.45) !important;
    box-shadow: inset 0 0 0 1000px #00378c;
    white-space: normal;
    overflow-wrap: break-word;
  }
  table.sponsor-table thead th.num-head { text-align: right; }

  table.sponsor-table tbody td {
    padding: 6px 6px;
    border: 0;
    border-bottom: 1px solid #94a3b8 !important;
    border-right: 1px solid #94a3b8 !important;
    color: #1e293b;
    font-size: 10px;
    font-weight: 400;
    background: #fcfdfe;
    vertical-align: top;
    white-space: normal;
    overflow-wrap: anywhere;
    overflow: hidden;
  }

  .center { text-align: center; }
  .left   { text-align: left; }
  .right  { text-align: right; }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .sponsor-empty {
    border: 1px dashed #cbd5e1;
    background: #f8fafc;
    text-align: center;
    padding: 40px 12px;
    margin-top: 14px;
    color: #64748b;
    font-weight: 700;
  }

  @media print {
    body .doc-title-row h1 { color: #00378c !important; }
    table.sponsor-table thead { display: table-header-group; }
    table.sponsor-table tr    { page-break-inside: avoid; }
    table.sponsor-table thead th {
      background: #00378c !important;
      color: #ffffff !important;
      box-shadow: inset 0 0 0 1000px #00378c;
    }
  }
`;

const FONT_LINK = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">`;

// ─── Body Renderer ────────────────────────────────────────────────────────────

function renderCustomBody(rows: ReportRow[], filtersHtml: string, params: any): string {
  const heading = `
    ${FONT_LINK}
    <div class="doc-title-row">
      <div><h1>List of Sponsors</h1></div>
    </div>`;

  if (!rows.length) {
    return `${heading}${filtersHtml}<div class="sponsor-empty">No data found</div>`;
  }

  const bodyRows = rows.map((r) => {
    const statusStr = (r.status === 'A' || r.status === 'Y') ? 'Active' : 'Inactive';
    
    return `
      <tr>
        <td style="font-weight:bold; width: 10%;">${escapeHtml(r.sponsor_code)}</td>
        <td style="width: 20%;">
          <div style="font-weight:bold;">${escapeHtml(r.sponsor_name)}</div>
          <div style="color:#555; font-size:9px;">${escapeHtml(r.sponsor_short_name)}</div>
          <div style="color:#555; font-size:9px;">${escapeHtml(r.sponsor_address1)}</div>
        </td>
        <td style="width: 15%;">
          <div>${escapeHtml(r.trade_license_no)}</div>
          <div style="color:#555; font-size:9px;">${escapeHtml(fmtDate(r.trade_license_exp_date))}</div>
        </td>
        <td style="width: 15%;">
          <div>${escapeHtml(r.sponsor_labor_no)}</div>
          <div style="color:#555; font-size:9px;">${escapeHtml(r.labour_card_blocked === 'Y' ? 'Blocked' : 'Not Blocked')}</div>
        </td>
        <td style="width: 15%;">
          <div>${escapeHtml(r.sponsor_immgr_no)}</div>
          <div style="color:#555; font-size:9px;">${escapeHtml(fmtDate(r.sponsor_immgr_dt))}</div>
        </td>
        <td style="width: 10%;">${escapeHtml(statusStr)}</td>
      </tr>
    `;
  }).join('');

  return `
    ${heading}
    ${filtersHtml}
    <div class="table-container">
      <table class="sponsor-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Sponsor Details</th>
            <th>Trade License</th>
            <th>Labour / Blocked</th>
            <th>Immigration</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
        </tbody>
      </table>
    </div>
  `;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export const getSponsorReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadData(req);
    const headerHtml = await reportHeader({ company_code: params.companyCode, req });
    
    const filtersHtml = reportAppliedFilters([{ label: "Sponsor Code", value: [params.sponsorCode] }]);
    
    const bodyHtml = renderCustomBody(rows, filtersHtml, params);
    
    const footerHtml = reportFooter({ 
      reportName: "rpt_hr_sponsor", 
      userName: params.loginId, 
      endLabel: "Powered by Bayanat Technology" 
    });

    const html = buildReportDocument({ 
      title: "Sponsor Master Report", 
      headerHtml, 
      bodyHtml, 
      footerHtml, 
      extraCss: SPONSOR_EXTRA_CSS, 
      autoPrint: req.query.print !== "false", 
      showPrintButton: true, 
      orientation: "landscape" // Changed to landscape to match the wide table format
    });
    
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Sponsor Report HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};