import { Request, Response } from "express";
import { getConn } from "../../../../res/oracleDbConnect";
import { execDynamicProc } from "../../../../res/helperFunction";
import { buildInvoiceHtmlAMKSA, buildInvoiceHtmlBTIND, InvoiceMeta, InvoiceRow } from "./render_html";

const report = {
  AMKSA: {
    parameter: "INVOICE_AMKSA",
    template: "AMKSA", // used to pick which html builder to use
  },
  BTIND: {
    parameter: "INVOICE_AMKSA",
    template: "BTIND", // used to pick which html builder to use
  }
  // Add more company codes here, each pointing at its own template key
  // e.g. XYZCO: { parameter: 'INVOICE_XYZCO', template: 'XYZCO' }
};

const templateBuilders: Record<string, (rows: InvoiceRow[], meta: InvoiceMeta) => string> = {
  AMKSA: buildInvoiceHtmlAMKSA,
  BTIND: buildInvoiceHtmlBTIND, // Assuming BTIND uses the same template as AMKSA for now
  // XYZCO: buildInvoiceHtmlXYZCO,
};

const invoice_report = async (req: Request, res: Response): Promise<void> => {
  const {
    prin_code,
    invoice_no,
    company_code,
    invoice_date,
    invoice_period,
    client_name,
    client_address,
    client_vat_no,
  }: {
    prin_code?: string;
    invoice_no?: string;
    company_code?: string;
    invoice_date?: string;
    invoice_period?: string;
    client_name?: string;
    client_address?: string;
    client_vat_no?: string;
  } = req.query;

  const conn = await getConn(req);
  console.log("Request Query Parameters:", { prin_code, invoice_no, company_code });

  const companyConfig = report[company_code as keyof typeof report];

  const result = await execDynamicProc<InvoiceRow>(conn, "PROC_BUILD_DYNAMIC_INVOICE", {
    parameter: companyConfig?.parameter || "",
    code1: company_code || "",
    code2: prin_code || "",
  });

  console.log("Dynamic SQL Result:", result);

  const templateKey = companyConfig?.template || "AMKSA";
  const buildHtml = templateBuilders[templateKey] || buildInvoiceHtmlAMKSA;

  const html = buildHtml(result, {
    invoiceNo: invoice_no,
    invoiceDate: invoice_date,
    invoicePeriod: invoice_period,
    clientName: client_name,
    clientAddress: client_address,
    clientVatNo: client_vat_no,
  });

  res.status(200).set("Content-Type", "text/html; charset=utf-8").send(html);
};

export default invoice_report;