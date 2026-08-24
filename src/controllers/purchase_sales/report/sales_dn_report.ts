import { Response } from "express";
import oracledb from "oracledb";
import * as XLSX from "xlsx";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import TenantManager from "../../../database/TenantManager";
const AdmZip = require("adm-zip");

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

// ─── DB Helpers (minimal – reuse project pattern) ─────────────────────────────

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid)
    tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenantId)
    throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
  return TenantManager.getConnection(tenantId);
}

async function closeConn(conn?: oracledb.Connection) {
  if (conn)
    try {
      await conn.close();
    } catch (e) {
      console.warn("Close conn error:", e);
    }
}

function normalize(rows: any[] = []): ReportRow[] {
  return rows.map((row) =>
    Object.keys(row).reduce((acc: ReportRow, key) => {
      acc[key.toLowerCase()] = row[key];
      return acc;
    }, {}),
  );
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmtNumber(n: number, decimals = 2): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return n < 0 ? `(${formatted})` : formatted;
}

function fmtDate(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return text(value).slice(0, 10);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
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

/**
 * Build an <img src> value from VW_ERP_SALESDN.COMPANY_LOGO only.
 * No extra API call — supports data URLs, http(s) paths, raw base64, or Buffer/BLOB.
 */
function resolveCompanyLogoSrc(raw: unknown): string {
  if (raw == null) return "";

  // Oracle LOB / Buffer
  if (Buffer.isBuffer(raw)) {
    const b64 = raw.toString("base64");
    const mime =
      raw[0] === 0x89 && raw[1] === 0x50
        ? "image/png"
        : raw[0] === 0xff && raw[1] === 0xd8
          ? "image/jpeg"
          : "image/png";
    return `data:${mime};base64,${b64}`;
  }

  const s = text(raw).trim();
  if (!s) return "";

  // Already usable as src
  if (
    s.startsWith("data:image/") ||
    s.startsWith("http://") ||
    s.startsWith("https://") ||
    s.startsWith("/")
  ) {
    return s;
  }

  // Bare base64 (common when COMP_LOGO is stored as CLOB/VARCHAR2 of base64)
  const looksBase64 = /^[A-Za-z0-9+/=\s]+$/.test(s) && s.replace(/\s/g, "").length > 64;
  if (looksBase64) {
    const b64 = s.replace(/\s/g, "");
    // crude mime sniff from base64 header
    let mime = "image/png";
    if (b64.startsWith("/9j/")) mime = "image/jpeg";
    else if (b64.startsWith("R0lG")) mime = "image/gif";
    else if (b64.startsWith("UklG")) mime = "image/webp";
    return `data:${mime};base64,${b64}`;
  }

  // Fallback: treat as relative path / filename
  return s;
}

/** Simple number-to-words for amount in words (English). Handles up to millions. */
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

  const chunk = (num: number): string => {
    if (num === 0) return "";
    if (num < 20) return ones[num];
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? " " + ones[num % 10] : "");
    return ones[Math.floor(num / 100)] + " Hundred" + (num % 100 ? " " + chunk(num % 100) : "");
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

// ─── Request Param Parser ────────────────────────────────────────────────────

function parseDocParams(req: RequestWithUser) {
  const company =
    text(req.body?.company_code || req.query?.company_code || req.user?.company_code).trim() ||
    text(req.user?.company_code);
  const docType =
    text(req.body?.doc_type || req.query?.doc_type || "SDN").trim() || "SDN";
  const docNo = text(req.body?.doc_no || req.query?.doc_no).trim();

  if (!company) {
    throw Object.assign(new Error("company_code is required"), { status: 400 });
  }
  if (!docNo) {
    throw Object.assign(new Error("doc_no is required"), { status: 400 });
  }

  return { company, docType, docNo };
}

// ─── Data Loader ─────────────────────────────────────────────────────────────

async function loadSalesDN(req: RequestWithUser): Promise<ReportRow[]> {
  const { company, docType, docNo } = parseDocParams(req);
  const conn = await getConn(req);

  try {
    const sql = `
      SELECT *
        FROM VW_ERP_SALESDN
       WHERE company_code = :as_company
         AND doc_type     = :as_doctype
         AND doc_no       = :as_docno
       ORDER BY serial_no
    `;

    const result = await conn.execute(
      sql,
      {
        as_company: company,
        as_doctype: docType,
        as_docno: docNo,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Header / detail extraction ──────────────────────────────────────────────

interface DNHeader {
  company_code: string;
  company_logo: string;
  doc_type: string;
  doc_no: string;
  doc_date: string;
  div_code: string;
  div_name: string;
  ac_code: string;
  ac_name: string;
  party_name: string;
  party_address: string;
  party_phone: string;
  party_fax: string;
  cust_mobile: string;
  cust_email: string;
  cust_add1: string;
  cust_add2: string;
  cust_add3: string;
  payment_terms: string;
  delivery_to: string;
  dlvr_term: string;
  dlvr_contact: string;
  dlvr_mobile: string;
  dlvr_email: string;
  curr_code: string;
  disc_hdr_percent: number;
  disc_hdr_price: number;
  remarks: string;
  user_id: string;
  cancelled: string;
}

function extractHeader(rows: ReportRow[]): DNHeader | null {
  if (!rows.length) return null;
  const r = rows[0];
  return {
    company_code: text(r.company_code),
    company_logo: resolveCompanyLogoSrc(r.company_logo),
    doc_type: text(r.doc_type),
    doc_no: text(r.doc_no),
    doc_date: fmtDate(r.doc_date),
    div_code: text(r.div_code),
    div_name: text(r.div_name),
    ac_code: text(r.ac_code),
    ac_name: text(r.ac_name),
    party_name: text(r.party_name) || text(r.ac_name),
    party_address: text(r.party_address),
    party_phone: text(r.party_phone),
    party_fax: text(r.party_fax),
    cust_mobile: text(r.cust_mobile),
    cust_email: text(r.cust_email),
    cust_add1: text(r.cust_add1),
    cust_add2: text(r.cust_add2),
    cust_add3: text(r.cust_add3),
    payment_terms: text(r.payment_terms),
    delivery_to: text(r.delivery_to) || text(r.dlvr_term),
    dlvr_term: text(r.dlvr_term),
    dlvr_contact: text(r.dlvr_contact),
    dlvr_mobile: text(r.dlvr_mobile),
    dlvr_email: text(r.dlvr_email),
    curr_code: text(r.curr_code),
    disc_hdr_percent: num(r.disc_hdr_percent),
    disc_hdr_price: num(r.disc_hdr_price),
    remarks: text(r.remarks),
    user_id: text(r.user_id),
    cancelled: text(r.cancelled || r.canceled),
  };
}

interface DNLine {
  serial_no: number;
  prod_code: string;
  prod_name: string;
  det_remarks: string;
  p_uom: string;
  quantity: number;
  unit_price: number;
  amount: number;
  disc_percent: number;
  disc_price: number;
}

function extractLines(rows: ReportRow[]): DNLine[] {
  return rows
    .filter((r) => text(r.prod_code) || text(r.prod_name) || num(r.serial_no))
    .map((r) => ({
      serial_no: num(r.serial_no),
      prod_code: text(r.prod_code),
      prod_name: text(r.prod_name),
      det_remarks: text(r.det_remarks),
      p_uom: text(r.p_uom),
      quantity: num(r.quantity) || num(r.qty_puom),
      unit_price: num(r.unit_price),
      amount: num(r.amount) || num(r.lcur_amount),
      disc_percent: num(r.disc_percent),
      disc_price: num(r.disc_price),
    }));
}

// ─── HTML Renderer ────────────────────────────────────────────────────────────

function renderSalesDNHtml(rows: ReportRow[], loginId: string): string {
  const header = extractHeader(rows);
  const lines = extractLines(rows);

  if (!header) {
    return `<!doctype html><html><head><meta charset="utf-8"/><title>Delivery Note</title></head>
<body style="font-family:Arial,sans-serif;padding:40px;text-align:center;color:#666">
  <h2>No data found</h2>
  <p>Delivery Note not found for the given document number.</p>
</body></html>`;
  }

  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
  const totalAmount = lines.reduce((s, l) => s + l.amount, 0);
  const overallDiscount = header.disc_hdr_price;
  const grandTotal = totalAmount - overallDiscount;

  const currLabel =
    header.curr_code === "QAR" || header.curr_code === "QR"
      ? "QATARI RIYAL"
      : header.curr_code || "AMOUNT";
  const amountInWords = `${currLabel} - ${numberToWords(grandTotal)} only`;

  const addressBlock = [
    header.party_address ||
      [header.cust_add1, header.cust_add2, header.cust_add3].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join("");

  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const lineRows = lines
    .map(
      (l, idx) => `
    <tr class="data-row">
      <td class="center">${idx + 1}</td>
      <td>
        <div class="prod-code">${escapeHtml(l.prod_code)}</div>
        <div class="prod-name">${escapeHtml(l.prod_name)}</div>
        ${l.det_remarks ? `<div class="det-remarks">${escapeHtml(l.det_remarks)}</div>` : ""}
      </td>
      <td class="center">${escapeHtml(l.p_uom)}</td>
      <td class="num">${fmtNumber(l.quantity, 0)}</td>
      <td class="num">${fmtNumber(l.unit_price)}</td>
      <td class="num">${fmtNumber(l.amount)}</td>
    </tr>`,
    )
    .join("");

  // Logo comes only from view column COMPANY_LOGO — no separate logo API
  const logoHtml = header.company_logo
    ? `<img class="company-logo" src="${escapeHtml(header.company_logo)}" alt="Logo" />`
    : "";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Delivery Note - ${escapeHtml(header.doc_no)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11px;
      color: #111;
      background: #f1f5f9;
    }
    .sheet {
      max-width: 210mm;
      margin: 12px auto;
      background: #fff;
      padding: 18px 22px 14px;
      box-shadow: 0 1px 6px rgba(0,0,0,.08);
      display: flex;
      flex-direction: column;
      min-height: 297mm; /* A4 page height so the footer block can be pinned to the bottom */
    }
    .company-header {
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 2px solid #1d4ed8;
      padding-bottom: 10px;
      margin-bottom: 8px;
    }
    .company-logo {
      max-height: 52px;
      max-width: 140px;
      object-fit: contain;
    }
    .company-name-block {
      flex: 1;
    }
    .company-name {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: #1e3a8a;
    }
    .company-sub {
      font-size: 10px;
      color: #64748b;
      margin-top: 2px;
    }
    .report-title {
      text-align: center;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 3px;
      margin: 10px 0 14px;
      color: #0f172a;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 24px;
      margin-bottom: 14px;
    }
    .meta-left .party-name {
      font-weight: 700;
      font-size: 12px;
      margin-bottom: 2px;
    }
    .meta-left .party-addr {
      white-space: pre-line;
      line-height: 1.35;
      color: #334155;
    }
    .meta-left .contact-line {
      margin-top: 4px;
      color: #475569;
      font-size: 10.5px;
    }
    .meta-right {
      text-align: right;
    }
    .meta-right table {
      margin-left: auto;
      border-collapse: collapse;
      font-size: 11px;
    }
    .meta-right td {
      padding: 1px 0 1px 10px;
      vertical-align: top;
    }
    .meta-right td.lbl {
      color: #64748b;
      text-align: right;
      white-space: nowrap;
    }
    .meta-right td.val {
      font-weight: 600;
      text-align: left;
      min-width: 120px;
    }
    table.lines {
      width: 100%;
      border-collapse: collapse;
      margin-top: 6px;
      font-size: 10.5px;
    }
    table.lines thead th {
      background: #1d4ed8;
      color: #fff;
      border: 1px solid #1e3a8a;
      padding: 6px 5px;
      text-align: center;
      font-weight: 700;
    }
    table.lines tbody td {
      border: 1px solid #cbd5e1;
      padding: 5px 6px;
      vertical-align: top;
    }
    table.lines td.center { text-align: center; }
    table.lines td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .prod-code { font-weight: 600; }
    .prod-name { color: #334155; margin-top: 1px; }
    .det-remarks { color: #64748b; font-size: 9.5px; margin-top: 2px; font-style: italic; }
    tr.data-row:nth-child(even) td { background: #f8fafc; }
    .totals-block {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      margin-top: 12px;
      align-items: start;
    }
    .totals-left {
      font-size: 11px;
    }
    .totals-left .qty-line {
      font-weight: 600;
      margin-bottom: 6px;
    }
    .amount-words {
      font-style: italic;
      color: #1e293b;
      border-top: 1px dashed #94a3b8;
      padding-top: 6px;
      margin-top: 4px;
    }
    .totals-right table {
      border-collapse: collapse;
      font-size: 11px;
      min-width: 220px;
    }
    .totals-right td {
      padding: 3px 8px;
    }
    .totals-right td.lbl {
      text-align: right;
      color: #475569;
    }
    .totals-right td.val {
      text-align: right;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      min-width: 90px;
    }
    .totals-right tr.grand td {
      background: #1d4ed8;
      color: #fff;
      font-weight: 700;
      border-top: 2px solid #1e3a8a;
    }
    /* This block (signatures + footnote + report footer) is pushed to the
       bottom of .sheet via margin-top: auto, so it prints at the bottom
       of the page instead of floating right after the totals. */
    .print-footer-block {
      margin-top: auto;
    }
    .sign-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      padding-top: 8px;
    }
    .sign-box {
      text-align: center;
      border-top: 1px solid #64748b;
      padding-top: 6px;
      font-size: 10px;
      color: #334155;
      min-height: 28px;
    }
    .footnote {
      margin-top: 18px;
      font-size: 9.5px;
      color: #64748b;
      border-top: 1px solid #e2e8f0;
      padding-top: 6px;
    }
    .report-footer {
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: #94a3b8;
      margin-top: 10px;
    }
    .cancelled-banner {
      background: #fef2f2;
      color: #b91c1c;
      border: 1px solid #fecaca;
      text-align: center;
      font-weight: 700;
      padding: 6px;
      margin-bottom: 10px;
      letter-spacing: 1px;
    }
    @media print {
      @page { size: A4 portrait; margin: 12mm; }
      .no-print { display: none !important; }
      html, body { background: #fff; }
      .sheet {
        margin: 0;
        box-shadow: none;
        max-width: none;
        padding: 0;
        min-height: calc(297mm - 24mm); /* full page minus @page top+bottom margins */
      }
    }
  </style>
</head>
<body>
<main class="sheet">
  ${header.cancelled === "Y" ? `<div class="cancelled-banner">CANCELLED DOCUMENT</div>` : ""}

  <div class="company-header">
    ${logoHtml}
    <div class="company-name-block">
      <div class="company-name">${escapeHtml(header.div_name || "Company")}</div>
      <div class="company-sub">${escapeHtml(header.div_code ? `Division: ${header.div_code}` : "")}</div>
    </div>
  </div>

  <div class="report-title">DELIVERY NOTE</div>

  <div class="meta-grid">
    <div class="meta-left">
      <div class="party-name">To, ${escapeHtml(header.party_name)}</div>
      <div class="party-addr">${escapeHtml(addressBlock)}</div>
      <div class="contact-line">
        Tel : ${escapeHtml(header.party_phone)}
        &nbsp;&nbsp; Fax : ${escapeHtml(header.party_fax)}
        &nbsp;&nbsp; Mob No : ${escapeHtml(header.cust_mobile || header.dlvr_mobile)}
        &nbsp;&nbsp; Email : ${escapeHtml(header.cust_email || header.dlvr_email)}
      </div>
    </div>
    <div class="meta-right">
      <table>
        <tr><td class="lbl">Invoice No.</td><td class="val">: ${escapeHtml(header.doc_no)}</td></tr>
        <tr><td class="lbl">Date</td><td class="val">: ${escapeHtml(header.doc_date)}</td></tr>
        <tr><td class="lbl">A/C Code</td><td class="val">: ${escapeHtml(header.ac_code)}</td></tr>
        <tr><td class="lbl">Payment Term</td><td class="val">: ${escapeHtml(header.payment_terms)}</td></tr>
        <tr><td class="lbl">Sold By</td><td class="val">: ${escapeHtml(header.user_id)}</td></tr>
        <tr><td class="lbl">Delivery To</td><td class="val">: ${escapeHtml(header.delivery_to)}</td></tr>
      </table>
    </div>
  </div>

  <table class="lines">
    <thead>
      <tr>
        <th style="width:6%">S.No.</th>
        <th style="width:42%">Product / Description</th>
        <th style="width:10%">Unit</th>
        <th style="width:10%">Qty</th>
        <th style="width:14%">Unit Rate</th>
        <th style="width:14%">Gross Value</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows || `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:16px">No line items</td></tr>`}
    </tbody>
  </table>

  <div class="totals-block">
    <div class="totals-left">
      <div class="qty-line">Total Quantity: ${fmtNumber(totalQty, 0)}</div>
      <div class="amount-words">${escapeHtml(amountInWords)}</div>
      ${header.remarks ? `<div style="margin-top:8px;color:#475569">Remarks: ${escapeHtml(header.remarks)}</div>` : ""}
    </div>
    <div class="totals-right">
      <table>
        <tr>
          <td class="lbl">Total Amount:</td>
          <td class="val">${fmtNumber(totalAmount)}</td>
        </tr>
        <tr>
          <td class="lbl">Overall Discount:</td>
          <td class="val">${fmtNumber(overallDiscount)}</td>
        </tr>
        <tr class="grand">
          <td class="lbl">Grand Total:</td>
          <td class="val">${fmtNumber(grandTotal)}</td>
        </tr>
      </table>
    </div>
  </div>

  <div class="print-footer-block">
    <div class="sign-row">
      <div class="sign-box">Prepared By</div>
      <div class="sign-box">Checked By</div>
      <div class="sign-box">Delivered By</div>
      <div class="sign-box">Receiver's Name &amp; Signature</div>
    </div>

    <div class="footnote">Note: Goods once sold will not be taken back or exchanged</div>

    <div class="report-footer">
      <span>Print: ${escapeHtml(printDateTime)} &nbsp;|&nbsp; User: ${escapeHtml(loginId)}</span>
      <span>Report: rpt_sales_dn &nbsp;|&nbsp; Powered by Bayanat Technology</span>
    </div>
  </div>
</main>
</body>
</html>`;
}

// ─── Excel Builder ────────────────────────────────────────────────────────────

function buildSalesDNExcelBuffer(rows: ReportRow[], loginId: string): Buffer {
  const header = extractHeader(rows);
  const lines = extractLines(rows);

  const BLUE = "FF1D4ED8";
  const WHITE = "FFFFFFFF";
  const GRAY = "FF64748B";
  const LBLUE = "FFDBEAFE";
  const YELLOW = "FFFFFDE7";

  const borderThin = (color: string) => ({ style: "thin" as const, color: { rgb: color } });

  const styles = {
    title: {
      font: { bold: true, sz: 14, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "center", vertical: "center" },
    },
    section: {
      font: { bold: true, sz: 10 },
      fill: { fgColor: { rgb: LBLUE } },
    },
    label: { font: { sz: 9, color: { rgb: GRAY } } },
    value: { font: { bold: true, sz: 9 } },
    header: {
      font: { bold: true, sz: 9, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: {
        top: borderThin(BLUE),
        bottom: borderThin(BLUE),
        left: borderThin(BLUE),
        right: borderThin(BLUE),
      },
    },
    data: {
      font: { sz: 9 },
      alignment: { vertical: "top" },
      border: { bottom: borderThin("FFE2E8F0") },
    },
    dataNum: {
      font: { sz: 9 },
      alignment: { horizontal: "right", vertical: "top" },
      numFmt: "#,##0.00",
      border: { bottom: borderThin("FFE2E8F0") },
    },
    dataQty: {
      font: { sz: 9 },
      alignment: { horizontal: "right", vertical: "top" },
      numFmt: "#,##0",
      border: { bottom: borderThin("FFE2E8F0") },
    },
    totalLabel: {
      font: { bold: true, sz: 9 },
      fill: { fgColor: { rgb: YELLOW } },
    },
    totalNum: {
      font: { bold: true, sz: 9 },
      fill: { fgColor: { rgb: YELLOW } },
      alignment: { horizontal: "right" },
      numFmt: "#,##0.00",
    },
    grandLabel: {
      font: { bold: true, sz: 10, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
    },
    grandNum: {
      font: { bold: true, sz: 10, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "right" },
      numFmt: "#,##0.00",
    },
    meta: { font: { sz: 9, color: { rgb: "FF333333" } } },
    footer: { font: { italic: true, sz: 8, color: { rgb: "FF64748B" } } },
  };

  const COL_COUNT = 6;
  const sheetData: any[][] = [];
  const merges: XLSX.Range[] = [];
  const rowStyles: Array<Record<number, any>> = [];

  const addRow = (cells: any[], styleMap: Record<number, any>) => {
    while (cells.length < COL_COUNT) cells.push("");
    sheetData.push(cells.slice(0, COL_COUNT));
    rowStyles.push(styleMap);
  };

  const allStyle = (style: any) =>
    Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, style]));

  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // Title
  const titleR = sheetData.length;
  addRow(["DELIVERY NOTE", ...Array(COL_COUNT - 1).fill("")], allStyle(styles.title));
  merges.push({ s: { r: titleR, c: 0 }, e: { r: titleR, c: COL_COUNT - 1 } });

  // Meta print line
  addRow(
    [`Print Date: ${printDateTime}`, "", `Print User: ${loginId}`, "", "", ""],
    { 0: styles.meta, 2: styles.meta },
  );

  addRow(Array(COL_COUNT).fill(""), {});

  if (!header) {
    addRow(["No data found for the given document."], { 0: styles.value });
  } else {
    // Party / header block
    addRow([`To: ${header.party_name}`, "", "", `Invoice No.: ${header.doc_no}`, "", ""], {
      0: styles.value,
      3: styles.value,
    });
    const addr =
      header.party_address ||
      [header.cust_add1, header.cust_add2, header.cust_add3].filter(Boolean).join(" ");
    addRow([addr, "", "", `Date: ${header.doc_date}`, "", ""], {
      0: styles.data,
      3: styles.value,
    });
    addRow(
      [
        `Tel: ${header.party_phone}  Fax: ${header.party_fax}`,
        "",
        "",
        `A/C Code: ${header.ac_code}`,
        "",
        "",
      ],
      { 0: styles.data, 3: styles.value },
    );
    addRow(
      [
        `Mob: ${header.cust_mobile || header.dlvr_mobile}  Email: ${header.cust_email || header.dlvr_email}`,
        "",
        "",
        `Payment Term: ${header.payment_terms}`,
        "",
        "",
      ],
      { 0: styles.data, 3: styles.value },
    );
    addRow(["", "", "", `Sold By: ${header.user_id}`, "", ""], { 3: styles.value });
    addRow(["", "", "", `Delivery To: ${header.delivery_to}`, "", ""], { 3: styles.value });

    if (header.cancelled === "Y") {
      addRow(["*** CANCELLED DOCUMENT ***", ...Array(COL_COUNT - 1).fill("")], allStyle(styles.grandLabel));
      merges.push({
        s: { r: sheetData.length - 1, c: 0 },
        e: { r: sheetData.length - 1, c: COL_COUNT - 1 },
      });
    }

    addRow(Array(COL_COUNT).fill(""), {});

    // Column headers
    const hRow = sheetData.length;
    addRow(
      ["S.No.", "Product / Description", "Unit", "Qty", "Unit Rate", "Gross Value"],
      allStyle(styles.header),
    );

    // Lines
    lines.forEach((l, idx) => {
      const desc = l.det_remarks
        ? `${l.prod_code} - ${l.prod_name}\n${l.det_remarks}`
        : `${l.prod_code} - ${l.prod_name}`;
      addRow(
        [idx + 1, desc, l.p_uom, l.quantity, l.unit_price, l.amount],
        {
          0: { ...styles.data, alignment: { horizontal: "center", vertical: "top" } },
          1: styles.data,
          2: { ...styles.data, alignment: { horizontal: "center", vertical: "top" } },
          3: styles.dataQty,
          4: styles.dataNum,
          5: styles.dataNum,
        },
      );
    });

    if (!lines.length) {
      addRow(["", "No line items", "", "", "", ""], { 1: styles.data });
    }

    addRow(Array(COL_COUNT).fill(""), {});

    const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
    const totalAmount = lines.reduce((s, l) => s + l.amount, 0);
    const overallDiscount = header.disc_hdr_price;
    const grandTotal = totalAmount - overallDiscount;
    const currLabel =
      header.curr_code === "QAR" || header.curr_code === "QR"
        ? "QATARI RIYAL"
        : header.curr_code || "AMOUNT";
    const amountInWords = `${currLabel} - ${numberToWords(grandTotal)} only`;

    addRow(
      [`Total Quantity: ${totalQty}`, "", "", "Total Amount:", totalAmount, ""],
      {
        0: styles.totalLabel,
        3: styles.totalLabel,
        4: styles.totalNum,
      },
    );
    addRow(["", "", "", "Overall Discount:", overallDiscount, ""], {
      3: styles.totalLabel,
      4: styles.totalNum,
    });
    addRow(["", "", "", "Grand Total:", grandTotal, ""], {
      3: styles.grandLabel,
      4: styles.grandNum,
    });

    addRow([amountInWords, ...Array(COL_COUNT - 1).fill("")], { 0: styles.value });
    merges.push({
      s: { r: sheetData.length - 1, c: 0 },
      e: { r: sheetData.length - 1, c: COL_COUNT - 1 },
    });

    if (header.remarks) {
      addRow([`Remarks: ${header.remarks}`, ...Array(COL_COUNT - 1).fill("")], { 0: styles.data });
      merges.push({
        s: { r: sheetData.length - 1, c: 0 },
        e: { r: sheetData.length - 1, c: COL_COUNT - 1 },
      });
    }

    addRow(Array(COL_COUNT).fill(""), {});
    addRow(
      ["Prepared By", "Checked By", "Delivered By", "Receiver's Name & Signature", "", ""],
      {
        0: styles.label,
        1: styles.label,
        2: styles.label,
        3: styles.label,
      },
    );
  }

  // Footer
  addRow(
    ["", "", "", "", "", "Powered by Bayanat Technology"],
    { 5: styles.footer },
  );

  // Build worksheet
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws["!merges"] = merges;
  ws["!cols"] = [
    { wch: 8 },
    { wch: 42 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 14 },
  ];
  ws["!rows"] = sheetData.map((_, i) => ({ hpt: i === 0 ? 22 : 16 }));

  // Style engine (same approach as stock summary)
  interface FontDef {
    bold?: boolean;
    italic?: boolean;
    sz?: number;
    color?: string;
  }
  interface FillDef {
    color?: string;
  }
  interface BorderDef {
    top?: string;
    bottom?: string;
    left?: string;
    right?: string;
  }
  interface XfDef {
    fontId: number;
    fillId: number;
    borderId: number;
    numFmtId: number;
    align?: string;
    wrap?: boolean;
  }

  const fonts: FontDef[] = [{}];
  const fills: FillDef[] = [{}, {}];
  const borders: BorderDef[] = [{}];
  const numFmts: Array<{ id: number; code: string }> = [];
  const cellXfs: XfDef[] = [{ fontId: 0, fillId: 0, borderId: 0, numFmtId: 0 }];
  const sigCache = new Map<string, number>();
  let nextCustomNumFmtId = 164;

  const registerFont = (f: any): number => {
    const def: FontDef = {
      bold: !!f?.bold,
      italic: !!f?.italic,
      sz: f?.sz ?? 9,
      color: f?.color?.rgb,
    };
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
      top: b.top?.color?.rgb,
      bottom: b.bottom?.color?.rgb,
      left: b.left?.color?.rgb,
      right: b.right?.color?.rgb,
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

  const cellStyleIndex = new Map<string, number>();
  sheetData.forEach((row, r) => {
    const styleMap = rowStyles[r];
    row.forEach((_: any, c: number) => {
      if (styleMap[c]) cellStyleIndex.set(`${r},${c}`, registerXf(styleMap[c]));
    });
  });

  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  let sheetXmlData = "";
  for (let r2 = range.s.r; r2 <= range.e.r; r2++) {
    const cells: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const ref = XLSX.utils.encode_cell({ r: r2, c });
      const cell = ws[ref] as XLSX.CellObject | undefined;
      const styleIdx = cellStyleIndex.get(`${r2},${c}`);
      if (!cell && styleIdx === undefined) continue;
      const sAttr = styleIdx !== undefined ? ` s="${styleIdx}"` : "";
      const value = cell?.v;
      if (typeof value === "number") {
        cells.push(`<c r="${ref}"${sAttr}><v>${value}</v></c>`);
      } else if (value !== undefined && value !== null && value !== "") {
        cells.push(
          `<c r="${ref}"${sAttr} t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`,
        );
      } else if (styleIdx !== undefined) {
        cells.push(`<c r="${ref}"${sAttr}/>`);
      }
    }
    if (cells.length) sheetXmlData += `<row r="${r2 + 1}">${cells.join("")}</row>`;
  }

  const mergesXml = merges
    .map((m) => `<mergeCell ref="${XLSX.utils.encode_range(m)}"/>`)
    .join("");
  const mergeFinal = merges.length
    ? `<mergeCells count="${merges.length}">${mergesXml}</mergeCells>`
    : "";
  const colsXml = (ws["!cols"] || [])
    .map(
      (col: any, i: number) =>
        `<col min="${i + 1}" max="${i + 1}" width="${col.wch || 10}" customWidth="1"/>`,
    )
    .join("");

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="14"/>
  <cols>${colsXml}</cols>
  <sheetData>${sheetXmlData}</sheetData>
  ${mergeFinal}
</worksheet>`;

  const numFmtsXml = numFmts.length
    ? `<numFmts count="${numFmts.length}">${numFmts
        .map((n) => `<numFmt numFmtId="${n.id}" formatCode="${escapeXml(n.code)}"/>`)
        .join("")}</numFmts>`
    : "";

  const fontsXml = `<fonts count="${fonts.length}">${fonts
    .map(
      (f) => `
    <font>
      ${f.sz ? `<sz val="${f.sz}"/>` : '<sz val="9"/>'}
      ${f.color ? `<color rgb="${f.color}"/>` : '<color rgb="FF000000"/>'}
      <name val="Arial"/>
      ${f.bold ? "<b/>" : ""}
      ${f.italic ? "<i/>" : ""}
    </font>`,
    )
    .join("")}
  </fonts>`;

  const fillsXml = `<fills count="${fills.length}">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    ${fills
      .slice(2)
      .map(
        (f) => `
    <fill>
      <patternFill patternType="solid">
        <fgColor rgb="${f.color}"/>
        <bgColor rgb="${f.color}"/>
      </patternFill>
    </fill>`,
      )
      .join("")}
  </fills>`;

  const borderEdge = (rgb?: string) => (rgb ? `<color rgb="${rgb}"/>` : "");
  const bordersXml = `<borders count="${borders.length}">${borders
    .map(
      (b) => `
    <border>
      <left style="${b.left ? "thin" : "none"}">${borderEdge(b.left)}</left>
      <right style="${b.right ? "thin" : "none"}">${borderEdge(b.right)}</right>
      <top style="${b.top ? "thin" : "none"}">${borderEdge(b.top)}</top>
      <bottom style="${b.bottom ? "thin" : "none"}">${borderEdge(b.bottom)}</bottom>
      <diagonal/>
    </border>`,
    )
    .join("")}
  </borders>`;

  const cellXfsXml = `<cellXfs count="${cellXfs.length}">${cellXfs
    .map((xf) => {
      const applyAlign = xf.align || xf.wrap;
      return `
    <xf numFmtId="${xf.numFmtId}" fontId="${xf.fontId}" fillId="${xf.fillId}" borderId="${xf.borderId}"
        applyFont="1" applyFill="${xf.fillId ? 1 : 0}" applyBorder="${xf.borderId ? 1 : 0}"
        applyNumberFormat="${xf.numFmtId ? 1 : 0}" applyAlignment="${applyAlign ? 1 : 0}">
      ${
        applyAlign
          ? `<alignment${xf.align ? ` horizontal="${xf.align}"` : ""}${
              xf.wrap ? ` wrapText="1"` : ""
            } vertical="center"/>`
          : ""
      }
    </xf>`;
    })
    .join("")}
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
  zip.addFile("xl/styles.xml", Buffer.from(stylesXml));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheetXml));
  return zip.toBuffer();
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

/**
 * POST/GET body or query:
 *   company_code  (optional if present on req.user)
 *   doc_type      (default "SDN")
 *   doc_no        (required)
 */
export const getSalesDNReportHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const rows = await loadSalesDN(req);
    const html = renderSalesDNHtml(rows, req.user?.loginid ?? req.user?.username ?? "");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Sales DN Report HTML error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate Delivery Note report",
    });
  }
};

export const exportSalesDNReportExcel = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const { docNo } = parseDocParams(req);
    const rows = await loadSalesDN(req);
    const buffer = buildSalesDNExcelBuffer(
      rows,
      req.user?.loginid ?? req.user?.username ?? "",
    );
    const filename = `delivery_note_${docNo || "report"}_${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("Sales DN Report Excel error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to export Delivery Note report",
    });
  }
};