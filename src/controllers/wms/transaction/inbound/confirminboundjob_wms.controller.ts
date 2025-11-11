import oracledb from "oracledb";
import { oracleDb } from "../../../../database/connection";
import { Response } from "express";
import constants from "../../../../helpers/constants";
import {
  ISearch,
  RequestWithUser,
} from "../../../../interfaces/common.interface";
import ConfirmInboundInboundWms from "../../../../models/wms/transaction/inbound/confirmInboundjob_wms.model";


/**
 * @function getconfirmInboundjob
 * @description Fetch a confirm inbound job record from Oracle
 */
export const getconfirmInboundjob = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const { prin_code, job_no } = req.query;
    const company_code = req.user.company_code;

    console.log("Fetching confirm inbound job:", { prin_code, job_no });

    // Use ORM model or a direct query — ORM remains unchanged here
    const confirminbound = await ConfirmInboundInboundWms.findOne({
      where: { prin_code, job_no, company_code },
    });

    if (!confirminbound) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Confirm Job " + constants.MESSAGES.DOES_NOT_EXISTS,
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: confirminbound,
    });
  } catch (error: unknown) {
    const knownError = error as { message: string };
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: knownError.message,
    });
  }
};

/**
 * @function confirmInboundjob
 * @description Executes Oracle UPDATE + Stored Procedure for inbound confirmation
 */
export const confirmInboundjob = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection: oracledb.Connection | null = null;

  try {
    console.log("Starting confirmInboundjob process...");
    const { job_no } = req.params;
    const { prin_code } = req.query;
    const { packdet_no } = req.body; // array of key numbers
    const company_code = req.user.company_code;
    const user_id = req.user.loginid;

    console.log("Job No:", job_no);
    console.log("Principal:", prin_code);
    console.log("Company Code:", company_code);
    console.log("Packdet Numbers:", packdet_no);

    connection = await oracleDb.getConnection();

    // Start a transaction
    await connection.execute("SAVEPOINT before_confirm");

    /**
     * Step 1️⃣: Update TT_BATCH
     * Convert IN (:array) handling properly in Oracle with binding.
     */
    if (Array.isArray(packdet_no) && packdet_no.length > 0) {
      const updateQuery = `
        UPDATE TT_BATCH
        SET SELECTED = 'Y'
        WHERE COMPANY_CODE = :company_code
          AND JOB_NO = :job_no
          AND PRIN_CODE = :prin_code
          AND KEY_NUMBER IN (${packdet_no.map((_, i) => `:key${i}`).join(", ")})
      `;

      const binds: Record<string, any> = {
        company_code,
        job_no,
        prin_code,
      };

      packdet_no.forEach((val: string, i: number) => {
        binds[`key${i}`] = val;
      });

      console.log("Executing TT_BATCH update...");
      await connection.execute(updateQuery, binds, { autoCommit: false });
      console.log("TT_BATCH update completed.");
    }

    /**
     * Step 2️⃣: Call the Oracle stored procedure
     * MySQL: CALL SP_WM_INB_PUTAWAY_CONFIRM(:a, :b, :c, NOW(), :d)
     * Oracle: BEGIN SP_WM_INB_PUTAWAY_CONFIRM(:a, :b, :c, SYSDATE, :d); END;
     */
    const callProc = `
      BEGIN
        SP_WM_INB_PUTAWAY_CONFIRM(:vs_company_code, :principal_code, :vs_job_no, SYSDATE, :vs_user);
      END;
    `;

    console.log("Calling stored procedure SP_WM_INB_PUTAWAY_CONFIRM...");
    await connection.execute(callProc, {
      vs_company_code: company_code,
      principal_code: prin_code,
      vs_job_no: job_no,
      vs_user: user_id,
    });

    // Commit all updates + procedure
    await connection.commit();
    console.log("Transaction committed successfully.");

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Job Confirmation successfully",
    });
  } catch (error: any) {
    console.error("Oracle Confirm Inbound Error:", error);

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback failed:", rollbackError);
      }
    }

    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message || "Error confirming inbound job.",
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error("Error closing Oracle connection:", closeError);
      }
    }
  }
};
