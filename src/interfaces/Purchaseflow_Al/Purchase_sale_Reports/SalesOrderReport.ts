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
  doc_type: string;
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

// ─── Param extraction ───────────────────────────────────────────────────────

function extractParams(req: RequestWithUser): ReqParams {
  const b = req.body || {};
  return {
    loginid: text(req.user?.loginid) || text(b.loginid) || "ADMIN",
    company_code: text(b.company_code),
    doc_type: text(b.doc_type) || "SO",
    doc_no: text(b.doc_no),
  };
}

function resolveCompanyCode(req: RequestWithUser, params: ReqParams): string {
  return (
    params.company_code ||
    text(req.user?.company_code) ||
    text(req.query.company_code) ||
    "BSG"
  );
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

    console.log("=== GENERATED SQL (Sales Order) ===\n", rawSql, "\n=== END ===");

    const dataResult = await conn.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return normalize(dataResult.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Cancel helpers ─────────────────────────────────────────────────────────

const flagY = (v: unknown) => ["Y", "YES", "1", "TRUE"].includes(text(v).trim().toUpperCase());
const isCancelledRow = (r: ReportRow): boolean =>
  flagY(r.cancelled) || flagY(r.canceled) || flagY(r.det_cancel);
/** Document is cancelled when every line is cancelled */
const isCancelledDoc = (rows: ReportRow[]): boolean =>
  rows.length > 0 && rows.every(isCancelledRow);

// ─── Header model ───────────────────────────────────────────────────────────

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
  cust_mobile: string;
  cust_email: string;
  user_id: string;
  payment_terms: string;
  dlvr_term: string;
  remarks: string;
  ref_no: string;
  total_discount: number;
  disc_hdr_price: number;
  disc_hdr_percent: number;
  cancelled: boolean;
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
    cust_mobile: text(h.cust_mobile),
    cust_email: text(h.cust_email || h.e_mail),
    user_id: text(h.user_id),
    payment_terms: text(h.payment_terms),
    // ⚠ Check the "=== GENERATED SQL (Sales Order) ===" console log: if the delivery term /
    // remarks / reference columns have different names, add them to these lines.
    dlvr_term: text(h.dlvr_term || h.delivery_term),
    remarks: text(h.remarks || h.hdr_remarks),
    ref_no: text(h.ref_no),
    disc_hdr_price: num(h.disc_hdr_price),
    disc_hdr_percent: num(h.disc_hdr_percent),
    total_discount: num(h.total_discount),
    cancelled: isCancelledDoc(rows),
  };
}

// ─── Line / totals calculations (unchanged logic) ──────────────────────────

const lineDiscOf = (r: ReportRow) =>
  num(r.disc_price) || (num(r.quantity) * num(r.unit_price) * num(r.disc_percent)) / 100;

function computeTotals(rows: ReportRow[], header: SoHeader) {
  const totalQty = rows.reduce((s, r) => s + num(r.quantity), 0);

  // Gross = qty × rate
  const totalAmount = rows.reduce((s, r) => s + num(r.quantity) * num(r.unit_price), 0);

  const lineDiscount = rows.reduce((s, r) => s + lineDiscOf(r), 0);

  const lineNet = totalAmount - lineDiscount;
  const headerDiscount =
    header.disc_hdr_price || (lineNet * header.disc_hdr_percent) / 100;

  const discount = lineDiscount + headerDiscount;
  const exclusiveVat = totalAmount - discount;
  const vatAmount = 0;
  const inclusiveVat = exclusiveVat + vatAmount;

  return { totalQty, totalAmount, discount, exclusiveVat, vatAmount, inclusiveVat };
}

/** Product name (+ line remarks). The product code is intentionally not shown. */
const productText = (r: ReportRow) =>
  `${text(r.prod_name)}${r.det_remarks ? ` — ${text(r.det_remarks)}` : ""}`;

// ─── Layout CSS — same visual system as Sales Invoice ──────────────────────

const SALES_ORDER_EXTRA_CSS = `
  .center { text-align: center; }
  h1.center { margin: 4px 0 12px; font-size: 18px; font-weight: 800; color: #0b4ca1; letter-spacing: 1px; }
  .si-cancel-text { text-align: center; color: #dc2626; font-weight: 700; font-size: 12px; margin: -6px 0 10px; letter-spacing: 1px; }

  table.grn-two-col { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 10px 0; margin: 0 -10px 14px; }
  .grn-two-col > tbody > tr > td { vertical-align: top; padding: 0; }
  table.po-two-col > tbody > tr > td:first-child { width: 60% !important; }
  table.po-two-col > tbody > tr > td:last-child  { width: 40% !important; }

  table.pr-kv-box { width: 100%; border-collapse: collapse; border: 1px solid #cbd5e1; background: #fff; font-size: 11px; }
  .pr-kv-box thead th { text-align: left; padding: 4px 10px; color: #0b4ca1; background: #eff6ff; font-size: 11px; font-weight: 700; border-bottom: 2px solid #0b4ca1; }
  .pr-kv-box tbody td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; color: #334155; vertical-align: top; overflow-wrap: anywhere; }
  .pr-kv-box tbody tr:last-child td { border-bottom: none; }
  .pr-kv-box tbody td:nth-child(2) { width: 12px; text-align: center; }
  .pr-kv-box.po-kv-to tbody td:first-child { width: 18%; }
  .pr-kv-box.po-kv-details tbody td:first-child { width: 38%; }

  /* Payment / Delivery / Remarks strip + items table: same grid look */
  table.po-terms, table.po-items { border-collapse: collapse; }
  table.po-terms th, table.po-terms td,
  table.po-items th, table.po-items td { border: 1px solid #4a6fa5 !important; }
  table.po-terms { margin-bottom: 12px; }
  table.po-terms th, table.po-terms td { width: 33.333% !important; text-align: center; overflow-wrap: anywhere; }

  .data-table { width: 100%; table-layout: auto; }
  .data-table th, .data-table td { font-size: 10.5px; padding: 6px 5px; }
  .data-table td:nth-child(2) { min-width: 140px; }

  .status-badge {
    display: inline-block;
    margin-left: 8px;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    vertical-align: middle;
  }
  .status-CANCELLED { background: #fee2e2; color: #dc2626; }

  .totals-box {
    margin-top: 16px;
    margin-left: auto;
    width: 280px;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    overflow: hidden;
    page-break-inside: avoid;
  }
  .totals-box .row {
    display: flex;
    justify-content: space-between;
    padding: 6px 14px;
    font-size: 11.5px;
    border-bottom: 1px solid #f1f5f9;
  }
  .totals-box .row.grand {
    background: #0b4ca1;
    color: #fff;
    font-weight: 700;
    font-size: 13px;
    border-bottom: none;
  }

  /* 4 signature labels (the frontend pins these to the page footer in the PDF) */
  .dn-sign { width: 100%; margin-top: 40px; border-collapse: collapse; page-break-inside: avoid; }
  .dn-sign td { width: 25%; text-align: center; padding-top: 28px; border-top: 1px solid #64748b; font-size: 10px; }
`;

const REPORT_TITLE = "Sales Order";

// ─── Boxed header helpers (same markup the frontend PDF already understands) ─

type KvPair = [string, string];

/** One boxed table: light-blue title row + "Label : value" rows (values bold). */
function kvBoxHtml(title: string, pairs: KvPair[], cls = ""): string {
  const rows = pairs
    .map(([k, v]) => "<tr><td>" + escapeHtml(k) + "</td><td>:</td><td><b>" + escapeHtml(v || "-") + "</b></td></tr>")
    .join("");
  return (
    '<table class="pr-kv-box ' + cls + '">' +
    '<thead><tr><th colspan="3">' + escapeHtml(title) + "</th></tr></thead>" +
    "<tbody>" + rows + "</tbody>" +
    "</table>"
  );
}

/** Two boxes side by side (To wider 60%, SO Details narrower 40%). */
function kvTwoBoxesHtml(leftTitle: string, left: KvPair[], rightTitle: string, right: KvPair[]): string {
  return (
    '<table class="grn-two-col po-two-col po-two-wide"><tbody><tr>' +
    "<td>" + kvBoxHtml(leftTitle, left, "po-kv-to") + "</td>" +
    "<td>" + kvBoxHtml(rightTitle, right, "po-kv-details po-kv-wide") + "</td>" +
    "</tr></tbody></table>"
  );
}

/** First `required` pairs are always shown; the rest only when filled. */
const keepFilled = (pairs: KvPair[], required: number): KvPair[] =>
  pairs.filter(([, v], i) => i < required || !!text(v).trim());

/** Centered, uppercase, underlined title (+ red CANCELLED line when the document is cancelled). */
function reportTitleHtml(title: string, cancelled = false): string {
  return (
    `<h1 class="center"><u>${escapeHtml(title.toUpperCase())}</u></h1>` +
    (cancelled ? `<p class="center si-cancel-text">CANCELLED</p>` : "")
  );
}

/** PAYMENT TERM | DELIVERY TERM / PERIOD | REMARKS strip. */
function soTermsStripHtml(header: SoHeader): string {
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

const SIGN_LABELS = ["Prepared By", "Checked By", "Delivered By", "Receiver's Name & Signature"];

function signHtml(labels: string[] = SIGN_LABELS): string {
  return `<table class="dn-sign"><tbody><tr>${labels
    .map((label) => `<td class="center"><strong>${escapeHtml(label)}</strong></td>`)
    .join("")}</tr></tbody></table>`;
}

// ─── Body ───────────────────────────────────────────────────────────────────

function renderSalesOrderBody(rows: ReportRow[], _loginId: string): string {
  const header = buildHeader(rows);
  const totals = computeTotals(rows, header);

  const bodyRows = rows
    .map(
      (r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(productText(r))}</td>
          <td>${escapeHtml(r.p_uom)}</td>
          <td class="right">${qtyFmt(r.quantity)}</td>
          <td class="right">${amtFmt(r.unit_price)}</td>
          <td class="right">${amtFmt(lineDiscOf(r))}</td>
          <td class="right amount">${amtFmt(r.amount)}</td>
        </tr>`
    )
    .join("");

  const partyPairs: KvPair[] = keepFilled(
    [
      ["Customer", header.party_name],
      ["Address", header.party_address],
      ["Tel", header.party_phone],
      ["Fax", header.party_fax],
      ["Mobile", header.cust_mobile],
      ["Email", header.cust_email],
    ],
    1
  );

  const detailPairs: KvPair[] = keepFilled(
    [
      ["SO No", header.doc_no],
      ["Date", dateText(header.doc_date)],
      // ["A/C Code", header.ac_code],
      ["Sold By", header.user_id],
    ],
    3
  );

  return `
    ${reportTitleHtml(REPORT_TITLE, header.cancelled)}

    ${kvTwoBoxesHtml("To", partyPairs, "SO Details", detailPairs)}

    ${rows.length === 0
      ? `<div class="empty">No line items found for this order.</div>`
      : `
      ${soTermsStripHtml(header)}

      <table class="data-table si-items po-items">
        <thead>
          <tr>
            <th>S.No</th>
            <th>Product / Description</th>
            <th>Unit</th>
            <th class="right">Qty</th>
            <th class="right">Unit Rate</th>
            <th class="right">Disc</th>
            <th class="right">Amount</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>

      <div class="totals-box">
        <div class="row"><span>Total Quantity</span><span>${qtyFmt(totals.totalQty)}</span></div>
        <div class="row"><span>Total Amount</span><span>${amtFmt(totals.totalAmount)}</span></div>
        <div class="row"><span>Overall Discount</span><span>${amtFmt(totals.discount)}</span></div>
        <div class="row grand"><span>Net Amount</span><span>${amtFmt(totals.inclusiveVat)}</span></div>
      </div>

      ${header.ref_no ? `<p><strong>Reference:</strong> ${escapeHtml(header.ref_no)}</p>` : ""}
      ${signHtml()}`
    }
  `;
}

// ─── Excel builder ───────────────────────────────────────────────────────

function buildExcelBuffer(rows: ReportRow[], _loginId: string): Buffer {
  const BLUE = "FF1D4ED8";
  const WHITE = "FFFFFFFF";
  const GREEN_BG = "FFD1FAE5";

  const header = buildHeader(rows);
  const totals = computeTotals(rows, header);

  const COL_COUNT = 7; // S.No, Product, Unit, Qty, Unit Rate, Disc, Amount

  interface XlCell { v: unknown; styleKey: string }
  type Row = (XlCell | null)[];
  const rows_: Row[] = [];
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];

  const cell = (v: unknown, styleKey: string): XlCell => ({ v, styleKey });

  // Row 0: title
  rows_.push([
    cell(`${REPORT_TITLE} - ${header.doc_no}${header.cancelled ? " (CANCELLED)" : ""}`, "title"),
    ...new Array(COL_COUNT - 1).fill(null),
  ]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  // Row 1: To | Date / A/C / Sold By
  rows_.push([
    cell(`To: ${[header.party_name, header.party_address].filter(Boolean).join(", ")}`, "meta"), null, null,
    cell(
      `Date: ${dateText(header.doc_date)}   A/C: ${header.ac_code}${header.user_id ? `   Sold By: ${header.user_id}` : ""}`,
      "meta"
    ),
    null, null, null,
  ]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 2 } });
  merges.push({ s: { r: 1, c: 3 }, e: { r: 1, c: COL_COUNT - 1 } });

  // Row 2: Payment Term / Delivery Term / Remarks
  rows_.push([
    cell(
      `Payment Term: ${header.payment_terms || "-"}   Delivery Term / Period: ${header.dlvr_term || "-"}   Remarks: ${header.remarks || "-"}`,
      "meta"
    ),
    ...new Array(COL_COUNT - 1).fill(null),
  ]);
  merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: COL_COUNT - 1 } });

  rows_.push(new Array(COL_COUNT).fill(null));

  rows_.push([
    cell("S.No", "header"), cell("Product / Description", "header"), cell("Unit", "header"),
    cell("Qty", "header"), cell("Unit Rate", "header"), cell("Disc", "header"), cell("Amount", "header"),
  ]);

  rows.forEach((r, i) => {
    rows_.push([
      cell(i + 1, "data"),
      cell(productText(r), "data"),
      cell(text(r.p_uom), "data"),
      cell(num(r.quantity), "dataNum"),
      cell(num(r.unit_price), "dataNum"),
      cell(lineDiscOf(r), "dataNum"),
      cell(num(r.amount), "dataNum"),
    ]);
  });

  rows_.push(new Array(COL_COUNT).fill(null));

  const addTotal = (label: string, value: number, grand = false) => {
    const r = rows_.length;
    const arr: Row = new Array(COL_COUNT).fill(null);
    arr[0] = cell(label, grand ? "grandTotal" : "groupTotal");
    arr[COL_COUNT - 1] = cell(value, grand ? "grandTotalNum" : "groupTotalNum");
    rows_.push(arr);
    merges.push({ s: { r, c: 0 }, e: { r, c: COL_COUNT - 2 } });
  };
  addTotal("Total Quantity", totals.totalQty);
  addTotal("Total Amount", totals.totalAmount);
  addTotal("Overall Discount", totals.discount);
  addTotal("Net Amount", totals.inclusiveVat, true);

  // Signature row (same 4 labels as the browser / PDF)
  rows_.push(new Array(COL_COUNT).fill(null));
  rows_.push([
    cell("Prepared By", "sign"), null, cell("Checked By", "sign"), null,
    cell("Delivered By", "sign"), null, cell("Receiver's Name & Signature", "sign"),
  ]);
  rows_.push([null, null, null, null, null, null, cell("Powered by Bayanat Technology", "footer")]);

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
    sign: {
      font: { bold: true, sz: 9, color: { rgb: "FF334155" } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: { top: { color: { rgb: "FF64748B" } } },
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

    const companyCode = resolveCompanyCode(req, params);
    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: "rpt_sales_order",
      userName: params.loginid,
      endLabel: "Powered by Bayanat Technology",
    });
    const bodyHtml = renderSalesOrderBody(rows, params.loginid).replace(/>\s+</g, "><");

    const html = buildReportDocument({
      title: `${REPORT_TITLE} ${buildHeader(rows).doc_no}`,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: SALES_ORDER_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
      orientation: "portrait",
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
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