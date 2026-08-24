import { Request, Response } from "express";
import { getConn } from "../../../../res/oracleDbConnect";
import { execDynamicProc } from "../../../../res/helperFunction";
import {
  buildInvoiceHtmlAMKSA,
  buildInvoiceHtmlBTIND,
  InvoiceMeta,
  InvoiceRow,
} from "./render_html";
import {
  encryptInvoiceToken,
  decryptInvoiceToken,
  generateInvoiceQrDataUrl,
} from "./qrToken";

const BASE_URL = process.env.BACKEND_URL || "https://yourdomain.com";

const report = {
  AMKSA: { parameter: "INVOICE_AMKSA", template: "AMKSA" },
  BTIND: { parameter: "INVOICE_AMKSA", template: "BTIND" },
};

const defaultReportConfig = { parameter: "INVOICE_AMKSA", template: "AMKSA" };

const templateBuilders: Record<string, (rows: InvoiceRow[], meta: InvoiceMeta) => string> = {
  AMKSA: buildInvoiceHtmlAMKSA,
  BTIND: buildInvoiceHtmlBTIND,
};

/* ------------------------------------------------------------------ */
/*  Render HTML from rows + meta (shared by both endpoints)            */
/* ------------------------------------------------------------------ */
function buildHtmlFromRows(
  rows: InvoiceRow[],
  meta: InvoiceMeta,
  company_code: string
): string {
  const companyConfig = report[company_code as keyof typeof report] || defaultReportConfig;
  const templateKey = companyConfig?.template || "AMKSA";
  const buildHtml = templateBuilders[templateKey] || buildInvoiceHtmlAMKSA;
  return buildHtml(rows, meta);
}

/* ------------------------------------------------------------------ */
/*  1. AUTHENTICATED endpoint — fetches DB, embeds data in QR token    */
/* ------------------------------------------------------------------ */
export const invoice_report = async (req: Request, res: Response): Promise<void> => {
  const {
    prin_code,
    invoice_no,
    company_code,
    invoice_date,
    invoice_period,
    client_name,
    client_address,
    client_vat_no,
    report_type,                 // <-- NEW
  } = req.query as Record<string, string | undefined>;

  if (!company_code || !prin_code || !invoice_no) {
    res.status(400).send("<h3>Company, principal, and invoice number are required.</h3>");
    return;
  }

  const conn = await getConn(req);

  const companyConfig = report[company_code as keyof typeof report] || defaultReportConfig;
  const result = await execDynamicProc<InvoiceRow>(conn, "PROC_BUILD_DYNAMIC_INVOICE", {
    parameter: companyConfig.parameter,
    code1: company_code,
    code2: prin_code,
    code3: invoice_no,
  });
  if (!result.length) {
    res.status(404).send("<h3>No invoice report data was found for the selected invoice.</h3>");
    return;
  }

  // Build self-contained token: company_code + rows + meta + expiry
  const token = encryptInvoiceToken({
    company_code: company_code || "AMKSA",
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
    data: result,
    meta: {
      invoiceNo: invoice_no,
      invoiceDate: invoice_date,
      invoicePeriod: invoice_period,
      clientName: client_name,
      clientAddress: client_address,
      clientVatNo: client_vat_no,
      reportType: report_type,          // <-- NEW
    },
  });
  

  const qrCodeDataUrl = await generateInvoiceQrDataUrl(token, BASE_URL);

  const html = buildHtmlFromRows(
    result,
    {
      invoiceNo: invoice_no,
      invoiceDate: invoice_date,
      invoicePeriod: invoice_period,
      clientName: client_name,
      clientAddress: client_address,
      clientVatNo: client_vat_no,
      qrCodeDataUrl,
      reportType: report_type,          // <-- NEW
    },
    company_code || "AMKSA"
  );

  res.status(200).set("Content-Type", "text/html; charset=utf-8").send(html);
};

/* ------------------------------------------------------------------ */
/*  2. PUBLIC endpoint — ZERO database, ZERO login                     */
/* ------------------------------------------------------------------ */
export const public_invoice = async (req: Request, res: Response): Promise<void> => {
  const { token } = req.query;

  if (!token || typeof token !== "string") {
    res.status(400).send("<h3>Missing access token</h3>");
    return;
  }

  const payload = decryptInvoiceToken(token);
  if (!payload) {
    res.status(401).send("<h3>Invalid or corrupted link</h3>");
    return;
  }

  if (Date.now() > payload.exp * 1000) {
    res.status(401).send("<h3>Link expired</h3>");
    return;
  }

  // Render directly from embedded data — NO database call
  const html = buildHtmlFromRows(
    payload.data,
    {
      invoiceNo: payload.meta?.invoiceNo,
      invoiceDate: payload.meta?.invoiceDate,
      invoicePeriod: payload.meta?.invoicePeriod,
      clientName: payload.meta?.clientName,
      clientAddress: payload.meta?.clientAddress,
      clientVatNo: payload.meta?.clientVatNo,
      reportType: payload.meta?.reportType,   // <-- NEW
    },
    payload.company_code
  );

  res.status(200).set("Content-Type", "text/html; charset=utf-8").send(html);
};

export default invoice_report;
