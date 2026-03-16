import { Response } from "express";
import constants from "../../../../helpers/constants";
import {
  ISearch,
  RequestWithUser,
} from "../../../../interfaces/common.interface";
import { ConfirmInboundjobService } from "../../../../services/WMS/confirmInboundjob.service";
import { executeRaw } from "../../../../services/WMS/tenant-service.helper";
// import ConfirmInboundInboundWms from "../../../../models/wms/transaction/inbound/confirmInboundjob_wms.model";


/**
 * @function getconfirmInboundjob
 * @description Fetch a confirm inbound job record from Oracle using TypeORM
 */
export const getconfirmInboundjob = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const { prin_code, job_no } = req.query;
    const company_code = req.user.company_code;

    console.log("Fetching confirm inbound job:", { prin_code, job_no });

    // Use TypeORM service
    const confirminbound = await ConfirmInboundjobService.findByJobNo(
      prin_code as string,
      job_no as string,
      company_code
    );

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
  try {
    console.log("Starting confirmInboundjob process...");
    const { job_no } = req.params;
    const { prin_code } = req.query;
    const company_code = req.user.company_code;
    const user_id = req.user.loginid;

    console.log("Job No:", job_no);
    console.log("Principal:", prin_code);
    console.log("Company Code:", company_code);

    /**
     * Step 1️⃣: Update TT_BATCH - Using schema-qualified name to avoid synonym issues
     */
    const updateQuery = `
      UPDATE TT_BATCH
      SET CONFIRMED = 'N',
          SELECTED = 'Y',
          ALLOCATED = 'Y'
      WHERE JOB_NO = :job_no
    `;

    console.log('Executing TT_BATCH update...');
    console.log('Update Query:', updateQuery);
    console.log('Parameters:', { job_no });
    try {
      await executeRaw(updateQuery, { job_no });
      console.log("TT_BATCH update completed successfully.");
    } catch (updateError: any) {
      console.error("TT_BATCH update failed:", updateError);
      throw new Error(`Failed to update TT_BATCH: ${updateError.message}`);
    }

    /**
     * Step 2️⃣: Call the Oracle stored procedure
     */
    const callProc = `
      BEGIN
        SP_PUTAWAY_CONFIRM_NORMAL(:vs_company_code, :principal_code, :vs_job_no, SYSDATE);
      END;
    `;

    console.log("Calling stored procedure SP_PUTAWAY_CONFIRM_NORMAL...");
    console.log('Procedure Call:', callProc);
    console.log('Procedure Parameters:', {
      vs_company_code: company_code,
      principal_code: prin_code,
      vs_job_no: job_no,
    });
    
    try {
      await executeRaw(callProc, {
        vs_company_code: company_code,
        principal_code: prin_code,
        vs_job_no: job_no,
      });
      console.log("Stored procedure executed successfully.");
    } catch (procError: any) {
      console.error("Stored procedure execution failed:", procError);
      throw new Error(`Failed to call SP_PUTAWAY_CONFIRM_NORMAL: ${procError.message}`);
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Job Confirmation successfully",
    });
  } catch (error: any) {
    console.error("Oracle Confirm Inbound Error:", error);
    
    // Better error message for synonym translation errors
    let errorMessage = error.message || "Error confirming inbound job.";
    if (error.message?.includes('ORA-00980')) {
      errorMessage = `Synonym translation invalid. Ensure TT_BATCH and SP_PUTAWAY_CONFIRM_NORMAL are available in the current schema. Error: ${error.message}`;
    }

    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: errorMessage,
    });
  }
};
