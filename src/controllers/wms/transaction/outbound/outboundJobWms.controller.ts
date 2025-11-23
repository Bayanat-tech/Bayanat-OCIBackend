// import { Response } from "express"; // Importing the Response type from Express to type the response object in route handlers.
// import constants from "../../../../helpers/constants"; // Importing constants, likely for status codes and messages.
// import { RequestWithUser } from "../../../../interfaces/common.interface"; // Importing a custom interface for request objects that include user information.
// import OrderDetail from "../../../../models/wms/transaction/outbound/toOrderDetail_wms.model"; // Importing the OrderDetail model for database operations related to order details.
// import oracledb, { BindParameters, ExecuteOptions, Connection } from "oracledb";
// import { oracleDb } from "../../../../database/connection"; // make sure this exports oracledb.getConnection()
// import { QueryTypes } from "sequelize";

// //-------------- Outbound Job---------------
// // Function to get details of an outbound job
// export const getOutboundJob = async (req: RequestWithUser, res: Response) => {
//   try {
//     const { job_no } = req.params; // Extracting job number from request parameters
//     console.log("inside getOutboundJob:", job_no); // Logging the job number for debugging
//     // Query the database to find a job with the specified job number
//     const jobdata = await OrderDetail.findOne({
//       where: { job_no },
//     });

//     // If no job data is found, send a 404 response with an error message
//     if (!jobdata) {
//       res.status(constants.STATUS_CODES.NOT_FOUND).json({
//         success: false,
//         message: "JOB DATA " + constants.MESSAGES.DOES_NOT_EXISTS,
//       });
//       return;
//     }

//     // If job data is found, send a 200 response with the job data
//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       data: jobdata,
//     });
//     return;
//   } catch (error: unknown) {
//     // Handle any errors that occur during the process
//     const knownError = error as { message: string };
//     res
//       .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
//       .json({ success: false, message: knownError.message });
//   }
// };

// export const getOutboundJobOrder = async (req: RequestWithUser, res: Response) => {
//   let connection: Connection | undefined;

//   try {
//     const { job_no } = req.params;
//     console.log("inside getOutboundJobOrder:", job_no);

//     if (!job_no) {
//       res.status(constants.STATUS_CODES.BAD_REQUEST).json({
//         success: false,
//         message: "Missing required field: job_no",
//       });
//       return;
//     }

//     // 🔹 Get Oracle DB connection
//     connection = await oracleDb.getConnection();

//     // 🔹 Oracle query using bind variable
//     const query = `
//       SELECT *
//       FROM TO_ORDER
//       WHERE JOB_NO = :job_no
//     `;

//     const result = await connection.execute(
//       query,
//       { job_no },
//       { outFormat: oracledb.OUT_FORMAT_OBJECT } // return rows as objects
//     );

//     const rows = result.rows ?? [];

//     if (rows.length === 0) {
//       res.status(constants.STATUS_CODES.NOT_FOUND).json({
//         success: false,
//         message: "JOB DATA " + constants.MESSAGES.DOES_NOT_EXISTS,
//       });
//       return;
//     }

//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       data: rows,
//     });

//   } catch (error: any) {
//     console.error("Error fetching job order:", error);
//     res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
//       success: false,
//       message: error?.message || "An unexpected error occurred",
//     });
//   } finally {
//     if (connection) {
//       try {
//         await connection.close();
//       } catch (closeErr) {
//         console.error("Error closing Oracle connection:", closeErr);
//       }
//     }
//   }
// };
