import { Response } from "express";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { loadSalesDoc, parseDocParams } from "./common/db";
import { renderInvoiceHtml } from "./invoice/html";
import { buildInvoiceExcelBuffer } from "./invoice/excel";

/**
 * Unified HTML handler – picks renderer by report type from URL / body.
 *
 * Routes:
 *   GET|POST  /api/reports/sales/:reportType
 *     reportType = SINVOICE  (aliases: INV, INVOICE, SI, …)
 *
 * Note: SDN (Sales Delivery Note) now has its own standalone controller
 * (SalesDnReport.ts) and is no longer handled here.
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

    if (cfg.kind !== "SINVOICE") {
      res.status(400).json({
        success: false,
        message: `Unsupported report type "${cfg.kind}" for this endpoint.`,
      });
      return;
    }

    const html = renderInvoiceHtml(rows, loginId);

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

    if (cfg.kind !== "SINVOICE") {
      res.status(400).json({
        success: false,
        message: `Unsupported report type "${cfg.kind}" for this endpoint.`,
      });
      return;
    }

    const buffer = buildInvoiceExcelBuffer(rows, loginId);

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