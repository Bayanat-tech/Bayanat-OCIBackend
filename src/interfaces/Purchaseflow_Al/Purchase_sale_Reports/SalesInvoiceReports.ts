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

// ─── DB helpers (same as PurchaseInvoiceReports.ts / po-order-register) ────

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
    doc_type: text(b.doc_type),
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

async function loadSalesInvoiceData(req: RequestWithUser, p: ReqParams, dispatchParam: string): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const binds: any = {
      parameter: dispatchParam,
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
         PROC_BUILD_DYNAMIC_SQL_SALES_INVOICE(
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

    console.log("=== GENERATED SQL (Sales Invoice) ===\n", rawSql, "\n=== END ===");

    const dataResult = await conn.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return normalize(dataResult.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Cancel helpers ─────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Y / YES / 1 / TRUE → true */
const flagY = (v: unknown) => ["Y", "YES", "1", "TRUE"].includes(text(v).trim().toUpperCase());

/** Cancelled if the header flag (from the procedure) or the line flag (DET_CANCEL) is Y */
const isCancelledRow = (r: ReportRow): boolean =>
  flagY(r.cancelled) || flagY(r.canceled) || flagY(r.det_cancel);

/** Document is cancelled when every line is cancelled */
const isCancelledDoc = (rows: ReportRow[]): boolean =>
  rows.length > 0 && rows.every(isCancelledRow);

// ─── Header model (built from the first line-item row) ─────────────────────

interface SalesInvoiceHeader {
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
  payment_terms: string;
  dlvr_term: string;
  remarks: string;
  ref_no: string;
  credit_period: string;
  due_date: any;
  salesman_code: string;
  trn_no: string;
  company_trn_no: string;
  disc_hdr_price: number;
  disc_hdr_percent: number;
  curr_code: string;
  cancelled: boolean;
}

function buildSalesInvoiceHeader(rows: ReportRow[]): SalesInvoiceHeader {
  const h = rows[0] || {};
  const address = [h.party_address, h.cust_add1, h.cust_add2, h.cust_add3].filter(Boolean).join(", ");
  return {
    doc_no: text(h.doc_no),
    doc_date: h.doc_date,
    doc_type: text(h.doc_type),
    div_name: text(h.div_name),
    ac_code: text(h.ac_code),
    party_name: text(h.party_name || h.ac_name),
    party_address: address || text(h.party_address),
    party_phone: text(h.party_phone),
    party_fax: text(h.party_fax),
    cust_mobile: text(h.cust_mobile),
    cust_email: text(h.cust_email),
    payment_terms: text(h.payment_terms),
    // ⚠ Check the "=== GENERATED SQL (Sales Invoice) ===" console log: if the delivery term /
    // remarks columns have different names, add them to these two lines.
    dlvr_term: text(h.dlvr_term || h.delivery_term),
    remarks: text(h.remarks || h.hdr_remarks),
    ref_no: text(h.ref_no),
    credit_period: text(h.credit_period),
    due_date: h.due_date,
    salesman_code: text(h.salesman_code),
    trn_no: text(h.trn_no),
    company_trn_no: text(h.company_trn_no),
    disc_hdr_price: num(h.disc_hdr_price),
    disc_hdr_percent: num(h.disc_hdr_percent),
    curr_code: text(h.curr_code) || "QAR",
    cancelled: isCancelledDoc(rows),
  };
}

// ─── Line / totals calculations ─────────────────────────────────────────────

const lineDiscOf = (r: ReportRow) => {
  const gross = num(r.quantity) * num(r.unit_price);
  return round2(num(r.disc_price) || (gross * num(r.disc_percent)) / 100);
};

const lineGrossOf = (r: ReportRow) => round2(num(r.quantity) * num(r.unit_price));
const lineNetOf = (r: ReportRow) => round2(lineGrossOf(r) - lineDiscOf(r));

function computeInvoiceTotals(rows: ReportRow[], header: SalesInvoiceHeader) {
  const totalQty = rows.reduce((s, r) => s + num(r.quantity), 0);
  const totalAmount = round2(rows.reduce((s, r) => s + lineGrossOf(r), 0));
  const lineDiscount = round2(rows.reduce((s, r) => s + lineDiscOf(r), 0));

  // Header-level discount is applied only when there are no line discounts
  const headerDiscount =
    lineDiscount > 0
      ? 0
      : round2(header.disc_hdr_price || (totalAmount * header.disc_hdr_percent) / 100);

  const overallDiscount = round2(lineDiscount + headerDiscount);
  const grandTotal = round2(totalAmount - overallDiscount);
  const totalTax = round2(rows.reduce((s, r) => s + num(r.tx_compnt_amt_1), 0));

  return { totalQty, totalAmount, overallDiscount, grandTotal, totalTax };
}

// ─── Layout CSS — same visual system as Purchase Invoice ───────────────────

// Shared: centered title, To / Details boxes, grid tables, terms strip, signature
const SI_BOX_CSS = `
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

  /* Keep notes + signature together; signature table stays 50/50 */
  .po-sign-block, .po-sign-block table, .po-sign-block tr, .po-sign-block td, .po-sign-block th {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
  table.po-sign th, table.po-sign td { width: 50% !important; }
`;

const SI_TOTALS_CSS = `
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
`;

// Sales Invoice (portrait) + Account Details
const SALES_INVOICE_EXTRA_CSS = `
  ${SI_TOTALS_CSS}

  .data-table { width: 100%; table-layout: auto; }
  .data-table th, .data-table td { font-size: 10.5px; padding: 6px 5px; }
  .data-table td:nth-child(2) { min-width: 140px; }

  ${SI_BOX_CSS}
`;

// Sales Invoice (Tax) — landscape
const SALES_INVOICE_TAX_EXTRA_CSS = `${SALES_INVOICE_EXTRA_CSS}
  @page { size: A4 landscape; margin: 10mm; }

  .data-table { width: 100% !important; table-layout: fixed !important; }
  .data-table th,
  .data-table td {
    font-size: 9.5px !important;
    padding: 5px 4px !important;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .data-table th:nth-child(1), .data-table td:nth-child(1)   { width: 5%; }
  .data-table th:nth-child(2), .data-table td:nth-child(2)   { width: 21%; }
  .data-table th:nth-child(3), .data-table td:nth-child(3)   { width: 6%; }
  .data-table th:nth-child(4), .data-table td:nth-child(4)   { width: 7%; }
  .data-table th:nth-child(5), .data-table td:nth-child(5)   { width: 9%; }
  .data-table th:nth-child(6), .data-table td:nth-child(6)   { width: 10%; }
  .data-table th:nth-child(7), .data-table td:nth-child(7)   { width: 10%; }
  .data-table th:nth-child(8), .data-table td:nth-child(8)   { width: 7%; }
  .data-table th:nth-child(9), .data-table td:nth-child(9)   { width: 10%; }
  .data-table th:nth-child(10), .data-table td:nth-child(10) { width: 15%; }
`;

// Sales Invoice (Tax) — portrait
const SALES_INVOICE_TAX_PORTRAIT_CSS = `
  ${SI_TOTALS_CSS}

  table.data-table.pi-portrait { width: 100%; table-layout: fixed; }
  table.data-table.pi-portrait th,
  table.data-table.pi-portrait td {
    font-size: 9px;
    padding: 5px 3px;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  ${SI_BOX_CSS}
`;

const TAX_TABLE_FIX_HTML = `
<style>
  @page { size: A4 landscape; margin: 10mm; }
  body table.data-table { width: 100% !important; table-layout: fixed !important; }
  body table.data-table th,
  body table.data-table td {
    font-size: 9.5px !important;
    padding: 5px 4px !important;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
</style>`;

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

/** Two boxes side by side (To wider 60%, Invoice Details narrower 40%). */
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

// ─── Shared body pieces ─────────────────────────────────────────────────────

/** Old blue-line title (still used by Account Details; supports the CANCELLED tag). */
function printMetaHtml(title: string, _subtitle: string, _printDateTime: string, _loginId: string, cancelled = false): string {
  if (cancelled) {
    return `
    <table class="si-top-line si-top-cancel"><tbody><tr>
      <td><h1 class="report-title">${escapeHtml(title)}</h1></td>
      <td class="si-cancel-tag center">CANCELLED</td>
    </tr></tbody></table>`;
  }
  return `
    <table class="si-top-line"><tbody><tr><td>
      <h1 class="report-title">${escapeHtml(title)}</h1>
    </td></tr></tbody></table>`;
}

/** Centered, uppercase, underlined title (+ red CANCELLED line when the document is cancelled). */
function reportTitleHtml(title: string, cancelled = false): string {
  return (
    `<h1 class="center"><u>${escapeHtml(title.toUpperCase())}</u></h1>` +
    (cancelled ? `<p class="center si-cancel-text">CANCELLED</p>` : "")
  );
}

const INVOICE_NOTES: string[] = [
  "1. Please quote the invoice number in all payments and correspondence.",
  "2. Goods once sold will not be taken back.",
];
const INVOICE_APPROVAL_TEXT = "This Document Is Electronically Approved";

/** Reference + notes (stay in the page) + signature table (pinned to the footer by the frontend). */
function invoiceSignHtml(header: SalesInvoiceHeader): string {
  return `
    <div class="po-sign-block">
      ${header.ref_no ? `<div class="group"><span class="strong">Reference: ${escapeHtml(header.ref_no)}</span></div>` : ""}
      <div class="group">${INVOICE_NOTES.map((t) => `<div class="muted">${escapeHtml(t)}</div>`).join("")}</div>

      <table class="data-table po-sign">
        <thead>
          <tr>
            <th class="center">For Customer:</th>
            <th class="center">For ${escapeHtml(header.div_name || "Company")}:</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <b>I have received the goods in good condition.</b>
              <br/><br/><br/>
              Signature: ______________________ &nbsp; Date: ______________
            </td>
            <td class="center">
              ${escapeHtml(INVOICE_APPROVAL_TEXT)}
              <br/><br/><br/>
              Signature: ______________________ &nbsp; Date: ______________
            </td>
          </tr>
        </tbody>
      </table>
    </div>`;
}

/** PAYMENT TERM | DELIVERY TERM / PERIOD | REMARKS strip. */
function invoiceTermsStripHtml(header: SalesInvoiceHeader): string {
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

/** "To" box rows – empty fields are skipped, the customer name is always shown. */
function partyPairs(header: SalesInvoiceHeader): KvPair[] {
  return keepFilled(
    [
      ["Customer", header.party_name],
      ["Address", header.party_address],
      ["Tel", header.party_phone],
      ["Fax", header.party_fax],
      ["Mobile", header.cust_mobile],
      ["Email", header.cust_email],
      ["TRN No", header.trn_no],
    ],
    1
  );
}

function invoiceDetailPairs(header: SalesInvoiceHeader): KvPair[] {
  return keepFilled(
    [
      ["Doc No", header.doc_no],
      ["Date", dateText(header.doc_date)],
      // ["A/C Code", header.ac_code],
      ["Due Date", header.due_date ? dateText(header.due_date) : ""],
      ["Sold By", header.salesman_code],
    ],
    3
  );
}

function invoiceTaxDetailPairs(header: SalesInvoiceHeader): KvPair[] {
  return keepFilled(
    [
      ["Doc No", header.doc_no],
      ["Date", dateText(header.doc_date)],
      // ["A/C Code", header.ac_code],
      ["Company TRN No", header.company_trn_no],
      ["Sold By", header.salesman_code],
    ],
    4
  );
}

// ─── Body 1: Sales Invoice ───────────────────────────────────────────────

function renderSalesInvoiceBody(rows: ReportRow[], _loginId: string): string {
  const header = buildSalesInvoiceHeader(rows);
  const t = computeInvoiceTotals(rows, header);

  const bodyRows = rows.map((r, i) => `
  <tr>
    <td>${i + 1}</td>
  <td>${escapeHtml(r.full_prod_name || r.prod_name)}${r.det_remarks ? ` — ${escapeHtml(r.det_remarks)}` : ""}</td>
    <td>${escapeHtml(r.p_uom)}</td>
    <td class="right">${qtyFmt(r.quantity)}</td>
    <td class="right">${amtFmt(r.unit_price)}</td>
    <td class="right">${amtFmt(lineDiscOf(r))}</td>
    <td class="right amount">${amtFmt(r.amount)}</td>
  </tr>`).join("");

  return `
    ${reportTitleHtml("Sales Invoice", header.cancelled)}

    ${kvTwoBoxesHtml("To", partyPairs(header), "Invoice Details", invoiceDetailPairs(header))}

    ${invoiceTermsStripHtml(header)}

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
      <div class="row"><span>Total Quantity</span><span>${qtyFmt(t.totalQty)}</span></div>
      <div class="row"><span>Total Amount</span><span>${amtFmt(t.totalAmount)}</span></div>
      <div class="row"><span>Overall Discount</span><span>${amtFmt(t.overallDiscount)}</span></div>
      <div class="row grand"><span>Grand Total</span><span>${amtFmt(t.grandTotal)}</span></div>
    </div>

    ${invoiceSignHtml(header)}`;
}

// ─── Body 2: Sales Invoice (Tax) ───────────────────────────────────────────

function renderSalesInvoiceTaxBody(
  rows: ReportRow[],
  _loginId: string,
  orientation: "portrait" | "landscape" = "landscape"
): string {
  const isPortrait = orientation === "portrait";

  const header = buildSalesInvoiceHeader(rows);
  const t = computeInvoiceTotals(rows, header);
  const netTotal = round2(t.grandTotal + t.totalTax);

  rows.forEach((r) => {
    const expected = round2((lineNetOf(r) * num(r.tx_compnt_perc_1)) / 100);
    if (Math.abs(expected - num(r.tx_compnt_amt_1)) > 0.01) {
      console.warn("Tax mismatch", r.doc_no, r.prod_code, "expected:", expected, "db:", r.tx_compnt_amt_1);
    }
  });

  const bodyRows = rows
    .map((r, i) => {
      const net = lineNetOf(r);
      const amountInclTax = round2(net + num(r.tx_compnt_amt_1));
      return `
        <tr>
          <td>${i + 1}</td>
         <td>${escapeHtml(r.full_prod_name || r.prod_name)}${r.det_remarks ? ` — ${escapeHtml(r.det_remarks)}` : ""}</td>
          <td>${escapeHtml(r.p_uom)}</td>
          <td class="right">${qtyFmt(r.quantity)}</td>
          <td class="right">${amtFmt(r.unit_price)}</td>
          <td class="right">${amtFmt(lineDiscOf(r))}</td>
          <td class="right">${amtFmt(net)}</td>
          <td class="right">${amtFmt(r.tx_compnt_perc_1)}%</td>
          <td class="right">${amtFmt(r.tx_compnt_amt_1)}</td>
          <td class="right amount">${amtFmt(amountInclTax)}</td>
        </tr>`;
    })
    .join("");

  return `
    ${isPortrait ? "" : TAX_TABLE_FIX_HTML}
    ${reportTitleHtml("Sales Invoice (Tax)", header.cancelled)}

    ${kvTwoBoxesHtml("To", partyPairs(header), "Invoice Details", invoiceTaxDetailPairs(header))}

    ${invoiceTermsStripHtml(header)}

   <table class="data-table pi-portrait si-items-tax po-items po-items-ext" style="${isPortrait ? "" : "width:100%;table-layout:fixed;"}">
      <colgroup>
        ${isPortrait
          ? `<col style="width:5%"><col style="width:21%"><col style="width:6%"><col style="width:6%">
             <col style="width:9%"><col style="width:10%"><col style="width:11%"><col style="width:7%">
             <col style="width:9%"><col style="width:16%">`
          : `<col style="width:5%"><col style="width:21%"><col style="width:6%"><col style="width:7%">
             <col style="width:9%"><col style="width:10%"><col style="width:10%"><col style="width:7%">
             <col style="width:10%"><col style="width:15%">`}
      </colgroup>
      <thead>
        <tr>
          <th>S.No</th>
          <th>Product / Description</th>
          <th>Unit</th>
          <th class="right">Qty</th>
          <th class="right">${isPortrait ? "Rate" : "Unit Rate"}</th>
          <th class="right">${isPortrait ? "Disc." : "Discount"}</th>
          <th class="right">Amount</th>
          <th class="right">VAT %</th>
          <th class="right">${isPortrait ? "Tax Amt" : "Tax Amount"}</th>
          <th class="right">${isPortrait ? "Total" : "Amount (Inc. Tax)"}</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>

    <div class="totals-box">
      <div class="row"><span>Total Quantity</span><span>${qtyFmt(t.totalQty)}</span></div>
      <div class="row"><span>Total Amount</span><span>${amtFmt(t.totalAmount)}</span></div>
      <div class="row"><span>Overall Discount</span><span>${amtFmt(t.overallDiscount)}</span></div>
      <div class="row"><span>Tax Amount</span><span>${amtFmt(t.totalTax)}</span></div>
      <div class="row grand"><span>Total (Inclusive Tax)</span><span>${amtFmt(netTotal)}</span></div>
    </div>

    ${invoiceSignHtml(header)}`;
}

// ─── Body 3: Sales - Account Details ───────────────────────────────────────

function renderSalesAccountDetailsBody(rows: ReportRow[], loginId: string): string {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  let totalDebit = 0;
  let totalCredit = 0;
  const bodyRows = rows
    .map((r) => {
      const amount = num(r.amount);
      const isDebit = num(r.sign_ind) >= 0;
      const debit = isDebit ? amount : 0;
      const credit = !isDebit ? Math.abs(amount) : 0;
      totalDebit += debit;
      totalCredit += credit;
      return `
        <tr>
          <td>${escapeHtml(r.doc_type)}</td>
          <td>${escapeHtml(r.doc_no)}</td>
          <td>${escapeHtml(dateText(r.doc_date))}</td>
          <td>${escapeHtml(r.ac_code)}</td>
          <td>${escapeHtml(r.ac_name)}</td>
          <td>${escapeHtml(r.curr_code)}</td>
          <td class="right">${qtyFmt(r.ex_rate)}</td>
          <td class="right">${debit ? amtFmt(debit) : "\u2014"}</td>
          <td class="right amount">${credit ? amtFmt(credit) : "\u2014"}</td>
        </tr>`;
    })
    .join("");

  return `
    ${printMetaHtml("Invoice", "Report — rpt_pr_accountledger", printDateTime, loginId, isCancelledDoc(rows))}

    <table class="data-table">
      <thead>
        <tr>
          <th>Type</th>
          <th>Doc No</th>
          <th>Doc Date</th>
          <th>Ac Code</th>
          <th>Ac Name</th>
          <th>Curr Code</th>
          <th class="right">Ex. Rate</th>
          <th class="right">Debit</th>
          <th class="right">Credit</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>

    <div class="totals-box">
      <div class="row"><span>Total Debit</span><span>${amtFmt(totalDebit)}</span></div>
      <div class="row grand"><span>Total Credit</span><span>${amtFmt(totalCredit)}</span></div>
    </div>`;
}

// ─── Route handlers (HTML) ──────────────────────────────────────────────────

export const getSalesInvoiceReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadSalesInvoiceData(req, params, "S_INVOICE_SI_19082026");
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected document." });
      return;
    }

    const companyCode = resolveCompanyCode(req, params);
    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: "rpt_sales_invoice",
      userName: params.loginid,
      endLabel: "Powered by Bayanat Technology",
    });
    const bodyHtml = renderSalesInvoiceBody(rows, params.loginid).replace(/>\s+</g, "><");

    const html = buildReportDocument({
      title: "Sales Invoice",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: SALES_INVOICE_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Sales Invoice report error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getSalesInvoiceTaxReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const orientation: "portrait" | "landscape" =
      text(req.body?.orientation || req.query?.orientation).toLowerCase() === "portrait" ? "portrait" : "landscape";

    const rows = await loadSalesInvoiceData(req, params, "S_INVOICE_SI_TAX_19082026");
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected document." });
      return;
    }

    const companyCode = resolveCompanyCode(req, params);
    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: "rpt_sales_invoice_tax",
      userName: params.loginid,
      endLabel: "Powered by Bayanat Technology",
    });
    const bodyHtml = renderSalesInvoiceTaxBody(rows, params.loginid, orientation).replace(/>\s+</g, "><");

    const html = buildReportDocument({
      title: "Sales Invoice (Tax)",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: orientation === "portrait" ? SALES_INVOICE_TAX_PORTRAIT_CSS : SALES_INVOICE_TAX_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
      ...(orientation === "landscape" ? { orientation } : {}),
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Sales Invoice Tax report error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getSalesAccountDetailsReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadSalesInvoiceData(req, params, "S_INVOICE_ACCOUNT_DETAIL_19082026");
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected document." });
      return;
    }

    const companyCode = resolveCompanyCode(req, params);
    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: "rpt_pr_accountledger",
      userName: params.loginid,
      endLabel: "Powered by Bayanat Technology",
    });
    const bodyHtml = renderSalesAccountDetailsBody(rows, params.loginid).replace(/>\s+</g, "><");

    const html = buildReportDocument({
      title: "Account Details",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: SALES_INVOICE_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Sales Account Details report error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

// ─── Generic OOXML Excel builder engine (shared by all 3 reports) ───────────

interface XlCell { v: unknown; styleKey: string }
type XlRow = (XlCell | null)[];
interface XlMerge { s: { r: number; c: number }; e: { r: number; c: number } }

const XL_BLUE = "FF1D4ED8";
const XL_WHITE = "FFFFFFFF";
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
    data: { font: { sz: 10 }, alignment: { vertical: "center" }, border: { bottom: borderThin("FFF3F4F6") } },
    dataNum: {
      font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.00", border: { bottom: borderThin("FFF3F4F6") },
    },
    dataNumInt: {
      font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0", border: { bottom: borderThin("FFF3F4F6") },
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
      numFmt: "#,##0.00",
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
      numFmt: "#,##0.00",
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

/** Payment / Delivery / Remarks line used in both invoice Excel files. */
function termsLine(header: SalesInvoiceHeader): string {
  return `Payment Term: ${header.payment_terms || "-"}   Delivery Term / Period: ${header.dlvr_term || "-"}   Remarks: ${header.remarks || "-"}`;
}

// ─── Excel builder 1: Sales Invoice ─────────────────────────────────────────

function buildSalesInvoiceExcelBuffer(rows: ReportRow[]): Buffer {
  const header = buildSalesInvoiceHeader(rows);
  const t = computeInvoiceTotals(rows, header);
  const COL_COUNT = 7; // S.No, Product, Unit, Qty, Unit Rate, Disc, Amount
  const rows_: XlRow[] = [];
  const merges: XlMerge[] = [];

  rows_.push([
    xlCell(`Sales Invoice - ${header.doc_no}${header.cancelled ? " (CANCELLED)" : ""}`, "title"),
    ...new Array(COL_COUNT - 1).fill(null),
  ]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  rows_.push([
    xlCell(`To: ${header.party_name}${header.party_address ? ", " + header.party_address : ""}`, "meta"), null, null,
    xlCell(`Date: ${dateText(header.doc_date)}   A/C: ${header.ac_code}`, "meta"), null, null, null,
  ]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 2 } });
  merges.push({ s: { r: 1, c: 3 }, e: { r: 1, c: 6 } });

  // Payment Term / Delivery Term / Remarks
  rows_.push([xlCell(termsLine(header), "meta"), ...new Array(COL_COUNT - 1).fill(null)]);
  merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: COL_COUNT - 1 } });

  rows_.push(new Array(COL_COUNT).fill(null));

  rows_.push([
    xlCell("S.No", "header"), xlCell("Product / Description", "header"), xlCell("Unit", "header"),
    xlCell("Qty", "header"), xlCell("Unit Rate", "header"), xlCell("Disc", "header"), xlCell("Amount", "header"),
  ]);

  rows.forEach((r, i) => {
    rows_.push([
      xlCell(i + 1, "data"),
     xlCell(text(r.full_prod_name || r.prod_name), "data"),
      xlCell(text(r.p_uom), "data"),
      xlCell(num(r.quantity), "dataNum"),
      xlCell(num(r.unit_price), "dataNum"),
      xlCell(lineDiscOf(r), "dataNum"),
      xlCell(lineNetOf(r), "dataNum"),
    ]);
  });

  rows_.push(new Array(COL_COUNT).fill(null));

  const addTotal = (label: string, value: number, grand = false) => {
    const r = rows_.length;
    const arr: XlRow = new Array(COL_COUNT).fill(null);
    arr[0] = xlCell(label, grand ? "grandTotal" : "groupTotal");
    arr[COL_COUNT - 1] = xlCell(value, grand ? "grandTotalNum" : "groupTotalNum");
    rows_.push(arr);
    merges.push({ s: { r, c: 0 }, e: { r, c: COL_COUNT - 2 } });
  };
  addTotal("Total Amount", t.totalAmount);
  addTotal("Overall Discount", t.overallDiscount);
  addTotal("Grand Total", t.grandTotal, true);

  const footer: XlRow = new Array(COL_COUNT).fill(null);
  footer[COL_COUNT - 1] = xlCell("Powered by Bayanat Technology", "footer");
  rows_.push(footer);

  return buildXlsxBuffer("Sales Invoice", COL_COUNT, 20, rows_, merges, defaultXlStyleDefs());
}

// ─── Excel builder 2: Sales Invoice (Tax) ───────────────────────────────────

function buildSalesInvoiceTaxExcelBuffer(rows: ReportRow[]): Buffer {
  const header = buildSalesInvoiceHeader(rows);
  const t = computeInvoiceTotals(rows, header);
  const netTotal = round2(t.grandTotal + t.totalTax);
  const COL_COUNT = 10; // S.No, Product, Unit, Qty, Rate, Disc, Amount, VAT%, Tax, Amount(Inc Tax)
  const rows_: XlRow[] = [];
  const merges: XlMerge[] = [];

  rows_.push([
    xlCell(`Sales Invoice (Tax) - ${header.doc_no}${header.cancelled ? " (CANCELLED)" : ""}`, "title"),
    ...new Array(COL_COUNT - 1).fill(null),
  ]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  rows_.push([
    xlCell(`To: ${header.party_name}${header.party_address ? ", " + header.party_address : ""}`, "meta"), null, null,
    xlCell(`Date: ${dateText(header.doc_date)}   A/C: ${header.ac_code}   Company TRN No: ${header.company_trn_no}`, "meta"),
    ...new Array(COL_COUNT - 4).fill(null),
  ]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 2 } });
  merges.push({ s: { r: 1, c: 3 }, e: { r: 1, c: COL_COUNT - 1 } });

  // Payment Term / Delivery Term / Remarks
  rows_.push([xlCell(termsLine(header), "meta"), ...new Array(COL_COUNT - 1).fill(null)]);
  merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: COL_COUNT - 1 } });

  rows_.push(new Array(COL_COUNT).fill(null));

  rows_.push([
    xlCell("S.No", "header"), xlCell("Product / Description", "header"), xlCell("Unit", "header"),
    xlCell("Qty", "header"), xlCell("Unit Rate", "header"), xlCell("Disc", "header"),
    xlCell("Amount", "header"), xlCell("VAT %", "header"), xlCell("Tax Amount", "header"),
    xlCell("Amount (Inc. Tax)", "header"),
  ]);

  rows.forEach((r, i) => {
    rows_.push([
      xlCell(i + 1, "data"),
      xlCell(text(r.full_prod_name || r.prod_name), "data"),
      xlCell(text(r.p_uom), "data"),
      xlCell(num(r.quantity), "dataNum"),
      xlCell(num(r.unit_price), "dataNum"),
      xlCell(lineDiscOf(r), "dataNum"),
      xlCell(lineNetOf(r), "dataNum"),
      xlCell(num(r.tx_compnt_perc_1), "dataNum"),
      xlCell(num(r.tx_compnt_amt_1), "dataNum"),
      xlCell(round2(lineNetOf(r) + num(r.tx_compnt_amt_1)), "dataNum"),
    ]);
  });

  rows_.push(new Array(COL_COUNT).fill(null));

  const addTotal = (label: string, value: number, grand = false) => {
    const r = rows_.length;
    const arr: XlRow = new Array(COL_COUNT).fill(null);
    arr[0] = xlCell(label, grand ? "grandTotal" : "groupTotal");
    arr[COL_COUNT - 1] = xlCell(value, grand ? "grandTotalNum" : "groupTotalNum");
    rows_.push(arr);
    merges.push({ s: { r, c: 0 }, e: { r, c: COL_COUNT - 2 } });
  };
  addTotal("Total Amount", t.totalAmount);
  addTotal("Overall Discount", t.overallDiscount);
  addTotal("Tax Amount", t.totalTax);
  addTotal("Total (Inclusive Tax)", netTotal, true);

  const footer: XlRow = new Array(COL_COUNT).fill(null);
  footer[COL_COUNT - 1] = xlCell("Powered by Bayanat Technology", "footer");
  rows_.push(footer);

  return buildXlsxBuffer("Sales Invoice Tax", COL_COUNT, 16, rows_, merges, defaultXlStyleDefs());
}

// ─── Excel builder 3: Sales - Account Details ───────────────────────────────

function buildSalesAccountDetailsExcelBuffer(rows: ReportRow[], loginId: string): Buffer {
  const COL_COUNT = 9; // Type, Doc No, Doc Date, Ac Code, Ac Name, Curr Code, Ex Rate, Debit, Credit
  const rows_: XlRow[] = [];
  const merges: XlMerge[] = [];

  rows_.push([xlCell("ACCOUNT DETAILS", "title"), null, null, null, null, null, null, null, null]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  rows_.push([
    xlCell(`Date: ${dateText(new Date())}`, "meta"), null,
    xlCell(`User: ${loginId}`, "meta"), null,
    xlCell("Report: rpt_pr_accountledger", "meta"), null, null, null, null,
  ]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } });
  merges.push({ s: { r: 1, c: 2 }, e: { r: 1, c: 3 } });
  merges.push({ s: { r: 1, c: 4 }, e: { r: 1, c: 8 } });

  rows_.push(new Array(COL_COUNT).fill(null));

  rows_.push([
    xlCell("Type", "header"), xlCell("Doc No", "header"), xlCell("Doc Date", "header"),
    xlCell("Ac Code", "header"), xlCell("Ac Name", "header"), xlCell("Curr Code", "header"),
    xlCell("Ex. Rate", "header"), xlCell("Debit", "header"), xlCell("Credit", "header"),
  ]);

  let totalDebit = 0;
  let totalCredit = 0;
  rows.forEach((r) => {
    const amount = num(r.amount);
    const isDebit = num(r.sign_ind) >= 0;
    const debit = isDebit ? amount : 0;
    const credit = !isDebit ? Math.abs(amount) : 0;
    totalDebit += debit;
    totalCredit += credit;
    rows_.push([
      xlCell(text(r.doc_type), "data"),
      xlCell(text(r.doc_no), "data"),
      xlCell(dateText(r.doc_date), "data"),
      xlCell(text(r.ac_code), "data"),
      xlCell(text(r.ac_name), "data"),
      xlCell(text(r.curr_code), "data"),
      xlCell(num(r.ex_rate), "dataNumInt"),
      xlCell(debit, "dataNum"),
      xlCell(credit, "dataNum"),
    ]);
  });

  rows_.push(new Array(COL_COUNT).fill(null));

  const totalRow = rows_.length;
  rows_.push([
    xlCell("Total", "grandTotal"), null, null, null, null, null, null,
    xlCell(totalDebit, "grandTotalNum"), xlCell(totalCredit, "grandTotalNum"),
  ]);
  merges.push({ s: { r: totalRow, c: 0 }, e: { r: totalRow, c: 6 } });

  rows_.push([null, null, null, null, null, null, null, null, xlCell("Powered by Bayanat Technology", "footer")]);

  return buildXlsxBuffer("Sales Account Details", COL_COUNT, 16, rows_, merges, defaultXlStyleDefs());
}

// ─── Route handlers (Excel) ─────────────────────────────────────────────────

export const getSalesInvoiceReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadSalesInvoiceData(req, params, "S_INVOICE_SI_19082026");
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected document." });
      return;
    }
    const buffer = buildSalesInvoiceExcelBuffer(rows);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Sales_Invoice.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("Sales Invoice Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};

export const getSalesInvoiceTaxReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadSalesInvoiceData(req, params, "S_INVOICE_SI_TAX_19082026");
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected document." });
      return;
    }
    const buffer = buildSalesInvoiceTaxExcelBuffer(rows);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Sales_Invoice_Tax.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("Sales Invoice Tax Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};

export const getSalesAccountDetailsReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadSalesInvoiceData(req, params, "S_INVOICE_ACCOUNT_DETAIL_19082026");
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected document." });
      return;
    }
    const buffer = buildSalesAccountDetailsExcelBuffer(rows, params.loginid);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Sales_Invoice_Account_Details.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("Sales Account Details Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};