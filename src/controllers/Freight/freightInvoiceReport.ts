import { Request, Response } from "express";
import { getConn } from "../../res/oracleDbConnect";
import { execDynamicProc } from "../../res/helperFunction";
import {
  buildFreightInvoiceHtmlAMKSA,
  buildFreightInvoiceHtmlBTIND,
  FreightInvoiceMeta,
  FreightInvoiceRow,
} from "./freightInvoiceRenderHtml";

const templateBuilders: Record<string, (rows: FreightInvoiceRow[], meta: FreightInvoiceMeta) => string> = {
  AMKSA: buildFreightInvoiceHtmlAMKSA,
  BTIND: buildFreightInvoiceHtmlBTIND,
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

  let connection: any;
  try {
    connection = await getConn(req);
    const rawRows = await execDynamicProc<FreightInvoiceRow>(
      connection,
      "PROC_BUILD_DYNAMIC_FRT_INVOICE",
      {
        parameter: "FREIGHT_INVOICE",
        code1: company_code,
        code2: prin_code,
        code3: invoice_no,
      }
    );

    if (!rawRows.length) {
      res.status(404).send("<h3>No Freight invoice report data was found for the selected invoice.</h3>");
      return;
    }

    // Query official company name and logo from MS_COMPANY
    let officialCompanyName = "";
    let officialCompanyLogo = "";
    try {
      const oracledb = await import("oracledb");
      const compRes = await connection.execute(
        `SELECT company_name, company_logo FROM MS_COMPANY WHERE company_code = :company_code`,
        { company_code },
        { outFormat: oracledb.default?.OUT_FORMAT_OBJECT || oracledb.OUT_FORMAT_OBJECT }
      );
      if (compRes.rows && compRes.rows.length > 0) {
        officialCompanyName = (compRes.rows[0] as any).COMPANY_NAME || "";
        officialCompanyLogo = (compRes.rows[0] as any).COMPANY_LOGO || "";
      }
    } catch (_) {}

    // Pick preferred company address info (matches invoice currency or country = 'OMAN')
    const preferredCompany = rawRows.find((r: any) =>
      String(r.country).toUpperCase() === "OMAN" ||
      (r.curr_code && r.currency && String(r.currency).toUpperCase() === String(r.curr_code).toUpperCase()) ||
      String(r.company_name).trim().toUpperCase() === "AAA LOGISTICS"
    ) || rawRows[0];

    // Deduplicate lines by (srno, act_code)
    const seenLines = new Set<string>();
    const rows: FreightInvoiceRow[] = [];
    for (const r of rawRows) {
      const lineKey = `${r.srno ?? ""}|${r.act_code ?? ""}|${r.inv_desc ?? (r as any).activity ?? ""}`;
      if (!seenLines.has(lineKey)) {
        seenLines.add(lineKey);
        rows.push({
          ...r,
          company_name: officialCompanyName || preferredCompany.company_name || r.company_name,
          company_logo: officialCompanyLogo || preferredCompany.company_logo || r.company_logo,
          address1: preferredCompany.address1 || r.address1,
          address2: preferredCompany.address2 || r.address2,
          address3: preferredCompany.address3 || r.address3,
          city: preferredCompany.city || r.city,
          country: preferredCompany.country || r.country,
          tel_no: preferredCompany.tel_no || r.tel_no,
          email: preferredCompany.email || r.email,
          crn: preferredCompany.crn || r.crn,
        });
      }
    }

    const meta: FreightInvoiceMeta = {
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
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (_) {}
    }
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

