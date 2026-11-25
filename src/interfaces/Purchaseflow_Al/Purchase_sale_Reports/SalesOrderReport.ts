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
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeXml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
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

/** Table cells: show nothing instead of 0 / 0.00 */
const qtyBlank = (value: unknown): string => (num(value) === 0 ? "" : qtyFmt(value));
const amtBlank = (value: unknown): string => (num(value) === 0 ? "" : amtFmt(value));

function numberToWords(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "Zero";
  n = Math.abs(Math.floor(n));
  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const chunk = (x: number): string => {
    if (x === 0) return "";
    if (x < 20) return ones[x];
    if (x < 100) return tens[Math.floor(x / 10)] + (x % 10 ? " " + ones[x % 10] : "");
    return ones[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " " + chunk(x % 100) : "");
  };
  let r = "";
  const m = Math.floor(n / 1_000_000);
  const t = Math.floor((n % 1_000_000) / 1000);
  const rem = n % 1000;
  if (m) r += chunk(m) + " Million";
  if (t) r += (r ? " " : "") + chunk(t) + " Thousand";
  if (rem) r += (r ? " " : "") + chunk(rem);
  return r || "Zero";
}

function currencyInfo(code: string): { name: string; sub: string; dec: number } {
  switch ((code || "").toUpperCase()) {
    case "OMR": return { name: "OMANI RIAL", sub: "Baisa", dec: 3 };
    case "QAR":
    case "QR":  return { name: "QATARI RIYAL", sub: "Dirham", dec: 2 };
    case "INR": return { name: "INDIAN RUPEES", sub: "Paise", dec: 2 };
    case "AED": return { name: "UAE DIRHAM", sub: "Fils", dec: 2 };
    default:    return { name: code || "AMOUNT", sub: "", dec: 2 };
  }
}

function amountToWords(value: number, currCode: string): string {
  const { name, sub, dec } = currencyInfo(currCode);
  const factor = Math.pow(10, dec);
  const total = Math.round(Math.abs(value) * factor);
  const whole = Math.floor(total / factor);
  const frac = total % factor;
  let words = numberToWords(whole);
  if (frac > 0) words += ` and ${numberToWords(frac)} ${sub}`.trimEnd();
  return `${name} - ${value < 0 ? "Minus " : ""}${words} Only`;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const flagY = (v: unknown) => ["Y", "YES", "1", "TRUE"].includes(text(v).trim().toUpperCase());
const isCancelledRow = (r: ReportRow): boolean =>
  flagY(r.cancelled) || flagY(r.canceled) || flagY(r.det_cancel);
const isCancelledDoc = (rows: ReportRow[]): boolean =>
  rows.length > 0 && rows.every(isCancelledRow);

const grossValue = (r: ReportRow): number => num(r.quantity) * num(r.unit_price);

const lineDiscOf = (r: ReportRow): number => {
  const gross = num(r.quantity) * num(r.unit_price);
  return round2(num(r.disc_price) || (gross * num(r.disc_percent)) / 100);
};

const netOf = (r: ReportRow): number =>
  r.amount != null && r.amount !== "" ? round2(num(r.amount)) : round2(grossValue(r) - lineDiscOf(r));

const vatOf = (r: ReportRow): number =>
  r.tx_compnt_amt_1 != null && r.tx_compnt_amt_1 !== ""
    ? round2(num(r.tx_compnt_amt_1))
    : round2((netOf(r) * num(r.tx_compnt_perc_1)) / 100);

const discText = (r: ReportRow): string => {
  const pct = num(r.disc_percent);
  return pct > 0 ? `${amtFmt(pct)} (%)` : amtFmt(lineDiscOf(r));
};

// ─── Boxed header helpers (same markup the frontend PDF already understands) ─

type KvPair = [string, string];

function kvBoxHtml(title: string, pairs: KvPair[]): string {
  const rows = pairs
    .map(([k, v]) => "<tr><td>" + escapeHtml(k) + "</td><td>:</td><td><b>" + escapeHtml(v || "-") + "</b></td></tr>")
    .join("");
  return (
    '<table class="pr-kv-box">' +
      '<thead><tr><th colspan="3">' + escapeHtml(title) + "</th></tr></thead>" +
      "<tbody>" + rows + "</tbody>" +
    "</table>"
  );
}

function kvTwoBoxesHtml(leftTitle: string, left: KvPair[], rightTitle: string, right: KvPair[]): string {
  return (
    '<table class="grn-two-col grn-flush po-two-col"><tbody><tr>' +
      "<td>" + kvBoxHtml(leftTitle, left) + "</td>" +
      "<td>" + kvBoxHtml(rightTitle, right) + "</td>" +
    "</tr></tbody></table>"
  );
}

/** First `required` pairs are always shown; the rest only when filled. */
const keepFilled = (pairs: KvPair[], required: number): KvPair[] =>
  pairs.filter(([, v], i) => i < required || !!text(v).trim());

// ─── Editable print texts ───────────────────────────────────────────────────

const PO_NOTES: string[] = [
  "1. Our order number is to be quoted on all relevant Invoices & Delivery Notes.",
  "2. Goods once sold will not be taken back.",
];

const PO_APPROVAL_TEXT = "This Document Is Electronically Approved";
const PO_FOOTER_TEXT = "";
const PO_STANDARD_TERMS: { title: string; text: string }[] = [];

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

    const dataResult = await conn.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return normalize(dataResult.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Header model ───────────────────────────────────────────────────────────

interface PoHeader {
  doc_no: string;
  doc_date: any;
  div_name: string;
  ac_code: string;
  party_name: string;
  party_address: string;
  party_phone: string;
  party_fax: string;
  party_mobile: string;
  party_email: string;
  buyer: string;
  delivery_to: string;
  dlvr_contact: string;
  dlvr_mobile: string;
  dlvr_term: string;
  payment_terms: string;
  ref_no: string;
  pr_no: string;
  wo_no: string;
  project: string;
  scope: string;
  curr_code: string;
  disc_hdr_price: number;
  disc_hdr_percent: number;
  cancelled: boolean;
}

function buildHeader(rows: ReportRow[]): PoHeader {
  const h = rows[0] || {};
  return {
    doc_no: text(h.doc_no),
    doc_date: h.doc_date,
    div_name: text(h.div_name),
    ac_code: text(h.ac_code),
    party_name: text(h.party_name),
    party_address: text(h.party_address),
    party_phone: text(h.party_phone),
    party_fax: text(h.party_fax),
    party_mobile: text(h.mobile_no || h.cust_mobile),
    party_email: text(h.e_mail || h.cust_email),
    buyer: text(h.buyer || h.user_id),
    delivery_to: text(h.delivery_to),
    dlvr_contact: text(h.dlvr_contact),
    dlvr_mobile: text(h.dlvr_mobile),
    dlvr_term: text(h.dlvr_term),
    payment_terms: text(h.payment_terms),
    ref_no: text(h.ref_no),
    pr_no: text(h.pr_no || h.ref_doc_no),
    wo_no: text(h.wo_number || h.wo_no),
    project: text(h.project_name || h.job_no),
    scope: text(h.scope_of_work),
    curr_code: text(h.curr_code),
    disc_hdr_price: num(h.disc_hdr_price),
    disc_hdr_percent: num(h.disc_hdr_percent),
    cancelled: isCancelledDoc(rows),
  };
}

function computeTotals(rows: ReportRow[], header: PoHeader) {
  const totalQty = rows.reduce((s, r) => s + num(r.quantity), 0);
  const totalAmount = round2(rows.reduce((s, r) => s + num(r.quantity) * num(r.unit_price), 0));
  const lineDiscount = round2(rows.reduce((s, r) => s + lineDiscOf(r), 0));
  const lineNet = totalAmount - lineDiscount;
  const headerDiscount = round2(header.disc_hdr_price || (lineNet * header.disc_hdr_percent) / 100);
  const discount = round2(lineDiscount + headerDiscount);
  const exclusiveVat = round2(totalAmount - discount);
  const vat = round2(rows.reduce((s, r) => s + vatOf(r), 0));
  const inclusiveVat = round2(exclusiveVat + vat);
  return { totalQty, totalAmount, discount, exclusiveVat, vat, inclusiveVat };
}

// ─── HTML renderer (13 columns, portrait) ───────────────────────────────────

const PO_EXTRA_CSS = `
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .so-items { font-size: 7.5px; }
  .so-items th, .so-items td { padding: 3px 2px !important; }
`;

function renderPoBody(rows: ReportRow[]): string {
  const header = buildHeader(rows);
  const totals = computeTotals(rows, header);
  const cancelled = header.cancelled ? " — CANCELLED" : "";

  let sumLine = 0, sumDisc = 0, sumNet = 0, sumVat = 0, sumGrand = 0;

  const bodyRows = rows
    .map((r, i) => {
      const line = round2(grossValue(r));
      const disc = lineDiscOf(r);
      const net = netOf(r);
      const vatAmt = vatOf(r);
      const grand = round2(net + vatAmt);
      sumLine += line;
      sumDisc += disc;
      sumNet += net;
      sumVat += vatAmt;
      sumGrand += grand;

      return `
        <tr>
          <td class="center">${i + 1}</td>
          <td>${escapeHtml(r.prod_name)}${r.det_remarks ? ` — ${escapeHtml(r.det_remarks)}` : ""}</td>
          <td class="num">${qtyBlank(r.qty_puom)}</td>
          <td class="center">${escapeHtml(r.p_uom)}</td>
          <td class="num">${qtyBlank(r.qty_luom)}</td>
          <td class="center">${escapeHtml(r.l_uom)}</td>
          <td class="num">${amtBlank(r.unit_price)}</td>
          <td class="num">${amtBlank(line)}</td>
          <td class="num">${amtBlank(disc)}</td>
          <td class="num">${amtBlank(net)}</td>
          <td class="num">${amtBlank(r.tx_compnt_perc_1)}</td>
          <td class="num">${amtBlank(vatAmt)}</td>
          <td class="num">${amtBlank(grand)}</td>
        </tr>`;
    })
    .join("");

  const notesHtml = PO_NOTES.map((t) => `<div class="muted">${escapeHtml(t)}</div>`).join("");
  const companyName = header.div_name || "Company";

  return `
    <h1 class="report-title center"><u>SALES ORDER${cancelled}</u></h1>

    ${kvTwoBoxesHtml(
      "To",
      keepFilled([
        ["Customer", header.party_name],
        ["Address", header.party_address],
        ["Tel", header.party_phone],
        ["Fax", header.party_fax],
      ], 1),
      "SO Details",
      keepFilled([
        ["SO No", header.doc_no],
        ["Date", dateText(header.doc_date)],
        ["Sold By", header.buyer],
      ], 2)
    )}

    <!-- Payment / Delivery / Remarks -->
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
          <td class="center">${escapeHtml(header.ref_no || "-")}</td>
        </tr>
      </tbody>
    </table>

    ${
      rows.length === 0
        ? `<div class="empty">No line items found for this order.</div>`
        : `
      <!-- 13-column items table -->
      <table class="data-table so-items po-items">
        <thead>
          <tr>
            <th class="center">S.No</th>
            <th>Product / Description</th>
            <th class="right">P.Qty</th>
            <th class="center">P.UOM</th>
            <th class="right">L.Qty</th>
            <th class="center">L.UOM</th>
            <th class="right">Unit Price</th>
            <th class="right">Line Value</th>
            <th class="right">Disc Amt</th>
            <th class="right">Net Amt</th>
            <th class="right">VAT %</th>
            <th class="right">VAT Amt</th>
            <th class="right">Grand Total</th>
          </tr>
        </thead>
        <tbody>
          ${header.scope ? `<tr><td colspan="13"><b>Scope of Work:- ${escapeHtml(header.scope)}</b></td></tr>` : ""}
          ${bodyRows}
          <tr class="subtotal-row">
            <td colspan="7" class="right"><b>Total</b></td>
            <td class="num"><b>${amtBlank(sumLine)}</b></td>
            <td class="num"><b>${amtBlank(sumDisc)}</b></td>
            <td class="num"><b>${amtBlank(sumNet)}</b></td>
            <td></td>
            <td class="num"><b>${amtBlank(sumVat)}</b></td>
            <td class="num"><b>${amtBlank(sumGrand)}</b></td>
          </tr>
        </tbody>
      </table>

      <div class="totals-box">
        <div class="row"><span>Total Quantity</span><span>${qtyFmt(totals.totalQty)}</span></div>
        <div class="row"><span>Total Amount</span><span>${amtFmt(totals.totalAmount)}</span></div>
        <div class="row"><span>Overall Discount</span><span>${amtFmt(totals.discount)}</span></div>
        <div class="row"><span>Net Amount</span><span>${amtFmt(totals.exclusiveVat)}</span></div>
        ${totals.vat ? `<div class="row"><span>VAT Amount</span><span>${amtFmt(totals.vat)}</span></div>
        <div class="row grand"><span>Total (Inclusive VAT)</span><span>${amtFmt(totals.inclusiveVat)}</span></div>` : ""}
      </div>`
    }

    <div style="margin-top:8px;font-size:10px;">
      <b>Reference:</b> ${escapeHtml(header.ref_no || "-")}
    </div>

    <!-- Signature line like your PDF -->
    <table class="data-table dn-sign">
      <tbody>
        <tr>
          <td class="center">Prepared By</td>
          <td class="center">Checked By</td>
          <td class="center">Delivered By</td>
          <td class="center">Receiver's Name &amp; Signature</td>
        </tr>
      </tbody>
    </table>
  `;
}

// ─── Excel builder (13 columns) ─────────────────────────────────────────────

function buildExcelBuffer(rows: ReportRow[], loginId: string): Buffer {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const BLUE = "FF1D4ED8";
  const WHITE = "FFFFFFFF";
  const GREEN_BG = "FFD1FAE5";

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

  rows_.push(fullRow(cell(`SALES ORDER${header.cancelled ? " (CANCELLED)" : ""}`, "title")));
  mergeFull();

  rows_.push(fullRow(cell(
    `Sales Order No: ${header.doc_no}   Date: ${dateText(header.doc_date)}   Sold By: ${header.buyer}   Print: ${printDateTime} (${loginId})`,
    "meta"
  )));
  mergeFull();

  rows_.push(fullRow(cell(
    `Customer: ${header.ac_code} ${header.party_name}, ${header.party_address}   TEL: ${header.party_phone}   FAX: ${header.party_fax}`,
    "meta"
  )));
  mergeFull();

  rows_.push(fullRow(cell(
    `Delivery Address: ${header.delivery_to}   Contact: ${header.dlvr_contact} ${header.dlvr_mobile}`,
    "meta"
  )));
  mergeFull();

  rows_.push(fullRow(cell(
    `Payment Term: ${header.payment_terms || "-"}   Delivery Term / Period: ${header.dlvr_term || "-"}   Project: ${header.project || "-"}`,
    "meta"
  )));
  mergeFull();

  rows_.push(blank());

  rows_.push([
    cell("S.No", "header"), cell("Product / Description", "header"),
    cell("P.Qty", "header"), cell("P.UOM", "header"), cell("L.Qty", "header"), cell("L.UOM", "header"),
    cell("Unit Price", "header"), cell("Line Value", "header"), cell("Disc Amt", "header"),
    cell("Net Amt", "header"), cell("VAT %", "header"), cell("VAT Amt", "header"), cell("Grand Total", "header"),
  ]);

  let sumLine = 0, sumDisc = 0, sumNet = 0, sumVat = 0, sumGrand = 0;
  rows.forEach((r, i) => {
    const line = round2(grossValue(r));
    const disc = lineDiscOf(r);
    const net = netOf(r);
    const vatAmt = vatOf(r);
    const grand = round2(net + vatAmt);
    sumLine += line; sumDisc += disc; sumNet += net; sumVat += vatAmt; sumGrand += grand;

    rows_.push([
      cell(i + 1, "data"),
      cell(`${text(r.prod_name)}${r.det_remarks ? ` — ${text(r.det_remarks)}` : ""}`, "data"),
      cell(num(r.qty_puom), "dataNum"),
      cell(text(r.p_uom), "data"),
      cell(num(r.qty_luom), "dataNum"),
      cell(text(r.l_uom), "data"),
      cell(num(r.unit_price), "dataNum"),
      cell(line, "dataNum"),
      cell(disc, "dataNum"),
      cell(net, "dataNum"),
      cell(num(r.tx_compnt_perc_1), "dataNum"),
      cell(vatAmt, "dataNum"),
      cell(grand, "dataNum"),
    ]);
  });

  const tRow = rows_.length;
  const totalLine: Row = blank();
  totalLine[0] = cell(`Total: ${amountToWords(totals.inclusiveVat, header.curr_code)}`, "groupTotal");
  totalLine[7] = cell(round2(sumLine), "groupTotalNum");
  totalLine[8] = cell(round2(sumDisc), "groupTotalNum");
  totalLine[9] = cell(round2(sumNet), "groupTotalNum");
  totalLine[11] = cell(round2(sumVat), "groupTotalNum");
  totalLine[12] = cell(round2(sumGrand), "groupTotalNum");
  rows_.push(totalLine);
  merges.push({ s: { r: tRow, c: 0 }, e: { r: tRow, c: 6 } });

  rows_.push(blank());

  const addTotal = (label: string, value: number, grand = false) => {
    const r = rows_.length;
    const arr: Row = blank();
    arr[0] = cell(label, grand ? "grandTotal" : "groupTotal");
    arr[COL_COUNT - 1] = cell(value, grand ? "grandTotalNum" : "groupTotalNum");
    rows_.push(arr);
    merges.push({ s: { r, c: 0 }, e: { r, c: COL_COUNT - 2 } });
  };
  addTotal("Total Quantity", totals.totalQty);
  addTotal("Total Amount", totals.totalAmount);
  addTotal("Overall Discount", totals.discount);
  addTotal("Net Amount (Excl. VAT)", totals.exclusiveVat);
  addTotal("VAT Amount", totals.vat);
  addTotal("Grand Total", totals.inclusiveVat, true);

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
  signRow[0] = cell("For Customer — Signature / Date", "meta");
  signRow[6] = cell(`For ${header.div_name || "Company"} — Signature / Date`, "meta");
  rows_.push(signRow);
  merges.push({ s: { r: sRow, c: 0 }, e: { r: sRow, c: 5 } });
  merges.push({ s: { r: sRow, c: 6 }, e: { r: sRow, c: COL_COUNT - 1 } });

  const footRow: Row = blank();
  footRow[COL_COUNT - 1] = cell("Powered by Bayanat Technology", "footer");
  rows_.push(footRow);

  // ── styles + OOXML builder (same as your original) ──
  interface FontDef { bold?: boolean; italic?: boolean; sz?: number; color?: string }
  interface FillDef { color?: string }
  interface BorderDef { top?: string; bottom?: string; left?: string; right?: string }
  interface XfDef { fontId: number; fillId: number; borderId: number; numFmtId: number; align?: string; wrap?: boolean }

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

  const colXml = Array.from({ length: COL_COUNT }, (_, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${i === 1 ? 36 : 14}" customWidth="1"/>`
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

  const mergesXml = merges
    .map((m) => `<mergeCell ref="${String.fromCharCode(65 + m.s.c)}${m.s.r + 1}:${String.fromCharCode(65 + m.e.c)}${m.e.r + 1}"/>`)
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
      reportName: "Sales Order",
      userName: params.loginid,
      endLabel: "Powered by Bayanat Technology",
    });
    const bodyHtml = renderPoBody(rows).replace(/>\s+</g, "><");

    const html = buildReportDocument({
      title: `Sales Order ${buildHeader(rows).doc_no}`,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: PO_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
      orientation: "portrait",          // ← portrait
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Sales Order Report HTML error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate report",
    });
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
    // Keep your existing buildExcelBuffer
    const buffer = buildExcelBuffer(rows, params.loginid);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Sales_Order_Report.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("Sales Order Report Excel error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate Excel",
    });
  }
};