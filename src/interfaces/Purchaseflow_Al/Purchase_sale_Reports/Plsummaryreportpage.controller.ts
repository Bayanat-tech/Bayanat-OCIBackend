import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";

// This is the backend counterpart of PLSummaryPage.tsx (frontend).

// ─── Types ────────────────────────────────────────────────────────────────

type ReportMode = "invoicewise" | "customerwise" | "salesmanwise" | "customergroupwise" | "groupcustomerwise";

type ReportRow = Record<string, any>;

interface ReqParams {
  loginid:      string;
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

    const docNo = parseInt(p.docno, 10) || 0;
    binds.docNo = docNo;
    const docClause = docNo === 0 ? "1=1" : "DOC_NO = :docNo";

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
      // underlying query (customer + group breakdown) — they only differ in
      // which level is the primary section when we render/group the rows
      // below (customer-first vs group-first).
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
// "subsection" -> second-level heading row (used only for the two
//                 customer+group modes)
// "data"       -> a real data row with numeric columns
// "subtotal"   -> total for the current section/subsection
// "grandtotal" -> overall total

interface ReportLine {
  kind: "section" | "subsection" | "data" | "subtotal" | "grandtotal";
  label?: string;
  cells?: (string | number)[]; // aligned to `columns` below (numeric cols right-aligned)
}

interface ColumnDef {
  label: string;
  align: "left" | "right";
}

function getColumnsForMode(mode: ReportMode): ColumnDef[] {
  switch (mode) {
    case "invoicewise":
      return [
        { label: "Inv No", align: "left" }, { label: "Date", align: "left" },
        { label: "Qty", align: "right" }, { label: "Customer", align: "left" },
        { label: "Sales Value", align: "right" }, { label: "Cost Value", align: "right" }, { label: "Profit", align: "right" },
      ];
    case "salesmanwise":
      return [
        { label: "Salesman Code", align: "left" }, { label: "Salesman Name", align: "left" },
        { label: "Sales Value", align: "right" }, { label: "Cost Value", align: "right" }, { label: "Profit", align: "right" },
      ];
    case "customerwise":
    case "customergroupwise":
    case "groupcustomerwise":
    default:
      return [
        { label: "Code", align: "left" }, { label: "Name", align: "left" },
        { label: "Sales Value", align: "right" }, { label: "Cost Value", align: "right" }, { label: "Profit", align: "right" },
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

  const addTotalsLine = (kind: ReportLine["kind"], label: string, sales: number, cost: number, profit: number, numericColCount: number) => {
    const blanks = Array(columns.length - numericColCount - 1).fill("");
    lines.push({ kind, label, cells: [...blanks, numFmt(sales), numFmt(cost), numFmt(profit)] });
  };

  if (mode === "invoicewise") {
    for (const r of rows) {
      const sales = num(r.sales_value), cost = num(r.cost_value), profit = num(r.profit);
      grandSales += sales; grandCost += cost; grandProfit += profit;
      lines.push({
        kind: "data",
        cells: [text(r.inv_no) || "\u2014", dateText(r.doc_date), numFmt(r.quantity, 2), `${text(r.ac_code)} | ${text(r.ac_name)}`, numFmt(sales), numFmt(cost), numFmt(profit)],
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
    const primaryKey  = (r: ReportRow) => (groupByCustomerFirst ? text(r.ac_code)    : text(r.group_code));
    const primaryName = (r: ReportRow) => (groupByCustomerFirst ? text(r.ac_name)    : text(r.group_name));
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
        lines.push({ kind: "data", cells: ["", secondaryName(r), numFmt(sales), numFmt(cost), numFmt(profit)] });
      }
      addTotalsLine("subtotal", `Total For ${key} | ${group.name}`, subSales, subCost, subProfit, 3);
      grandSales += subSales; grandCost += subCost; grandProfit += subProfit;
    }
  }

  addTotalsLine("grandtotal", "Grand Total", grandSales, grandCost, grandProfit, mode === "invoicewise" ? 3 : 3);
  return { lines, columns };
}

// ─── HTML renderer ──────────────────────────────────────────────────────────

const MODE_TITLES: Record<ReportMode, string> = {
  invoicewise: "P&L Summary Report - Invoice wise",
  customerwise: "P&L Summary Report - Customer wise",
  salesmanwise: "P&L Summary Report - Salesman wise",
  customergroupwise: "P&L Summary Report - Customer-Group wise",
  groupcustomerwise: "P&L Summary Report - Group-Customer wise",
};

function renderHtml(mode: ReportMode, lines: ReportLine[], columns: ColumnDef[], loginId: string): string {
  const printDate = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const ncols = columns.length;

  const headerCells = columns.map((c) => `<th class="${c.align}">${escapeHtml(c.label)}</th>`).join("");

  const rowsHtml = lines.map((line) => {
    if (line.kind === "section") {
      return `<tr class="section-row"><td colspan="${ncols}">${escapeHtml(line.label)}</td></tr>`;
    }
    if (line.kind === "subtotal") {
      const cells = (line.cells || []).map((c, i) => `<td class="${columns[i]?.align === "right" ? "num" : ""}">${escapeHtml(c)}</td>`).join("");
      return `<tr class="subtotal-row"><td>${escapeHtml(line.label)}</td>${cells.slice(0)}</tr>`.replace(
        `<td>${escapeHtml(line.label)}</td>${cells}`,
        `<td colspan="${Math.max(1, ncols - 3)}">${escapeHtml(line.label)}</td>${(line.cells || []).slice(-3).map((c) => `<td class="num">${escapeHtml(c)}</td>`).join("")}`
      );
    }
    if (line.kind === "grandtotal") {
      const last3 = (line.cells || []).slice(-3);
      return `<tr class="grand-total"><td colspan="${Math.max(1, ncols - 3)}">${escapeHtml(line.label)}</td>${last3.map((c) => `<td class="num">${escapeHtml(c)}</td>`).join("")}</tr>`;
    }
    // data
    const cells = (line.cells || []).map((c, i) => `<td class="${columns[i]?.align === "right" ? "num" : ""}">${escapeHtml(c)}</td>`).join("");
    return `<tr class="data-row">${cells}</tr>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(MODE_TITLES[mode])}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm 12mm; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Segoe UI", Calibri, Arial, sans-serif; font-size: 12px; color: #111827; background: #eef1f6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sheet { width: 277mm; min-height: 190mm; margin: 18px auto; background: #fff; padding: 10mm 12mm; border: 1px solid #c4cdd9; border-radius: 4px; }
    .rpt-header { background: #1e3a5f; color: #fff; text-align: center; font-size: 14px; font-weight: 700; letter-spacing: .08em; padding: 10px 16px; text-transform: uppercase; border-radius: 3px 3px 0 0; }
    .rpt-meta { display: flex; justify-content: space-between; align-items: center; padding: 6px 2px 8px; border-bottom: 1px solid #e2e8f0; margin-bottom: 10px; font-size: 10px; color: #4b5563; }
    .rpt-meta strong { color: #111827; font-weight: 600; }
    table.rpt-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead tr th { background: #1e3a5f; color: #fff; font-weight: 700; font-size: 10px; padding: 7px 10px; text-align: center; border-right: 1px solid rgba(255,255,255,0.15); }
    thead tr th:last-child { border-right: none; }
    thead tr th.left { text-align: left; } thead tr th.right { text-align: right; }
    tr.section-row td { background: #1e3a5f; color: #fff; font-weight: 700; font-size: 11px; padding: 5px 10px; }
    tbody tr.data-row td { padding: 4px 10px; border-bottom: 1px solid #e5e7eb; color: #374151; font-size: 11px; }
    tbody tr.data-row:nth-child(even) td { background: #f9fafb; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
    tr.subtotal-row td { background: #c8d4e4; padding: 4px 10px; font-size: 11px; font-weight: 700; color: #1e3a5f; }
    tr.grand-total td { background: #1e3a5f; color: #fff; font-weight: 700; font-size: 12px; padding: 8px 10px; border-top: 2px solid #162d4a; }
    .rpt-footer { margin-top: 10px; border-top: 1px solid #e2e8f0; padding-top: 6px; display: flex; justify-content: space-between; font-size: 9px; color: #9ca3af; }
    @media print { body { background: #fff; } .sheet { border: none; margin: 0; width: auto; min-height: auto; padding: 0; border-radius: 0; } thead { display: table-header-group; } }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="rpt-header">${escapeHtml(MODE_TITLES[mode])}</div>
    <div class="rpt-meta">
      <span>Print Date :&nbsp;<strong>${escapeHtml(printDate)}</strong>&nbsp;&nbsp;&nbsp;Print User :&nbsp;<strong>${escapeHtml(loginId)}</strong></span>
      <span>Page 1 of 1</span>
    </div>
    <table class="rpt-table">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="rpt-footer">
      <span>Report Name : <code>P&amp;L Summary Report</code></span>
      <span>Powered by Bayanat Technology</span>
    </div>
  </div>
  <script>
    window.addEventListener("message", function(e) { if (e.data === "print") window.print(); });
  </script>
</body>
</html>`;
}

// ─── Excel builder (raw OOXML, same style system as DN Summary) ───────────

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
  <sheets><sheet name="P&L Summary" sheetId="1" r:id="rId1"/></sheets>
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
    res.send(renderHtml(params.mode, lines, columns, params.loginid));
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