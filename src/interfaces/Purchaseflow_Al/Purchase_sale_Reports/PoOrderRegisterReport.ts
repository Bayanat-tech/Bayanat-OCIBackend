

import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";

// ─── Types ────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

interface ReqParams {
  loginid:        string;
  company_code:   string;
  fromdate:       string; // "All" or "YYYY-MM-DD"
  todate:         string;
  ac_code:        string; // "All" or supplier code
  po_number:      string; // "All" or numeric doc_no
  prod_code_from: string; // "All" or code
  prod_code_to:   string; // "All" or code
  with_so_ref:    string; // "Y" | "N"
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
    loginid:        text(req.user?.loginid) || text(b.loginid) || "ADMIN",
    company_code:   text(b.company_code),
    fromdate:       text(b.fromdate) || "All",
    todate:         text(b.todate) || "All",
    ac_code:        text(b.ac_code) || "All",
    po_number:      text(b.po_number) || "All",
    prod_code_from: text(b.prod_code_from) || "All",
    prod_code_to:   text(b.prod_code_to) || "All",
    with_so_ref:    text(b.with_so_ref) === "Y" ? "Y" : "N",
  };
}

// ─── Data loader ────────────────────────────────────────────────────────────

async function loadPoOrderRegisterData(req: RequestWithUser, p: ReqParams): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const poNumberVal =
      !p.po_number || p.po_number.toUpperCase() === "ALL" ? 0 : Number(p.po_number) || 0;
    const withSoRefVal = p.with_so_ref === "Y" ? 1 : 0;

    const toDate = (iso: string): Date | null => {
      if (!iso || iso.toUpperCase() === "ALL") return null;
      const d = new Date(iso + "T00:00:00");
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const binds: any = {
      parameter: "PORPT_ALL_19082026",
      loginid: p.loginid,
      code1: p.company_code || null,
      code2: p.ac_code || null,
      code3: p.prod_code_from || null,
      code4: p.prod_code_to || null,
      number1: poNumberVal,
      number2: withSoRefVal,
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
         PROC_BUILD_DYNAMIC_SQL_PO_ORDER_REGISTER(
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

interface PoGroup {
  doc_no: string;
  doc_date: any;
  ac_name: string;
  cancelled: boolean;
  logo_url: string | null;
  rows: ReportRow[];
  qtyTotal: number;
}

function groupByPo(rows: ReportRow[]): { groups: PoGroup[]; grandQty: number; headerLogo: string | null } {
  const byDoc = new Map<string, PoGroup>();
  const order: string[] = [];

  for (const r of rows) {
    const key = text(r.doc_no);
    if (!byDoc.has(key)) {
      byDoc.set(key, {
        doc_no: key,
        doc_date: r.doc_date,
        ac_name: text(r.ac_name),
        cancelled: text(r.cancelled).toUpperCase() === "Y",
        logo_url: r.logo_url || null,
        rows: [],
        qtyTotal: 0,
      });
      order.push(key);
    }
    const g = byDoc.get(key)!;
    g.rows.push(r);
    g.qtyTotal += num(r.quantity);
  }

  const groups = order.map((k) => byDoc.get(k)!);
  const grandQty = groups.reduce((s, g) => s + g.qtyTotal, 0);
  const headerLogo = rows.length > 0 ? rows[0].logo_url || null : null;

  return { groups, grandQty, headerLogo };
}

// ─── HTML renderer (PR Register visual style) ──────────────────────────────

const REPORT_TITLE = "Purchase Orders";
const REPORT_SUBTITLE = "Order Register";

function renderHtml(rows: ReportRow[], loginId: string): string {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const { groups, grandQty, headerLogo } = groupByPo(rows);

  let bodyHtml = "";

  groups.forEach((g) => {
    bodyHtml += `
            <div class="group-container">
                <div class="group-header">
                    <div class="group-header-left">
                        <div>
                            <span class="group-label">Doc No. ${escapeHtml(g.doc_no)} &nbsp;&bull;&nbsp; Doc Date ${escapeHtml(dateText(g.doc_date))}</span>
                            <span class="group-name">${escapeHtml(g.ac_name)}</span>
                            ${g.cancelled ? `<div class="group-status"><span class="status-badge status-CANCELLED">Cancelled</span></div>` : ""}
                        </div>
                    </div>
                </div>
                <table class="report-table">
                    <thead>
                        <tr>
                            <th>Product</th>
                            <th>Required Date</th>
                            <th>Remarks</th>
                            <th class="right">P.O Qty</th>
                            <th>UOM</th>
                        </tr>
                    </thead>
                    <tbody>`;

    g.rows.forEach((r) => {
      bodyHtml += `
                        <tr>
                            <td>${escapeHtml(r.prod_code)} ${escapeHtml(r.prod_name)}</td>
                            <td>${escapeHtml(dateText(r.doc_date))}</td>
                            <td>${escapeHtml(r.remarks)}</td>
                            <td class="right amount">${qtyFmt(r.quantity)}</td>
                            <td>${escapeHtml(r.l_uom)}</td>
                        </tr>`;
    });

    bodyHtml += `
                        <tr class="subtotal-row">
                            <td colspan="3">Total Qty for ${escapeHtml(g.doc_no)}</td>
                            <td class="right">${qtyFmt(g.qtyTotal)}</td>
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
        .logo-img { max-height: 50px; max-width: 120px; object-fit: contain; }
        .report-title { font-size: 18px; font-weight: 700; color: #1e3a8a; letter-spacing: 1px; }
        .report-subtitle { font-size: 12px; color: #6b7280; font-weight: 400; letter-spacing: 0.5px; }
        .report-meta { text-align: right; font-size: 11px; color: #6b7280; line-height: 1.6; }
        .report-meta strong { color: #374151; }
        .group-container { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
        .group-header { display: flex; align-items: center; padding: 10px 16px; background: #f8fafc; border-bottom: 1px solid #e5e7eb; }
        .group-header-left { display: flex; align-items: center; gap: 12px; }
        .group-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; display: block; }
        .group-name { font-size: 14px; font-weight: 600; color: #111827; }
        .group-status { margin-top: 4px; }
        .report-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .report-table thead th {
            background: #f3f4f6; padding: 8px 14px; text-align: left; font-weight: 600; color: #374151;
            border-bottom: 2px solid #d1d5db; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
        }
        .report-table tbody td { padding: 7px 14px; border-bottom: 1px solid #f3f4f6; }
        .report-table tbody tr:hover td { background: #f8fafc; }
        .report-table .right { text-align: right; }
        .report-table .amount { font-weight: 500; color: #065f46; }
        .status-badge { padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 500; display: inline-block; }
        .status-CANCELLED { background: #fee2e2; color: #dc2626; }
        .subtotal-row td { background: #eef2f7; font-weight: 700; color: #1e3a8a; padding: 7px 14px; }
        .report-footer {
            display: flex; justify-content: space-between; align-items: center;
            padding-top: 14px; margin-top: 14px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280;
        }
        .grand-total-area { display: flex; align-items: center; gap: 12px; }
        .grand-total-label { font-size: 13px; font-weight: 600; color: #374151; }
        .grand-total-value { font-size: 18px; font-weight: 700; color: #065f46; }
        .empty-state { text-align: center; padding: 40px 20px; color: #6b7280; }
        .empty-state .icon { font-size: 40px; margin-bottom: 12px; }
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
                ${headerLogo ? `<img src="${escapeHtml(headerLogo)}" alt="Logo" class="logo-img" onerror="this.style.display='none'" />` : ""}
                <div>
                    <div class="report-title">${escapeHtml(REPORT_TITLE)}</div>
                    <div class="report-subtitle">${escapeHtml(REPORT_SUBTITLE)}</div>
                </div>
            </div>
            <div class="report-meta">
                <div><strong>Print Date:</strong> ${escapeHtml(printDateTime)}</div>
                <div><strong>Print User:</strong> ${escapeHtml(loginId)}</div>
            </div>
        </div>

        ${rows.length === 0 ? `
            <div class="empty-state">
                <div class="icon">\ud83d\udcc4</div>
                <div>No records found for the selected filters.</div>
            </div>
        ` : `
            ${bodyHtml}

            <div class="report-footer">
                <span>Report: rpt_po_order_register</span>
                <div class="grand-total-area">
                    <span class="grand-total-label">Grand Total Qty</span>
                    <span class="grand-total-value">${qtyFmt(grandQty)}</span>
                </div>
            </div>
        `}
    </div>
    <div style="text-align:center;padding:12px;font-size:11px;color:#9ca3af;">
        Powered by Bayanat Technology
    </div>
</body>
</html>`;
}

// ─── Excel builder (raw OOXML, PR-style styling engine) ───────────────────

function buildExcelBuffer(rows: ReportRow[], loginId: string): Buffer {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const BLUE = "FF1D4ED8";
  const WHITE = "FFFFFFFF";
  const LBLUE = "FFDBEAFE";
  const GREEN_BG = "FFD1FAE5";

  const { groups, grandQty } = groupByPo(rows);

  const COL_COUNT = 5; // Product, Required Date, Remarks, P.O Qty, UOM

  interface XlCell { v: unknown; styleKey: string }
  type Row = (XlCell | null)[];
  const rows_: Row[] = [];
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];

  const cell = (v: unknown, styleKey: string): XlCell => ({ v, styleKey });

  // ── Title ──
  rows_.push([cell(REPORT_TITLE + " - " + REPORT_SUBTITLE, "title"), null, null, null, null]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  // ── Meta ──
  rows_.push([cell(`Print Date: ${printDateTime}`, "meta"), null, cell(`Print User: ${loginId}`, "meta"), null, null]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } });
  merges.push({ s: { r: 1, c: 2 }, e: { r: 1, c: 4 } });

  rows_.push([null, null, null, null, null]);

  // ── Header ──
  rows_.push([
    cell("Product", "header"), cell("Required Date", "header"), cell("Remarks", "header"),
    cell("P.O Qty", "header"), cell("UOM", "header"),
  ]);

  // ── Data grouped by PO ──
  groups.forEach((g) => {
    const rIdx = rows_.length;
    rows_.push([
      cell(`Doc No. ${g.doc_no}   Doc Date ${dateText(g.doc_date)}${g.cancelled ? "   Cancelled" : ""}   Supplier: ${g.ac_name}`, "groupHeader"),
      null, null, null, null,
    ]);
    merges.push({ s: { r: rIdx, c: 0 }, e: { r: rIdx, c: COL_COUNT - 1 } });

    g.rows.forEach((r) => {
      rows_.push([
        cell(`${text(r.prod_code)} ${text(r.prod_name)}`, "data"),
        cell(dateText(r.doc_date), "data"),
        cell(text(r.remarks), "data"),
        cell(num(r.quantity), "dataNum"),
        cell(text(r.l_uom), "data"),
      ]);
    });

    const dtRow = rows_.length;
    rows_.push([cell(`Total Qty for ${g.doc_no}`, "groupTotal"), null, null, cell(g.qtyTotal, "groupTotalNum"), null]);
    merges.push({ s: { r: dtRow, c: 0 }, e: { r: dtRow, c: 2 } });

    rows_.push([null, null, null, null, null]);
  });

  // ── Grand total ──
  const gtRow = rows_.length;
  rows_.push([cell("Grand Total Qty", "grandTotal"), null, null, cell(grandQty, "grandTotalNum"), null]);
  merges.push({ s: { r: gtRow, c: 0 }, e: { r: gtRow, c: 2 } });

  // ── Footer ──
  rows_.push([null, null, null, null, cell("Powered by Bayanat Technology", "footer")]);

  // ── Style definitions ──
  const borderThin = (color: string) => ({ style: "thin", color: { rgb: color } });
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
      border: { top: borderThin(BLUE), bottom: borderThin(BLUE), left: borderThin(BLUE), right: borderThin(BLUE) },
    },
    groupHeader: {
      font: { bold: true, sz: 11, color: { rgb: "FF111827" } },
      fill: { fgColor: { rgb: LBLUE } },
      alignment: { horizontal: "left", vertical: "center" },
      border: { bottom: borderThin("FFE5E7EB") },
    },
    groupTotal: {
      font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
      fill: { fgColor: { rgb: GREEN_BG } },
      alignment: { horizontal: "left", vertical: "center" },
      border: { top: borderThin("FF065F46") },
    },
    groupTotalNum: {
      font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
      fill: { fgColor: { rgb: GREEN_BG } },
      alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.000",
      border: { top: borderThin("FF065F46") },
    },
    data: { font: { sz: 10 }, alignment: { vertical: "center" }, border: { bottom: borderThin("FFF3F4F6") } },
    dataNum: {
      font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.000", border: { bottom: borderThin("FFF3F4F6") },
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

  // ── Style registration engine ──
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

  // ── Sheet XML ──
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
  <sheets><sheet name="PO Order Register" sheetId="1" r:id="rId1"/></sheets>
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

export const getPoOrderRegisterReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadPoOrderRegisterData(req, params);
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderHtml(rows, params.loginid));
  } catch (error: any) {
    console.error("PO Order Register HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getPoOrderRegisterReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadPoOrderRegisterData(req, params);
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }
    const buffer = buildExcelBuffer(rows, params.loginid);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="PO_Order_Register_Report.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("PO Order Register Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};