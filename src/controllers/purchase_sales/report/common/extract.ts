import { DocHeader, DocLine, ReportRow } from "./types";
import { fmtDate, num, resolveCompanyLogoSrc, text } from "./formatters";

export function extractHeader(rows: ReportRow[]): DocHeader | null {
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
    cust_email: text(r.cust_email || r.e_mail),
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
    due_date: fmtDate(r.due_date),
    credit_period: text(r.credit_period),
    ref_no: text(r.ref_no),
    tax_amount: num(r.tax_amount),
    company_trn: text(r.company_trn),
  };
}

export function extractLines(rows: ReportRow[]): DocLine[] {
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
      tax_amount: num(r.tax_amount),
      tax_perc: num(r.tax_perc),
      invoice_amount: num(r.invoice_amount) || num(r.total_invamt),
    }));
}

export function calcTotals(lines: DocLine[], discHdrPrice: number) {
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
  const totalAmount = lines.reduce((s, l) => s + l.amount, 0);
  const totalTax = lines.reduce((s, l) => s + l.tax_amount, 0);
  const overallDiscount = discHdrPrice;
  const grandFromLines = lines.reduce(
    (s, l) => s + (l.invoice_amount || l.amount + l.tax_amount),
    0,
  );
  const grandTotal =
    grandFromLines > 0 ? grandFromLines - overallDiscount : totalAmount + totalTax - overallDiscount;

  return { totalQty, totalAmount, totalTax, overallDiscount, grandTotal };
}

export function currencyLabel(currCode: string): string {
  if (currCode === "QAR" || currCode === "QR") return "QATARI RIYAL";
  return currCode || "AMOUNT";
}
