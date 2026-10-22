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
//  ONE generic report controller for all HR masters.
//  To add a new master: add one entry to HR_REPORTS below. Nothing else.
//  Route:  GET /hr/reports/:master      (master = key of HR_REPORTS)
//  Query:  company_code, code2 (master code or "All"), religion_code (caste only), print=true
//  UI: same look as the Visa Expiry / Freight Enquiry List report.
// ═══════════════════════════════════════════════════════════════════════════

type ReportRow = Record<string, any>;
type ColAlign = "left" | "center" | "right";
type Fmt = "text" | "num2" | "int" | "yn" | "status" | "skillcat";

interface ReportCol {
  key: string;      // lower-case column name
  label: string;
  align?: ColAlign; // default left
  weight?: number;  // relative width, default 1
  fmt?: Fmt;
  primary?: boolean; // blue bold (code column)
  /** Stack several DB fields in ONE column: first line bold, the rest smaller with a label */
  lines?: { key: string; label?: string; fmt?: Fmt }[];
}

interface ReportFilter {
  col: string;                    // DB column (upper-case)
  source: "code" | "religion";    // which request param feeds it
  label: string;                  // shown in "Applied Filters"
  numeric?: boolean;
}

interface MasterReport {
  title: string;
  table: string;
  companyCol?: string;       // omit for tables without COMPANY_CODE
  companyRequired?: boolean; // company can't be "All" (falls back to user's company)
  filters: ReportFilter[];
  columns: ReportCol[];
  orderBy: string[];
  /** Optional. Default: 7 or fewer columns = portrait, otherwise landscape */
  orientation?: "portrait" | "landscape";
}

const HR_REPORTS: Record<string, MasterReport> = {
  grade: {
    title: "Grade Master Report",
    table: "MS_HR_GRADE",
    companyCol: "COMPANY_CODE",
    filters: [{ col: "GRADE_CODE", source: "code", label: "Grade" }],
    columns: [
      { key: "company_code", label: "Company", weight: 0.8 },
      { key: "grade_code", label: "Grade Code", weight: 0.9, primary: true },
      { key: "grade_name", label: "Grade Name", weight: 2 },
      { key: "ot_eligibility", label: "OT Eligible", align: "center", fmt: "yn", weight: 0.9 },
      { key: "airfare_entitlement", label: "Airfare", align: "right", fmt: "num2" },
      { key: "spouse_af_entitlement", label: "Spouse Airfare", align: "right", fmt: "num2" },
      { key: "dep_af_entitlement", label: "Dep. Airfare", align: "right", fmt: "num2" },
      { key: "medical_entitlement", label: "Medical", align: "right", fmt: "num2" },
      { key: "spouse_med_entitlement", label: "Spouse Medical", align: "right", fmt: "num2" },
      { key: "dep_med_entitlement", label: "Dep. Medical", align: "right", fmt: "num2" },
      { key: "status", label: "Status", align: "center", fmt: "status", weight: 0.8 },
    ],
    orderBy: ["COMPANY_CODE", "GRADE_CODE"],
  },

  designation: {
    title: "Designation Master Report",
    table: "MS_HR_DESIGNATION",
    companyCol: "COMPANY_CODE",
    filters: [{ col: "DESG_CODE", source: "code", label: "Designation" }],
    columns: [
      { key: "desg_code", label: "Designation Code", primary: true },
      { key: "desg_name", label: "Designation Name", weight: 3 },
      { key: "desg_short_name", label: "Short Name", weight: 1.5 },
      { key: "remarks", label: "Remarks", weight: 2.5 },
      { key: "status", label: "Status", align: "center", fmt: "status" },
    ],
    orderBy: ["COMPANY_CODE", "DESG_CODE"],
  },

  contract: {
    title: "Contract Type Master Report",
    table: "MS_HR_CONTRACT_TYPES",
    companyCol: "COMPANY_CODE",
    filters: [{ col: "CONTRACT_TYPE", source: "code", label: "Contract Type" }],
    columns: [
      { key: "contract_type", label: "Contract Type", primary: true },
      { key: "contract_type_desc", label: "Description", weight: 3 },
      { key: "contract_type_short_desc", label: "Short Description", weight: 1.5 },
      { key: "remarks", label: "Remarks", weight: 2.5 },
      { key: "status", label: "Status", align: "center", fmt: "status" },
    ],
    orderBy: ["COMPANY_CODE", "CONTRACT_TYPE"],
  },

  religion: {
    title: "Religion Master Report",
    table: "MS_HR_RELIGION",
    filters: [{ col: "RELIGION_CODE", source: "code", label: "Religion", numeric: true }],
    columns: [
      { key: "religion_code", label: "Religion Code", primary: true },
      { key: "religion_name", label: "Religion Name", weight: 3 },
      { key: "religion_short_name", label: "Short Name", weight: 1.5 },
      { key: "remarks", label: "Remarks", weight: 2.5 },
      { key: "status", label: "Status", align: "center", fmt: "status" },
    ],
    orderBy: ["RELIGION_CODE"],
  },

  caste: {
    title: "Caste Master Report",
    table: "MS_HR_CASTE",
    filters: [
      { col: "RELIGION_CODE", source: "religion", label: "Religion", numeric: true },
      { col: "CASTE_CODE", source: "code", label: "Caste", numeric: true },
    ],
    columns: [
      { key: "religion_code", label: "Religion Code" },
      { key: "caste_code", label: "Caste Code", primary: true },
      { key: "caste_name", label: "Caste Name", weight: 3 },
      { key: "caste_short_name", label: "Short Name", weight: 1.5 },
      { key: "remarks", label: "Remarks", weight: 2.5 },
      { key: "status", label: "Status", align: "center", fmt: "status" },
    ],
    orderBy: ["RELIGION_CODE", "CASTE_CODE"],
  },

  educational_discipline: {
    title: "Educational Discipline Master Report",
    table: "MS_HR_EDU_DISCIPLINE",
    filters: [{ col: "EDU_DISC_CODE", source: "code", label: "Discipline" }],
    columns: [
      { key: "edu_disc_code", label: "Discipline Code", primary: true },
      { key: "edu_disc_desc", label: "Description", weight: 3 },
      { key: "edu_disc_short_desc", label: "Short Description", weight: 1.5 },
      { key: "remarks", label: "Remarks", weight: 2.5 },
      { key: "status", label: "Status", align: "center", fmt: "status" },
    ],
    orderBy: ["EDU_DISC_CODE"],
  },

  languages: {
    title: "Language Master Report",
    table: "MS_HR_LANGUAGES",
    filters: [{ col: "LANG_CODE", source: "code", label: "Language" }],
    columns: [
      { key: "lang_code", label: "Language Code", primary: true },
      { key: "lang_desc", label: "Description", weight: 3 },
      { key: "lang_short_desc", label: "Short Description", weight: 1.5 },
      { key: "remarks", label: "Remarks", weight: 2.5 },
      { key: "status", label: "Status", align: "center", fmt: "status" },
    ],
    orderBy: ["LANG_CODE"],
  },

  skills: {
    title: "Skill Master Report",
    table: "MS_HR_SKILLS",
    companyCol: "COMPANY_CODE",
    filters: [{ col: "SKILL_CODE", source: "code", label: "Skill" }],
    columns: [
      { key: "skill_code", label: "Skill Code", primary: true },
      { key: "skill_desc", label: "Description", weight: 3 },
      { key: "skill_short_desc", label: "Short Description", weight: 1.5 },
      { key: "skill_category", label: "Category", fmt: "skillcat", align: "center" },
      { key: "remarks", label: "Remarks", weight: 2.5 },
      { key: "status", label: "Status", align: "center", fmt: "status" },
    ],
    orderBy: ["COMPANY_CODE", "SKILL_CODE"],
  },

  // All 14 fields are shown, grouped into 7 columns so it fits A4 portrait cleanly.
  document_types: {
    title: "Document Type Master Report",
    table: "MS_HR_DOCTYPES",
    companyCol: "COMPANY_CODE",
    companyRequired: true,
    orientation: "portrait",
    filters: [{ col: "DOC_TYPE", source: "code", label: "Doc Type" }],
    columns: [
      { key: "doc_type", label: "Doc Type", primary: true, weight: 0.8 },
      {
        key: "doctype_name",
        label: "Document",
        weight: 2.6,
        lines: [
          { key: "doctype_name" },
          { key: "doctype_short_desc", label: "Short" },
          { key: "doc_notes", label: "Notes" },
        ],
      },
      {
        key: "renewal_period_days",
        label: "Renewal",
        weight: 1.3,
        lines: [
          { key: "renewal_period_days", label: "Days", fmt: "int" },
          { key: "renewal_chgs", label: "Charges", fmt: "num2" },
        ],
      },
      {
        key: "mand_flag",
        label: "Rules",
        weight: 1.2,
        lines: [
          { key: "mand_flag", label: "Mandatory", fmt: "yn" },
          { key: "doc_editable", label: "Editable", fmt: "yn" },
        ],
      },
      {
        key: "attach_folder",
        label: "Attachment",
        weight: 2,
        lines: [
          { key: "attach_folder", label: "Folder" },
          { key: "attach_prefix", label: "Prefix" },
          { key: "attach_type", label: "Type" },
        ],
      },
      {
        key: "email_id_for_alerts",
        label: "Alerts",
        weight: 2,
        lines: [
          { key: "email_id_for_alerts", label: "Email" },
          { key: "alert_before", label: "Before (days)", fmt: "int" },
        ],
      },
      { key: "status_flag", label: "Status", align: "center", fmt: "status", weight: 0.8 },
    ],
    orderBy: ["COMPANY_CODE", "DOC_TYPE"],
  },
};

// ─── Params ─────────────────────────────────────────────────────────────────

interface ReportParams {
  loginid: string;
  company: string;   // "All" or code
  code: string;      // "All" or code
  religion: string;  // "All" or code
}

const text = (v: unknown): string => (v == null ? "" : String(v));

function normalizeFilter(value: unknown): string {
  const v = text(value).trim();
  if (!v || v.toUpperCase() === "ALL") return "All";
  return v;
}

function extractParams(req: RequestWithUser): ReportParams {
  const src = { ...(req.query as any), ...(req.body || {}) };
  return {
    loginid: text(req.user?.loginid) || text(src.loginid) || "ADMIN",
    company: normalizeFilter(src.company_code || req.user?.company_code || "BSG"),
    code: normalizeFilter(src.code2 ?? src.code),
    religion: normalizeFilter(src.religion_code),
  };
}

// ─── DB ─────────────────────────────────────────────────────────────────────

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
  return rows.map((row) =>
    Object.keys(row).reduce((acc: ReportRow, key) => {
      acc[key.toLowerCase()] = row[key];
      return acc;
    }, {})
  );
}

function effectiveCompany(req: RequestWithUser, def: MasterReport, params: ReportParams): string {
  if (def.companyRequired && params.company === "All") return text(req.user?.company_code) || "BSG";
  return params.company;
}

async function loadData(req: RequestWithUser, def: MasterReport, params: ReportParams): Promise<ReportRow[]> {
  // Table / column names come ONLY from HR_REPORTS (never from the request),
  // all user values are bind variables → no SQL injection.
  const t = def.table;
  const where: string[] = [];
  const binds: Record<string, any> = {};

  if (def.companyCol) {
    const company = effectiveCompany(req, def, params);
    if (company !== "All") {
      where.push(`"${t}"."${def.companyCol}" = :company`);
      binds.company = company;
    }
  }

  def.filters.forEach((f, i) => {
    const raw = f.source === "religion" ? params.religion : params.code;
    if (raw === "All") return;
    let value: any = raw;
    if (f.numeric) {
      value = Number(raw);
      if (!Number.isFinite(value)) throw Object.assign(new Error(`Invalid ${f.label} code`), { status: 400 });
    }
    where.push(`"${t}"."${f.col}" = :f${i}`);
    binds[`f${i}`] = value;
  });

  // Every DB column used by the report (including stacked "lines" fields), de-duplicated
  const keys = Array.from(
    new Set(def.columns.flatMap((c) => (c.lines ? c.lines.map((l) => l.key) : [c.key])))
  );
  const select = keys.map((k) => `"${t}"."${k.toUpperCase()}"`).join(", ");
  const order = def.orderBy.map((c) => `"${t}"."${c}" ASC`).join(", ");
  const sql =
    `SELECT ${select} FROM "${t}"` +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    ` ORDER BY ${order}`;

  const conn = await getConn(req);
  try {
    const result = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Formatting ─────────────────────────────────────────────────────────────

const NO_DATA_MESSAGE = "No records found for the selected criteria.";

const escapeHtml = (v: unknown): string =>
  text(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

function formatCell(value: unknown, fmt: Fmt = "text"): string {
  const s = text(value).trim();
  switch (fmt) {
    case "num2": {
      const n = Number(value);
      return Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00";
    }
    case "int": {
      const n = Number(value);
      return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "0";
    }
    case "yn":
      return s.toUpperCase() === "Y" ? "Yes" : "No";
    case "status":
      return s.toUpperCase() === "A" ? "Active" : s.toUpperCase() === "I" ? "Inactive" : s || "\u2014";
    case "skillcat":
      return s.toUpperCase() === "P" ? "Professional" : s.toUpperCase() === "O" ? "Other" : s || "\u2014";
    default:
      return s || "\u2014";
  }
}

// ─── Layout CSS – identical to the Visa Expiry / Freight "Enquiry List" PDF ──
// Sizes: company 16px, title 18px, filter strip 10.5px, table text 10.5px, footer 9px.
// Colours: navy #00378c header, #fafcfe rows (ALL rows same, no tint),
//          #e2e8f0 row lines, #dbe4f0 total row.
// Used with fontMode: "native".

const EXTRA_CSS = `
  @page { size: A4 landscape; margin: 6mm 12mm 12mm 12mm; }

  /* Make Chrome print background colors */
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    box-sizing: border-box;
  }

  html, body { width: 100%; max-width: 100%; overflow-x: hidden; }

  /* No page border (screen + print) */
  body::before,
  body::after { display: none !important; content: none !important; }

  /* Letterhead – navy rule under the header */
  .company-header {
    border-bottom: 2px solid #00378c;
    padding: 0 0 10px 0;
    margin: 0 0 8px 0;
  }
  .company-name       { font-size: 16px; font-weight: 700; color: #172033; margin: 0 0 2px 0; }
  .company-address    { font-size: 9.5px; line-height: 1.4; }
  .company-logo-wrap  { max-width: 180px; }
  .company-logo       { max-height: 56px; max-width: 180px; }

  /* Title + filter strip */
  h1.report-title {
    margin: 28px 0 14px 0;
    font-size: 18px;
    font-weight: 700;
    color: #00378c !important;
  }
  .applied-filters { font-size: 10.5px; margin-bottom: 28px; }

  /* Data table */
  table.data-table {
    width: 100%;
    table-layout: fixed;
    font-size: 10.5px;
    margin-top: 0;
    border-collapse: collapse;
  }
  table.data-table th,
  table.data-table td {
    overflow: visible;
    overflow-wrap: anywhere;
    word-break: break-word;
    white-space: normal !important;   /* wrap long text INSIDE its own column */
    min-width: 0;
  }

  table.data-table .left   { text-align: left   !important; }
  table.data-table .center { text-align: center !important; }
  table.data-table .right  { text-align: right  !important; font-variant-numeric: tabular-nums; }

  /* Header: solid navy bar, white bold text */
  table.data-table thead tr th {
    background: #00378c !important;
    color: #ffffff !important;
    font-weight: 700;
    font-size: 10.5px;
    padding: 12px 6px;
    border: 0 !important;
    text-transform: none;
    white-space: normal !important;
  }

  /* Data rows – every row same colour */
  table.data-table tbody tr.data-row td {
    background: #fafcfe !important;
    font-size: 10.5px;
    font-weight: 400;
    padding: 9px 6px;
    border-bottom: 1px solid #e2e8f0 !important;
    color: #1e293b;
    vertical-align: top;
    white-space: normal !important;
  }
  /* Codes / numbers stay on one line */
  table.data-table tbody tr.data-row td.nw {
    white-space: nowrap !important;
    font-variant-numeric: tabular-nums;
  }
  table.data-table tbody tr.data-row td.primary-text { color: #00378c; font-weight: 700; }

  /* Stacked multi-field cells (first line bold, others smaller with label) */
  table.data-table td .line-main { font-weight: 600; color: #1e293b; }
  table.data-table td .line-sub  { color: #475569; margin-top: 2px; font-size: 10px; }
  table.data-table td .line-lbl  { color: #64748b; font-weight: 600; }

  /* Total row – shaded, bold navy, right aligned */
  table.data-table tbody tr.grand-total-row td {
    background: #dbe4f0 !important;
    color: #00378c !important;
    font-weight: 700;
    font-size: 10.5px;
    padding: 9px 8px;
    text-align: right;
    border-bottom: 1px solid #cbd5e1 !important;
  }

  /* Empty state */
  table.data-table tbody tr.empty-row td {
    padding: 20px;
    text-align: center;
    color: #64748b;
    background: #fafcfe !important;
  }

  /* Footer – keep fully inside the page */
  .report-footer {
    width: 100% !important;
    max-width: 100% !important;
    padding-right: 2px;
    font-size: 9px;
    overflow: visible !important;
    overflow-wrap: anywhere;
    word-break: break-word;
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

// ─── Body + document ────────────────────────────────────────────────────────

function renderBody(def: MasterReport, rows: ReportRow[], params: ReportParams, title: string): string {
  const cols = def.columns;
  const totalWeight = cols.reduce((s, c) => s + (c.weight ?? 1), 0);

  // Company is intentionally NOT shown in the filter strip
  const filterItems: { label: string; value: string }[] = def.filters.map((f) => ({
    label: f.label,
    value: f.source === "religion" ? params.religion : params.code,
  }));

  let bodyRows = "";
  if (!rows.length) {
    bodyRows = `<tr class="empty-row"><td colspan="${cols.length}">${escapeHtml(NO_DATA_MESSAGE)}</td></tr>`;
  } else {
    for (const r of rows) {
      bodyRows +=
        `<tr class="data-row">` +
        cols
          .map((c) => {
            const nowrap = !c.lines && (c.primary || c.fmt === "num2" || c.fmt === "int");
            const cls = `${c.align ?? "left"}${nowrap ? " nw" : ""}${c.primary ? " primary-text" : ""}`;
            const inner = c.lines
              ? c.lines
                  .map(
                    (l, i) =>
                      `<div class="${i === 0 ? "line-main" : "line-sub"}">` +
                      `${l.label ? `<span class="line-lbl">${escapeHtml(l.label)}:</span> ` : ""}` +
                      `${escapeHtml(formatCell(r[l.key], l.fmt))}</div>`
                  )
                  .join("")
              : escapeHtml(formatCell(r[c.key], c.fmt));
            return `<td class="${cls}">${inner}</td>`;
          })
          .join("") +
        `</tr>`;
    }
    bodyRows += `<tr class="grand-total-row"><td colspan="${cols.length}">Total: ${rows.length} Records</td></tr>`;
  }

  const colgroup = cols
    .map((c) => `<col style="width:${(((c.weight ?? 1) / totalWeight) * 100).toFixed(2)}%" />`)
    .join("");
  const headerCells = cols.map((c) => `<th class="${c.align ?? "left"}">${escapeHtml(c.label)}</th>`).join("");

  return `
    <h1 class="report-title">${escapeHtml(title)}</h1>
    ${reportAppliedFilters(filterItems)}
    <table class="data-table">
      <colgroup>${colgroup}</colgroup>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
    ${PRINT_LISTENER_SCRIPT}`;
}

// ─── Route handler ──────────────────────────────────────────────────────────

export const getHrMasterReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const master = text(req.params.master).trim();
    const def = Object.prototype.hasOwnProperty.call(HR_REPORTS, master) ? HR_REPORTS[master] : undefined;
    if (!def) {
      res.status(404).json({ success: false, message: `Unknown HR report: ${master}` });
      return;
    }

    const title = text(req.query.title as string) || def.title;
    const autoPrint = req.query.print === "true";
    const params = extractParams(req);
    const company = effectiveCompany(req, def, params);

    const rows = await loadData(req, def, params);

    const headerCompany = company !== "All" ? company : text(req.user?.company_code) || "BSG";
    const headerHtml = await reportHeader({ company_code: headerCompany, req });
    const printed = new Date().toLocaleString("en-US");
    const footerHtml = reportFooter({
      reportName: def.title,
      userName: params.loginid,
      endLabel: "Powered by Bayanat Technology",
      extraLeft: `Print: ${escapeHtml(printed)} | User: ${escapeHtml(params.loginid)}`,
    });

    // Few columns -> portrait, many columns -> landscape (or set `orientation` on the entry)
    const orientation = def.orientation ?? (def.columns.length <= 7 ? "portrait" : "landscape");

    const html = buildReportDocument({
      title,
      headerHtml,
      bodyHtml: renderBody(def, rows, params, title),
      footerHtml,
      extraCss: EXTRA_CSS.replace("size: A4 landscape", `size: A4 ${orientation}`),
      autoPrint,
      showPrintButton: true,
      fontMode: "native",
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("HR master report error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};