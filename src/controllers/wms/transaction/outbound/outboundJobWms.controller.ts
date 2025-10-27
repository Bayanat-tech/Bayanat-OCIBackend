import { Response } from "express"; // Importing the Response type from Express to type the response object in route handlers.
import constants from "../../../../helpers/constants"; // Importing constants, likely for status codes and messages.
import { RequestWithUser } from "../../../../interfaces/common.interface"; // Importing a custom interface for request objects that include user information.
import OrderDetail from "../../../../models/wms/transaction/outbound/toOrderDetail_wms.model"; // Importing the OrderDetail model for database operations related to order details.
import { sequelize } from "../../../../database/connection";
import { QueryTypes } from "sequelize";

//-------------- Outbound Job---------------
// Function to get details of an outbound job
export const getOutboundJob = async (req: RequestWithUser, res: Response) => {
  try {
    const { job_no } = req.params; // Extracting job number from request parameters
    console.log("inside getOutboundJob:", job_no); // Logging the job number for debugging
    // Query the database to find a job with the specified job number
    const jobdata = await OrderDetail.findOne({
      where: { job_no },
    });

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
    res
      .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: knownError.message });
  }
};

export const getOutboundJobOrder = async (req: RequestWithUser, res: Response) => {
  try {
    const { job_no } = req.params;
    console.log("inside getOutboundJobOrder:", job_no);
 
    const [results] = await sequelize.query(
      "SELECT * FROM TO_ORDER WHERE job_no = ?",
      {
        replacements: [job_no],
        type: QueryTypes.SELECT,
      }
    );
 
    if (!results || (Array.isArray(results) && results.length === 0)) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "JOB DATA " + constants.MESSAGES.DOES_NOT_EXISTS,
      });
      return;
    }
 
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: results,
    });
  } catch (error: unknown) {
    const knownError = error as { message: string };
    res
      .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: knownError.message });
  }
};
