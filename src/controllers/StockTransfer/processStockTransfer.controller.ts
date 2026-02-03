import { Request, Response } from "express";
import { TsStnService } from "../../services/WMS/TsStn.service";

/**
 * Process Stock Transfer
 * Calls SP_WM_TRANSFER_PROCESS stored procedure
 */
export const processStockTransfer = async (req: Request, res: Response) => {
  try {
    const {
      COMPANY_CODE, company_code,
      PRIN_CODE, prin_code,
      STN_NO, stn_no,
      USER_ID, user_id
    } = req.body;

    // Normalize field names (handle both uppercase and lowercase)
    const companyCode = COMPANY_CODE || company_code;
    const prinCode = PRIN_CODE || prin_code;
    const stnNo = STN_NO || stn_no;
    const userId = USER_ID || user_id;

    // Validate required fields
    if (!companyCode || !prinCode || !stnNo || !userId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: company_code, prin_code, stn_no, user_id",
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
    await TsStnService.processStockTransfer({
      company_code: companyCode,
      prin_code: prinCode,
      stn_no: Number(stnNo),
      user_id: userId,
    });

    return res.status(200).json({
      success: true,
      message: "Stock transfer processed successfully",
      data: {
        company_code: companyCode,
        prin_code: prinCode,
        stn_no: stnNo,
        user_id: userId,
      },
    });
  } catch (error: any) {
    console.error("Error processing stock transfer:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to process stock transfer",
      error: error.message || "Internal server error",
    });
  }
};
