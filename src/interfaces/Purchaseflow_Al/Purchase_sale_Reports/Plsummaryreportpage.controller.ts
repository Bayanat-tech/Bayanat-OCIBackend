import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { buildReportDocument, reportFooter, reportHeader } from "../../../controllers/common/report_common";

// This is the backend counterpart of PLSummaryPage.tsx (frontend).

// ─── Types ────────────────────────────────────────────────────────────────

type ReportMode = "invoicewise" | "customerwise" | "salesmanwise" | "customergroupwise" | "groupcustomerwise";

type ReportRow = Record<string, any>;

interface ReqParams {
  loginid:      string;
  company_code: string;
  fromdate:     string; // "All" or "YYYY-MM-DD"
  todate:       string;
  docno:        string; // "0" = all
  salesman:     string; // "All" or code
  group:        string; // "All" or "G1,G2"
  brand:        string;
  prodcategory: string;
  prodtype:     string;
  manu:         string;
  cust:         string;
  mode:         ReportMode;
}

// ─── DB helpers (same pattern as your other controllers) ──────────────────

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

// ─── Formatting helpers ─────────────────────────────────────────────────────

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function dateText(value: unknown): string {
  if (!value) return "\u2014";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value).substring(0, 10);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function escapeHtml(value: unknown): string {
  return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeXml(value: unknown): string {
  return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function numFmt(value: unknown, decimals = 2): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function toOracleDate(iso: string): Date | null {
  if (!iso || iso.toUpperCase() === "ALL") return null;
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─── Param extraction ───────────────────────────────────────────────────────

function extractParams(req: RequestWithUser): ReqParams {
  const b = req.body || {};
  return {
    loginid:      text(req.user?.loginid) || text(b.loginid) || "ADMIN",
    company_code: text(b.company_code),
    fromdate:     text(b.fromdate) || "All",
    todate:       text(b.todate) || "All",
    docno:        text(b.docno) || "0",
    salesman:     text(b.salesman) || "All",
    group:        text(b.group) || "All",
    brand:        text(b.brand) || "All",
    prodcategory: text(b.prodcategory) || "All",
    prodtype:     text(b.prodtype) || "All",
    manu:         text(b.manu) || "All",
    cust:         text(b.cust) || "All",
    mode:         (b.mode as ReportMode) || "invoicewise",
  };
}

// Builds an "IN (:b0, :b1, ...)" clause for a comma-separated code list, or
// "1=1" when the filter is "All" / empty — mirrors the `'All' in (:as_x)`
// pattern in your original queries, but expanded to real bind variables
// since oracledb doesn't bind a JS array directly into an IN list.
function buildInClause(column: string, csv: string, bindPrefix: string, binds: Record<string, any>): string {
  const v = (csv || "").trim();
  if (!v || v.toUpperCase() === "ALL") return "1=1";
  const codes = v.split(",").map((c) => c.trim()).filter(Boolean);
  if (codes.length === 0) return "1=1";
  const placeholders = codes.map((code, i) => {
    const key = `${bindPrefix}${i}`;
    binds[key] = code;
    return `:${key}`;
  });
  return `${column} IN (${placeholders.join(", ")})`;
}

// ─── Data loader ────────────────────────────────────────────────────────────

async function loadPLSummaryData(req: RequestWithUser, p: ReqParams): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const binds: Record<string, any> = {
      fromDate: toOracleDate(p.fromdate) ?? new Date("1900-01-01"),
      toDate:   toOracleDate(p.todate)   ?? new Date("2999-12-31"),
    };

    const groupClause    = buildInClause("GROUP_CODE",    p.group,        "grp", binds);
    const brandClause    = buildInClause("BRAND_CODE",    p.brand,        "brd", binds);
    const categoryClause = buildInClause("CATEGORY_CODE", p.prodcategory, "cat", binds);
    const typeClause     = buildInClause("PRODTYPE_CODE", p.prodtype,     "typ", binds);
    const manuClause     = buildInClause("MANU_CODE",     p.manu,         "man", binds);
    const custClause     = buildInClause("AC_CODE",       p.cust,         "cus", binds);

    // Only bind :docNo when the SQL text actually references it
    // (otherwise oracledb throws ORA-01036).
    const docNo = parseInt(p.docno, 10) || 0;
    let docClause = "1=1";
    if (docNo !== 0) {
      binds.docNo = docNo;
      docClause = "DOC_NO = :docNo";
    }

    const salesman = (p.salesman || "All").trim();
    let salesmanClause = "1=1";
    if (salesman && salesman.toUpperCase() !== "ALL") {
      binds.salesmanCode = salesman;
      salesmanClause = "SALESMAN_CODE = :salesmanCode";
    }

    const whereCommon = `
      DOC_DATE >= :fromDate AND DOC_DATE < :toDate
      AND ${docClause}
      AND ${salesmanClause}
      AND ${groupClause}
      AND ${brandClause}
      AND ${categoryClause}
      AND ${typeClause}
      AND ${manuClause}
      AND ${custClause}
    `;

    let sql = "";
    switch (p.mode) {
      case "invoicewise":
        sql = `
          SELECT SUM(sales_value) sales_value, SUM(cost_value) cost_value, SUM(profit) profit,
                 inv_no, doc_date, quantity, AC_CODE, AC_NAME
          FROM vw_erp_planalysis
          WHERE ${whereCommon}
          GROUP BY inv_no, doc_date, quantity, AC_CODE, AC_NAME
          ORDER BY doc_date`;
        break;
      case "customerwise":
        sql = `
          SELECT SUM(sales_value) sales_value, SUM(cost_value) cost_value, SUM(profit) profit,
                 AC_CODE, AC_NAME
          FROM vw_erp_planalysis
          WHERE ${whereCommon}
          GROUP BY AC_CODE, AC_NAME
          ORDER BY AC_NAME`;
        break;
      case "salesmanwise":
        sql = `
          SELECT SUM(sales_value) sales_value, SUM(cost_value) cost_value, SUM(profit) profit,
                 SALESMAN_CODE, salesman_name
          FROM vw_erp_planalysis
          WHERE ${whereCommon}
          GROUP BY SALESMAN_CODE, salesman_name
          ORDER BY salesman_name`;
        break;
      // Both "Customer-Group wise" and "Group-Customer wise" run the same
      // underlying query — they only differ in which level is the primary
      // section when rows are grouped below.
      case "customergroupwise":
      case "groupcustomerwise":
        sql = `
          SELECT SUM(sales_value) sales_value, SUM(cost_value) cost_value, SUM(profit) profit,
                 AC_CODE, AC_NAME, group_code, group_name
          FROM vw_erp_planalysis
          WHERE ${whereCommon}
          GROUP BY AC_CODE, AC_NAME, group_code, group_name
          ORDER BY AC_NAME, group_name`;
        break;
    }

    const result = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Generic report-line model (shared by HTML + Excel renderers) ─────────
//
// "section"    -> top-level heading row (customer / salesman / group)
// "data"       -> a real data row with numeric columns
// "subtotal"   -> total for the current section
// "grandtotal" -> overall total

interface ReportLine {
  kind: "section" | "subsection" | "data" | "subtotal" | "grandtotal";
  label?: string;
  cells?: (string | number)[]; // aligned to `columns` below
}

interface ColumnDef {
  label: string;
  align: "left" | "right" | "center";
  width: number; // percentage of table width (all columns in a mode add up to 100)
}

function getColumnsForMode(mode: ReportMode): ColumnDef[] {
  switch (mode) {
    case "invoicewise":
      return [
        { label: "Inv No",       align: "left",   width: 17 },
        { label: "Date",         align: "center", width: 10 },
        { label: "Qty",          align: "right",  width: 8  },
        { label: "Customer",     align: "left",   width: 29 },
        { label: "Sales Value",  align: "right",  width: 12 },
        { label: "Cost Value",   align: "right",  width: 12 },
        { label: "Profit",       align: "right",  width: 12 },
      ];
    case "salesmanwise":
      return [
        { label: "Salesman Code", align: "left",  width: 18 },
        { label: "Salesman Name", align: "left",  width: 34 },
        { label: "Sales Value",   align: "right", width: 16 },
        { label: "Cost Value",    align: "right", width: 16 },
        { label: "Profit",        align: "right", width: 16 },
      ];
    case "customerwise":
    case "customergroupwise":
    case "groupcustomerwise":
    default:
      return [
        { label: "Code",        align: "left",  width: 18 },
        { label: "Name",        align: "left",  width: 34 },
        { label: "Sales Value", align: "right", width: 16 },
        { label: "Cost Value",  align: "right", width: 16 },
        { label: "Profit",      align: "right", width: 16 },
      ];
  }
}

function num(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function buildReportLines(mode: ReportMode, rows: ReportRow[]): { lines: ReportLine[]; columns: ColumnDef[] } {
  const columns = getColumnsForMode(mode);
  const lines: ReportLine[] = [];
  let grandSales = 0, grandCost = 0, grandProfit = 0;

  // The last 3 columns are always Sales / Cost / Profit, so a totals line only
  // needs its label + those 3 values (label spans everything before them).
  const addTotalsLine = (kind: ReportLine["kind"], label: string, sales: number, cost: number, profit: number) => {
    lines.push({ kind, label, cells: [numFmt(sales), numFmt(cost), numFmt(profit)] });
  };

  if (mode === "invoicewise") {
    for (const r of rows) {
      const sales = num(r.sales_value), cost = num(r.cost_value), profit = num(r.profit);
      grandSales += sales; grandCost += cost; grandProfit += profit;
      lines.push({
        kind: "data",
        cells: [
          text(r.inv_no) || "\u2014",
          dateText(r.doc_date),
          numFmt(r.quantity, 2),
          `${text(r.ac_code)} | ${text(r.ac_name)}`,
          numFmt(sales), numFmt(cost), numFmt(profit),
        ],
      });
    }
  } else if (mode === "customerwise") {
    for (const r of rows) {
      const sales = num(r.sales_value), cost = num(r.cost_value), profit = num(r.profit);
      grandSales += sales; grandCost += cost; grandProfit += profit;
      lines.push({ kind: "data", cells: [text(r.ac_code), text(r.ac_name), numFmt(sales), numFmt(cost), numFmt(profit)] });
    }
  } else if (mode === "salesmanwise") {
    for (const r of rows) {
      const sales = num(r.sales_value), cost = num(r.cost_value), profit = num(r.profit);
      grandSales += sales; grandCost += cost; grandProfit += profit;
      lines.push({ kind: "data", cells: [text(r.salesman_code), text(r.salesman_name), numFmt(sales), numFmt(cost), numFmt(profit)] });
    }
  } else {
    // customergroupwise (customer primary, group secondary) or
    // groupcustomerwise (group primary, customer secondary)
    const groupByCustomerFirst = mode === "customergroupwise";
    const primaryKey    = (r: ReportRow) => (groupByCustomerFirst ? text(r.ac_code)    : text(r.group_code));
    const primaryName   = (r: ReportRow) => (groupByCustomerFirst ? text(r.ac_name)    : text(r.group_name));
    const secondaryCode = (r: ReportRow) => (groupByCustomerFirst ? text(r.group_code) : text(r.ac_code));
    const secondaryName = (r: ReportRow) => (groupByCustomerFirst ? text(r.group_name) : text(r.ac_name));

    const byPrimary = new Map<string, { name: string; rows: ReportRow[] }>();
    for (const r of rows) {
      const key = primaryKey(r) || "\u2014";
      if (!byPrimary.has(key)) byPrimary.set(key, { name: primaryName(r), rows: [] });
      byPrimary.get(key)!.rows.push(r);
    }

    for (const [key, group] of byPrimary) {
      lines.push({ kind: "section", label: `${key} | ${group.name}` });
      let subSales = 0, subCost = 0, subProfit = 0;
      for (const r of group.rows) {
        const sales = num(r.sales_value), cost = num(r.cost_value), profit = num(r.profit);
        subSales += sales; subCost += cost; subProfit += profit;
        lines.push({ kind: "data", cells: [secondaryCode(r), secondaryName(r), numFmt(sales), numFmt(cost), numFmt(profit)] });
      }
      addTotalsLine("subtotal", `Total For ${key} | ${group.name}`, subSales, subCost, subProfit);
      grandSales += subSales; grandCost += subCost; grandProfit += subProfit;
    }
  }

  addTotalsLine("grandtotal", "Grand Total", grandSales, grandCost, grandProfit);
  return { lines, columns };
}

// ─── HTML renderer (built entirely on the shared report shell) ────────────

const MODE_TITLES: Record<ReportMode, string> = {
  invoicewise: "P&L Summary Report - Invoice wise",
  customerwise: "P&L Summary Report - Customer wise",
  salesmanwise: "P&L Summary Report - Salesman wise",
  customergroupwise: "P&L Summary Report - Customer-Group wise",
  groupcustomerwise: "P&L Summary Report - Group-Customer wise",
};

// Layout-level rules for this report on top of COMMON_REPORT_CSS.
//
// ALIGNMENT FIX: the shared CSS centres <th> by default while numeric <td>
// are right-aligned, so headers never sat over their values. Here we
//   1. use a fixed table layout with <colgroup> widths so every row
//      (data / section / subtotal / grand total) shares the same columns,
//   2. force the SAME text-align on <th> and <td> for each column
//      (left / center / right) with !important so the shared CSS can't win,
//   3. use one horizontal padding value for every row type so numbers in the
//      total rows end at exactly the same x-position as the data rows.
const PL_EXTRA_CSS = `
  /* This report reads better in landscape given the column count */
  .pl-title { font-size: 13px; font-weight: 800; color: #0b4ca1; text-align: center; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.04em; }

  table.data-table { width: 100%; table-layout: fixed; border-collapse: collapse; }

  /* One padding for every cell type -> columns line up perfectly */
  table.data-table th,
  table.data-table td {
    padding: 5px 10px;
    box-sizing: border-box;
    vertical-align: middle;
    overflow-wrap: anywhere;
  }

  /* Header + body share the same alignment per column */
  table.data-table th.left,   table.data-table td.left   { text-align: left   !important; }
  table.data-table th.center, table.data-table td.center { text-align: center !important; }
  table.data-table th.right,  table.data-table td.right  { text-align: right  !important; white-space: nowrap; font-variant-numeric: tabular-nums; }

  table.data-table tr.section-row td { background: #0b4ca1; color: #fff; font-weight: 700; font-size: 11px; border-bottom: none; text-align: left !important; }
  table.data-table tr.subtotal-row td { background: #dbe6f6; color: #0b4ca1; font-weight: 700; font-size: 10.5px; }
  table.data-table tr.grand-total td { background: #0b4ca1; color: #fff; font-weight: 800; font-size: 12px; padding-top: 7px; padding-bottom: 7px; border-top: 2px solid #08386f; border-bottom: none; }
  table.data-table tbody tr.data-row:nth-child(even) td { background: #f8fafc; }
`;

function renderHtmlTable(lines: ReportLine[], columns: ColumnDef[]): string {
  const ncols = columns.length;
  const labelSpan = Math.max(1, ncols - 3); // label cell spans everything before Sales/Cost/Profit

  const colgroup = `<colgroup>${columns.map((c) => `<col style="width:${c.width}%">`).join("")}</colgroup>`;

  const headerCells = columns
    .map((c) => `<th class="${c.align}">${escapeHtml(c.label)}</th>`)
    .join("");

  // Numeric cells for total rows (always the last 3 columns => right aligned)
  const totalCells = (cells: (string | number)[] = []) =>
    cells.slice(-3).map((c) => `<td class="right num">${escapeHtml(c)}</td>`).join("");

  const rowsHtml = lines.map((line) => {
    if (line.kind === "section") {
      return `<tr class="section-row"><td class="left" colspan="${ncols}">${escapeHtml(line.label)}</td></tr>`;
    }
    if (line.kind === "subtotal") {
      return `<tr class="subtotal-row"><td class="left" colspan="${labelSpan}">${escapeHtml(line.label)}</td>${totalCells(line.cells)}</tr>`;
    }
    if (line.kind === "grandtotal") {
      return `<tr class="grand-total"><td class="left" colspan="${labelSpan}">${escapeHtml(line.label)}</td>${totalCells(line.cells)}</tr>`;
    }
    // data row
    const cells = (line.cells || []).map((c, i) => {
      const align = columns[i]?.align || "left";
      return `<td class="${align}${align === "right" ? " num" : ""}">${escapeHtml(c)}</td>`;
    }).join("");
    return `<tr class="data-row">${cells}</tr>`;
  }).join("");

  return `
    <table class="data-table">
      ${colgroup}
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
}

async function renderHtml(mode: ReportMode, lines: ReportLine[], columns: ColumnDef[], loginId: string, p: ReqParams, req: RequestWithUser): Promise<string> {
  // ── Shared company header (logo + name + address), same as every other report ──
  const headerHtml = await reportHeader({ company_code: p.company_code, req });

  const bodyHtml = `
    <div class="pl-title">${escapeHtml(MODE_TITLES[mode])}</div>
    <div class="group">
      ${renderHtmlTable(lines, columns)}
    </div>`;

  // ── Shared footer (print date / user / report name) ──
  const footerHtml = reportFooter({
    reportName: MODE_TITLES[mode],
    userName: loginId,
  });

  // ── Assemble the whole page using the same shell every other report uses ──
  return buildReportDocument({
    title: MODE_TITLES[mode],
    headerHtml,
    bodyHtml,
    footerHtml,
    extraCss: PL_EXTRA_CSS,
    showPrintButton: true,
  });
}

// ─── Excel builder (separate output format, no HTML CSS involved) ─────────

const STYLE_ID = { header: 1, section: 2, value: 3, numValue: 4, subtotal: 5, numSubtotal: 6, grand: 7, numGrand: 8 } as const;
type StyleKey = keyof typeof STYLE_ID;
interface XlCell { v: unknown; s: number }
function xc(v: unknown, style: StyleKey): XlCell { return { v, s: STYLE_ID[style] }; }

function buildExcelBuffer(mode: ReportMode, lines: ReportLine[], columns: ColumnDef[]): Buffer {
  const ncols = columns.length;
  type Row = (XlCell | null)[];
  const rows: Row[] = [];

  rows.push([xc(MODE_TITLES[mode], "header"), ...Array(ncols - 1).fill(null)]);
  rows.push(Array(ncols).fill(null));
  rows.push(columns.map((c) => xc(c.label, "header")));

  for (const line of lines) {
    if (line.kind === "section") {
      rows.push([xc(line.label, "section"), ...Array(ncols - 1).fill(null)]);
    } else if (line.kind === "data") {
      rows.push((line.cells || []).map((c, i) => xc(c, columns[i]?.align === "right" ? "numValue" : "value")));
    } else if (line.kind === "subtotal") {
      const numeric = (line.cells || []).slice(-3);
      rows.push([
        xc(line.label, "subtotal"), ...Array(Math.max(0, ncols - 4)).fill(null),
        ...numeric.map((c) => xc(c, "numSubtotal")),
      ]);
    } else if (line.kind === "grandtotal") {
      const numeric = (line.cells || []).slice(-3);
      rows.push([
        xc(line.label, "grand"), ...Array(Math.max(0, ncols - 4)).fill(null),
        ...numeric.map((c) => xc(c, "numGrand")),
      ]);
    }
  }

  const colXml = Array.from({ length: ncols }, (_, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="16" customWidth="1"/>`
  ).join("");

  const merges: string[] = [];
  rows.forEach((row, ri) => {
    const rn = ri + 1;
    let ci = 0;
    while (ci < row.length) {
      if (row[ci] !== null) {
        let end = ci + 1;
        while (end < row.length && row[end] === null) end++;
        if (end - 1 > ci) {
          merges.push(`${String.fromCharCode(65 + ci)}${rn}:${String.fromCharCode(65 + end - 1)}${rn}`);
        }
        ci = end;
      } else ci++;
    }
  });

  let sheetDataXml = "";
  rows.forEach((row, ri) => {
    const rn = ri + 1;
    let rowXml = `<row r="${rn}">`;
    row.forEach((cell, ci) => {
      if (cell === null) return;
      const ref = String.fromCharCode(65 + ci) + rn;
      if (typeof cell.v === "number") {
        rowXml += `<c r="${ref}" s="${cell.s}"><v>${cell.v}</v></c>`;
      } else {
        rowXml += `<c r="${ref}" s="${cell.s}" t="inlineStr"><is><t>${escapeXml(cell.v ?? "")}</t></is></c>`;
      }
    });
    rowXml += "</row>";
    sheetDataXml += rowXml;
  });

  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colXml}</cols>
  <sheetData>${sheetDataXml}</sheetData>
  ${mergeXml}
</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="5">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF1E3A5F"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF111827"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F2040"/><name val="Calibri"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFC8D4E4"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right>
      <top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="9">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" indent="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="P&amp;L Summary" sheetId="1" r:id="rId1"/></sheets>
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

// ─── Route handlers ─────────────────────────────────────────────────────────

export const getPLSummaryReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadPLSummaryData(req, params);
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }
    const { lines, columns } = buildReportLines(params.mode, rows);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(await renderHtml(params.mode, lines, columns, params.loginid, params, req));
  } catch (error: any) {
    console.error("P&L Summary HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getPLSummaryReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadPLSummaryData(req, params);
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }
    const { lines, columns } = buildReportLines(params.mode, rows);
    const buffer = buildExcelBuffer(params.mode, lines, columns);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="PL_Summary_Report.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("P&L Summary Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};