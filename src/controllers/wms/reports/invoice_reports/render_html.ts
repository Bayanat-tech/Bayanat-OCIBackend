// invoice.types.ts or in your render_html.ts
export interface InvoiceRow {
  prin_code: string | null;
  cust_code: string | null;
  from_date: string | null;
  to_date: string | null;
  inv_to: string | null;
  job_no: string | null;
  prin_ref1: string | null;
  prin_ref2: string | null;
  inv_desc2: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  curr_code: string | null;
  srno: number;
  inv_desc: string | null;
  other_services: string | null;
  quantity: number | null;
  bill_rate: number | null;
  bill: number | null;
  company_code: string | null;
  inv_desc1: string | null;
  prin_addr1: string | null;
  prin_addr2: string | null;
  prin_addr3: string | null;
  prin_addr4: string | null;
  prin_city: string | null;
  prin_telno1: string | null;
  prin_email1: string | null;
  prin_faxno1: string | null;
  act_group_name: string | null;
  activity_group_code: string | null;
  c_srno: number;
  invno_prefixed: string | null;
  remarks: string | null;
  inv_print_count: number;
  inv_printed: string | null;
  inv_grp_print_count: number;
  inv_grp_printed: string | null;
  fc_bill: string | null;
  ex_rate: number;
  address1: string | null;
  address2: string | null;
  address3: string | null;
  email: string | null;
  fax_no: string | null;
  tel_no: string | null;
  bank_name: string | null;
  ac_code: string | null;
  reference_no: string | null;
  bank_address: string | null;
  swift_code: string | null;
  company_short_name: string | null;
  signatory_1: string | null;
  signatory_2: string | null;
  city: string | null;
  country: string | null;
  inv_amount: number | null;
  discount: string | null;
  div_name: string | null;
  div_short_name: string | null;
  div_address1: string | null;
  div_address2: string | null;
  div_address3: string | null;
  phone: string | null;
  fax: string | null;
  bank_name_inv: string | null;
  ac_code_inv: string | null;
  reference_no_inv: string | null;
  bank_address_inv: string | null;
  swift_code_inv: string | null;
  invoice_to: string | null;
  sort_order: number;
  salesman: string | null;
  user_id: string | null;
  user_dt: Date | null;
  salesman_code: string | null;
  prin_trn_no: string | null;
  comp_trn_no: string | null;
  tot_vat_amt: number | null;
  tx_compnt_perc_1: number | null;
  tx_compnt_amt_1: number | null;
  tx_compnt_lcuramt_1: number | null;
  tx_compnt_1_expamt: string | null;
  due_date: string | null;
  onl_remrks: string | null;
  div_code: string | null;
  logo_path?: string | null;
  company_logo?: string | null;
  cust_vat_no?: string | null;
  customer_rep?: string | null;
  billing_rep?: string | null;
  /** When true / 'Y' / 'cost', row is treated as cost and hidden on the tax invoice */
  is_cost?: boolean | string | null;
  /** e.g. 'bill' | 'cost' | table name like 'job_cost' */
  row_source?: string | null;
  /** Service Accounting Code (SAC) – used by BTIND invoices */
  sac_code?: string | null;
  /** Company tax_num (India) */
  tax_num?: string | null;
  /** LUT ARN number for export invoices */
  lut_arn?: string | null;
  /** Optional company stamp / seal image URL */
  stamp_path?: string | null;
}

export interface InvoiceMeta {
  invoiceNo?: string;
  invoiceDate?: string;
  invoicePeriod?: string;
  clientName?: string;
  clientAddress?: string;
  clientVatNo?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtMoney(n: number | null | undefined, decimals = 3): string {
  const v = Number(n ?? 0);
  return v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

function threeDigitsToWords(n: number): string {
  let s = "";
  if (n >= 100) {
    s += ONES[Math.floor(n / 100)] + " Hundred ";
    n %= 100;
  }
  if (n >= 20) {
    s += TENS[Math.floor(n / 10)] + " ";
    n %= 10;
  }
  if (n > 0) {
    s += ONES[n] + " ";
  }
  return s.trim();
}

function integerToWords(num: number): string {
  if (num === 0) return "Zero";
  const groups = [
    { value: 1_000_000_000, label: "Billion" },
    { value: 1_000_000, label: "Million" },
    { value: 1_000, label: "Thousand" },
    { value: 1, label: "" },
  ];
  let n = Math.floor(num);
  let words = "";
  for (const g of groups) {
    const count = Math.floor(n / g.value);
    if (count > 0) {
      words += `${threeDigitsToWords(count)} ${g.label} `.trim() + " ";
      n %= g.value;
    }
  }
  return words.replace(/\s+/g, " ").trim();
}

// PDF renders the currency name in caps as its own leading token
// e.g. "OMANI RIAL - One Hundred and Sixty Two and BAISA Eight Hundred and Seventy Seven only"
const CURRENCY_NAMES: Record<string, { major: string; minor: string }> = {
  OMR: { major: "OMANI RIAL", minor: "BAISA" },
  SAR: { major: "SAUDI RIYAL", minor: "HALALA" },
  AED: { major: "UAE DIRHAM", minor: "FILS" },
  USD: { major: "US DOLLAR", minor: "CENT" },
  QAR: { major: "QATARI RIYAL", minor: "DIRHAM" },
  KWD: { major: "KUWAITI DINAR", minor: "FILS" },
  BHD: { major: "BAHRAINI DINAR", minor: "FILS" },
};

function amountInWords(amount: number, currCode: string | null | undefined, minorDigits = 3): string {
  const code = (currCode || "").toUpperCase();
  const names = CURRENCY_NAMES[code] || { major: code || "CURRENCY", minor: "CENTS" };
  const whole = Math.floor(amount);
  const fractionScale = Math.pow(10, minorDigits);
  const fraction = Math.round((amount - whole) * fractionScale);
  const wholeWords = integerToWords(whole);
  const fracWords = fraction > 0 ? ` and ${names.minor} ${integerToWords(fraction)}` : "";
  return `${names.major} - ${wholeWords}${fracWords} only`.replace(/\s+/g, " ");
}

/* ------------------------------------------------------------------ */
/*  Main builder                                                       */
/* ------------------------------------------------------------------ */

export function buildInvoiceHtmlAMKSA(rows: InvoiceRow[], meta: InvoiceMeta = {}): string {
  if (!rows || rows.length === 0) {
    return `<html><body><p style="font-family:Arial;padding:40px;text-align:center;color:#999;">No invoice data found.</p></body></html>`;
  }

  const first = rows[0];
  // Default currency: SAR for AMKSA / KSA, otherwise use provided code
  const currCode =
    first.curr_code ||
    (first.company_code === "AMKSA" || first.country === "KSA" ? "SAR" : "") ||
    "";

  const companyName = (first.div_short_name || first.div_name || "AL MADINA LOGISTICS").trim();
  const companyTagline = "AL MADINA LOGISTIC SERVICES COMPANY";

  const billToName = meta.clientName || first.reference_no || first.cust_code || "";
  const billToAddressLines = meta.clientAddress
    ? [meta.clientAddress]
    : [first.address1, first.address2, first.address3, first.city]
        .filter((v) => v && String(v).trim().length > 0);

  // ---- Detect cost rows (never show on tax invoice) ----
  function isCostRow(r: InvoiceRow): boolean {
    // Explicit flags from SQL
    if (r.is_cost === true || r.is_cost === "Y" || r.is_cost === "y" || r.is_cost === "1") {
      return true;
    }
    if (typeof r.is_cost === "string" && r.is_cost.toLowerCase().includes("cost")) {
      return true;
    }
    const source = (r.row_source || "").toLowerCase();
    if (source === "cost" || source.includes("_cost") || source.endsWith("cost") || source.includes("cost_")) {
      return true;
    }
    // Name / code heuristics
    const text = [r.act_group_name, r.activity_group_code, r.inv_desc, r.other_services, r.remarks]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (/\bcost\b|_cost|cost_/.test(text)) {
      return true;
    }
    return false;
  }

  // ---- Group by srno: one charge line per group (no cost / sub breakdown rows) ----
  const grouped = new Map<number, InvoiceRow[]>();
  for (const r of rows) {
    // Skip cost rows and rows with no billable amount
    if (isCostRow(r)) continue;
    if (r.bill == null || Number(r.bill) === 0) continue;
    const key = r.srno ?? 0;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  let rowCounter = 0;

  const itemRowsHtml = Array.from(grouped.values())
    .map((group) => {
      const head = group[0];
      rowCounter += 1;
      const qty = group.reduce((s, r) => s + Number(r.quantity ?? 0), 0);
      // Price: use bill_rate from head, or derive from bill/qty when rate missing
      const price =
        head.bill_rate != null && Number(head.bill_rate) !== 0
          ? Number(head.bill_rate)
          : qty > 0
            ? group.reduce((s, r) => s + Number(r.bill ?? 0), 0) / qty
            : Number(head.bill ?? 0);
      const excl = group.reduce((s, r) => s + Number(r.bill ?? 0), 0);
      const vatAmt = group.reduce((s, r) => s + Number(r.tx_compnt_amt_1 ?? 0), 0);
      const incl = group.reduce(
        (s, r) =>
          s +
          (r.tx_compnt_lcuramt_1 != null
            ? Number(r.tx_compnt_lcuramt_1)
            : Number(r.bill ?? 0) + Number(r.tx_compnt_amt_1 ?? 0)),
        0
      );
      const vatPct = Number(head.tx_compnt_perc_1 ?? 0);
      const desc =
        head.inv_desc ||
        head.other_services ||
        head.act_group_name ||
        "";

      // SR No | Description | Price | Qty | Total Before Tax | VAT % | VAT Amount | Total With VAT
      return `
        <tr>
          <td class="c-no">${rowCounter}</td>
          <td class="c-desc">${esc(desc)}</td>
          <td class="c-price">${fmtMoney(price, 3)}</td>
          <td class="c-qty">${qty || ""}</td>
          <td class="c-amt">${fmtMoney(excl, 3)}</td>
          <td class="c-vat">${vatPct}</td>
          <td class="c-amt">${fmtMoney(vatAmt, 5)}</td>
          <td class="c-amt">${fmtMoney(incl, 3)}</td>
        </tr>`;
    })
    .join("");

  // Many fixed-height blank rows + one expanding spacer so the table
  // body always covers the full remaining page (no white gap under items).
  const FIXED_FILLERS = 28;
  const fixedFillerHtml = Array.from({ length: FIXED_FILLERS })
    .map(
      () =>
        `<tr class="filler-row"><td class="c-no"></td><td class="c-desc"></td><td class="c-price"></td><td class="c-qty"></td><td class="c-amt"></td><td class="c-vat"></td><td class="c-amt"></td><td class="c-amt"></td></tr>`
    )
    .join("");
  const fillerRowsHtml =
    fixedFillerHtml +
    `
        <tr class="spacer-row">
          <td class="c-no"></td>
          <td class="c-desc"></td>
          <td class="c-price"></td>
          <td class="c-qty"></td>
          <td class="c-amt"></td>
          <td class="c-vat"></td>
          <td class="c-amt"></td>
          <td class="c-amt"></td>
        </tr>`;

  const billableRows = rows.filter((r) => !isCostRow(r) && r.bill != null && Number(r.bill) !== 0);
  const totalBeforeVat = billableRows.reduce((s, r) => s + Number(r.bill ?? 0), 0);
  const totalVat = billableRows.reduce((s, r) => s + Number(r.tx_compnt_amt_1 ?? 0), 0);
  const totalAfterVat = totalBeforeVat + totalVat;

  const printDate = fmtDate(first.invoice_date || first.user_dt);
  const dueDate = fmtDate(first.due_date);
  const invoiceNo = meta.invoiceNo || first.invoice_no || "";
  const invoicePeriod =
    meta.invoicePeriod ||
    (first.from_date && first.to_date ? `${fmtDate(first.from_date)} - ${fmtDate(first.to_date)}` : "");
  const vatNo = meta.clientVatNo || first.cust_vat_no || first.prin_trn_no || "";
  const companyVatNo = first.comp_trn_no || "";

  // Prefer inv-specific bank fields when present (matches sample layout)
  const bankName = first.bank_name_inv || first.bank_name || "";
  const acCode = first.ac_code_inv || first.ac_code || "";
  const bankAddr = first.bank_address_inv || first.bank_address || "";
  const swift = first.swift_code_inv || first.swift_code || "";

  const bankSection =
    bankName || acCode || swift || bankAddr
      ? `
    <div class="bank-block">
      <div class="bank-title">Bank Details</div>
      ${bankName ? `<div class="bank-line">${esc(bankName)}</div>` : ""}
      ${acCode ? `<div class="bank-line">${esc(acCode)}</div>` : ""}
      <div class="bank-line">For ${esc(companyName)}${first.city ? `(${esc(first.city)})` : ""}</div>
      ${bankAddr ? `<div class="bank-line">${esc(bankAddr)}</div>` : ""}
      ${
        swift
          ? `<div class="bank-line">Swift: ${esc(swift)}${acCode ? `, IBAN: ${esc(acCode)}` : ""}</div>`
          : ""
      }
      <div class="bank-line">All cheques to be favour of ${esc(companyName.toUpperCase())}</div>
    </div>`
      : "";

  const metaRows: Array<[string, string]> = [
    ["Invoice No.", esc(invoiceNo)],
    ["Invoice Print Date", printDate],
    ...(invoicePeriod ? ([["Invoice Period", invoicePeriod]] as Array<[string, string]>) : []),
    ...(dueDate ? ([["Due Date", dueDate]] as Array<[string, string]>) : []),
    ["Customer Rep", esc(first.customer_rep || "")],
    ["Currency", esc(currCode)],
    ["Sales Rep", esc(first.salesman || "")],
    ["Billing Rep", esc(first.billing_rep || "")],
    ["VAT (TIN No)", esc(companyVatNo)],
    ["", "Page 1 of 1"],
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Tax Invoice ${esc(invoiceNo)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body {
    height: 100%;
    margin: 0;
    padding: 0;
  }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11px;
    background: #e8e8e8;
    color: #000;
    padding: 12px;
  }
  .invoice-wrapper {
    max-width: 794px;
    width: 100%;
    margin: 0 auto;
    background: #ffffff;
    padding: 12px 18px 8px 18px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
    /* Full A4 page height – content fills it completely */
    height: 1123px;
    min-height: 1123px;
    border: none;
    display: flex;
    flex-direction: column;
  }
  @media print {
    @page { size: A4; margin: 8mm; }
    html, body { height: 100%; background: #fff; padding: 0; margin: 0; }
    .invoice-wrapper {
      box-shadow: none;
      max-width: 100%;
      width: 100%;
      height: 100vh;
      min-height: 100vh;
      border: none;
      padding: 6px 10px;
      page-break-after: always;
    }
    .no-print { display: none !important; }
  }
  .no-print { text-align: right; margin-bottom: 8px; }
  .no-print button {
    padding: 6px 20px; background: #1a3c5e; color: #fff; border: none;
    border-radius: 4px; font-size: 12px; cursor: pointer;
  }

  /* ---- Masthead ---- */
  .masthead { text-align: left; margin-bottom: 2px; flex-shrink: 0; }
  .logo-img {
    max-height: 80px;
    max-width: 320px;
    object-fit: contain;
    display: block;
  }
  .company-name-fallback { font-size: 18px; font-weight: 700; color: #1a3c5e; }
  .company-tagline {
    font-size: 9px; font-weight: 700; letter-spacing: 1.5px; color: #333;
    margin: 2px 0 6px 0;
  }
  .invoice-title {
    text-align: center; font-size: 18px; font-weight: 700;
    letter-spacing: 4px; margin-bottom: 6px; flex-shrink: 0;
  }

  /* ---- To: / meta  (no borders) ---- */
  .top-info {
    display: flex;
    border: none;
    flex-shrink: 0;
  }
  .to-block { flex: 1.3; padding: 6px 10px 6px 0; border: none; }
  .to-label { font-weight: 700; font-size: 10px; margin-bottom: 2px; }
  .to-name { font-weight: 700; font-size: 11px; margin-bottom: 1px; }
  .to-line { font-size: 10px; line-height: 1.5; border: none; max-width: 280px; }
  .meta-block { flex: 1; padding: 6px 0 6px 10px; border: none; }
  .meta-row { display: flex; font-size: 10px; line-height: 1.5; }
  .meta-label { width: 120px; color: #000; }
  .meta-colon { width: 10px; }
  .meta-value { font-weight: 600; flex: 1; }

  /* ---- Table area: takes ALL remaining vertical space ---- */
  .table-area {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
    margin-top: 4px;
  }
  /* Full table grid – outer + all internal borders */
  .items-table {
    width: 100%;
    height: 100%;
    border-collapse: collapse;
    border: 1px solid #000;
    font-size: 10px;
    table-layout: fixed;
  }
  .items-table th,
  .items-table td {
    border: 1px solid #000;
    padding: 3px 4px;
    vertical-align: top;
    overflow: hidden;
  }
  .items-table thead th {
    background: #eef2f6;
    font-weight: 700;
    font-size: 9px;
    text-align: left;
    vertical-align: middle;
  }
  /* Fixed widths – 8 columns: SR | Desc | Price | Qty | Before Tax | VAT% | VAT Amt | With VAT */
  .c-no  { width: 28px;  text-align: center; padding-left: 2px; padding-right: 2px; }
  .c-desc { width: auto; text-align: left; word-wrap: break-word; overflow-wrap: break-word; }
  .c-price {
    width: 80px;
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    padding-left: 2px;
    padding-right: 4px;
  }
  .c-qty {
    width: 40px;
    text-align: center;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .c-amt {
    width: 90px;
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    padding-left: 2px;
    padding-right: 4px;
  }
  .c-vat { width: 36px;  text-align: center; white-space: nowrap; padding-left: 1px; padding-right: 1px; }
  .sub-row td { border: 1px solid #000; }
  .sub-desc { padding-left: 14px; color: #333; }
  .sub-amt { color: #333; }
  .total-prefix { font-size: 8.5px; font-weight: 700; margin-right: 3px; }

  /* Filler rows keep vertical borders continuous, no horizontal lines */
  .filler-row td {
    border-top: none !important;
    border-bottom: none !important;
    border-left: 1px solid #000;
    border-right: 1px solid #000;
    height: 14px;
    padding: 0 5px;
  }
  .spacer-row td {
    border-top: none !important;
    border-bottom: none !important;
    border-left: 1px solid #000;
    border-right: 1px solid #000;
    height: 100%;
    min-height: 40px;
    padding: 0;
    vertical-align: top;
  }

  .legend-row td {
    font-size: 8.5px;
    color: #333;
    border: 1px solid #000;
    vertical-align: middle;
    padding: 3px 4px;
  }
  .words-row .total-label {
    text-align: left;
    font-weight: 700;
    font-size: 9.5px;
    white-space: normal;
    word-wrap: break-word;
  }
  .words-row td {
    border: 1px solid #000;
    border-top: 2px solid #000;
    font-weight: 700;
    vertical-align: middle;
    padding: 4px;
  }
  .words-row .c-amt { font-weight: 700; white-space: nowrap; }

  /* ---- Bank + signature (sits just above footer) ---- */
  .bank-sig-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-top: 10px;
    flex-shrink: 0;
  }
  .bank-block { font-size: 10px; line-height: 1.45; max-width: 62%; }
  .bank-title { font-weight: 700; text-decoration: underline; margin-bottom: 2px; }
  .bank-line { margin-bottom: 1px; }
  .signature-text {
    font-weight: 700;
    font-size: 11px;
    text-align: right;
    white-space: nowrap;
    padding-top: 4px;
  }

  /* ---- Footer pinned to bottom of page (no border) ---- */
  .footer {
    margin-top: 8px;
    padding-top: 6px;
    border: none;
    text-align: center;
    font-size: 10px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .footer .addr-line { font-weight: 400; margin-top: 2px; }
  .footer .disclaimer {
    font-weight: 400;
    font-size: 8.5px;
    color: #333;
    border: none;
    margin-top: 4px;
    text-align: left;
    padding-top: 3px;
  }
</style>
</head>
<body>

<div class="no-print">
  <button onclick="window.print()">🖨️ Print / Save PDF</button>
</div>

<div class="invoice-wrapper">

  <!-- Masthead -->
  <div class="masthead">
    ${
      (() => {
        const logoUrl = (first.company_logo || first.logo_path || "").trim();
        if (logoUrl) {
          return `<img class="logo-img" src="${esc(logoUrl)}" alt="Logo" />`;
        }
        return `<div class="company-name-fallback">${esc(companyName)}</div>`;
      })()
    }
    <div class="company-tagline">${esc(companyTagline)}</div>
  </div>
  <div class="invoice-title">TAX INVOICE</div>

  <!-- To: + meta -->
  <div class="top-info">
    <div class="to-block">
      <div class="to-label">To :</div>
      <div class="to-name">${esc(billToName)}</div>
      ${billToAddressLines.map((l) => `<div class="to-line">${esc(l)}</div>`).join("")}
      ${first.tel_no ? `<div class="to-line">Ph. ${esc(first.tel_no)}</div>` : ""}
      ${first.fax_no ? `<div class="to-line">Fax: ${esc(first.fax_no)}</div>` : ""}
      ${first.email ? `<div class="to-line">e-Mail : ${esc(first.email)}</div>` : ""}
      ${vatNo ? `<div class="to-line">VAT (TIN No) : ${esc(vatNo)}</div>` : ""}
    </div>
    <div class="meta-block">
      ${metaRows
        .map(
          ([label, value]) => `
      <div class="meta-row">
        <div class="meta-label">${label}</div>
        <div class="meta-colon">${label ? ":" : ""}</div>
        <div class="meta-value">${value}</div>
      </div>`
        )
        .join("")}
    </div>
  </div>

  <!-- Items table (expands with blank rows) -->
  <div class="table-area">
    <table class="items-table">
      <colgroup>
        <col style="width:28px" />
        <col />
        <col style="width:80px" />
        <col style="width:40px" />
        <col style="width:90px" />
        <col style="width:36px" />
        <col style="width:90px" />
        <col style="width:90px" />
      </colgroup>
      <thead>
        <tr>
          <th class="c-no">SR No</th>
          <th class="c-desc">Description</th>
          <th class="c-price" style="text-align:right;">Price</th>
          <th class="c-qty" style="text-align:center;">Qty</th>
          <th class="c-amt" style="text-align:right;">Total<br/>Before Tax</th>
          <th class="c-vat" style="text-align:center;">VAT<br/>%</th>
          <th class="c-amt" style="text-align:right;">VAT<br/>Amount</th>
          <th class="c-amt" style="text-align:right;">Total<br/>With VAT</th>
        </tr>
      </thead>
      <tbody>
        ${itemRowsHtml}
        ${fillerRowsHtml}
        <tr class="legend-row">
          <td colspan="8">NT - No Tax, 0% - Zero, 5% - Standard</td>
        </tr>
        <tr class="words-row">
          <td class="total-label" colspan="4">${esc(amountInWords(totalAfterVat, currCode, 3))}</td>
          <td class="c-amt"><span class="total-prefix">Total :</span> ${fmtMoney(totalBeforeVat, 3)}</td>
          <td class="c-vat"></td>
          <td class="c-amt">${fmtMoney(totalVat, 3)}</td>
          <td class="c-amt">${fmtMoney(totalAfterVat, 3)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Bank + signature -->
  <div class="bank-sig-row">
    ${bankSection}
    <div class="signature-text">For ${esc(companyName)}${first.city ? ` (${esc(first.city)})` : ""}</div>
  </div>

  <!-- Footer -->
  <div class="footer">
    <div>${esc(first.div_address1 || "")}</div>
    <div class="addr-line">
      ${first.phone ? `Tel: ${esc(first.phone)}` : ""}${first.fax ? ` ; Fax: ${esc(first.fax)}` : ""}${
        first.email ? ` ; e-Mail: ${esc(first.email)}` : ""
      }
    </div>
    <div class="disclaimer">
      Details mentioned in this document is deemed accurate as per AMLS DC billing records related to activities mentioned in this document.<br/>
      Disputes (if any) to be copied to AMLS in writing within 72 hours from Invoice date or else AMLS will not be obligated to attend to it.
    </div>
  </div>

</div>

</body>
</html>`;
}

/* ================================================================== */
/*  BTIND – Bayanat Technology Pvt Ltd (India) Tax Invoice             */
/* ================================================================== */

function amountInWordsBTIND(amount: number, currCode: string | null | undefined): string {
  const code = (currCode || "USD").toUpperCase();
  // Match sample: "US DOLLARS - Six Thousand Five Hundred and Seventy only"
  const majorNames: Record<string, string> = {
    USD: "US DOLLARS",
    INR: "INDIAN RUPEES",
    OMR: "OMANI RIALS",
    SAR: "SAUDI RIYALS",
    AED: "UAE DIRHAMS",
    EUR: "EUROS",
    GBP: "POUNDS STERLING",
  };
  const minorNames: Record<string, string> = {
    USD: "CENTS",
    INR: "PAISE",
    OMR: "BAISA",
    SAR: "HALALAS",
    AED: "FILS",
    EUR: "CENTS",
    GBP: "PENCE",
  };
  const major = majorNames[code] || `${code}`;
  const minor = minorNames[code] || "CENTS";
  const whole = Math.floor(amount);
  const fraction = Math.round((amount - whole) * 100);
  const wholeWords = integerToWords(whole);
  const fracWords = fraction > 0 ? ` and ${minor} ${integerToWords(fraction)}` : "";
  return `${major} - ${wholeWords}${fracWords} only`.replace(/\s+/g, " ");
}

/**
 * Build HTML for BTIND (Bayanat Technology India) tax invoice.
 * Layout matches BI26xxxxxx export invoices:
 *   No. | Description | Service Accounting Code (SAC) | Amount ($)
 */
export function buildInvoiceHtmlBTIND(rows: InvoiceRow[], meta: InvoiceMeta = {}): string {
  if (!rows || rows.length === 0) {
    return `<html><body><p style="font-family:Arial;padding:40px;text-align:center;color:#999;">No invoice data found.</p></body></html>`;
  }

  const first = rows[0];
  const currCode = (first.curr_code || "USD").toUpperCase();
  const currSymbol = currCode === "USD" ? "$" : currCode === "INR" ? "₹" : currCode;

  const companyName =
    (first.div_short_name || first.div_name || first.company_short_name || "BAYANAT TECHNOLOGY PRIVATE LTD").trim();
  const companyTagline = "BAYANAT TECHNOLOGY PVT.LTD";
  const companyLegal = "BAYANAT TECHNOLOGY PVT LTD (INDIA)";

  const billToName =
    meta.clientName || first.reference_no || first.invoice_to || first.cust_code || "";
  const billToAddressLines = meta.clientAddress
    ? [meta.clientAddress]
    : [first.address1, first.address2, first.address3, first.city]
        .filter((v) => v && String(v).trim().length > 0);

  const clienttax_num = meta.clientVatNo || first.cust_vat_no || first.prin_trn_no || "N.A.";
  const companytax_num = first.tax_num || first.comp_trn_no || "";

  // ---- Cost filter (same rules as AMKSA) ----
  function isCostRow(r: InvoiceRow): boolean {
    if (r.is_cost === true || r.is_cost === "Y" || r.is_cost === "y" || r.is_cost === "1") return true;
    if (typeof r.is_cost === "string" && r.is_cost.toLowerCase().includes("cost")) return true;
    const source = (r.row_source || "").toLowerCase();
    if (source === "cost" || source.includes("_cost") || source.endsWith("cost") || source.includes("cost_")) {
      return true;
    }
    const text = [r.act_group_name, r.activity_group_code, r.inv_desc, r.other_services, r.remarks]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return /\bcost\b|_cost|cost_/.test(text);
  }

  // ---- Group by srno ----
  const grouped = new Map<number, InvoiceRow[]>();
  for (const r of rows) {
    if (isCostRow(r)) continue;
    if (r.bill == null || Number(r.bill) === 0) continue;
    const key = r.srno ?? 0;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  let rowCounter = 0;
  const itemRowsHtml = Array.from(grouped.values())
    .map((group) => {
      const head = group[0];
      rowCounter += 1;
      const groupAmt = group.reduce((s, r) => s + Number(r.bill ?? 0), 0);
      const headDesc = head.act_group_name || head.inv_desc || head.other_services || "";

      // Group header row (description + total amount, no SAC)
      const headRow = `
        <tr>
          <td class="c-no">${rowCounter}</td>
          <td class="c-desc"><strong>${esc(headDesc)}</strong></td>
          <td class="c-sac"></td>
          <td class="c-amt">${fmtMoney(groupAmt, 2)}</td>
        </tr>`;

      // Detail / SAC rows
      const subRows = group
        .map((r) => {
          const subDesc = r.inv_desc || r.other_services || headDesc;
          const sac =
            r.sac_code ||
            (r.activity_group_code && /^\d{4,6}$/.test(String(r.activity_group_code))
              ? r.activity_group_code
              : "") ||
            r.prin_ref1 ||
            r.inv_desc2 ||
            "";
          const subAmt = Number(r.bill ?? 0);
          // Skip redundant sub-row when only one line and same description with no SAC
          if (group.length === 1 && !sac && subDesc === headDesc) {
            return "";
          }
          return `
        <tr class="sub-row">
          <td class="c-no">${r.c_srno ?? ""}</td>
          <td class="c-desc sub-desc">${esc(subDesc)}</td>
          <td class="c-sac">${esc(sac)}</td>
          <td class="c-amt sub-amt">${fmtMoney(subAmt, 2)}</td>
        </tr>`;
        })
        .join("");

      return headRow + subRows;
    })
    .join("");

  // Fillers so table body stretches to bottom
  const FIXED_FILLERS = 18;
  const fixedFillerHtml = Array.from({ length: FIXED_FILLERS })
    .map(
      () =>
        `<tr class="filler-row"><td class="c-no"></td><td class="c-desc"></td><td class="c-sac"></td><td class="c-amt"></td></tr>`
    )
    .join("");
  const fillerRowsHtml =
    fixedFillerHtml +
    `
        <tr class="spacer-row">
          <td class="c-no"></td>
          <td class="c-desc"></td>
          <td class="c-sac"></td>
          <td class="c-amt"></td>
        </tr>`;

  const totalAmt = rows.reduce((s, r) => {
    if (isCostRow(r)) return s;
    return s + Number(r.bill ?? 0);
  }, 0);

  const printDate = fmtDate(first.invoice_date || first.user_dt);
  const dueDate = fmtDate(first.due_date);
  const invoiceNo = meta.invoiceNo || first.invoice_no || first.invno_prefixed || "";
  const invoicePeriod =
    meta.invoicePeriod ||
    (first.from_date && first.to_date ? `${fmtDate(first.from_date)} - ${fmtDate(first.to_date)}` : "");

  const lutArn = first.lut_arn || "";
  const exportNote =
    first.onl_remrks ||
    "Export invoice for authorized operations without payment of IGST.";

  // Bank fields
  const bankName = first.bank_name_inv || first.bank_name || "";
  const acCode = first.ac_code_inv || first.ac_code || "";
  const bankAddr = first.bank_address_inv || first.bank_address || "";
  const swift = first.swift_code_inv || first.swift_code || "";

  const bankSection = `
    <div class="bank-block">
      <div class="bank-title">Bank Details</div>
      ${bankName ? `<div class="bank-line">${esc(bankName)}</div>` : ""}
      ${acCode ? `<div class="bank-line">${esc(acCode)}</div>` : ""}
      <div class="bank-line">For ${esc(companyName)}</div>
      ${bankAddr ? `<div class="bank-line">${esc(bankAddr)}</div>` : ""}
      ${swift ? `<div class="bank-line">${esc(swift)}</div>` : ""}
      <div class="bank-line">All Cheques to be favour of ${esc(companyLegal)}</div>
      <div class="bank-line export-note">${esc(exportNote)}</div>
      <div class="bank-line">LUT ARN No: AS270326095738G</div>
    </div>`;

  const logoUrl = (first.company_logo || first.logo_path || "").trim();
  const stampUrl = (first.stamp_path || "").trim();

  const metaRows: Array<[string, string]> = [
    ["Invoice No.", esc(invoiceNo)],
    ["Invoice Date", printDate],
    ["Invoice Period", invoicePeriod],
    ["Due Date", dueDate],
    ["Customer Rep", esc(first.customer_rep || "")],
    ["Currency", esc(currCode)],
    ["Sales Rep", esc(first.salesman || "")],
    ["Bill Rep", esc(first.billing_rep || first.company_code || "BTIND")],
    ["GSTIN", esc(companytax_num)],
  ];

  const footerAddress =
    first.div_address1 ||
    "BAYANAT TECHNOLOGY PVT LTD (INDIA) 706 LOTUS TRADE CENTRE KL WALAWALKAR MARG SAHAKAR NGR ,ANDHERI WEST MUMBAI";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Tax Invoice ${esc(invoiceNo)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { height: 100%; margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 10px;
    background: #e8e8e8;
    color: #000;
    padding: 12px;
  }
  .invoice-wrapper {
    max-width: 794px;
    width: 100%;
    margin: 0 auto;
    background: #ffffff;
    padding: 14px 18px 10px 18px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
    height: 1123px;
    min-height: 1123px;
    border: none;
    display: flex;
    flex-direction: column;
  }
  @media print {
    @page { size: A4; margin: 8mm; }
    html, body { height: 100%; background: #fff; padding: 0; margin: 0; }
    .invoice-wrapper {
      box-shadow: none;
      max-width: 100%;
      width: 100%;
      height: 100vh;
      min-height: 100vh;
      border: none;
      padding: 6px 10px;
      page-break-after: always;
    }
    .no-print { display: none !important; }
  }
  .no-print { text-align: right; margin-bottom: 8px; }
  .no-print button {
    padding: 6px 20px; background: #1a3c5e; color: #fff; border: none;
    border-radius: 4px; font-size: 12px; cursor: pointer;
  }

  /* ---- Masthead ---- */
  .masthead { text-align: left; margin-bottom: 4px; flex-shrink: 0; }
  .logo-img {
    max-height: 70px;
    max-width: 280px;
    object-fit: contain;
    display: block;
  }
  .company-name-fallback {
    font-size: 16px; font-weight: 700; color: #1a3c5e; letter-spacing: 1px;
  }
  .company-tagline {
    font-size: 9px; font-weight: 600; letter-spacing: 2px; color: #555;
    margin: 2px 0 4px 0;
    text-align: left;
  }
  .invoice-title {
    text-align: center; font-size: 16px; font-weight: 700;
    letter-spacing: 3px; margin: 6px 0 4px 0; flex-shrink: 0;
  }
  .title-rule {
    border: none; border-top: 2px solid #000; margin: 0 0 6px 0; flex-shrink: 0;
  }

  /* ---- To: / meta ---- */
  .top-info {
    display: flex;
    border: none;
    flex-shrink: 0;
    margin-bottom: 4px;
  }
  .to-block { flex: 1.35; padding: 4px 10px 4px 0; }
  .to-label { font-weight: 700; font-size: 10px; margin-bottom: 2px; }
  .to-name { font-weight: 700; font-size: 11px; margin-bottom: 1px; }
  .to-line {
    font-size: 10px; line-height: 1.45;
    border-bottom: 1px solid #bbb; max-width: 300px; min-height: 14px;
  }
  .meta-block { flex: 1; padding: 4px 0 4px 12px; }
  .meta-row { display: flex; font-size: 10px; line-height: 1.5; }
  .meta-label { width: 110px; color: #000; }
  .meta-colon { width: 10px; }
  .meta-value { font-weight: 600; flex: 1; }
  .page-line {
    text-align: right; font-size: 9px; margin-top: 2px; color: #333;
  }

  /* ---- Table ---- */
  .table-area {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
    margin-top: 2px;
  }
  .items-table {
    width: 100%;
    height: 100%;
    border-collapse: collapse;
    border: 1px solid #000;
    font-size: 10px;
    table-layout: fixed;
  }
  .items-table th,
  .items-table td {
    border: 1px solid #000;
    padding: 3px 5px;
    vertical-align: top;
    overflow: hidden;
  }
  .items-table thead th {
    background: #f0f0f0;
    font-weight: 700;
    font-size: 9.5px;
    text-align: center;
    vertical-align: middle;
  }
  .c-no  { width: 32px; text-align: center; }
  .c-desc { text-align: left; word-wrap: break-word; overflow-wrap: break-word; }
  .c-sac { width: 130px; text-align: center; white-space: nowrap; }
  .c-amt {
    width: 110px;
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .sub-desc { padding-left: 18px; color: #222; }
  .sub-amt { color: #222; }

  .filler-row td {
    border-top: none !important;
    border-bottom: none !important;
    border-left: 1px solid #000;
    border-right: 1px solid #000;
    height: 14px;
    padding: 0 5px;
  }
  .spacer-row td {
    border-top: none !important;
    border-bottom: none !important;
    border-left: 1px solid #000;
    border-right: 1px solid #000;
    height: 100%;
    min-height: 30px;
    padding: 0;
  }

  .words-row td {
    border: 1px solid #000;
    border-top: 2px solid #000;
    font-weight: 700;
    vertical-align: middle;
    padding: 5px;
    font-size: 10px;
  }
  .words-row .total-label { text-align: left; }
  .words-row .total-prefix { font-size: 10px; margin-right: 4px; }

  /* ---- Bank + stamp ---- */
  .bank-sig-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-top: 10px;
    flex-shrink: 0;
  }
  .bank-block { font-size: 9.5px; line-height: 1.45; max-width: 58%; }
  .bank-title { font-weight: 700; text-decoration: underline; margin-bottom: 2px; }
  .bank-line { margin-bottom: 1px; }
  .export-note { margin-top: 4px; }
  .stamp-block {
    text-align: center;
    min-width: 160px;
  }
  .stamp-img {
    max-height: 90px;
    max-width: 140px;
    object-fit: contain;
  }
  .signature-text {
    font-weight: 700;
    font-size: 10px;
    text-align: center;
    margin-top: 4px;
  }

  /* ---- Footer ---- */
  .footer {
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px solid #000;
    text-align: center;
    font-size: 9px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .footer .addr-line { font-weight: 400; margin-top: 2px; font-size: 8.5px; }
  .footer .disclaimer {
    font-weight: 400;
    font-size: 8px;
    color: #333;
    margin-top: 4px;
    text-align: left;
    padding-top: 3px;
  }
</style>
</head>
<body>

<div class="no-print">
  <button onclick="window.print()">🖨️ Print / Save PDF</button>
</div>

<div class="invoice-wrapper">

  <!-- Masthead -->
  <div class="masthead">
    ${
      logoUrl
        ? `<img class="logo-img" src="${esc(logoUrl)}" alt="Logo" />`
        : `<div class="company-name-fallback">${esc(companyName)}</div>`
    }
    <div class="company-tagline">${esc(companyTagline)}</div>
  </div>
  <div class="invoice-title">TAX INVOICE</div>
  <hr class="title-rule" />

  <!-- To: + meta -->
  <div class="top-info">
    <div class="to-block">
      <div class="to-label">To :</div>
      <div class="to-name">${esc(billToName)}</div>
      ${billToAddressLines.map((l) => `<div class="to-line">${esc(l)}</div>`).join("")}
      ${first.tel_no ? `<div class="to-line">Ph. ${esc(first.tel_no)}</div>` : ""}
      ${first.fax_no ? `<div class="to-line">Fax. ${esc(first.fax_no)}</div>` : ""}
      ${first.email ? `<div class="to-line">e-Mail : ${esc(first.email)}</div>` : ""}
      <div class="to-line">GSTIN: ${esc(clienttax_num)}</div>
    </div>
    <div class="meta-block">
      ${metaRows
        .map(
          ([label, value]) => `
      <div class="meta-row">
        <div class="meta-label">${label}</div>
        <div class="meta-colon">:</div>
        <div class="meta-value">${value}</div>
      </div>`
        )
        .join("")}
      <div class="page-line">Page 1 of 1</div>
    </div>
  </div>

  <!-- Items table -->
  <div class="table-area">
    <table class="items-table">
      <colgroup>
        <col style="width:32px" />
        <col />
        <col style="width:130px" />
        <col style="width:110px" />
      </colgroup>
      <thead>
        <tr>
          <th class="c-no">No.</th>
          <th class="c-desc">Description</th>
          <th class="c-sac">Service Accounting<br/>Code (SAC)</th>
          <th class="c-amt">Amount (${esc(currSymbol)})</th>
        </tr>
      </thead>
      <tbody>
        ${itemRowsHtml}
        ${fillerRowsHtml}
        <tr class="words-row">
          <td class="total-label" colspan="2">${esc(amountInWordsBTIND(totalAmt, currCode))}</td>
          <td style="text-align:right;font-weight:700;"><span class="total-prefix">Total :</span></td>
          <td class="c-amt">${fmtMoney(totalAmt, 2)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Bank + stamp / signature -->
  <div class="bank-sig-row">
    ${bankSection}
    <div class="stamp-block">
      ${stampUrl ? `<img class="stamp-img" src="${esc(stampUrl)}" alt="Stamp" />` : ""}
      <div class="signature-text">${esc(companyLegal)}</div>
    </div>
  </div>

  <!-- Footer -->
  <div class="footer">
    <div>${esc(footerAddress)}</div>
    <div class="disclaimer">
      Details mentioned in this document is deemed accurate as per BAYANAT TECHNOLOGY PVT LTD billing records related to activities mentioned in this document.<br/>
      Disputes (if any) to be copied to BAYANAT TECHNOLOGY PVT LTD in writing within 72 hours from Invoice date or else BAYANAT TECHNOLOGY PVT LTD will not be obligated to attend to it.<br/>
      Electronic document, Signature not required
    </div>
  </div>

</div>

</body>
</html>`;
}
