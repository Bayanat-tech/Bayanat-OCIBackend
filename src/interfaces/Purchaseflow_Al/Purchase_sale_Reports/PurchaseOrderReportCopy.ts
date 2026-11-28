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
  loginid: string;
  company_code: string;
  doc_type: string; // "LPO"
  doc_no: string;
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

function grossValue(r: ReportRow): number {
  return num(r.quantity) * num(r.unit_price);
}

// ─── Param extraction ───────────────────────────────────────────────────────

function extractParams(req: RequestWithUser): ReqParams {
  const b = req.body || {};
  return {
    loginid: text(req.user?.loginid) || text(b.loginid) || "ADMIN",
    company_code: text(b.company_code),
    doc_type: text(b.doc_type) || "LPO",
    doc_no: text(b.doc_no),
  };
}

// ─── Data loader ────────────────────────────────────────────────────────────

async function loadPurchaseOrderData(req: RequestWithUser, p: ReqParams): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const binds: any = {
      parameter: "PORPT_PO_19082026",
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
         PROC_BUILD_DYNAMIC_SQL_PURCHASE_ORDER(
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

interface PoHeader {
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
  dlvr_term: string;
  cancelled: boolean;
  total_tx_compnt_amt_1: number;
  remarks: string;
  ref_no: string;
}

function buildHeader(rows: ReportRow[]): PoHeader {
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
    dlvr_term: text(h.dlvr_term),
    cancelled: text(h.cancelled).toUpperCase() === "Y",
    total_tx_compnt_amt_1: num(h.total_tx_compnt_amt_1),
    remarks: text(h.remarks),
    ref_no: text(h.ref_no),
  };
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Line discount amount
const lineDiscOf = (r: ReportRow) =>
  round2(num(r.disc_price) || (grossValue(r) * num(r.disc_percent)) / 100);

// Line net = gross − discount
const netOf = (r: ReportRow) => round2(grossValue(r) - lineDiscOf(r));

// ⚠ Line TAX % field: the first field found in this list is used.
// Check the "=== GENERATED SQL ===" console log for the real column name and put it FIRST in this list.
const TAX_PCT_FIELDS = ["tx_compnt_perc_1", "tax_percent", "vat_percent", "tax_per"];

// Fallback when rows have no tax % column: derive one % from the header VAT amount
function headerTaxPct(rows: ReportRow[], header: PoHeader): number {
  const net = round2(rows.reduce((s, r) => s + netOf(r), 0));
  return net > 0 ? round2((header.total_tx_compnt_amt_1 / net) * 100) : 0;
}

function lineTaxPctOf(r: ReportRow, fallbackPct: number): number {
  for (const f of TAX_PCT_FIELDS) {
    if (r[f] != null && r[f] !== "") return num(r[f]);
  }
  return fallbackPct;
}

// Line TAX amount: stored amount if present, else net × tax %
const vatOf = (r: ReportRow, fallbackPct: number) => {
  const stored = num(r.tx_compnt_amt_1);
  return stored ? round2(stored) : round2((netOf(r) * lineTaxPctOf(r, fallbackPct)) / 100);
};

// Line grand total = net + tax
const grandOf = (r: ReportRow, fallbackPct: number) => round2(netOf(r) + vatOf(r, fallbackPct));

function computeTotals(rows: ReportRow[], header: PoHeader) {
  const fallbackPct = headerTaxPct(rows, header);
  // Total Amount = sum of the Grand Total column.
  // To show the sum of Line Value instead, use:  round2(rows.reduce((s, r) => s + grossValue(r), 0))
  const totalAmount = round2(rows.reduce((s, r) => s + grandOf(r, fallbackPct), 0));
  return { totalAmount, fallbackPct };
}

// ─── HTML renderer ──────────────────────────────────────────────────────────

const REPORT_TITLE = "Purchase Order";
const PO_NOTES: string[] = [
  "1. Our order number is to be quoted on all relevant Invoices.",
];

const PO_APPROVAL_TEXT = "This Document Is Electronically Approved";

/** PO-only layout CSS (shared header/footer/table CSS comes from report_common) */
const PO_EXTRA_CSS = `
  /* Two separate boxes */
  table.grn-two-col {
    width: 100%;
    table-layout: fixed;
    border-collapse: separate;
    border-spacing: 10px 0;
    margin: 0 -10px 14px;
  }

  .grn-two-col > tbody > tr > td {
    width: 50%;
    vertical-align: top;
    padding: 0;
  }

  table.po-two-col > tbody > tr > td:first-child { width: 70% !important; }
  table.po-two-col > tbody > tr > td:last-child  { width: 30% !important; }

  /* Individual box */
  table.pr-kv-box {
    width: 100%;
    border-collapse: collapse;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    font-size: 11px;
  }

  .pr-kv-box thead th {
    text-align: left;
    padding: 8px 10px;
    color: #0b4ca1;
    background: #eff6ff;
    font-size: 11px;
    font-weight: 700;
    border-bottom: 2px solid #0b4ca1;
  }

  .pr-kv-box tbody td {
    padding: 6px 10px;
    border-bottom: 1px solid #e2e8f0;
    color: #334155;
    vertical-align: top;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .pr-kv-box tbody tr:last-child td {
    border-bottom: none;
  }

  .pr-kv-box tbody td:first-child {
    width: 34%;
  }

  .pr-kv-box tbody td:nth-child(2) {
    width: 12px;
    text-align: center;
  }

  .pr-kv-box tbody td:last-child {
    color: #0f172a;
  }

  .pr-kv-box.po-kv-to tbody td:first-child { width: 18%; }
  .pr-kv-box.po-kv-details tbody td:first-child { width: 32%; }
  .pr-kv-box.po-kv-to thead th,
  .pr-kv-box.po-kv-details thead th { padding: 4px 10px; }

  table.data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    margin-top: 4px;
  }

  table.data-table thead th {
    background: #f1f5f9;
    color: #334155;
    padding: 8px 10px;
    text-align: left;
    font-weight: 700;
    font-size: 10px;
    text-transform: uppercase;
    border-bottom: 1px solid #cbd5e1;
  }

  table.data-table thead th.right {
    text-align: right;
  }

  table.data-table tbody td {
    padding: 7px 10px;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: top;
  }

  table.data-table .right {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  table.data-table .amount {
    font-weight: 600;
    color: #065f46;
  }

  /* 13-column items table: smaller cells so every column name stays on one line */
  table.po-items-tax { table-layout: fixed; }
  table.po-items-tax th,
  table.po-items-tax td { padding: 5px 4px; font-size: 9.5px; overflow-wrap: anywhere; }
  table.po-items-tax thead th { white-space: nowrap; }

  .totals-box {
    margin-top: 16px;
    margin-left: auto;
    width: 300px;
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

  /* Terms strip + items table: same grid look */
  table.po-terms, table.po-items { border-collapse: collapse; }
  table.po-terms th, table.po-terms td,
  table.po-items th, table.po-items td { border: 1px solid #4a6fa5 !important; }
  table.po-terms { margin-bottom: 12px; }

  .empty-lines {
    text-align: center;
    padding: 40px 20px;
    color: #64748b;
  }

  /* Keep Reference + notes + signature together, never split across pages */
  .po-sign-block {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }

  .po-sign-block table,
  .po-sign-block tr,
  .po-sign-block td,
  .po-sign-block th {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }

  /* Do not repeat the header row on the next page */
  .po-sign-block thead {
    display: table-row-group !important;
  }
`;

type KvPair = [string, string];

function kvBoxHtml(title: string, pairs: KvPair[], cls = ""): string {
  const rows = pairs
    .map(
      ([key, value]) => `
        <tr>
          <td>${escapeHtml(key)}</td>
          <td>:</td>
          <td><b>${escapeHtml(value || "-")}</b></td>
        </tr>
      `
    )
    .join("");

  return `
    <table class="pr-kv-box ${cls}">
      <thead>
        <tr>
          <th colspan="3">${escapeHtml(title)}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function kvTwoBoxesHtml(
  leftTitle: string,
  left: KvPair[],
  rightTitle: string,
  right: KvPair[]
): string {
  return `
    <table class="grn-two-col po-two-col">
      <tbody>
        <tr>
          <td>${kvBoxHtml(leftTitle, left, "po-kv-to")}</td>
          <td>${kvBoxHtml(rightTitle, right, "po-kv-details")}</td>
        </tr>
      </tbody>
    </table>
  `;
}

const keepFilled = (pairs: KvPair[], required: number): KvPair[] =>
  pairs.filter(([, value], index) =>
    index < required || !!text(value).trim()
  );

function poPartyPairs(header: PoHeader): KvPair[] {
  return keepFilled(
    [
      ["Supplier", header.party_name],
      ["Address", header.party_address],
      ["Tel", header.party_phone],
      ["Fax", header.party_fax],
    ],
    1
  );
}

function poTermsStripHtml(header: PoHeader): string {
  return `
    <table class="data-table po-terms">
      <thead>
        <tr>
          <th class="center">PAYMENT TERM</th>
          <th class="center">DELIVERY TERM / PERIOD</th>
          <th class="center">REMARKS</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="center">${escapeHtml(header.payment_terms || "-")}</td>
          <td class="center">${escapeHtml(header.dlvr_term || "-")}</td>
          <td class="center">${escapeHtml(header.remarks || "-")}</td>
        </tr>
      </tbody>
    </table>`;
}

function poDetailPairs(header: PoHeader): KvPair[] {
  return keepFilled(
    [
      ["Doc No", header.doc_no],
      ["Date", dateText(header.doc_date)],
    ],
    2
  );
}

/** Body only – no full HTML document */
function renderPoBody(rows: ReportRow[], _loginId: string): string {
  const header = buildHeader(rows);
  const totals = computeTotals(rows, header);

  // 13 columns
  const bodyRows = rows
    .map(
      (r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(r.prod_name)}${r.det_remarks ? ` — ${escapeHtml(r.det_remarks)}` : ""}</td>
      <td class="right">${qtyFmt(r.qty_puom)}</td>
      <td>${escapeHtml(r.p_uom)}</td>
      <td class="right">${qtyFmt(r.qty_luom)}</td>
      <td>${escapeHtml(r.l_uom)}</td>
      <td class="right">${amtFmt(r.unit_price)}</td>
      <td class="right">${amtFmt(grossValue(r))}</td>
      <td class="right">${amtFmt(lineDiscOf(r))}</td>
      <td class="right">${amtFmt(netOf(r))}</td>
      <td class="right">${amtFmt(lineTaxPctOf(r, totals.fallbackPct))}</td>
      <td class="right">${amtFmt(vatOf(r, totals.fallbackPct))}</td>
      <td class="right amount">${amtFmt(grandOf(r, totals.fallbackPct))}</td>
    </tr>`
    )
    .join("");

  return `
    <h1 class="center"><u>${escapeHtml(REPORT_TITLE.toUpperCase())}${header.cancelled ? " (CANCELLED)" : ""}</u></h1>

    ${kvTwoBoxesHtml("To", poPartyPairs(header), "PO Details", poDetailPairs(header))}

    ${poTermsStripHtml(header)}

    ${rows.length === 0
      ? `<div class="empty-lines">No line items found for this PO.</div>`
      : `
      <table class="data-table po-items po-items-tax">
        <thead>
          <tr>
            <th>S.No</th>
            <th>Product / Description</th>
            <th class="right">P.Qty</th>
            <th>P.UOM</th>
            <th class="right">L.Qty</th>
            <th>L.UOM</th>
            <th class="right">Unit Price</th>
            <th class="right">Line Value</th>
            <th class="right">Disc Amt</th>
            <th class="right">Net Amt</th>
            <th class="right">TAX %</th>
            <th class="right">TAX Amt</th>
            <th class="right">Grand Total</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>

      <div class="totals-box">
        <div class="row"><span>Total Amount</span><span>${amtFmt(totals.totalAmount)}</span></div>
      </div>`
    }

    <div class="po-sign-block" style="break-inside:avoid;page-break-inside:avoid;">
      <div class="group"><span class="strong">Reference: ${escapeHtml(header.ref_no || "as per above")}</span></div>
      <div class="group">${PO_NOTES.map((t) => `<div class="muted">${escapeHtml(t)}</div>`).join("")}</div>

      <table class="data-table po-sign" style="break-inside:avoid;page-break-inside:avoid;">
        <thead>
          <tr>
            <th class="center">For Supplier:</th>
            <th class="center">For ${escapeHtml(header.div_name || "Company")}:</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <b>I have read &amp; agreed to all terms and conditions.</b>
              <br/><br/><br/>
              Signature: ______________________ &nbsp; Date: ______________
            </td>
            <td class="center">
              ${escapeHtml(PO_APPROVAL_TEXT)}
              <br/><br/><br/>
              Signature: ______________________ &nbsp; Date: ______________
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

// ─── Excel builder (raw-OOXML engine) ───────────────────────────────────────

function buildExcelStyles() {
  const BLUE = "FF1D4ED8";
  const WHITE = "FFFFFFFF";
  const GREEN_BG = "FFD1FAE5";

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
      top: b.top?.color?.rgb, bottom: b.bottom?.color?.rgb,
      left: b.left?.color?.rgb, right: b.right?.color?.rgb,
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

  const buildZip = (COL_COUNT: number, rows_: any[], merges: any[], sheetName: string): Buffer => {
    const colXml = Array.from({ length: COL_COUNT }, (_, i) =>
      `<col min="${i + 1}" max="${i + 1}" width="${i === 1 ? 36 : 14}" customWidth="1"/>`
    ).join("");

    let sheetDataXml = "";
    rows_.forEach((row, ri) => {
      const rn = ri + 1;
      let rowXml = `<row r="${rn}">`;
      row.forEach((c: any, ci: number) => {
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
      .map((m: any) => `<mergeCell ref="${String.fromCharCode(65 + m.s.c)}${m.s.r + 1}:${String.fromCharCode(65 + m.e.c)}${m.e.r + 1}"/>`)
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
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

    const zip = new AdmZip();
    zip.addFile("[Content_Types].xml", Buffer.from(contentTypes));
    zip.addFile("_rels/.rels", Buffer.from(rels));
    zip.addFile("xl/workbook.xml", Buffer.from(workbookXml));
    zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels));
    zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheetXml));
    zip.addFile("xl/styles.xml", Buffer.from(stylesXml));
    return zip.toBuffer();
  };

  return { styleIndexFor, buildZip };
}

function buildPoTaxExcelBuffer(rows: ReportRow[], loginId: string): Buffer {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const header = buildHeader(rows);
  const totals = computeTotals(rows, header);
  const COL_COUNT = 13;

  interface XlCell { v: unknown; styleKey: string }
  type Row = (XlCell | null)[];
  const rows_: Row[] = [];
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];

  const cell = (v: unknown, styleKey: string): XlCell => ({ v, styleKey });
  const blank = (): Row => new Array(COL_COUNT).fill(null);
  const fullRow = (c: XlCell): Row => [c, ...new Array(COL_COUNT - 1).fill(null)];
  const mergeFull = () =>
    merges.push({ s: { r: rows_.length - 1, c: 0 }, e: { r: rows_.length - 1, c: COL_COUNT - 1 } });

  rows_.push(fullRow(cell(`PURCHASE ORDER${header.cancelled ? " (CANCELLED)" : ""}`, "title")));
  mergeFull();

  rows_.push(fullRow(cell(
    `PO No: ${header.doc_no}   Date: ${dateText(header.doc_date)}   Print: ${printDateTime} (${loginId})`,
    "meta"
  )));
  mergeFull();

  rows_.push(fullRow(cell(
    `To: ${header.party_name}, ${header.party_address}   Tel: ${header.party_phone}   Fax: ${header.party_fax}`,
    "meta"
  )));
  mergeFull();

  rows_.push(fullRow(cell(
    `Payment Term: ${header.payment_terms || "-"}   Delivery Term / Period: ${header.dlvr_term || "-"}   Remarks: ${header.remarks || "-"}`,
    "meta"
  )));
  mergeFull();

  rows_.push(blank());

  rows_.push([
    cell("S.No", "header"), cell("Product / Description", "header"),
    cell("P.Qty", "header"), cell("P.UOM", "header"), cell("L.Qty", "header"), cell("L.UOM", "header"),
    cell("Unit Price", "header"), cell("Line Value", "header"), cell("Disc Amt", "header"),
    cell("Net Amt", "header"), cell("TAX %", "header"), cell("TAX Amt", "header"), cell("Grand Total", "header"),
  ]);

  rows.forEach((r, i) => {
    rows_.push([
      cell(i + 1, "data"),
      cell(`${text(r.prod_name)}${r.det_remarks ? ` — ${text(r.det_remarks)}` : ""}`, "data"),
      cell(num(r.qty_puom), "dataNum"),
      cell(text(r.p_uom), "data"),
      cell(num(r.qty_luom), "dataNum"),
      cell(text(r.l_uom), "data"),
      cell(num(r.unit_price), "dataNum"),
      cell(round2(grossValue(r)), "dataNum"),
      cell(lineDiscOf(r), "dataNum"),
      cell(netOf(r), "dataNum"),
      cell(lineTaxPctOf(r, totals.fallbackPct), "dataNum"),
      cell(vatOf(r, totals.fallbackPct), "dataNum"),
      cell(grandOf(r, totals.fallbackPct), "dataNum"),
    ]);
  });

  rows_.push(blank());

  const gtRow = rows_.length;
  const gtCells: Row = blank();
  gtCells[0] = cell("Total Amount", "grandTotal");
  gtCells[COL_COUNT - 1] = cell(totals.totalAmount, "grandTotalNum");
  rows_.push(gtCells);
  merges.push({ s: { r: gtRow, c: 0 }, e: { r: gtRow, c: COL_COUNT - 2 } });

  rows_.push(blank());
  rows_.push(fullRow(cell(`Reference: ${header.ref_no || "as per above"}`, "meta")));
  mergeFull();

  PO_NOTES.forEach((n) => {
    rows_.push(fullRow(cell(n, "meta")));
    mergeFull();
  });

  rows_.push(blank());
  const sRow = rows_.length;
  const signRow: Row = blank();
  signRow[0] = cell("For Supplier — Signature / Date", "meta");
  signRow[6] = cell(`For ${header.div_name || "Company"} — Signature / Date`, "meta");
  rows_.push(signRow);
  merges.push({ s: { r: sRow, c: 0 }, e: { r: sRow, c: 5 } });
  merges.push({ s: { r: sRow, c: 6 }, e: { r: sRow, c: COL_COUNT - 1 } });

  const footRow: Row = blank();
  footRow[COL_COUNT - 1] = cell("Powered by Bayanat Technology", "footer");
  rows_.push(footRow);

  const { buildZip } = buildExcelStyles();
  return buildZip(COL_COUNT, rows_, merges, "Purchase Order Tax");
}

// ─── Route handlers ─────────────────────────────────────────────────────────

export const getPurchaseOrderReportCopyHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadPurchaseOrderData(req, params);
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for this PO." });
      return;
    }

    const companyCode =
      params.company_code ||
      text(req.user?.company_code) ||
      text(req.query.company_code) ||
      "BSG";

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: "Purchase Order Tax",
      userName: params.loginid,
      endLabel: "Powered by Bayanat Technology",
    });
    const bodyHtml = renderPoBody(rows, params.loginid).replace(/>\s+</g, "><");

    const html = buildReportDocument({
      title: `Purchase Order ${buildHeader(rows).doc_no}`,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: PO_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
      orientation: "landscape",
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Purchase Order Tax Report HTML error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate report",
    });
  }
};

export const getPurchaseOrderTaxReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadPurchaseOrderData(req, params);
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for this PO." });
      return;
    }
    const buffer = buildPoTaxExcelBuffer(rows, params.loginid);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Purchase_Order_Tax.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("Purchase Order Tax Report Excel error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate Excel",
    });
  }
};

// Same handler under the name the router already uses
export const getPurchaseOrderReportCopyExcel = getPurchaseOrderTaxReportExcel;