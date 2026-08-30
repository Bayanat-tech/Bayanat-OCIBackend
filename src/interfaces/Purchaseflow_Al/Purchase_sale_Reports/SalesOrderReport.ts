import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";

// ─── Types ────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

interface ReqParams {
  loginid:      string;
  company_code: string;
  doc_type:     string;
  doc_no:       string;
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

function amtFmt(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Param extraction ───────────────────────────────────────────────────────

function extractParams(req: RequestWithUser): ReqParams {
  const b = req.body || {};
  return {
    loginid:      text(req.user?.loginid) || text(b.loginid) || "ADMIN",
    company_code: text(b.company_code),
    doc_type:     text(b.doc_type) || "SO",
    doc_no:       text(b.doc_no),
  };
}

// ─── Data loader ────────────────────────────────────────────────────────────

async function loadSalesOrderData(req: RequestWithUser, p: ReqParams): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const binds: any = {
      parameter: "PORPT_SO_19082026",
      loginid: p.loginid,
      code1: p.company_code || null,
      code2: p.doc_type || null,
      code3: p.doc_no || null,
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
  doc_no: string;
  doc_date: any;
  doc_type: string;
  div_name: string;
  ac_code: string;
  party_name: string;
  party_address: string;
  party_phone: string;
  party_fax: string;
  payment_terms: string;
  disc_hdr_price: number;
  disc_hdr_percent: number;
  cancelled: boolean;
  logo_url: string | null;
}

function buildHeader(rows: ReportRow[]): SoHeader {
  const h = rows[0] || {};
  return {
    doc_no: text(h.doc_no),
    doc_date: h.doc_date,
    doc_type: text(h.doc_type),
    div_name: text(h.div_name),
    ac_code: text(h.ac_code),
    party_name: text(h.party_name),
    party_address: text(h.party_address),
    party_phone: text(h.party_phone),
    party_fax: text(h.party_fax),
    payment_terms: text(h.payment_terms),
    disc_hdr_price: num(h.disc_hdr_price),
    disc_hdr_percent: num(h.disc_hdr_percent),
    cancelled: text(h.cancelled).toUpperCase() === "Y",
    logo_url: h.logo_url || null,
  };
}

function computeTotals(rows: ReportRow[], header: SoHeader) {
  const totalQty = rows.reduce((s, r) => s + num(r.quantity), 0);
  const totalAmount = rows.reduce((s, r) => s + num(r.amount), 0);
  const discount = header.disc_hdr_price || (totalAmount * header.disc_hdr_percent) / 100;
  const exclusiveVat = totalAmount - discount;
  // NOTE: vw_erp_salesorder has no VAT column — wire real values once confirmed.
  const vatAmount = 0;
  const inclusiveVat = exclusiveVat + vatAmount;
  return { totalQty, totalAmount, discount, exclusiveVat, vatAmount, inclusiveVat };
}

// ─── HTML renderer (same visual system as Purchase Order report) ──────────

const REPORT_TITLE = "Sales Order";
const REPORT_SUBTITLE = "SO Document";

function renderHtml(rows: ReportRow[], loginId: string): string {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const header = buildHeader(rows);
  const totals = computeTotals(rows, header);

  let bodyRows = "";
  rows.forEach((r, i) => {
    bodyRows += `
                        <tr>
                            <td>${i + 1}</td>
                            <td>${escapeHtml(r.prod_code)} ${escapeHtml(r.prod_name)}${r.det_remarks ? ` — ${escapeHtml(r.det_remarks)}` : ""}</td>
                            <td>${escapeHtml(r.p_uom)}</td>
                            <td class="right">${qtyFmt(r.quantity)}</td>
                            <td class="right">${amtFmt(r.unit_price)}</td>
                            <td class="right amount">${amtFmt(r.amount)}</td>
                        </tr>`;
  });

  return `<!doctype html>
<html>
<head>
    <meta charset="utf-8"/>
    <title>${escapeHtml(REPORT_TITLE)} ${escapeHtml(header.doc_no)}</title>
    <style>
        @media print {
            @page { size: A4 portrait; margin: 8mm; }
            .no-print { display: none !important; }
            .report-container { box-shadow: none !important; border: none !important; }
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
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 32px; margin-bottom: 18px; }
        .info-block { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; background: #f8fafc; }
        .info-block .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; margin-bottom: 6px; }
        .info-block .value-line { font-size: 12px; color: #111827; line-height: 1.6; }
        .status-badge { padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 500; display: inline-block; }
        .status-CANCELLED { background: #fee2e2; color: #dc2626; }
        .report-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
        .report-table thead th {
            background: #f3f4f6; padding: 8px 14px; text-align: left; font-weight: 600; color: #374151;
            border-bottom: 2px solid #d1d5db; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
        }
        .report-table tbody td { padding: 7px 14px; border-bottom: 1px solid #f3f4f6; }
        .report-table .right { text-align: right; }
        .report-table .amount { font-weight: 500; color: #065f46; }
        .totals-box { margin-top: 16px; margin-left: auto; width: 320px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
        .totals-box .row { display: flex; justify-content: space-between; padding: 6px 14px; font-size: 12px; border-bottom: 1px solid #f3f4f6; }
        .totals-box .row.grand { background: #1d4ed8; color: #fff; font-weight: 700; font-size: 13px; border-bottom: none; }
        .report-footer {
            display: flex; justify-content: space-between; align-items: center;
            padding-top: 14px; margin-top: 14px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280;
        }
        @media print {
            .report-header { border-bottom-color: #000; }
            .report-table thead th { background: #e5e7eb !important; }
            .report-container { border-radius: 0; padding: 10mm; }
        }
    </style>
</head>
<body>
    <div class="report-container">
        <div class="report-header">
            <div class="report-title-area">
                ${header.logo_url ? `<img src="${escapeHtml(header.logo_url)}" alt="Logo" class="logo-img" onerror="this.style.display='none'" />` : ""}
                <div>
                    <div class="report-title">${escapeHtml(REPORT_TITLE)}</div>
                    <div class="report-subtitle">${escapeHtml(REPORT_SUBTITLE)} — ${escapeHtml(header.div_name)}</div>
                    ${header.cancelled ? `<div><span class="status-badge status-CANCELLED">Cancelled</span></div>` : ""}
                </div>
            </div>
            <div class="report-meta">
                <div><strong>Print Date:</strong> ${escapeHtml(printDateTime)}</div>
                <div><strong>Print User:</strong> ${escapeHtml(loginId)}</div>
            </div>
        </div>

        <div class="info-grid">
            <div class="info-block">
                <div class="label">Customer</div>
                <div class="value-line"><strong>${escapeHtml(header.party_name)}</strong></div>
                <div class="value-line">${escapeHtml(header.party_address)}</div>
                <div class="value-line">Tel: ${escapeHtml(header.party_phone)}</div>
                <div class="value-line">Fax: ${escapeHtml(header.party_fax)}</div>
            </div>
            <div class="info-block">
                <div class="label">SO Details</div>
                <div class="value-line">Doc No: <strong>${escapeHtml(header.doc_no)}</strong></div>
                <div class="value-line">Date: ${escapeHtml(dateText(header.doc_date))}</div>
                <div class="value-line">A/C Code: ${escapeHtml(header.ac_code)}</div>
                <div class="value-line">Payment Term: ${escapeHtml(header.payment_terms)}</div>
            </div>
        </div>

        ${rows.length === 0 ? `
            <div style="text-align:center;padding:40px 20px;color:#6b7280;">No line items found for this order.</div>
        ` : `
            <table class="report-table">
                <thead>
                    <tr>
                        <th>S.No.</th>
                        <th>Product / Description</th>
                        <th>Unit</th>
                        <th class="right">Qty</th>
                        <th class="right">Unit Rate</th>
                        <th class="right">Amount</th>
                    </tr>
                </thead>
                <tbody>${bodyRows}</tbody>
            </table>

            <div class="totals-box">
                <div class="row"><span>Total Quantity</span><span>${qtyFmt(totals.totalQty)}</span></div>
                <div class="row"><span>Total Amount</span><span>${amtFmt(totals.totalAmount)}</span></div>
                <div class="row"><span>Discount</span><span>${amtFmt(totals.discount)}</span></div>
                <div class="row grand"><span>Net Amount</span><span>${amtFmt(totals.inclusiveVat)}</span></div>
            </div>
        `}

        <div class="report-footer">
            <span>Report: rpt_sales_order</span>
        </div>
    </div>
    <div style="text-align:center;padding:12px;font-size:11px;color:#9ca3af;">
        Powered by Bayanat Technology
    </div>
</body>
</html>`;
}

// ─── Excel builder ───────────────────────────────────────────────────────

function buildExcelBuffer(rows: ReportRow[], loginId: string): Buffer {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const BLUE = "FF1D4ED8";
  const WHITE = "FFFFFFFF";
  const GREEN_BG = "FFD1FAE5";

  const header = buildHeader(rows);
  const totals = computeTotals(rows, header);

  const COL_COUNT = 6;

  interface XlCell { v: unknown; styleKey: string }
  type Row = (XlCell | null)[];
  const rows_: Row[] = [];
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];

  const cell = (v: unknown, styleKey: string): XlCell => ({ v, styleKey });

  rows_.push([cell(`${REPORT_TITLE} - ${header.doc_no}`, "title"), null, null, null, null, null]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  rows_.push([cell(`Print Date: ${printDateTime}`, "meta"), null, null, cell(`Print User: ${loginId}`, "meta"), null, null]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 2 } });
  merges.push({ s: { r: 1, c: 3 }, e: { r: 1, c: 5 } });

  rows_.push([
    cell(`Customer: ${header.party_name}, ${header.party_address}`, "meta"), null, null,
    cell(`Date: ${dateText(header.doc_date)}   A/C: ${header.ac_code}`, "meta"), null, null,
  ]);
  merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: 2 } });
  merges.push({ s: { r: 2, c: 3 }, e: { r: 2, c: 5 } });

  rows_.push([null, null, null, null, null, null]);

  rows_.push([
    cell("S.No", "header"), cell("Product / Description", "header"), cell("Unit", "header"),
    cell("Qty", "header"), cell("Unit Rate", "header"), cell("Amount", "header"),
  ]);

  rows.forEach((r, i) => {
    rows_.push([
      cell(i + 1, "data"),
      cell(`${text(r.prod_code)} ${text(r.prod_name)}`, "data"),
      cell(text(r.p_uom), "data"),
      cell(num(r.quantity), "dataNum"),
      cell(num(r.unit_price), "dataNum"),
      cell(num(r.amount), "dataNum"),
    ]);
  });

  rows_.push([null, null, null, null, null, null]);

  const totalRows: [string, number][] = [
    ["Total Quantity", totals.totalQty],
    ["Total Amount", totals.totalAmount],
    ["Discount", totals.discount],
  ];
  totalRows.forEach(([label, value]) => {
    const r = rows_.length;
    rows_.push([cell(label, "groupTotal"), null, null, null, cell(value, "groupTotalNum"), null]);
    merges.push({ s: { r, c: 0 }, e: { r, c: 3 } });
  });

  const gtRow = rows_.length;
  rows_.push([cell("Net Amount", "grandTotal"), null, null, null, cell(totals.inclusiveVat, "grandTotalNum"), null]);
  merges.push({ s: { r: gtRow, c: 0 }, e: { r: gtRow, c: 3 } });

  rows_.push([null, null, null, null, null, cell("Powered by Bayanat Technology", "footer")]);

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
    data: { font: { sz: 10 }, alignment: { vertical: "center" }, border: { bottom: { color: { rgb: "FFF3F4F6" } } } },
    dataNum: {
      font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.00", border: { bottom: { color: { rgb: "FFF3F4F6" } } },
    },
    groupTotal: {
      font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
      fill: { fgColor: { rgb: GREEN_BG } },
      alignment: { horizontal: "left", vertical: "center" },
    },
    groupTotalNum: {
      font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
      fill: { fgColor: { rgb: GREEN_BG } },
      alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.00",
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
      numFmt: "#,##0.00",
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
    `<col min="${i + 1}" max="${i + 1}" width="18" customWidth="1"/>`
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