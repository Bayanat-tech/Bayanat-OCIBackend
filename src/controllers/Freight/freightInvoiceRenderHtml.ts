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

export function buildFreightInvoiceHtmlBTIND(rows: FreightInvoiceRow[], meta: FreightInvoiceMeta = {}): string {
  // BTIND fallback/implementation using standard layout
  return buildFreightInvoiceHtmlAMKSA(rows, meta);
}
