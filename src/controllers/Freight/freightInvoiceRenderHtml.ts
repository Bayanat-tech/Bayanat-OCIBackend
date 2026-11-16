// freightInvoiceRenderHtml.ts - Dedicated HTML invoice template generator for Freight Module
// Redesigned to match the professional Tax Purchase Invoice layout (modern card headers, soft blue tables, dual signatures, running footer)
// Optimized for strict 1-page A4 print fit with support for up to 8-10 activities without page overflow

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
  currencyMasterInfo?: any;
  user_id?: string;
  userName?: string;
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

function fmtDate(d: string | Date | null | undefined, format: 'slash' | 'dash-short' | 'formatted' = 'slash'): string {
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
  if (format === 'formatted') {
    return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }
  return `${dd}/${mm}/${yyyy}`;
}

function printDateTimeNow(): string {
  return new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

function amountInWords(
  amount: number,
  currCode: string | null | undefined,
  decimals = 3,
  customCurrName?: string | null,
  customDivision?: string | null
): string {
  const code = (currCode || "OMR").toUpperCase();
  const major = (code === "USD" ? "United States Dollar" : (customCurrName || (code === "OMR" ? "Omani Rial" : code))).trim();
  const minor = (customDivision || (code === "OMR" ? "Baisa" : "Cents")).trim();

  const whole = Math.floor(amount);
  const fracMultiplier = decimals === 3 ? 1000 : 100;
  const fraction = Math.round((amount - whole) * fracMultiplier);

  const wholeWords = integerToWords(whole);
  const fracWords = fraction > 0 ? ` and ${minor} ${integerToWords(fraction)}` : "";
  return `${major} - ${wholeWords}${fracWords} Only`.replace(/\s+/g, " ");
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
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>No Data</title><style>body{font-family:'Inter',Arial,sans-serif;padding:50px;text-align:center;color:#64748b;background:#f8fafc;}</style></head><body><h2>No Freight Invoice Data Found</h2><p>Please check the invoice number or principal code and try again.</p><button onclick="window.close()" style="margin-top:16px;padding:8px 18px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;cursor:pointer;">Close</button></body></html>`;
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
  const companyName = (getProp(companyInfo, "company_name") || first.company_name || "MHD LOGISTICS").trim();
  const displayName = companyName || divisionName || "MHD LOGISTICS";

  const currCode = (first.curr_code || meta.curr_code || "OMR").toString().toUpperCase();
  const rawEx = Number(first.ex_rate ?? (first as any).EX_RATE ?? meta.ex_rate ?? 0);
  const isForeign = currCode !== "OMR";
  const exRate = (isForeign && rawEx > 0) ? rawEx : 1;
  const decimals = 3;

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
  const candidateRemarks = [
    first.onl_remrks,
    first.remarks,
    getProp(shipment, "pack_remarks"),
    getProp(shipment, "job_remarks"),
    getProp(shipment, "remarks"),
  ];
  const distinctRemarks = candidateRemarks
    .map((s) => (s == null ? "" : String(s).trim()))
    .filter((s, idx, arr) => s.length > 0 && arr.indexOf(s) === idx);
  const remarks = distinctRemarks.join("\n");

  // Shipment Mode Header
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

  const rawContainers = String(getProp(shipment, "container_no") || "").replace(/\bnull\b/gi, "").trim();
  const containers = esc(rawContainers).replace(/\r\n|\r|\n/g, "<br/>");

  const rawProd = String(getProp(shipment, "prod_description") || getProp(shipment, "description1") || "").trim();
  const prodDetails = esc(rawProd).replace(/\r\n|\r|\n/g, "<br/>");

  const shipmentDate = fmtDate(getProp(shipment, "confirm_date") || getProp(shipment, "bl_date") || getProp(shipment, "issue_date") || first.invoice_date, 'dash-short');

  // Line items
  const billableRows = rows.filter((r) => !isCostRow(r) && r.bill != null);
  let totalExclTax = 0;
  let totalTax = 0;

  const itemRowsHtml = billableRows.map((r, idx) => {
    const desc = (r as any).activity?.trim() || r.other_services || r.inv_desc || r.act_group_name || "Service";
    const qty = Number(r.quantity || 1) || 1;
    const baseAmount = Number(r.bill || 0);
    const amountExcl = isForeign ? (baseAmount / exRate) : baseAmount;
    const rate = amountExcl / qty;
    const baseTax = Number(r.tx_compnt_amt_1 || 0);
    const taxAmt = isForeign ? (baseTax / exRate) : baseTax;
    const amountIncl = amountExcl + taxAmt;

    totalExclTax += amountExcl;
    totalTax += taxAmt;

    const expmt = String((r as any).tx_compnt_1_expamt || (r as any).tx_compnt_1_expmt || (r as any).TX_COMPNT_1_EXPAMT || (r as any).TX_COMPNT_1_EXPMT || "").toUpperCase().trim();
    const vatPercNum = Number(r.tx_compnt_perc_1 || (r as any).TX_COMPNT_PERC_1 || 0);
    let vatLabel = "NT";
    if (expmt === "N") {
      vatLabel = "NT";
    } else if (expmt === "Z" || (vatPercNum === 0 && String(desc).toUpperCase().includes("PORT"))) {
      vatLabel = "0%";
    } else if (expmt === "S" || vatPercNum > 0) {
      vatLabel = `${vatPercNum > 0 ? vatPercNum : 5}%`;
    }

    return `
      <tr>
        <td class="center">${idx + 1}</td>
        <td class="desc">
          <strong>${esc(desc)}</strong>
          ${r.act_group_name && r.act_group_name !== desc ? `<span>${esc(r.act_group_name)}</span>` : ""}
        </td>
        <td class="center">${qty}</td>
        <td class="num">${fmtMoney(rate, decimals)}</td>
        <td class="num">${fmtMoney(amountExcl, decimals)}</td>
        <td class="center">${vatLabel}</td>
        <td class="num">${fmtMoney(taxAmt, decimals)}</td>
        <td class="num strong">${fmtMoney(amountIncl, decimals)}</td>
      </tr>`;
  }).join("");

  const totalInclTax = totalExclTax + totalTax;

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

  // Company Address Lines
  const fullAddressLine1 = "P.O.Box 112, Postal Code 111";
  const fullAddressLine2 = "Wadi Kabir, Muscat, Oman";
  const tel = getProp(divisionInfo, "phone") || getProp(companyInfo, "contact_number") || getProp(companyInfo, "tel_no") || first.phone || "+968 71557267";
  const fax = getProp(divisionInfo, "fax") || getProp(companyInfo, "fax_no") || first.fax || "";
  const email = getProp(divisionInfo, "email") || getProp(companyInfo, "email") || first.email || "info@mhdlogistics.com";

  // Payment terms
  const creditDays = first.creditdays || getProp(shipment, "creditdays") || 30;

  const logoUrl = getProp(companyInfo, "company_logo") || getProp(divisionInfo, "comp_logo") || "https://objectstorage.me-dubai-1.oraclecloud.com/n/axpnrpp1t5qs/b/app-dev-bucket-test/o/JASRALOGO%2FMHDLLOGO.png";
  const safePdfFileName = ("TAX_INVOICE_" + (invoiceNo || "FF_INVOICE")).replace(/[^a-zA-Z0-9_-]/g, "_") + ".pdf";
  const printUser = (first.user_id || meta.user_id || meta.userName || "MHDL_BTS").trim();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TAX INVOICE - ${esc(invoiceNo)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
  <style>
    @page {
      size: A4 portrait;
      margin: 4mm 6mm 4mm 6mm;
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
      color: #1e293b;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      font-size: 9px;
      line-height: 1.25;
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
      padding: 8px 20px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #1e293b;
    }
    .toolbar-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .toolbar-badge {
      background: #0b4ca1;
      color: #ffffff;
      font-size: 10px;
      font-weight: 700;
      padding: 2.5px 7px;
      border-radius: 4px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .toolbar-inv-no {
      font-size: 13px;
      font-weight: 700;
      color: #f8fafc;
      letter-spacing: 0.5px;
    }
    .toolbar-client {
      font-size: 11px;
      color: #94a3b8;
      max-width: 300px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn-action {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 5px;
      cursor: pointer;
      border: none;
      transition: all 0.15s ease;
      text-decoration: none;
    }
    .btn-download-pdf {
      background: #0b4ca1;
      color: #ffffff;
      box-shadow: 0 2px 6px rgba(11, 76, 161, 0.35);
    }
    .btn-download-pdf:hover {
      background: #093c80;
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
      background: rgba(255, 255, 255, 0.05);
    }

    /* INVOICE PAPER VIEWPORT */
    .invoice-viewport {
      padding: 14px 8px 30px 8px;
      display: flex;
      justify-content: center;
    }
    .doc-shell {
      width: 100%;
      max-width: 202mm;
      background: #ffffff;
      padding: 12px 14px 10px 14px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
      box-sizing: border-box;
      position: relative;
      border-radius: 3px;
      margin: 0 auto;
    }

    .doc-shell, .doc-shell * {
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    /* PRINT SPECIFIC STYLES */
    @media print {
      body, html {
        background: #ffffff !important;
        margin: 0 !important;
        padding: 0 !important;
        width: 100% !important;
      }
      .invoice-toolbar, .no-print {
        display: none !important;
      }
      .invoice-viewport {
        padding: 0 !important;
        margin: 0 !important;
        display: block !important;
      }
      .doc-shell {
        width: 100% !important;
        max-width: 100% !important;
        box-shadow: none !important;
        padding: 0 !important;
        margin: 0 !important;
        border-radius: 0 !important;
      }
      .box, .totals, .remarks, .terms-card, .bank-card, .sign {
        break-inside: avoid;
        page-break-inside: avoid;
      }
    }

    /* COMPANY MASTHEAD */
    .company-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
      box-sizing: border-box;
      padding: 0 0 5px 0;
      margin: 0 0 4px 0;
      border-bottom: 1.5px solid #cbd5e1;
    }
    .company-logo-wrap {
      flex: 0 0 auto;
      max-width: 180px;
      display: flex;
      align-items: center;
    }
    .company-logo {
      max-height: 46px;
      max-width: 180px;
      object-fit: contain;
      display: block;
    }
    .company-name-block {
      flex: 1 1 auto;
      text-align: right;
      min-width: 0;
    }
    .company-name {
      font-size: 17px;
      font-weight: 800;
      color: #0f172a;
      margin: 0 0 2px 0;
      line-height: 1.15;
      letter-spacing: -0.2px;
    }
    .company-address {
      font-size: 9px;
      color: #64748b;
      line-height: 1.35;
      margin: 0;
    }
    .company-address-line {
      display: block;
    }
    .company-trn-inline {
      font-weight: 700;
      color: #0f172a;
      margin-top: 1px;
    }

    /* DOCUMENT TITLE ROW */
    .doc-title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin: 0 0 4px 0;
    }
    .doc-heading {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 5px;
    }
    .doc-heading h1 {
      margin: 0;
      font-size: 12px;
      font-weight: 800;
      line-height: 1.2;
      color: #0f172a;
      text-transform: uppercase;
    }
    .doc-title-row .doc-sub {
      margin: 0;
      font-size: 13px;
      font-weight: 800;
      line-height: 1.2;
      color: #0b4ca1;
    }
    .doc-badge {
      flex-shrink: 0;
      padding: 2px 9px;
      border-radius: 4px;
      background: #e8f0fa;
      border: 1px solid #b8d0ea;
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      color: #0b4ca1;
      letter-spacing: 0.5px;
    }

    /* SUMMARY CARDS - WIDER CUSTOMER DETAILS (57.5%) & COMPACT DOCUMENT DETAILS (42.5%) */
    .summary {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
      gap: 6px;
      margin: 0 0 4px 0;
    }
    .box {
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      min-width: 0;
      width: 100%;
      background: #ffffff;
      box-sizing: border-box;
      overflow: hidden;
    }
    .box h2 {
      margin: 0;
      padding: 3.5px 7px;
      font-size: 9px;
      font-weight: 700;
      color: #0b4ca1;
      background: #e8f0fa;
      border-bottom: 1px solid #cbd5e1;
      text-transform: capitalize;
      line-height: 1.2;
    }
    .box-body {
      padding: 4px 7px;
      min-width: 0;
      width: 100%;
      box-sizing: border-box;
    }
    .party-name {
      font-size: 9.5px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 2px;
    }
    .party-line {
      font-size: 8.5px;
      color: #64748b;
      line-height: 1.35;
    }
    .meta {
      display: grid;
      grid-template-columns: 24mm minmax(0, 1fr);
      gap: 1.5px 5px;
      font-size: 8.5px;
    }
    .label {
      color: #64748b;
      font-weight: 500;
    }
    .value {
      color: #1e293b;
      font-weight: 600;
    }

    /* SHIPMENT DETAILS BOX */
    .shipment-box {
      margin-bottom: 4px;
    }
    .shipment-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 2.5px 5px;
      font-size: 8.5px;
      padding: 3.5px 7px;
    }
    .shipment-cell {
      display: flex;
      flex-direction: column;
      gap: 0.5px;
    }
    .shipment-cell.span-2 { grid-column: span 2; }
    .shipment-cell.span-all { grid-column: 1 / -1; }
    .shipment-cell .label { font-size: 7.5px; font-weight: 700; color: #64748b; text-transform: uppercase; }
    .shipment-cell .value { font-size: 8.5px; color: #1e293b; font-weight: 600; }

    /* DATA TABLE */
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      overflow: hidden;
      font-size: 8.5px;
      margin-bottom: 4px;
    }
    table.data-table th {
      background: #e8f0fa;
      color: #0b4ca1;
      font-weight: 700;
      padding: 3.5px 4px;
      border: 1px solid #cbd5e1;
      font-size: 8.5px;
      line-height: 1.2;
    }
    table.data-table td {
      padding: 2.5px 4px;
      border: 1px solid #e2e8f0;
      vertical-align: middle;
      color: #1e293b;
      font-size: 8.5px;
      line-height: 1.2;
    }
    table.data-table tr:nth-child(even) td {
      background: #f8fafc;
    }
    table.data-table td.desc strong {
      display: block;
      font-weight: 700;
      color: #0b4ca1;
      text-transform: uppercase;
      font-size: 8.5px;
    }
    table.data-table td.desc span {
      display: block;
      color: #64748b;
      font-size: 7.5px;
    }
    table.data-table .center { text-align: center; }
    table.data-table .left { text-align: left; }
    table.data-table .num { text-align: right; font-variant-numeric: tabular-nums; }
    table.data-table .strong { font-weight: 700; color: #0f172a; }

    /* BOTTOM SECTION: REMARKS, WORDS & TOTALS (STRICTLY SNUG - NO VERTICAL EXPANSION) */
    .bottom-section {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
      gap: 8px;
      margin-bottom: 4px;
      align-items: flex-start;
    }
    .vat-legend {
      font-size: 8px;
      color: #64748b;
      margin-bottom: 2px;
    }
    .legend-badge {
      font-weight: 700;
      color: #0b4ca1;
    }
    .words-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 3px 6px;
      margin-bottom: 2px;
    }
    .words-label {
      font-size: 7.5px;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      margin-bottom: 1px;
    }
    .words-text {
      font-size: 8.5px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.25;
      text-transform: uppercase;
    }
    .remarks {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 3px 6px;
      color: #334155;
      font-size: 8px;
      line-height: 1.25;
      white-space: pre-wrap;
    }

    /* COMPACT SNUG TOTALS TABLE (NO EXTRA STRETCH) */
    .totals-wrap {
      display: flex;
      justify-content: flex-end;
      align-items: flex-start;
    }
    .totals {
      width: 250px;
      border-collapse: separate;
      border-spacing: 0;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      overflow: hidden;
      height: auto !important;
    }
    .totals tr {
      height: auto !important;
    }
    .totals td {
      padding: 3px 6px;
      border-bottom: 1px solid #e2e8f0;
      font-size: 8.5px;
      line-height: 1.2;
      color: #334155;
      vertical-align: middle;
    }
    .totals tr:last-child td { border-bottom: 0; }
    .totals .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }
    .totals .grand td {
      background: #e8f0fa;
      color: #0b4ca1;
      font-weight: 700;
      font-size: 9.5px;
      padding: 4px 6px;
    }

    /* BANK DETAILS & PAYMENT TERMS */
    .bank-terms-container {
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(0, 1.35fr);
      gap: 6px;
      margin-bottom: 4px;
    }
    .terms-card {
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 3.5px 6px;
      font-size: 8px;
      line-height: 1.3;
      color: #334155;
      background: #ffffff;
    }
    .terms-title {
      font-weight: 700;
      color: #0b4ca1;
      margin-bottom: 1px;
      font-size: 8px;
      text-transform: uppercase;
    }
    .bank-card {
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 3.5px 6px;
      font-size: 8px;
      line-height: 1.25;
      color: #334155;
      background: #ffffff;
    }
    .bank-card-title {
      font-weight: 700;
      color: #0b4ca1;
      font-size: 8px;
      margin-bottom: 1px;
    }
    .bank-name-strong {
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 1px;
    }

    /* DUAL SIGNATURES WITH DEDICATED STAMP & SIGNING AREA */
    .sign {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 36px;
      margin-top: 6px;
      margin-bottom: 4px;
      page-break-inside: avoid;
    }
    .sign-block {
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
    }
    .sign-space {
      height: 38px;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }
    .stamp-box {
      border: 1px dashed #cbd5e1;
      border-radius: 4px;
      background: rgba(248, 250, 252, 0.7);
      margin-bottom: 2px;
      height: 38px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #94a3b8;
      font-size: 8px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .sign .line {
      border-top: 1px solid #94a3b8;
      padding-top: 3px;
      text-align: center;
      font-size: 8.5px;
      font-weight: 700;
      color: #334155;
    }

    /* LEGAL DISCLAIMER & RUNNING FOOTER */
    .legal-notice {
      font-size: 7px;
      color: #64748b;
      text-align: center;
      line-height: 1.2;
      margin-bottom: 2px;
      padding: 1.5px 3px;
      border-top: 1px dashed #cbd5e1;
    }
    .report-footer {
      width: 100%;
      box-sizing: border-box;
      border-top: 1px solid #e2e8f0;
      padding-top: 2px;
      margin-top: 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      font-size: 8px;
      color: #64748b;
    }
    .report-footer .footer-left,
    .report-footer .footer-right {
      white-space: nowrap;
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
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      <span>Download PDF</span>
    </button>
    <button onclick="window.print()" class="btn-action btn-print" title="Open Print Dialog">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
      <span>Print Invoice</span>
    </button>
    <button onclick="window.close()" class="btn-action btn-close" title="Close Preview">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      <span>Close</span>
    </button>
  </div>
</div>

<!-- INVOICE VIEWPORT -->
<div class="invoice-viewport">
  <div class="doc-shell" id="invoice-to-print">

    <!-- COMPANY MASTHEAD -->
    <div class="company-header">
      <div class="company-logo-wrap">
        <img class="company-logo" src="${esc(logoUrl)}" alt="${esc(displayName)}" />
      </div>
      <div class="company-name-block">
        <h1 class="company-name">${esc(displayName)}</h1>
        <p class="company-address">
          <span class="company-address-line">${esc(fullAddressLine1)}, ${esc(fullAddressLine2)}</span>
          <span class="company-address-line">Tel: ${esc(tel)} ${fax ? `&nbsp;|&nbsp; Fax: ${esc(fax)}` : ""} &nbsp;|&nbsp; e-Mail: ${esc(email)}</span>
          <span class="company-address-line company-trn-inline">TRN: ${esc(companyTaxRegNo)}</span>
        </p>
      </div>
    </div>

    <!-- DOCUMENT TITLE ROW -->
    <div class="doc-title-row">
      <div class="doc-heading">
        <h1>Tax Invoice :</h1>
        <h2 class="doc-sub">${esc(invoiceNo)}</h2>
      </div>
      <div class="doc-badge">ORIGINAL</div>
    </div>

    <!-- SUMMARY SECTION -->
    <section class="summary">
      <!-- CUSTOMER DETAILS -->
      <div class="box">
        <h2>Customer Details</h2>
        <div class="box-body">
          <div class="party-name">${esc(billToName || "—")}</div>
          ${billToAddressLines.map((line) => `<div class="party-line">${esc(line)}</div>`).join("")}
          <div class="party-line">
            ${clientTel ? `<span>Tel: ${esc(clientTel)}</span>` : ""}
            ${clientFax ? `<span style="margin-left: 10px;">Fax: ${esc(clientFax)}</span>` : ""}
          </div>
          ${clientEmail ? `<div class="party-line">e-Mail: ${esc(clientEmail)}</div>` : ""}
          <div class="party-line" style="margin-top: 2px; font-weight: 600; color: #1e293b;">
            Tax Reg No. : ${esc(clientTaxRegNo || "—")}
          </div>
        </div>
      </div>

      <!-- DOCUMENT DETAILS -->
      <div class="box">
        <h2>Document Details</h2>
        <div class="box-body meta">
          <span class="label">Invoice No</span>
          <span class="value">${esc(invoiceNo)}</span>
          <span class="label">Invoice Date</span>
          <span class="value">${invoiceDate}</span>
          <span class="label">Due Date</span>
          <span class="value">${dueDate}</span>
          <span class="label">Job No</span>
          <span class="value">${esc(jobNo || "—")}</span>
          <span class="label">PO No</span>
          <span class="value">${esc(poNo || "—")}</span>
          <span class="label">Currency</span>
          <span class="value">${esc(currCode)}</span>
          <span class="label">Supply Period</span>
          <span class="value">${supplyPeriod}</span>
          <span class="label">Date Of Supply</span>
          <span class="value">${dateOfSupply}</span>
          <span class="label">Customer Rep</span>
          <span class="value">${esc(customerRep || "—")}</span>
          <span class="label">Payment Terms</span>
          <span class="value">${creditDays ? `Due within ${creditDays} days` : "—"}</span>
        </div>
      </div>
    </section>

    <!-- SHIPMENT DETAILS CARD -->
    <div class="box shipment-box">
      <h2>Shipment Details — ${shipmentHeader}</h2>
      <div class="box-body shipment-grid">
        <div class="shipment-cell">
          <span class="label">Origin</span>
          <span class="value">${esc(origin || "—")}</span>
        </div>
        <div class="shipment-cell">
          <span class="label">Destination</span>
          <span class="value">${esc(destination || "—")}</span>
        </div>
        <div class="shipment-cell">
          <span class="label">Date</span>
          <span class="value">${shipmentDate}</span>
        </div>
        <div class="shipment-cell">
          <span class="label">No Of Packings</span>
          <span class="value">${esc(noOfPackings || "—")}</span>
        </div>
        <div class="shipment-cell">
          <span class="label">BL No</span>
          <span class="value">${esc(blNo || "—")}</span>
        </div>
        <div class="shipment-cell">
          <span class="label">HBL No</span>
          <span class="value">${esc(hblNo || "—")}</span>
        </div>
        <div class="shipment-cell">
          <span class="label">Gross Wt</span>
          <span class="value">${grossWt || "—"}</span>
        </div>
        <div class="shipment-cell">
          <span class="label">Net Wt</span>
          <span class="value">${netWt || "—"}</span>
        </div>
        <div class="shipment-cell">
          <span class="label">Volume</span>
          <span class="value">${volume || "—"}</span>
        </div>
        <div class="shipment-cell span-2">
          <span class="label">Containers</span>
          <span class="value">${containers || "—"}</span>
        </div>
        <div class="shipment-cell span-all">
          <span class="label">Product Details</span>
          <span class="value">${prodDetails || "—"}</span>
        </div>
      </div>
    </div>

    <!-- SERVICES TABLE -->
    <table class="data-table">
      <thead>
        <tr>
          <th class="center" style="width: 5%">S.No.</th>
          <th class="left" style="width: 37%">Services / Description</th>
          <th class="center" style="width: 7%">Qty</th>
          <th class="num" style="width: 11%">Rate</th>
          <th class="num" style="width: 13%">Amount (Excl. Tax)</th>
          <th class="center" style="width: 7%">VAT %</th>
          <th class="num" style="width: 9%">Amount Tax</th>
          <th class="num strong" style="width: 11%">Amount (Incl. Tax)</th>
        </tr>
      </thead>
      <tbody>
        ${itemRowsHtml || `<tr><td colspan="8" class="center" style="padding: 10px; color: #94a3b8;">No billable lines found</td></tr>`}
      </tbody>
    </table>

    <!-- BOTTOM SECTION: WORDS & TOTALS -->
    <div class="bottom-section">
      <div class="bottom-left">
        <div class="vat-legend">
          <span class="legend-badge">NT</span> - No Tax &nbsp;|&nbsp;
          <span class="legend-badge">0%</span> - Zero &nbsp;|&nbsp;
          <span class="legend-badge">5%</span> - Standard
        </div>
        <div class="words-card">
          <div class="words-label">Amount in Words (${esc(currCode)}):</div>
          <div class="words-text">${esc(amountInWords(totalInclTax, currCode, decimals, meta.currencyMasterInfo?.curr_name, meta.currencyMasterInfo?.division))}</div>
        </div>
        ${remarks ? `
        <div class="remarks">
          <strong>Remarks:</strong>
          <div style="margin-top: 1px;">${esc(remarks)}</div>
        </div>` : ""}
      </div>

      <div class="bottom-right totals-wrap">
        <table class="totals">
          <tr>
            <td>Sub Total</td>
            <td class="num">${fmtMoney(totalExclTax, decimals)}</td>
          </tr>
          <tr>
            <td>Tax Total</td>
            <td class="num">${fmtMoney(totalTax, decimals)}</td>
          </tr>
          <tr class="grand">
            <td>Grand Total ${esc(currCode)}</td>
            <td class="num">${fmtMoney(totalInclTax, decimals)}</td>
          </tr>
        </table>
      </div>
    </div>

    <!-- PAYMENT TERMS & BANK DETAILS -->
    <div class="bank-terms-container">
      <div class="terms-card">
        <div class="terms-title">Payment Terms & Notice</div>
        <div>• Payment due within <strong>${creditDays} days</strong> from the Date of Invoice.</div>
        <div style="margin-top: 2px;">• Invoice deemed correct if no query reaches <strong>${esc(displayName)}</strong> within 7 days of the Invoice date.</div>
      </div>

      <div class="bank-card">
        <div class="bank-card-title">${esc(rawBeneficiary)}</div>
        <div class="bank-name-strong">${esc(bank1Name)}</div>
        ${(bank1AcNo || bank1Iban) ? `<div>${[bank1AcNo, bank1Iban].filter(Boolean).map(esc).join(" &nbsp;|&nbsp; ")}</div>` : ""}
        ${bank1Swift ? `<div>${esc(bank1Swift)}</div>` : ""}
        ${(bank2AcNo || bank2Iban || bank2Swift) ? `<div style="margin-top: 3px; padding-top: 2px; border-top: 1px dashed #e2e8f0; color: #475569;">${[bank2AcNo, bank2Iban, bank2Swift].filter(Boolean).map(esc).join(" &nbsp;|&nbsp; ")}</div>` : ""}
      </div>
    </div>

    <!-- DUAL SIGNATURES WITH DEDICATED SPACE FOR CUSTOMER AND AUTHORISED SIGNATURE + STAMP -->
    <div class="sign">
      <div class="sign-block">
        <div class="sign-space"></div>
        <div class="line">Customer's Signature</div>
      </div>
      <div class="sign-block">
        <div class="sign-space stamp-box">
          ${meta.stampDataUrl ? `<img src="${esc(meta.stampDataUrl)}" style="max-height: 34px; max-width: 120px; object-fit: contain;" alt="Stamp" />` : `Authorised Signature &amp; Company Stamp`}
        </div>
        <div class="line">Authorised Signature ( &amp; Company Stamp )</div>
      </div>
    </div>

    <!-- LEGAL DISCLAIMER -->
    <div class="legal-notice">
      Any Business, Services provided is subject to <strong>${esc(displayName)}</strong>'s NAFL Standard Trading Conditions, copy of which can be provided on request.
    </div>

    <!-- RUNNING FOOTER -->
    <div class="report-footer">
      <div class="footer-left">Print: ${printDateTimeNow()} &nbsp;|&nbsp; User: ${esc(printUser)}</div>
      <div class="footer-right">Report: Tax Invoice &nbsp;|&nbsp; Powered by Bayanat Technology</div>
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
        margin:       [4, 6, 4, 6],
        filename:     filename,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, logging: false, scrollX: 0, scrollY: 0 },
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
