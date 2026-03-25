import { Request, Response } from "express";
import { TsStnService } from "../../services/WMS/TsStn.service";
import { TsStndetailService } from "../../services/WMS/TsStndetail.service";
import { AppDataSource } from "../../database/connection";

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

    // Validate that STN has details with valid quantities
    console.log("🔍 Checking STN Details for STN_NO:", stnNo);
    const stnDetails = await TsStndetailService.findByStnNo({
      stn_no: Number(stnNo),
      company_code: companyCode,
    });

    if (!stnDetails || stnDetails.length === 0) {
      return res.status(400).json({
        success: false,
        message: `STN ${stnNo} has no details. Please create STN Details before processing.`,
      });
    }

    // Validate that at least one detail has valid qty_puom
    const validDetails = stnDetails.filter(
      (detail: any) => detail.qty_puom && detail.qty_puom > 0
    );

    if (validDetails.length === 0) {
      return res.status(400).json({
        success: false,
        message: `STN ${stnNo} details have invalid quantities. At least one detail must have qty_puom > 0. Found ${stnDetails.length} details with qty_puom = ${stnDetails[0]?.qty_puom || "NULL"}`,
      });
    }

    console.log(`✅ STN ${stnNo} has ${validDetails.length} valid details out of ${stnDetails.length}`);

    // Log before calling stored procedure
    console.log("📞 Calling SP_WM_TRANSFER_PROCESS with params:", {
      company_code: companyCode,
      prin_code: prinCode,
      stn_no: Number(stnNo),
      user_id: userId,
    });

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
    
    // Parse Oracle constraint errors
    let userFriendlyMessage = "Failed to process stock transfer";
    if (error.message && error.message.includes("QTYA_GREATOR_0")) {
      userFriendlyMessage = "STN Detail has invalid quantities. Ensure qty_puom (Primary UOM Quantity) is greater than 0";
    } else if (error.message && error.message.includes("ORA-02290")) {
      userFriendlyMessage = "Data constraint violation. Check that all required quantity fields are valid";
    }
    
    return res.status(500).json({
      success: false,
      message: userFriendlyMessage,
      error: error.message || "Internal server error",
    });
  }
};

export const updateStockTransfer = async (req: Request, res: Response) => {
  const queryRunner = AppDataSource.createQueryRunner();

  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const body = req.body;

    const companyCode = body.COMPANY_CODE || body.company_code;
    const stnNo = body.STN_NO || body.stn_no;

    if (!companyCode || !stnNo) {
      return res.status(400).json({
        success: false,
        message: "company_code and stn_no are required",
      });
    }

    // 🔍 Check STN exists
    const stn = await queryRunner.manager.query(
      `SELECT * FROM TS_STN WHERE COMPANY_CODE = :1 AND STN_NO = :2`,
      [companyCode, stnNo]
    );

    if (!stn.length) {
      return res.status(404).json({
        success: false,
        message: `STN ${stnNo} not found`,
      });
    }

    // 🚫 Prevent edit if confirmed
    if (stn[0].CONFIRMED === "Y") {
      return res.status(400).json({
        success: false,
        message: "Cannot edit confirmed stock transfer",
      });
    }

    // 🎯 Allowed fields to update (IMPORTANT)
    const allowedFields = [
      "PRIN_CODE",
      "DESCRIPTION",
      "STN_DATE",
      "ALLOCATED",
      "ALLOCATED_DATE",
      "CONFIRMED",
      "CONFIRMED_DATE",
      "REPLENISH_NO",
      "REPLENISH_DATE",
      "REMARKS",
      "OUT_JOB_NO",
      "COUNT_NO",
      "CANCEL",
      "TEST"
    ];

    const updates: string[] = [];
    const values: any[] = [];

    let index = 1;

    for (const key of allowedFields) {
      const lowerKey = key.toLowerCase();

      if (body[key] !== undefined || body[lowerKey] !== undefined) {
        const value = body[key] ?? body[lowerKey];

        updates.push(`${key} = :${index}`);
        values.push(value);
        index++;
      }
    }

    // ❌ Nothing to update
    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided for update",
      });
    }

    // 🧠 Always update audit fields
    updates.push(`USER_ID = :${index}`);
    values.push(body.USER_ID || body.user_id || "SYSTEM");
    index++;

    updates.push(`USER_DT = SYSDATE`);

    // WHERE params
    values.push(companyCode);
    values.push(stnNo);

    const query = `
      UPDATE TS_STN
      SET ${updates.join(", ")}
      WHERE COMPANY_CODE = :${index}
      AND STN_NO = :${index + 1}
    `;

    console.log("🧠 Dynamic Update Query:", query);
    console.log("📦 Values:", values);

    await queryRunner.manager.query(query, values);

    await queryRunner.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Stock transfer updated successfully",
    });

  } catch (error: any) {
    await queryRunner.rollbackTransaction();

    console.error("❌ Update Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update stock transfer",
      error: error.message,
    });
  } finally {
    await queryRunner.release();
  }
};