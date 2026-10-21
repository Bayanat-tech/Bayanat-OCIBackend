import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../interfaces/common.interface";
import { buildReportDocument, reportFooter, reportHeader } from "../../controllers/common/report_common";

// ─── Types ────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

interface ReqParams {
  loginid:      string;
  company_code: string;
  fromdate:     string; // "All" or "YYYY-MM-DD"
  todate:       string;
  user_id:      string; // "All" or CREATE_USER code
  search_text:  string; // "All" or free text
  status:       string; // "All" | "PENDING" | "APPROVED" | "REJECTED" | "PO GENERATED"
  report_type:  string; // "SUMMARY" | "DETAILS"
}

// Dispatch keys handled by PROC_BUILD_DYNAMIC_SQL_ALMS_REPORTS
const PARAM_SUMMARY = "PR_REGISTER_SUMMARY";
const PARAM_DETAILS = "PR_REGISTER_DETAILS";

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

function amtFmt(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.000";
  return n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function rateFmt(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "1.00";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Param extraction ───────────────────────────────────────────────────────

function extractParams(req: RequestWithUser): ReqParams {
  const b = req.body || {};
  return {
    loginid:      text(req.user?.loginid) || text(b.loginid) || "ADMIN",
    company_code: text(b.company_code),
    fromdate:     text(b.fromdate) || "All",
    todate:       text(b.todate) || "All",
    user_id:      text(b.user_id) || "All",
    search_text:  text(b.search_text) || "All",
    status:       text(b.status) || "All",
    report_type:  text(b.report_type).toUpperCase() === "DETAILS" ? "DETAILS" : "SUMMARY",
  };
}

// ─── Data loader ────────────────────────────────────────────────────────────

async function loadPrRegisterData(req: RequestWithUser, p: ReqParams, dispatchParam: string): Promise<ReportRow[]> {
  const tConn = Date.now();
  const conn = await getConn(req);
  console.log(`[PR] getConn: ${Date.now() - tConn} ms`);

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
      code2: p.user_id || null,
      code3: p.search_text || null,
      code4: p.status || null,
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

    // PROC_BUILD_DYNAMIC_SQL_ALMS_REPORTS returns a CLOB, so use a CLOB variable
    // here and convert to VARCHAR2 for the OUT bind.
    const tProc = Date.now();
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
    console.log(`[PR] procedure (build SQL): ${Date.now() - tProc} ms`);

    const rawSql = (result.outBinds as any).out_sql;
    if (!rawSql) throw new Error("Procedure did not return a valid SQL query.");

    console.log("=== GENERATED SQL ===\n", rawSql, "\n=== END ===");

    const tQuery = Date.now();
    const dataResult = await conn.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    console.log(`[PR] data query: ${Date.now() - tQuery} ms, rows: ${dataResult.rows?.length}`);

    return normalize(dataResult.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Summary model (grouped by Purchase Status) ────────────────────────────

interface StatusGroup {
  status: string;
  rows: ReportRow[];
  amountTotal: number;
}

function groupByStatus(rows: ReportRow[]): { groups: StatusGroup[]; grandAmount: number } {
  const byStatus = new Map<string, StatusGroup>();
  const order: string[] = [];

  for (const r of rows) {
    const key = text(r.purch_status) || "(Not Set)";
    if (!byStatus.has(key)) {
      byStatus.set(key, { status: key, rows: [], amountTotal: 0 });
      order.push(key);
    }
    const g = byStatus.get(key)!;
    g.rows.push(r);
    g.amountTotal += num(r.amount);
  }

  const groups = order.map((k) => byStatus.get(k)!);
  const grandAmount = groups.reduce((s, g) => s + g.amountTotal, 0);

  return { groups, grandAmount };
}

// ─── HTML renderer (shared report_common shell) ────────────────────────────

const REPORT_TITLE = "PURCHASE SUMMARY REPORT";
const DETAILS_REPORT_TITLE = "PURCHASE DETAILS REPORT";
const REPORT_NAME = "rep_pfs_txns_datewise";

/** Shared extra CSS for both Summary and Details reports */
const PR_REGISTER_EXTRA_CSS = `
  @page {
    size: A4 landscape;
    margin: 8mm;
  }

  .pr-register {
    font-size: 9.5px;
    line-height: 1.25;
    color: #1e293b;
  }

  .pr-register .title {
    margin: 0 0 6px 0;
  }
  .pr-register .title h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 800;
    color: #0b4ca1;
    line-height: 1.2;
  }

  .pr-register .status-block {
    margin: 0 0 10px 0;
    break-inside: avoid;
  }
  .pr-register .status-header {
    padding: 5px 10px;
    background: #0b4ca1;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    border-radius: 4px 4px 0 0;
  }

  .pr-register table.data-table {
    width: 100%;
    border-collapse: collapse;
    margin: 0;
    font-size: 9.5px;
  }
  .pr-register table.data-table th {
    padding: 5px 6px;
    font-size: 9px;
    background: #0b4ca1;
    color: #fff;
    text-align: left;
    white-space: nowrap;
  }
  .pr-register table.data-table th.right,
  .pr-register table.data-table td.right {
    text-align: right;
  }
  .pr-register table.data-table td {
    padding: 4px 6px;
    border-bottom: 1px solid #e2e8f0;
    vertical-align: top;
  }
  .pr-register .subtotal-row td {
    background: #eef2f7 !important;
    font-weight: 700;
    color: #1e3a8a;
  }
  .pr-register .grand-row td {
    background: #0b4ca1 !important;
    color: #ffffff !important;
    font-weight: 700;
    font-size: 12px;
  }

  .pr-register .empty {
    padding: 28px;
    text-align: center;
    color: #64748b;
    font-size: 11px;
  }
`;

// Inline styles, same approach as the PO Order Register report (does not depend on extraCss)
const PR_S = {
  head:  "background:#dce6f4 !important;color:#0b3d91 !important;font-weight:700;font-size:11px;padding:6px 8px;border-left:3px solid #0b4ca1;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
  total: "background:#f4f7fb !important;color:#0b3d91 !important;font-weight:700;padding:5px 6px;border-top:1px solid #c5d5ea;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
  grand: "background:#cfe0f5 !important;color:#0b3d91 !important;font-weight:700;padding:8px 6px;border-top:2px solid #0b4ca1;font-size:11px;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
  th:    "background:#1e3a8a !important;color:#ffffff !important;font-weight:700;font-size:9px;padding:5px 6px;text-align:left;word-break:break-word;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
  thR:   "background:#1e3a8a !important;color:#ffffff !important;font-weight:700;font-size:9px;padding:5px 6px;text-align:right;word-break:break-word;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
  td:    "padding:4px 6px;border-bottom:1px solid #e2e8f0;vertical-align:top;word-break:break-word;overflow-wrap:anywhere;",
  tdR:   "padding:4px 6px;border-bottom:1px solid #e2e8f0;vertical-align:top;text-align:right;word-break:break-word;",
};

const PR_WRAP = "font-size:9.5px;line-height:1.25;color:#1e293b;";
const PR_TITLE = "margin:0;padding:0;font-size:15px;font-weight:800;color:#0b4ca1;line-height:1.2;";
const PR_EMPTY = "padding:28px;margin-top:8px;font-size:11px;text-align:center;color:#64748b;";

/** Summary body only – single table, one <tbody> per Purchase Status */
function renderSummaryBody(rows: ReportRow[], loginId: string): string {
  const { groups, grandAmount } = groupByStatus(rows);
  const S = PR_S;

  const groupsHtml = groups
    .map((g) => {
      const lines = g.rows
        .map(
          (r) => `
        <tr>
          <td style="${S.td}">${escapeHtml(r.request_number)}</td>
          <td style="${S.td}">${escapeHtml(dateText(r.request_date))}</td>
          <td style="${S.td}">${escapeHtml(r.create_user)}</td>
          <td style="${S.td}">${escapeHtml(r.description)}</td>
          <td style="${S.td}">${escapeHtml(r.currency_code)}</td>
          <td style="${S.tdR}">${rateFmt(r.currency_rate)}</td>
          <td style="${S.tdR}">${amtFmt(r.amount)}</td>
        </tr>`
        )
        .join("");

      return `
      <tbody style="break-inside:avoid;page-break-inside:avoid;">
        <tr>
          <td colspan="7" style="${S.head}">Purchase Status: ${escapeHtml(g.status)}</td>
        </tr>
        ${lines}
        <tr>
          <td colspan="6" style="${S.total}">Total Amount for ${escapeHtml(g.status)}</td>
          <td style="${S.total} text-align:right;">${amtFmt(g.amountTotal)}</td>
        </tr>
      </tbody>`;
    })
    .join("");

  return `
  <div class="pr-register" style="${PR_WRAP}">
    <div style="margin:0 0 6px 0;padding:0;">
      <h1 style="${PR_TITLE}">${escapeHtml(REPORT_TITLE)}</h1>
    </div>

    ${
      rows.length === 0
        ? `<div style="${PR_EMPTY}">No records found for the selected filters.</div>`
        : `
      <table style="margin-top:8px;border-collapse:collapse;width:100%;table-layout:fixed;">
        <colgroup><col style="width:14%"/><col style="width:11%"/><col style="width:12%"/><col style="width:33%"/><col style="width:9%"/><col style="width:9%"/><col style="width:12%"/></colgroup>
        <thead>
          <tr>
            <th style="${S.th}">Request No</th>
            <th style="${S.th}">Request Date</th>
            <th style="${S.th}">Create User</th>
            <th style="${S.th}">Description</th>
            <th style="${S.th}">Currency</th>
            <th style="${S.thR}">EX Rate</th>
            <th style="${S.thR}">Amount</th>
          </tr>
        </thead>
        ${groupsHtml}
        <tbody>
          <tr>
            <td colspan="6" style="${S.grand}">Grand Total Amount</td>
            <td style="${S.grand} text-align:right;">${amtFmt(grandAmount)}</td>
          </tr>
        </tbody>
      </table>`
    }
  </div>`;
}

// ─── Details model (grouped by Request No, item-wise) ──────────────────────

interface RequestGroup {
  request_number: string;
  request_date: any;
  purch_status: string;
  rows: ReportRow[];
  amountTotal: number;
}

function groupByRequest(rows: ReportRow[]): { groups: RequestGroup[]; grandAmount: number } {
  const byReq = new Map<string, RequestGroup>();
  const order: string[] = [];

  for (const r of rows) {
    const key = text(r.request_number);
    if (!byReq.has(key)) {
      byReq.set(key, {
        request_number: key,
        request_date: r.request_date,
        purch_status: text(r.purch_status),
        rows: [],
        amountTotal: 0,
      });
      order.push(key);
    }
    const g = byReq.get(key)!;
    g.rows.push(r);
    g.amountTotal += num(r.amount);
  }

  const groups = order.map((k) => byReq.get(k)!);
  const grandAmount = groups.reduce((s, g) => s + g.amountTotal, 0);

  return { groups, grandAmount };
}

/** Details body only – single table, one <tbody> per Request No */
function renderDetailsBody(rows: ReportRow[], loginId: string): string {
  const { groups, grandAmount } = groupByRequest(rows);
  const S = PR_S;

  const groupsHtml = groups
    .map((g) => {
      const lines = g.rows
        .map(
          (r) => `
        <tr>
          <td style="${S.td}">${escapeHtml(r.sr_no)}</td>
          <td style="${S.td}">${escapeHtml(r.item_code)}</td>
          <td style="${S.td}">${escapeHtml(r.item_desp)}</td>
          <td style="${S.tdR}">${amtFmt(r.item_rate)}</td>
          <td style="${S.tdR}">${amtFmt(r.item_qty)}</td>
          <td style="${S.td}">${escapeHtml(r.curr_code)}</td>
          <td style="${S.tdR}">${rateFmt(r.currency_rate)}</td>
          <td style="${S.tdR}">${amtFmt(r.amount)}</td>
        </tr>`
        )
        .join("");

      return `
      <tbody style="break-inside:avoid;page-break-inside:avoid;">
        <tr>
          <td colspan="8" style="${S.head}">
            Request No. ${escapeHtml(g.request_number)}
            &nbsp;|&nbsp; ${escapeHtml(dateText(g.request_date))}
            &nbsp;|&nbsp; ${escapeHtml(g.purch_status)}
          </td>
        </tr>
        ${lines}
        <tr>
          <td colspan="7" style="${S.total}">Total Amount for ${escapeHtml(g.request_number)}</td>
          <td style="${S.total} text-align:right;">${amtFmt(g.amountTotal)}</td>
        </tr>
      </tbody>`;
    })
    .join("");

  return `
  <div class="pr-register" style="${PR_WRAP}">
    <div style="margin:0 0 6px 0;padding:0;">
      <h1 style="${PR_TITLE}">${escapeHtml(DETAILS_REPORT_TITLE)}</h1>
    </div>

    ${
      rows.length === 0
        ? `<div style="${PR_EMPTY}">No records found for the selected filters.</div>`
        : `
      <table style="margin-top:8px;border-collapse:collapse;width:100%;table-layout:fixed;">
        <colgroup><col style="width:6%"/><col style="width:13%"/><col style="width:33%"/><col style="width:11%"/><col style="width:9%"/><col style="width:8%"/><col style="width:8%"/><col style="width:12%"/></colgroup>
        <thead>
          <tr>
            <th style="${S.th}">Sr No</th>
            <th style="${S.th}">Item Code</th>
            <th style="${S.th}">Item Description</th>
            <th style="${S.thR}">Rate</th>
            <th style="${S.thR}">Qty</th>
            <th style="${S.th}">Currency</th>
            <th style="${S.thR}">EX Rate</th>
            <th style="${S.thR}">Amount</th>
          </tr>
        </thead>
        ${groupsHtml}
        <tbody>
          <tr>
            <td colspan="7" style="${S.grand}">Grand Total Amount</td>
            <td style="${S.grand} text-align:right;">${amtFmt(grandAmount)}</td>
          </tr>
        </tbody>
      </table>`
    }
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
  sheetName: string;
}): Buffer {
  const { rows: rows_, merges, colCount, colWidth, sheetName } = opts;
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

// ─── Excel: Summary ─────────────────────────────────────────────────────────

function buildExcelBuffer(rows: ReportRow[], loginId: string): Buffer {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const { groups, grandAmount } = groupByStatus(rows);
  const COL_COUNT = 7; // Request No, Request Date, Create User, Description, Currency, EX Rate, Amount

  const rows_: XlRow[] = [];
  const merges: XlMerge[] = [];

  // Title
  rows_.push([xlCell(REPORT_TITLE, "title"), null, null, null, null, null, null]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  // Meta
  rows_.push([
    xlCell(`Date: ${printDateTime}`, "meta"), null,
    xlCell(`User: ${loginId}`, "meta"), null,
    xlCell(`Report: ${REPORT_NAME}`, "meta"), null, null,
  ]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } });
  merges.push({ s: { r: 1, c: 2 }, e: { r: 1, c: 3 } });
  merges.push({ s: { r: 1, c: 4 }, e: { r: 1, c: 6 } });

  rows_.push([null, null, null, null, null, null, null]);

  // Header
  rows_.push([
    xlCell("Request No", "header"), xlCell("Request Date", "header"), xlCell("Create User", "header"),
    xlCell("Description", "header"), xlCell("Currency", "header"), xlCell("EX Rate", "header"), xlCell("Amount", "header"),
  ]);

  // Data grouped by Purchase Status
  groups.forEach((g) => {
    const rIdx = rows_.length;
    rows_.push([xlCell(`Purchase Status: ${g.status}`, "groupHeader"), null, null, null, null, null, null]);
    merges.push({ s: { r: rIdx, c: 0 }, e: { r: rIdx, c: COL_COUNT - 1 } });

    g.rows.forEach((r) => {
      rows_.push([
        xlCell(text(r.request_number), "data"),
        xlCell(dateText(r.request_date), "data"),
        xlCell(text(r.create_user), "data"),
        xlCell(text(r.description), "data"),
        xlCell(text(r.currency_code), "data"),
        xlCell(num(r.currency_rate), "dataNum2"),
        xlCell(num(r.amount), "dataNum3"),
      ]);
    });

    const dtRow = rows_.length;
    rows_.push([
      xlCell(`Total Amount for ${g.status}`, "groupTotal"), null, null, null, null, null,
      xlCell(g.amountTotal, "groupTotalNum"),
    ]);
    merges.push({ s: { r: dtRow, c: 0 }, e: { r: dtRow, c: 5 } });

    rows_.push([null, null, null, null, null, null, null]);
  });

  // Grand total
  const gtRow = rows_.length;
  rows_.push([xlCell("Grand Total Amount", "grandTotal"), null, null, null, null, null, xlCell(grandAmount, "grandTotalNum")]);
  merges.push({ s: { r: gtRow, c: 0 }, e: { r: gtRow, c: 5 } });

  // Footer
  rows_.push([null, null, null, null, null, null, xlCell("Powered by Bayanat Technology", "footer")]);

  return buildXlsx({ rows: rows_, merges, colCount: COL_COUNT, colWidth: 20, sheetName: "PR Register Summary" });
}

// ─── Excel: Details ─────────────────────────────────────────────────────────

function buildDetailsExcelBuffer(rows: ReportRow[], loginId: string): Buffer {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const { groups, grandAmount } = groupByRequest(rows);
  const COL_COUNT = 8; // Sr No, Item Code, Item Description, Rate, Qty, Currency, EX Rate, Amount

  const rows_: XlRow[] = [];
  const merges: XlMerge[] = [];

  rows_.push([xlCell(DETAILS_REPORT_TITLE, "title"), null, null, null, null, null, null, null]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  rows_.push([
    xlCell(`Date: ${printDateTime}`, "meta"), null,
    xlCell(`User: ${loginId}`, "meta"), null,
    xlCell(`Report: ${REPORT_NAME}`, "meta"), null, null, null,
  ]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } });
  merges.push({ s: { r: 1, c: 2 }, e: { r: 1, c: 3 } });
  merges.push({ s: { r: 1, c: 4 }, e: { r: 1, c: 7 } });

  rows_.push([null, null, null, null, null, null, null, null]);

  rows_.push([
    xlCell("Sr No", "header"), xlCell("Item Code", "header"), xlCell("Item Description", "header"),
    xlCell("Rate", "header"), xlCell("Qty", "header"), xlCell("Currency", "header"),
    xlCell("EX Rate", "header"), xlCell("Amount", "header"),
  ]);

  groups.forEach((g) => {
    const rIdx = rows_.length;
    rows_.push([
      xlCell(`Request No. ${g.request_number}   ${dateText(g.request_date)}   ${g.purch_status}`, "groupHeader"),
      null, null, null, null, null, null, null,
    ]);
    merges.push({ s: { r: rIdx, c: 0 }, e: { r: rIdx, c: COL_COUNT - 1 } });

    g.rows.forEach((r) => {
      rows_.push([
        xlCell(text(r.sr_no), "data"),
        xlCell(text(r.item_code), "data"),
        xlCell(text(r.item_desp), "data"),
        xlCell(num(r.item_rate), "dataNum3"),
        xlCell(num(r.item_qty), "dataNum3"),
        xlCell(text(r.curr_code), "data"),
        xlCell(num(r.currency_rate), "dataNum2"),
        xlCell(num(r.amount), "dataNum3"),
      ]);
    });

    const dtRow = rows_.length;
    rows_.push([
      xlCell(`Total Amount for ${g.request_number}`, "groupTotal"), null, null, null, null, null, null,
      xlCell(g.amountTotal, "groupTotalNum"),
    ]);
    merges.push({ s: { r: dtRow, c: 0 }, e: { r: dtRow, c: 6 } });

    rows_.push([null, null, null, null, null, null, null, null]);
  });

  const gtRow = rows_.length;
  rows_.push([xlCell("Grand Total Amount", "grandTotal"), null, null, null, null, null, null, xlCell(grandAmount, "grandTotalNum")]);
  merges.push({ s: { r: gtRow, c: 0 }, e: { r: gtRow, c: 6 } });

  rows_.push([null, null, null, null, null, null, null, xlCell("Powered by Bayanat Technology", "footer")]);

  return buildXlsx({ rows: rows_, merges, colCount: COL_COUNT, colWidth: 18, sheetName: "PR Register Details" });
}

// ─── Route handlers ─────────────────────────────────────────────────────────

export const getPrRegisterSummaryReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  console.log(">>> PR REGISTER SUMMARY V3 (inline styles, fixed layout) LOADED <<<");
  try {
    const t0 = Date.now();
    const params = extractParams(req);
    console.log("[PR] params:", params);

    const rows = await loadPrRegisterData(req, params, PARAM_SUMMARY);
    console.log(`[PR] load data total: ${Date.now() - t0} ms`);

    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }

    const companyCode =
      params.company_code ||
      text(req.user?.company_code) ||
      text(req.query.company_code) ||
      "BSG";

    const tHeader = Date.now();
    const headerHtml = await reportHeader({ company_code: companyCode, req });
    console.log(`[PR] reportHeader: ${Date.now() - tHeader} ms`);

    const footerHtml = reportFooter({
      reportName: REPORT_NAME,
      userName: params.loginid,
      endLabel: "Powered by Bayanat Technology",
    });
    const bodyHtml = renderSummaryBody(rows, params.loginid);

    const html = buildReportDocument({
      title: REPORT_TITLE,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: PR_REGISTER_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    console.log(`[PR] TOTAL request: ${Date.now() - t0} ms`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("PR Register Summary HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getPrRegisterSummaryReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadPrRegisterData(req, params, PARAM_SUMMARY);
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }
    const buffer = buildExcelBuffer(rows, params.loginid);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="PR_Register_Summary_Report.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("PR Register Summary Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};

export const getPrRegisterDetailReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadPrRegisterData(req, params, PARAM_DETAILS);
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
      reportName: REPORT_NAME,
      userName: params.loginid,
      endLabel: "Powered by Bayanat Technology",
    });
    const bodyHtml = renderDetailsBody(rows, params.loginid);

    const html = buildReportDocument({
      title: DETAILS_REPORT_TITLE,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: PR_REGISTER_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("PR Register Detail HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getPrRegisterDetailReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadPrRegisterData(req, params, PARAM_DETAILS);
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }
    const buffer = buildDetailsExcelBuffer(rows, params.loginid);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="PR_Register_Details_Report.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("PR Register Detail Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};