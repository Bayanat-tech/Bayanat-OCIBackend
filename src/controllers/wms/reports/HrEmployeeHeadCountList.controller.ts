// src/controllers/wms/reports/EmployeeHeadCountReport.controller.ts

import { Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import {
  reportHeader,
  reportFooter,
  buildReportDocument,
  reportAppliedFilters,
} from "../../common/report_common";
const AdmZip = require("adm-zip");

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

// ─── Report-mode → procedure parameter mapping ───────────────────────────────

const REPORT_MODE_TO_PARAMETER: Record<string, string> = {
  DIVISION_WISE:           "Hr_Report_HEAD_COUNT_DIVISION",
  DEPARTMENT_WISE:         "Hr_Report_HEAD_COUNT_DEPARTMENT",
  NATIONALITY_WISE:        "Hr_Report_HEAD_COUNT_NATIONALITY",
  LOCAL_EXPAT:             "Hr_Report_HEAD_COUNT_LOCAL_EXPAT",
  MONTHLY_JOINERS:         "Hr_Report_HEAD_COUNT_MONTHLY_JOINERS",
  MONTHLY_LEAVERS:         "Hr_Report_HEAD_COUNT_MONTHLY_LEAVERS",
  MONTHLY_JOINERS_OPENING: "Hr_Report_HEAD_COUNT_MONTHLY_JOINERS_OPENING",
  BUDGETED_VARIANCE:       "Hr_Report_HEAD_COUNT_BUDGETED_VARIANCE",
  MANPOWER_DEPT:           "Hr_Report_HEAD_COUNT_MANPOWER_DEPT",
};

const REPORT_MODE_LABEL: Record<string, string> = {
  DIVISION_WISE:           "Division wise Head count summary",
  DEPARTMENT_WISE:         "Department wise Head count summary",
  NATIONALITY_WISE:        "Nationality wise Head count summary",
  LOCAL_EXPAT:             "Local/Expat Head count summary",
  MONTHLY_JOINERS:         "Organization Head Count Month-wise Joiners",
  MONTHLY_LEAVERS:         "Organization Head Count Month-wise Leavers",
  MONTHLY_JOINERS_OPENING: "Organization Head Count Month-wise Joiners with opening Balance",
  BUDGETED_VARIANCE:       "Budgeted Plan Variance",
  MANPOWER_DEPT:           "ManPower Department wise",
};

// ─── DB Helpers ───────────────────────────────────────────────────────────────

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid)
    tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenantId)
    throw Object.assign(new Error("Unable to determine tenant database"), {
      status: 400,
    });
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

function escapeXml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(value: unknown): string {
  if (!value) return "";
  const d = new Date(value as any);
  if (Number.isNaN(d.getTime())) return text(value).slice(0, 10);
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dd}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

function parseDate(value: unknown): Date | null {
  const v = text(value).trim();
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date -> 'YYYY-MM-DD' string (the format PROC_BUILD_DYNAMIC_SQL_HR_REPORT expects). */
function toYmd(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function num(value: unknown, digits = 0): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(digits);
}

// ─── Request Param Parser ────────────────────────────────────────────────────

function parseParams(req: RequestWithUser) {
  const body = req.body || {};
  const pick = (v: unknown) => (v == null ? "" : String(v).trim());
  const src = { ...(req.query as Record<string, any>), ...body };

  const companyCode =
    text(req.user?.company_code || pick(body.company_code) || pick(req.query.company_code) || "").trim() ||
    "All";

  const rawMode = text(src.report_mode).trim().toUpperCase();
  const reportMode = REPORT_MODE_TO_PARAMETER[rawMode] ? rawMode : "DIVISION_WISE";

  return {
    companyCode,
    reportMode,
    reportModeLabel: REPORT_MODE_LABEL[reportMode] ?? reportMode,
    fromDate: parseDate(src.from_date),
    toDate: parseDate(src.to_date),
    loginId: text(req.user?.loginid || (req.user as any)?.username),
  };
}

/** Company code for the letterhead lookup — independent of the (possibly "All") query filter. */
function resolveHeaderCompanyCode(req: RequestWithUser, companyCode: string): string {
  if (companyCode && companyCode.toUpperCase() !== "ALL") return companyCode;
  return text(req.user?.company_code) || text(req.query.company_code) || "BSG";
}

// ─── Data Loader ─────────────────────────────────────────────────────────────

async function loadData(req: RequestWithUser): Promise<{ params: ReturnType<typeof parseParams>; rows: ReportRow[] }> {
  const params = parseParams(req);

  if (!params.companyCode || params.companyCode.toUpperCase() === "ALL") {
    params.companyCode = resolveHeaderCompanyCode(req, params.companyCode);
  }
  if (!params.fromDate || !params.toDate) {
    throw Object.assign(new Error("from_date and to_date are required"), { status: 400 });
  }
  if (params.fromDate > params.toDate) {
    throw Object.assign(new Error("'From Date' cannot be greater than 'To Date'"), { status: 400 });
  }

  const parameter = REPORT_MODE_TO_PARAMETER[params.reportMode];
  if (!parameter) {
    throw Object.assign(new Error(`Unknown report_mode: ${params.reportMode}`), { status: 400 });
  }

  const conn = await getConn(req);
  try {
    const binds: Record<string, any> = {
      p_parameter: parameter,
      p_loginid: params.loginId,
      p_code1: params.companyCode,
      p_number1: 0,
      p_number2: 0,
      p_number3: 0,
      p_number4: 0,
      // Procedure declares P_DATE1..4 as VARCHAR2 ('YYYY-MM-DD') — bind strings, NOT oracledb.DATE.
      p_date1: toYmd(params.fromDate),
      p_date2: toYmd(params.toDate),
      p_date3: null,
      p_date4: null,
      p_return_string: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    for (let i = 2; i <= 20; i++) binds[`p_code${i}`] = null;
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
      throw Object.assign(new Error("No query returned"), { status: 500 });
    }

    console.log("SQL:--------------->HeadCount", builtSql);

    const result = await conn.execute(builtSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    return { params, rows: normalize(result.rows as any[]) };
  } finally {
    await closeConn(conn);
  }
}

// ─── Layout CSS — same visual system as Category Master ─────────────────────

const HEAD_COUNT_EXTRA_CSS = `
  .doc-title-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin: 0 !important;
    padding: 0 !important;
  }

  .doc-title-row h1 {
    margin: 0 0 2px 0 !important;
    padding: 0;
    font-size: 18px;
    font-weight: 800;
    color: #0b4ca1;
    line-height: 1.2;
  }

  .doc-title-row .doc-sub {
    margin: 0 !important;
    padding: 0 !important;
    font-size: 11px;
    color: #64748b;
    line-height: 1.3;
  }

  table.data-table {
    border-collapse: collapse;
    width: 100%;
    font-size: 10.5px;
    margin-top: 6px !important;
  }

  table.data-table th {
    background: #e8f0fa !important;
    color: #0b4ca1 !important;
    font-size: 11px;
    padding: 7px 6px;
    text-align: left;
    font-weight: 700;
    border-bottom: 2px solid #0b4ca1 !important;
  }

  table.data-table th.num-head { text-align: right; }

  table.data-table td {
    padding: 5px 6px;
    vertical-align: middle;
    border-bottom: 1px solid #e2e8f0 !important;
    color: #334155;
  }

  table.data-table td.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  table.data-table tbody tr:nth-child(even) td { 
    background: #f8fafc !important; 
  }

  /* Grand total row */
  table.data-table tbody tr.grand-total-row td {
    background: #e2e8f0 !important;
    color: #0b4ca1 !important;
    font-weight: 800;
    text-align: right;
    border-bottom: 1px solid #cbd5e1 !important;
  }

  @media print {
    table.data-table thead { display: table-header-group; }
    table.data-table thead th {
      background: #e8f0fa !important;
      color: #0b4ca1 !important;
      border-bottom: 2px solid #0b4ca1 !important;
    }
  }
`;

function printMetaHtml(title: string, subtitle: string): string {
  return `
    <div class="doc-title-row">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="doc-sub">${escapeHtml(subtitle)}</div>
      </div>
    </div>`;
}

// ─── Column definitions per report mode ─────────────────────────────────────

type ColDef = { key: string; label: string; num?: boolean; width?: string; pct?: boolean };

const MODE_COLUMNS: Record<string, ColDef[]> = {
  DIVISION_WISE: [
    { key: "__sno__", label: "SNo.", num: true, width: "6%" },
    { key: "div_name", label: "Division" },
    { key: "head_count", label: "Head Count", num: true, width: "20%" },
  ],
  DEPARTMENT_WISE: [
    { key: "__sno__", label: "SNo.", num: true, width: "6%" },
    { key: "div_name", label: "Division" },
    { key: "dept_name", label: "Department" },
    { key: "head_count", label: "Head Count", num: true, width: "20%" },
  ],
  LOCAL_EXPAT: [
    { key: "__sno__", label: "SNo.", num: true, width: "4%" },
    { key: "company_code", label: "Company" },
    { key: "div_name", label: "Division" },
    { key: "dept_name", label: "Department" },
    { key: "omani_male", label: "Omani M", num: true },
    { key: "omani_female", label: "Omani F", num: true },
    { key: "omani_other", label: "Omani O", num: true },
    { key: "expat_male", label: "Expat M", num: true },
    { key: "expat_female", label: "Expat F", num: true },
    { key: "expat_other", label: "Expat O", num: true },
    { key: "emp_count", label: "Total", num: true },
    { key: "omani_perc", label: "Omani %", num: true, pct: true },
  ],
  BUDGETED_VARIANCE: [
    { key: "__sno__", label: "SNo.", num: true, width: "4%" },
    { key: "bud_month", label: "Month", num: true },
    { key: "dept_code", label: "Dept" },
    { key: "dept_name", label: "Dept Name" },
    { key: "desg_code", label: "Desg" },
    { key: "budgeted", label: "Budgeted (YTD)", num: true },
    { key: "cur_month_budgt", label: "Current Month", num: true },
    { key: "joiners", label: "Joiners", num: true },
    { key: "leavers", label: "Leavers", num: true },
    { key: "actuals", label: "Actuals", num: true },
    { key: "prev_month_actuals", label: "Prev Month", num: true },
  ],
  MANPOWER_DEPT: [
    { key: "__sno__", label: "SNo.", num: true, width: "4%" },
    { key: "company_code", label: "Company" },
    { key: "div_code", label: "Division" },
    { key: "dept_code", label: "Department" },
    { key: "section_code", label: "Section" },
    { key: "prev_year_cnt", label: "Prev Year", num: true },
    { key: "join_addn_cnt", label: "Joins", num: true },
    { key: "transfer_addn_cnt", label: "Transfers", num: true },
    { key: "promotion_addn_cnt", label: "Promotions", num: true },
    { key: "leave_addn_cnt", label: "Leave", num: true },
    { key: "transfer_redn_cnt", label: "Transfers −", num: true },
    { key: "promotion_redn_cnt", label: "Promotions −", num: true },
  ],
};

/** Modes without a fixed column set render generically (NATIONALITY_WISE / MONTHLY_*). */
function getColumns(mode: string, rows: ReportRow[]): ColDef[] {
  if (MODE_COLUMNS[mode]) return MODE_COLUMNS[mode];
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]);
  return [
    { key: "__sno__", label: "SNo.", num: true, width: "4%" },
    ...cols.map((c) => ({ key: c, label: c.replace(/_/g, " ").toUpperCase() })),
  ];
}

/** Modes where the grand total is a count-only label row. */
const COUNT_ONLY_GRAND_TOTAL = new Set([
  "LOCAL_EXPAT",
  "BUDGETED_VARIANCE",
  "MANPOWER_DEPT",
  "NATIONALITY_WISE",
  "MONTHLY_JOINERS",
  "MONTHLY_LEAVERS",
  "MONTHLY_JOINERS_OPENING",
]);

// ─── Body Renderer ──────────────────────────────────────────────────────────

function renderBody(mode: string, rows: ReportRow[], filtersHtml: string, modeLabel: string): string {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const subtitle = `${modeLabel}  |  Printed ${printDateTime}`;

  if (!rows.length) {
    return `
      ${printMetaHtml("HR Employee Head Count List", subtitle)}
      ${filtersHtml}
      <div class="empty">No data found for the selected filters.</div>`;
  }

  const cols = getColumns(mode, rows);
  const headRow = cols
    .map(
      (c) =>
        `<th${c.num ? ` class="num-head"` : ""}${c.width ? ` style="width:${c.width}"` : ""}>${escapeHtml(c.label)}</th>`,
    )
    .join("");

  const bodyRows = rows
    .map((r, i) => {
      const cells = cols
        .map((c) => {
          if (c.key === "__sno__") return `<td class="num">${i + 1}</td>`;
          const raw = r[c.key];
          if (c.pct) return `<td class="num">${escapeHtml(num(raw, 2))}%</td>`;
          return `<td${c.num ? ` class="num"` : ""}>${escapeHtml(raw)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  // Grand total row
  let grandTotalRow: string;
  if (COUNT_ONLY_GRAND_TOTAL.has(mode)) {
    grandTotalRow = `
        <tr class="grand-total-row">
          <td colspan="${cols.length}">GRAND TOTAL (${rows.length} Records):</td>
        </tr>`;
  } else {
    const totalHeadCount = rows.reduce((s, r) => s + Number(r.head_count || 0), 0);
    grandTotalRow = `
        <tr class="grand-total-row">
          <td colspan="${cols.length - 1}">GRAND TOTAL (${rows.length} Records):</td>
          <td class="num">${totalHeadCount}</td>
        </tr>`;
  }

  return `
    ${printMetaHtml("HR Employee Head Count List", subtitle)}
    ${filtersHtml}

    <table class="data-table" style="margin-top: 3px !important;">
      <thead><tr>${headRow}</tr></thead>
      <tbody>${bodyRows}${grandTotalRow}</tbody>
    </table>
  `;
}

// ─── Generic OOXML Excel builder engine ─────────────────────────────────────

interface XlCell { v: unknown; styleKey: string }
type XlRow = (XlCell | null)[];
interface XlMerge { s: { r: number; c: number }; e: { r: number; c: number } }

const XL_BLUE = "FF1D4ED8";
const XL_WHITE = "FFFFFFFF";

function xlCell(v: unknown, styleKey: string): XlCell {
  return { v, styleKey };
}

function defaultXlStyleDefs(): Record<string, any> {
  const borderThin = (color: string) => ({ style: "thin", color: { rgb: color } });
  return {
    title: {
      font: { bold: true, sz: 16, color: { rgb: XL_WHITE } },
      fill: { fgColor: { rgb: XL_BLUE } },
      alignment: { horizontal: "center", vertical: "center" },
    },
    meta: { font: { sz: 9, color: { rgb: "FF333333" } } },
    header: {
      font: { bold: true, sz: 10, color: { rgb: XL_WHITE } },
      fill: { fgColor: { rgb: XL_BLUE } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: {
        top: borderThin(XL_BLUE),
        bottom: borderThin(XL_BLUE),
        left: borderThin(XL_BLUE),
        right: borderThin(XL_BLUE),
      },
    },
    data: {
      font: { sz: 10 },
      alignment: { vertical: "center" },
      border: { bottom: borderThin("FFF3F4F6") },
    },
    dataCenter: {
      font: { sz: 10 },
      alignment: { horizontal: "center", vertical: "center" },
      border: { bottom: borderThin("FFF3F4F6") },
    },
    grandTotal: {
      font: { bold: true, sz: 12, color: { rgb: XL_WHITE } },
      fill: { fgColor: { rgb: XL_BLUE } },
      alignment: { horizontal: "left", vertical: "center" },
    },
    footer: {
      font: { italic: true, sz: 8, color: { rgb: "FF64748B" } },
      alignment: { horizontal: "right" },
    },
  };
}

function buildXlsxBuffer(
  sheetName: string,
  colCount: number,
  colWidth: number,
  rows_: XlRow[],
  merges: XlMerge[],
  styleDefs: Record<string, any>,
): Buffer {
  interface FontDef { bold?: boolean; italic?: boolean; sz?: number; color?: string }
  interface FillDef { color?: string }
  interface BorderDef { top?: string; bottom?: string; left?: string; right?: string }
  interface XfDef { fontId: number; fillId: number; borderId: number; numFmtId: number; align?: string; wrap?: boolean }

  const fonts: FontDef[] = [{}];
  const fills: FillDef[] = [{}, {}];
  const borders: BorderDef[] = [{}];
  const numFmts: Array<{ id: number; code: string }> = [];
  const cellXfs: XfDef[] = [{ fontId: 0, fillId: 0, borderId: 0, numFmtId: 0 }];
  const sigCache = new Map<string, number>();
  let nextCustomNumFmtId = 164;

  const registerFont = (f: any): number => {
    const def: FontDef = { bold: !!f?.bold, italic: !!f?.italic, sz: f?.sz ?? 10, color: f?.color?.rgb };
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

  const colXml = Array.from({ length: colCount }, (_, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${colWidth}" customWidth="1"/>`,
  ).join("");

  let sheetDataXml = "";
  rows_.forEach((row, ri) => {
    const rn = ri + 1;
    let rowXml = `<row r="${rn}">`;
    row.forEach((c, ci) => {
      if (c === null) return;
      const ref = String.fromCharCode(65 + ci) + rn;
      const s = styleIndexFor(c.styleKey);
      if (typeof c.v === "number") {
        rowXml += `<c r="${ref}" s="${s}"><v>${c.v}</v></c>`;
      } else {
        rowXml += `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${escapeXml(c.v ?? "")}</t></is></c>`;
      }
    });
    rowXml += "</row>";
    sheetDataXml += rowXml;
  });

  const mergesXml = merges
    .map(
      (m) =>
        `<mergeCell ref="${String.fromCharCode(65 + m.s.c)}${m.s.r + 1}:${String.fromCharCode(65 + m.e.c)}${m.e.r + 1}"/>`,
    )
    .join("");
  const mergeFinal = merges.length ? `<mergeCells count="${merges.length}">${mergesXml}</mergeCells>` : "";

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
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
    </font>`,
    )
    .join("")}
</fonts>`;

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
    </fill>`,
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
    </border>`,
    )
    .join("")}
</borders>`;

  const cellXfsXml = `<cellXfs count="${cellXfs.length}">${cellXfs
    .map((xf) => {
      const applyAlign = xf.align || xf.wrap;
      return `
    <xf numFmtId="${xf.numFmtId}" fontId="${xf.fontId}" fillId="${xf.fillId}" borderId="${xf.borderId}"
        applyFont="1" applyFill="${xf.fillId ? 1 : 0}" applyBorder="${xf.borderId ? 1 : 0}"
        applyNumberFormat="${xf.numFmtId ? 1 : 0}" applyAlignment="${applyAlign ? 1 : 0}">
        ${applyAlign ? `<alignment${xf.align ? ` horizontal="${xf.align}"` : ""}${xf.wrap ? ` wrapText="1"` : ""} vertical="center"/>` : ""}
    </xf>`;
    })
    .join("")}
</cellXfs>`;

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
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
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

// ─── Excel builder: HR Employee Head Count (per-mode columns) ───────────────

function buildExcelBuffer(mode: string, modeLabel: string, rows: ReportRow[], fromDate: Date | null, toDate: Date | null): Buffer {
  const printDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const cols = getColumns(mode, rows);
  const COL_COUNT = Math.max(cols.length, 1);

  const rows_: XlRow[] = [];
  const merges: XlMerge[] = [];

  rows_.push([xlCell("HR EMPLOYEE HEAD COUNT LIST", "title"), ...new Array(COL_COUNT - 1).fill(null)]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  const metaRange = toDate ? `${fmtDate(fromDate)} to ${fmtDate(toDate)}` : "-";
  rows_.push([
    xlCell(`Mode: ${modeLabel}`, "meta"),
    null,
    null,
    ...new Array(Math.max(COL_COUNT - 4, 0)).fill(null),
    xlCell(`Date: ${printDate}`, "meta"),
  ]);
  if (COL_COUNT > 4) merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 3 } });

  rows_.push(new Array(COL_COUNT).fill(null));

  rows_.push(cols.map((c) => xlCell(c.label, "header")));

  rows.forEach((r, i) => {
    const cells: XlCell[] = cols.map((c) => {
      if (c.key === "__sno__") return xlCell(i + 1, "dataCenter");
      if (c.pct) return xlCell(`${num(r[c.key], 2)}%`, "dataCenter");
      const raw = r[c.key];
      if (raw == null) return xlCell("", c.num ? "dataCenter" : "data");
      if (typeof raw === "number") return xlCell(raw, c.num ? "dataCenter" : "data");
      return xlCell(text(raw), c.num ? "dataCenter" : "data");
    });
    rows_.push(cells);
  });

  rows_.push(new Array(COL_COUNT).fill(null));

  const totalRow = rows_.length;
  if (COUNT_ONLY_GRAND_TOTAL.has(mode)) {
    rows_.push([xlCell(`GRAND TOTAL (${rows.length} Records):`, "grandTotal"), ...new Array(COL_COUNT - 1).fill(null)]);
    merges.push({ s: { r: totalRow, c: 0 }, e: { r: totalRow, c: COL_COUNT - 1 } });
  } else {
    const totalHeadCount = rows.reduce((s, r) => s + Number(r.head_count || 0), 0);
    rows_.push([
      xlCell(`GRAND TOTAL (${rows.length} Records):`, "grandTotal"),
      ...new Array(Math.max(COL_COUNT - 2, 0)).fill(null),
      xlCell(totalHeadCount, "grandTotal"),
    ]);
    if (COL_COUNT > 1) merges.push({ s: { r: totalRow, c: 0 }, e: { r: totalRow, c: COL_COUNT - 2 } });
  }

  rows_.push([...new Array(COL_COUNT - 1).fill(null), xlCell("Powered by Bayanat Technology", "footer")]);

  const sheetName = `HeadCount_${mode}`.slice(0, 31);
  return buildXlsxBuffer(sheetName, COL_COUNT, 22, rows_, merges, defaultXlStyleDefs());
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

export const getEmployeeHeadCountReportHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const { params, rows } = await loadData(req);

    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected filters." });
      return;
    }

    const companyCode = resolveHeaderCompanyCode(req, params.companyCode);
    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: "rpt_employee_head_count",
      endLabel: "Powered by Bayanat Technology",
    });

    const filtersHtml = reportAppliedFilters(
      [
        { label: "Report Mode", value: params.reportModeLabel },
        { label: "From Date", value: params.fromDate ? fmtDate(params.fromDate) : "-" },
        { label: "To Date", value: params.toDate ? fmtDate(params.toDate) : "-" },
      ],
      { includeAll: false },
    );

    const bodyHtml = renderBody(params.reportMode, rows, filtersHtml, params.reportModeLabel);

    const html = buildReportDocument({
      title: "HR Employee Head Count List",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: HEAD_COUNT_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
      orientation: "landscape",
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Employee Head Count Report HTML error:", error);

    const oraNum = error?.errorNum;
    const oraCode = oraNum ? `ORA-${String(oraNum).padStart(5, "0")}` : undefined;

    res.status(error.status || 500).json({
      success: false,
      code: oraCode,
      message: error.message || "Unable to generate report",
    });
  }
};

export const exportEmployeeHeadCountReportExcel = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const { params, rows } = await loadData(req);

    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected filters." });
      return;
    }

    const buffer = buildExcelBuffer(
      params.reportMode,
      params.reportModeLabel,
      rows,
      params.fromDate,
      params.toDate,
    );
    const modeSlug = params.reportMode.toLowerCase();
    const filename = `head_count_${modeSlug}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("Employee Head Count Report Excel error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to export report",
    });
  }
};