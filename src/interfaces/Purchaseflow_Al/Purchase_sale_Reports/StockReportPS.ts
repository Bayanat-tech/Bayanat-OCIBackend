import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { buildReportDocument, reportFooter, reportHeader } from "../../../controllers/common/report_common";

// ─── Types ────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

interface ReqParams {
  loginid:      string;
  company_code: string;
  prod_code:    string; // "All" or a product code
  fromdate:     string; // "All" or "YYYY-MM-DD"
  todate:       string;
}

// ─── DB helpers (same as PoOrderRegisterReport.ts) ─────────────────────────

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

function num(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function escapeHtml(value: unknown): string {
  return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeXml(value: unknown): string {
  return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function qtyFmt(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}



// ─── Param extraction ───────────────────────────────────────────────────────

function extractParams(req: RequestWithUser): ReqParams {
  const b = req.body || {};
  return {
    loginid:      text(req.user?.loginid) || text(b.loginid) || "ADMIN",
    company_code: text(b.company_code),
    prod_code:    text(b.prod_code) || "All",
    fromdate:     text(b.fromdate) || "All",
    todate:       text(b.todate) || "All",
  };
}

// ─── Data loader ────────────────────────────────────────────────────────────

async function loadStockReportData(req: RequestWithUser, p: ReqParams, dispatchParam: string): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const toDate = (iso: string): Date | null => {
      if (!iso || iso.toUpperCase() === "ALL") return null;
      const d = new Date(iso + "T00:00:00");
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const binds: any = {
      parameter: dispatchParam,
      loginid: p.loginid,
      code1: p.company_code || null,
      code2: p.prod_code || null,
      code3: null,
      code4: null,
      number1: null,
      number2: null,
      number3: null,
      number4: null,
      date1: toDate(p.fromdate),
      date2: toDate(p.todate),
      date3: null,
      date4: null,
      out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    const result = await conn.execute(
      `DECLARE
         v_sql VARCHAR2(32767);
       BEGIN
         PROC_PURSALES_STOCK_SUMMARY_REPORT(
           :parameter, :loginid,
           :code1,  :code2,  :code3,  :code4,
           :number1, :number2, :number3, :number4,
           :date1,   :date2,   :date3,   :date4,
           v_sql
         );
         :out_sql := v_sql;
       END;`,
      binds
    );

    const rawSql = (result.outBinds as any).out_sql;
    if (!rawSql) throw new Error("Procedure did not return a valid SQL query.");

    console.log("=== GENERATED SQL (Stock Report) ===\n", rawSql, "\n=== END ===");

    const dataResult = await conn.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return normalize(dataResult.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Shared visual system (same conventions as PurchaseQuotationReports.ts) ─

const REPORT_TITLE_SUMMARY = "Stock Summary Report";
const REPORT_TITLE_DETAIL = "Stock Transaction Report";
const REPORT_NAME_SUMMARY = "rpt_stock_summary";
const REPORT_NAME_DETAIL = "rpt_stock_transaction_detail";

/** Report-specific layout CSS (shared header/footer/table CSS comes from report_common) */
const STOCK_EXTRA_CSS = `
  .doc-title-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin: 4px 0 12px 0;
  }
  .doc-title-row h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 800;
    color: #0b4ca1;
  }
  .doc-title-row .doc-sub {
    margin: 2px 0 0;
    font-size: 11px;
    color: #64748b;
  }
  .doc-title-row .print-meta {
    text-align: right;
    font-size: 10.5px;
    color: #475569;
    line-height: 1.4;
  }

  .status-badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 10.5px;
    font-weight: 700;
  }
  .status-IN { background: #d1fae5; color: #065f46; }
  .status-OUT { background: #fee2e2; color: #dc2626; }
  .status-UNKNOWN { background: #f1f5f9; color: #64748b; }

  .prod-group {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    margin-bottom: 16px;
    overflow: hidden;
    break-inside: avoid;
  }
  .prod-group-header {
    padding: 8px 14px;
    background: #0b4ca1;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.03em;
  }
  table.data-table.grouped {
    border-top: none;
  }
  .closing-row td {
    background: #eef2f7;
    font-weight: 700;
    color: #1e3a8a;
  }

  .totals-box {
    margin-top: 16px;
    margin-left: auto;
    width: 320px;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    overflow: hidden;
  }
  .totals-box .row {
    display: flex;
    justify-content: space-between;
    padding: 7px 14px;
    font-size: 12px;
    border-bottom: 1px solid #f1f5f9;
  }
  .totals-box .row.grand {
    background: #0b4ca1;
    color: #fff;
    font-weight: 700;
    font-size: 13px;
    border-bottom: none;
  }
`;

function docTitleRowHtml(title: string, subtitle: string, printDateTime: string, loginId: string): string {
  return `
    <div class="doc-title-row">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="doc-sub">${escapeHtml(subtitle)}</div>
      </div>
      <div class="print-meta">
        <div>Print Date: ${escapeHtml(printDateTime)}</div>
        <div>Print User: ${escapeHtml(loginId)}</div>
      </div>
    </div>`;
}

// ─── Report 1: Stock Summary ────────────────────────────────────────────────

/** Body only – no full HTML document */
function renderStockSummaryBody(rows: ReportRow[], loginId: string): string {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const totalIn = rows.reduce((s, r) => s + num(r.in_qty), 0);
  const totalOut = rows.reduce((s, r) => s + num(r.out_qty), 0);
  const totalFinal = rows.reduce((s, r) => s + num(r.final_qty), 0);

  const bodyRows = rows
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.prod_code)} ${escapeHtml(r.prod_name)}</td>
        <td class="right">${qtyFmt(r.in_qty)}</td>
        <td class="right">${qtyFmt(r.out_qty)}</td>
        <td class="right amount">${qtyFmt(r.final_qty)}</td>
      </tr>`
    )
    .join("");

  return `
    ${docTitleRowHtml(REPORT_TITLE_SUMMARY, "Stock movement summary by product", printDateTime, loginId)}

    ${
      rows.length === 0
        ? `<div class="empty">No records found for the selected filters.</div>`
        : `
      <table class="data-table">
        <thead>
          <tr>
            <th>Product</th>
            <th class="right">In Qty</th>
            <th class="right">Out Qty</th>
            <th class="right">Final Qty</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>

      <div class="totals-box">
        <div class="row"><span>Total In</span><span>${qtyFmt(totalIn)}</span></div>
        <div class="row"><span>Total Out</span><span>${qtyFmt(totalOut)}</span></div>
        <div class="row grand"><span>Total Final Qty</span><span>${qtyFmt(totalFinal)}</span></div>
      </div>`
    }
  `;
}

// ─── Report 2: Stock Transaction Detail (grouped by product, running qty) ─

interface ProductGroup {
  prod_code: string;
  prod_name: string;
  rows: ReportRow[];
  closingQty: number;
}

function groupByProduct(rows: ReportRow[]): ProductGroup[] {
  const byProd = new Map<string, ProductGroup>();
  const order: string[] = [];

  for (const r of rows) {
    const key = text(r.prod_code);
    if (!byProd.has(key)) {
      byProd.set(key, { prod_code: key, prod_name: text(r.prod_name), rows: [], closingQty: 0 });
      order.push(key);
    }
    const g = byProd.get(key)!;
    g.rows.push(r);
    g.closingQty = num(r.running_qty);
  }

  return order.map((k) => byProd.get(k)!);
}

/** Body only – no full HTML document */
function renderStockTransactionBody(rows: ReportRow[], loginId: string): string {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const groups = groupByProduct(rows);

  const groupsHtml = groups
    .map((g) => {
      const lineRows = g.rows
        .map(
          (r) => `
        <tr>
          <td>${escapeHtml(r.doc_type)}</td>
          <td>${escapeHtml(r.doc_no)}</td>
          <td class="center"><span class="status-badge status-${escapeHtml(r.stock_type)}">${escapeHtml(r.stock_type)}</span></td>
          <td class="right">${qtyFmt(r.quantity)}</td>
          <td class="right">${qtyFmt(r.transaction_qty)}</td>
          <td class="right amount">${qtyFmt(r.running_qty)}</td>
        </tr>`
        )
        .join("");

      return `
      <div class="prod-group">
        <div class="prod-group-header">${escapeHtml(g.prod_code)} ${escapeHtml(g.prod_name)}</div>
        <table class="data-table grouped">
          <thead>
            <tr>
              <th>Doc Type</th>
              <th>Doc No</th>
              <th class="center">Type</th>
              <th class="right">Quantity</th>
              <th class="right">Txn Qty</th>
              <th class="right">Running Qty</th>
            </tr>
          </thead>
          <tbody>
            ${lineRows}
            <tr class="closing-row">
              <td colspan="5">Closing Stock for ${escapeHtml(g.prod_code)}</td>
              <td class="right">${qtyFmt(g.closingQty)}</td>
            </tr>
          </tbody>
        </table>
      </div>`;
    })
    .join("");

  return `
    ${docTitleRowHtml(REPORT_TITLE_DETAIL, "Stock transaction history with running balance", printDateTime, loginId)}

    ${rows.length === 0 ? `<div class="empty">No records found for the selected filters.</div>` : groupsHtml}
  `;
}

// ─── Route handlers (HTML) ──────────────────────────────────────────────────

export const getStockSummaryReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadStockReportData(req, params, "PURSALES_STOCK_SUMMARY_REPORT_19082026");
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }

    const companyCode =
      params.company_code ||
      text(req.user?.company_code) ||
      text(req.query.company_code) ||
      "BSG";

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: REPORT_NAME_SUMMARY,
      userName: params.loginid,
      endLabel: "Powered by Bayanat Technology",
    });
    const bodyHtml = renderStockSummaryBody(rows, params.loginid);

    const html = buildReportDocument({
      title: REPORT_TITLE_SUMMARY,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: STOCK_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Stock Summary Report HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getStockTransactionReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadStockReportData(req, params, "PURSALES_STOCK_TRANSACTION_DETAIL_19082026");
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }

    const companyCode =
      params.company_code ||
      text(req.user?.company_code) ||
      text(req.query.company_code) ||
      "BSG";

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: REPORT_NAME_DETAIL,
      userName: params.loginid,
      endLabel: "Powered by Bayanat Technology",
    });
    const bodyHtml = renderStockTransactionBody(rows, params.loginid);

    const html = buildReportDocument({
      title: REPORT_TITLE_DETAIL,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: STOCK_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Stock Transaction Report HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

// ─── Generic OOXML Excel builder engine (shared by both reports) ──────────

interface XlCell { v: unknown; styleKey: string }
type XlRow = (XlCell | null)[];
interface XlMerge { s: { r: number; c: number }; e: { r: number; c: number } }

const XL_BLUE = "FF1D4ED8";
const XL_WHITE = "FFFFFFFF";
const XL_HEADER_BLUE = "FF1E3A8A";
const XL_GREEN_BG = "FFD1FAE5";

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
      border: { top: borderThin(XL_BLUE), bottom: borderThin(XL_BLUE), left: borderThin(XL_BLUE), right: borderThin(XL_BLUE) },
    },
    groupHeader: {
      font: { bold: true, sz: 11, color: { rgb: XL_WHITE } },
      fill: { fgColor: { rgb: XL_HEADER_BLUE } },
      alignment: { horizontal: "left", vertical: "center" },
    },
    data: { font: { sz: 10 }, alignment: { vertical: "center" }, border: { bottom: borderThin("FFF3F4F6") } },
    dataNum: {
      font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.000", border: { bottom: borderThin("FFF3F4F6") },
    },
    groupTotal: {
      font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
      fill: { fgColor: { rgb: XL_GREEN_BG } },
      alignment: { horizontal: "left", vertical: "center" },
      border: { top: borderThin("FF065F46") },
    },
    groupTotalNum: {
      font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
      fill: { fgColor: { rgb: XL_GREEN_BG } },
      alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.000",
      border: { top: borderThin("FF065F46") },
    },
    grandTotal: {
      font: { bold: true, sz: 12, color: { rgb: XL_WHITE } },
      fill: { fgColor: { rgb: XL_BLUE } },
      alignment: { horizontal: "left", vertical: "center" },
    },
    grandTotalNum: {
      font: { bold: true, sz: 12, color: { rgb: XL_WHITE } },
      fill: { fgColor: { rgb: XL_BLUE } },
      alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.000",
    },
    footer: { font: { italic: true, sz: 8, color: { rgb: "FF64748B" } }, alignment: { horizontal: "right" } },
  };
}

function buildXlsxBuffer(sheetName: string, colCount: number, colWidth: number, rows_: XlRow[], merges: XlMerge[], styleDefs: Record<string, any>): Buffer {
  interface FontDef { bold?: boolean; italic?: boolean; sz?: number; color?: string; }
  interface FillDef { color?: string; }
  interface BorderDef { top?: string; bottom?: string; left?: string; right?: string; }
  interface XfDef { fontId: number; fillId: number; borderId: number; numFmtId: number; align?: string; wrap?: boolean; }

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
      top: b.top?.color?.rgb, bottom: b.bottom?.color?.rgb, left: b.left?.color?.rgb, right: b.right?.color?.rgb,
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
    `<col min="${i + 1}" max="${i + 1}" width="${colWidth}" customWidth="1"/>`
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

  const mergesXml = merges.map((m) =>
    `<mergeCell ref="${String.fromCharCode(65 + m.s.c)}${m.s.r + 1}:${String.fromCharCode(65 + m.e.c)}${m.e.r + 1}"/>`
  ).join("");
  const mergeFinal = merges.length ? `<mergeCells count="${merges.length}">${mergesXml}</mergeCells>` : "";

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colXml}</cols>
  <sheetData>${sheetDataXml}</sheetData>
  ${mergeFinal}
</worksheet>`;

  const numFmtsXml = numFmts.length
    ? `<numFmts count="${numFmts.length}">${numFmts.map((n) => `<numFmt numFmtId="${n.id}" formatCode="${escapeXml(n.code)}"/>`).join("")}</numFmts>`
    : "";

  const fontsXml = `<fonts count="${fonts.length}">${fonts.map((f) => `
    <font>
        ${f.sz ? `<sz val="${f.sz}"/>` : '<sz val="10"/>'}
        ${f.color ? `<color rgb="${f.color}"/>` : '<color rgb="FF000000"/>'}
        <name val="Arial"/>
        ${f.bold ? "<b/>" : ""}
        ${f.italic ? "<i/>" : ""}
    </font>`).join("")}
</fonts>`;

  const fillsXml = `<fills count="${fills.length}">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    ${fills.slice(2).map((f) => `
    <fill>
        <patternFill patternType="solid">
            <fgColor rgb="${f.color}"/>
            <bgColor rgb="${f.color}"/>
        </patternFill>
    </fill>`).join("")}
</fills>`;

  const borderEdge = (rgb?: string) => (rgb ? `<color rgb="${rgb}"/>` : "");
  const bordersXml = `<borders count="${borders.length}">${borders.map((b) => `
    <border>
        <left style="${b.left ? "thin" : "none"}">${borderEdge(b.left)}</left>
        <right style="${b.right ? "thin" : "none"}">${borderEdge(b.right)}</right>
        <top style="${b.top ? "thin" : "none"}">${borderEdge(b.top)}</top>
        <bottom style="${b.bottom ? "thin" : "none"}">${borderEdge(b.bottom)}</bottom>
        <diagonal/>
    </border>`).join("")}
</borders>`;

  const cellXfsXml = `<cellXfs count="${cellXfs.length}">${cellXfs.map((xf) => {
    const applyAlign = xf.align || xf.wrap;
    return `
    <xf numFmtId="${xf.numFmtId}" fontId="${xf.fontId}" fillId="${xf.fillId}" borderId="${xf.borderId}"
        applyFont="1" applyFill="${xf.fillId ? 1 : 0}" applyBorder="${xf.borderId ? 1 : 0}"
        applyNumberFormat="${xf.numFmtId ? 1 : 0}" applyAlignment="${applyAlign ? 1 : 0}">
        ${applyAlign ? `<alignment${xf.align ? ` horizontal="${xf.align}"` : ""}${xf.wrap ? ` wrapText="1"` : ""} vertical="center"/>` : ""}
    </xf>`;
  }).join("")}
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

// ─── Excel builder 1: Stock Summary ─────────────────────────────────────────

function buildStockSummaryExcelBuffer(rows: ReportRow[], loginId: string): Buffer {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const COL_COUNT = 4; // Product, In Qty, Out Qty, Final Qty
  const rows_: XlRow[] = [];
  const merges: XlMerge[] = [];

  rows_.push([xlCell(REPORT_TITLE_SUMMARY, "title"), null, null, null]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  rows_.push([
    xlCell(`Date: ${printDateTime}`, "meta"), null,
    xlCell(`User: ${loginId}`, "meta"), null,
  ]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } });
  merges.push({ s: { r: 1, c: 2 }, e: { r: 1, c: 3 } });

  rows_.push([null, null, null, null]);

  rows_.push([
    xlCell("Product", "header"), xlCell("In Qty", "header"), xlCell("Out Qty", "header"), xlCell("Final Qty", "header"),
  ]);

  let totalIn = 0;
  let totalOut = 0;
  let totalFinal = 0;
  rows.forEach((r) => {
    totalIn += num(r.in_qty);
    totalOut += num(r.out_qty);
    totalFinal += num(r.final_qty);
    rows_.push([
      xlCell(`${text(r.prod_code)} ${text(r.prod_name)}`, "data"),
      xlCell(num(r.in_qty), "dataNum"),
      xlCell(num(r.out_qty), "dataNum"),
      xlCell(num(r.final_qty), "dataNum"),
    ]);
  });

  rows_.push([null, null, null, null]);

  const grandRow = rows_.length;
  rows_.push([
    xlCell("Grand Total", "grandTotal"),
    xlCell(totalIn, "grandTotalNum"),
    xlCell(totalOut, "grandTotalNum"),
    xlCell(totalFinal, "grandTotalNum"),
  ]);

  rows_.push([null, null, null, xlCell("Powered by Bayanat Technology", "footer")]);

  return buildXlsxBuffer("Stock Summary", COL_COUNT, 24, rows_, merges, defaultXlStyleDefs());
}

// ─── Excel builder 2: Stock Transaction Detail ──────────────────────────────

function buildStockTransactionExcelBuffer(rows: ReportRow[], loginId: string): Buffer {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const groups = groupByProduct(rows);

  const COL_COUNT = 6; // Doc Type, Doc No, Type, Quantity, Txn Qty, Running Qty
  const rows_: XlRow[] = [];
  const merges: XlMerge[] = [];

  rows_.push([xlCell(REPORT_TITLE_DETAIL, "title"), null, null, null, null, null]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  rows_.push([
    xlCell(`Date: ${printDateTime}`, "meta"), null,
    xlCell(`User: ${loginId}`, "meta"), null, null, null,
  ]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } });
  merges.push({ s: { r: 1, c: 2 }, e: { r: 1, c: 5 } });

  rows_.push(new Array(COL_COUNT).fill(null));

  rows_.push([
    xlCell("Doc Type", "header"), xlCell("Doc No", "header"), xlCell("Type", "header"),
    xlCell("Quantity", "header"), xlCell("Txn Qty", "header"), xlCell("Running Qty", "header"),
  ]);

  groups.forEach((g) => {
    const rIdx = rows_.length;
    rows_.push([xlCell(`${g.prod_code} ${g.prod_name}`, "groupHeader"), null, null, null, null, null]);
    merges.push({ s: { r: rIdx, c: 0 }, e: { r: rIdx, c: COL_COUNT - 1 } });

    g.rows.forEach((r) => {
      rows_.push([
        xlCell(text(r.doc_type), "data"),
        xlCell(text(r.doc_no), "data"),
        xlCell(text(r.stock_type), "data"),
        xlCell(num(r.quantity), "dataNum"),
        xlCell(num(r.transaction_qty), "dataNum"),
        xlCell(num(r.running_qty), "dataNum"),
      ]);
    });

    const closeRow = rows_.length;
    rows_.push([xlCell(`Closing Stock for ${g.prod_code}`, "groupTotal"), null, null, null, null, xlCell(g.closingQty, "groupTotalNum")]);
    merges.push({ s: { r: closeRow, c: 0 }, e: { r: closeRow, c: 4 } });

    rows_.push(new Array(COL_COUNT).fill(null));
  });

  rows_.push([null, null, null, null, null, xlCell("Powered by Bayanat Technology", "footer")]);

  return buildXlsxBuffer("Stock Transaction Detail", COL_COUNT, 18, rows_, merges, defaultXlStyleDefs());
}

// ─── Route handlers (Excel) ─────────────────────────────────────────────────

export const getStockSummaryReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadStockReportData(req, params, "PURSALES_STOCK_SUMMARY_REPORT_19082026");
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }
    const buffer = buildStockSummaryExcelBuffer(rows, params.loginid);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Stock_Summary_Report.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("Stock Summary Report Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};

export const getStockTransactionReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadStockReportData(req, params, "PURSALES_STOCK_TRANSACTION_DETAIL_19082026");
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }
    const buffer = buildStockTransactionExcelBuffer(rows, params.loginid);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Stock_Transaction_Report.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("Stock Transaction Report Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};