import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../interfaces/common.interface";
import { buildReportDocument, reportFooter, reportHeader } from "../common/report_common";

// ─── Types ────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

interface ReqParams {
  loginid:        string;
  company_code:   string;
  request_number: string;
}

// Single dispatch key handled by PROC_BUILD_DYNAMIC_SQL_ALMS_REPORTS (one CASE branch)
const PARAM_FORM = "PR_REGISTER_FORM";

const REPORT_TITLE = "PURCHASE REQUEST";
const REPORT_NAME  = "rpt_purchase_request_form";

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
  if (!value) return "";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value).substring(0, 10);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function dateTimeText(value: unknown): string {
  if (!value) return "";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d
    .toLocaleString("en-GB", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    })
    .replace(", ", " ");
}

function escapeHtml(value: unknown): string {
  return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeXml(value: unknown): string {
  return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function fmt(value: unknown, decimals: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return (0).toFixed(decimals);
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const amtFmt  = (v: unknown) => fmt(v, 3);
const rateFmt = (v: unknown) => fmt(v, 4);
const pctFmt  = (v: unknown) => fmt(v, 2);

function qtyFmt(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return n.toLocaleString("en-US");
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

// ─── Param extraction ───────────────────────────────────────────────────────

function extractParams(req: RequestWithUser): ReqParams {
  const b = req.body || {};
  return {
    loginid:        text(req.user?.loginid) || text(b.loginid) || "ADMIN",
    company_code:   text(b.company_code),
    request_number: text(b.request_number).trim(),
  };
}

// ─── Data loader ────────────────────────────────────────────────────────────

/** Builds the SQL through the procedure, runs it and returns normalized rows. */
async function runProcSql(conn: oracledb.Connection, dispatchParam: string, p: ReqParams): Promise<ReportRow[]> {
  const binds: any = {
    parameter: dispatchParam,
    loginid: p.loginid,
    code1: p.company_code || null,
    code2: null,
    code3: p.request_number || null, // request number
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

  // PROC_BUILD_DYNAMIC_SQL_ALMS_REPORTS returns a CLOB
  const result = await conn.execute(
    `DECLARE
       v_sql CLOB;
     BEGIN
       PROC_BUILD_DYNAMIC_SQL_ALMS_REPORTS(
         :parameter, :loginid,
         :code1,  :code2,  :code3,  :code4,
         :number1, :number2, :number3, :number4,
         :date1,   :date2,   :date3,   :date4,
         v_sql
       );
       :out_sql := DBMS_LOB.SUBSTR(v_sql, 32767, 1);
     END;`,
    binds
  );

  const rawSql = (result.outBinds as any).out_sql;
  if (!rawSql) throw new Error(`Procedure did not return SQL for ${dispatchParam}.`);

  console.log(`=== GENERATED SQL (${dispatchParam}) ===\n`, rawSql, "\n=== END ===");

  const dataResult = await conn.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
  const rows = normalize(dataResult.rows as any[]);

  // The procedure returns "SELECT 'Error ...' AS ERROR_MESSAGE FROM DUAL" when it fails
  if (rows.length === 1 && Object.keys(rows[0]).length === 1 && "error_message" in rows[0]) {
    throw new Error(text(rows[0].error_message));
  }
  return rows;
}

interface FormData {
  header: ReportRow | null;
  items: ReportRow[];
  history: ReportRow[];
}

async function loadFormData(req: RequestWithUser, p: ReqParams): Promise<FormData> {
  const conn = await getConn(req);
  try {
    // One query: item rows from VW_PURCHASE_DETAILS_TXN, each row also carries the
    // header columns (Created By, Flow, Description, Remarks, Division ...) from
    // VW_PURCHASE_REQUEST_SUMMARY.
    const items = await runProcSql(conn, PARAM_FORM, p);

    const f = items[0];
    const header: ReportRow | null = f
      ? {
          request_number: f.request_number,
          request_date: f.request_date,
          create_user: f.create_user,
          flow_code: f.flow_code,
          description: f.description,
          remarks: f.remarks,
          amount: f.hdr_amount,
          req_div_code: f.req_div_code,
          currency_rate: f.currency_rate,
          currency_code: f.curr_code,
          tx_cat_code: f.tx_cat_code,
          tx_compntcat_code_1: f.tx_compntcat_code_1,
          final_approved: f.hdr_final_approved ?? f.final_approved,
          last_action: f.hdr_last_action ?? f.last_action,
        }
      : null;

    // Approval history needs its own table/query, so it is not part of the single-case form yet.
    return { header, items, history: [] };
  } finally {
    await closeConn(conn);
  }
}

// ─── HTML renderer (inline styles, same approach as PO Order Register) ────

const PR_FORM_EXTRA_CSS = `
  @page {
    size: A4 landscape;
    margin: 8mm;
  }
`;

const S = {
  wrap:   "font-size:9.5px;line-height:1.3;color:#1e293b;",
  title:  "margin:0 0 8px 0;padding:0;font-size:16px;font-weight:800;color:#0b4ca1;text-align:center;letter-spacing:.5px;",
  lbl:    "padding:3px 6px 3px 0;font-weight:700;font-size:9.5px;vertical-align:top;white-space:nowrap;width:34%;",
  val:    "padding:3px 0;font-size:9.5px;vertical-align:top;word-break:break-word;",
  valBig: "padding:3px 0;font-size:13px;font-weight:800;vertical-align:top;color:#0b3d91;",
  th:     "background:#dce6f4 !important;color:#0b3d91 !important;font-weight:700;font-size:8.5px;padding:4px 3px;text-align:center;border:1px solid #9fb6d6;word-break:break-word;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
  td:     "padding:4px 3px;border-bottom:1px solid #e2e8f0;vertical-align:top;font-size:9px;word-break:break-word;overflow-wrap:anywhere;",
  tdR:    "padding:4px 3px;border-bottom:1px solid #e2e8f0;vertical-align:top;font-size:9px;text-align:right;word-break:break-word;",
  tdC:    "padding:4px 3px;border-bottom:1px solid #e2e8f0;vertical-align:top;font-size:9px;text-align:center;",
  sub:    "display:block;font-size:8px;color:#64748b;",
  total:  "background:#cfe0f5 !important;color:#0b3d91 !important;font-weight:700;padding:6px 3px;border-top:2px solid #0b4ca1;font-size:10px;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
  totalR: "background:#cfe0f5 !important;color:#0b3d91 !important;font-weight:700;padding:6px 3px;border-top:2px solid #0b4ca1;font-size:10px;text-align:right;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
  histBox:"margin-top:14px;border:1px solid #334155;padding:10px 16px;",
  badge:  "display:inline-block;min-width:160px;background:#000000 !important;color:#ffffff !important;font-weight:700;font-size:10px;text-align:center;padding:3px 10px;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
};

function kv(label: string, value: unknown, big = false): string {
  return `
    <tr>
      <td style="${S.lbl}">${escapeHtml(label)} :</td>
      <td style="${big ? S.valBig : S.val}">${escapeHtml(value)}</td>
    </tr>`;
}

function renderFormBody(data: FormData, requestNumber: string): string {
  const { header, items, history } = data;

  // Header falls back to the first item row if the header query returned nothing
  const first = items[0] ?? {};
  const h: ReportRow = header ?? {};
  const reqNo = text(h.request_number) || text(first.request_number) || requestNumber;
  const reqDate = h.request_date ?? first.request_date;

  const leftHtml = [
    kv("Purchase Request Number", reqNo, true),
    kv("Created By", h.create_user ?? first.user_id),
    kv("Flow", h.flow_code),
    kv("Description", h.description),
    kv("Remarks", h.remarks),
    kv("Amount", amtFmt(h.amount ?? items.reduce((s, r) => s + num(r.amount), 0))),
    kv("Division", h.req_div_code),
  ].join("");

  const rightHtml = [
    kv("Currency Rate", rateFmt(h.currency_rate ?? first.currency_rate)),
    kv("Currency", h.currency_code ?? first.curr_code),
    kv("Tax Category", h.tx_cat_code ?? first.tx_cat_code),
    kv("Tax Code", h.tx_cat_code ?? first.tx_cat_code),
    kv("Tax Type", h.tx_compntcat_code_1 ?? first.tx_compntcat_code_1),
    kv("Final Approval", text(h.final_approved ?? first.final_approved).toUpperCase() === "Y" ? "YES" : "NO"),
    kv("Request Date", dateText(reqDate)),
    kv("Last Action", h.last_action ?? first.last_action ?? first.purch_status),
  ].join("");

  // ── Item lines ──
  let totAmount = 0, totBase = 0, totTax = 0, totLine = 0;

  const lines = items
    .map((r) => {
      const amount = num(r.amount);
      const base = num(r.lcurr_amt);
      // In the entry form DISCOUNT_AMOUNT is a PERCENTAGE. Discount amount = rate x qty x % / 100,
      // using the approved qty once it exists (same rule as the form).
      const effQty = num(r.allocated_approved_quantity) > 0 ? num(r.allocated_approved_quantity) : num(r.item_qty);
      const discAmt = (num(r.item_rate) * effQty * num(r.discount_amount)) / 100;
      const tax = num(r.tx_compnt_amt_1);
      const lineTotal = amount + tax;
      totAmount += amount; totBase += base; totTax += tax; totLine += lineTotal;

      return `
      <tr>
        <td style="${S.tdC}">${escapeHtml(r.sr_no)}</td>
        <td style="${S.td}">${escapeHtml(r.item_code)}<span style="${S.sub}">${escapeHtml(r.item_desp)}</span></td>
        <td style="${S.td}">${escapeHtml(r.supplier_part_code)}<span style="${S.sub}">${escapeHtml(r.supplier_name || r.supplier)}</span></td>
        <td style="${S.tdR}">${qtyFmt(r.item_qty)}</td>
        <td style="${S.tdR}">${amtFmt(r.item_rate)}</td>
        <td style="${S.tdR}">${amtFmt(discAmt)}<span style="${S.sub}">${pctFmt(r.discount_amount)} %</span></td>
        <td style="${S.tdR}">${amtFmt(r.final_rate)}</td>
        <td style="${S.tdC}">${escapeHtml(r.curr_code)}</td>
        <td style="${S.tdR}">${rateFmt(r.currency_rate)}</td>
        <td style="${S.tdR}">${amtFmt(amount)}</td>
        <td style="${S.tdR}">${amtFmt(base)}</td>
        <td style="${S.td}">${escapeHtml(r.tx_compntcat_code_1)}<span style="${S.sub}">${escapeHtml(r.tx_cat_code)}</span></td>
        <td style="${S.tdR}">${pctFmt(r.tx_compnt_perc_1)}</td>
        <td style="${S.tdR}">${amtFmt(tax)}</td>
        <td style="${S.tdR}">${qtyFmt(r.allocated_approved_quantity)}</td>
        <td style="${S.tdR}">${amtFmt(lineTotal)}</td>
      </tr>`;
    })
    .join("");

  const itemsHtml = items.length === 0
    ? `<div style="padding:28px;font-size:11px;text-align:center;color:#64748b;">No items found for this request.</div>`
    : `
    <table style="margin-top:10px;border-collapse:collapse;width:100%;table-layout:fixed;">
      <colgroup>
        <col style="width:4%"/><col style="width:13%"/><col style="width:8%"/><col style="width:6%"/>
        <col style="width:6%"/><col style="width:6%"/><col style="width:6%"/><col style="width:5%"/>
        <col style="width:5%"/><col style="width:7%"/><col style="width:7%"/><col style="width:6%"/>
        <col style="width:4%"/><col style="width:5%"/><col style="width:5%"/><col style="width:7%"/>
      </colgroup>
      <thead>
        <tr>
          <th style="${S.th}">Sr. No.</th>
          <th style="${S.th}">Item Code</th>
          <th style="${S.th}">Supplier Part Code</th>
          <th style="${S.th}">Request Qty</th>
          <th style="${S.th}">Item Rate</th>
          <th style="${S.th}">Discount Amt</th>
          <th style="${S.th}">Final Rate</th>
          <th style="${S.th}">Currency</th>
          <th style="${S.th}">Ex Rate</th>
          <th style="${S.th}">Amount</th>
          <th style="${S.th}">Base Amount</th>
          <th style="${S.th}">Tax Code</th>
          <th style="${S.th}">TAX %</th>
          <th style="${S.th}">Tax Amt</th>
          <th style="${S.th}">Approved Qty</th>
          <th style="${S.th}">Total Amt</th>
        </tr>
      </thead>
      <tbody>
        ${lines}
        <tr>
          <td colspan="9" style="${S.total}">Total Amount</td>
          <td style="${S.totalR}">${amtFmt(totAmount)}</td>
          <td style="${S.totalR}">${amtFmt(totBase)}</td>
          <td colspan="2" style="${S.total}"></td>
          <td style="${S.totalR}">${amtFmt(totTax)}</td>
          <td style="${S.total}"></td>
          <td style="${S.totalR}">${amtFmt(totLine)}</td>
        </tr>
      </tbody>
    </table>`;

  // ── Approval history box ──
  const historyHtml = history.length === 0
    ? ""
    : `
    <div style="${S.histBox}">
      <div style="font-size:12px;font-weight:700;margin-bottom:8px;">Request Number: &nbsp;${escapeHtml(reqNo)}</div>
      ${history
        .map(
          (r) => `
        <div style="margin:8px 0 2px 0;text-align:center;"><span style="${S.badge}">${escapeHtml(r.action_status)}</span></div>
        <table style="border-collapse:collapse;margin-bottom:4px;">
          <tr><td style="padding:2px 14px 2px 0;font-size:10px;">Last Updated :</td><td style="padding:2px 0;font-size:10px;">${escapeHtml(r.last_updated_by)}</td></tr>
          <tr><td style="padding:2px 14px 2px 0;font-size:10px;">Last Updated Dt :</td><td style="padding:2px 0;font-size:10px;">${escapeHtml(dateTimeText(r.last_updated_dt))}</td></tr>
        </table>`
        )
        .join("")}
    </div>`;

  return `
  <div class="pr-form" style="${S.wrap}">
    <h1 style="${S.title}">${escapeHtml(REPORT_TITLE)}</h1>

    <table style="width:100%;border-collapse:collapse;border-top:1px solid #334155;border-bottom:1px solid #334155;table-layout:fixed;">
      <tr>
        <td style="width:55%;vertical-align:top;padding:6px 10px 6px 0;">
          <table style="width:100%;border-collapse:collapse;">${leftHtml}</table>
        </td>
        <td style="width:45%;vertical-align:top;padding:6px 0 6px 10px;">
          <table style="width:100%;border-collapse:collapse;">${rightHtml}</table>
        </td>
      </tr>
    </table>

    ${itemsHtml}
    ${historyHtml}
  </div>`;
}

// ─── Excel engine (raw OOXML) – shared by Summary and Details ─────────────

const XL_BLUE = "FF1D4ED8";
const XL_WHITE = "FFFFFFFF";
const XL_HEADER_BLUE = "FF1E3A8A";
const XL_GREEN_BG = "FFD1FAE5";

interface XlCell { v: unknown; styleKey: string }
type XlRow = (XlCell | null)[];
interface XlMerge { s: { r: number; c: number }; e: { r: number; c: number } }

const xlCell = (v: unknown, styleKey: string): XlCell => ({ v, styleKey });

const xlBorderThin = (color: string) => ({ style: "thin", color: { rgb: color } });

const XL_STYLE_DEFS: Record<string, any> = {
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
    border: { top: xlBorderThin(XL_BLUE), bottom: xlBorderThin(XL_BLUE), left: xlBorderThin(XL_BLUE), right: xlBorderThin(XL_BLUE) },
  },
  groupHeader: {
    font: { bold: true, sz: 11, color: { rgb: XL_WHITE } },
    fill: { fgColor: { rgb: XL_HEADER_BLUE } },
    alignment: { horizontal: "left", vertical: "center" },
  },
  groupTotal: {
    font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
    fill: { fgColor: { rgb: XL_GREEN_BG } },
    alignment: { horizontal: "left", vertical: "center" },
    border: { top: xlBorderThin("FF065F46") },
  },
  groupTotalNum: {
    font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
    fill: { fgColor: { rgb: XL_GREEN_BG } },
    alignment: { horizontal: "right", vertical: "center" },
    numFmt: "#,##0.000",
    border: { top: xlBorderThin("FF065F46") },
  },
  data: { font: { sz: 10 }, alignment: { vertical: "center" }, border: { bottom: xlBorderThin("FFF3F4F6") } },
  dataNum2: {
    font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
    numFmt: "#,##0.00", border: { bottom: xlBorderThin("FFF3F4F6") },
  },
  dataNum3: {
    font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
    numFmt: "#,##0.000", border: { bottom: xlBorderThin("FFF3F4F6") },
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

function buildXlsx(opts: {
  rows: XlRow[];
  merges: XlMerge[];
  colCount: number;
  colWidth: number;
  colWidths?: number[];
  sheetName: string;
}): Buffer {
  const { rows: rows_, merges, colCount, colWidth, colWidths, sheetName } = opts;
  const styleDefs = XL_STYLE_DEFS;

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
  const colXml = Array.from({ length: colCount }, (_, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${colWidths?.[i] ?? colWidth}" customWidth="1"/>`
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


// Extra styles used by the Purchase Request Form sheet
XL_STYLE_DEFS.kvLabel = {
  font: { bold: true, sz: 10 },
  alignment: { horizontal: "left", vertical: "center" },
};
XL_STYLE_DEFS.kvValue = {
  font: { sz: 10 },
  alignment: { horizontal: "left", vertical: "center", wrapText: true },
  border: { bottom: xlBorderThin("FFE2E8F0") },
};
XL_STYLE_DEFS.kvValueBig = {
  font: { bold: true, sz: 12, color: { rgb: "FF0B3D91" } },
  alignment: { horizontal: "left", vertical: "center" },
  border: { bottom: xlBorderThin("FFE2E8F0") },
};
XL_STYLE_DEFS.dataNum4 = {
  font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
  numFmt: "#,##0.0000", border: { bottom: xlBorderThin("FFF3F4F6") },
};
XL_STYLE_DEFS.dataCenter = {
  font: { sz: 10 }, alignment: { horizontal: "center", vertical: "center" },
  border: { bottom: xlBorderThin("FFF3F4F6") },
};

// ─── Excel: Purchase Request Form ───────────────────────────────────────────

function formHeaderPairs(data: FormData, requestNumber: string): { left: [string, string][]; right: [string, string][] } {
  const { header, items } = data;
  const first = items[0] ?? {};
  const h: ReportRow = header ?? {};
  const reqNo = text(h.request_number) || text(first.request_number) || requestNumber;
  const reqDate = h.request_date ?? first.request_date;

  const left: [string, string][] = [
    ["Purchase Request Number", reqNo],
    ["Created By", text(h.create_user ?? first.user_id)],
    ["Flow", text(h.flow_code)],
    ["Description", text(h.description)],
    ["Remarks", text(h.remarks)],
    ["Amount", amtFmt(h.amount ?? items.reduce((s, r) => s + num(r.amount), 0))],
    ["Division", text(h.req_div_code)],
  ];
  const right: [string, string][] = [
    ["Currency Rate", rateFmt(h.currency_rate ?? first.currency_rate)],
    ["Currency", text(h.currency_code ?? first.curr_code)],
    ["Tax Category", text(h.tx_cat_code ?? first.tx_cat_code)],
    ["Tax Code", text(h.tx_cat_code ?? first.tx_cat_code)],
    ["Tax Type", text(h.tx_compntcat_code_1 ?? first.tx_compntcat_code_1)],
    ["Final Approval", text(h.final_approved ?? first.final_approved).toUpperCase() === "Y" ? "YES" : "NO"],
    ["Request Date", dateText(reqDate)],
    ["Last Action", text(h.last_action ?? first.last_action ?? first.purch_status)],
  ];
  return { left, right };
}

function buildFormExcelBuffer(data: FormData, requestNumber: string, loginId: string): Buffer {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const COL_COUNT = 20;
  // Sr, Code, Description, Supp Part, Supplier, Req Qty, Rate, Disc %, Disc Amt, Final Rate,
  // Currency, Ex Rate, Amount, Base Amt, Tax Cat, Tax Code, Tax %, Tax Amt, Appr Qty, Total Amt
  const colWidths = [7, 18, 34, 18, 28, 12, 12, 9, 12, 12, 10, 10, 14, 14, 10, 12, 8, 12, 12, 14];

  const blanks = (n: number): null[] => new Array(n).fill(null);
  const emptyRow = (): XlRow => blanks(COL_COUNT);
  const rows_: XlRow[] = [];
  const merges: XlMerge[] = [];
  const mergeRow = (r: number, c1: number, c2: number) => merges.push({ s: { r, c: c1 }, e: { r, c: c2 } });

  // Title
  let r0 = rows_.length;
  const titleRow = emptyRow(); titleRow[0] = xlCell(REPORT_TITLE, "title");
  rows_.push(titleRow); mergeRow(r0, 0, COL_COUNT - 1);

  // Meta
  r0 = rows_.length;
  const metaRow = emptyRow();
  metaRow[0] = xlCell(`Date: ${printDateTime}`, "meta");
  metaRow[3] = xlCell(`User: ${loginId}`, "meta");
  metaRow[8] = xlCell(`Report: ${REPORT_NAME}`, "meta");
  rows_.push(metaRow);
  mergeRow(r0, 0, 2); mergeRow(r0, 3, 7); mergeRow(r0, 8, 15);

  rows_.push(emptyRow());

  // Header block: left pairs (label A:B, value C:G), right pairs (label I:K, value L:O)
  const { left, right } = formHeaderPairs(data, requestNumber);
  const blockRows = Math.max(left.length, right.length);
  for (let i = 0; i < blockRows; i++) {
    const rr = rows_.length;
    const row = emptyRow();
    if (left[i]) {
      row[0] = xlCell(`${left[i][0]} :`, "kvLabel");
      row[2] = xlCell(left[i][1], i === 0 ? "kvValueBig" : "kvValue");
      mergeRow(rr, 0, 1); mergeRow(rr, 2, 6);
    }
    if (right[i]) {
      row[8] = xlCell(`${right[i][0]} :`, "kvLabel");
      row[11] = xlCell(right[i][1], "kvValue");
      mergeRow(rr, 8, 10); mergeRow(rr, 11, 14);
    }
    rows_.push(row);
  }

  rows_.push(emptyRow());

  // Items header
  const heads = [
    "Sr. No.", "Item Code", "Item Description", "Supplier Part Code", "Supplier",
    "Request Qty", "Item Rate", "Disc %", "Discount Amt", "Final Rate",
    "Currency", "Ex Rate", "Amount", "Base Amount", "Tax Category",
    "Tax Code", "TAX %", "Tax Amt", "Approved Qty", "Total Amt",
  ];
  rows_.push(heads.map((t) => xlCell(t, "header")));

  // Item lines
  let totAmount = 0, totBase = 0, totTax = 0, totLine = 0;
  data.items.forEach((r) => {
    const amount = num(r.amount);
    const base = num(r.lcurr_amt);
    const tax = num(r.tx_compnt_amt_1);
    const lineTotal = amount + tax;
    const effQty = num(r.allocated_approved_quantity) > 0 ? num(r.allocated_approved_quantity) : num(r.item_qty);
    const discAmt = (num(r.item_rate) * effQty * num(r.discount_amount)) / 100;
    totAmount += amount; totBase += base; totTax += tax; totLine += lineTotal;

    rows_.push([
      xlCell(text(r.sr_no), "dataCenter"),
      xlCell(text(r.item_code), "data"),
      xlCell(text(r.item_desp), "data"),
      xlCell(text(r.supplier_part_code), "data"),
      xlCell(text(r.supplier_name || r.supplier), "data"),
      xlCell(num(r.item_qty), "dataNum3"),
      xlCell(num(r.item_rate), "dataNum3"),
      xlCell(num(r.discount_amount), "dataNum2"),
      xlCell(discAmt, "dataNum3"),
      xlCell(num(r.final_rate), "dataNum3"),
      xlCell(text(r.curr_code), "dataCenter"),
      xlCell(num(r.currency_rate), "dataNum4"),
      xlCell(amount, "dataNum3"),
      xlCell(base, "dataNum3"),
      xlCell(text(r.tx_cat_code), "data"),
      xlCell(text(r.tx_compntcat_code_1), "data"),
      xlCell(num(r.tx_compnt_perc_1), "dataNum2"),
      xlCell(tax, "dataNum3"),
      xlCell(num(r.allocated_approved_quantity), "dataNum3"),
      xlCell(lineTotal, "dataNum3"),
    ]);
  });

  // Total row
  const tr = rows_.length;
  const totalRow: XlRow = emptyRow();
  for (let c = 0; c < COL_COUNT; c++) totalRow[c] = xlCell("", "grandTotal");
  totalRow[0] = xlCell("Total Amount", "grandTotal");
  totalRow[12] = xlCell(totAmount, "grandTotalNum");
  totalRow[13] = xlCell(totBase, "grandTotalNum");
  totalRow[17] = xlCell(totTax, "grandTotalNum");
  totalRow[19] = xlCell(totLine, "grandTotalNum");
  rows_.push(totalRow);
  mergeRow(tr, 0, 11);

  // Footer
  const foot = emptyRow(); foot[COL_COUNT - 1] = xlCell("Powered by Bayanat Technology", "footer");
  rows_.push(foot);

  return buildXlsx({ rows: rows_, merges, colCount: COL_COUNT, colWidth: 14, colWidths, sheetName: "Purchase Request" });
}

// ─── Route handler ──────────────────────────────────────────────────────────

export const getPrRegisterFormReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    if (!params.request_number) {
      res.status(400).json({ success: false, message: "Request number is required." });
      return;
    }

    const data = await loadFormData(req, params);
    if (!data.items.length && !data.header) {
      res.status(200).json({ success: false, message: "No data found for the selected request." });
      return;
    }

    const companyCode =
      params.company_code ||
      text(req.user?.company_code) ||
      text(req.query.company_code) ||
      "BSG";

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: REPORT_NAME,
      userName: params.loginid,
      endLabel: "Powered by Bayanat Technology",
    });
    const bodyHtml = renderFormBody(data, params.request_number);

    const html = buildReportDocument({
      title: `${REPORT_TITLE} - ${params.request_number}`,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: PR_FORM_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("PR Form HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getPrRegisterFormReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    if (!params.request_number) {
      res.status(400).json({ success: false, message: "Request number is required." });
      return;
    }

    const data = await loadFormData(req, params);
    if (!data.items.length) {
      res.status(200).json({ success: false, message: "No data found for the selected request." });
      return;
    }

    const buffer = buildFormExcelBuffer(data, params.request_number, params.loginid);
    const safeName = params.request_number.replace(/[^A-Za-z0-9_-]/g, "_");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Purchase_Request_${safeName}.xlsx"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("PR Form Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};