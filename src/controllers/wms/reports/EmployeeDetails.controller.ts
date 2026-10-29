// src/controllers/wms/reports/EmployeeDetails.controller.ts

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

// ─────────────────────────────────────────────────────────────
// DB Helpers
// ─────────────────────────────────────────────────────────────
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
    }, {}),
  );
}

// ─────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────
function text(value: unknown): string { return value == null ? "" : String(value); }
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

// ─────────────────────────────────────────────────────────────
// Status mapping (accepts both codes and names)
// ─────────────────────────────────────────────────────────────
const STATUS_CODE: Record<string, string> = {
  c: "C", confirmed: "C",
  p: "P", probation: "P",
  s: "S", separated: "S",
};
const STATUS_LABEL: Record<string, string> = { C: "Confirmed", P: "Probation", S: "Separated" };
const toStatusCode = (v: string): string => STATUS_CODE[text(v).trim().toLowerCase()] ?? "All";

// ─────────────────────────────────────────────────────────────
// Param Parser
// ─────────────────────────────────────────────────────────────
function allIfBlank(value: unknown): string { const v = text(value).trim(); return v || "All"; }

// Timezone-safe: "2026-01-01" -> local date (not UTC midnight)
function parseDate(str: any): Date | null {
  const s = text(str).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
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
    gradeCode: allIfBlank(src.grade_code),
    desgCode: allIfBlank(src.desg_code),
    employeeCode: allIfBlank(src.employee_id ?? src.employee_code),
    joinFrom: parseDate(src.join_from),
    joinTo: parseDate(src.join_to),
    empStatus: allIfBlank(src.emp_status),
    empAmendment: text(src.emp_amendment).trim().toUpperCase() === "Y" ? "Y" : "N",
    loginId: text(req.user?.loginid || (req.user as any)?.username || ""),
  };
}

// ─────────────────────────────────────────────────────────────
// Duplicate guards
// ─────────────────────────────────────────────────────────────
// 1) remove fully identical rows
function dedupeRows(rows: ReportRow[]): ReportRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = JSON.stringify(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// 2) keep one row per employee (used when "Employee Amendment" is NOT ticked)
function dedupeByEmployee(rows: ReportRow[]): ReportRow[] {
  if (!rows.length) return rows;
  const keyCol = ["employee_id", "employee_code", "emp_code", "emp_id"].find((k) => k in rows[0]);
  if (!keyCol) return rows;
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = text(r[keyCol]);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ─────────────────────────────────────────────────────────────
// Data Loader
// ─────────────────────────────────────────────────────────────
async function loadData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);
  if (!params.companyCode) throw Object.assign(new Error("company_code is required"), { status: 400 });

  const conn = await getConn(req);
  try {
    const binds: Record<string, any> = {
      p_parameter: "Hr_Report_EMPLOYEE_DETAILS",
      p_loginid: params.loginId,
      p_code1: params.companyCode,
      p_code2: params.divCode,
      p_code3: params.deptCode,
      p_code4: params.sectCode,
      p_code5: params.gradeCode,
      p_code6: params.desgCode,
      p_code7: params.employeeCode,
      p_code8: toStatusCode(params.empStatus),
      p_code9: params.empAmendment,
      p_number1: null, p_number2: null, p_number3: null, p_number4: null,
      p_date1: { val: params.joinFrom, type: oracledb.DATE },
      p_date2: { val: params.joinTo, type: oracledb.DATE },
      p_date3: { val: null, type: oracledb.DATE },
      p_date4: { val: null, type: oracledb.DATE },
      p_return_string: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    for (let i = 10; i <= 20; i++) binds[`p_code${i}`] = null;
    const codeArgs = Array.from({ length: 20 }, (_, i) => `:p_code${i + 1}`).join(", ");

    const procResult = await conn.execute(
      `BEGIN PROC_BUILD_DYNAMIC_SQL_HR_REPORT(
         :p_parameter, :p_loginid, ${codeArgs},
         :p_number1, :p_number2, :p_number3, :p_number4,
         :p_date1, :p_date2, :p_date3, :p_date4, :p_return_string
       ); END;`,
      binds,
    );

    const builtSql = text((procResult.outBinds as any)?.p_return_string).trim();
    if (!builtSql || builtSql.toUpperCase() === "INVALID PARAMETER VALUE") {
      throw Object.assign(new Error("Report procedure returned no query"), { status: 500 });
    }

    // Uncomment to debug duplicates / status filter:
    // console.log("Employee Details SQL:", builtSql);

    const result = await conn.execute(builtSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });

    let rows = dedupeRows(normalize(result.rows as any[]));
    if (params.empAmendment !== "Y") rows = dedupeByEmployee(rows);
    return rows;
  } finally {
    await closeConn(conn);
  }
}

// ─────────────────────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────────────────────
const EXTRA_CSS = `
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
  body, table.emp-table { font-family: Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif; }
  .doc-title-row { display: flex; justify-content: space-between; align-items: flex-start; margin: 4px 0 10px 0; }
  body .doc-title-row h1 { margin: 0; font-size: 16px; font-weight: 800; color: #00378c !important; letter-spacing: 0; }
  table.emp-table { width: 100%; max-width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 6px; border: 0; }
  table.emp-table th.g, table.emp-table td.g { padding: 0 !important; border: 0 !important; white-space: normal !important; text-align: left; vertical-align: top; }
  table.emp-table thead th.g { background: #00378c !important; box-shadow: inset 0 0 0 1000px #00378c; }
  table.emp-table tbody td.g { background: #fcfdfe; border-bottom: 1px solid #cbd5e1 !important; }
  table.emp-table tbody tr.rec:nth-child(even) td.g { background: #f6f9fd; }
  table.emp-table tr.rec { page-break-inside: avoid; break-inside: avoid; }
  .emp-grid { display: grid; width: 100%; }
  .emp-grid .gc, .emp-grid .hc { min-width: 0; box-sizing: border-box; white-space: normal !important; overflow-wrap: anywhere; word-break: break-word; font-size: 8.5px; line-height: 1.3; }
  .emp-grid .gc { padding: 3px 4px; color: #1e293b; font-weight: 400; text-align: left; }
  .emp-grid .gc.center { text-align: center; }
  .emp-grid .hc { padding: 5px 4px; color: #ffffff !important; background: #00378c !important; font-weight: 700; line-height: 1.2; display: flex; align-items: center; justify-content: flex-start; text-align: left; }
  .emp-grid .hc.center { justify-content: center; text-align: center; }
  .emp-grid .hc.l2 { border-top: 1px solid rgba(255,255,255,0.3); }
  .emp-empty { border: 1px dashed #cbd5e1; background: #f8fafc; text-align: center; padding: 40px 12px; margin-top: 14px; color: #64748b; font-weight: 700; }
  @media print { table.emp-table thead { display: table-header-group; } }
`;
const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">`;

// ─────────────────────────────────────────────────────────────
// Body Renderer
// ─────────────────────────────────────────────────────────────
// Report layout: same grid as the legacy report - two stacked lines per employee.
type FieldSpec = { aliases: string[]; pattern?: RegExp; date?: boolean };

const FIELDS: Record<string, FieldSpec> = {
  employee_id: { aliases: ["employee_id", "employee_code", "emp_code", "emp_id"] },
  title: { aliases: ["title"] },
  first_name: { aliases: ["first_name"] },
  second_name: { aliases: ["second_name"] },
  third_name: { aliases: ["third_name"] },
  fourth_name: { aliases: ["fourth_name"] },
  last_name: { aliases: ["last_name"] },
  family_name: { aliases: ["family_name"] },
  birth_date: { aliases: ["birth_date", "date_of_birth", "dob", "birthdate"], pattern: /birth.*date|date.*birth|^dob/, date: true },
  birth_place: { aliases: ["birth_place", "place_of_birth", "birthplace", "pob"], pattern: /birth.*place|place.*birth/ },
  gender: { aliases: ["gender", "sex"] },
  father_name: { aliases: ["father_name", "fathers_name", "father"], pattern: /father/ },
  mother_name: { aliases: ["mother_name", "mothers_name", "mother"], pattern: /mother/ },
  religion: { aliases: ["religion"], pattern: /religion/ },
  blood_group: { aliases: ["blood_group", "blood_grp", "bloodgroup", "blood_type"], pattern: /blood/ },
  nationality: { aliases: ["nationality"], pattern: /national/ },
  marital_status: { aliases: ["marital_status", "marital"], pattern: /marital|marriage/ },
  spouse_name: { aliases: ["spouse_name", "spouse"], pattern: /spouse|wife|husband/ },
  kids: { aliases: ["kids", "no_of_kids", "children", "no_of_children"], pattern: /kid|child/ },
  ppt_no: { aliases: ["ppt_no", "passport_no", "passport_number"], pattern: /^ppt_?(no|num)|passport.*(no|num)/ },
  ppt_country: { aliases: ["ppt_country", "passport_country"], pattern: /ppt.*countr|passport.*countr/ },
  ppt_valid_from: { aliases: ["ppt_valid_from", "ppt_issue_date", "passport_valid_from"], pattern: /ppt.*(valid.*from|issue)/, date: true },
  ppt_valid_to: { aliases: ["ppt_valid_to", "ppt_valid_till", "ppt_valid_upto", "ppt_expiry", "ppt_expiry_date", "ppt_exp_date"], pattern: /ppt.*(valid.*(to|till|upto)|exp)/, date: true },
  ip_info: { aliases: ["ip_info", "ip_information", "ip_details"], pattern: /^ip(_|$)/ },
};

type LayoutCell = { label: string; span: number; fields: string[]; joiner?: string; center?: boolean };

// Relative widths of the 12 grid columns (taken from the legacy report)
const GRID = [52, 121, 124, 129, 87, 123, 67, 150, 42, 90, 100, 175];

const LAYOUT: LayoutCell[][] = [
  [
    { label: "Emp.", span: 1, fields: ["employee_id"], center: true },
    { label: "First Name", span: 1, fields: ["first_name"] },
    { label: "Last Name", span: 1, fields: ["last_name"] },
    { label: "Family Name", span: 1, fields: ["family_name"] },
    { label: "Birth Date", span: 1, fields: ["birth_date"], center: true },
    { label: "Birth Place", span: 1, fields: ["birth_place"] },
    { label: "Gender", span: 1, fields: ["gender"], center: true },
    { label: "Father's Name", span: 1, fields: ["father_name"] },
    { label: "Mother's Name", span: 2, fields: ["mother_name"] },
    { label: "Religion", span: 1, fields: ["religion"] },
    { label: "IP Info", span: 1, fields: ["ip_info"] },
  ],
  [
    { label: "Title", span: 1, fields: ["title"], center: true },
    { label: "Second Name", span: 1, fields: ["second_name"] },
    { label: "Third Name", span: 1, fields: ["third_name"] },
    { label: "Fourth Name", span: 1, fields: ["fourth_name"] },
    { label: "Blood Grp", span: 1, fields: ["blood_group"], center: true },
    { label: "Nationality", span: 1, fields: ["nationality"] },
    { label: "Marital", span: 1, fields: ["marital_status"], center: true },
    { label: "Spouse Name", span: 1, fields: ["spouse_name"] },
    { label: "Kids", span: 1, fields: ["kids"], center: true },
    { label: "Passport No./Country", span: 2, fields: ["ppt_no", "ppt_country"], joiner: " / " },
    { label: "Validity", span: 1, fields: ["ppt_valid_from", "ppt_valid_to"], joiner: " - ", center: true },
  ],
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Finds which query column feeds each report field
function resolveFields(keys: string[]) {
  const normKeys = keys.map(norm);
  const map: Record<string, string | undefined> = {};
  const missing: string[] = [];
  for (const [id, spec] of Object.entries(FIELDS)) {
    let idx = -1;
    for (const a of spec.aliases) {
      idx = normKeys.indexOf(norm(a));
      if (idx >= 0) break;
    }
    if (idx < 0 && spec.pattern) idx = keys.findIndex((k) => spec.pattern!.test(k.toLowerCase()));
    if (idx >= 0) map[id] = keys[idx];
    else missing.push(id);
  }
  return { map, missing };
}

function renderBody(rows: ReportRow[], filtersHtml = ""): string {
  const heading = `${FONT_LINK}<div class="doc-title-row"><div><h1>Employee Details Report</h1></div></div>`;

  if (!rows.length) {
    return `${heading}${filtersHtml}<div class="emp-empty">No data found</div>`;
  }

  const keys = Object.keys(rows[0]);
  const { map, missing } = resolveFields(keys);
  if (missing.length) {
    console.warn("Employee Details: no column found for:", missing.join(", "), "| available columns:", keys.join(", "));
  }

  const valueOf = (row: ReportRow, fieldId: string): string => {
    const k = map[fieldId];
    if (!k) return "";
    const v = row[k];
    return FIELDS[fieldId].date ? fmtDate(v) : text(v).trim();
  };

  // One CSS grid per employee (and one for the header) with identical column widths,
  // so header and data always line up and a record never splits across pages.
  const template = GRID.map((w) => `minmax(0,${w}fr)`).join(" ");
  const gridCss = `<style>.emp-grid{grid-template-columns:${template};}</style>`;

  const headCells = LAYOUT.map((line, li) =>
    line
      .map(
        (c) =>
          `<div class="hc${c.center ? " center" : ""}${li > 0 ? " l2" : ""}" style="grid-column:span ${c.span}">${escapeHtml(c.label)}</div>`,
      )
      .join(""),
  ).join("");

  const bodies = rows
    .map((r) => {
      const cells = LAYOUT.map((line) =>
        line
          .map((c) => {
            const val = c.fields.map((f) => valueOf(r, f)).filter(Boolean).join(c.joiner ?? " ");
            return `<div class="gc${c.center ? " center" : ""}" style="grid-column:span ${c.span}">${escapeHtml(val) || "&nbsp;"}</div>`;
          })
          .join(""),
      ).join("");
      return `<tr class="rec"><td class="g"><div class="emp-grid">${cells}</div></td></tr>`;
    })
    .join("");

  return `${heading}${filtersHtml}${gridCss}<table class="emp-table"><thead><tr><th class="g"><div class="emp-grid">${headCells}</div></th></tr></thead><tbody>${bodies}</tbody></table>`;
}

// ─────────────────────────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────────────────────────
export const getHrEmployeeDetailsHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadData(req);
    const headerHtml = await reportHeader({ company_code: params.companyCode, req });

    const filtersHtml = reportAppliedFilters([
      { label: "Division", value: [params.divCode] },
      { label: "Department", value: [params.deptCode] },
      { label: "Section", value: [params.sectCode] },
      { label: "Grade", value: [params.gradeCode] },
      { label: "Designation", value: [params.desgCode] },
      { label: "Employee", value: [params.employeeCode] },
      { label: "Status", value: [STATUS_LABEL[toStatusCode(params.empStatus)] ?? "All"] },
      { label: "Amendment", value: [params.empAmendment === "Y" ? "Yes" : "No"] },
    ]);

    const bodyHtml = renderBody(rows, filtersHtml);
    const footerHtml = reportFooter({
      reportName: "rpt_hr_employee_details",
      userName: params.loginId,
      endLabel: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: "Employee Details",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: EXTRA_CSS,
      autoPrint: req.query.print !== "false",
      showPrintButton: true,
      orientation: "landscape",
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Emp Details HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};