import { Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import {
  buildReportDocument,
  reportAppliedFilters,
  reportFooter,
  reportHeader,
} from "../../../controllers/common/report_common";

// ═══════════════════════════════════════════════════════════════════════════
//  Grade Master Report  (layout follows the old "List of Grades" report)
//  Route:  GET /hr/reports/grade_master
//  Query:  company_code ("All" or code), code2 (grade code or "All"), print=true
//  No company name / company group row is shown in the table or filters.
// ═══════════════════════════════════════════════════════════════════════════

type Row = Record<string, any>;

const text = (v: unknown): string => (v == null ? "" : String(v));
const NO_DATA_MESSAGE = "No records found for the selected criteria.";

const escapeHtml = (v: unknown): string =>
  text(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

const norm = (v: unknown): string => {
  const s = text(v).trim();
  return !s || s.toUpperCase() === "ALL" ? "All" : s;
};

/** Entitlement flag: Y / 1 / any number > 0 = ticked */
const isTicked = (v: unknown): boolean => {
  const s = text(v).trim().toUpperCase();
  if (s === "Y" || s === "YES" || s === "TRUE") return true;
  const n = Number(s);
  return Number.isFinite(n) && n > 0;
};

const checkbox = (v: unknown): string =>
  `<span class="cb${isTicked(v) ? " on" : ""}">${isTicked(v) ? "&#10003;" : ""}</span>`;

const status = (v: unknown): string => {
  const s = text(v).trim().toUpperCase();
  return s === "A" ? "Active" : s === "I" ? "Inactive" : s || "\u2014";
};
const plain = (v: unknown): string => text(v).trim() || "\u2014";

// ─── DB ─────────────────────────────────────────────────────────────────────

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid) tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenantId) throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
  return TenantManager.getConnection(tenantId);
}

async function loadGrades(req: RequestWithUser, company: string, grade: string): Promise<Row[]> {
  const sql = `
    SELECT "MS_HR_GRADE"."COMPANY_CODE",
           "MS_HR_GRADE"."GRADE_CODE",
           "MS_HR_GRADE"."GRADE_NAME",
           "MS_HR_GRADE"."OT_ELIGIBILITY",
           "MS_HR_GRADE"."AIRFARE_ENTITLEMENT",
           "MS_HR_GRADE"."SPOUSE_AF_ENTITLEMENT",
           "MS_HR_GRADE"."DEP_AF_ENTITLEMENT",
           "MS_HR_GRADE"."MEDICAL_ENTITLEMENT",
           "MS_HR_GRADE"."SPOUSE_MED_ENTITLEMENT",
           "MS_HR_GRADE"."DEP_MED_ENTITLEMENT",
           "MS_HR_GRADE"."STATUS"
      FROM "MS_HR_GRADE"
     WHERE ("MS_HR_GRADE"."COMPANY_CODE" = :company OR :company = 'All')
       AND ("MS_HR_GRADE"."GRADE_CODE"   = :grade   OR :grade   = 'All')
     ORDER BY "MS_HR_GRADE"."COMPANY_CODE" ASC,
              "MS_HR_GRADE"."GRADE_CODE"   ASC`;

  const conn = await getConn(req);
  try {
    const result = await conn.execute(sql, { company, grade }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return ((result.rows as any[]) || []).map((row) =>
      Object.keys(row).reduce((acc: Row, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );
  } finally {
    try { await conn.close(); } catch (e) { console.warn("Close conn error:", e); }
  }
}

// ─── Layout CSS ─────────────────────────────────────────────────────────────

const EXTRA_CSS = `
  @page { size: A4 portrait; margin: 6mm 12mm 12mm 12mm; }

  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    box-sizing: border-box;
  }

  html, body { width: 100%; max-width: 100%; overflow-x: hidden; }
  body::before, body::after { display: none !important; content: none !important; }

  .company-header { border-bottom: 2px solid #00378c; padding: 0 0 10px 0; margin: 0 0 8px 0; }
  .company-name       { font-size: 16px; font-weight: 700; color: #172033; margin: 0 0 2px 0; }
  .company-address    { font-size: 9.5px; line-height: 1.4; }
  .company-logo-wrap  { max-width: 180px; }
  .company-logo       { max-height: 56px; max-width: 180px; }

  h1.report-title { margin: 28px 0 14px 0; font-size: 18px; font-weight: 700; color: #00378c !important; }
  .applied-filters { font-size: 10.5px; margin-bottom: 28px; }

  table.data-table { width: 100%; table-layout: fixed; font-size: 10.5px; margin-top: 0; border-collapse: collapse; }
  table.data-table th, table.data-table td {
    overflow: visible; overflow-wrap: anywhere; word-break: break-word;
    white-space: normal !important; min-width: 0;
  }
  table.data-table .left   { text-align: left   !important; }
  table.data-table .center { text-align: center !important; }

  /* two-level header */
  table.data-table thead tr th {
    background: #00378c !important; color: #ffffff !important; font-weight: 700;
    font-size: 10px; padding: 8px 4px; border: 0 !important; text-transform: none;
    vertical-align: middle; white-space: normal !important;
  }
  table.data-table thead tr.sub-head th {
    background: #1a4fa3 !important; font-weight: 600; padding: 6px 2px;
    border-top: 1px solid rgba(255,255,255,0.35) !important;
  }
  table.data-table thead tr.top-head th.group {
    border-bottom: 1px solid rgba(255,255,255,0.35) !important;
  }

  table.data-table tbody tr.data-row td {
    background: #fafcfe !important; font-size: 10.5px; font-weight: 400; padding: 9px 4px;
    border-bottom: 1px solid #e2e8f0 !important; color: #1e293b; vertical-align: middle;
    white-space: normal !important;
  }
  table.data-table tbody tr.data-row td.primary-text { color: #00378c; font-weight: 700; white-space: nowrap !important; }

  /* checkbox */
  .cb {
    display: inline-block; width: 12px; height: 12px; border: 1px solid #64748b; border-radius: 2px;
    background: #ffffff; color: #ffffff; font-size: 9px; line-height: 10px; text-align: center;
    vertical-align: middle;
  }
  .cb.on { background: #00378c; border-color: #00378c; }

  table.data-table tbody tr.grand-total-row td {
    background: #dbe4f0 !important; color: #00378c !important; font-weight: 700; font-size: 10.5px;
    padding: 9px 8px; text-align: right; border-bottom: 1px solid #cbd5e1 !important;
  }
  table.data-table tbody tr.empty-row td {
    padding: 20px; text-align: center; color: #64748b; background: #fafcfe !important;
  }

  .report-footer {
    width: 100% !important; max-width: 100% !important; padding-right: 2px; font-size: 9px;
    overflow: visible !important; overflow-wrap: anywhere; word-break: break-word;
  }
  .report-footer * { max-width: 100%; }

  @media print {
    table.data-table thead { display: table-header-group; }
    table.data-table tr { break-inside: avoid; page-break-inside: avoid; }
    .report-footer { font-size: 9px; }
  }
`;

const PRINT_LISTENER_SCRIPT = `
  <script>
    window.addEventListener("message", function (e) {
      if (e.data === "print") window.print();
    });
  </script>`;

// ─── Body ───────────────────────────────────────────────────────────────────

// 10 columns: code, name, OT, airfare x3, medical x3, status   (widths add up to 100)
const WIDTHS = [8, 17, 10, 9.5, 9.5, 9.5, 9.5, 9.5, 9.5, 8];

function renderBody(rows: Row[], gradeFilter: string, title: string): string {
  const COLS = WIDTHS.length;
  let bodyRows = "";

  if (!rows.length) {
    bodyRows = `<tr class="empty-row"><td colspan="${COLS}">${escapeHtml(NO_DATA_MESSAGE)}</td></tr>`;
  } else {
    for (const r of rows) {
      bodyRows += `
        <tr class="data-row">
          <td class="left primary-text">${escapeHtml(plain(r.grade_code))}</td>
          <td class="left">${escapeHtml(plain(r.grade_name))}</td>
          <td class="center">${checkbox(r.ot_eligibility)}</td>
          <td class="center">${checkbox(r.airfare_entitlement)}</td>
          <td class="center">${checkbox(r.spouse_af_entitlement)}</td>
          <td class="center">${checkbox(r.dep_af_entitlement)}</td>
          <td class="center">${checkbox(r.medical_entitlement)}</td>
          <td class="center">${checkbox(r.spouse_med_entitlement)}</td>
          <td class="center">${checkbox(r.dep_med_entitlement)}</td>
          <td class="center">${escapeHtml(status(r.status))}</td>
        </tr>`;
    }
    bodyRows += `<tr class="grand-total-row"><td colspan="${COLS}">Total: ${rows.length} Records</td></tr>`;
  }

  const colgroup = WIDTHS.map((w) => `<col style="width:${w}%" />`).join("");

  const thead = `
    <thead>
      <tr class="top-head">
        <th class="left" rowspan="2">Grade Code</th>
        <th class="left" rowspan="2">Name</th>
        <th class="center" rowspan="2">O/T Eligibility</th>
        <th class="center group" colspan="3">Air Fare Entitlement</th>
        <th class="center group" colspan="3">Med. Entitlement</th>
        <th class="center" rowspan="2">Status</th>
      </tr>
      <tr class="sub-head">
        <th class="center">Self</th><th class="center">Spouse</th><th class="center">Dependent</th>
        <th class="center">Self</th><th class="center">Spouse</th><th class="center">Dependent</th>
      </tr>
    </thead>`;

  return `
    <h1 class="report-title">${escapeHtml(title)}</h1>
    ${reportAppliedFilters([{ label: "Grade", value: gradeFilter }])}
    <table class="data-table">
      <colgroup>${colgroup}</colgroup>
      ${thead}
      <tbody>${bodyRows}</tbody>
    </table>
    ${PRINT_LISTENER_SCRIPT}`;
}

// ─── Route handler ──────────────────────────────────────────────────────────

export const getGradeMasterReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const src = { ...(req.query as any), ...(req.body || {}) };
    const loginid = text(req.user?.loginid) || text(src.loginid) || "ADMIN";
    const company = norm(src.company_code || req.user?.company_code || "BSG");
    const grade = norm(src.code2 ?? src.code);

    const title = text(src.title) || "List of Grades";
    const autoPrint = src.print === "true";

    const rows = await loadGrades(req, company, grade);

    const headerCompany = company !== "All" ? company : text(req.user?.company_code) || "BSG";
    const headerHtml = await reportHeader({ company_code: headerCompany, req });
    const printed = new Date().toLocaleString("en-US");
    const footerHtml = reportFooter({
      reportName: "List of Grades",
      userName: loginid,
      endLabel: "Powered by Bayanat Technology",
      extraLeft: `Print: ${escapeHtml(printed)} | User: ${escapeHtml(loginid)}`,
    });

    const html = buildReportDocument({
      title,
      headerHtml,
      bodyHtml: renderBody(rows, grade, title),
      footerHtml,
      extraCss: EXTRA_CSS,
      autoPrint,
      showPrintButton: true,
      fontMode: "native",
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Grade master report error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};