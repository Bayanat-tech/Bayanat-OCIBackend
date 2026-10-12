/**
 * Dynamic HR Reports Controller
 * Route:  GET|POST  /hr-reports/:type/:report
 *   type   = html | excel
 *   report = joiner | register | leavers | tenure
 *
 * Uses PROC_BUILD_DYNAMIC_SQL_HR_REPORT + report_common (header/footer/CSS).
 * Config-driven so adding a 5th report is mostly a new entry in REPORT_CONFIG.
 */

import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import {
  buildReportDocument,
  reportFooter,
  reportHeader,
  reportAppliedFilters,
  AppliedFilter,
} from "../../../controllers/common/report_common";

// ─── Types ────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

type OutputType = "html" | "excel";
type ReportKey = "joiner" | "register" | "leavers" | "tenure";

interface HrBinds {
  parameter: string;
  loginid: string;
  code1: string | null;
  code2: string | null;
  code3: string | null;
  code4: string | null;
  code5: string | null;
  code6: string | null;
  code7: string | null;
  code8: string | null;
  code9: string | null;
  code10: string | null;
  code11: string | null;
  code12: string | null;
  code13: string | null;
  code14: string | null;
  code15: string | null;
  code16: string | null;
  code17: string | null;
  code18: string | null;
  code19: string | null;
  code20: string | null;
  number1: number | null;
  number2: number | null;
  number3: number | null;
  number4: number | null;
  date1: Date | null;
  date2: Date | null;
  date3: Date | null;
  date4: Date | null;
}

interface ColumnDef {
  key: string;           // row field (lowercase)
  header: string;        // column title
  align?: "left" | "right" | "center";
  width?: number;        // excel col width
  format?: "text" | "date" | "number" | "amount" | "sno";
  /** optional custom cell renderer for HTML */
  html?: (row: ReportRow, index: number) => string;
}

interface ReportConfig {
  key: ReportKey;
  procedureParam: string;          // value for P_PARAMETER
  title: string;
  orientation: "portrait" | "landscape";
  groupBy?: string;                // field used for section headers (e.g. div_name)
  columns: ColumnDef[];
  /** build binds from request body / query */
  buildBinds: (req: RequestWithUser, loginid: string) => HrBinds;
  /** applied-filters strip */
  buildFilters: (req: RequestWithUser) => AppliedFilter[];
  /** optional extra HTML after title (period text etc.) */
  subtitle?: (req: RequestWithUser, rows: ReportRow[]) => string;
}

// ─── Shared helpers ───────────────────────────────────────────────────────

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid) {
    tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  }
  if (!tenantId) {
    throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
  }
  return TenantManager.getConnection(tenantId);
}

async function closeConn(conn?: oracledb.Connection) {
  if (conn) {
    try {
      await conn.close();
    } catch (e) {
      console.warn("Close conn error:", e);
    }
  }
}

function normalize(rows: any[] = []): ReportRow[] {
  return rows.map((row) =>
    Object.keys(row).reduce((acc: ReportRow, key) => {
      acc[key.toLowerCase()] = row[key];
      return acc;
    }, {})
  );
}

function text(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function num(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function dateText(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v).substring(0, 10);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function amtFmt(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

function escapeHtml(v: unknown): string {
  return text(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeXml(v: unknown): string {
  return text(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function pick(req: RequestWithUser, ...keys: string[]): string {
  const b = req.body || {};
  const q = req.query || {};
  for (const k of keys) {
    const v = b[k] ?? q[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function pickDate(req: RequestWithUser, ...keys: string[]): Date | null {
  const raw = pick(req, ...keys);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function emptyBinds(loginid: string, parameter: string): HrBinds {
  return {
    parameter,
    loginid,
    code1: null, code2: null, code3: null, code4: null, code5: null,
    code6: null, code7: null, code8: null, code9: null, code10: null,
    code11: null, code12: null, code13: null, code14: null, code15: null,
    code16: null, code17: null, code18: null, code19: null, code20: null,
    number1: null, number2: null, number3: null, number4: null,
    date1: null, date2: null, date3: null, date4: null,
  };
}

// ─── REPORT CONFIG (HTML + Excel share the same config) ───────────────────

const REPORT_CONFIG: Record<ReportKey, ReportConfig> = {
  // 1. Employee Joiner List
  joiner: {
    key: "joiner",
    procedureParam: "Hr_Report_EMPLOYEE_JOINER_LIST",
    title: "Employee Joiners Listing (Confirmed + Probation)",
    orientation: "landscape",
    groupBy: "div_name",
    columns: [
      { key: "_sno", header: "SNo.", align: "center", width: 6, format: "sno" },
      { key: "employee_code", header: "Employee Code", width: 14 },
      { key: "rpt_name", header: "Employee Name", width: 28 },
      { key: "desg_name", header: "Designation", width: 22 },
      { key: "join_date", header: "Join Date", width: 12, format: "date", align: "center" },
      { key: "basic", header: "Basic", width: 12, format: "amount", align: "right" },
      { key: "hra", header: "HRA", width: 12, format: "amount", align: "right" },
      { key: "oth_earn", header: "Other Allowance", width: 14, format: "amount", align: "right" },
      { key: "total_earn", header: "Total Earnings", width: 14, format: "amount", align: "right" },
    ],
    buildBinds(req, loginid) {
      const b = emptyBinds(loginid, "Hr_Report_EMPLOYEE_JOINER_LIST");
      b.code1 = pick(req, "company_code", "as_companycode") || "All";
      b.code2 = pick(req, "div_code", "as_divcode") || "All";
      b.code3 = pick(req, "dept_code", "as_deptcode") || "All";
      b.code4 = pick(req, "section_code", "as_sectcode") || "All";
      b.code5 = pick(req, "grade_code", "as_gradecode") || "All";
      b.code6 = pick(req, "desg_code", "as_desgcode") || "All";
      b.code7 = pick(req, "labour_desg_code", "as_labordesgcode") || "All";
      b.code8 = pick(req, "emp_status", "as_empstatus") || "All";
      b.date1 = pickDate(req, "join_from", "adt_join_from", "date_from");
      b.date2 = pickDate(req, "join_to", "adt_join_to", "date_to");
      return b;
    },
    buildFilters(req) {
      return [
        { label: "Company", value: pick(req, "company_code", "as_companycode") || "All" },
        { label: "Division", value: pick(req, "div_code", "as_divcode") || "All" },
        { label: "Department", value: pick(req, "dept_code", "as_deptcode") || "All" },
        { label: "Section", value: pick(req, "section_code", "as_sectcode") || "All" },
        { label: "From", value: pick(req, "join_from", "adt_join_from", "date_from") },
        { label: "To", value: pick(req, "join_to", "adt_join_to", "date_to") },
        { label: "Status", value: pick(req, "emp_status", "as_empstatus") || "All" },
      ];
    },
    subtitle(req) {
      const div = pick(req, "div_code", "as_divcode");
      const from = pick(req, "join_from", "adt_join_from", "date_from");
      const to = pick(req, "join_to", "adt_join_to", "date_to");
      const period = from || to ? `${from || "…"} – ${to || "…"}` : "—";
      return `for the period ${period}${div && div.toLowerCase() !== "all" ? `  ( Division : ${div} )` : ""}`;
    },
  },

  // 2. Employee Register
  register: {
    key: "register",
    procedureParam: "Hr_Report_EMPLOYEE_REGISTER",
    title: "Employee Register",
    orientation: "landscape",
    groupBy: "_org_path", // composite Division / Dept / Section
    columns: [
      { key: "_sno", header: "#", align: "center", width: 5, format: "sno" },
      {
        key: "employee",
        header: "Employee",
        width: 32,
        html: (r) =>
          `<div><strong>${escapeHtml(r.employee_code)}</strong></div><div class="muted">${escapeHtml(r.rpt_name)}</div>`,
      },
      { key: "desg_name", header: "Designation", width: 22 },
      { key: "grade_name", header: "Grade", width: 16 },
      { key: "join_date", header: "Join Date", width: 12, format: "date", align: "center" },
      { key: "empstatus_name", header: "Status", width: 12, align: "center" },
      { key: "sponsor_name", header: "Sponsor", width: 14 },
    ],
    buildBinds(req, loginid) {
      const b = emptyBinds(loginid, "Hr_Report_EMPLOYEE_REGISTER");
      b.code1 = pick(req, "company_code", "as_companycode") || "All";
      b.code2 = pick(req, "div_code", "as_divcode") || "All";
      b.code3 = pick(req, "dept_code", "as_deptcode") || "All";
      b.code4 = pick(req, "section_code", "as_sectcode") || "All";
      b.code5 = pick(req, "employee_code", "as_empid") || "All";
      b.code6 = pick(req, "grade_code", "as_gradecode") || "All";
      b.code7 = pick(req, "desg_code", "as_desgcode") || "All";
      b.code8 = pick(req, "emp_status", "as_emp_status") || "All";
      b.date1 = pickDate(req, "join_from", "adt_join_from", "date_from");
      b.date2 = pickDate(req, "join_to", "adt_join_to", "date_to");
      return b;
    },
    buildFilters(req) {
      return [
        { label: "Company", value: pick(req, "company_code", "as_companycode") || "All" },
        { label: "Division", value: pick(req, "div_code", "as_divcode") || "All" },
        { label: "Department", value: pick(req, "dept_code", "as_deptcode") || "All" },
        { label: "Section", value: pick(req, "section_code", "as_sectcode") || "All" },
        { label: "Employee", value: pick(req, "employee_code", "as_empid") || "All" },
        { label: "From", value: pick(req, "join_from", "adt_join_from", "date_from") },
        { label: "To", value: pick(req, "join_to", "adt_join_to", "date_to") },
      ];
    },
    subtitle(req) {
      const div = pick(req, "div_code", "as_divcode");
      return div && div.toLowerCase() !== "all" ? `( Division : ${div} )` : "";
    },
  },

  // 3. Employee Leavers
  leavers: {
    key: "leavers",
    procedureParam: "Hr_Report_EMPLOYEE_LEAVERS",
    title: "Employee Leavers Listing",
    orientation: "landscape",
    groupBy: "div_name",
    columns: [
      { key: "_sno", header: "SNo.", align: "center", width: 6, format: "sno" },
      { key: "employee_code", header: "Employee Code", width: 14 },
      { key: "rpt_name", header: "Employee Name", width: 26 },
      { key: "desg_name", header: "Designation", width: 20 },
      { key: "join_date", header: "Join Date", width: 12, format: "date", align: "center" },
      { key: "separation_eff_date", header: "Separation Date", width: 13, format: "date", align: "center" },
      { key: "duration", header: "Duration (Days)", width: 12, format: "number", align: "right" },
      { key: "basic", header: "Basic", width: 11, format: "amount", align: "right" },
      { key: "hra", header: "HRA", width: 11, format: "amount", align: "right" },
      { key: "oth_earn", header: "Other Allowance", width: 13, format: "amount", align: "right" },
      { key: "total_earn", header: "Total Earnings", width: 13, format: "amount", align: "right" },
    ],
    buildBinds(req, loginid) {
      const b = emptyBinds(loginid, "Hr_Report_EMPLOYEE_LEAVERS");
      b.code1 = pick(req, "company_code", "as_companycode") || "All";
      b.code2 = pick(req, "div_code", "as_divcode") || "All";
      b.code3 = pick(req, "dept_code", "as_deptcode") || "All";
      b.code4 = pick(req, "section_code", "as_sectcode") || "All";
      b.code5 = pick(req, "grade_code", "as_gradecode") || "All";
      b.code6 = pick(req, "desg_code", "as_desgcode") || "All";
      b.code7 = pick(req, "labour_desg_code", "as_labordesgcode") || "All";
      b.date1 = pickDate(req, "sep_from", "adt_join_from", "date_from");
      b.date2 = pickDate(req, "sep_to", "adt_join_to", "date_to");
      return b;
    },
    buildFilters(req) {
      return [
        { label: "Company", value: pick(req, "company_code", "as_companycode") || "All" },
        { label: "Division", value: pick(req, "div_code", "as_divcode") || "All" },
        { label: "Department", value: pick(req, "dept_code", "as_deptcode") || "All" },
        { label: "From", value: pick(req, "sep_from", "adt_join_from", "date_from") },
        { label: "To", value: pick(req, "sep_to", "adt_join_to", "date_to") },
      ];
    },
    subtitle(req) {
      const div = pick(req, "div_code", "as_divcode");
      const from = pick(req, "sep_from", "adt_join_from", "date_from");
      const to = pick(req, "sep_to", "adt_join_to", "date_to");
      const period = from || to ? `${from || "…"} – ${to || "…"}` : "—";
      return `for the period ${period}${div && div.toLowerCase() !== "all" ? `  ( Division : ${div} )` : ""}`;
    },
  },

  // 4. Employee Tenure
  tenure: {
    key: "tenure",
    procedureParam: "Hr_Report_EMPLOYEE_TENURE",
    title: "Employee Tenure Report",
    orientation: "portrait",
    columns: [
      { key: "employee_id", header: "Employee ID", width: 12 },
      { key: "rpt_name", header: "Employee Name", width: 30 },
      { key: "join_date", header: "Join Date", width: 12, format: "date", align: "center" },
      {
        key: "service",
        header: "Service Days",
        width: 22,
        html: (r) =>
          `${escapeHtml(r.years)} yrs ${escapeHtml(r.months)} months ${escapeHtml(r.days)} days`,
      },
    ],
    buildBinds(req, loginid) {
      const b = emptyBinds(loginid, "Hr_Report_EMPLOYEE_TENURE");
      b.code1 = pick(req, "company_code", "as_companycode") || "All";
      b.code2 = pick(req, "div_code", "as_divcode") || "All";
      b.code3 = pick(req, "dept_code", "as_deptcode") || "All";
      b.code4 = pick(req, "section_code", "as_sectcode") || "All";
      b.code5 = pick(req, "grade_code", "as_gradecode") || "All";
      b.code6 = pick(req, "desg_code", "as_desgcode") || "All";
      b.code7 = pick(req, "employee_id", "as_employee_id") || "All";
      return b;
    },
    buildFilters(req) {
      return [
        { label: "Company", value: pick(req, "company_code", "as_companycode") || "All" },
        { label: "Division", value: pick(req, "div_code", "as_divcode") || "All" },
        { label: "Department", value: pick(req, "dept_code", "as_deptcode") || "All" },
        { label: "Employee ID", value: pick(req, "employee_id", "as_employee_id") || "All" },
      ];
    },
    subtitle(req) {
      const div = pick(req, "div_code", "as_divcode");
      return div && div.toLowerCase() !== "all" ? `( Division : ${div} )` : "";
    },
  },
};

// ─── Data loader ──────────────────────────────────────────────────────────

async function loadReportData(req: RequestWithUser, cfg: ReportConfig): Promise<ReportRow[]> {
  const loginid = text(req.user?.loginid) || pick(req, "loginid") || "ADMIN";
  const binds = cfg.buildBinds(req, loginid);

  const conn = await getConn(req);
  try {
    const procBinds: any = {
      parameter: binds.parameter,
      loginid: binds.loginid,
      code1: binds.code1,
      code2: binds.code2,
      code3: binds.code3,
      code4: binds.code4,
      code5: binds.code5,
      code6: binds.code6,
      code7: binds.code7,
      code8: binds.code8,
      code9: binds.code9,
      code10: binds.code10,
      code11: binds.code11,
      code12: binds.code12,
      code13: binds.code13,
      code14: binds.code14,
      code15: binds.code15,
      code16: binds.code16,
      code17: binds.code17,
      code18: binds.code18,
      code19: binds.code19,
      code20: binds.code20,
      number1: binds.number1,
      number2: binds.number2,
      number3: binds.number3,
      number4: binds.number4,
      date1: binds.date1,
      date2: binds.date2,
      date3: binds.date3,
      date4: binds.date4,
      out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    const result = await conn.execute(
      `DECLARE
         v_sql VARCHAR2(32767);
       BEGIN
         PROC_BUILD_DYNAMIC_SQL_HR_REPORT(
           :parameter, :loginid,
           :code1,  :code2,  :code3,  :code4,  :code5,
           :code6,  :code7,  :code8,  :code9,  :code10,
           :code11, :code12, :code13, :code14, :code15,
           :code16, :code17, :code18, :code19, :code20,
           :number1, :number2, :number3, :number4,
           :date1,   :date2,   :date3,   :date4,
           v_sql
         );
         :out_sql := v_sql;
       END;`,
      procBinds
    );

    const rawSql = (result.outBinds as any).out_sql as string;
    if (!rawSql || rawSql === "INVALID PARAMETER VALUE") {
      throw new Error("Procedure did not return a valid SQL query.");
    }

    console.log("=== HR REPORT SQL ===\n", rawSql, "\n=== END ===");

    const dataResult = await conn.execute(rawSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    let rows = normalize(dataResult.rows as any[]);

    // Enrich register rows with a composite group key
    if (cfg.key === "register") {
      rows = rows.map((r) => ({
        ...r,
        _org_path: [
          r.div_name ? `Division: ${r.div_code || ""} ${r.div_name}` : null,
          r.dept_name ? `Department: ${r.dept_code || ""} ${r.dept_name}` : null,
          r.section_name ? `Section: ${r.section_code || ""} ${r.section_name}` : null,
        ]
          .filter(Boolean)
          .join("  |  "),
      }));
    }

    return rows;
  } finally {
    await closeConn(conn);
  }
}

// ─── Cell value helpers ───────────────────────────────────────────────────

function cellValue(col: ColumnDef, row: ReportRow, index: number): string {
  if (col.format === "sno") return String(index + 1);
  if (col.html) return col.html(row, index);

  const raw = row[col.key];
  switch (col.format) {
    case "date":
      return dateText(raw);
    case "amount":
      return amtFmt(raw);
    case "number":
      return String(num(raw));
    default:
      return text(raw);
  }
}

// ─── HTML renderer ────────────────────────────────────────────────────────

const HR_EXTRA_CSS = `
  .doc-title-row { margin: 0 0 6px 0; }
  .doc-title-row h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 800;
    color: #00378c;
  }
  .doc-title-row .doc-sub {
    margin: 2px 0 0;
    font-size: 11px;
    color: #64748b;
  }
  table.data-table {
    table-layout: fixed;
    width: 100%;
  }
  table.data-table th,
  table.data-table td {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  table.data-table td.wrap {
    white-space: normal;
    word-break: break-word;
  }
  .group-strip {
    background: #eaf0f8;
    color: #00378c;
    font-weight: 800;
    font-size: 11px;
    padding: 4px 6px;
  }
  tr.group-total td {
    background: #f1f5f9;
    font-weight: 700;
    color: #00378c;
  }
  tr.grand-total td {
    background: #e2e8f0;
    font-weight: 800;
    color: #00378c;
  }
  .muted { color: #64748b; font-size: 0.95em; }
  @media screen {
    .doc-title-row h1 { font-size: 12px; }
    .doc-title-row .doc-sub { font-size: 9px; }
  }
`;

function renderHtmlBody(
  cfg: ReportConfig,
  rows: ReportRow[],
  req: RequestWithUser
): string {
  const subtitle = cfg.subtitle ? cfg.subtitle(req, rows) : "";
  const filtersHtml = reportAppliedFilters(cfg.buildFilters(req), { includeAll: false });

  if (!rows.length) {
    return `
      <div class="doc-title-row">
        <h1>${escapeHtml(cfg.title)}</h1>
        ${subtitle ? `<div class="doc-sub">${escapeHtml(subtitle)}</div>` : ""}
      </div>
      ${filtersHtml}
      <div class="empty">No records found for the selected criteria.</div>
    `;
  }

  const colCount = cfg.columns.length;
  let sno = 0;
  let html = `
    <div class="doc-title-row">
      <h1>${escapeHtml(cfg.title)}</h1>
      ${subtitle ? `<div class="doc-sub">${escapeHtml(subtitle)}</div>` : ""}
    </div>
    ${filtersHtml}
    <table class="data-table">
      <thead>
        <tr>
          ${cfg.columns
            .map(
              (c) =>
                `<th class="${c.align || "left"}" style="${c.width ? `width:${c.width}%` : ""}">${escapeHtml(
                  c.header
                )}</th>`
            )
            .join("")}
        </tr>
      </thead>
      <tbody>
  `;

  const groupKey = cfg.groupBy;
  let currentGroup = "";
  let groupCount = 0;
  let grandCount = 0;

  const flushGroupTotal = (label: string, count: number) => {
    if (!groupKey || !count) return;
    html += `
      <tr class="group-total">
        <td colspan="${colCount - 1}" class="right">Total No. of Employees in ${escapeHtml(label)} :</td>
        <td class="right strong">${count}</td>
      </tr>`;
  };

  for (const row of rows) {
    const g = groupKey ? text(row[groupKey]) || "—" : "";
    if (groupKey && g !== currentGroup) {
      if (currentGroup) flushGroupTotal(currentGroup, groupCount);
      currentGroup = g;
      groupCount = 0;
      html += `
        <tr>
          <td colspan="${colCount}" class="group-strip">${escapeHtml(g)}</td>
        </tr>`;
    }

    sno += 1;
    groupCount += 1;
    grandCount += 1;

    html += `<tr>`;
    for (const col of cfg.columns) {
      const cls = [col.align || "left", col.key === "rpt_name" || col.key === "employee" ? "wrap" : ""]
        .filter(Boolean)
        .join(" ");
      const val =
        col.format === "sno"
          ? String(sno)
          : cellValue(col, row, sno - 1);
      html += `<td class="${cls}">${val}</td>`;
    }
    html += `</tr>`;
  }

  if (groupKey && currentGroup) flushGroupTotal(currentGroup, groupCount);

  // Grand total row for grouped reports
  if (groupKey) {
    html += `
      <tr class="grand-total">
        <td colspan="${colCount - 1}" class="right">Grand Total :</td>
        <td class="right strong">${grandCount}</td>
      </tr>`;
  }

  html += `</tbody></table>`;
  return html;
}

// ─── Excel builder (lightweight OOXML) ────────────────────────────────────

function buildExcelBuffer(cfg: ReportConfig, rows: ReportRow[], loginId: string): Buffer {
  const BLUE = "FF00378C";
  const WHITE = "FFFFFFFF";
  const STRIP = "FFEAF0F8";
  const ALT = "FFFCFDFE";

  interface XlCell {
    v: unknown;
    styleKey: string;
  }
  type XlRow = (XlCell | null)[];

  const sheetRows: XlRow[] = [];
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
  const cell = (v: unknown, styleKey: string): XlCell => ({ v, styleKey });
  const COL = cfg.columns.length;

  // Title
  sheetRows.push([cell(cfg.title, "title"), ...Array(COL - 1).fill(null)]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL - 1 } });

  // Meta
  const printed = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  sheetRows.push([
    cell(`Print: ${printed}  |  User: ${loginId}`, "meta"),
    ...Array(COL - 1).fill(null),
  ]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: COL - 1 } });

  sheetRows.push(Array(COL).fill(null));

  // Header
  sheetRows.push(cfg.columns.map((c) => cell(c.header, "header")));

  let sno = 0;
  let currentGroup = "";
  let groupCount = 0;
  let grandCount = 0;

  const pushGroupTotal = (label: string, count: number) => {
    const r = sheetRows.length;
    const row: XlRow = Array(COL).fill(null);
    row[0] = cell(`Total No. of Employees in ${label} : ${count}`, "groupTotal");
    sheetRows.push(row);
    merges.push({ s: { r, c: 0 }, e: { r, c: COL - 1 } });
  };

  for (const row of rows) {
    const g = cfg.groupBy ? text(row[cfg.groupBy]) || "—" : "";
    if (cfg.groupBy && g !== currentGroup) {
      if (currentGroup) pushGroupTotal(currentGroup, groupCount);
      currentGroup = g;
      groupCount = 0;
      const r = sheetRows.length;
      const gr: XlRow = Array(COL).fill(null);
      gr[0] = cell(g, "groupStrip");
      sheetRows.push(gr);
      merges.push({ s: { r, c: 0 }, e: { r, c: COL - 1 } });
    }

    sno += 1;
    groupCount += 1;
    grandCount += 1;

    const dataRow: XlRow = cfg.columns.map((col) => {
      if (col.format === "sno") return cell(sno, "dataCenter");
      const raw = row[col.key];
      if (col.format === "amount" || col.format === "number") {
        return cell(num(raw), "dataNum");
      }
      if (col.format === "date") return cell(dateText(raw), "dataCenter");
      if (col.key === "service") {
        return cell(`${text(row.years)} yrs ${text(row.months)} months ${text(row.days)} days`, "data");
      }
      if (col.key === "employee") {
        return cell(`${text(row.employee_code)} ${text(row.rpt_name)}`, "data");
      }
      return cell(text(raw), "data");
    });
    sheetRows.push(dataRow);
  }

  if (cfg.groupBy && currentGroup) pushGroupTotal(currentGroup, groupCount);

  if (cfg.groupBy) {
    const r = sheetRows.length;
    const gt: XlRow = Array(COL).fill(null);
    gt[0] = cell(`Grand Total : ${grandCount}`, "grandTotal");
    sheetRows.push(gt);
    merges.push({ s: { r, c: 0 }, e: { r, c: COL - 1 } });
  }

  sheetRows.push(Array(COL).fill(null));
  const foot: XlRow = Array(COL).fill(null);
  foot[COL - 1] = cell("Powered by AWARE", "footer");
  sheetRows.push(foot);

  // ── Style engine (same pattern as PO reference) ──
  interface FontDef {
    bold?: boolean;
    italic?: boolean;
    sz?: number;
    color?: string;
  }
  interface FillDef {
    color?: string;
  }
  interface BorderDef {
    top?: string;
    bottom?: string;
    left?: string;
    right?: string;
  }
  interface XfDef {
    fontId: number;
    fillId: number;
    borderId: number;
    numFmtId: number;
    align?: string;
    wrap?: boolean;
  }

  const styleDefs: Record<string, any> = {
    title: {
      font: { bold: true, sz: 14, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "center", vertical: "center" },
    },
    meta: { font: { sz: 9, color: { rgb: "FF475569" } } },
    header: {
      font: { bold: true, sz: 10, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: {
        top: { color: { rgb: BLUE } },
        bottom: { color: { rgb: BLUE } },
        left: { color: { rgb: BLUE } },
        right: { color: { rgb: BLUE } },
      },
    },
    groupStrip: {
      font: { bold: true, sz: 10, color: { rgb: BLUE } },
      fill: { fgColor: { rgb: STRIP } },
    },
    groupTotal: {
      font: { bold: true, sz: 10, color: { rgb: BLUE } },
      fill: { fgColor: { rgb: "FFF1F5F9" } },
    },
    grandTotal: {
      font: { bold: true, sz: 11, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
    },
    data: {
      font: { sz: 10 },
      alignment: { vertical: "center" },
      border: { bottom: { color: { rgb: "FFE2E8F0" } } },
    },
    dataCenter: {
      font: { sz: 10 },
      alignment: { horizontal: "center", vertical: "center" },
      border: { bottom: { color: { rgb: "FFE2E8F0" } } },
    },
    dataNum: {
      font: { sz: 10 },
      alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.00",
      border: { bottom: { color: { rgb: "FFE2E8F0" } } },
    },
    footer: {
      font: { italic: true, sz: 8, color: { rgb: "FF64748B" } },
      alignment: { horizontal: "right" },
    },
  };

  const fonts: FontDef[] = [{}];
  const fills: FillDef[] = [{}, {}];
  const borders: BorderDef[] = [{}];
  const numFmts: Array<{ id: number; code: string }> = [];
  const cellXfs: XfDef[] = [{ fontId: 0, fillId: 0, borderId: 0, numFmtId: 0 }];
  const sigCache = new Map<string, number>();
  let nextCustomNumFmtId = 164;

  const registerFont = (f: any): number => {
    const def: FontDef = {
      bold: !!f?.bold,
      italic: !!f?.italic,
      sz: f?.sz ?? 10,
      color: f?.color?.rgb,
    };
    const key = `font:${JSON.stringify(def)}`;
    if (sigCache.has(key)) return sigCache.get(key)!;
    fonts.push(def);
    const idx = fonts.length - 1;
    sigCache.set(key, idx);
    return idx;
  };

  const registerFill = (f: any): number => {
    if (!f?.fgColor?.rgb) return 0;
    const def: FillDef = { color: f.fgColor.rgb };
    const key = `fill:${JSON.stringify(def)}`;
    if (sigCache.has(key)) return sigCache.get(key)!;
    fills.push(def);
    const idx = fills.length - 1;
    sigCache.set(key, idx);
    return idx;
  };

  const registerBorder = (b: any): number => {
    if (!b) return 0;
    const def: BorderDef = {
      top: b.top?.color?.rgb,
      bottom: b.bottom?.color?.rgb,
      left: b.left?.color?.rgb,
      right: b.right?.color?.rgb,
    };
    if (!def.top && !def.bottom && !def.left && !def.right) return 0;
    const key = `border:${JSON.stringify(def)}`;
    if (sigCache.has(key)) return sigCache.get(key)!;
    borders.push(def);
    const idx = borders.length - 1;
    sigCache.set(key, idx);
    return idx;
  };

  const registerNumFmt = (code?: string): number => {
    if (!code) return 0;
    const existing = numFmts.find((n) => n.code === code);
    if (existing) return existing.id;
    const id = nextCustomNumFmtId++;
    numFmts.push({ id, code });
    return id;
  };

  const registerXf = (styleObj: any): number => {
    if (!styleObj) return 0;
    const fontId = registerFont(styleObj.font);
    const fillId = registerFill(styleObj.fill);
    const borderId = registerBorder(styleObj.border);
    const numFmtId = registerNumFmt(styleObj.numFmt);
    const align = styleObj.alignment?.horizontal;
    const wrap = !!styleObj.alignment?.wrapText;
    const key = `xf:${JSON.stringify({ fontId, fillId, borderId, numFmtId, align, wrap })}`;
    if (sigCache.has(key)) return sigCache.get(key)!;
    cellXfs.push({ fontId, fillId, borderId, numFmtId, align, wrap });
    const idx = cellXfs.length - 1;
    sigCache.set(key, idx);
    return idx;
  };

  const styleIndexFor = (styleKey: string): number => registerXf(styleDefs[styleKey]);

  const colXml = cfg.columns
    .map(
      (c, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${c.width || 14}" customWidth="1"/>`
    )
    .join("");

  let sheetDataXml = "";
  sheetRows.forEach((row, ri) => {
    const rn = ri + 1;
    let rowXml = `<row r="${rn}">`;
    row.forEach((c, ci) => {
      if (c === null) return;
      const ref = String.fromCharCode(65 + ci) + rn;
      const s = styleIndexFor(c.styleKey);
      if (typeof c.v === "number") {
        rowXml += `<c r="${ref}" s="${s}"><v>${c.v}</v></c>`;
      } else {
        rowXml += `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${escapeXml(
          c.v ?? ""
        )}</t></is></c>`;
      }
    });
    rowXml += `</row>`;
    sheetDataXml += rowXml;
  });

  const mergesXml = merges
    .map(
      (m) =>
        `<mergeCell ref="${String.fromCharCode(65 + m.s.c)}${m.s.r + 1}:${String.fromCharCode(
          65 + m.e.c
        )}${m.e.r + 1}"/>`
    )
    .join("");
  const mergeFinal = merges.length
    ? `<mergeCells count="${merges.length}">${mergesXml}</mergeCells>`
    : "";

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
           xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colXml}</cols>
  <sheetData>${sheetDataXml}</sheetData>
  ${mergeFinal}
</worksheet>`;

  const numFmtsXml = numFmts.length
    ? `<numFmts count="${numFmts.length}">${numFmts
        .map((n) => `<numFmt numFmtId="${n.id}" formatCode="${escapeXml(n.code)}"/>`)
        .join("")}</numFmts>`
    : "";

  const fontsXml = `<fonts count="${fonts.length}">${fonts
    .map(
      (f) => `
    <font>
      ${f.sz ? `<sz val="${f.sz}"/>` : '<sz val="10"/>'}
      ${f.color ? `<color rgb="${f.color}"/>` : '<color rgb="FF000000"/>'}
      <name val="Arial"/>
      ${f.bold ? "<b/>" : ""}
      ${f.italic ? "<i/>" : ""}
    </font>`
    )
    .join("")}</fonts>`;

  const fillsXml = `<fills count="${fills.length}">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    ${fills
      .slice(2)
      .map(
        (f) => `
    <fill>
      <patternFill patternType="solid">
        <fgColor rgb="${f.color}"/>
        <bgColor rgb="${f.color}"/>
      </patternFill>
    </fill>`
      )
      .join("")}
  </fills>`;

  const borderEdge = (rgb?: string) => (rgb ? `<color rgb="${rgb}"/>` : "");
  const bordersXml = `<borders count="${borders.length}">${borders
    .map(
      (b) => `
    <border>
      <left style="${b.left ? "thin" : "none"}">${borderEdge(b.left)}</left>
      <right style="${b.right ? "thin" : "none"}">${borderEdge(b.right)}</right>
      <top style="${b.top ? "thin" : "none"}">${borderEdge(b.top)}</top>
      <bottom style="${b.bottom ? "thin" : "none"}">${borderEdge(b.bottom)}</bottom>
      <diagonal/>
    </border>`
    )
    .join("")}</borders>`;

  const cellXfsXml = `<cellXfs count="${cellXfs.length}">${cellXfs
    .map((xf) => {
      const applyAlign = xf.align || xf.wrap;
      return `
    <xf numFmtId="${xf.numFmtId}" fontId="${xf.fontId}" fillId="${xf.fillId}" borderId="${xf.borderId}"
        applyFont="1" applyFill="${xf.fillId ? 1 : 0}" applyBorder="${xf.borderId ? 1 : 0}"
        applyNumberFormat="${xf.numFmtId ? 1 : 0}" applyAlignment="${applyAlign ? 1 : 0}">
      ${
        applyAlign
          ? `<alignment${xf.align ? ` horizontal="${xf.align}"` : ""}${
              xf.wrap ? ` wrapText="1"` : ""
            } vertical="center"/>`
          : ""
      }
    </xf>`;
    })
    .join("")}</cellXfs>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${numFmtsXml}
  ${fontsXml}
  ${fillsXml}
  ${bordersXml}
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  ${cellXfsXml}
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(cfg.title).substring(0, 31)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml"          ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml"            ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(contentTypes));
  zip.addFile("_rels/.rels", Buffer.from(rels));
  zip.addFile("xl/workbook.xml", Buffer.from(workbookXml));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheetXml));
  zip.addFile("xl/styles.xml", Buffer.from(stylesXml));
  return zip.toBuffer();
}

// ─── Single route handler ─────────────────────────────────────────────────

/**
 * GET|POST /hr-reports/:type/:report
 * type   = html | excel
 * report = joiner | register | leavers | tenure
 */
export const getHrReport = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const type = String(req.params.type || "").toLowerCase() as OutputType;
    const reportKey = String(req.params.report || "").toLowerCase() as ReportKey;

    if (type !== "html" && type !== "excel") {
      res.status(400).json({ success: false, message: "type must be 'html' or 'excel'" });
      return;
    }

    const cfg = REPORT_CONFIG[reportKey];
    if (!cfg) {
      res.status(400).json({
        success: false,
        message: `Unknown report '${reportKey}'. Valid: joiner, register, leavers, tenure`,
      });
      return;
    }

    const rows = await loadReportData(req, cfg);
    const loginid = text(req.user?.loginid) || pick(req, "loginid") || "ADMIN";

    if (type === "excel") {
      const buffer = buildExcelBuffer(cfg, rows, loginid);
      const filename = `HR_${reportKey}_${Date.now()}.xlsx`;
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.end(buffer);
      return;
    }

    // HTML
    const companyCode =
      pick(req, "company_code", "as_companycode") ||
      text(req.user?.company_code) ||
      "BSG";

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: cfg.title,
      userName: loginid,
      endLabel: "Powered by AWARE",
    });
    const bodyHtml = renderHtmlBody(cfg, rows, req);

    const html = buildReportDocument({
      title: cfg.title,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: HR_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
      orientation: cfg.orientation,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("HR Report error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate report",
    });
  }
};

// Optional: individual named exports if you prefer separate routes
export const getHrJoinerReport = (req: RequestWithUser, res: Response) => {
  req.params.report = "joiner";
  return getHrReport(req, res);
};
export const getHrRegisterReport = (req: RequestWithUser, res: Response) => {
  req.params.report = "register";
  return getHrReport(req, res);
};
export const getHrLeaversReport = (req: RequestWithUser, res: Response) => {
  req.params.report = "leavers";
  return getHrReport(req, res);
};
export const getHrTenureReport = (req: RequestWithUser, res: Response) => {
  req.params.report = "tenure";
  return getHrReport(req, res);
};