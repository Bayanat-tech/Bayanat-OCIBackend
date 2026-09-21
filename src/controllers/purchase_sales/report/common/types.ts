export type ReportRow = Record<string, any>;

export type ReportKind = "SDN" | "SINVOICE";

export interface ReportConfig {
  kind: ReportKind;
  viewName: string;
  title: string;
  reportCode: string;
  docNoLabel: string;
}

export interface DocHeader {
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
  due_date: string;
  credit_period: string;
  ref_no: string;
  tax_amount: number;
  company_trn: string;
}

export interface DocLine {
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
  tax_amount: number;
  tax_perc: number;
  invoice_amount: number;
}

export const REPORT_CONFIG: Record<string, ReportConfig> = {
  SDN: {
    kind: "SDN",
    viewName: "VW_ERP_SALESDN",
    title: "DELIVERY NOTE",
    reportCode: "rpt_sales_dn",
    docNoLabel: "DN No.",
  },
  SINVOICE: {
    kind: "SINVOICE",
    viewName: "VW_ERP_SALESINVOICE",
    title: "INVOICE",
    reportCode: "rpt_sales_invoice",
    docNoLabel: "Invoice No.",
  },
};
