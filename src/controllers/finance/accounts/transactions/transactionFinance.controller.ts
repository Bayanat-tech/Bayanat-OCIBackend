// Core Dependencies
import { Response } from "express"; // Express response handling
import * as fastCsv from "fast-csv"; // CSV processing library
//import { Op } from "sequelize"; // Sequelize operators
//import { sequelize } from "../../../../database/connection"; // Database connection
import oracledb, { getConnection } from "oracledb";

// Helper Functions and Constants
import constants from "../../../../helpers/constants"; // Application constants
import {
  chequePaymentReportFormat, // Format cheque payment reports
  getSearchFilterQuery, // Build search filter queries
} from "../../../../helpers/functions";

// Common Interfaces
import {
  IFiles, // File handling interface
  ISearch, // Search parameters interface
  RequestWithUser, // Extended request with user context
} from "../../../../interfaces/common.interface";

// Transaction-specific Interfaces
import {
  ITrAcInvdetail, // Invoice detail interface
  ITransactionExpenseDetail, // Expense detail interface
  ITransactionJobDetail, // Job detail interface
  TTransactionDetail, // Transaction detail type
} from "../../../../interfaces/finance/accounts/transactions/chequePaymentTransaction.interface";

import { IUser } from "../../../../interfaces/user.interface"; // User interface

// File Management Model
//import Files from "../../../../models/files.model"; // File storage model

// // Account and Finance Models
// import Account from "../../../../models/finance/accounts/masters/account_finance.model"; // Main account model
// import AccountLevelFour from "../../../../models/finance/accounts/masters/account_level_four.model"; // Level 4 account

// Transaction-related Models
// import ChequePaymentReport from "../../../../models/finance/accounts/transactions/cheque_payment_report.model"; // Payment reports
// import MS_AC_BANKCODE from "../../../../models/finance/accounts/transactions/ms_ac_bankcode.model"; // Bank codes
// import AccountSetupDoc from "../../../../models/finance/accounts/transactions/ms_ac_setup_doc.model"; // Account setup
// import TransactionHeader from "../../../../models/finance/accounts/transactions/tranasctionHeader_account.model"; // Transaction headers
// import TransactionDetail from "../../../../models/finance/accounts/transactions/transactionDetailAccounts.model"; // Transaction details
// import TransactionExpenseDetail from "../../../../models/finance/accounts/transactions/transactionExpenseDetail.model"; // Expense details
// import TransactionInvoiceDetail from "../../../../models/finance/accounts/transactions/transactionInvoiceDetail.model"; // Invoice details
// import TransactionJobDetail from "../../../../models/finance/accounts/transactions/transactionJobDetail.model"; // Job details

// WMS (Warehouse Management System) Models
import Accountsetup from "../../../../models/wms/accountsetup_wms.model"; // WMS account configuration
import Currency from "../../../../models/wms/currency_wms.model"; // Currency management
import Department from "../../../../models/wms/department_wms.model"; // Department data
import Division from "../../../../models/wms/division_wms.model"; // Division information
import MsCompanyInfo from "../../../../models/wms/reports/stockCriteria/ms_company_info.interface"; // Company information

// Utilities and Validation
import FinanceCsvHeaders from "../../../../utils/exportCsv/FinanceCsvHeaders"; // CSV export headers
import { chequePaymentSchema } from "../../../../validation/finance/accounts/transaction.validation"; // Validation schema
import VW_AC_HEADER_SEARCH from "../../../../views/finance/accounts/transactions/ac_header_search.view"; // Search view

//-------------------get---------------
/**
 * Retrieves default transaction details based on document setup
 * @param req Request containing document ID and edit mode flag
 * @param res HTTP Response object
 */

// export const getDefaultTransactionDetails = async (
//   req: RequestWithUser,
//   res: Response
// ): Promise<void> => {
//   let connection;

//   try {
//     const { doc_id, isEditMode } = req.query;
//     const companyCode = req.user.company_code;

//     connection = await oracledb.getConnection();

//   // (AccountSetupDoc)
//     let selectFields = `
//       asd.company_code,
//       acs.tax_perc,
//       acs.lcur_decimal_nos
//     `;

//     // let joinClause = `
//     //   FROM MS_AC_SETUP_DOC asd
//     //   JOIN MS_AC_SETUP acs
//     //     ON asd.doc_id = acs.doc_id
//     // `;

//     let joinClause = `
//       FROM MS_AC_SETUP_DOC asd
//       LEFT JOIN MS_AC_SETUP acs
//         ON acs.company_code = asd.company_code
//        AND acs.ac_code = asd.ac_code
//     `;


//     // CONDITIONAL JOINS
//     if (isEditMode === "false") {
//       selectFields += `,
//         c.curr_code,
//         c.curr_name,
//         d.div_code,
//         d.div_name,
//         a.ac_code,
//         a.ac_name
//       `;

//       joinClause += `
//         LEFT JOIN MS_CURRENCY c
//           ON asd.curr_code = c.curr_code
//         LEFT JOIN MS_HR_DIVISION d
//           ON asd.div_code = d.div_code
//         LEFT JOIN MS_ACCODES a
//           ON asd.ac_code = a.ac_code
//       `;
//     }

//     const query = `
//       SELECT ${selectFields}
//       ${joinClause}
//       WHERE asd.company_code = :company_code
//         AND asd.doc_id = :doc_id
//     `;

//     const result = await connection.execute(
//       query,
//       {
//         company_code: companyCode,
//         doc_id,
//       },
//       { outFormat: oracledb.OUT_FORMAT_OBJECT }
//     );

   
//     if (!result.rows || result.rows.length === 0) {
//       res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
//         success: false,
//       });
//       return;
//     }

//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       data: result.rows[0],
//     });
//     return;

//   } catch (err) {
//     console.error(err);
//     res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
//       success: false,
//       message: "Error occurred while fetching data",
//     });
//     return;

//   } finally {
//     if (connection) {
//       await connection.close();
//     }
//   }
// };

export const getDefaultTransactionDetails = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection;
  
  try {
    // Extract query parameters for document identification and mode
    const { doc_id, isEditMode } = req.query;
    console.log(typeof isEditMode);

    // Get Oracle connection
    connection = await getConnection();

    /* Build SQL query based on edit mode
     * - In view mode (isEditMode === 'false'): Include all related tables with LEFT JOINs
     * - In edit mode: Only include account setup data
     * - Always includes company_code filter and document ID filter
     */
    let sql: string;
    
    if (isEditMode === 'false') {
      // View mode: Include all related data
      sql = `
        SELECT 
          asd.company_code,
          c.curr_code,
          c.curr_name,
          d.div_code,
          d.div_name,
          a.ac_code,
          a.ac_name,
          acs.tax_perc,
          acs.lcur_decimal_nos
        FROM MS_AC_SETUP_DOC asd
        LEFT JOIN MS_CURRENCY c ON asd.curr_code = c.curr_code
        LEFT JOIN MS_HR_DIVISION d ON asd.div_code = d.div_code
        LEFT JOIN MS_ACCODES a ON asd.ac_code = a.ac_code
        INNER JOIN MS_AC_SETUP acs ON asd.company_code = acs.company_code
        WHERE asd.company_code = :company_code
          AND asd.doc_id = :doc_id
      `;
    } else {
      // Edit mode: Only account setup data
      sql = `
        SELECT 
          asd.company_code,
          acs.tax_perc,
          acs.lcur_decimal_nos
        FROM MS_AC_SETUP_DOC asd
        INNER JOIN MS_AC_SETUP acs ON asd.company_code = acs.company_code
        WHERE asd.company_code = :company_code
          AND asd.doc_id = :doc_id
      `;
    }

    // Execute query with bind parameters
    const result = await connection.execute(
      sql,
      {
        company_code: req.user.company_code,
        doc_id: doc_id as string
      },
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT 
      }
    );

    if (!result.rows || result.rows.length === 0) {
      res.status(500).json({ success: false });
      return;
    }

    // Transform the result to match Sequelize structure
    const row = result.rows?.[0] as any;
    const response = isEditMode === 'false' 
      ? {
          company_code: row.COMPANY_CODE,
          Currency: {
            curr_code: row.CURR_CODE,
            curr_name: row.CURR_NAME
          },
          Division: {
            div_code: row.DIV_CODE,
            div_name: row.DIV_NAME
          },
          Account: {
            ac_code: row.AC_CODE,
            ac_name: row.AC_NAME
          },
          Accountsetup: {
            tax_perc: row.TAX_PERC,
            lcur_decimal_nos: row.LCUR_DECIMAL_NOS
          }
        }
      : {
          company_code: row.COMPANY_CODE,
          Accountsetup: {
            tax_perc: row.TAX_PERC,
            lcur_decimal_nos: row.LCUR_DECIMAL_NOS
          }
        };

    res.status(200).json({
      success: true,
      data: response
    });
    return;

  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({
      success: false,
      message: 'Error occurred while fetching data'
    });
    return;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error('Error closing connection:', err);
      }
    }
  }
};

/**
 * Retrieves company fiscal year information
 * @param req Request with user context
 * @param res HTTP Response object
 */
// export const getCompanyInfo = async (req: RequestWithUser, res: Response) => {
//   try {
//     // Query company information for fiscal year period with company-specific filter
//     const response = await MsCompanyInfo.findOne({
//       attributes: ["ac_fy_period"], // Select fiscal year period
//       where: {
//         [Op.and]: [{ company_code: req.user.company_code }], // Company filter
//       },
//     });

//     // Handle case where no data is found
//     if (!response) {
//       res
//         .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
//         .json({ success: false });
//       return;
//     }

//     // Return successful response with fiscal year data
//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       data: response,
//     });
//     return;
//   } catch (err) {
//     // Log and handle unexpected errors
//     console.error(err);
//     res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
//       success: false,
//       message: "Error occurred while fetching data",
//     });
//     return;
//   }
// };


export const getCompanyInfo = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  let connection;

  try {
    connection = await oracledb.getConnection();

    const result = await connection.execute(
      `
      SELECT ac_fy_period AS "ac_fy_period"
      FROM MS_COMPANYINFO
      WHERE company_code = :company_code
      `,
      {
        company_code: req.user.company_code,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!result.rows || result.rows.length === 0) {
      res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: result.rows[0],
    });

  } catch (err) {
    console.error(err);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Error occurred while fetching data",
    });
  } finally {
    if (connection) {
      await connection.close();
    }
  }
};


/**
 * Retrieves detailed cheque payment header information with related data
 * @param req Request containing document number and type
 * @param res HTTP Response object
 */
// export const getChequePaymentHeader = async (
//   req: RequestWithUser,
//   res: Response
// ) => {
//   try {
//     // Extract route parameters and query filters
//     const { doc_no } = req.params; // Document number from route
//     const { doc_type } = req.query; // Document type from query

//     // Query transaction header with comprehensive details
//     const response = await TransactionHeader.findOne({
//       // Select all relevant header fields
//       attributes: [
//         "doc_no", // Document identification
//         "doc_date", // Document date
//         "ac_code", // Account code
//         "bank_ac_code", // Bank account code
//         "cheque_no", // Cheque number
//         "cheque_date", // Cheque date
//         "remarks", // Transaction remarks
//         "ac_payee", // Payee information
//         "curr_code", // Currency code
//         "ex_rate", // Exchange rate
//         "div_code", // Division code
//         "doc_type", // Document type
//         "cheque_bank", // Bank information
//       ],
//       // Apply security and document filters
//       where: { company_code: req.user.company_code, doc_no, doc_type },
//       // Include related reference data
//       include: [
//         { model: Accountsetup, attributes: ["tax_perc"] }, // Tax settings
//         { model: Account, attributes: ["ac_name"] }, // Account details
//         {
//           model: MS_AC_BANKCODE, // Bank information
//           include: [{ model: Account, attributes: ["ac_name"] }], // Bank account name
//         },
//         { model: Currency, attributes: ["curr_name"] }, // Currency details
//         { model: Division, attributes: ["div_name"] }, // Division details
//       ],
//     });

//     // Return successful response with header data
//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       data: response,
//     });
//     return;
//   } catch (err) {
//     // Log and handle unexpected errors
//     console.error(err);
//     res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
//       success: false,
//       message: "Error occurred while fetching data",
//     });
//     return;
//   }
// };


export const getChequePaymentHeader = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  let connection;

  try {
    const { doc_no } = req.params;
    const { doc_type } = req.query;
    const companyCode = req.user.company_code;

    connection = await oracledb.getConnection();

    // Joins
    const query = `
      SELECT
        th.doc_no,
        th.doc_date,
        th.ac_code,
        th.bank_ac_code,
        th.cheque_no,
        th.cheque_date,
        th.remarks,
        th.ac_payee,
        th.curr_code,
        th.ex_rate,
        th.div_code,
        th.doc_type,
        th.cheque_bank,

        acs.tax_perc,

        acc.ac_name AS account_name,

        bank.ac_code AS bank_ac_code_ref,
        bankacc.ac_name AS bank_ac_name,

        cur.curr_name,
        div.div_name

      FROM TR_AC_HEADER th

      // Account setup 
      LEFT JOIN MS_AC_SETUP acs
        ON th.ac_code = acs.ac_code
       AND th.company_code = acs.company_code

      /* Account */
      LEFT JOIN MS_ACCODES acc
        ON th.ac_code = acc.ac_code

      /* Bank code */
      LEFT JOIN MS_AC_BANKCODE bank
        ON th.bank_ac_code = bank.bank_ac_code

      /* Bank account name */
      LEFT JOIN MS_ACCODES bankacc
        ON bank.ac_code = bankacc.ac_code

      LEFT JOIN MS_CURRENCY cur
        ON th.curr_code = cur.curr_code

      LEFT JOIN MS_HR_DIVISION div
        ON th.div_code = div.div_code

      WHERE th.company_code = :company_code
        AND th.doc_no = :doc_no
        AND th.doc_type = :doc_type
    `;

    const result = await connection.execute(
      query,
      {
        company_code: companyCode,
        doc_no,
        doc_type,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: result.rows?.[0] || null,
    });
    return;

  } catch (err) {
    console.error(err);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Error occurred while fetching data",
    });
    return;

  } finally {
    if (connection) {
      await connection.close();
    }
  }
};

/**
 * Retrieves detailed cheque payment information with related entities
 * @param req Request containing document number, division code, and document type
 * @param res HTTP Response object
 */
// export const getChequePaymentDetail = async (
//   req: RequestWithUser,
//   res: Response
// ) => {
//   try {
//     // Extract route parameters and query filters
//     const { doc_no } = req.params; // Document identifier
//     const { div_code, doc_type } = req.query; // Additional filters

//     // Query transaction details with security and business filters
//     const response = await TransactionDetail.findAll({
//       where: {
//         company_code: req.user.company_code, // Security: Company-specific access
//         doc_no, // Filter by document number
//         div_code, // Filter by division
//         doc_type, // Filter by document type
//       },
//       // Include related reference data
//       include: [
//         { model: Account, attributes: ["ac_name"] }, // Account information
//         { model: Department, attributes: ["dept_name"] }, // Department details
//         { model: Currency, attributes: ["curr_name"] }, // Currency information
//       ],
//     });

//     // Return successful response with transaction details
//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       data: response,
//     });
//     return;
//   } catch (err) {
//     // Log and handle unexpected errors
//     console.error(err);
//     res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
//       success: false,
//       message: "Error occurred while fetching data",
//     });
//     return;
//   }
// };


export const getChequePaymentDetail = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  let connection;

  try {
    const { doc_no } = req.params;
    const { div_code, doc_type } = req.query;
    const companyCode = req.user.company_code;

    connection = await oracledb.getConnection();

    // TransactionDetail 
  
    const query = `
      SELECT
        td.company_code,
        td.doc_no,
        td.doc_type,
        td.div_code,
        td.serial_no,
        td.ac_code,
        td.amount,
        td.lcur_amount,
        td.curr_code,
        td.dept_code,
        td.sign_ind,

        acc.ac_name,
        dept.dept_name,
        cur.curr_name

      FROM TR_AC_DETAIL td

      /* Account reference */
      LEFT JOIN MS_ACCODES acc
        ON td.ac_code = acc.ac_code

      /* Department reference */
      LEFT JOIN MS_DEPARTMENT dept
        ON td.dept_code = dept.dept_code

      /* Currency reference */
      LEFT JOIN MS_CURRENCY cur
        ON td.curr_code = cur.curr_code

      WHERE td.company_code = :company_code
        AND td.doc_no = :doc_no
        AND td.div_code = :div_code
        AND td.doc_type = :doc_type

      ORDER BY td.serial_no
    `;

    const result = await connection.execute(
      query,
      {
        company_code: companyCode,
        doc_no,
        div_code,
        doc_type,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );


    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: result.rows || [],
    });
    return;

  } catch (err) {
    console.error(err);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Error occurred while fetching data",
    });
    return;

  } finally {
    if (connection) {
      await connection.close();
    }
  }
};


// /**
//  * Determines the appropriate child table based on account properties
//  * @param req Request containing account code
//  * @param res HTTP Response object
//  */
// export const getChildTableName = async (
//   req: RequestWithUser,
//   res: Response
// ) => {
//   try {
//     // Extract and validate account code parameter
//     const { ac_code } = req.params;
//     if (!ac_code) {
//       res
//         .status(constants.STATUS_CODES.BAD_REQUEST)
//         .json({ success: false, message: constants.MESSAGES.BAD_REQUEST });
//       return;
//     }

//     // Query account data with level four configuration
//     const accountData: any = await Account.findOne({
//       where: { company_code: req.user.company_code, ac_code }, // Security filter
//       include: [{ model: AccountLevelFour, attributes: ["l4_job", "l4_bill"] }],
//     });

//     if (!!accountData) {
//       // Extract level four settings from response
//       const response = accountData.dataValues.AccountLevelFour.dataValues;

//       // Determine child table based on account configuration
//       const data =
//         response.l4_bill === "Y"
//           ? { table: "invoice", code: "" } // Invoice table
//           : response.l4_job === "Y"
//           ? { table: "job", code: "" } // Job table
//           : accountData.dataValues.exp_type_code !== null &&
//             accountData.dataValues.exp_subtype_code !== null && {
//               table: "expense", // Expense table
//               code: accountData.dataValues.exp_type_code,
//             };

//       // Validate child table assignment
//       if (!data) {
//         throw new Error("Does not have a child table");
//       }

//       // Return successful response with table information
//       res.status(constants.STATUS_CODES.OK).json({
//         success: true,
//         data,
//       });
//       return;
//     }
//   } catch (error: any) {
//     // Handle and return any errors
//     res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
//       success: false,
//       message: error.message,
//     });
//     return;
//   }
// };

// /**
//  * Retrieves the last cheque number for a specific account
//  * @param req Request containing account code
//  * @param res HTTP Response object
//  */
// export const getChequeDetail = async (req: RequestWithUser, res: Response) => {
//   try {
//     // Extract account code from query parameters
//     const { ac_code } = req.query;

//     // Query bank code information with security filter
//     const response = await MS_AC_BANKCODE.findOne({
//       attributes: ["last_cheque_no"], // Select last cheque number
//       where: {
//         [Op.and]: [
//           { company_code: req.user.company_code }, // Security: Company filter
//           { ac_code }, // Account filter
//         ],
//       },
//     });

//     // Return successful response with cheque details
//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       data: response,
//     });
//     return;
//   } catch (err) {
//     // Log and handle unexpected errors
//     console.error(err);
//     res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
//       success: false,
//       message: "Error occurred while fetching data",
//     });
//   }
// };
// /**
//  * Generates formatted cheque payment report with filtering and sorting
//  * @param req Request containing filter and sort parameters
//  * @param res HTTP Response object
//  */
// export const getChequePaymentReport = async (
//   req: RequestWithUser,
//   res: Response
// ) => {
//   try {
//     // Extract user context and parse filter parameters
//     const requestUser: IUser = req.user;
//     const filter: ISearch = req.query.filter
//       ? JSON.parse(req.query.filter) // Parse JSON filter if provided
//       : {};

//     // Initialize base query with company security filter
//     let outsideQuery = {
//       [Op.and]: [{ company_code: requestUser.company_code }],
//     };

//     // Apply additional search filters to query
//     outsideQuery = getSearchFilterQuery({
//       insideQuery: [],
//       filter: filter.search,
//       outsideQuery,
//     });

//     // Fetch cheque payment data with filters and optional sorting
//     const chequePaymentReport = await ChequePaymentReport.findAll({
//       where: outsideQuery,
//       // Add dynamic sorting if specified in filter
//       ...(!!filter?.sort &&
//         Object.keys(filter?.sort).length > 0 && {
//           order: [[filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"]],
//         }),
//     });

//     // Retrieve decimal precision configuration
//     let decimalLimit: any = await Accountsetup.findOne({
//       attributes: ["amount_decimal_nos"],
//       where: {
//         company_code: requestUser.company_code,
//       },
//     });

//     // Format report data with proper decimal places
//     let formattedCheckPaymentReport = chequePaymentReportFormat(
//       chequePaymentReport,
//       decimalLimit.amount_decimal_nos
//     );

//     // Return formatted report data
//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       data: formattedCheckPaymentReport,
//     });
//   } catch (error: any) {
//     // Handle and return any errors
//     res.status(constants.STATUS_CODES.BAD_REQUEST).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };

// /**
//  * Exports transaction documents to CSV format
//  * @param req Request with user context
//  * @param res HTTP Response object (CSV stream)
//  */
// export const exportTransactionDocument = async (
//   req: RequestWithUser,
//   res: Response
// ) => {
//   try {
//     // Initialize variables for data collection and CSV transformation
//     let fetchedData: any[] = [],
//       csvTransform: fastCsv.CsvFormatterStream<
//         fastCsv.FormatterRow,
//         fastCsv.FormatterRow
//       >;

//     // Fetch transaction data with company filter
//     fetchedData = await VW_AC_HEADER_SEARCH.findAll({
//       where: { company_code: req.user.company_code },
//     });

//     // Configure CSV formatter with predefined headers
//     csvTransform = fastCsv.format({
//       headers: FinanceCsvHeaders.ACCOUNTS.Documents,
//     });

//     // Set headers for CSV response before streaming
//     res.setHeader("Content-Type", "text/csv");
//     res.setHeader(
//       "Content-Disposition",
//       `attachment; filename="documents.csv"`
//     );

//     // Process and write each record to CSV stream
//     fetchedData.forEach((eachData) => {
//       const plainData = eachData.get({ plain: true });
//       csvTransform.write(plainData); // Write each row to the CSV stream
//     });

//     // Finalize and send CSV stream
//     csvTransform.end(); // Complete the CSV data transformation
//     csvTransform.pipe(res); // Pipe CSV data into the HTTP response
//   } catch (error: any) {
//     // Log and handle export errors
//     console.error("Export Error:", error);
//     res.status(400).json({ success: false, message: error.message });
//   }
// };

// /**
//  * Creates multiple transaction documents in bulk
//  * @param req Request containing transaction documents array
//  * @param res HTTP Response object
//  */
// export const createBulkTransactionDocument = async (
//   req: RequestWithUser,
//   res: Response
// ) => {
//   try {
//     const requestUser: IUser = req.user;

//     // Validate request data using schema
//     const { error } = chequePaymentSchema(
//       req.body,
//       requestUser.company_code,
//       true
//     );
//     if (error) {
//       res
//         .status(constants.STATUS_CODES.BAD_REQUEST)
//         .json({ success: false, message: error.message });
//       return;
//     }

//     // Add audit fields to each document
//     req.body = req.body.map((document: any) => ({
//       ...document,
//       updated_by: requestUser.loginid,
//       created_by: requestUser.loginid,
//     }));

//     // Bulk create transactions, ignoring duplicates
//     TransactionHeader.bulkCreate(req.body, { ignoreDuplicates: true });

//     // Return success response
//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       message: "Document " + constants.MESSAGES.IMPORTED_SUCCESSFULLY,
//     });
//     return;
//   } catch (error: any) {
//     // Handle and return any errors
//     res
//       .status(constants.STATUS_CODES.BAD_REQUEST)
//       .json({ success: false, message: error.message });
//     return;
//   }
// };

/**
 * Creates a new cheque payment document with associated details and attachments
 * @param req Request containing payment document data and related information
 * @param res HTTP Response object
 */
// export const createChequePaymentDocument = async (
//   req: RequestWithUser,
//   res: Response
// ) => {
//   try {
//     // Validate request payload against schema
//     const { error } = chequePaymentSchema(req.body);
//     if (error) {
//       res
//         .status(constants.STATUS_CODES.BAD_REQUEST)
//         .json({ success: false, message: error.message });
//       return;
//     }

//     let doc_no: any;
//     // Execute all operations within a transaction for data consistency
//     await sequelize.transaction(async (t) => {
//       // Generate unique document number using stored function
//       doc_no =
//         await sequelize.query(`select FN_AC_GET_DOC_NO( "${req.user.company_code}","${req.body.div_code}","${req.body.doc_type}","${req.body.doc_date}" ) from  dual;
//       `);

//       doc_no = Object.values(doc_no[0][0] as any)[0];
//       if (doc_no) {
//         // Destructure request body into components
//         let { detail, children, files, ...header } = req.body;

//         // Add document number to each detail record
//         detail = detail.map((eachDetail: TTransactionDetail) => ({
//           ...eachDetail,
//           doc_no,
//         }));

//         // Create main transaction header with audit fields
//         await TransactionHeader.create(
//           {
//             ...header,
//             doc_no,
//             company_code: req.user.company_code,
//             create_user: req.user.loginid,
//             create_date: new Date(),
//             created_by: req.user.loginid,
//             updated_by: req.user.loginid,
//           },
//           { transaction: t }
//         );

//         // Create transaction details in bulk
//         await TransactionDetail.bulkCreate(detail, { transaction: t });

//         // Process invoice-related children if present
//         if (children?.["invoice"] && children?.["invoice"].length > 0) {
//           // Add audit and document reference to each invoice record
//           children["invoice"] = children["invoice"].map(
//             (eachChildren: ITrAcInvdetail) => ({
//               ...eachChildren,
//               created_by: req.user.loginid,
//               updated_by: req.user.loginid,
//               doc_no,
//             })
//           );

//           // Create invoice details in bulk
//           await TransactionInvoiceDetail.bulkCreate(children["invoice"], {
//             transaction: t,
//           });
//         }

//         // Process job-related children if present
//         if (children?.["job"] && children?.["job"].length > 0) {
//           // Add audit and document reference to each job record
//           children["job"] = children["job"].map(
//             (eachChildren: ITrAcInvdetail) => ({
//               ...eachChildren,
//               created_by: req.user.loginid,
//               updated_by: req.user.loginid,
//               doc_no,
//             })
//           );
//           // Create job details in bulk
//           await TransactionJobDetail.bulkCreate(children["job"], {
//             transaction: t,
//           });
//         }

//         // Process expense-related children if present
//         if (children?.["expense"] && children?.["expense"].length > 0) {
//           // Add audit and document reference to each expense record
//           children["expense"] = children["expense"].map(
//             (eachChildren: ITransactionExpenseDetail) => ({
//               ...eachChildren,
//               created_by: req.user.loginid,
//               updated_by: req.user.loginid,
//               doc_no,
//             })
//           );
//           // Debug logging for expense data
//           console.log("\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n");
//           console.dir(children?.["expense"]);
//           console.log("\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n");

//           // Create expense details in bulk
//           await TransactionExpenseDetail.bulkCreate(children["expense"], {
//             transaction: t,
//           });
//         }

//         // Process attached files if present
//         if (!!files && files.length) {
//           // Create file records with document reference
//           await Files.bulkCreate(
//             (files as IFiles[]).map((eachFile) => {
//               return {
//                 ...eachFile,
//                 request_number: req.body.doc_type + doc_no, // Create unique file reference
//               };
//             }),
//             {
//               transaction: t,
//             }
//           );
//         }
//       }
//     });

//     // Return success response after transaction completion
//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       data: {
//         data: constants.MESSAGES.CREATED_SUCCESSFULLY,
//         doc_no: doc_no,
//         doc_type: req.body.doc_type,
//       },
//     });
//     return;
//   } catch (err) {
//     // Log and handle any errors during the process
//     console.error(err);
//     res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
//       success: false,
//       message: "Error occurred while fetching data :" + err,
//     });
//   }
// };


export const createChequePaymentDocument= async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  let connection;

  try {
    const { error } = chequePaymentSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message,
      });
      return;
    }

    connection = await oracledb.getConnection();

    let doc_no: number;

    // ---------- GET DOCUMENT NUMBER ---------- 
    const docResult = await connection.execute(
      `
      SELECT FN_AC_GET_DOC_NO(
        :company_code,
        :div_code,
        :doc_type,
        TO_DATE(:doc_date, 'YYYY-MM-DD')
      ) AS DOC_NO
      FROM dual
      `,
      {
        company_code: req.user.company_code,
        div_code: req.body.div_code,
        doc_type: req.body.doc_type,
        doc_date: req.body.doc_date,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    doc_no = (docResult.rows?.[0] as any)?.DOC_NO;

    if (!doc_no) {
      throw new Error("Failed to generate document number");
    }

    const { detail, children, files, ...header } = req.body;

    // ---------- INSERT HEADER ---------- 
    await connection.execute(
      `
      INSERT INTO TR_AC_HEADER (
        doc_no,
        company_code,
        create_user,
        create_date,
        created_by,
        updated_by,
        doc_type,
        div_code,
        doc_date
      ) VALUES (
        :doc_no,
        :company_code,
        :create_user,
        SYSDATE,
        :created_by,
        :updated_by,
        :doc_type,
        :div_code,
        TO_DATE(:doc_date, 'YYYY-MM-DD')
      )
      `,
      {
        ...header,
        doc_no,
        company_code: req.user.company_code,
        create_user: req.user.loginid,
        created_by: req.user.loginid,
        updated_by: req.user.loginid,
      }
    );

    // ---------- INSERT DETAILS ----------
    if (detail?.length) {
      await connection.executeMany(
        `
        INSERT INTO TR_AC_DETAIL (
          doc_no,
          amount,
          account_code
        ) VALUES (
          :doc_no,
          :amount,
          :account_code
        )
        `,
        detail.map((d: any) => ({
          ...d,
          doc_no,
        }))
      );
    }

    //  ---------- INVOICE  ---------- 
    if (children?.invoice?.length) {
      await connection.executeMany(
        `
        INSERT INTO TR_AC_INVDETAIL (
          doc_no,
          created_by,
          updated_by
        ) VALUES (
          :doc_no,
          :created_by,
          :updated_by
        )
        `,
        children.invoice.map((c: any) => ({
          ...c,
          doc_no,
          created_by: req.user.loginid,
          updated_by: req.user.loginid,
        }))
      );
    }

    //---------- JOB  ---------- 
    if (children?.job?.length) {
      await connection.executeMany(
        `
        INSERT INTO TR_AC_JOBDETAIL (
          doc_no,
          created_by,
          updated_by
        ) VALUES (
          :doc_no,
          :created_by,
          :updated_by
        )
        `,
        children.job.map((c: any) => ({
          ...c,
          doc_no,
          created_by: req.user.loginid,
          updated_by: req.user.loginid,
        }))
      );
    }

    if (children?.expense?.length) {
      await connection.executeMany(
        `
        INSERT INTO TR_AC_EXPENSE_DETAIL (
          doc_no,
          created_by,
          updated_by
        ) VALUES (
          :doc_no,
          :created_by,
          :updated_by
        )
        `,
        children.expense.map((c: any) => ({
          ...c,
          doc_no,
          created_by: req.user.loginid,
          updated_by: req.user.loginid,
        }))
      );
    }

    if (files?.length) {
      await connection.executeMany(
        `
        INSERT INTO UPLOADED_FILES_DLTS (
          request_number,
          file_name
        ) VALUES (
          :request_number,
          :file_name
        )
        `,
        files.map((f: any) => ({
          ...f,
          request_number: req.body.doc_type + doc_no,
        }))
      );
    }

    await connection.commit();

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: {
        data: constants.MESSAGES.CREATED_SUCCESSFULLY,
        doc_no,
        doc_type: req.body.doc_type,
      },
    });

  } catch (err: any) {
    if (connection) {
      await connection.rollback();
    }

    console.error(err);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Error occurred while creating document: " + err.message,
    });
  } finally {
    if (connection) {
      await connection.close();
    }
  }
};


// export const createChequePaymentStoreProcess = async (
//   req: RequestWithUser,
//   res: Response
// ) => {
//   try {
//     console.log(
//       "this is req body data -------=========>>>>>>",
//       req.body.doc_type,
//       req.body.doc_no
//     );
//     await sequelize.query(
//       `CALL SP_AC_TXN_CONTROL(:vs_company_code, :vs_doc_type, :vs_doc_no, :vs_user)`,
//       {
//         replacements: {
//           vs_company_code: req.user.company_code,
//           vs_doc_type: req.body.doc_type,
//           vs_doc_no: req.body.doc_no,
//           vs_user: req.user.loginid,
//         },
//         logging: console.log, // This logs the actual SQL queries
//       }
//     );
//     // Return success response after transaction completion
//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       data: constants.MESSAGES.STORE_PROCESS,
//     });
//     return;
//   } catch (err) {
//     // Log and handle any errors during the process
//     console.error(err);
//     res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
//       success: false,
//       message: "Error occurred while fetching data :" + err,
//     });
//   }
// };

//-------------------update---------------
// /**
//  * Cancels a specific transaction document
//  * Purpose: Mark a transaction document as canceled in the system
//  *
//  * @param req Request containing document number and type to be canceled
//  * @param res HTTP Response object
//  */
// export const cancelDocument = async (req: RequestWithUser, res: Response) => {
//   try {
//     // Extract document identifiers from query parameters
//     const { doc_no, doc_type } = req.query;

//     // Update transaction header to mark document as canceled
//     await TransactionHeader.update(
//       {
//         updated_by: req.user.loginid, // Audit trail: Track who canceled the document
//         canceled: "Y", // Set cancellation flag
//       },
//       {
//         where: {
//           company_code: req.user.company_code, // Security: Ensure company-specific access
//           doc_no, // Filter by document number
//           doc_type, // Filter by document type
//         },
//       }
//     );

//     // Return success response
//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       message: constants.MESSAGES.UPDATED_SUCCESSFULLY,
//     });
//   } catch (err) {
//     // Log and handle any errors during cancellation
//     console.error(err);
//     res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
//       success: false,
//       message: "Error occurred while fetching data",
//     });
//   }
// };
// /**
//  * Updates an existing cheque payment document with associated details and attachments
//  * @param req Request containing updated payment document data and related information
//  * @param res HTTP Response object
//  */
// export const updateChequePaymentDocument = async (
//   req: RequestWithUser,
//   res: Response
// ) => {
//   try {
//     // Validate request payload against schema
//     const { error } = chequePaymentSchema(req.body);
//     if (error) {
//       // Return error response if validation fails
//       res
//         .status(constants.STATUS_CODES.BAD_REQUEST)
//         .json({ success: false, message: error.message });
//       return;
//     }
//     let doc_no_store: any;
//     console.log("this is req body data -------=========>>>>>>", req.body);
//     // Execute all operations within a transaction for data consistency
//     await sequelize.transaction(async (t) => {
//       // Destructure request body into components
//       let { detail, children, files, ...header } = req.body;
//       let { doc_no, doc_type } = header;
//       doc_no_store = doc_no;
//       // Map transaction details to account codes and serial numbers
//       const detailAccounts = detail.map((eachDetail: TTransactionDetail) => ({
//         ac_code: eachDetail.ac_code,
//         serial_no: eachDetail.serial_no,
//       }));

//       // Initialize array to store invoices with zero amount
//       let invoicesWithZeroAmount: {
//         ac_code: string;
//         serial_no: number;
//         dtl_sr_no: number;
//       }[] = [];

//       // Process invoice-related children if present
//       if (!!children?.["invoice"]) {
//         // Filter out invoices with zero amount and mark them for deletion
//         children["invoice"] = children["invoice"]
//           .map((eachInvoice: ITrAcInvdetail) => {
//             if (Number(eachInvoice.amount ?? 0) === 0) {
//               // Check if invoice is deletable before marking for deletion
//               if (eachInvoice.IsDeletable === true)
//                 invoicesWithZeroAmount.push({
//                   ac_code: eachInvoice.ac_code,
//                   serial_no: eachInvoice.serial_no,
//                   dtl_sr_no: eachInvoice.dtl_sr_no,
//                 });
//               return null;
//             } else {
//               // Remove IsDeletable property from invoice details
//               const { IsDeletable, ...invoiceDetail } = eachInvoice;
//               return invoiceDetail;
//             }
//           })
//           .filter(Boolean);

//         // Delete invoices with zero amount if any
//         if (invoicesWithZeroAmount.length > 0) {
//           await TransactionInvoiceDetail.destroy({
//             where: {
//               company_code: req.user.company_code,
//               doc_no,
//               div_code: header.div_code,
//               doc_type: req.body.doc_type,
//               [Op.or]: invoicesWithZeroAmount.map((invoice) => ({
//                 ac_code: invoice.ac_code,
//                 serial_no: invoice.serial_no,
//                 dtl_sr_no: invoice.dtl_sr_no,
//               })),
//             },
//             transaction: t,
//           });
//         }
//       }

//       // Delete transaction invoice details not present in updated details
//       await TransactionInvoiceDetail.destroy({
//         where: {
//           company_code: req.user.company_code,
//           doc_no,
//           div_code: header.div_code,
//           doc_type: req.body.doc_type,
//           [Op.not]: detailAccounts,
//         },
//         transaction: t,
//       });

//       // Delete transaction job details not present in updated details
//       await TransactionJobDetail.destroy({
//         where: {
//           company_code: req.user.company_code,
//           doc_no,
//           div_code: header.div_code,
//           doc_type: req.body.doc_type,
//           [Op.not]: detailAccounts,
//         },
//         transaction: t,
//       });

//       // Delete transaction expense details not present in updated details
//       await TransactionExpenseDetail.destroy({
//         where: {
//           company_code: req.user.company_code,
//           doc_no,
//           div_code: header.div_code,
//           doc_type: req.body.doc_type,
//           [Op.not]: detailAccounts,
//         },
//         transaction: t,
//       });

//       // Update transaction header with updated information
//       if (doc_no) {
//         await TransactionHeader.update(
//           {
//             ...header,
//             company_code: req.user.company_code,
//             updated_by: req.user.loginid,
//           },
//           {
//             where: { company_code: req.user.company_code, doc_no, doc_type },
//             transaction: t,
//           }
//         );

//         // Upsert transaction details with updated information
//         await Promise.all(
//           detail.map((eachDetail: TTransactionDetail) =>
//             TransactionDetail.upsert(
//               {
//                 ...eachDetail,
//                 updated_by: req.user.loginid,
//               },
//               {
//                 transaction: t,
//               }
//             )
//           )
//         );

//         // Upsert transaction invoice details with updated information
//         if (children?.["invoice"] && children?.["invoice"].length > 0) {
//           await Promise.all(
//             children["invoice"].map((eachChildren: ITrAcInvdetail) =>
//               TransactionInvoiceDetail.upsert(
//                 {
//                   ...eachChildren,
//                   updated_by: req.user.loginid,
//                 },
//                 {
//                   transaction: t,
//                 }
//               )
//             )
//           );
//         }

//         // Upsert transaction job details with updated information
//         if (children?.["job"] && children?.["job"].length > 0) {
//           await Promise.all(
//             children["job"].map((eachChildren: ITransactionJobDetail) =>
//               TransactionJobDetail.upsert(
//                 {
//                   ...eachChildren,
//                   // updated_by: req.user.loginid,
//                 },
//                 {
//                   transaction: t,
//                 }
//               )
//             )
//           );
//         }

//         // Upsert transaction expense details with updated information
//         if (children?.["expense"] && children?.["expense"].length > 0) {
//           await Promise.all(
//             children["expense"].map((eachChildren: ITransactionExpenseDetail) =>
//               TransactionExpenseDetail.upsert(eachChildren, {
//                 transaction: t,
//               })
//             )
//           );
//         }

//         // Create file records with document reference if files are present
//         if (!!files && files.length) {
//           await Files.bulkCreate(
//             (files as IFiles[]).map((eachFile) => {
//               return {
//                 ...eachFile,
//                 request_number: req.body.doc_type + doc_no,
//               };
//             })
//           );
//         }
//       }
//     });

//     await sequelize.query(
//       `CALL SP_AC_TXN_CONTROL(:vs_company_code, :vs_doc_type, :vs_doc_no, :vs_user)`,
//       {
//         replacements: {
//           vs_company_code: req.user.company_code,
//           vs_doc_type: req.body.doc_type,
//           vs_doc_no: doc_no_store,
//           vs_user: req.user.loginid,
//         },
//         logging: console.log, // This logs the actual SQL queries
//       }
//     );

//     // Return success response after transaction completion
//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       data: constants.MESSAGES.CREATED_SUCCESSFULLY,
//     });
//     return;
//   } catch (err) {
//     // Log and handle any errors during the process
//     console.error(err);
//     res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
//       success: false,
//       message: "Error occurred while fetching data",
//     });
//   }
// };
//-------------------delete---------------
// /**
//  * Deletes a detail item from a transaction document
//  * @param req Request containing document number, type, serial number, division code, and table name
//  * @param res HTTP Response object
//  */
// export const deleteDetailItem = async (req: RequestWithUser, res: Response) => {
//   try {
//     // Extract query parameters for document identification and table name
//     const { doc_no, doc_type, serial_no, div_code, table } = req.query;

//     // Execute deletion within a transaction for data consistency
//     await sequelize.transaction(async (t) => {
//       // Delete transaction detail record
//       await TransactionDetail.destroy({
//         where: {
//           [Op.and]: [
//             { company_code: req.user.company_code }, // Security: Company-specific access
//             { doc_no }, // Filter by document number
//             { doc_type }, // Filter by document type
//             { div_code }, // Filter by division code
//             { serial_no }, // Filter by serial number
//           ],
//         },
//         transaction: t, // Transaction context
//       });

//       // Delete child table records based on table name
//       switch (table) {
//         case "invoice":
//           // Delete invoice detail records
//           await TransactionInvoiceDetail.destroy({
//             where: {
//               [Op.and]: [
//                 { company_code: req.user.company_code }, // Security: Company-specific access
//                 { doc_no }, // Filter by document number
//                 { doc_type }, // Filter by document type
//                 { div_code }, // Filter by division code
//                 { serial_no }, // Filter by serial number
//               ],
//             },
//             transaction: t, // Transaction context
//           });
//           break;
//         case "job":
//           // Delete job detail records
//           await TransactionJobDetail.destroy({
//             where: {
//               [Op.and]: [
//                 { company_code: req.user.company_code }, // Security: Company-specific access
//                 { doc_no }, // Filter by document number
//                 { doc_type }, // Filter by document type
//                 { div_code }, // Filter by division code
//                 { serial_no }, // Filter by serial number
//               ],
//             },
//             transaction: t, // Transaction context
//           });
//           break;
//         case "expense":
//           // Delete expense detail records
//           await TransactionExpenseDetail.destroy({
//             where: {
//               [Op.and]: [
//                 { company_code: req.user.company_code }, // Security: Company-specific access
//                 { doc_no }, // Filter by document number
//                 { doc_type }, // Filter by document type
//                 { div_code }, // Filter by division code
//                 { serial_no }, // Filter by serial number
//               ],
//             },
//             transaction: t, // Transaction context
//           });
//           break;
//       }
//     });

//     // Return success response with deletion message
//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       data: "Detail Item " + constants.MESSAGES.DELETED_SUCCESSFULLY,
//     });
//     return;
//   } catch (err) {
//     // Log and handle any errors during deletion
//     console.error(err);
//     res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
//       success: false,
//       message: "Error occurred while fetching data",
//     });
//   }
// };

// /**
//  * Deletes a child item from a transaction document
//  * @param req Request containing document number, type, serial number, division code, table name, and detail serial number
//  * @param res HTTP Response object
//  */
// export const deleteChildrenItem = async (
//   req: RequestWithUser,
//   res: Response
// ) => {
//   try {
//     // Extract query parameters for document identification, table name, and detail serial number
//     const { doc_no, doc_type, serial_no, div_code, table, dtl_sr_no } =
//       req.query;

//     // Initialize response variable
//     let response: unknown;

//     // Execute deletion within a transaction for data consistency
//     await sequelize.transaction(async (t) => {
//       // Delete child table records based on table name
//       switch (table) {
//         case "invoice":
//           // Delete invoice detail records
//           response = await TransactionInvoiceDetail.destroy({
//             where: {
//               company_code: req.user.company_code, // Security: Company-specific access
//               doc_no, // Filter by document number
//               doc_type, // Filter by document type
//               div_code, // Filter by division code
//               serial_no, // Filter by serial number
//               dtl_sr_no, // Filter by detail serial number
//             },
//             transaction: t, // Transaction context
//           });
//           break;
//         case "job":
//           // Delete job detail records
//           response = await TransactionJobDetail.destroy({
//             where: {
//               [Op.and]: [
//                 { company_code: req.user.company_code }, // Security: Company-specific access
//                 { doc_no }, // Filter by document number
//                 { doc_type }, // Filter by document type
//                 { div_code }, // Filter by division code
//                 { serial_no }, // Filter by serial number
//                 { dtl_sr_no }, // Filter by detail serial number
//               ],
//             },
//             transaction: t, // Transaction context
//           });
//           break;
//         case "expense":
//           // Delete expense detail records
//           response = await TransactionExpenseDetail.destroy({
//             where: {
//               [Op.and]: [
//                 { company_code: req.user.company_code }, // Security: Company-specific access
//                 { doc_no }, // Filter by document number
//                 { doc_type }, // Filter by document type
//                 { div_code }, // Filter by division code
//                 { serial_no }, // Filter by serial number
//                 { dtl_sr_no }, // Filter by detail serial number
//               ],
//             },
//             transaction: t, // Transaction context
//           });
//           break;
//       }

//       // Check if deletion was successful
//       if (response) {
//         // Return success response with deletion message
//         res.status(constants.STATUS_CODES.OK).json({
//           success: true,
//           data:
//             String(table).toUpperCase() +
//             " " +
//             constants.MESSAGES.DELETED_SUCCESSFULLY,
//         });
//         return;
//       }
//     });
//     return;
//   } catch (err) {
//     // Log and handle any errors during deletion
//     console.error(err);
//     res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
//       success: false,
//       message: "Error occurred while fetching data",
//     });
//     return;
//   }
// };

// /**
//  * Deletes a transaction document
//  * @param req Request containing document number and type
//  * @param res HTTP Response object
//  */
// export const deleteDocument = async (req: RequestWithUser, res: Response) => {
//   try {
//     // Extract document identifiers from query parameters
//     const doc_no = JSON.parse(req.query.doc_no);
//     const { doc_type } = req.params;

//     // Execute deletion within a transaction for data consistency
//     await sequelize.transaction(async (t) => {
//       // Delete transaction header record
//       await TransactionHeader.destroy({
//         where: {
//           company_code: req.user.company_code, // Security: Company-specific access
//           doc_no, // Filter by document number
//           doc_type, // Filter by document type
//         },
//         transaction: t, // Transaction context
//       });

//       // Delete transaction detail records
//       await TransactionDetail.destroy({
//         where: {
//           company_code: req.user.company_code, // Security: Company-specific access
//           doc_no, // Filter by document number
//           doc_type, // Filter by document type
//         },
//         transaction: t, // Transaction context
//       });

//       // Delete transaction invoice detail records
//       await TransactionInvoiceDetail.destroy({
//         where: {
//           company_code: req.user.company_code, // Security: Company-specific access
//           doc_no, // Filter by document number
//           doc_type, // Filter by document type
//         },
//         transaction: t, // Transaction context
//       });

//       // Delete transaction job detail records
//       await TransactionJobDetail.destroy({
//         where: {
//           company_code: req.user.company_code, // Security: Company-specific access
//           doc_no, // Filter by document number
//           doc_type, // Filter by document type
//         },
//         transaction: t, // Transaction context
//       });

//       // Delete transaction expense detail records
//       await TransactionExpenseDetail.destroy({
//         where: {
//           company_code: req.user.company_code, // Security: Company-specific access
//           doc_no, // Filter by document number
//           doc_type, // Filter by document type
//         },
//         transaction: t, // Transaction context
//       });

//       // Delete attached files
//       await Files.destroy({
//         where: {
//           request_number: doc_type + doc_no, // Filter by document reference
//         },
//       });
//     });

//     // Return success response with deletion message
//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       message: constants.MESSAGES.DELETED_SUCCESSFULLY,
//     });
//     return;
//   } catch (err) {
//     // Log and handle any errors during deletion
//     console.error(err);
//     res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
//       success: false,
//       message: "Error occurred while fetching data",
//     });
//   }
// };


