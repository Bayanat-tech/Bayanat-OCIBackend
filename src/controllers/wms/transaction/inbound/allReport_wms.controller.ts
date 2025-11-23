// // Import required dependencies
// import { Response } from "express";
// import { RequestWithUser } from "../../../../interfaces/common.interface";
// import constants from "../../../../helpers/constants";
// import { IUser } from "../../../../interfaces/user.interface";
// import { Op } from "sequelize";
// import { getSearchFilterQuery } from "../../../../helpers/functions";
// import { ISearch } from "../../../../interfaces/common.interface";
// import reportmaster from "../../../../models/Security/ReportModule_security.model";
// /**
//  * Get All Reports Controller
//  * This controller handles retrieving all inbound reports for a specific company
//  * @param req - Express request object with user details
//  * @param res - Express response object
//  */
// export const getAllReports = async (req: RequestWithUser, res: Response) => {
//   try {
//     // Parse filter from query parameters or use empty object
//     const filter: ISearch = req.query.filter
//       ? JSON.parse(req.query.filter)
//       : {};

//     // Get authenticated user details
//     const requestUser: IUser = await req.user;

//     // Initialize query parameters
//     let insideQuery: any = [],
//       outsideQuery = {
//         [Op.and]: [
//           { company_code: requestUser.company_code }, // Filter by company code
//           { module: "inbound" }, // Filter for inbound module only
//         ],
//       };

//     // Apply search filters to query
//     outsideQuery = getSearchFilterQuery({
//       insideQuery,
//       filter: filter.search,
//       outsideQuery,
//     });

//     // Get total count of matching records
//     const totalCount = await reportmaster.count({ where: outsideQuery });

//     // Fetch all matching reports with sorting if specified
//     const inboundAllReports = await reportmaster.findAll({
//       where: outsideQuery,
//       ...(!!filter?.sort &&
//         Object.keys(filter?.sort).length > 0 && {
//           order: [[filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"]],
//         }),
//     });

//     // Return success response with data
//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       totalCount,
//       data: inboundAllReports,
//     });
//   } catch (error: any) {
//     // Handle errors and return error response
//     res.status(constants.STATUS_CODES.BAD_REQUEST).json({
//       success: false,
//       message: error.message,
//     });
//     return;
//   }
// };

// export const getAllOutboundReports = async (
//   req: RequestWithUser,
//   res: Response
// ) => {
//   try {
//     // Parse filter from query parameters or use empty object
//     const filter: ISearch = req.query.filter
//       ? JSON.parse(req.query.filter)
//       : {};

//     // Get authenticated user details
//     const requestUser: IUser = await req.user;

//     // Initialize query parameters
//     let insideQuery: any = [],
//       outsideQuery = {
//         [Op.and]: [
//           { company_code: requestUser.company_code }, // Filter by company code
//           { module: "outbound" }, // Filter for outbound module only
//         ],
//       };

//     // Apply search filters to query
//     outsideQuery = getSearchFilterQuery({
//       insideQuery,
//       filter: filter.search,
//       outsideQuery,
//     });

//     // Get total count of matching records
//     const totalCount = await reportmaster.count({ where: outsideQuery });

//     // Fetch all matching reports with sorting if specified
//     const inboundAllReports = await reportmaster.findAll({
//       where: outsideQuery,
//       ...(!!filter?.sort &&
//         Object.keys(filter?.sort).length > 0 && {
//           order: [[filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"]],
//         }),
//     });

//     // Return success response with data
//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       totalCount,
//       data: inboundAllReports,
//     });
//   } catch (error: any) {
//     // Handle errors and return error response
//     res.status(constants.STATUS_CODES.BAD_REQUEST).json({
//       success: false,
//       message: error.message,
//     });
//     return;
//   }
// };

// export const getAllDynamicReports = async (
//   req: RequestWithUser,
//   res: Response
// ) => {
//   try {
//     // Parse filter from query parameters or use empty object
//     const filter: ISearch = req.query.filter
//       ? JSON.parse(req.query.filter)
//       : {};
//     const module = req.query.module as string;
//     const reportname = req.query.reportname as string;

//     // Get authenticated user details
//     const requestUser: IUser = await req.user;

//     // Initialize query parameters
//     let insideQuery: any = [],
//       outsideQuery = {
//         [Op.and]: [
//           { company_code: requestUser.company_code },
//           ...(module ? [{ module }] : []),
//           ...(reportname ? [{ reportname }] : []),
//         ],
//       };

//     // Apply search filters to query
//     outsideQuery = getSearchFilterQuery({
//       insideQuery,
//       filter: filter.search,
//       outsideQuery,
//     });

//     // Get total count of matching records
//     const totalCount = await reportmaster.count({ where: outsideQuery });

//     // Fetch all matching reports with sorting if specified
//     const inboundAllReports = await reportmaster.findAll({
//       where: outsideQuery,
//       ...(!!filter?.sort &&
//         Object.keys(filter?.sort).length > 0 && {
//           order: [[filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"]],
//         }),
//     });

//     // Return success response with data
//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       totalCount,
//       data: inboundAllReports,
//     });
//   } catch (error: any) {
//     // Handle errors and return error response
//     res.status(constants.STATUS_CODES.BAD_REQUEST).json({
//       success: false,
//       message: error.message,
//     });
//     return;
//   }
// };

// export const getAllVendorReports = async (
//   req: RequestWithUser,
//   res: Response
// ) => {
//   try {
//     // Parse filter from query parameters or use empty object
//     const filter: ISearch = req.query.filter
//       ? JSON.parse(req.query.filter)
//       : {};

//     // Get authenticated user details
//     const requestUser: IUser = await req.user;

//     // Initialize query parameters
//     let insideQuery: any = [],
//       outsideQuery = {
//         [Op.and]: [
//           { company_code: requestUser.company_code }, // Filter by company code
//           { module: "vendor" }, // Filter for vendor module only
//         ],
//       };

//     // Apply search filters to query
//     outsideQuery = getSearchFilterQuery({
//       insideQuery,
//       filter: filter.search,
//       outsideQuery,
//     });

//     // Get total count of matching records
//     const totalCount = await reportmaster.count({ where: outsideQuery });

//     // Fetch all matching reports with sorting if specified
//     const inboundAllReports = await reportmaster.findAll({
//       where: outsideQuery,
//       ...(!!filter?.sort &&
//         Object.keys(filter?.sort).length > 0 && {
//           order: [[filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"]],
//         }),
//     });

//     // Return success response with data
//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       totalCount,
//       data: inboundAllReports,
//     });
//   } catch (error: any) {
//     // Handle errors and return error response
//     res.status(constants.STATUS_CODES.BAD_REQUEST).json({
//       success: false,
//       message: error.message,
//     });
//     return;
//   }
// };

// export const getAllEmployeeReports = async (
//   req: RequestWithUser,
//   res: Response
// ) => {
//   try {
//     // Parse filter from query parameters or use empty object
//     const filter: ISearch = req.query.filter
//       ? JSON.parse(req.query.filter)
//       : {};

//     // Get authenticated user details
//     const requestUser: IUser = await req.user;

//     // Initialize query parameters
//     let insideQuery: any = [],
//       outsideQuery = {
//         [Op.and]: [
//           { company_code: requestUser.company_code }, // Filter by company code
//           { module: "Employee" }, // Filter for Employee module only
//         ],
//       };

//     // Apply search filters to query
//     outsideQuery = getSearchFilterQuery({
//       insideQuery,
//       filter: filter.search,
//       outsideQuery,
//     });

//     // Get total count of matching records
//     const totalCount = await reportmaster.count({ where: outsideQuery });

//     // Fetch all matching reports with sorting if specified
//     const inboundAllReports = await reportmaster.findAll({
//       where: outsideQuery,
//       ...(!!filter?.sort &&
//         Object.keys(filter?.sort).length > 0 && {
//           order: [[filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"]],
//         }),
//     });

//     // Return success response with data
//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       totalCount,
//       data: inboundAllReports,
//     });
//   } catch (error: any) {
//     // Handle errors and return error response
//     res.status(constants.STATUS_CODES.BAD_REQUEST).json({
//       success: false,
//       message: error.message,
//     });
//     return;
//   }
// };
