import { Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { reportHeader, reportFooter, reportAppliedFilters, buildReportDocument } from "../../common/report_common";

type ReportRow = Record<string, any>;

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

function text(value: unknown): string { return value == null ? "" : String(value); }
function escapeHtml(value: unknown): string { return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }

function allIfBlank(value: unknown): string { const v = text(value).trim(); return v || "All"; }

function parseParams(req: RequestWithUser) {
  const src = { ...(req.query as Record<string, any>), ...(req.body || {}) };
  const userCompany = text(req.user?.company_code).trim();
  const companyCode = userCompany || text(src.company_code).trim() || "";
  const eduCode = allIfBlank(src.code2 ?? src.edu_level_code);
  return { companyCode, eduCode, loginId: text(req.user?.loginid || "") };
}

async function loadData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);
  if (!params.companyCode) throw Object.assign(new Error("company_code is required"), { status: 400 });

  const conn = await getConn(req);
  try {
    const binds: Record<string, any> = {
      p_parameter: "MST_HR_EDU_LEVEL",
      p_loginid: params.loginId,
      p_code1: params.companyCode,
      p_code2: params.eduCode,
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

// CSS (Matching Bank/Salary)
const EDU_EXTRA_CSS = `
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  body, table.edu-table { font-family: Inter, "Segoe UI", Arial, sans-serif; }
  .doc-title-row { display: flex; justify-content: space-between; margin: 4px 0 10px 0; }
  body .doc-title-row h1 { margin: 0; font-size: 16px; font-weight: 800; color: #00378c !important; }
  .table-container { width: 100%; overflow-x: auto; }
  table.edu-table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 10px; margin-top: 6px; border: 1px solid #94a3b8; }
  table.edu-table thead th { background: #00378c !important; color: #ffffff !important; font-weight: 700; font-size: 9px; padding: 8px 6px; text-align: left; border: 0 !important; border-right: 1px solid rgba(255,255,255,0.45) !important; box-shadow: inset 0 0 0 1000px #00378c; }
  table.edu-table tbody td { padding: 6px 6px; border: 0; border-bottom: 1px solid #94a3b8 !important; border-right: 1px solid #94a3b8 !important; color: #1e293b; font-size: 10px; background: #fcfdfe; vertical-align: middle; }
  @media print { table.edu-table thead { display: table-header-group; } table.edu-table tr { page-break-inside: avoid; } }
`;

function renderCustomBody(rows: ReportRow[], filtersHtml: string): string {
  const heading = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap"><div class="doc-title-row"><div><h1>Educational Level Master</h1></div></div>`;
  if (!rows.length) return `${heading}${filtersHtml}<div style="text-align:center;padding:20px;">No data found</div>`;

  const bodyRows = rows.map((r, i) => `
    <tr>
      <td style="font-weight:bold; width: 15%;">${escapeHtml(r.edu_level_code)}</td>
      <td style="width: 35%;">${escapeHtml(r.edu_level_desc)}</td>
      <td style="width: 20%;">${escapeHtml(r.edu_level_short_desc)}</td>
      <td style="width: 15%;">${escapeHtml(r.status === 'A' || r.status === 'Y' ? 'Active' : 'Inactive')}</td>
      <td style="width: 15%;">${escapeHtml(r.remarks)}</td>
    </tr>
  `).join('');

  return `
    ${heading}${filtersHtml}
    <div class="table-container">
      <table class="edu-table">
        <thead><tr><th>Code</th><th>Description</th><th>Short Desc</th><th>Status</th><th>Remarks</th></tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;
}

export const getEduLevelReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadData(req);
    const headerHtml = await reportHeader({ company_code: params.companyCode, req });
    const filtersHtml = reportAppliedFilters([{ label: "Level Code", value: [params.eduCode] }]);
    const bodyHtml = renderCustomBody(rows, filtersHtml);
    const footerHtml = reportFooter({ reportName: "rpt_hr_edu_level", userName: params.loginId, endLabel: "Powered by Bayanat Technology" });

    const html = buildReportDocument({ title: "Educational Level", headerHtml, bodyHtml, footerHtml, extraCss: EDU_EXTRA_CSS, autoPrint: req.query.print !== "false", showPrintButton: true, orientation: "portrait" });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};