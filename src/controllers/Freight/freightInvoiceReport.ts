import { Request, Response } from "express";
import { getConn } from "../../res/oracleDbConnect";
import { execDynamicProc } from "../../res/helperFunction";
import {
  buildInvoiceHtmlAMKSA,
  buildInvoiceHtmlBTIND,
  InvoiceMeta,
  InvoiceRow,
} from "../wms/reports/invoice_reports/render_html";

const templateBuilders: Record<string, (rows: InvoiceRow[], meta: InvoiceMeta) => string> = {
  AMKSA: buildInvoiceHtmlAMKSA,
  BTIND: buildInvoiceHtmlBTIND,
};

export const frtInvoiceReportHtml = async (req: Request, res: Response): Promise<void> => {
  const {
    prin_code,
    invoice_no,
    company_code,
    invoice_date,
    invoice_period,
    client_name,
    client_address,
    client_vat_no,
    report_type,
  } = req.query as Record<string, string | undefined>;

  if (!company_code || !prin_code || !invoice_no) {
    res.status(400).send("<h3>Company, principal, and invoice number are required.</h3>");
    return;
  }

  try {
    const connection = await getConn(req);
    const rows = await execDynamicProc<InvoiceRow>(
      connection,
      "PROC_BUILD_DYNAMIC_FRT_INVOICE",
      {
        parameter: "FREIGHT_INVOICE",
        code1: company_code,
        code2: prin_code,
        code3: invoice_no,
      }
    );

    if (!rows.length) {
      res.status(404).send("<h3>No Freight invoice report data was found for the selected invoice.</h3>");
      return;
    }

    const meta: InvoiceMeta = {
      invoiceNo: invoice_no,
      invoiceDate: invoice_date,
      invoicePeriod: invoice_period,
      clientName: client_name,
      clientAddress: client_address,
      clientVatNo: client_vat_no,
      reportType: report_type,
    };

    const templateKey = company_code === "BTIND" ? "BTIND" : "AMKSA";
    const buildHtml = templateBuilders[templateKey];
    const html = buildHtml(rows, meta);

    res.status(200).set("Content-Type", "text/html; charset=utf-8").send(html);
  } catch (error: any) {
    console.error("Freight invoice report error:", error);
    res.status(500).send(
      `<h3>Failed to generate Freight invoice report.</h3><p>${escapeHtml(
        error?.message || "Unknown error"
      )}</p>`
    );
  }
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

