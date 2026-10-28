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

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return String(d);
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear();
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
    USD: "US DOLLARS", INR: "INDIAN RUPEES", OMR: "OMANI RIAL",
    SAR: "SAUDI RIYALS", AED: "UAE DIRHAMS", EUR: "EUROS", GBP: "POUNDS STERLING",
  };
  const minorNames: Record<string, string> = {
    USD: "CENTS", INR: "PAISE", OMR: "BAISA", SAR: "HALALAS",
    AED: "FILS", EUR: "CENTS", GBP: "PENCE",
  };

  const major = majorNames[code] || `${code}`;
  const minor = minorNames[code] || "CENTS";

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
  if (!rows || rows.length === 0) {
    return `<html><body><p style="font-family:Arial;padding:40px;text-align:center;color:#999;">No freight invoice data found.</p></body></html>`;
  }

  const first = rows[0];
  const remark1 = first.inv_desc1 || "";
  const remark2 = first.inv_desc2 || "";
  const currCode = (first.curr_code || meta.curr_code || "OMR").toString().toUpperCase();
  const companyName = (first.company_name || first.company_short_name || "AAA LOGISTICS").trim();
  const billToName = meta.clientName || first.client_name || first.prin_code || "";

  const billToAddressLines = [
    first.prin_addr1,
    first.prin_addr2,
    first.prin_addr3,
    first.prin_addr4,
    first.prin_city,
  ].filter(Boolean) as string[];

  const isActivityWise = (meta.reportType || "").toLowerCase() === "activitywise";

  let itemRowsHtml = "";

  if (isActivityWise) {
    const flatRows = rows.filter((r) => !isCostRow(r) && r.bill != null && Number(r.bill) !== 0);
    itemRowsHtml = flatRows
      .map((r, idx) => {
        const desc = (r as any).activity?.trim() || r.inv_desc || r.other_services || r.act_group_name || "Service";
        const price = Number(r.bill_rate ?? 0);
        const qty = r.quantity ?? "";
        const beforeTax = Number(r.bill ?? 0);
        const vatPerc = r.tx_compnt_perc_1 ?? "";
        const vatAmt = Number(r.tx_compnt_amt_1 ?? 0);
        const withVat = beforeTax + vatAmt;
        return `
          <tr>
            <td class="c-no">${idx + 1}</td>
            <td class="c-desc">${esc(desc)}</td>
            <td class="c-price">${price ? fmtMoney(price, 2) : ""}</td>
            <td class="c-qty">${qty}</td>
            <td class="c-amt">${fmtMoney(beforeTax, 2)}</td>
            <td class="c-vat">${vatPerc}</td>
            <td class="c-amt">${fmtMoney(vatAmt, 2)}</td>
            <td class="c-amt">${fmtMoney(withVat, 2)}</td>
          </tr>`;
      })
      .join("");
  } else {
    // Grouped by Activity Group
    const groupMap = new Map<string, FreightInvoiceRow[]>();
    for (const r of rows) {
      if (isCostRow(r)) continue;
      if (r.bill == null || Number(r.bill) === 0) continue;
      const groupName = ((r.act_group_name || r.activity_group_code || "GENERAL SERVICES") as string).trim();
      const key = groupName.toUpperCase();
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(r);
    }

    let rowSeq = 0;
    const groupSections: string[] = [];

    for (const groupRows of groupMap.values()) {
      const groupTitle = (groupRows[0].act_group_name || groupRows[0].activity_group_code || "GENERAL SERVICES").trim();
      const groupHeader = `
        <tr class="group-header-row" style="background: #f8f9fa;">
          <td class="c-no"></td>
          <td colspan="7" class="c-desc"><strong>${esc(groupTitle)}</strong></td>
        </tr>`;

      const subRows = groupRows.map((r) => {
        rowSeq += 1;
        const activityDesc = (r as any).activity?.trim() || r.inv_desc || r.other_services || groupTitle;
        const subPrice = Number(r.bill_rate ?? 0);
        const subQty = r.quantity ?? "";
        const subAmt = Number(r.bill ?? 0);
        const subVat = Number(r.tx_compnt_amt_1 ?? 0);
        const subWith = subAmt + subVat;
        const subVatP = r.tx_compnt_perc_1 ?? "";
        return `
          <tr class="sub-row">
            <td class="c-no">${rowSeq}</td>
            <td class="c-desc sub-desc" style="padding-left: 14px;">${esc(activityDesc)}</td>
            <td class="c-price">${subPrice ? fmtMoney(subPrice, 2) : ""}</td>
            <td class="c-qty">${subQty}</td>
            <td class="c-amt sub-amt">${fmtMoney(subAmt, 2)}</td>
            <td class="c-vat">${subVatP}</td>
            <td class="c-amt">${fmtMoney(subVat, 2)}</td>
            <td class="c-amt">${fmtMoney(subWith, 2)}</td>
          </tr>`;
      }).join("");

      groupSections.push(groupHeader + subRows);
    }

    itemRowsHtml = groupSections.join("");
  }

  const FIXED_FILLERS = 28;
  const fixedFillerHtml = Array.from({ length: FIXED_FILLERS })
    .map(() => `<tr class="filler-row"><td class="c-no"></td><td class="c-desc"></td><td class="c-price"></td><td class="c-qty"></td><td class="c-amt"></td><td class="c-vat"></td><td class="c-amt"></td><td class="c-amt"></td></tr>`)
    .join("");
  const fillerRowsHtml =
    fixedFillerHtml +
    `<tr class="spacer-row"><td class="c-no"></td><td class="c-desc"></td><td class="c-price"></td><td class="c-qty"></td><td class="c-amt"></td><td class="c-vat"></td><td class="c-amt"></td><td class="c-amt"></td></tr>`;

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
  const vatNo = first.prin_trn_no || "";
  const companyVatNo = first.comp_trn_no || "";

  const bankName = first.bank_name;
  const acCode = first.ac_code_inv || first.ac_code || "";
  const refNo = first.reference_no_inv || first.reference_no || "";
  const bankAddr = first.bank_address_inv || first.bank_address || "";
  const companyForBank = companyName;
  const swiftCode = first.swift_code || first.swift_code_inv || "";

  const bankSection =
    bankName || acCode || refNo || bankAddr
      ? `
    <div class="bank-block">
      <div class="bank-title">Bank Details</div>
      ${bankName ? `<div class="bank-line">Bank Name: ${esc(bankName)}</div>` : ""}
      <div class="bank-line">A/C Name: ${esc(companyForBank)}</div>
      ${acCode ? `<div class="bank-line">A/C No.-${esc(acCode)}</div>` : ""}
      ${refNo ? `<div class="bank-line">Ref No.- ${esc(refNo)}</div>` : ""}
      ${swiftCode ? `<div class="bank-line">SWIFT Code: ${esc(swiftCode)}</div>` : ""}
      ${bankAddr ? `<div class="bank-line">Bank Address: ${esc(bankAddr)}</div>` : ""}
      <div class="bank-line">--</div>
      ${remark1 ? `<div class="bank-line export-note">${esc(remark1)}</div>` : ""}
      ${remark2 ? `<div class="bank-line export-note">${esc(remark2)}</div>` : ""}
    </div>`
      : "";

  const metaRows: Array<[string, string]> = [
    ["Invoice No.", esc(invoiceNo)],
    ["Invoice Date", printDate],
    ...(invoicePeriod ? ([["Invoice Period", invoicePeriod]] as Array<[string, string]>) : []),
    ...(dueDate ? ([["Due Date", dueDate]] as Array<[string, string]>) : []),
    ["Currency", esc(currCode)],
    ["Sales Rep", esc(first.salesman || "")],
    ["Billing Rep", esc(first.user_id || "")],
    ["VAT (TIN NO)", esc(companyVatNo || "")],
  ];

  const stampUrl = (meta.stampDataUrl || first.stamp_path || "").trim();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Tax Invoice ${esc(invoiceNo)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { height: 100%; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; background: #e8e8e8; color: #000; padding: 12px; }
  .invoice-wrapper { max-width: 794px; width: 100%; margin: 0 auto; background: #ffffff; padding: 12px 18px 8px 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); height: 1122px; min-height: 1122px; border: none; display: flex; flex-direction: column; overflow: hidden; }
  @media print {
    @page { size: A4; margin: 8mm; }
    html, body { height: 100%; background: #fff; padding: 0; margin: 0; }
    .invoice-wrapper { box-shadow: none; max-width: 100%; width: 100%; height: 100vh; min-height: 100vh; border: none; padding: 6px 10px; page-break-after: always; }
    .no-print { display: none !important; }
  }
  @media screen and (max-width: 768px) {
    body { padding: 4px; background: #fff; font-size: 12px; }
    .invoice-wrapper { padding: 8px 10px; height: auto; min-height: auto; box-shadow: none; max-width: 100%; }
    .top-info { flex-direction: column; }
    .to-block { flex: none; padding: 4px 0; max-width: 100%; }
    .meta-block { flex: none; padding: 4px 0; }
    .meta-label { width: 110px; }
    .table-area { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .items-table { min-width: 680px; }
    .bank-sig-table, .bank-sig-table tr, .bank-sig-table td { display: block; width: 100% !important; }
    .stamp-cell { text-align: center !important; margin-top: 14px; }
    .invoice-title { font-size: 15px; letter-spacing: 2px; }
    .company-name-fallback { font-size: 15px; }
    .footer { font-size: 9px; }
    .qr-top img { width: 50px; height: 50px; }
  }
  .no-print { text-align: right; margin-bottom: 8px; }
  .no-print button { padding: 6px 20px; background: #1a2c5e; color: #fff; border: none; border-radius: 4px; font-size: 12px; cursor: pointer; }
  .masthead { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; flex-shrink: 0; }
  .logo-box { flex: 0 0 auto; }
  .logo-img { max-height: 80px; max-width: 220px; object-fit: contain; display: block; }
  .company-name-fallback { font-size: 18px; font-weight: 700; color: #1a2c5e; }
  .company-details-right { text-align: right; margin-left: auto; font-size: 10px; line-height: 1.4; }
  .company-name-right { font-size: 13px; font-weight: 700; color: #1a2c5e; margin-bottom: 2px; }
  .company-addr-line { font-size: 9.5px; color: #222; }
  .qr-top { text-align: right; margin-top: 4px; }
  .qr-top img { width: 58px; height: 58px; display: inline-block; }
  .qr-top .qr-label { font-size: 7px; color: #444; margin-top: 2px; }
  .invoice-title { text-align: center; font-size: 18px; font-weight: 700; letter-spacing: 4px; margin-bottom: 6px; flex-shrink: 0; }
  .top-info { display: flex; border: none; flex-shrink: 0; }
  .to-block { flex: 1.2; padding: 6px 10px 6px 0; border: none; }
  .to-label { font-weight: 700; font-size: 10px; margin-bottom: 2px; }
  .to-name { font-weight: 700; font-size: 11px; margin-bottom: 1px; }
  .to-line { font-size: 10px; line-height: 1.5; border: none; max-width: 280px; }
  .meta-block { flex: 1; padding: 6px 0 6px 10px; border: none; }
  .meta-row { display: flex; font-size: 10px; line-height: 1.5; }
  .meta-label { width: 120px; color: #000; }
  .meta-colon { width: 10px; }
  .meta-value { font-weight: 600; flex: 1; }
  .table-area { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; margin-top: 4px; }
  .items-table { width: 100%; height: 100%; border-collapse: collapse; border: 1px solid #000; font-size: 10px; table-layout: fixed; }
  .items-table th, .items-table td { border: 1px solid #000; padding: 2px 4px; vertical-align: top; overflow: hidden; }
  .items-table thead th { background: #eef2f6; font-weight: 700; font-size: 10.5px; text-align: center; vertical-align: middle; }
  .c-no { width: 28px; text-align: center; padding-left: 2px; padding-right: 2px; }
  .c-desc { width: auto; text-align: left; word-wrap: break-word; overflow-wrap: break-word; }
  .c-price { width: 80px; text-align: center; white-space: nowrap; font-variant-numeric: tabular-nums; padding-left: 2px; padding-right: 4px; }
  .c-qty { width: 40px; text-align: center; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .c-amt { width: 90px; text-align: center; white-space: nowrap; font-variant-numeric: tabular-nums; padding-left: 2px; padding-right: 4px; }
  .c-vat { width: 26px; text-align: center; white-space: nowrap; padding-left: 1px; padding-right: 1px; }
  .sub-row td { border: 1px solid #000; }
  .sub-desc { padding-left: 14px; color: #222; }
  .sub-amt { color: #222; }
  .total-prefix { font-size: 8.5px; font-weight: 700; margin-right: 2px; }
  .filler-row td { border-top: none !important; border-bottom: none !important; border-left: 1px solid #000; border-right: 1px solid #000; height: 14px; padding: 0 5px; }
  .spacer-row td { border-top: none !important; border-bottom: none !important; border-left: 1px solid #000; border-right: 1px solid #000; height: 100%; min-height: 40px; padding: 0; vertical-align: top; }
  .legend-row td { font-size: 8.5px; color: #222; border: 1px solid #000; vertical-align: middle; padding: 2px 4px; }
  .words-row .total-label { text-align: left; font-weight: 700; font-size: 9.5px; white-space: normal; word-wrap: break-word; }
  .words-row td { border: 1px solid #000; border-top: 2px solid #000; font-weight: 700; vertical-align: middle; padding: 4px; }
  .words-row .c-amt { font-weight: 700; white-space: nowrap; }
  .bank-sig-table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 10px; flex-shrink: 0; }
  .bank-sig-table td { vertical-align: top; padding: 0; border: none; }
  .bank-cell { width: 62%; padding-right: 14px; }
  .stamp-cell { width: 160px; text-align: right; }
  .bank-block { font-size: 10px; line-height: 1.45; }
  .bank-title { font-weight: 700; text-decoration: underline; margin-bottom: 2px; }
  .bank-line { margin-bottom: 1px; }
  .stamp-img { display: block; margin-left: auto; margin-right: 0; max-height: 90px; max-width: 120px; width: auto; height: auto; object-fit: contain; }
  .signature-text { font-weight: 700; font-size: 11px; text-align: right; white-space: nowrap; padding-top: 4px; }
  .footer { margin-top: 8px; padding-top: 6px; border: none; text-align: center; font-size: 10px; font-weight: 700; flex-shrink: 0; }
  .footer .addr-line { font-weight: 400; margin-top: 2px; }
  .footer .disclaimer { font-weight: 400; font-size: 8.5px; color: #222; border: none; margin-top: 4px; text-align: left; padding-top: 2px; }
</style>
</head>
<body>

<div class="no-print">
  <button onclick="window.print()">🖨️ Print / Save PDF</button>
</div>

<div class="invoice-wrapper">

  <div class="masthead">
    <div class="logo-box">
      ${(() => {
        const logoUrl = (first.company_logo || first.logo_path || "").trim();
        if (logoUrl) return `<img class="logo-img" src="${esc(logoUrl)}" alt="Logo" />`;
        return `<div class="company-name-fallback">${esc(companyName)}</div>`;
      })()}
    </div>
    <div class="company-details-right">
      <div class="company-name-right">${esc(companyName)}</div>
      ${first.address1 ? `<div class="company-addr-line">${esc(first.address1)}</div>` : ""}
      ${first.address2 ? `<div class="company-addr-line">${esc(first.address2)}</div>` : ""}
      ${first.address3 ? `<div class="company-addr-line">${esc(first.address3)}</div>` : ""}
      ${first.city ? `<div class="company-addr-line">City: ${esc(first.city)}</div>` : ""}
      ${first.email ? `<div class="company-addr-line">e-mail: ${esc(first.email)}</div>` : ""}
      ${first.tel_no ? `<div class="company-addr-line">Tel: ${esc(first.tel_no)}</div>` : ""}
      ${first.crn ? `<div class="company-addr-line">C.R. No.: ${esc(first.crn)}</div>` : ""}
      ${meta.qrCodeDataUrl ? `<div class="qr-top"><img src="${esc(meta.qrCodeDataUrl)}" alt="QR" /><div class="qr-label">Scan to view online</div></div>` : ""}
    </div>
  </div>
  <div class="invoice-title">TAX INVOICE</div>

  <div class="top-info">
    <div class="to-block">
      <div class="to-label">To :</div>
      <div class="to-name">${esc(billToName)} Company</div>
      ${billToAddressLines.map((l) => `<div class="to-line">${esc(l)}</div>`).join("")}
      ${first.prin_telno1 ? `<div class="to-line">Ph. ${esc(first.prin_telno1)}</div>` : ""}
      ${first.prin_faxno1 ? `<div class="to-line">Fax: ${esc(first.prin_faxno1)}</div>` : ""}
      ${first.prin_email1 ? `<div class="to-line">e-Mail : ${esc(first.prin_email1)}</div>` : ""}
      <div class="to-line">VAT (TIN No) : ${esc(vatNo)}</div>
    </div>
    <div class="meta-block">
      ${metaRows.map(([label, value]) => `<div class="meta-row"><div class="meta-label">${label}</div><div class="meta-colon">${label ? ":" : ""}</div><div class="meta-value">${value}</div></div>`).join("")}
    </div>
  </div>

  <div class="table-area">
    <table class="items-table">
      <colgroup>
        <col style="width:28px" /><col /><col style="width:80px" /><col style="width:40px" />
        <col style="width:90px" /><col style="width:26px" /><col style="width:90px" /><col style="width:90px" />
      </colgroup>
      <thead>
        <tr>
          <th class="c-no">SR No</th>
          <th class="c-desc">Description</th>
          <th class="c-price">Price</th>
          <th class="c-qty">Qty</th>
          <th class="c-amt">Total<br/>Before Tax</th>
          <th class="c-vat">VAT<br/>%</th>
          <th class="c-amt">VAT<br/>Amount</th>
          <th class="c-amt">Total<br/>With VAT</th>
        </tr>
      </thead>
      <tbody>
        ${itemRowsHtml}
        ${fillerRowsHtml}
        <tr class="words-row">
          <td class="total-label" colspan="4">${esc(amountInWords(totalAfterVat, currCode, 2))}</td>
          <td class="c-amt">${fmtMoney(totalBeforeVat, 2)}</td>
          <td class="c-vat"></td>
          <td class="c-amt">${fmtMoney(totalVat, 2)}</td>
          <td class="c-amt">${fmtMoney(totalAfterVat, 2)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <table class="bank-sig-table">
    <tr>
      <td class="bank-cell">${bankSection}</td>
      <td class="stamp-cell">
        ${stampUrl ? `<img class="stamp-img" src="${esc(stampUrl)}" alt="Stamp" />` : ""}
        <div class="signature-text">For ${esc(companyName)}</div>
      </td>
    </tr>
  </table>

  <div class="footer">
    <div>${esc(first.div_address1 || "")}</div>
    <div class="addr-line">${first.phone ? `Tel: ${esc(first.phone)}` : ""}${first.fax ? ` ; Fax: ${esc(first.fax)}` : ""}</div>
    <div class="disclaimer">
      This is a digitally signed Tax Invoice generated electronically by ${esc(companyName)}.<br/>
      No physical signature is required. The authenticity of this document can be verified using the QR code (if present) or by contacting the issuer.
    </div>
  </div>

</div>

</body>
</html>`;
}


export function buildFreightInvoiceHtmlMHDL(rows: FreightInvoiceRow[], meta: FreightInvoiceMeta = {}): string {
  if (!rows || rows.length === 0) {
    return `<html><body><p style="font-family:Arial;padding:40px;text-align:center;color:#999;">No freight invoice data found.</p></body></html>`;
  }

  const first = rows[0];
  const shipment = meta.shipmentInfo || {};
  const divisionInfo = meta.divisionInfo || {};
  const companyInfo = meta.companyInfo || {};

  const divisionName = (divisionInfo.DIV_NAME || divisionInfo.div_name || first.div_name || "").trim();
  const divisionShortName = (divisionInfo.DIV_SHORT_NAME || divisionInfo.div_short_name || first.div_short_name || "").trim();
  const companyName = (companyInfo.COMPANY_NAME || companyInfo.company_name || first.company_name || "AAA LOGISTICS").trim();
  const displayName = divisionName || companyName;
  const displayShortName = divisionShortName || companyInfo.COMPANY_SHORT_NAME || companyInfo.company_short_name || "";

  const currCode = (first.curr_code || meta.curr_code || "OMR").toString().toUpperCase();
  const decimals = currCode === "OMR" ? 3 : 2;

  const invoiceNo = meta.invoiceNo || first.invno_prefixed || first.invoice_no || "";
  const invoiceDate = fmtDate(first.invoice_date || meta.invoiceDate || first.user_dt);
  const dueDate = fmtDate(first.due_date || first.invoice_date || meta.invoiceDate);
  const supplyPeriod = first.from_date && first.to_date
    ? `${fmtDate(first.from_date)} - ${fmtDate(first.to_date)}`
    : (meta.invoicePeriod || "");
  const dateOfSupply = fmtDate(first.from_date || first.invoice_date);
  const customerRep = first.customer_rep || first.salesman || "";
  const jobNo = first.job_no || shipment.job_no || "";
  const poNo = shipment.po_no || first.po_no || first.prin_ref1 || "";
  const companyTaxRegNo = divisionInfo.DIV_TRN_NO || divisionInfo.div_trn_no || divisionInfo.TRN_NO || divisionInfo.trn_no || companyInfo.COMP_TRN_NO || companyInfo.comp_trn_no || companyInfo.TRN_NO || companyInfo.trn_no || first.comp_trn_no || first.trn_no || "";

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
  const rawMode = String(shipment.transport_mode || first.transport_mode || "S").toUpperCase();
  const rawJobType = String(shipment.job_type || first.job_type || "IMP").toUpperCase();
  const modeText = rawMode === "A" ? "AIR" : rawMode === "R" ? "ROAD" : "SEA";
  const typeText = rawJobType === "EXP" ? "EXPORT" : "IMPORT";
  const shipmentHeader = `${modeText} ${typeText}`;

  const origin = shipment.place_receipt || first.country_origin || "";
  const destination = shipment.place_delivery || first.country_destination || "";
  const noOfPackings = shipment.no_of_packings != null ? String(shipment.no_of_packings) : "";
  const blNo = shipment.bl_no || shipment.doc_ref || "";
  const hblNo = shipment.hawb || "";
  const netWt = shipment.net_wt != null ? fmtMoney(shipment.net_wt, 2) : "0.00";
  const grossWt = shipment.gross_wt != null ? fmtMoney(shipment.gross_wt, 2) : "";
  const volume = shipment.volume != null ? fmtMoney(shipment.volume, 2) : "";
  const containers = shipment.container_no || "";
  const prodDetails = shipment.prod_description || shipment.description1 || "";
  const shipmentDate = fmtDate(shipment.issue_date || shipment.bl_date || first.invoice_date);

  // Line items
  const billableRows = rows.filter((r) => !isCostRow(r) && r.bill != null && Number(r.bill) !== 0);
  let totalExclTax = 0;
  let totalTax = 0;

  const itemRowsHtml = billableRows.map((r, idx) => {
    const desc = (r as any).activity?.trim() || r.other_services || r.inv_desc || r.act_group_name || "Service";
    const qty = r.quantity || 1;
    const amountExcl = Number(r.bill || 0);
    const rate = Number(r.bill_rate || amountExcl / Number(qty || 1));
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
      <tr>
        <td style="text-align: center; border: 1px solid #000; padding: 4px 6px; font-size: 11px;">${idx + 1}</td>
        <td style="text-align: left; border: 1px solid #000; padding: 4px 6px; font-size: 11px; text-transform: uppercase;">${esc(desc)}</td>
        <td style="text-align: center; border: 1px solid #000; padding: 4px 6px; font-size: 11px; font-weight: bold;">${qty}</td>
        <td style="text-align: right; border: 1px solid #000; padding: 4px 6px; font-size: 11px;">${fmtMoney(rate, decimals)}</td>
        <td style="text-align: right; border: 1px solid #000; padding: 4px 6px; font-size: 11px; font-weight: bold;">${fmtMoney(amountExcl, decimals)}</td>
        <td style="text-align: center; border: 1px solid #000; padding: 4px 6px; font-size: 11px;">${vatLabel}</td>
        <td style="text-align: right; border: 1px solid #000; padding: 4px 6px; font-size: 11px;">${fmtMoney(taxAmt, decimals)}</td>
        <td style="text-align: right; border: 1px solid #000; padding: 4px 6px; font-size: 11px; font-weight: bold;">${fmtMoney(amountIncl, decimals)}</td>
      </tr>`;
  }).join("");

  const totalInclTax = totalExclTax + totalTax;

  // Filler rows to maintain height
  const fillerCount = Math.max(0, 8 - billableRows.length);
  const fillerRows = Array.from({ length: fillerCount })
    .map(() => `<tr>
      <td style="border: 1px solid #000; height: 22px;"></td>
      <td style="border: 1px solid #000;"></td>
      <td style="border: 1px solid #000;"></td>
      <td style="border: 1px solid #000;"></td>
      <td style="border: 1px solid #000;"></td>
      <td style="border: 1px solid #000;"></td>
      <td style="border: 1px solid #000;"></td>
      <td style="border: 1px solid #000;"></td>
    </tr>`)
    .join("");

  // Bank accounts (completely dynamic from division / company / bank master)
  let rawBeneficiary = divisionInfo.BANK_NAME_INV || divisionInfo.bank_name_inv || first.bank_name_inv || "";
  if (!rawBeneficiary && displayName) {
    rawBeneficiary = `Beneficiary Name: ${displayName}`;
  } else if (rawBeneficiary && !rawBeneficiary.toLowerCase().startsWith("beneficiary")) {
    rawBeneficiary = `Beneficiary Name: ${rawBeneficiary}`;
  }

  const bank1Name = divisionInfo.BANK_ADDRESS_INV || divisionInfo.bank_address_inv || companyInfo.BANK_NAME || companyInfo.bank_name || first.bank_address_inv || first.bank_name || "";
  let bank1AcNo = divisionInfo.AC_CODE_INV || divisionInfo.ac_code_inv || companyInfo.AC_CODE || companyInfo.ac_code || first.ac_code_inv || first.ac_code || "";
  if (bank1AcNo && !bank1AcNo.toLowerCase().includes("a/c") && !bank1AcNo.toLowerCase().includes("ac no")) {
    bank1AcNo = `A/C No.: ${bank1AcNo} (${currCode})`;
  }
  let bank1Iban = divisionInfo.REFERENCE_NO_INV || divisionInfo.reference_no_inv || companyInfo.REFERENCE_NO || companyInfo.reference_no || first.reference_no_inv || first.reference_no || "";
  if (bank1Iban && !bank1Iban.toLowerCase().includes("iban")) {
    bank1Iban = `IBAN No : ${bank1Iban}`;
  }
  let bank1Swift = divisionInfo.SWIFT_CODE_INV || divisionInfo.swift_code_inv || companyInfo.SWIFT_CODE || companyInfo.swift_code || first.swift_code_inv || first.swift_code || "";
  if (bank1Swift && !bank1Swift.toLowerCase().includes("swift")) {
    bank1Swift = `SWIFT Code: ${bank1Swift}`;
  }

  // Secondary Bank account (USD if present)
  let bank2AcNo = divisionInfo.AC_CODE_INV_USD || divisionInfo.ac_code_inv_usd || "";
  if (bank2AcNo && !bank2AcNo.toLowerCase().includes("a/c") && !bank2AcNo.toLowerCase().includes("ac no")) {
    bank2AcNo = `A/C No.: ${bank2AcNo} (USD)`;
  }
  let bank2Iban = divisionInfo.REF_NO_INV_USD || divisionInfo.ref_no_inv_usd || "";
  if (bank2Iban && !bank2Iban.toLowerCase().includes("iban")) {
    bank2Iban = `IBAN No : ${bank2Iban}`;
  }
  let bank2Swift = divisionInfo.SWIFT_CODE_INV_USD || divisionInfo.swift_code_inv_usd || "";
  if (bank2Swift && !bank2Swift.toLowerCase().includes("swift")) {
    bank2Swift = `SWIFT Code: ${bank2Swift}`;
  }

  // Footer address & contacts
  const addressParts = [
    displayName,
    divisionInfo.DIV_ADDRESS1 || divisionInfo.div_address1 || companyInfo.ADDRESS1 || companyInfo.address1 || first.div_address1 || first.address1,
    divisionInfo.DIV_ADDRESS2 || divisionInfo.div_address2 || companyInfo.ADDRESS2 || companyInfo.address2 || first.div_address2 || first.address2,
    divisionInfo.DIV_ADDRESS3 || divisionInfo.div_address3 || companyInfo.ADDRESS3 || companyInfo.address3 || first.div_address3 || first.address3,
    divisionInfo.CITY || divisionInfo.city || companyInfo.CITY || companyInfo.city || first.city,
    divisionInfo.COUNTRY || divisionInfo.country || companyInfo.COUNTRY || companyInfo.country || first.country,
  ].filter(Boolean);
  const fullAddress = addressParts.join(", ");

  const tel = divisionInfo.PHONE || divisionInfo.phone || companyInfo.CONTACT_NUMBER || companyInfo.contact_number || companyInfo.TEL_NO || companyInfo.tel_no || first.phone || first.tel_no || "";
  const fax = divisionInfo.FAX || divisionInfo.fax || companyInfo.FAX_NO || companyInfo.fax_no || first.fax || first.fax_no || "";
  const email = divisionInfo.EMAIL || divisionInfo.email || companyInfo.EMAIL || companyInfo.email || first.email || "";

  const contactParts: string[] = [];
  if (tel && tel.trim()) contactParts.push(`Tel: ${esc(tel.trim())}`);
  if (fax && fax.trim()) contactParts.push(`Fax: ${esc(fax.trim())}`);
  if (email && email.trim()) contactParts.push(`e-Mail: ${esc(email.trim())}`);

  // Payment terms
  const creditDays = first.creditdays || shipment.creditdays || 30;
  const paymentTermsText = first.payment_terms || shipment.payment_terms
    ? `Payment due within ${creditDays} days from the Date of Invoice. (${first.payment_terms || shipment.payment_terms})`
    : `Payment due within ${creditDays} days from the Date of Invoice.`;

  const logoUrl = companyInfo.COMPANY_LOGO || companyInfo.company_logo || divisionInfo.COMP_LOGO || divisionInfo.comp_logo || first.company_logo || "";
  const logoTitle = companyInfo.LOGO_TITLE || companyInfo.logo_title || displayName;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>TAX INVOICE - ${esc(invoiceNo)}</title>
  <style>
    @page {
      size: A4;
      margin: 10mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: Arial, Helvetica, sans-serif;
      margin: 0;
      padding: 0;
      color: #000;
      background: #fff;
      font-size: 11px;
      line-height: 1.3;
    }
    .invoice-wrapper {
      width: 100%;
      max-width: 820px;
      margin: 0 auto;
      background: #fff;
    }
    .top-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 6px;
    }
    .logo-container {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 4px 0;
    }
    .logo-img {
      max-height: 52px;
      max-width: 180px;
      object-fit: contain;
    }
    .logo-text-eng {
      font-weight: 900;
      font-size: 15px;
      color: #0369a1;
      letter-spacing: 0.5px;
    }
    .logo-text-arb {
      font-family: Tahoma, 'Traditional Arabic', Arial;
      font-size: 12px;
      color: #0369a1;
      font-weight: bold;
      direction: rtl;
    }
    .main-title-block {
      text-align: center;
      margin: 4px 0 12px;
    }
    .main-title {
      font-size: 20px;
      font-weight: 900;
      letter-spacing: 2px;
      margin: 0 0 2px;
    }
    .sub-title {
      font-size: 12px;
      font-weight: bold;
      color: #333;
    }
    .header-info-grid {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 8px;
    }
    .client-box {
      width: 52%;
      border-bottom: 1px solid #333;
      padding-bottom: 6px;
    }
    .client-title {
      font-weight: bold;
      font-size: 11px;
      margin-bottom: 2px;
    }
    .client-name {
      font-weight: 800;
      font-size: 12px;
      margin-bottom: 3px;
      border-bottom: 1.5px solid #000;
      display: inline-block;
      padding-bottom: 1px;
    }
    .client-line {
      font-size: 10.5px;
      color: #111;
      line-height: 1.35;
    }
    .meta-box {
      width: 44%;
    }
    .meta-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    .meta-table td {
      padding: 1.5px 0;
      vertical-align: top;
    }
    .meta-label {
      font-weight: bold;
      width: 110px;
      white-space: nowrap;
    }
    .meta-colon {
      width: 12px;
      font-weight: bold;
      text-align: center;
    }
    .meta-val {
      font-weight: 700;
      border-bottom: 1px solid #777;
    }
    .shipment-box {
      border: 1px solid #000;
      margin-bottom: 8px;
    }
    .shipment-title-bar {
      border-bottom: 1px solid #000;
      padding: 3px 8px;
      font-weight: 900;
      font-size: 11px;
      text-transform: uppercase;
      background: #f8fafc;
    }
    .shipment-grid {
      width: 100%;
      border-collapse: collapse;
      font-size: 10.5px;
    }
    .shipment-grid td {
      border-right: 1px solid #000;
      border-bottom: 1px solid #000;
      padding: 3px 6px;
      vertical-align: top;
    }
    .shipment-grid tr:last-child td {
      border-bottom: 0;
    }
    .shipment-grid td:last-child {
      border-right: 0;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 0;
    }
    .items-table th {
      border: 1px solid #000;
      background: #ffffff;
      font-weight: bold;
      font-size: 10.5px;
      padding: 5px 4px;
      text-align: center;
      line-height: 1.2;
    }
    .summary-table {
      width: 100%;
      border-collapse: collapse;
      border-top: 0;
    }
    .summary-table td {
      border: 1px solid #000;
      padding: 4px 6px;
      vertical-align: middle;
    }
    .tax-notes {
      font-size: 10px;
      font-weight: bold;
      margin-bottom: 4px;
    }
    .words-text {
      font-size: 10.5px;
      font-weight: bold;
    }
    .footer-terms {
      margin-top: 8px;
      font-size: 10.5px;
      line-height: 1.35;
    }
    .bank-grid {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      font-size: 10px;
    }
    .bank-details-col {
      line-height: 1.4;
    }
    .bank-name-head {
      font-weight: bold;
      margin-bottom: 2px;
    }
    .company-sign-block {
      text-align: right;
      font-weight: bold;
      font-size: 11px;
      padding-top: 24px;
    }
    .bottom-disclaimer-box {
      border: 1.5px solid #000;
      margin-top: 10px;
      padding: 4px 8px;
      text-align: center;
      font-size: 10px;
      line-height: 1.35;
    }
    .bottom-disclaimer-box .company-address {
      font-weight: bold;
    }
    .bottom-disclaimer-box .contact-line {
      font-weight: bold;
      margin: 2px 0;
    }
  </style>
</head>
<body>

<div class="invoice-wrapper">

  <!-- TOP HEADER -->
  <div class="top-header">
    <div class="logo-container">
      ${logoUrl ? `<img class="logo-img" src="${esc(logoUrl)}" alt="${esc(displayName)}" />` : `<div style="font-weight: 900; font-size: 24px; color: #0284c7; font-family: Impact, Arial-Black, sans-serif;">${esc(displayShortName || displayName.substring(0, 4))}</div>`}
      <div>
        <div class="logo-text-eng">${esc(logoTitle || displayName)}</div>
      </div>
    </div>
  </div>

  <div class="main-title-block">
    ${displayShortName ? `<div style="font-size: 11px; font-weight: bold; color: #555;">${esc(displayShortName)}</div>` : ""}
    <div class="main-title">TAX INVOICE</div>
  </div>

  <!-- CLIENT & INVOICE META -->
  <div class="header-info-grid">
    <div class="client-box">
      <div class="client-title">To</div>
      <div class="client-name">${esc(billToName)}</div>
      ${billToAddressLines.map((line) => `<div class="client-line">${esc(line)}</div>`).join("")}
      <div class="client-line" style="margin-top: 4px;">${clientTel ? `Ph. ${esc(clientTel)}` : "Ph."} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${clientFax ? `Fax. ${esc(clientFax)}` : "Fax."} </div>
      <div class="client-line">e-Mail : ${esc(clientEmail)}</div>
      <div class="client-line" style="margin-top: 3px;">Tax Reg No. : ${esc(clientTaxRegNo)}</div>
      <div class="client-line" style="margin-top: 4px;">Remarks : ${esc(remarks)}</div>
    </div>

    <div class="meta-box">
      <table class="meta-table">
        <tr>
          <td class="meta-label">Invoice No.</td>
          <td class="meta-colon">:</td>
          <td class="meta-val">${esc(invoiceNo)}</td>
        </tr>
        <tr>
          <td class="meta-label">Invoice Date</td>
          <td class="meta-colon">:</td>
          <td class="meta-val">${invoiceDate}</td>
        </tr>
        <tr>
          <td class="meta-label">Due Date</td>
          <td class="meta-colon">:</td>
          <td class="meta-val">${dueDate}</td>
        </tr>
        <tr>
          <td class="meta-label">Supply From / To</td>
          <td class="meta-colon">:</td>
          <td class="meta-val">${supplyPeriod}</td>
        </tr>
        <tr>
          <td class="meta-label">Customer Rep</td>
          <td class="meta-colon">:</td>
          <td class="meta-val">${esc(customerRep)}</td>
        </tr>
        <tr>
          <td class="meta-label">Currency</td>
          <td class="meta-colon">:</td>
          <td class="meta-val">${esc(currCode)}</td>
        </tr>
        <tr>
          <td class="meta-label">Job No</td>
          <td class="meta-colon">:</td>
          <td class="meta-val">${esc(jobNo)}</td>
        </tr>
        <tr>
          <td class="meta-label">PO No</td>
          <td class="meta-colon">:</td>
          <td class="meta-val">${esc(poNo)}</td>
        </tr>
        <tr>
          <td class="meta-label">Tax Reg No.</td>
          <td class="meta-colon">:</td>
          <td class="meta-val">${esc(companyTaxRegNo)}</td>
        </tr>
        <tr>
          <td class="meta-label">Date Of Supply</td>
          <td class="meta-colon">:</td>
          <td class="meta-val">${dateOfSupply}</td>
        </tr>
        <tr>
          <td colspan="3" style="text-align: right; font-size: 9.5px; padding-top: 3px;">Page 1 of 1</td>
        </tr>
      </table>
    </div>
  </div>

  <!-- SHIPMENT DETAILS BOX -->
  <div class="shipment-box">
    <div class="shipment-title-bar">${shipmentHeader}</div>
    <table class="shipment-grid">
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

  <!-- LINE ITEMS TABLE -->
  <table class="items-table">
    <thead>
      <tr>
        <th style="width: 5%;">S.No.</th>
        <th style="width: 41%; text-align: left;">Services</th>
        <th style="width: 8%;">Quantity</th>
        <th style="width: 10%;">Rate</th>
        <th style="width: 13%;">Amount (Excl.<br/>Tax)</th>
        <th style="width: 6%;">VAT<br/>%</th>
        <th style="width: 8%;">Amount<br/>Tax</th>
        <th style="width: 9%;">Amount<br/>(Incl. Tax)</th>
      </tr>
    </thead>
    <tbody>
      ${itemRowsHtml}
      ${fillerRows}
    </tbody>
  </table>

  <!-- TOTALS SECTION -->
  <table class="summary-table">
    <tr>
      <td style="width: 54%; vertical-align: top;">
        <div class="tax-notes">NT - No Tax, 0% - Zero, 5% - Standard</div>
        <div class="words-text">${esc(amountInWords(totalInclTax, currCode, decimals))}</div>
      </td>
      <td style="width: 10%; text-align: right; font-weight: bold; border-right: 0;">Total :</td>
      <td style="width: 13%; text-align: right; font-weight: bold; border-left: 0; border-right: 1px solid #000;">${fmtMoney(totalExclTax, decimals)}</td>
      <td style="width: 6%; border-right: 0; border-left: 0;"></td>
      <td style="width: 8%; text-align: right; font-weight: bold;">${fmtMoney(totalTax, decimals)}</td>
      <td style="width: 9%; text-align: right; font-weight: bold;">${fmtMoney(totalInclTax, decimals)}</td>
    </tr>
  </table>

  <!-- FOOTER & TERMS -->
  <div class="footer-terms">
    <div><strong>Payment Terms:</strong> ${esc(paymentTermsText)}</div>
    <div>Invoice deemed correct if no query reaches ${esc(displayName)} within 7 days of the Invoice date.</div>
  </div>

  <!-- BANK DETAILS & SIGNATURE (FULLY DYNAMIC FROM DIVISION / COMPANY / BANK MASTER) -->
  <div class="bank-grid">
    <div class="bank-details-col">
      ${rawBeneficiary ? `<div class="bank-name-head">${esc(rawBeneficiary)}</div>` : ""}
      ${bank1Name ? `<div><strong>${esc(bank1Name)}</strong></div>` : ""}
      ${bank1AcNo ? `<div style="margin-top: 3px;">${esc(bank1AcNo)}</div>` : ""}
      ${bank1Iban ? `<div>${esc(bank1Iban)}</div>` : ""}
      ${bank1Swift ? `<div>${esc(bank1Swift)}</div>` : ""}
    </div>

    ${bank2AcNo || bank2Iban ? `
    <div class="bank-details-col" style="padding-top: 15px;">
      ${bank2AcNo ? `<div>${esc(bank2AcNo)}</div>` : ""}
      ${bank2Iban ? `<div>${esc(bank2Iban)}</div>` : ""}
      ${bank2Swift ? `<div>${esc(bank2Swift)}</div>` : ""}
    </div>` : `<div class="bank-details-col"></div>`}

    <div class="company-sign-block">
      ${esc(displayName)}
    </div>
  </div>

  <!-- BOTTOM BANNER (FULLY DYNAMIC) -->
  <div class="bottom-disclaimer-box">
    <div class="company-address">${esc(fullAddress)}</div>
    ${contactParts.length > 0 ? `<div class="contact-line">${contactParts.join(" ; ")}</div>` : ""}
    <div>Any Business, Services provided is subject to ${esc(displayName)}'s NAFL Standard Trading Conditions, copy of which can be provided on request.</div>
  </div>

</div>

</body>
</html>`;
}


export function buildFreightInvoiceHtmlBTIND(rows: FreightInvoiceRow[], meta: FreightInvoiceMeta = {}): string {
  // BTIND fallback/implementation using standard layout
  return buildFreightInvoiceHtmlAMKSA(rows, meta);
}
