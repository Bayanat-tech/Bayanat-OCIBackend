import { Response } from "express";
import { TsStnService } from "../../services/WMS/TsStn.service";
import { TsStndetailService } from "../../services/WMS/TsStndetail.service";
import { AppDataSource } from "../../database/connection";
import { RequestWithTenant } from "../../middleware/tenant.middleware";

/**
 * Process Stock Transfer
 * Calls SP_WM_TRANSFER_PROCESS stored procedure
 */

export const processStockTransfer = async (req: RequestWithTenant, res: Response) => {
  try {
    const companyCode = req.user?.company_code;
    if (!companyCode) {
      return res.status(400).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
    }

    const {
      PRIN_CODE, prin_code,
      STN_NO, stn_no,
      USER_ID, user_id
    } = req.body;

    const prinCode = PRIN_CODE || prin_code;
    const stnNo = STN_NO || stn_no;
    const userId = USER_ID || user_id;

    if (!prinCode || !stnNo || !userId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: prin_code, stn_no, user_id",
      });
    }

    const stnExists = await TsStnService.checkStnExists({
      stn_no: Number(stnNo),
      company_code: companyCode,
    });

    if (!stnExists) {
      return res.status(404).json({
        success: false,
        message: `STN ${stnNo} not found for your company`,
      });
    }

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

    console.log("📞 Calling SP_WM_TRANSFER_PROCESS with params:", {
      company_code: companyCode,
      prin_code: prinCode,
      stn_no: Number(stnNo),
      user_id: userId,
    });

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

export const updateStockTransfer = async (req: RequestWithTenant, res: Response) => {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const companyCode = req.user?.company_code;
    if (!companyCode) {
      await queryRunner.rollbackTransaction();
      return res.status(400).json({ success: false, message: "company_code not found on authenticated user" });
    }

    const body = req.body;
    const stnNo = body.STN_NO || body.stn_no;

    if (!stnNo) {
      await queryRunner.rollbackTransaction();
      return res.status(400).json({ success: false, message: "stn_no is required" });
    }

    const stn = await queryRunner.manager.query(
      `SELECT * FROM TS_STN WHERE COMPANY_CODE = :1 AND STN_NO = :2`,
      [companyCode, stnNo]
    );

    if (!stn.length) {
      await queryRunner.rollbackTransaction();
      return res.status(404).json({ success: false, message: `STN ${stnNo} not found` });
    }

    if (stn[0].CONFIRMED === "Y") {
      await queryRunner.rollbackTransaction();
      return res.status(400).json({ success: false, message: "Cannot edit confirmed stock transfer" });
    }

    const dateFields = new Set([
      "MFG_DATE_FROM", "MFG_DATE_TO",
      "EXP_DATE_FROM", "EXP_DATE_TO",
      "STN_DATE", "ALLOCATED_DATE",
      "CONFIRMED_DATE", "REPLENISH_DATE"
    ]);

    // ── HEADER UPDATE (TS_STN) ──────────────────────────────────────────
    const headerFields = [
      "PRIN_CODE", "DESCRIPTION", "STN_DATE", "ALLOCATED", "ALLOCATED_DATE",
      "CONFIRMED", "CONFIRMED_DATE", "REPLENISH_NO", "REPLENISH_DATE",
      "REMARKS", "OUT_JOB_NO", "COUNT_NO", "CANCEL", "TEST"
    ];

    const headerUpdates: string[] = [];
    const headerValues: any[] = [];
    let idx = 1;

    for (const key of headerFields) {
      const val = body[key] ?? body[key.toLowerCase()];
      if (val !== undefined) {
        if (dateFields.has(key) && val) {
          headerUpdates.push(`${key} = TO_DATE(:${idx++}, 'YYYY-MM-DD')`);
        } else {
          headerUpdates.push(`${key} = :${idx++}`);
        }
        headerValues.push(val);
      }
    }

    if (headerUpdates.length > 0) {
      headerUpdates.push(`USER_ID = :${idx++}`);
      headerValues.push(body.USER_ID || body.user_id || "SYSTEM");
      headerUpdates.push(`USER_DT = SYSDATE`);
      headerValues.push(companyCode, stnNo);

      const headerQuery = `
        UPDATE TS_STN SET ${headerUpdates.join(", ")}
        WHERE COMPANY_CODE = :${idx} AND STN_NO = :${idx + 1}
      `;

      console.log("🧠 Header Query:", headerQuery);
      console.log("📦 Header Values:", headerValues);

      await queryRunner.manager.query(headerQuery, headerValues);
    }

    // ── DETAIL UPDATE (TS_STNDETAIL) ────────────────────────────────────
    const detailFields = [
      "FROM_SITE", "TO_SITE",
      "FROM_LOC_START", "FROM_LOC_END",
      "TO_LOC_START", "TO_LOC_END",
      "QTY_PUOM", "QTY_LUOM", "QUANTITY",
      "P_UOM", "L_UOM",
      "BATCH_NO_FROM", "BATCH_NO_TO",
      "LOT_NO_FROM", "LOT_NO_TO",
      "MFG_DATE_FROM", "MFG_DATE_TO",
      "EXP_DATE_FROM", "EXP_DATE_TO",
      "PALLET_ID_FROM", "PALLET_ID_TO",
      "JOB_NO", "PROD_CODE"
    ];

    const detailUpdates: string[] = [];
    const detailValues: any[] = [];
    let didx = 1;

    for (const key of detailFields) {
      const val = body[key] ?? body[key.toLowerCase()];
      if (val !== undefined) {
        if (dateFields.has(key) && val) {
          detailUpdates.push(`${key} = TO_DATE(:${didx++}, 'YYYY-MM-DD')`);
        } else {
          detailUpdates.push(`${key} = :${didx++}`);
        }
        detailValues.push(val);
      }
    }

    if (detailUpdates.length > 0) {
      detailUpdates.push(`USER_ID = :${didx++}`);
      detailValues.push(body.USER_ID || body.user_id || "SYSTEM");
      detailUpdates.push(`USER_DT = SYSDATE`);

      const keyNumber = body.KEY_NUMBER || body.key_number;

      if (!keyNumber) {
        await queryRunner.rollbackTransaction();
        return res.status(400).json({ success: false, message: "KEY_NUMBER required to update detail row" });
      }

      detailValues.push(companyCode, stnNo, keyNumber);

      const detailQuery = `
        UPDATE TS_STNDETAIL SET ${detailUpdates.join(", ")}
        WHERE COMPANY_CODE = :${didx}
          AND STN_NO = :${didx + 1}
          AND KEY_NUMBER = :${didx + 2}
      `;

      console.log("🧠 Detail Query:", detailQuery);
      console.log("📦 Detail Values:", detailValues);

      await queryRunner.manager.query(detailQuery, detailValues);
    }

    await queryRunner.commitTransaction();
    return res.status(200).json({ success: true, message: "Stock transfer updated successfully" });

  } catch (error: any) {
    await queryRunner.rollbackTransaction();
    console.error("❌ Update Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update stock transfer", error: error.message });
  } finally {
    await queryRunner.release();
  }
};

export const deleteStockTransfer = async (req: RequestWithTenant, res: Response) => {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const companyCode = req.user?.company_code;
    if (!companyCode) {
      await queryRunner.rollbackTransaction();
      return res.status(400).json({ success: false, message: "company_code not found on authenticated user" });
    }

    const body = req.body;
    const stnNo = body.STN_NO || body.stn_no;
    const keyNumber = body.KEY_NUMBER || body.key_number;

    if (!stnNo) {
      await queryRunner.rollbackTransaction();
      return res.status(400).json({ success: false, message: "stn_no is required" });
    }

    // 🔍 Check STN exists
    const stn = await queryRunner.manager.query(
      `SELECT * FROM TS_STN WHERE COMPANY_CODE = :1 AND STN_NO = :2`,
      [companyCode, stnNo]
    );

    if (!stn.length) {
      await queryRunner.rollbackTransaction();
      return res.status(404).json({ success: false, message: `STN ${stnNo} not found` });
    }

    // 🚫 Prevent delete if confirmed
    if (stn[0].CONFIRMED === "Y") {
      await queryRunner.rollbackTransaction();
      return res.status(400).json({ success: false, message: "Cannot delete confirmed stock transfer" });
    }

    if (keyNumber) {
      // ── DELETE SINGLE DETAIL ROW ─────────────────────────────────────
      const detail = await queryRunner.manager.query(
        `SELECT * FROM TS_STNDETAIL WHERE COMPANY_CODE = :1 AND STN_NO = :2 AND KEY_NUMBER = :3`,
        [companyCode, stnNo, keyNumber]
      );

      if (!detail.length) {
        await queryRunner.rollbackTransaction();
        return res.status(404).json({ success: false, message: `Detail row with KEY_NUMBER ${keyNumber} not found` });
      }

      await queryRunner.manager.query(
        `DELETE FROM TS_STNDETAIL WHERE COMPANY_CODE = :1 AND STN_NO = :2 AND KEY_NUMBER = :3`,
        [companyCode, stnNo, keyNumber]
      );

      await queryRunner.commitTransaction();
      return res.status(200).json({ success: true, message: `Detail row ${keyNumber} deleted successfully` });

    } else {
      // ── DELETE ENTIRE STN (header + all details) ─────────────────────
      await queryRunner.manager.query(
        `DELETE FROM TS_STNDETAIL WHERE COMPANY_CODE = :1 AND STN_NO = :2`,
        [companyCode, stnNo]
      );

      await queryRunner.commitTransaction();
      return res.status(200).json({ success: true, message: `STN ${stnNo} and all its details deleted successfully` });
    }

  } catch (error: any) {
    await queryRunner.rollbackTransaction();
    console.error("❌ Delete Error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete stock transfer", error: error.message });
  } finally {
    await queryRunner.release();
  }
};