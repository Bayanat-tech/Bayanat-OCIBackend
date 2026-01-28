import { Request, Response } from "express";
import { TsStnService } from "../../services/WMS/TsStn.service";

/**
 * Confirm Stock Transfer
 * Calls SP_STOCK_TRANSFER_CONFIRM stored procedure
 */
export const confirmStockTransfer = async (req: Request, res: Response) => {
  try {
    const {
      COMPANY_CODE, company_code,
      PRINCIPAL_CODE, principal_code,
      STN_NO, stn_no
    } = req.body;

    // Normalize field names (handle both uppercase and lowercase)
    const companyCode = COMPANY_CODE || company_code;
    const principalCode = PRINCIPAL_CODE || principal_code;
    const stnNo = STN_NO || stn_no;

    // Validate required fields
    if (!companyCode || !principalCode || !stnNo) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: company_code, principal_code, stn_no",
      });
    }

    // Validate STN exists
    const stnExists = await TsStnService.checkStnExists({
      stn_no: Number(stnNo),
      company_code: companyCode,
    });

    if (!stnExists) {
      return res.status(404).json({
        success: false,
        message: `STN ${stnNo} not found for company ${companyCode}`,
      });
    }

    // Call stored procedure
    await TsStnService.confirmStockTransfer({
      company_code: companyCode,
      principal_code: principalCode,
      stn_no: Number(stnNo),
    });

    return res.status(200).json({
      success: true,
      message: "Stock transfer confirmed successfully",
      data: {
        company_code: companyCode,
        principal_code: principalCode,
        stn_no: stnNo,
      },
    });
  } catch (error: any) {
    console.error("Error confirming stock transfer:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to confirm stock transfer",
      error: error.message || "Internal server error",
    });
  }
};
