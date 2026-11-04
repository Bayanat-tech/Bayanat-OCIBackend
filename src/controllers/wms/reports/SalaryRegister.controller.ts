// src/controllers/wms/reports/SalaryRegister.controller.ts

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

function fmtAmount(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${abs})` : abs;
}

// ─── Param Parser ────────────────────────────────────────────────────────────

const REPORT_MODE_LABELS: Record<string, string> = {
  TIMESHEET: "Time Sheet",
  PAYROLL: "Pay Roll",
  VACATION: "Vacation Settlement",
  SEPARATION: "Separation",
  LEAVE_ENCASHMENT: "Leave Encashment",
  ALL: "All",
};

function allIfBlank(value: unknown): string {
  const v = text(value).trim();
  return v || "All";
}

function parseParams(req: RequestWithUser) {
  const src = { ...(req.query as Record<string, any>), ...(req.body || {}) };

  const userCompany = text(req.user?.company_code).trim();
  const companyCode = userCompany || text(src.company_code).trim() || "";

  const payMonth = Number(text(src.pay_month).trim());
  const payYear = Number(text(src.pay_year).trim());
  const reportMode = text(src.report_mode).trim().toUpperCase() || "PAYROLL";

  return {
    companyCode,
    divCode: allIfBlank(src.div_code),
    deptCode: allIfBlank(src.dept_code),
    sectCode: allIfBlank(src.section_code ?? src.sect_code),
    employeeCode: allIfBlank(src.employee_code),
    payMonth: Number.isFinite(payMonth) ? payMonth : 0,
    payYear: Number.isFinite(payYear) ? payYear : 0,
    earnDed: allIfBlank(src.earn_ded),
    historyReport: text(src.history_report).trim().toUpperCase() === "Y" ? "Y" : "N",
    reportMode,
    loginId: text(req.user?.loginid || (req.user as any)?.username || ""),
  };
}

function parameterForMode(mode: string): string {
  switch ((mode || "PAYROLL").toUpperCase()) {
    case "TIMESHEET":        return "Hr_Report_SALARY_REGISTER_TIMESHEET";
    case "PAYROLL":          return "Hr_Report_SALARY_REGISTER_PAYROLL";
    case "VACATION":         return "Hr_Report_SALARY_REGISTER_VACATION";
    case "SEPARATION":       return "Hr_Report_SALARY_REGISTER_SEPARATION";
    case "LEAVE_ENCASHMENT": return "Hr_Report_SALARY_REGISTER_LEAVE_ENCASHMENT";
    case "ALL":              return "Hr_Report_SALARY_REGISTER_ALL";
    default:                 return "Hr_Report_SALARY_REGISTER_PAYROLL";
  }
}

// ─── Data Loader ─────────────────────────────────────────────────────────────

async function loadSalaryRegisterData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);

  if (!params.companyCode) {
    throw Object.assign(new Error("company_code is required"), { status: 400 });
  }
  if (params.payMonth < 1 || params.payMonth > 12) {
    throw Object.assign(new Error("pay_month must be between 1 and 12"), { status: 400 });
  }
  if (params.payYear < 1900 || params.payYear > 9999) {
    throw Object.assign(new Error("pay_year must be a valid 4-digit year"), { status: 400 });
  }

  const conn = await getConn(req);

  try {
    const binds: Record<string, any> = {
      p_parameter: parameterForMode(params.reportMode),
      p_loginid: params.loginId,
      p_number1: params.payMonth,
      p_number2: params.payYear,
      p_number3: null,
      p_number4: null,
      p_date1: { val: null, type: oracledb.DATE },
      p_date2: { val: null, type: oracledb.DATE },
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
      params.earnDed,
      params.historyReport,
      params.reportMode,
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

    if (!builtSql || builtSql.toUpperCase() === "INVALID PARAMETER VALUE") {
      throw Object.assign(new Error("Report procedure returned no query"), { status: 500 });
    }

    const result = await conn.execute(builtSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Extra CSS ────────────────────────────────────────────────────────────────

const SALARY_EXTRA_CSS = `
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }

  body, table.sal-table {
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

  table.sal-table {
    /* width is set inline from the number of columns */
    table-layout: fixed; /* Forces browser to respect column widths */
    border-collapse: collapse;
    font-size: 9px;
    margin-top: 6px;
    border: 1px solid #94a3b8;
  }

  table.sal-table thead th {
    background: #00378c !important;
    color: #ffffff !important;
    font-weight: 700;
    font-size: var(--sal-hfs, 8px);
    letter-spacing: 0;
    padding: 5px 2px;
    text-align: left;
    vertical-align: middle;
    border: 0 !important;
    border-right: 1px solid rgba(255, 255, 255, 0.45) !important;
    box-shadow: inset 0 0 0 1000px #00378c;
    white-space: normal !important;
    word-break: normal;
    overflow-wrap: break-word;
    overflow: hidden;
    line-height: 1.25;
  }
  table.sal-table thead th.num-head { text-align: right; }
  
  /* Fill any sub-pixel gap between the two header rows with the header colour */
  table.sal-table thead,
  table.sal-table thead tr {
    background: #00378c !important;
  }

  /* Group Headers */
  .super-head {
    background: #002560 !important;
    text-align: center !important;
    font-size: 9px;
    padding: 4px !important;
  }
  /* Visible separator under Earnings / Deductions (needs the higher specificity
     because "thead th" above sets border: 0 !important) */
  table.sal-table thead th.super-head {
    border-bottom: 1px solid #5f82c2 !important;
  }

  table.sal-table tbody td {
    padding: 3px 2px;
    border: 0;
    border-bottom: 1px solid #94a3b8 !important;
    border-right: 1px solid #94a3b8 !important;
    color: #1e293b;
    font-size: var(--sal-fs, 8.5px);
    font-weight: 400;
    background: #fcfdfe;
    vertical-align: middle;
    white-space: normal;
    overflow-wrap: anywhere;
    overflow: hidden;
  }

  /* Text cells (names etc.) wrap instead of being cut */
  table.sal-table tbody td.txt {
    white-space: normal !important;
    word-break: break-word;
    overflow-wrap: anywhere;
    overflow: visible;
  }

  /* Department Grouping Rows */
  .dept-group-row td {
    background: #e2e8f0 !important;
    color: #00378c !important;
    font-weight: 700 !important;
    text-align: left !important;
    font-size: 10px !important;
    padding: 4px 6px !important;
    border-bottom: 1px solid #cbd5e1 !important;
  }

  .center { text-align: center; }
  .left   { text-align: left; }
  .right  { text-align: right; }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  table.sal-table tbody tr.grand-total-row td {
    background: #e2e8f0 !important;
    color: #00378c !important;
    font-weight: 800;
    border-bottom: 1px solid #cbd5e1 !important;
  }

  .sal-empty {
    border: 1px dashed #cbd5e1;
    background: #f8fafc;
    text-align: center;
    padding: 40px 12px;
    margin-top: 14px;
    color: #64748b;
    font-weight: 700;
  }

  /* Signatures */
  .signatures-row {
    display: flex;
    justify-content: space-between;
    margin-top: 120px;
    padding: 0 10px;
  }
  .signature-box {
    width: 30%;
    text-align: center;
    font-size: 11px;
    font-weight: 600;
    color: #1e293b;
  }
  .signature-line {
    border-top: 1px solid #000;
    margin-bottom: 6px;
    padding-top: 5px;
  }

  @media print {
    body .doc-title-row h1 { color: #00378c !important; }

    table.sal-table thead { display: table-header-group; }
    table.sal-table tr    { page-break-inside: avoid; }

    table.sal-table thead th {
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

// ─── Column model ────────────────────────────────────────────────────────────

type ColKind = "text" | "date" | "amount";
type Band = "earn" | "ded" | "plain";

type Col = {
  key: string;
  label: string;
  kind: ColKind;
  width: number; // px
  total: boolean;
  band: Band;
};

const NO_TOTAL_RE = /(^|_)(id|code|no|sno|year|month|days?|age)$/i;

// Column widths are relative weights (px at full font). The table is always
// rendered at 100% of the page width, so it can never be cut off.
const SNO_WIDTH = 30;
const NAME_WIDTH = 130;
const CODE_WIDTH = 80;
const COMP_WIDTH = 62;
const SUBTOTAL_WIDTH = 70;
const TOTAL_WIDTH = 75;
const FIT_WIDTH = 1075; // usable width of A4 landscape at full font
const BODY_FONT = 8.5;
const HEAD_FONT = 8;
const MIN_FONT_SCALE = 0.76; // never shrink text below ~6.5px

/** Generic columns for the non-payroll modes (whatever the procedure returns). */
function buildFlatTable(rows: ReportRow[]): { cols: Col[]; rows: ReportRow[] } {
  const keys = Object.keys(rows[0] || {}).filter((k) => k !== "dept_name");
  const cols: Col[] = keys.map((key) => {
    const sample = rows.map((r) => r[key]).filter((v) => v != null && v !== "");
    let kind: ColKind = "text";
    if (sample.length && sample.every((v) => v instanceof Date)) kind = "date";
    else if (sample.length && sample.every((v) => typeof v === "number")) kind = "amount";
    return {
      key,
      kind,
      label: key.replace(/_/g, " ").toUpperCase(),
      total: kind === "amount" && !NO_TOTAL_RE.test(key),
      band: "plain" as Band,
      width: kind === "amount" ? 90 : key === "employee_name" ? NAME_WIDTH : 100,
    };
  });
  return { cols, rows };
}

/** Short header text: abbreviate long words, drop stand-alone dashes. */
const SHORT_WORDS: Record<string, string> = {
  ALLOWANCE: "ALLOW.",
  ALLOWANCES: "ALLOW.",
  TRANSPORT: "TRANSP.",
  TELEPHONE: "TEL.",
  ADDITION: "ADDN.",
  ADDITIONS: "ADDN.",
  DEDUCTION: "DED.",
  DEDUCTIONS: "DED.",
  PROFESSIONAL: "PROF.",
  INSURANCE: "INS.",
  MEDICAL: "MED.",
  INCENTIVE: "INCENT.",
  ACCOMMODATION: "ACCOM.",
  EMPLOYEE: "EMP.",
  OVERTIME: "OT",
  GRATUITY: "GRAT.",
  SALARY: "SAL.",
  ADVANCE: "ADV.",
  MANAGEMENT: "MGMT.",
  COMMISSION: "COMM.",
  CONVEYANCE: "CONV.",
  TOTAL: "TOT.",
};

function shortLabel(name: string): string {
  return name
    .toUpperCase()
    .replace(/\s+-\s+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SHORT_WORDS[w] ?? w)
    .join(" ");
}

/** Greedy wrap of a header into short lines (max ~10 chars per line). */
function wrapLabel(label: string, max = 10): string {
  const lines: string[] = [];
  for (const w of label.split(/\s+/).filter(Boolean)) {
    const last = lines.length - 1;
    if (last >= 0 && (lines[last] + " " + w).length <= max) lines[last] += " " + w;
    else lines.push(w);
  }
  return lines.map(escapeHtml).join("<br>");
}

/**
 * Pay Roll: the procedure returns one row per employee × pay component
 * (employee_name, dept_name, employee_code, pay_comp_id, pay_comp_short_desc, pay_comp_desc, earn_ded, amt).
 * Pivot it here so every pay component becomes its own column, grouped under
 * Earnings / Deductions. New pay components appear automatically.
 */
function buildPayrollTable(rows: ReportRow[]): { cols: Col[]; rows: ReportRow[] } {
  type Comp = { key: string; id: string; name: string; type: "E" | "D"; nonZero: boolean };

  const comps = new Map<string, Comp>();
  const emps = new Map<string, ReportRow>();

  for (const r of rows) {
    const id = text(r.pay_comp_id).trim();
    const type: "E" | "D" = text(r.earn_ded).trim().toUpperCase().startsWith("D") ? "D" : "E";
    const amt = Number(r.amt) || 0;

    const ck = `${type}|${id}`;
    let comp = comps.get(ck);
    if (!comp) {
      comp = {
        key: `c${comps.size}`,
        id,
        name:
          text(r.pay_comp_short_desc).trim() ||
          shortLabel(text(r.pay_comp_desc ?? r.pay_comp_name).trim()) ||
          id,
        type,
        nonZero: false,
      };
      comps.set(ck, comp);
    }
    if (amt !== 0) comp.nonZero = true;

    const ek = `${text(r.dept_name)}|${text(r.employee_code)}`;
    let emp = emps.get(ek);
    if (!emp) {
      emp = {
        employee_name: r.employee_name,
        dept_name: r.dept_name,
        employee_code: r.employee_code,
        earn_sub_total: 0,
        ded_sub_total: 0,
        grand_total: 0,
      };
      emps.set(ek, emp);
    }
    emp[comp.key] = (Number(emp[comp.key]) || 0) + amt;
    if (type === "E") emp.earn_sub_total += amt;
    else emp.ded_sub_total += amt;
  }

  const data = Array.from(emps.values());
  for (const e of data) e.grand_total = e.earn_sub_total - e.ded_sub_total;

  // BASIC, HRA first, then the rest by component id
  const rank = (id: string) => ({ BASIC: 0, HRA: 1 } as Record<string, number>)[id.toUpperCase()] ?? 2;
  const ordered = (type: "E" | "D") =>
    Array.from(comps.values())
      .filter((c) => c.type === type && c.nonZero) // all-zero components are hidden
      .sort(
        (a, b) =>
          rank(a.id) - rank(b.id) ||
          a.id.localeCompare(b.id, undefined, { numeric: true }),
      );

  const earn = ordered("E");
  const ded = ordered("D");

  const compCol = (c: Comp, band: Band): Col => ({
    key: c.key,
    label: c.name.toUpperCase(),
    kind: "amount",
    width: COMP_WIDTH,
    total: true,
    band,
  });

  const cols: Col[] = [
    { key: "employee_name", label: "EMPLOYEE NAME", kind: "text", width: NAME_WIDTH, total: false, band: "plain" },
    { key: "employee_code", label: "EMP. CODE", kind: "text", width: CODE_WIDTH, total: false, band: "plain" },
    ...earn.map((c) => compCol(c, "earn")),
    ...(earn.length
      ? [{ key: "earn_sub_total", label: "EARN TOTAL", kind: "amount", width: SUBTOTAL_WIDTH, total: true, band: "earn" } as Col]
      : []),
    ...ded.map((c) => compCol(c, "ded")),
    ...(ded.length
      ? [{ key: "ded_sub_total", label: "DED TOTAL", kind: "amount", width: SUBTOTAL_WIDTH, total: true, band: "ded" } as Col]
      : []),
    { key: "grand_total", label: "GRAND TOTAL", kind: "amount", width: TOTAL_WIDTH, total: true, band: "plain" },
  ];

  return { cols, rows: data };
}

// ─── Body Renderer ────────────────────────────────────────────────────────────

function renderSalaryRegisterBody(rows: ReportRow[], filtersHtml = "", params: any): string {
  const periodStr = `${MONTHS[params.payMonth - 1]} ${params.payYear}`;

  const heading = `
    ${FONT_LINK}
    <div class="doc-title-row">
      <div><h1>Salary Register - ${periodStr}</h1></div>
    </div>`;

  if (!rows.length) {
    return `
      ${heading}
      ${filtersHtml}
      <div class="sal-empty">No data found</div>
    `;
  }

  const { cols, rows: data } =
    params.reportMode === "PAYROLL" ? buildPayrollTable(rows) : buildFlatTable(rows);

  // ── Headers ────────────────────────────────────────────────────────────────
  const hasBands = cols.some((c) => c.band !== "plain");
  const bandLabel: Record<string, string> = { earn: "Earnings", ded: "Deductions" };

  // Component headers get an explicit line break per word so long names
  // (e.g. TRANSPORT ALLOWANCE) never overflow into the next column.
  const th = (c: Col, rowspan: boolean) => {
    const label = c.band === "plain" ? escapeHtml(c.label) : wrapLabel(c.label);
    return `<th class="${c.kind === "amount" ? "num-head" : ""}"${rowspan ? ' rowspan="2"' : ""}>${label}</th>`;
  };

  let head1 = `<th${hasBands ? ' rowspan="2"' : ""} class="num-head">SNo.</th>`;
  let head2 = "";

  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (c.band === "plain") {
      head1 += th(c, hasBands);
      continue;
    }
    if (i > 0 && cols[i - 1].band === c.band) {
      head2 += th(c, false);
      continue;
    }
    let span = 0;
    while (i + span < cols.length && cols[i + span].band === c.band) span++;
    head1 += `<th colspan="${span}" class="super-head">${bandLabel[c.band]}</th>`;
    head2 += th(c, false);
  }

  const naturalWidth = SNO_WIDTH + cols.reduce((s, c) => s + c.width, 0);

  // Column widths as % of the page, so the table always fits the page width.
  const pct = (w: number) => ((w / naturalWidth) * 100).toFixed(3);
  const colGroupHtml = `
    <colgroup>
      <col style="width: ${pct(SNO_WIDTH)}%;">
      ${cols.map((c) => `<col style="width: ${pct(c.width)}%;">`).join("")}
    </colgroup>`;

  // Many columns → shrink the text a little (down to a floor) instead of cutting.
  const fontScale = Math.max(MIN_FONT_SCALE, Math.min(1, FIT_WIDTH / naturalWidth));
  const tableStyle =
    `width: 100%; --sal-fs: ${(BODY_FONT * fontScale).toFixed(2)}px; ` +
    `--sal-hfs: ${(HEAD_FONT * fontScale).toFixed(2)}px;`;

  // ── Body ───────────────────────────────────────────────────────────────────
  const cell = (c: Col, v: unknown): string => {
    if (c.kind === "amount") return `<td class="num">${fmtAmount(Number(v) || 0)}</td>`;
    if (c.kind === "date") return `<td class="center">${escapeHtml(fmtDate(v))}</td>`;
    return `<td class="txt">${escapeHtml(v)}</td>`;
  };

  const groupedRows = new Map<string, ReportRow[]>();
  let currentSno = 1;

  data.forEach((r) => {
    const dept = r.dept_name ? String(r.dept_name).trim() : "UNKNOWN DEPARTMENT";
    if (!groupedRows.has(dept)) groupedRows.set(dept, []);
    groupedRows.get(dept)!.push(r);
  });

  let bodyRowsHtml = "";

  for (const [deptName, deptRows] of groupedRows.entries()) {
    bodyRowsHtml += `
      <tr class="dept-group-row">
        <td colspan="${cols.length + 1}">${escapeHtml(deptName)}</td>
      </tr>`;

    deptRows.forEach((r) => {
      bodyRowsHtml += `
        <tr>
          <td class="num">${currentSno++}</td>
          ${cols.map((c) => cell(c, r[c.key])).join("")}
        </tr>`;
    });
  }

  // ── Total row (by column key, not position) ────────────────────────────────
  const firstTotal = cols.findIndex((c) => c.total);
  const lead = firstTotal < 0 ? cols.length : firstTotal;

  const totalCells = cols
    .slice(lead)
    .map((c) => {
      if (!c.total) return `<td></td>`;
      const sum = data.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
      return `<td class="num">${fmtAmount(sum)}</td>`;
    })
    .join("");

  const grandTotalRow = `
        <tr class="grand-total-row">
          <td colspan="${lead + 1}" class="num">TOTAL (${data.length} Employees)</td>
          ${totalCells}
        </tr>`;

  const signaturesHtml = `
    <div class="signatures-row">
      <div class="signature-box">
        <div class="signature-line"></div>
        Prepared By
      </div>
      <div class="signature-box">
        <div class="signature-line"></div>
        Reviewed By
      </div>
      <div class="signature-box">
        <div class="signature-line"></div>
        Approved By
      </div>
    </div>
  `;

  return `
    ${heading}
    ${filtersHtml}
    <div class="table-container">
      <table class="sal-table" style="${tableStyle}">
        ${colGroupHtml}
        <thead>
          <tr>${head1}</tr>
          ${hasBands ? `<tr>${head2}</tr>` : ""}
        </thead>
        <tbody>
          ${bodyRowsHtml}
          ${grandTotalRow}
        </tbody>
      </table>
    </div>
    ${signaturesHtml}
  `;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export const getSalaryRegisterHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadSalaryRegisterData(req);

    const headerHtml = await reportHeader({ company_code: params.companyCode, req });
    const filtersHtml = reportAppliedFilters([
      { label: "Division", value: [params.divCode] },
      { label: "Department", value: [params.deptCode] },
      { label: "Section", value: [params.sectCode] },
      { label: "Employee", value: [params.employeeCode] },
      { label: "Pay Period", value: [`${MONTHS[params.payMonth - 1]} ${params.payYear}`] },
      { label: "Earn / Ded", value: [params.earnDed] },
      { label: "History", value: [params.historyReport === "Y" ? "Yes" : "No"] },
      {
        label: "Report Type",
        value: [REPORT_MODE_LABELS[params.reportMode] || params.reportMode],
      },
    ]);
    const bodyHtml = renderSalaryRegisterBody(rows, filtersHtml, params);
    const footerHtml = reportFooter({
      reportName: "rpt_salary_register",
      userName: params.loginId,
      endLabel: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: `Salary Register - ${MONTHS[params.payMonth - 1]} ${params.payYear}`,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: SALARY_EXTRA_CSS,
      autoPrint: req.query.print !== "false",
      showPrintButton: true,
      orientation: "landscape",
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Salary Register HTML error:", error);

    const oraNum = error?.errorNum;
    const oraCode = oraNum ? `ORA-${String(oraNum).padStart(5, "0")}` : undefined;

    res.status(error.status || 500).json({
      success: false,
      code: oraCode,
      message: error.message || "Unable to generate report",
    });
  }
};