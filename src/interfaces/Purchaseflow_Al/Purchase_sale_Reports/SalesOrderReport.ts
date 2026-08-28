import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";

// ─── Types ────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

interface ReqParams {
  loginid:   string;
  prin_code: string;
  order_no:  string;
}

// ─── DB helpers ─────────────────────────────────────────────────────────────

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

function dateText(value: unknown): string {
  if (!value) return "\u2014";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value).substring(0, 10);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function dateTimeText(value: unknown): string {
  if (!value) return "\u2014";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
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
    loginid:   text(req.user?.loginid) || text(b.loginid) || "ADMIN",
    prin_code: text(b.prin_code),
    order_no:  text(b.order_no),
  };
}

// ─── Data loader ────────────────────────────────────────────────────────────

async function loadSalesOrderData(req: RequestWithUser, p: ReqParams): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const binds: any = {
      parameter: "PORPT_SO_19082026",
      loginid: p.loginid,
      code1: p.prin_code || null,
      code2: p.order_no || null,
      code3: null,
      code4: null,
      number1: null,
      number2: null,
      number3: null,
      number4: null,
      date1: null,
      date2: null,
      date3: null,
      date4: null,
      out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    const result = await conn.execute(
      `DECLARE
         v_sql VARCHAR2(32767);
       BEGIN
         PROC_BUILD_DYNAMIC_SQL_SALES_ORDER(
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

    console.log("=== GENERATED SQL ===\n", rawSql, "\n=== END ===");

    const dataResult = await conn.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return normalize(dataResult.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Report line model ──────────────────────────────────────────────────────

interface SoHeader {
  job_no: string;
  job_date: any;
  prin_code: string;
  prin_name: string;
}

interface OrderGroup {
  order_no: string;
  order_date: any;
  cust_code: string;
  cust_name: string;
  rows: ReportRow[];
  qty1Total: number;
  qty2Total: number;
}

function buildHeader(rows: ReportRow[]): SoHeader {
  const h = rows[0] || {};
  return {
    job_no: text(h.job_no),
    job_date: h.job_date,
    prin_code: text(h.prin_code),
    prin_name: text(h.prin_name),
  };
}

function groupByOrder(rows: ReportRow[]): { groups: OrderGroup[]; grandQty1: number; grandQty2: number } {
  const byOrder = new Map<string, OrderGroup>();
  const order: string[] = [];

  for (const r of rows) {
    const key = text(r.order_no);
    if (!byOrder.has(key)) {
      byOrder.set(key, {
        order_no: key,
        order_date: r.order_date,
        cust_code: text(r.cust_code),
        cust_name: text(r.cust_name),
        rows: [],
        qty1Total: 0,
        qty2Total: 0,
      });
      order.push(key);
    }
    const g = byOrder.get(key)!;
    g.rows.push(r);
    g.qty1Total += num(r.qty_puom);
    g.qty2Total += num(r.qty_luom);
  }

  const groups = order.map((k) => byOrder.get(k)!);
  const grandQty1 = groups.reduce((s, g) => s + g.qty1Total, 0);
  const grandQty2 = groups.reduce((s, g) => s + g.qty2Total, 0);

  return { groups, grandQty1, grandQty2 };
}

// ─── HTML renderer (PR Register visual style) ──────────────────────────────

const REPORT_TITLE = "Sales Order Report";
const REPORT_NAME = "rpt_sales_order";

function renderHtml(rows: ReportRow[], loginId: string): string {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const header = buildHeader(rows);
  const { groups, grandQty1, grandQty2 } = groupByOrder(rows);

  let bodyHtml = "";

  groups.forEach((g) => {
    bodyHtml += `
            <div class="group-container">
                <div class="group-header">
                    <div class="group-header-left">
                        <div>
                            <span class="group-label">Order No. ${escapeHtml(g.order_no)} &nbsp;/&nbsp; ${escapeHtml(dateText(g.order_date))}</span>
                            <span class="group-name">Customer: ${escapeHtml(g.cust_name)} ${g.cust_code ? `(${escapeHtml(g.cust_code)})` : ""}</span>
                        </div>
                    </div>
                </div>
                <table class="report-table">
                    <thead>
                        <tr>
                            <th>No.</th>
                            <th>Product</th>
                            <th class="right">Quantity1</th>
                            <th>UOM</th>
                            <th class="right">Quantity2</th>
                            <th>UOM</th>
                        </tr>
                    </thead>
                    <tbody>`;

    g.rows.forEach((r, i) => {
      bodyHtml += `
                        <tr>
                            <td>${i + 1}</td>
                            <td>${escapeHtml(r.prod_code)}${r.prod_name && r.prod_name !== r.prod_code ? ` — ${escapeHtml(r.prod_name)}` : ""}</td>
                            <td class="right amount">${qtyFmt(r.qty_puom)}</td>
                            <td>${escapeHtml(r.p_uom)}</td>
                            <td class="right amount">${qtyFmt(r.qty_luom)}</td>
                            <td>${escapeHtml(r.l_uom)}</td>
                        </tr>`;
    });

    bodyHtml += `
                        <tr class="subtotal-row">
                            <td colspan="2">Total</td>
                            <td class="right">${qtyFmt(g.qty1Total)}</td>
                            <td></td>
                            <td class="right">${qtyFmt(g.qty2Total)}</td>
                            <td></td>
                        </tr>
                    </tbody>
                </table>
            </div>`;
  });

  return `<!doctype html>
<html>
<head>
    <meta charset="utf-8"/>
    <title>${escapeHtml(REPORT_TITLE)}</title>
    <style>
        @media print {
            @page { size: A4 portrait; margin: 8mm; }
            .no-print { display: none !important; }
            .report-container { box-shadow: none !important; border: none !important; }
            .group-container { break-inside: avoid; }
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            padding: 20px;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 12px;
            background: #f3f4f6;
            color: #111827;
        }
        .report-container {
            max-width: 1100px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            padding: 24px 28px;
        }
        .report-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #1d4ed8;
            padding-bottom: 14px;
            margin-bottom: 20px;
        }
        .report-title-area { display: flex; align-items: center; gap: 14px; }
        .logo-img { max-height: 50px; max-width: 160px; object-fit: contain; }
        .report-title { font-size: 18px; font-weight: 700; color: #1e3a8a; letter-spacing: 1px; }
        .report-subtitle { font-size: 12px; color: #6b7280; font-weight: 400; letter-spacing: 0.5px; }
        .report-meta { text-align: right; font-size: 11px; color: #6b7280; line-height: 1.6; }
        .report-meta strong { color: #374151; }
        .job-info { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 32px; margin-bottom: 18px; }
        .job-info .row { font-size: 12px; color: #111827; padding: 3px 0; border-bottom: 1px solid #f3f4f6; }
        .job-info .row strong { display: inline-block; width: 90px; color: #374151; }
        .group-container { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
        .group-header { display: flex; align-items: center; padding: 10px 16px; background: #f8fafc; border-bottom: 1px solid #e5e7eb; }
        .group-header-left { display: flex; align-items: center; gap: 12px; }
        .group-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; display: block; }
        .group-name { font-size: 14px; font-weight: 600; color: #111827; }
        .report-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .report-table thead th {
            background: #f3f4f6; padding: 8px 14px; text-align: left; font-weight: 600; color: #374151;
            border-bottom: 2px solid #d1d5db; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
        }
        .report-table tbody td { padding: 7px 14px; border-bottom: 1px solid #f3f4f6; }
        .report-table .right { text-align: right; }
        .report-table .amount { font-weight: 500; color: #065f46; }
        .subtotal-row td { background: #eef2f7; font-weight: 700; color: #1e3a8a; padding: 7px 14px; }
        .report-footer {
            display: flex; justify-content: space-between; align-items: center;
            padding-top: 14px; margin-top: 14px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280;
        }
        .grand-total-area { display: flex; align-items: center; gap: 20px; }
        .grand-total-label { font-size: 13px; font-weight: 600; color: #374151; }
        .grand-total-value { font-size: 16px; font-weight: 700; color: #065f46; }
        .empty-state { text-align: center; padding: 40px 20px; color: #6b7280; }
        .end-of-report { text-align: center; font-weight: 600; color: #6b7280; margin-top: 10px; letter-spacing: 0.05em; }
        @media print {
            .report-header { border-bottom-color: #000; }
            .group-header { background: #f0f0f0 !important; }
            .report-table thead th { background: #e5e7eb !important; }
            .report-container { border-radius: 0; padding: 10mm; }
        }
    </style>
</head>
<body>
    <div class="report-container">
        <div class="report-header">
            <div class="report-title-area">
                <div>
                    <div class="report-title">${escapeHtml(REPORT_TITLE)}</div>
                </div>
            </div>
            <div class="report-meta">
                <div><strong>Date:</strong> ${escapeHtml(printDateTime)}</div>
                <div><strong>User:</strong> ${escapeHtml(loginId)}</div>
                <div><strong>Report:</strong> ${escapeHtml(REPORT_NAME)}</div>
            </div>
        </div>

        <div class="job-info">
            <div class="row"><strong>Job No:</strong> ${escapeHtml(header.job_no)}</div>
            <div class="row"><strong>Principal:</strong> ${escapeHtml(header.prin_code)} — ${escapeHtml(header.prin_name)}</div>
            <div class="row"><strong>Job Date:</strong> ${escapeHtml(dateTimeText(header.job_date))}</div>
        </div>

        ${rows.length === 0 ? `
            <div class="empty-state">
                <div>No records found for this order.</div>
            </div>
        ` : `
            ${bodyHtml}

            <div class="report-footer">
                <span>Report: ${escapeHtml(REPORT_NAME)}</span>
                <div class="grand-total-area">
                    <span class="grand-total-label">Grand Total</span>
                    <span class="grand-total-value">${qtyFmt(grandQty1)} / ${qtyFmt(grandQty2)}</span>
                </div>
            </div>
            <div class="end-of-report">End of report</div>
        `}
    </div>
    <div style="text-align:center;padding:12px;font-size:11px;color:#9ca3af;">
        Powered by Bayanat Technology
    </div>
</body>
</html>`;
}

// ─── Excel builder (raw OOXML, PR-style styling engine) ───────────

function buildExcelBuffer(rows: ReportRow[], loginId: string): Buffer {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const BLUE = "FF1D4ED8";
  const WHITE = "FFFFFFFF";
  const LBLUE = "FFDBEAFE";
  const GREEN_BG = "FFD1FAE5";

  const header = buildHeader(rows);
  const { groups, grandQty1, grandQty2 } = groupByOrder(rows);

  const COL_COUNT = 6; // No, Product, Qty1, UOM, Qty2, UOM

  interface XlCell { v: unknown; styleKey: string }
  type Row = (XlCell | null)[];
  const rows_: Row[] = [];
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];

  const cell = (v: unknown, styleKey: string): XlCell => ({ v, styleKey });

  rows_.push([cell(REPORT_TITLE, "title"), null, null, null, null, null]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  rows_.push([cell(`Date: ${printDateTime}`, "meta"), null, cell(`User: ${loginId}`, "meta"), null, cell(`Report: ${REPORT_NAME}`, "meta"), null]);

  rows_.push([
    cell(`Job No: ${header.job_no}   Job Date: ${dateTimeText(header.job_date)}`, "meta"), null, null,
    cell(`Principal: ${header.prin_code} - ${header.prin_name}`, "meta"), null, null,
  ]);
  merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: 2 } });
  merges.push({ s: { r: 2, c: 3 }, e: { r: 2, c: 5 } });

  rows_.push([null, null, null, null, null, null]);

  rows_.push([
    cell("No.", "header"), cell("Product", "header"), cell("Quantity1", "header"),
    cell("UOM", "header"), cell("Quantity2", "header"), cell("UOM", "header"),
  ]);

  groups.forEach((g) => {
    const rIdx = rows_.length;
    rows_.push([
      cell(`Order No. ${g.order_no} / ${dateText(g.order_date)}   Customer: ${g.cust_name} (${g.cust_code})`, "groupHeader"),
      null, null, null, null, null,
    ]);
    merges.push({ s: { r: rIdx, c: 0 }, e: { r: rIdx, c: COL_COUNT - 1 } });

    g.rows.forEach((r, i) => {
      rows_.push([
        cell(i + 1, "data"),
        cell(`${text(r.prod_code)}${r.prod_name && r.prod_name !== r.prod_code ? ` — ${text(r.prod_name)}` : ""}`, "data"),
        cell(num(r.qty_puom), "dataNum"),
        cell(text(r.p_uom), "data"),
        cell(num(r.qty_luom), "dataNum"),
        cell(text(r.l_uom), "data"),
      ]);
    });

    const tRow = rows_.length;
    rows_.push([cell("Total", "groupTotal"), null, cell(g.qty1Total, "groupTotalNum"), null, cell(g.qty2Total, "groupTotalNum"), null]);
    merges.push({ s: { r: tRow, c: 0 }, e: { r: tRow, c: 1 } });

    rows_.push([null, null, null, null, null, null]);
  });

  const gtRow = rows_.length;
  rows_.push([cell("Grand Total", "grandTotal"), null, cell(grandQty1, "grandTotalNum"), null, cell(grandQty2, "grandTotalNum"), null]);
  merges.push({ s: { r: gtRow, c: 0 }, e: { r: gtRow, c: 1 } });

  rows_.push([null, null, null, null, null, cell("Powered by Bayanat Technology", "footer")]);

  // ── Style registration engine (identical to PO/Register reports) ──
  interface FontDef { bold?: boolean; italic?: boolean; sz?: number; color?: string; }
  interface FillDef { color?: string; }
  interface BorderDef { top?: string; bottom?: string; left?: string; right?: string; }
  interface XfDef { fontId: number; fillId: number; borderId: number; numFmtId: number; align?: string; wrap?: boolean; }

  const styleDefs: Record<string, any> = {
    title: {
      font: { bold: true, sz: 16, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "center", vertical: "center" },
    },
    meta: { font: { sz: 9, color: { rgb: "FF333333" } } },
    header: {
      font: { bold: true, sz: 10, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: { top: { color: { rgb: BLUE } }, bottom: { color: { rgb: BLUE } }, left: { color: { rgb: BLUE } }, right: { color: { rgb: BLUE } } },
    },
    groupHeader: {
      font: { bold: true, sz: 11, color: { rgb: "FF111827" } },
      fill: { fgColor: { rgb: LBLUE } },
      alignment: { horizontal: "left", vertical: "center" },
      border: { bottom: { color: { rgb: "FFE5E7EB" } } },
    },
    groupTotal: {
      font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
      fill: { fgColor: { rgb: GREEN_BG } },
      alignment: { horizontal: "left", vertical: "center" },
      border: { top: { color: { rgb: "FF065F46" } } },
    },
    groupTotalNum: {
      font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
      fill: { fgColor: { rgb: GREEN_BG } },
      alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.000",
      border: { top: { color: { rgb: "FF065F46" } } },
    },
    data: { font: { sz: 10 }, alignment: { vertical: "center" }, border: { bottom: { color: { rgb: "FFF3F4F6" } } } },
    dataNum: {
      font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.000", border: { bottom: { color: { rgb: "FFF3F4F6" } } },
    },
    grandTotal: {
      font: { bold: true, sz: 12, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "left", vertical: "center" },
    },
    grandTotalNum: {
      font: { bold: true, sz: 12, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.000",
    },
    footer: { font: { italic: true, sz: 8, color: { rgb: "FF64748B" } }, alignment: { horizontal: "right" } },
  };

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

  const colXml = Array.from({ length: COL_COUNT }, (_, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="20" customWidth="1"/>`
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
  <sheets><sheet name="Sales Order" sheetId="1" r:id="rId1"/></sheets>
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

export const getSalesOrderReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadSalesOrderData(req, params);
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for this order." });
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderHtml(rows, params.loginid));
  } catch (error: any) {
    console.error("Sales Order Report HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getSalesOrderReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadSalesOrderData(req, params);
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for this order." });
      return;
    }
    const buffer = buildExcelBuffer(rows, params.loginid);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Sales_Order_Report.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("Sales Order Report Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};