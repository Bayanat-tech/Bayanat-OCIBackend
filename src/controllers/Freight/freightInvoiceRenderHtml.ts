// freightInvoiceRenderHtml.ts - Dedicated HTML invoice template generator for Freight Module

export interface FreightInvoiceRow {
  prin_code: string | null;
  client_name: string | null;
  company_name: string | null;
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
  activity?: string | null;
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
  fc_bill: string | number | null;
  fc_bill_rate: number | null;
  ex_rate: number;
  EX_RATE: number;
  EXCHANGE_RATE: number;
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
  is_cost?: boolean | string | null;
  row_source?: string | null;
  sac_code?: string | null;
  tax_num?: string | null;
  lut_arn?: string | null;
  stamp_path?: string | null;
  crn?: string | null;
  [key: string]: any;
}

export interface FreightInvoiceMeta {
  invoiceNo?: string;
  invoiceDate?: string;
  invoicePeriod?: string;
  clientName?: string;
  clientAddress?: string;
  clientVatNo?: string;
  qrCodeDataUrl?: string;
  reportType?: string;
  exchangeRate?: string | number;
  bill_rate?: number | null;
  bill?: number | null;
  curr_code?: string | null;
  ex_rate?: number | null;
  stampDataUrl?: string;
  shipmentInfo?: any;
  divisionInfo?: any;
  companyInfo?: any;
  bankAccounts?: any[];
}

export function normalizeOracleFreightInvoiceRow(raw: Record<string, any> | null | undefined): FreightInvoiceRow {
  const out: Record<string, any> = {};
  if (!raw) return out as FreightInvoiceRow;
  for (const key of Object.keys(raw)) {
    out[key.toLowerCase()] = (raw as any)[key];
  }
  const ex = out.ex_rate ?? out.exchange_rate ?? raw.EX_RATE ?? raw.EXCHANGE_RATE;
  if (ex != null) {
    out.ex_rate = Number(ex) as any;
    out.EX_RATE = Number(ex) as any;
    out.EXCHANGE_RATE = Number(ex) as any;
  }
  return out as FreightInvoiceRow;
}

function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtMoney(amount: number | null | undefined, decimals = 2): string {
  if (amount === null || amount === undefined || isNaN(Number(amount))) return "0.00";
  return Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtDate(d: string | Date | null | undefined, format: 'slash' | 'dash-short' = 'slash'): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return String(d);
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear();
  if (format === 'dash-short') {
    const yy = String(yyyy).slice(-2);
    return `${dd}-${mm}-${yy}`;
  }
  return `${dd}/${mm}/${yyyy}`;
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

function integerToWords(num: number): string {
  if (num === 0) return "Zero";
  if (num < 0) return `Minus ${integerToWords(Math.abs(num))}`;
  let words = "";
  if (Math.floor(num / 1000000000) > 0) {
    words += `${integerToWords(Math.floor(num / 1000000000))} Billion `;
    num %= 1000000000;
  }
  if (Math.floor(num / 1000000) > 0) {
    words += `${integerToWords(Math.floor(num / 1000000))} Million `;
    num %= 1000000;
  }
  if (Math.floor(num / 1000) > 0) {
    words += `${integerToWords(Math.floor(num / 1000))} Thousand `;
    num %= 1000;
  }
  if (Math.floor(num / 100) > 0) {
    words += `${integerToWords(Math.floor(num / 100))} Hundred `;
    num %= 100;
  }
  if (num > 0) {
    if (words.length > 0) {
      words += "and ";
    }
    if (num < 20) {
      words += ONES[num];
    } else {
      words += TENS[Math.floor(num / 10)];
      if (num % 10 > 0) words += ` ${ONES[num % 10]}`;
    }
  }
  return words.trim();
}

function amountInWords(amount: number, currCode: string | null | undefined, decimals = 2): string {
  const code = (currCode || "USD").toUpperCase();
  const majorNames: Record<string, string> = {
    USD: "US Dollars", INR: "Indian Rupees", OMR: "Omani rial",
    SAR: "Saudi Riyals", AED: "UAE Dirhams", EUR: "Euros", GBP: "Pounds Sterling",
  };
  const minorNames: Record<string, string> = {
    USD: "Cents", INR: "Paise", OMR: "Baisa", SAR: "Halalas",
    AED: "Fils", EUR: "Cents", GBP: "Pence",
  };

  const major = majorNames[code] || `${code}`;
  const minor = minorNames[code] || "Cents";

  const whole = Math.floor(amount);
  const fracMultiplier = decimals === 3 ? 1000 : 100;
  const fraction = Math.round((amount - whole) * fracMultiplier);

  const wholeWords = integerToWords(whole);
  const fracWords = fraction > 0 ? ` and ${minor} ${integerToWords(fraction)}` : "";
  return `${major} - ${wholeWords}${fracWords} only`.replace(/\s+/g, " ");
}

function isCostRow(r: FreightInvoiceRow): boolean {
  if (r.is_cost === true || r.is_cost === "Y" || r.is_cost === "y" || r.is_cost === "1") return true;
  if (typeof r.is_cost === "string" && r.is_cost.toLowerCase().includes("cost")) return true;
  const source = (r.row_source || "").toLowerCase();
  if (source === "cost" || source.includes("_cost") || source.endsWith("cost") || source.includes("cost_")) return true;
  const text = [r.act_group_name, r.activity_group_code, r.inv_desc, r.other_services, r.remarks]
    .filter(Boolean).join(" ").toLowerCase();
  return /\bcost\b|_cost|cost_/.test(text);
}

export function buildFreightInvoiceHtmlAMKSA(rows: FreightInvoiceRow[], meta: FreightInvoiceMeta = {}): string {
  return buildFreightInvoiceHtmlMHDL(rows, meta);
}

export function buildFreightInvoiceHtmlMHDL(rows: FreightInvoiceRow[], meta: FreightInvoiceMeta = {}): string {
  if (!rows || rows.length === 0) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>No Data</title><style>body{font-family:Arial,sans-serif;padding:50px;text-align:center;color:#64748b;background:#f8fafc;}</style></head><body><h2>No Freight Invoice Data Found</h2><p>Please check the invoice number or principal code and try again.</p><button onclick="window.close()" style="margin-top:16px;padding:8px 18px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;cursor:pointer;">Close</button></body></html>`;
  }

  const first = rows[0];
  const shipment = meta.shipmentInfo || {};
  const divisionInfo = meta.divisionInfo || {};
  const companyInfo = meta.companyInfo || {};

  const getProp = (obj: any, key: string) => {
    if (!obj) return undefined;
    return obj[key.toLowerCase()] ?? obj[key.toUpperCase()] ?? obj[key];
  };

  const divisionName = (getProp(divisionInfo, "div_name") || first.div_name || "").trim();
  const divisionShortName = (getProp(divisionInfo, "div_short_name") || first.div_short_name || "MHDL LLC").trim();
  const companyName = (getProp(companyInfo, "company_name") || first.company_name || "MHD LOGISTICS").trim();
  const displayName = divisionName || companyName;
  const displayShortName = divisionShortName || getProp(companyInfo, "company_short_name") || "MHDL LLC";

  const currCode = (first.curr_code || meta.curr_code || "OMR").toString().toUpperCase();
  const decimals = currCode === "OMR" ? 3 : 2;

  const rawInvNo = meta.invoiceNo || first.invno_prefixed || first.invoice_no || "";
  const invoiceNo = rawInvNo;
  const invoiceDate = fmtDate(first.invoice_date || meta.invoiceDate || first.user_dt);
  const dueDate = fmtDate(first.due_date || first.invoice_date || meta.invoiceDate);
  const supplyPeriod = first.from_date && first.to_date
    ? `${fmtDate(first.from_date)} - ${fmtDate(first.to_date)}`
    : (meta.invoicePeriod || `${invoiceDate} - ${invoiceDate}`);
  const dateOfSupply = fmtDate(first.from_date || first.invoice_date);
  const customerRep = first.customer_rep || first.salesman || "";
  const jobNo = first.job_no || getProp(shipment, "job_no") || "";
  const poNo = getProp(shipment, "po_no") || first.po_no || first.prin_ref1 || "";
  const companyTaxRegNo = getProp(divisionInfo, "div_trn_no") || getProp(divisionInfo, "trn_no") || getProp(companyInfo, "comp_trn_no") || getProp(companyInfo, "trn_no") || first.comp_trn_no || first.trn_no || "OM1100427996";

  const billToName = meta.clientName || first.client_name || first.party_name || first.prin_code || "";
  const billToAddressLines = [
    first.prin_addr1,
    first.prin_addr2,
    first.prin_addr3,
    first.prin_addr4,
    first.prin_city,
  ].filter(Boolean) as string[];

  const clientEmail = first.prin_email1 || "";
  const clientTel = first.prin_telno1 || "";
  const clientFax = first.prin_faxno1 || "";
  const clientTaxRegNo = first.prin_trn_no || meta.clientVatNo || "";
  const remarks = first.onl_remrks || first.remarks || "";

  // Shipment / Job Mode Header
  const rawMode = String(getProp(shipment, "transport_mode") || first.transport_mode || "S").toUpperCase();
  const rawJobType = String(getProp(shipment, "job_type") || first.job_type || "IMP").toUpperCase();
  const modeText = rawMode === "A" ? "AIR" : rawMode === "R" ? "ROAD" : "SEA";
  const typeText = rawJobType === "EXP" ? "EXPORT" : "IMPORT";
  const shipmentHeader = `${modeText} ${typeText}`;

  const origin = (getProp(shipment, "place_receipt") || first.country_origin || "").toUpperCase();
  const destination = getProp(shipment, "place_delivery") || first.country_destination || "";
  const noOfPackings = getProp(shipment, "no_of_packings") != null ? String(getProp(shipment, "no_of_packings")) : "";
  const blNo = getProp(shipment, "bl_no") || getProp(shipment, "doc_ref") || "";
  const hblNo = getProp(shipment, "hawb") || "";
  const netWt = getProp(shipment, "net_wt") != null ? fmtMoney(getProp(shipment, "net_wt"), 2) : "0.00";
  const grossWt = getProp(shipment, "gross_wt") != null ? fmtMoney(getProp(shipment, "gross_wt"), 2) : "";
  const volume = getProp(shipment, "volume") != null ? fmtMoney(getProp(shipment, "volume"), 2) : "";
  const containers = getProp(shipment, "container_no") || "";
  const prodDetails = getProp(shipment, "prod_description") || getProp(shipment, "description1") || "";
  const shipmentDate = fmtDate(getProp(shipment, "confirm_date") || getProp(shipment, "bl_date") || getProp(shipment, "issue_date") || first.invoice_date, 'dash-short');

  // Line items
  const billableRows = rows.filter((r) => !isCostRow(r) && r.bill != null && Number(r.bill) !== 0);
  let totalExclTax = 0;
  let totalTax = 0;

  const itemRowsHtml = billableRows.map((r, idx) => {
    const desc = (r as any).activity?.trim() || r.other_services || r.inv_desc || r.act_group_name || "Service";
    const qty = r.quantity || 1;
    const amountExcl = Number(r.bill || 0);
    const rate = Number(r.bill_rate || (amountExcl / Number(qty || 1)));
    const taxAmt = Number(r.tx_compnt_amt_1 || 0);
    const amountIncl = amountExcl + taxAmt;

    totalExclTax += amountExcl;
    totalTax += taxAmt;

    const vatPercNum = Number(r.tx_compnt_perc_1 || 0);
    let vatLabel = "NT";
    if (vatPercNum > 0) {
      vatLabel = `${vatPercNum} %`;
    } else if (String(r.tx_compnt_1_expamt || "").toUpperCase() === "ZERO" || (vatPercNum === 0 && taxAmt === 0 && String(desc).toUpperCase().includes("PORT"))) {
      vatLabel = "Zero";
    }

    return `
      <tr class="item-data-row">
        <td class="col-sno">${idx + 1}</td>
        <td class="col-service">${esc(desc)}</td>
        <td class="col-qty">${qty}</td>
        <td class="col-rate">${fmtMoney(rate, decimals)}</td>
        <td class="col-amt-excl">${fmtMoney(amountExcl, decimals)}</td>
        <td class="col-vat">${vatLabel}</td>
        <td class="col-tax-amt">${fmtMoney(taxAmt, decimals)}</td>
        <td class="col-amt-incl">${fmtMoney(amountIncl, decimals)}</td>
      </tr>`;
  }).join("");

  const totalInclTax = totalExclTax + totalTax;

  // Fill up table to at least 10 rows for standard full-height appearance
  const targetRowCount = 10;
  const fillerCount = Math.max(0, targetRowCount - billableRows.length);
  const fillerRows = Array.from({ length: fillerCount })
    .map(() => `<tr class="filler-data-row">
      <td class="col-sno">&nbsp;</td>
      <td class="col-service">&nbsp;</td>
      <td class="col-qty">&nbsp;</td>
      <td class="col-rate">&nbsp;</td>
      <td class="col-amt-excl">&nbsp;</td>
      <td class="col-vat">&nbsp;</td>
      <td class="col-tax-amt">&nbsp;</td>
      <td class="col-amt-incl">&nbsp;</td>
    </tr>`)
    .join("");

  // Bank accounts
  let rawBeneficiary = getProp(divisionInfo, "bank_name_inv") || first.bank_name_inv || "";
  if (!rawBeneficiary && displayName) {
    rawBeneficiary = `Beneficiary Name: ${displayName}`;
  }

  const bank1Name = getProp(divisionInfo, "bank_address_inv") || getProp(companyInfo, "bank_name") || first.bank_address_inv || "Bank Muscat";
  let bank1AcNo = getProp(divisionInfo, "ac_code_inv") || getProp(companyInfo, "ac_code") || first.ac_code_inv || "";
  if (bank1AcNo && !bank1AcNo.toLowerCase().includes("a/c")) {
    bank1AcNo = `A/C No.: ${bank1AcNo} (${currCode})`;
  }
  let bank1Iban = getProp(divisionInfo, "reference_no_inv") || getProp(companyInfo, "reference_no") || first.reference_no_inv || "";
  if (bank1Iban && !bank1Iban.toLowerCase().includes("iban")) {
    bank1Iban = `IBAN No : ${bank1Iban}`;
  }
  let bank1Swift = getProp(divisionInfo, "swift_code_inv") || getProp(companyInfo, "swift_code") || first.swift_code_inv || "";
  if (bank1Swift && !bank1Swift.toLowerCase().includes("swift")) {
    bank1Swift = `SWIFT Code: ${bank1Swift}`;
  }

  // Secondary Bank account (USD)
  let bank2AcNo = getProp(divisionInfo, "ac_code_inv_usd") || "A/C No.: 0423042602910033 (USD)";
  if (bank2AcNo && !bank2AcNo.toLowerCase().includes("a/c")) {
    bank2AcNo = `A/C No.: ${bank2AcNo} (USD)`;
  }
  let bank2Iban = getProp(divisionInfo, "ref_no_inv_usd") || "IBAN No : OM080270423042602910033";
  if (bank2Iban && !bank2Iban.toLowerCase().includes("iban")) {
    bank2Iban = `IBAN No : ${bank2Iban}`;
  }
  let bank2Swift = getProp(divisionInfo, "swift_code_inv_usd") || "SWIFT Code: BMUSOMRXXXX";
  if (bank2Swift && !bank2Swift.toLowerCase().includes("swift")) {
    bank2Swift = `SWIFT Code: ${bank2Swift}`;
  }

  // Footer address & contacts
  const fullAddress = "MHD Logistics LLC,P.O.Box 112, Postal Code 111, ,Wadi Kabir ,,Muscat,Oman";
  const tel = getProp(divisionInfo, "phone") || getProp(companyInfo, "contact_number") || getProp(companyInfo, "tel_no") || first.phone || "+968 71557267";
  const fax = getProp(divisionInfo, "fax") || getProp(companyInfo, "fax_no") || first.fax || "";
  const email = getProp(divisionInfo, "email") || getProp(companyInfo, "email") || first.email || "info@mhdlogistics.com";

  // Payment terms
  const creditDays = first.creditdays || getProp(shipment, "creditdays") || 30;

  const logoUrl = getProp(companyInfo, "company_logo") || getProp(divisionInfo, "comp_logo") || "https://objectstorage.me-dubai-1.oraclecloud.com/n/axpnrpp1t5qs/b/app-dev-bucket-test/o/JASRALOGO%2FMHDLLOGO.png";

  const safePdfFileName = ("TAX_INVOICE_" + (invoiceNo || "FF_INVOICE")).replace(/[^a-zA-Z0-9_-]/g, "_") + ".pdf";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TAX INVOICE - ${esc(invoiceNo)}</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
  <style>
    @page {
      size: A4 portrait;
      margin: 8mm 10mm 8mm 10mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    html, body {
      margin: 0;
      padding: 0;
      background-color: #f1f5f9;
      color: #000000;
      font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
      font-size: 10.5px;
      line-height: 1.3;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    /* TOP ACTION TOOLBAR */
    .invoice-toolbar {
      position: sticky;
      top: 0;
      left: 0;
      right: 0;
      z-index: 1000;
      background: #0f172a;
      color: #ffffff;
      padding: 10px 24px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #1e293b;
    }
    .toolbar-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .toolbar-badge {
      background: #2563eb;
      color: #ffffff;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 4px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .toolbar-inv-no {
      font-size: 14px;
      font-weight: 700;
      color: #f8fafc;
      letter-spacing: 0.5px;
    }
    .toolbar-client {
      font-size: 12px;
      color: #94a3b8;
      max-width: 320px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .btn-action {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-size: 12.5px;
      font-weight: 600;
      padding: 7px 15px;
      border-radius: 6px;
      cursor: pointer;
      border: none;
      transition: all 0.15s ease;
      text-decoration: none;
    }
    .btn-download-pdf {
      background: #2563eb;
      color: #ffffff;
      box-shadow: 0 2px 6px rgba(37, 99, 235, 0.35);
    }
    .btn-download-pdf:hover {
      background: #1d4ed8;
      box-shadow: 0 3px 8px rgba(37, 99, 235, 0.5);
    }
    .btn-print {
      background: #334155;
      color: #ffffff;
      border: 1px solid #475569;
    }
    .btn-print:hover {
      background: #475569;
    }
    .btn-close {
      background: transparent;
      color: #94a3b8;
      border: 1px solid #334155;
    }
    .btn-close:hover {
      color: #ffffff;
      border-color: #64748b;
      background: rgba(255, 255, 255, 0.05);
    }

    /* INVOICE PAPER VIEWPORT */
    .invoice-viewport {
      padding: 24px 16px 48px 16px;
      display: flex;
      justify-content: center;
    }
    .invoice-card {
      width: 210mm;
      max-width: 820px;
      min-height: 297mm;
      background: #ffffff;
      padding: 12mm 15mm 10mm 15mm;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.06);
      box-sizing: border-box;
      position: relative;
      border-radius: 2px;
    }

    /* PRINT SPECIFIC STYLES */
    @media print {
      body, html {
        background: #ffffff !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .invoice-toolbar, .no-print {
        display: none !important;
      }
      .invoice-viewport {
        padding: 0 !important;
        display: block !important;
      }
      .invoice-card {
        width: 100% !important;
        max-width: 100% !important;
        min-height: auto !important;
        box-shadow: none !important;
        padding: 0 !important;
        margin: 0 !important;
        border-radius: 0 !important;
      }
    }

    /* MASTHEAD */
    .top-masthead {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 2px;
    }
    .top-logo-block {
      flex: 0 0 240px;
    }
    .logo-img {
      height: 48px;
      max-width: 220px;
      object-fit: contain;
      display: block;
    }
    .logo-sub {
      font-size: 11px;
      font-weight: 700;
      color: #475569;
      margin-top: 3px;
      padding-left: 2px;
    }
    .title-centered {
      flex: 1;
      text-align: center;
      padding-top: 8px;
    }
    .title-centered h1 {
      margin: 0;
      font-size: 19px;
      font-weight: 900;
      letter-spacing: 3px;
      color: #000000;
    }
    .masthead-spacer {
      flex: 0 0 240px;
    }

    /* CLIENT & METADATA SECTION */
    .header-details-row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      margin-top: 6px;
      margin-bottom: 4px;
    }
    .client-col {
      width: 48%;
    }
    .to-label {
      font-weight: 700;
      font-size: 11px;
      display: inline-block;
      margin-right: 8px;
    }
    .underlined-field {
      border-bottom: 1px solid #000000;
      min-height: 17px;
      line-height: 17px;
      font-size: 10.5px;
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #000000;
    }
    .client-name-bold {
      font-weight: 700;
      font-size: 11px;
      display: inline-block;
      vertical-align: bottom;
      width: calc(100% - 28px);
    }
    .meta-col {
      width: 50%;
    }
    .meta-table {
      width: 100%;
      border-collapse: collapse;
      border-top: 2px solid #000000;
    }
    .meta-table td {
      padding: 1px 0;
      font-size: 10.5px;
      vertical-align: top;
    }
    .meta-lbl {
      width: 115px;
      font-weight: 700;
      white-space: nowrap;
      color: #000000;
    }
    .meta-col-sep {
      width: 12px;
      text-align: center;
      font-weight: 700;
      color: #000000;
    }
    .meta-val-cell {
      border-bottom: 1px solid #000000;
      font-weight: 700;
      padding-left: 5px;
      color: #000000;
    }
    .page-indicator {
      text-align: right;
      font-size: 9.5px;
      padding-top: 3px;
      color: #000000;
    }

    /* SHIPMENT DETAILS BOX */
    .shipment-container {
      border: 1.5px solid #000000;
      margin-top: 5px;
      margin-bottom: 0;
    }
    .shipment-banner {
      font-weight: 800;
      font-size: 10.5px;
      padding: 2.5px 6px;
      border-bottom: 1.5px solid #000000;
      background: #ffffff;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .shipment-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
    }
    .shipment-table td {
      border-right: 1px solid #000000;
      border-bottom: 1px solid #000000;
      padding: 2.5px 6px;
      vertical-align: top;
      color: #000000;
    }
    .shipment-table td:last-child {
      border-right: none;
    }
    .shipment-table tr:last-child td {
      border-bottom: none;
    }

    /* SERVICES GRID TABLE */
    .grid-table {
      width: 100%;
      border-collapse: collapse;
      border: 1.5px solid #000000;
      border-top: none;
      margin-top: 0;
      margin-bottom: 0;
      table-layout: fixed;
    }
    .grid-table th {
      border: 1px solid #000000;
      font-weight: 700;
      font-size: 10.5px;
      padding: 3.5px 4px;
      background: #ffffff;
      text-align: center;
      line-height: 1.2;
      color: #000000;
    }
    .grid-table td {
      border: 1px solid #000000;
      font-size: 10px;
      padding: 2.5px 5px;
      vertical-align: middle;
      color: #000000;
    }
    .col-sno { text-align: center; }
    .col-service { text-align: left; text-transform: uppercase; }
    .col-qty { text-align: center; font-weight: 700; }
    .col-rate { text-align: right; }
    .col-amt-excl { text-align: right; font-weight: 700; }
    .col-vat { text-align: center; }
    .col-tax-amt { text-align: right; }
    .col-amt-incl { text-align: right; font-weight: 700; }

    .filler-data-row td {
      height: 20px;
      border: 1px solid #000000;
    }

    /* TOTALS ROW */
    .totals-row td {
      border: 1px solid #000000;
      border-top: 1.5px solid #000000;
      padding: 4px 5px;
      vertical-align: bottom;
      font-weight: 700;
    }
    .totals-words-cell {
      vertical-align: top !important;
      text-align: left;
    }
    .tax-notes-txt {
      font-size: 9.5px;
      font-weight: 700;
      margin-bottom: 3px;
    }
    .words-amt-txt {
      font-size: 10px;
      font-weight: 700;
      line-height: 1.35;
      text-transform: uppercase;
    }

    /* TERMS & CONDITIONS */
    .terms-section {
      margin-top: 6px;
      font-size: 10px;
      line-height: 1.35;
      color: #000000;
    }
    .terms-highlight {
      text-decoration: underline;
      font-weight: 700;
    }

    /* BANK DETAILS & SIGNATURE */
    .bank-and-sig {
      display: flex;
      justify-content: space-between;
      margin-top: 6px;
      font-size: 9.5px;
      line-height: 1.4;
      color: #000000;
    }
    .bank-col {
      width: 44%;
    }
    .bank-title-bold {
      font-weight: 700;
      margin-bottom: 1px;
    }
    .signature-area {
      width: 32%;
      text-align: right;
      padding-top: 36px;
      font-weight: 700;
      font-size: 11px;
      color: #000000;
    }

    /* FOOTER BOX */
    .outer-footer-box {
      border: 1.5px solid #000000;
      margin-top: 8px;
      padding: 4px 6px;
      text-align: center;
      font-size: 9.5px;
      line-height: 1.35;
      color: #000000;
    }
    .footer-bold {
      font-weight: 700;
    }
  </style>
</head>
<body>

<!-- TOP ACTION TOOLBAR -->
<div class="invoice-toolbar no-print">
  <div class="toolbar-left">
    <span class="toolbar-badge">TAX INVOICE</span>
    <span class="toolbar-inv-no">${esc(invoiceNo)}</span>
    <span class="toolbar-client">${esc(billToName)}</span>
  </div>
  <div class="toolbar-actions">
    <button id="btn-dl-pdf" onclick="downloadAsPdf()" class="btn-action btn-download-pdf" title="Directly Download PDF">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      <span>Download PDF</span>
    </button>
    <button onclick="window.print()" class="btn-action btn-print" title="Open Print Dialog">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
      <span>Print Invoice</span>
    </button>
    <button onclick="window.close()" class="btn-action btn-close" title="Close Preview">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      <span>Close</span>
    </button>
  </div>
</div>

<!-- INVOICE VIEWPORT -->
<div class="invoice-viewport">
  <div class="invoice-card" id="invoice-to-print">

    <!-- TOP MASTHEAD -->
    <div class="top-masthead">
      <div class="top-logo-block">
        <img class="logo-img" src="${esc(logoUrl)}" alt="${esc(displayName)}" />
        <div class="logo-sub">${esc(displayShortName)}</div>
      </div>
      <div class="title-centered">
        <h1>TAX INVOICE</h1>
      </div>
      <div class="masthead-spacer">&nbsp;</div>
    </div>

    <!-- CLIENT & METADATA -->
    <div class="header-details-row">
      <!-- LEFT: CLIENT BOX -->
      <div class="client-col">
        <div class="underlined-field">
          <span class="to-label">To</span>
          <span class="client-name-bold">${esc(billToName)}</span>
        </div>
        ${billToAddressLines.map((line) => `<div class="underlined-field">${esc(line)}</div>`).join("")}
        ${Array.from({ length: Math.max(0, 3 - billToAddressLines.length) }).map(() => `<div class="underlined-field">&nbsp;</div>`).join("")}
        <div class="underlined-field">
          Ph. ${esc(clientTel)} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Fax. ${esc(clientFax)}
        </div>
        <div class="underlined-field">e-Mail : ${esc(clientEmail)}</div>
        <div class="underlined-field">Tax Reg No. : ${esc(clientTaxRegNo)}</div>
        <div class="underlined-field">Remarks : ${esc(remarks)}</div>
      </div>

      <!-- RIGHT: METADATA TABLE -->
      <div class="meta-col">
        <table class="meta-table">
          <tr>
            <td class="meta-lbl">Invoice No.</td>
            <td class="meta-col-sep">:</td>
            <td class="meta-val-cell">${esc(invoiceNo)}</td>
          </tr>
          <tr>
            <td class="meta-lbl">Invoice Date</td>
            <td class="meta-col-sep">:</td>
            <td class="meta-val-cell">${invoiceDate}</td>
          </tr>
          <tr>
            <td class="meta-lbl">Due Date</td>
            <td class="meta-col-sep">:</td>
            <td class="meta-val-cell">${dueDate}</td>
          </tr>
          <tr>
            <td class="meta-lbl">Supply From / To</td>
            <td class="meta-col-sep">:</td>
            <td class="meta-val-cell">${supplyPeriod}</td>
          </tr>
          <tr>
            <td class="meta-lbl">Customer Rep</td>
            <td class="meta-col-sep">:</td>
            <td class="meta-val-cell">${esc(customerRep)}</td>
          </tr>
          <tr>
            <td class="meta-lbl">Currency</td>
            <td class="meta-col-sep">:</td>
            <td class="meta-val-cell">${esc(currCode)}</td>
          </tr>
          <tr>
            <td class="meta-lbl">Job No</td>
            <td class="meta-col-sep">:</td>
            <td class="meta-val-cell">${esc(jobNo)}</td>
          </tr>
          <tr>
            <td class="meta-lbl">PO No</td>
            <td class="meta-col-sep">:</td>
            <td class="meta-val-cell">${esc(poNo)}</td>
          </tr>
          <tr>
            <td class="meta-lbl">Tax Reg No.</td>
            <td class="meta-col-sep">:</td>
            <td class="meta-val-cell">${esc(companyTaxRegNo)}</td>
          </tr>
          <tr>
            <td class="meta-lbl">Date Of Supply</td>
            <td class="meta-col-sep">:</td>
            <td class="meta-val-cell">${dateOfSupply}</td>
          </tr>
        </table>
        <div class="page-indicator">Page 1 of 1</div>
      </div>
    </div>

    <!-- SHIPMENT DETAILS BOX -->
    <div class="shipment-container">
      <div class="shipment-banner">${shipmentHeader}</div>
      <table class="shipment-table">
        <tr>
          <td style="width: 32%;"><strong>Origin :</strong> ${esc(origin)}</td>
          <td style="width: 28%;"><strong>No Of Packings:</strong> &nbsp;${esc(noOfPackings)}</td>
          <td style="width: 22%;"><strong>Net Wt:</strong> &nbsp;${netWt}</td>
          <td style="width: 18%;"><strong>Date :</strong> &nbsp;${shipmentDate}</td>
        </tr>
        <tr>
          <td><strong>Destination :</strong> ${esc(destination)}</td>
          <td><strong>BL No:</strong> &nbsp;${esc(blNo)}</td>
          <td><strong>Gross Wt:</strong> &nbsp;${grossWt}</td>
          <td><strong>Volume:</strong> &nbsp;${volume}</td>
        </tr>
        <tr>
          <td><strong>Product Details :</strong> ${esc(prodDetails)}</td>
          <td><strong>Containers:</strong> &nbsp;${esc(containers)}</td>
          <td colspan="2"><strong>HBL No:</strong> &nbsp;${esc(hblNo)}</td>
        </tr>
        <tr>
          <td colspan="4"><strong>Remarks:</strong> &nbsp;${esc(remarks)}</td>
        </tr>
      </table>
    </div>

    <!-- LINE ITEMS GRID WITH INTEGRATED TOTALS ROW (100% SEAMLESS VERTICAL BORDERS) -->
    <table class="grid-table">
      <colgroup>
        <col style="width: 5%;" />
        <col style="width: 41%;" />
        <col style="width: 8%;" />
        <col style="width: 10%;" />
        <col style="width: 13%;" />
        <col style="width: 6%;" />
        <col style="width: 8%;" />
        <col style="width: 9%;" />
      </colgroup>
      <thead>
        <tr>
          <th>S.No.</th>
          <th style="text-align: left; padding-left: 6px;">Services</th>
          <th>Quantity</th>
          <th>Rate</th>
          <th>Amount (Excl.<br/>Tax)</th>
          <th>VAT<br/>%</th>
          <th>Amount<br/>Tax</th>
          <th>Amount<br/>(Incl. Tax)</th>
        </tr>
      </thead>
      <tbody>
        ${itemRowsHtml}
        ${fillerRows}
      </tbody>
      <tfoot>
        <tr class="totals-row">
          <td colspan="3" class="totals-words-cell">
            <div class="tax-notes-txt">NT - No Tax, 0% - Zero, 5% - Standard</div>
            <div class="words-amt-txt">${esc(amountInWords(totalInclTax, currCode, decimals))}</div>
          </td>
          <td style="text-align: right;">Total :</td>
          <td style="text-align: right;">${fmtMoney(totalExclTax, decimals)}</td>
          <td>&nbsp;</td>
          <td style="text-align: right;">${fmtMoney(totalTax, decimals)}</td>
          <td style="text-align: right;">${fmtMoney(totalInclTax, decimals)}</td>
        </tr>
      </tfoot>
    </table>

    <!-- TERMS & CONDITIONS -->
    <div class="terms-section">
      <div><span class="terms-highlight">Payment Terms:</span> Payment due within ${creditDays} days from the Date of Invoice.</div>
      <div>Invoice deemed correct if no query reaches ${esc(displayName)} within 7 days of the Invoice date.</div>
    </div>

    <!-- BANK DETAILS & SIGNATURE -->
    <div class="bank-and-sig">
      <div class="bank-col">
        <div class="bank-title-bold">${esc(rawBeneficiary)}</div>
        <div class="bank-title-bold">${esc(bank1Name)}</div>
        <div>${esc(bank1AcNo)}</div>
        <div>${esc(bank1Iban)}</div>
        <div>${esc(bank1Swift)}</div>
      </div>

      <div class="bank-col" style="padding-top: 13px;">
        <div>${esc(bank2AcNo)}</div>
        <div>${esc(bank2Iban)}</div>
        <div>${esc(bank2Swift)}</div>
      </div>

      <div class="signature-area">
        ${esc(displayName)}
      </div>
    </div>

    <!-- FOOTER BOX -->
    <div class="outer-footer-box">
      <div class="footer-bold">${esc(fullAddress)}</div>
      <div class="footer-bold">Tel: ${esc(tel)} ; Fax: ${esc(fax)} ; e-Mail: ${esc(email)}</div>
      <div>Any Business, Services provided is subject to ${esc(displayName)}'s NAFL Standard Trading Conditions , copy of which can be provided on request.</div>
    </div>

  </div>
</div>

<script>
  function downloadAsPdf() {
    var element = document.getElementById('invoice-to-print');
    var filename = '${safePdfFileName}';
    var btn = document.getElementById('btn-dl-pdf');
    if (window.html2pdf && element) {
      var origHtml = btn ? btn.innerHTML : '';
      if (btn) {
        btn.innerHTML = '<span>⏳ Generating PDF...</span>';
        btn.disabled = true;
      }
      var opt = {
        margin:       [8, 10, 8, 10],
        filename:     filename,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, logging: false },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      html2pdf().set(opt).from(element).save().then(function() {
        if (btn) { btn.innerHTML = origHtml; btn.disabled = false; }
      }).catch(function(err) {
        console.warn('html2pdf fallback to browser print:', err);
        if (btn) { btn.innerHTML = origHtml; btn.disabled = false; }
        document.title = filename;
        window.print();
      });
    } else {
      document.title = filename;
      window.print();
    }
  }
</script>

</body>
</html>`;
}

export function buildFreightInvoiceHtmlBTIND(rows: FreightInvoiceRow[], meta: FreightInvoiceMeta = {}): string {
  return buildFreightInvoiceHtmlMHDL(rows, meta);
}
