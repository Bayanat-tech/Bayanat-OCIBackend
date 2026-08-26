import { Response } from "express";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { loadSalesDoc, parseDocParams } from "./common/db";
import { renderDnHtml } from "./dn/html";
import { buildDnExcelBuffer } from "./dn/excel";
import { renderInvoiceHtml } from "./invoice/html";
import { buildInvoiceExcelBuffer } from "./invoice/excel";

/**
 * Unified HTML handler – picks renderer by report type from URL / body.
 *
 * Routes:
 *   GET|POST  /api/reports/sales/:reportType
 *     reportType = SDN | SINVOICE  (aliases: DN, INV, INVOICE, …)
 *
 * Body / query:
 *   company_code  (optional if on req.user)
 *   doc_type      (optional – defaults to reportType)
 *   doc_no        (required)
 */
export const getSalesDocReportHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const { rows, cfg } = await loadSalesDoc(req);
    const loginId = req.user?.loginid ?? req.user?.username ?? "";

    let html: string;
    switch (cfg.kind) {
      case "SINVOICE":
        html = renderInvoiceHtml(rows, loginId);
        break;
      case "SDN":
      default:
        html = renderDnHtml(rows, loginId);
        break;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Sales Doc Report HTML error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate sales document report",
    });
  }
};

/**
 * Unified Excel export – same params as HTML.
 *
 * Routes:
 *   GET|POST  /api/reports/sales/:reportType/excel
 */
export const exportSalesDocReportExcel = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const { docNo, cfg } = parseDocParams(req);
    const { rows } = await loadSalesDoc(req);
    const loginId = req.user?.loginid ?? req.user?.username ?? "";

    let buffer: Buffer;
    switch (cfg.kind) {
      case "SINVOICE":
        buffer = buildInvoiceExcelBuffer(rows, loginId);
        break;
      case "SDN":
      default:
        buffer = buildDnExcelBuffer(rows, loginId);
        break;
    }

    const filename = `${cfg.kind.toLowerCase()}_${docNo || "report"}_${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("Sales Doc Report Excel error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to export sales document report",
    });
  }
};

/* -------------------------------------------------------------------------- */
/*  Backward-compatible aliases for existing SDN routes                       */
/* -------------------------------------------------------------------------- */

export const getSalesDNReportHtml = getSalesDocReportHtml;
export const exportSalesDNReportExcel = exportSalesDocReportExcel;
