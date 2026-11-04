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
  doc_type: string; // "SDN"
  doc_no: string;
}

// ─── DB helpers (same as every other report controller) ───────────────────

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

/** Simple number-to-words (English) up to millions. */
function numberToWords(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "Zero";
  const neg = n < 0;
  n = Math.abs(Math.floor(n));

  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const chunk = (num0: number): string => {
    if (num0 === 0) return "";
    if (num0 < 20) return ones[num0];
    if (num0 < 100) return tens[Math.floor(num0 / 10)] + (num0 % 10 ? " " + ones[num0 % 10] : "");
    return ones[Math.floor(num0 / 100)] + " Hundred" + (num0 % 100 ? " " + chunk(num0 % 100) : "");
  };

  let result = "";
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const remainder = n % 1000;

  if (millions) result += chunk(millions) + " Million";
  if (thousands) result += (result ? " " : "") + chunk(thousands) + " Thousand";
  if (remainder) result += (result ? " " : "") + chunk(remainder);

  return (neg ? "Minus " : "") + (result || "Zero");
}
function currencyInfo(code: string): { name: string; sub: string; dec: number } {
  switch ((code || "").toUpperCase()) {
    case "OMR": return { name: "OMANI RIAL", sub: "Baisa", dec: 3 };
    case "QAR":
    case "QR": return { name: "QATARI RIYAL", sub: "Dirham", dec: 2 };
    case "INR": return { name: "INDIAN RUPEES", sub: "Paise", dec: 2 };
    case "AED": return { name: "UAE DIRHAM", sub: "Fils", dec: 2 };
    default: return { name: code || "AMOUNT", sub: "", dec: 2 };
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
  return `${name} - ${value < 0 ? "Minus " : ""}${words} only`;
}

// ─── Param extraction ───────────────────────────────────────────────────────

function extractParams(req: RequestWithUser): ReqParams {
  const b = req.body || {};
  return {
    loginid: text(req.user?.loginid) || text(b.loginid) || "ADMIN",
    company_code: text(b.company_code) || text(req.user?.company_code),
    doc_type: text(b.doc_type) || "SDN",
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

async function loadSalesDnData(req: RequestWithUser, p: ReqParams): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const result = await conn.execute(
      `SELECT *
         FROM VW_ERP_SALESDN
        WHERE company_code = :company_code
          AND doc_type     = :doc_type
          AND doc_no       = :doc_no
        ORDER BY serial_no`,
      { company_code: p.company_code, doc_type: p.doc_type, doc_no: p.doc_no },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Report line model ──────────────────────────────────────────────────────

interface DnHeader {
  doc_no: string;
  doc_date: any;
  div_name: string;
  ac_code: string;
  party_name: string;
  party_address: string;
  party_phone: string;
  party_fax: string;
  cust_mobile: string;
  cust_email: string;
  payment_terms: string;
  user_id: string;
  delivery_to: string;
  disc_hdr_price: number;
  disc_hdr_percent: number;
  curr_code: string;
  remarks: string;
  cancelled: boolean;
}



const flagY = (v: unknown) => ["Y", "YES", "1", "TRUE"].includes(text(v).trim().toUpperCase());
const isCancelledRow = (r: ReportRow): boolean =>
  flagY(r.cancelled) || flagY(r.canceled) || flagY(r.det_cancel);
const isCancelledDoc = (rows: ReportRow[]): boolean =>
  rows.length > 0 && rows.every(isCancelledRow);


function buildHeader(rows: ReportRow[]): DnHeader {
  const h = rows[0] || {};
  const address =
    text(h.party_address) ||
    [h.cust_add1, h.cust_add2, h.cust_add3].filter(Boolean).join(" ");
  return {
    doc_no: text(h.doc_no),
    doc_date: h.doc_date,
    div_name: text(h.div_name),
    ac_code: text(h.ac_code),
    party_name: text(h.party_name) || text(h.ac_name),
    party_address: address,
    party_phone: text(h.party_phone),
    party_fax: text(h.party_fax),
    cust_mobile: text(h.cust_mobile || h.dlvr_mobile),
    cust_email: text(h.cust_email || h.e_mail || h.dlvr_email),
    payment_terms: text(h.payment_terms),
    user_id: text(h.user_id),
    delivery_to: text(h.delivery_to) || text(h.dlvr_term),
    disc_hdr_price: num(h.disc_hdr_price),
    disc_hdr_percent: num(h.disc_hdr_percent),
    curr_code: text(h.curr_code),
    remarks: text(h.remarks),
    cancelled: isCancelledDoc(rows),
  };
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const qtyOf = (r: ReportRow) => num(r.quantity) || num(r.qty_puom);


const lineDiscOf = (r: ReportRow) => {
  const gross = qtyOf(r) * num(r.unit_price);
  return round2(num(r.disc_price) || (gross * num(r.disc_percent)) / 100);
};

function computeTotals(rows: ReportRow[], header: DnHeader) {
  const totalQty = rows.reduce((s, r) => s + qtyOf(r), 0);

  // Gross = qty × rate 
  const totalAmount = round2(rows.reduce((s, r) => s + qtyOf(r) * num(r.unit_price), 0));

  const lineDiscount = round2(rows.reduce((s, r) => s + lineDiscOf(r), 0));


  const lineNet = totalAmount - lineDiscount;
  const headerDiscount = round2(
    header.disc_hdr_price || (lineNet * header.disc_hdr_percent) / 100
  );

  const overallDiscount = round2(lineDiscount + headerDiscount);
  const grandTotal = round2(totalAmount - overallDiscount);

  return { totalQty, totalAmount, overallDiscount, grandTotal };
}

// ─── Layout CSS — same visual system as every other report ────────────────

const SALES_DN_EXTRA_CSS = `
  .doc-title-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin: 2px 0 2px 0;
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

  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 16px;
    margin-bottom: 14px;
  }
  .info-block {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 10px 14px;
    background: #f8fafc;
  }
  .info-block .label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #64748b;
    margin-bottom: 6px;
  }
  .info-block .value-line {
    font-size: 11px;
    color: #0f172a;
    line-height: 1.55;
  }
  .info-block .kv-line {
    display: flex;
    font-size: 11px;
    color: #0f172a;
    line-height: 1.7;
  }
  .info-block .kv-label {
    flex: 0 0 100px;
    color: #475569;
  }
  .info-block .kv-value {
    flex: 1;
  }

  .totals-box {
    margin-top: 16px;
    margin-left: auto;
    width: 280px;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    overflow: hidden;
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

  .amount-words {
    font-style: italic;
    color: #1e293b;
    font-size: 10.5px;
    margin-top: 10px;
  }

  .sign-row {
    display: flex;
    justify-content: space-between;
    width: 100%;
    margin-top: 26px;
    text-align: center;
    font-size: 10px;
  }
  .sign-box {
    width: 23%;
  }
  .sign-space { height: 32px; }
  .sign-line {
    width: 100%;
    border-top: 1px solid #64748b;
    margin-bottom: 6px;
  }
  .sign-label {
    font-size: 10px;
    font-weight: 700;
    color: #334155;
  }


      .dn-sign-table {
    width: 100%;
    margin-top: 30px;
    border-collapse: collapse;
    page-break-inside: avoid !important;
    border: none !important;
    background: transparent !important;
    box-shadow: none !important;
  }
  .dn-sign-table td {
    width: 25%;
    text-align: center;
    vertical-align: bottom;
    padding: 0 6px;
    page-break-inside: avoid !important;
    border: none !important;
    background: transparent !important;
  }
  .dn-sign-table .sign-space {
    height: 32px;
  }
  .dn-sign-table .sign-line {
    border-top: 1px solid #64748b;
    margin-bottom: 4px;
  }
  .dn-sign-table .sign-label {
    font-size: 10px;
    font-weight: 700;
    color: #334155;
  }

  /* Force remove any blue bar / separator */
  .dn-sign-table,
  .dn-sign-table tr,
  .dn-sign-table td,
  .dn-sign-table * {
    background: transparent !important;
    border-top: none !important;
    border-bottom: none !important;
    box-shadow: none !important;
  }

`;

const REPORT_TITLE = "Delivery Note";


// ── Invoice file madhun copy (DN file swatantra rahil, Invoice la touch nahi) ──
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
    '<table class="grn-two-col"><tbody><tr>' +
      "<td>" + kvBoxHtml(leftTitle, left) + "</td>" +
      "<td>" + kvBoxHtml(rightTitle, right) + "</td>" +
    "</tr></tbody></table>"
  );
}

/** Invoice sarkhach title line (si-top-line / si-top-cancel already frontend madhe handled) */
function dnTitleHtml(title: string, cancelled: boolean): string {
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

const SIGN_LABELS = ["Prepared By", "Checked By", "Delivered By", "Receiver's Name & Signature"];




function printMetaHtml(title: string, subtitle: string, cancelled: boolean): string {
  return `
    <div class="doc-title-row">
      <div>
        <h1>${escapeHtml(title)}${cancelled ? `<span class="status-badge status-CANCELLED">Cancelled</span>` : ""}</h1>
        <div class="doc-sub">${escapeHtml(subtitle)}</div>
      </div>
    </div>`;
}

// ─── Body ───────────────────────────────────────────────────────────────────

function renderSalesDnBody(rows: ReportRow[]): string {
  const header = buildHeader(rows);
  const totalQty = rows.reduce((s, r) => s + qtyOf(r), 0);
  const uomOf = (r: ReportRow) => text(r.p_uom || r.uom || r.l_uom);

  const bodyRows = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(r.prod_code)} ${escapeHtml(r.full_prod_name || r.prod_name)}${r.det_remarks ? ` — ${escapeHtml(r.det_remarks)}` : ""}</td>
      <td>${escapeHtml(uomOf(r))}</td>
      <td class="right">${qtyFmt(qtyOf(r))}</td>
    </tr>`).join("");

  // empty fields skip (Customer, DN No, Date, A/C Code nehmi)
  const partyPairs: KvPair[] = ([
    ["Customer", header.party_name],
    ["Address", header.party_address],
    ["Tel", header.party_phone],
    ["Fax", header.party_fax],
    ["Mobile", header.cust_mobile],
    ["Email", header.cust_email],
  ] as KvPair[]).filter(([, v], i) => i === 0 || !!text(v).trim());

  const detailPairs: KvPair[] = [
    ["DN No", header.doc_no],
    ["Date", dateText(header.doc_date)],
    ["A/C Code", header.ac_code],
  ];
  if (header.payment_terms) detailPairs.push(["Payment Term", header.payment_terms]);
  if (header.user_id) detailPairs.push(["Sold By", header.user_id]);
  if (header.delivery_to) detailPairs.push(["Delivery To", header.delivery_to]);

 const signHtml = `
  <table class="dn-sign"><tbody><tr>${SIGN_LABELS.map((label) => `
    <td class="center"><strong>${escapeHtml(label)}</strong></td>`).join("")}
  </tr></tbody></table>`;

  return `
    ${dnTitleHtml(REPORT_TITLE, header.cancelled)}
    ${kvTwoBoxesHtml("To", partyPairs, "DN Details", detailPairs)}

    ${rows.length === 0
      ? `<div class="empty">No line items found for this delivery note.</div>`
      : `
    <table class="data-table dn-items">
      <thead>
        <tr>
          <th>S.No</th>
          <th>Product / Description</th>
          <th>Unit</th>
          <th class="right">Qty</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>

    <div class="totals-box">
      <div class="row grand"><span>Total Quantity</span><span>${qtyFmt(totalQty)}</span></div>
    </div>

    ${header.remarks ? `<p><strong>Remarks:</strong> ${escapeHtml(header.remarks)}</p>` : ""}
    ${signHtml}`}
  `;
}

// ─── Excel builder (same raw-OOXML engine as every other report) ──────────

function buildExcelBuffer(rows: ReportRow[], loginId: string): Buffer {
  const BLUE = "FF1D4ED8";
  const WHITE = "FFFFFFFF";

  const header = buildHeader(rows);
  const totals = computeTotals(rows, header);
  const amountInWords = amountToWords(totals.grandTotal, header.curr_code);

    const COL_COUNT = 4; // S.No, Product / Description, Unit, Qty
  const COL_WIDTHS = [8, 55, 12, 14];
  const uomOf = (r: ReportRow) => text(r.p_uom || r.uom || r.l_uom);

  interface XlCell { v: unknown; styleKey: string }
  type Row = (XlCell | null)[];
  const rows_: Row[] = [];
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
  const cell = (v: unknown, styleKey: string): XlCell => ({ v, styleKey });
  const merge = (r: number, c1: number, c2: number) => merges.push({ s: { r, c: c1 }, e: { r, c: c2 } });

  // Row 0: title (+ cancelled)
  rows_.push([cell(`${REPORT_TITLE.toUpperCase()}${header.cancelled ? " (CANCELLED)" : ""}`, "title"), null, null, null]);
  merge(0, 0, COL_COUNT - 1);

  // Row 1: DN No | Date
  rows_.push([cell(`DN No: ${header.doc_no}`, "meta"), null, cell(`Date: ${dateText(header.doc_date)}`, "meta"), null]);
  merge(1, 0, 1); merge(1, 2, 3);

  // Row 2: A/C Code | Sold By
  rows_.push([cell(`A/C Code: ${header.ac_code}`, "meta"), null, cell(`Sold By: ${header.user_id}`, "meta"), null]);
  merge(2, 0, 1); merge(2, 2, 3);

  // Row 3: To
  rows_.push([cell(`To: ${[header.party_name, header.party_address].filter(Boolean).join(", ")}`, "meta"), null, null, null]);
  merge(3, 0, COL_COUNT - 1);

  rows_.push(new Array(COL_COUNT).fill(null));

  rows_.push([
    cell("S.No", "header"), cell("Product / Description", "header"),
    cell("Unit", "header"), cell("Qty", "header"),
  ]);

  rows.forEach((r, i) => {
    rows_.push([
      cell(i + 1, "dataInt"),
      cell(`${text(r.prod_code)} ${text(r.full_prod_name || r.prod_name)}${r.det_remarks ? ` — ${text(r.det_remarks)}` : ""}`, "data"),
      cell(uomOf(r), "data"),
      cell(qtyOf(r), "dataQty"),
    ]);
  });

  rows_.push(new Array(COL_COUNT).fill(null));

  const qtyRow = rows_.length;
  rows_.push([cell("Total Quantity", "groupTotal"), null, null, cell(totals.totalQty, "groupTotalQty")]);
  merge(qtyRow, 0, 2);

  if (header.remarks) {
    const rr = rows_.length;
    rows_.push([cell(`Remarks: ${header.remarks}`, "meta"), null, null, null]);
    merge(rr, 0, COL_COUNT - 1);
  }

  // Signature row (browser/PDF sarkhach 4 labels)
  rows_.push(new Array(COL_COUNT).fill(null));
  rows_.push(new Array(COL_COUNT).fill(null));
  rows_.push([cell("Prepared By", "sign"), cell("Checked By", "sign"), cell("Delivered By", "sign"), cell("Receiver's Name & Signature", "sign")]);

  rows_.push([null, null, null, cell("Powered by Bayanat Technology", "footer")]);

  interface FontDef { bold?: boolean; italic?: boolean; sz?: number; color?: string; }
  interface FillDef { color?: string; }
  interface BorderDef { top?: string; bottom?: string; left?: string; right?: string; }
  interface XfDef { fontId: number; fillId: number; borderId: number; numFmtId: number; align?: string; wrap?: boolean; }

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
        dataInt: {
      font: { sz: 10 }, alignment: { horizontal: "center", vertical: "center" },
      border: { bottom: { color: { rgb: "FFF3F4F6" } } },
    },
    dataQty: {
      font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
      numFmt: "General", border: { bottom: { color: { rgb: "FFF3F4F6" } } },
    },
    groupTotalQty: {
      font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
      fill: { fgColor: { rgb: GREEN_BG } },
      alignment: { horizontal: "right", vertical: "center" },
      numFmt: "General",
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
    `<col min="${i + 1}" max="${i + 1}" width="${COL_WIDTHS[i]}" customWidth="1"/>`
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
  <sheets><sheet name="Delivery Note" sheetId="1" r:id="rId1"/></sheets>
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

export const getSalesDNReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadSalesDnData(req, params);
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for this delivery note." });
      return;
    }

    const companyCode = resolveCompanyCode(req, params);
    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: "rpt_sales_dn",
      userName: params.loginid,
      endLabel: "Powered by Bayanat Technology",
    });
   const bodyHtml = renderSalesDnBody(rows).replace(/>\s+</g, "><");

    const html = buildReportDocument({
      title: `${REPORT_TITLE} ${buildHeader(rows).doc_no}`,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: SALES_DN_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
      orientation: "portrait"
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Sales DN Report HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getSalesDNReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadSalesDnData(req, params);
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for this delivery note." });
      return;
    }
    const buffer = buildExcelBuffer(rows, params.loginid);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Delivery_Note.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("Sales DN Report Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};