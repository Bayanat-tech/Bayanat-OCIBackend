import { Response } from "express";
import constants from "../../../../helpers/constants";
import { RequestWithTenant } from "../../../../middleware/tenant.middleware";
import { QueryExecutor } from "../../../../database/QueryExecutor";

//-------------- Outbound Job---------------
// Function to get details of an outbound job
export const getOutboundJob = async (req: RequestWithTenant, res: Response) => {
  try {
    const companyCode = req.user?.company_code;
    if (!companyCode) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
      return;
    }

    const { job_no } = req.params;
    console.log("inside getOutboundJob:", job_no);

    if (!job_no) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Job number is required",
      });
      return;
    }

    // Using Oracle query instead of Sequelize model
    const result = await QueryExecutor.execMaybe(
      `SELECT * FROM VW_TO_ORDER_DET WHERE JOB_NO = :job_no AND COMPANY_CODE = :company_code AND ROWNUM <= 1`,
      { job_no, company_code: companyCode }
    );

    const jobdata = result.rows?.[0] || null;

    // If no job data is found, send a 404 response with an error message
    if (!jobdata) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "JOB DATA " + constants.MESSAGES.DOES_NOT_EXISTS,
      });
      return;
    }

    // If job data is found, send a 200 response with the job data
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: jobdata,
    });
    return;
  } catch (error: unknown) {
    // Handle any errors that occur during the process
    const knownError = error as { message: string };
    console.error("Error in getOutboundJob:", knownError.message);
    res
      .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: knownError.message });
  }
};

export const getOutboundJobOrder = async (req: RequestWithTenant, res: Response) => {
  try {
    const companyCode = req.user?.company_code;
    if (!companyCode) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
      return;
    }

    const { job_no } = req.params;
    console.log("inside getOutboundJobOrder:", job_no);

    if (!job_no) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Missing required field: job_no",
      });
      return;
    }

    // Use tenant-aware helper instead of direct oracleDb.query
    const result = await QueryExecutor.executeRawQuery(
      `SELECT * FROM TO_ORDER WHERE JOB_NO = :job_no AND COMPANY_CODE = :company_code`,
      { job_no: { val: job_no }, company_code: { val: companyCode } }
    );

    const rows = result.rows || result || [];

    if (rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "JOB DATA " + constants.MESSAGES.DOES_NOT_EXISTS,
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: rows,
    });

  } catch (error: any) {
    console.error("Error fetching job order:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "An unexpected error occurred",
    });
  }
};