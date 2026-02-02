

import { Response } from "express"; // Express response handling
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
    connection = await oracledb.getConnection();

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
        LEFT JOIN MS_HR_DIVISION d ON asd.default_div_code = d.div_code
        LEFT JOIN MS_ACCODES a ON asd.default_h_ac = a.ac_code
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
      res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false });
      return;
    }

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

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: response
    });
    return;

  } catch (err) {
    console.error('Database error:', err);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
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
        acc.ac_name,
        bank.ac_code as bank_account_code,
        bank_acc.ac_name as bank_ac_name,
        curr.curr_name,
        div.div_name
      FROM TR_AC_HEADER th
      INNER JOIN MS_AC_SETUP acs
        ON th.company_code = acs.company_code
      LEFT JOIN MS_ACCODES acc
        ON th.ac_code = acc.ac_code
        AND th.company_code = acc.company_code
      LEFT JOIN MS_AC_BANKCODE bank
        ON th.bank_ac_code = bank.ac_code
        AND th.company_code = bank.company_code
      LEFT JOIN MS_ACCODES bank_acc
        ON bank.ac_code = bank_acc.ac_code
        AND bank.company_code = bank_acc.company_code
      LEFT JOIN MS_CURRENCY curr
        ON th.curr_code = curr.curr_code
      LEFT JOIN MS_HR_DIVISION div
        ON th.div_code = div.div_code
        AND th.company_code = div.company_code
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

    // Check if any rows were returned
    // if (!result.rows || result.rows.length === 0) {
    //   res.status(constants.STATUS_CODES.OK).json({
    //     success: true,
    //     data: null
    //   });
    //   return;
    // }

    // // Transform the result to match Sequelize nested structure
    // const rowData: any = result.rows[0];
   
    // const response = {
    //   // Transaction Header fields
    //   doc_no: rowData.DOC_NO,
    //   doc_date: rowData.DOC_DATE,
    //   ac_code: rowData.AC_CODE,
    //   bank_ac_code: rowData.BANK_AC_CODE,
    //   cheque_no: rowData.CHEQUE_NO,
    //   cheque_date: rowData.CHEQUE_DATE,
    //   remarks: rowData.REMARKS,
    //   ac_payee: rowData.AC_PAYEE,
    //   curr_code: rowData.CURR_CODE,
    //   ex_rate: rowData.EX_RATE,
    //   div_code: rowData.DIV_CODE,
    //   doc_type: rowData.DOC_TYPE,
    //   cheque_bank: rowData.CHEQUE_BANK,
     
    //   // Nested objects to match Sequelize include structure
    //   Accountsetup: {
    //     tax_perc: rowData.TAX_PERC
    //   },
     
    //   Account: {
    //     ac_name: rowData.AC_NAME
    //   },
     
    //   MS_AC_BANKCODE: {
    //     ac_code: rowData.BANK_ACCOUNT_CODE,
    //     Account: {
    //       ac_name: rowData.BANK_AC_NAME
    //     }
    //   },
     
    //   Currency: {
    //     curr_name: rowData.CURR_NAME
    //   },
     
    //   Division: {
    //     div_name: rowData.DIV_NAME
    //   }
    // };

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
      LEFT JOIN MS_ACCODES acc
        ON td.ac_code = acc.ac_code
      LEFT JOIN MS_DEPARTMENT dept
        ON td.dept_code = dept.dept_code
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
export const getChildTableName = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection;
 
  try {
    const { ac_code } = req.params;
    if (!ac_code) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.BAD_REQUEST
      });
      return;
    }

    connection = await getConnection();

    const sql = `
      SELECT
        a.ac_code,
        a.exp_type_code,
        a.exp_subtype_code,
        l4.l4_job,
        l4.l4_bill
      FROM MS_ACCODES a
      LEFT JOIN MS_AC_L4 l4
        ON a.l4_code = l4.l4_code
        AND a.company_code = l4.company_code
      WHERE a.company_code = :company_code
        AND a.ac_code = :ac_code
    `;

    // Execute query with bind parameters
    const result = await connection.execute(
      sql,
      {
        company_code: req.user.company_code,
        ac_code: ac_code
      },
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT
      }
    );

    // Check if account data was found
    if (result.rows && result.rows.length > 0) {
      const accountData: any = result.rows[0];

      // Extract level four settings from response
      const l4_bill = accountData.L4_BILL;
      const l4_job = accountData.L4_JOB;
      const exp_type_code = accountData.EXP_TYPE_CODE;
      const exp_subtype_code = accountData.EXP_SUBTYPE_CODE;

      // Determine child table based on account configuration
      let data;
     
      if (l4_bill === 'Y') {
        // Invoice table
        data = { table: 'invoice', code: '' };
      } else if (l4_job === 'Y') {
        // Job table
        data = { table: 'job', code: '' };
      } else if (exp_type_code !== null && exp_subtype_code !== null) {
        // Expense table
        data = {
          table: 'expense',
          code: exp_type_code
        };
      } else {
        // No child table assigned
        data = null;
      }

      // Validate child table assignment
      if (!data) {
        throw new Error('Does not have a child table');
      }

      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        data
      });
      return;
    } else {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.NOT_FOUND
      });
      return;
    }

  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || 'Error occurred while fetching data'
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

// /**
//  * Retrieves the last cheque number for a specific account
//  * @param req Request containing account code
//  * @param res HTTP Response object
//  */
export const getChequeDetail = async (req: RequestWithUser, res: Response) => {
  let connection;
 
  try {
    const { ac_code } = req.query;
    connection = await getConnection();

    const sql = `
      SELECT
        last_cheque_no
      FROM MS_AC_BANKCODE
      WHERE company_code = :company_code
        AND ac_code = :ac_code
    `;

    // Execute query with bind parameters
    const result = await connection.execute(
      sql,
      {
        company_code: req.user.company_code,
        ac_code: ac_code as string
      },
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT
      }
    );
    const response = result.rows && result.rows.length > 0
      ? {
          last_cheque_no: (result.rows[0] as any).LAST_CHEQUE_NO
        }
      : null;

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: response
    });
    return;

  } catch (err) {
    console.error(err);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
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
        TO_DATE(SUBSTR(:doc_date, 1, 10), 'YYYY-MM-DD')
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
   console.log("Get doc_date", req.body.doc_date);
    const { detail, children, files, ...header } = req.body;

    // ---------- INSERT HEADER ----------
    const headerBinds = {
      ...header,
      doc_no,
      doc_date: req.body.doc_date,
      company_code: req.user.company_code,
      create_user: req.user.loginid,
      created_by: req.user.loginid,
      updated_by: req.user.loginid,
    };
    const headerBindsFiltered = {
      doc_no: headerBinds.doc_no,
      company_code: headerBinds.company_code,
      create_user: headerBinds.create_user,
      doc_type: headerBinds.doc_type,
      div_code: headerBinds.div_code,
      doc_date: headerBinds.doc_date,
    };

    console.log('DB: INSERT HEADER', { doc_no, doc_type: req.body.doc_type, company_code: req.user.company_code });
    console.log('DB: HEADER BINDS', headerBinds);
    console.log('DB: HEADER BINDS FILTERED', headerBindsFiltered);
    await connection.execute(
      `
      INSERT INTO TR_AC_HEADER (
        doc_no,
        company_code,
        create_user,
        create_date,
        doc_type,
        div_code,
        doc_date
      ) VALUES (
        :doc_no,
        :company_code,
        :create_user,
        SYSDATE,
        :doc_type,
        :div_code,
        TO_DATE(SUBSTR(:doc_date, 1, 10), 'YYYY-MM-DD')
      )
      `,
      headerBindsFiltered
    );

    if (detail?.length) {
      const detailBinds = detail.map((d: any, idx: number) => ({
        company_code: req.user.company_code,
        doc_type: req.body.doc_type,
        doc_no,
        serial_no: d.serial_no ?? idx + 1,
        doc_date: d.doc_date ?? req.body.doc_date,
        ac_code: d.ac_code,
        header_ac_code: d.header_ac_code ?? header.ac_code ?? null,
        bank_ac_code: header.bank_ac_code ?? null,
        remarks: d.remarks ?? header.remarks ?? null,
        amount: d.amount ?? 0,
        sign_ind: d.sign_ind ?? 1,
        curr_code: d.curr_code ?? header.curr_code ?? "USD",
        ex_rate: (d.ex_rate ?? header.ex_rate ?? 1),
        lcur_amount: d.lcur_amount ?? d.amount ?? 0,
        pdc_ind: d.pdc_ind ?? null,
        cheque_no: d.cheque_no ?? header.cheque_no ?? null,
        cheque_date: d.cheque_date ?? header.cheque_date ?? null,
        cheque_desc: d.cheque_desc ?? null,
        pdc_cleared_date: d.pdc_cleared_date ?? null,
        cancelled: d.cancelled ?? 'N',
        job_no: d.job_no ?? null,
        recon_ind: d.recon_ind ?? null,
        recon_date: d.recon_date ?? null,
        dept_code: d.dept_code ?? null,
        qty: d.qty ?? null,
        price: d.price ?? null,
        uom: d.uom ?? null,
        pdc_clear_jvno: d.pdc_clear_jvno ?? null,
        ref_doc_type: d.ref_doc_type ?? null,
        ref_doc_no: d.ref_doc_no ?? null,
        ref_doc_serial_no: d.ref_doc_serial_no ?? null,
        div_code: d.div_code ?? req.body.div_code,
        tx_cat_code: d.tx_cat_code ?? null,
        tx_compntcat_code_1: d.tx_compntcat_code_1 ?? null,
        tx_compntcat_code_2: d.tx_compntcat_code_2 ?? null,
        tx_compntcat_code_3: d.tx_compntcat_code_3 ?? null,
        tx_compntcat_code_4: d.tx_compntcat_code_4 ?? null,
        tx_compnt_perc_1: d.tx_compnt_perc_1 ?? null,
        tx_compnt_perc_2: d.tx_compnt_perc_2 ?? null,
        tx_compnt_perc_3: d.tx_compnt_perc_3 ?? null,
        tx_compnt_perc_4: d.tx_compnt_perc_4 ?? null,
        tx_compnt_amt_1: d.tx_compnt_amt_1 ?? null,
        tx_compnt_amt_2: d.tx_compnt_amt_2 ?? null,
        tx_compnt_amt_3: d.tx_compnt_amt_3 ?? null,
        tx_compnt_amt_4: d.tx_compnt_amt_4 ?? null,
        tx_compnt_lcuramt_1: d.tx_compnt_lcuramt_1 ?? null,
        tx_compnt_lcuramt_2: d.tx_compnt_lcuramt_2 ?? null,
        tx_compnt_lcuramt_3: d.tx_compnt_lcuramt_3 ?? null,
        tx_compnt_lcuramt_4: d.tx_compnt_lcuramt_4 ?? null,
        tx_compnt_1_expmt: d.tx_compnt_1_expmt ?? null,
        tx_compnt_2_expmt: d.tx_compnt_2_expmt ?? null,
        tx_compnt_3_expmt: d.tx_compnt_3_expmt ?? null,
        tx_compnt_4_expmt: d.tx_compnt_4_expmt ?? null,
        tx_tax_filed: d.tx_tax_filed ?? null,
        tx_tax_filed_dt: d.tx_tax_filed_dt ?? null,
        tx_tax_filed_refno: d.tx_tax_filed_refno ?? null,
        tx_compnt_hdisc_amt_1: d.tx_compnt_hdisc_amt_1 ?? null,
      }));

      console.log('DB: INSERT DETAILS (first row)', detailBinds[0]);
      await connection.executeMany(
        `
        INSERT INTO ${constants.TABLE.TR_AC_DETAIL} (
          company_code, doc_type, doc_no, serial_no, doc_date, ac_code, header_ac_code, bank_ac_code, remarks, amount,
          sign_ind, curr_code, ex_rate, lcur_amount, pdc_ind, cheque_no, cheque_date, cheque_desc, pdc_cleared_date, cancelled,
          job_no, recon_ind, recon_date, dept_code, qty, price, uom, pdc_clear_jvno, ref_doc_type, ref_doc_no, ref_doc_serial_no,
          div_code, tx_cat_code, tx_compntcat_code_1, tx_compntcat_code_2, tx_compntcat_code_3, tx_compntcat_code_4,
          tx_compnt_perc_1, tx_compnt_perc_2, tx_compnt_perc_3, tx_compnt_perc_4,
          tx_compnt_amt_1, tx_compnt_amt_2, tx_compnt_amt_3, tx_compnt_amt_4,
          tx_compnt_lcuramt_1, tx_compnt_lcuramt_2, tx_compnt_lcuramt_3, tx_compnt_lcuramt_4,
          tx_compnt_1_expmt, tx_compnt_2_expmt, tx_compnt_3_expmt, tx_compnt_4_expmt,
          tx_tax_filed, tx_tax_filed_dt, tx_tax_filed_refno, tx_compnt_hdisc_amt_1
        ) VALUES (
          :company_code, :doc_type, :doc_no, :serial_no, TO_DATE(SUBSTR(:doc_date,1,10),'YYYY-MM-DD'), :ac_code, :header_ac_code, :bank_ac_code, :remarks, :amount,
          :sign_ind, :curr_code, :ex_rate, :lcur_amount, :pdc_ind, :cheque_no, TO_DATE(SUBSTR(:cheque_date,1,10),'YYYY-MM-DD'), :cheque_desc, TO_DATE(SUBSTR(:pdc_cleared_date,1,10),'YYYY-MM-DD'), :cancelled,
          :job_no, :recon_ind, TO_DATE(SUBSTR(:recon_date,1,10),'YYYY-MM-DD'), :dept_code, :qty, :price, :uom, :pdc_clear_jvno, :ref_doc_type, :ref_doc_no, :ref_doc_serial_no,
          :div_code, :tx_cat_code, :tx_compntcat_code_1, :tx_compntcat_code_2, :tx_compntcat_code_3, :tx_compntcat_code_4,
          :tx_compnt_perc_1, :tx_compnt_perc_2, :tx_compnt_perc_3, :tx_compnt_perc_4,
          :tx_compnt_amt_1, :tx_compnt_amt_2, :tx_compnt_amt_3, :tx_compnt_amt_4,
          :tx_compnt_lcuramt_1, :tx_compnt_lcuramt_2, :tx_compnt_lcuramt_3, :tx_compnt_lcuramt_4,
          :tx_compnt_1_expmt, :tx_compnt_2_expmt, :tx_compnt_3_expmt, :tx_compnt_4_expmt,
          :tx_tax_filed, TO_DATE(SUBSTR(:tx_tax_filed_dt,1,10),'YYYY-MM-DD'), :tx_tax_filed_refno, :tx_compnt_hdisc_amt_1
        )
        `,
        detailBinds
      );
    }

    //  ---------- INVOICE  ----------
    if (children?.invoice?.length) {
      console.log('DB: CREATE-FLOW INSERT INVOICE (first)', { ...children.invoice[0], doc_no });
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
      console.log('DB: CREATE-FLOW INSERT JOB (first)', { ...children.job[0], doc_no });
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
      console.log('DB: CREATE-FLOW INSERT EXPENSE (first)', { ...children.expense[0], doc_no });
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
      console.log('DB: INSERT FILES (first)', { ...files[0], request_number: req.body.doc_type + doc_no });
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

// Helper: Invoke the SP_AC_TXN_CONTROL stored procedure safely via Oracle connection
export const callSpAcTxnControl = async (
  company_code: string,
  doc_type: string | number,
  doc_no: string | number,
  user: string
) => {
  let conn: oracledb.Connection | undefined;
  try {
    conn = await oracledb.getConnection();
    await conn.execute(
      `BEGIN SP_AC_TXN_CONTROL(
        :vs_company_code,
        :vs_doc_type,
        :vs_doc_no,
        :vs_user
      ); END;`,
      {
        vs_company_code: company_code,
        vs_doc_type: doc_type,
        vs_doc_no: doc_no,
        vs_user: user,
      }
    );
    await conn.commit();
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch (er) {
        console.warn("Error closing connection after SP call:", er);
      }
    }
  }
};

export const createChequePaymentStoreProcess = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    await callSpAcTxnControl(
      req.user.company_code,
      req.body.doc_type,
      req.body.doc_no,
      req.user.loginid
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: constants.MESSAGES.STORE_PROCESS,
    });
    return;
  } catch (err: any) {
    console.error("Store process error:", err);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Error occurred while processing store process: " + (err?.message ?? err),
    });
    return;
  }
};

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

//     // Using Oracle helper to run stored procedure (updated for Oracle driver)
//     await callSpAcTxnControl(
//       req.user.company_code,
//       req.body.doc_type,
//       doc_no_store,
//       req.user.loginid
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
export const updateChequePaymentDocument = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { error } = chequePaymentSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message,
      });
      return;
    }

    const { detail = [], children = {}, files = [], ...header } = req.body as any;
    const { doc_no, doc_type } = header;

    if (!doc_no) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Missing doc_no in request",
      });
      return;
    }

    conn = await oracledb.getConnection();

    try {
      // ---------- Handle invoices with zero amount (mark for deletion) ----------
      if (Array.isArray(children.invoice)) {
        const invoicesWithZeroAmount: Array<any> = [];

        children.invoice = children.invoice
          .map((eachInvoice: any) => {
            if (Number(eachInvoice.amount ?? 0) === 0) {
              if (eachInvoice.IsDeletable === true)
                invoicesWithZeroAmount.push({
                  ac_code: eachInvoice.ac_code,
                  serial_no: eachInvoice.serial_no,
                  dtl_sr_no: eachInvoice.dtl_sr_no,
                });
              return null;
            }
            const { IsDeletable, ...rest } = eachInvoice;
            return rest;
          })
          .filter(Boolean);

        if (invoicesWithZeroAmount.length > 0) {
          // Build OR conditions for deletion
          const orClauses = invoicesWithZeroAmount
            .map((_, idx) => `(ac_code = :ac${idx} AND serial_no = :sr${idx} AND dtl_sr_no = :dtl${idx})`)
            .join(" OR ");

          const binds: any = {
            company_code: req.user.company_code,
            doc_no,
            div_code: header.div_code,
            doc_type,
          };

          invoicesWithZeroAmount.forEach((inv, idx) => {
            binds[`ac${idx}`] = inv.ac_code;
            binds[`sr${idx}`] = inv.serial_no;
            binds[`dtl${idx}`] = inv.dtl_sr_no;
          });

          await conn.execute(
            `DELETE FROM ${constants.TABLE.TR_AC_INVDETAIL}
             WHERE company_code = :company_code
               AND doc_no = :doc_no
               AND div_code = :div_code
               AND doc_type = :doc_type
               AND (${orClauses})`,
            binds
          );
        }
      }

      // ---------- Delete existing child records (invoice/job/expense) for this document ---
      await conn.execute(
        `DELETE FROM ${constants.TABLE.TR_AC_INVDETAIL}
         WHERE company_code = :company_code AND doc_no = :doc_no AND doc_type = :doc_type`,
        { company_code: req.user.company_code, doc_no, doc_type }
      );

      await conn.execute(
        `DELETE FROM ${constants.TABLE.TR_AC_JOBDETAIL}
         WHERE company_code = :company_code AND doc_no = :doc_no AND doc_type = :doc_type`,
        { company_code: req.user.company_code, doc_no, doc_type }
      );

      await conn.execute(
        `DELETE FROM ${constants.TABLE.TR_AC_EXPDETAIL}
         WHERE company_code = :company_code AND doc_no = :doc_no AND doc_type = :doc_type`,
        { company_code: req.user.company_code, doc_no, doc_type }
      );

      // ---------- Update Header ----------
      await conn.execute(
        `UPDATE ${constants.TABLE.TR_AC_HEADER} SET
           ac_code = :ac_code,
           bank_ac_code = :bank_ac_code,
           ref_no = :ref_no,
           ref_date = TO_DATE(SUBSTR(:ref_date,1,10),'YYYY-MM-DD'),
           remarks = :remarks,
           curr_code = :curr_code,
           ex_rate = :ex_rate,
           cheque_no = :cheque_no,
           cheque_date = TO_DATE(SUBSTR(:cheque_date,1,10),'YYYY-MM-DD'),
           canceled = :canceled,
           updated_by = :updated_by,
           payment_terms = :payment_terms,
           lpo_no = :lpo_no,
           lpo_date = TO_DATE(SUBSTR(:lpo_date,1,10),'YYYY-MM-DD')
         WHERE company_code = :company_code AND doc_no = :doc_no AND doc_type = :doc_type
        `,
        {
          ac_code: header.ac_code,
          bank_ac_code: header.bank_ac_code,
          ref_no: header.ref_no,
          ref_date: header.ref_date,
          remarks: header.remarks,
          curr_code: header.curr_code,
          ex_rate: header.ex_rate,
          cheque_no: header.cheque_no,
          cheque_date: header.cheque_date,
          canceled: header.canceled,
          updated_by: req.user.loginid,
          payment_terms: header.payment_terms,
          lpo_no: header.lpo_no,
          lpo_date: header.lpo_date,
          company_code: req.user.company_code,
          doc_no,
          doc_type,
        }
      );

      // ---------- Replace details: delete existing and insert provided ones ----------
      await conn.execute(
        `DELETE FROM ${constants.TABLE.TR_AC_DETAIL}
         WHERE company_code = :company_code AND doc_no = :doc_no AND doc_type = :doc_type`,
        { company_code: req.user.company_code, doc_no, doc_type }
      );

      if (Array.isArray(detail) && detail.length > 0) {
        const binds = detail.map((d: any) => ({
          company_code: req.user.company_code,
          doc_type: d.doc_type ?? doc_type,
          doc_no,
          serial_no: d.serial_no,
          doc_date: d.doc_date,
          ac_code: d.ac_code,
          header_ac_code: d.header_ac_code,
          bank_ac_code: d.bank_ac_code,
          remarks: d.remarks,
          amount: d.amount,
          sign_ind: d.sign_ind,
          curr_code: d.curr_code,
          ex_rate: d.ex_rate,
          lcur_amount: d.lcur_amount,
          pdc_ind: d.pdc_ind,
          cheque_no: d.cheque_no,
          cheque_date: d.cheque_date,
          cheque_desc: d.cheque_desc,
          pdc_cleared_date: d.pdc_cleared_date,
          cancelled: d.cancelled,
          job_no: d.job_no,
          recon_ind: d.recon_ind,
          recon_date: d.recon_date,
          dept_code: d.dept_code,
          qty: d.qty,
          price: d.price,
          uom: d.uom,
          pdc_clear_jvno: d.pdc_clear_jvno,
          ref_doc_type: d.ref_doc_type,
          ref_doc_no: d.ref_doc_no,
          ref_doc_serial_no: d.ref_doc_serial_no,
          div_code: d.div_code,
          tx_cat_code: d.tx_cat_code,
          tx_compntcat_code_1: d.tx_compntcat_code_1,
          tx_compntcat_code_2: d.tx_compntcat_code_2,
          tx_compntcat_code_3: d.tx_compntcat_code_3,
          tx_compntcat_code_4: d.tx_compntcat_code_4,
          tx_compnt_perc_1: d.tx_compnt_perc_1,
          tx_compnt_perc_2: d.tx_compnt_perc_2,
          tx_compnt_perc_3: d.tx_compnt_perc_3,
          tx_compnt_perc_4: d.tx_compnt_perc_4,
          tx_compnt_amt_1: d.tx_compnt_amt_1,
          tx_compnt_amt_2: d.tx_compnt_amt_2,
          tx_compnt_amt_3: d.tx_compnt_amt_3,
          tx_compnt_amt_4: d.tx_compnt_amt_4,
          tx_compnt_lcuramt_1: d.tx_compnt_lcuramt_1,
          tx_compnt_lcuramt_2: d.tx_compnt_lcuramt_2,
          tx_compnt_lcuramt_3: d.tx_compnt_lcuramt_3,
          tx_compnt_lcuramt_4: d.tx_compnt_lcuramt_4,
          tx_compnt_1_expmt: d.tx_compnt_1_expmt,
          tx_compnt_2_expmt: d.tx_compnt_2_expmt,
          tx_compnt_3_expmt: d.tx_compnt_3_expmt,
          tx_compnt_4_expmt: d.tx_compnt_4_expmt,
          tx_tax_filed: d.tx_tax_filed,
          tx_tax_filed_dt: d.tx_tax_filed_dt,
          tx_tax_filed_refno: d.tx_tax_filed_refno,
          tx_compnt_hdisc_amt_1: d.tx_compnt_hdisc_amt_1,
        }));

        await conn.executeMany(
          `INSERT INTO ${constants.TABLE.TR_AC_DETAIL} (
             company_code, doc_type, doc_no, serial_no, doc_date, ac_code, header_ac_code, bank_ac_code, remarks, amount,
             sign_ind, curr_code, ex_rate, lcur_amount, pdc_ind, cheque_no, cheque_date, cheque_desc, pdc_cleared_date, cancelled,
             job_no, recon_ind, recon_date, dept_code, qty, price, uom, pdc_clear_jvno, ref_doc_type, ref_doc_no, ref_doc_serial_no,
             div_code, tx_cat_code, tx_compntcat_code_1, tx_compntcat_code_2, tx_compntcat_code_3, tx_compntcat_code_4,
             tx_compnt_perc_1, tx_compnt_perc_2, tx_compnt_perc_3, tx_compnt_perc_4,
             tx_compnt_amt_1, tx_compnt_amt_2, tx_compnt_amt_3, tx_compnt_amt_4,
             tx_compnt_lcuramt_1, tx_compnt_lcuramt_2, tx_compnt_lcuramt_3, tx_compnt_lcuramt_4,
             tx_compnt_1_expmt, tx_compnt_2_expmt, tx_compnt_3_expmt, tx_compnt_4_expmt,
             tx_tax_filed, tx_tax_filed_dt, tx_tax_filed_refno, tx_compnt_hdisc_amt_1
           ) VALUES (
             :company_code, :doc_type, :doc_no, :serial_no, TO_DATE(SUBSTR(:doc_date,1,10),'YYYY-MM-DD'), :ac_code, :header_ac_code, :bank_ac_code, :remarks, :amount,
             :sign_ind, :curr_code, :ex_rate, :lcur_amount, :pdc_ind, :cheque_no, TO_DATE(SUBSTR(:cheque_date,1,10),'YYYY-MM-DD'), :cheque_desc, TO_DATE(SUBSTR(:pdc_cleared_date,1,10),'YYYY-MM-DD'), :cancelled,
             :job_no, :recon_ind, TO_DATE(SUBSTR(:recon_date,1,10),'YYYY-MM-DD'), :dept_code, :qty, :price, :uom, :pdc_clear_jvno, :ref_doc_type, :ref_doc_no, :ref_doc_serial_no,
             :div_code, :tx_cat_code, :tx_compntcat_code_1, :tx_compntcat_code_2, :tx_compntcat_code_3, :tx_compntcat_code_4,
             :tx_compnt_perc_1, :tx_compnt_perc_2, :tx_compnt_perc_3, :tx_compnt_perc_4,
             :tx_compnt_amt_1, :tx_compnt_amt_2, :tx_compnt_amt_3, :tx_compnt_amt_4,
             :tx_compnt_lcuramt_1, :tx_compnt_lcuramt_2, :tx_compnt_lcuramt_3, :tx_compnt_lcuramt_4,
             :tx_compnt_1_expmt, :tx_compnt_2_expmt, :tx_compnt_3_expmt, :tx_compnt_4_expmt,
             :tx_tax_filed, TO_DATE(SUBSTR(:tx_tax_filed_dt,1,10),'YYYY-MM-DD'), :tx_tax_filed_refno, :tx_compnt_hdisc_amt_1
           )`,
          binds
        );
      }

      // ---------- Insert children invoice/job/expense ----------
      if (Array.isArray(children.invoice) && children.invoice.length > 0) {
        console.log('DB: INSERT INVOICE (first)', { ...children.invoice[0], doc_no });
        await conn.executeMany(
          `INSERT INTO ${constants.TABLE.TR_AC_INVDETAIL} (
             company_code, doc_type, doc_no, serial_no, dtl_sr_no, doc_date, ac_code, inv_no, inv_date, due_date,
             chq_no, chq_date, chq_bank, amount, lcur_amount, sign_ind, curr_code, ex_rate, div_code, oracle_upload, oracle_dt, created_by, updated_by
           ) VALUES (
             :company_code, :doc_type, :doc_no, :serial_no, :dtl_sr_no, TO_DATE(SUBSTR(:doc_date,1,10),'YYYY-MM-DD'), :ac_code, :inv_no, TO_DATE(SUBSTR(:inv_date,1,10),'YYYY-MM-DD'), TO_DATE(SUBSTR(:due_date,1,10),'YYYY-MM-DD'),
             :chq_no, TO_DATE(SUBSTR(:chq_date,1,10),'YYYY-MM-DD'), :chq_bank, :amount, :lcur_amount, :sign_ind, :curr_code, :ex_rate, :div_code, :oracle_upload, TO_DATE(SUBSTR(:oracle_dt,1,10),'YYYY-MM-DD'), :created_by, :updated_by
           )`,
          children.invoice.map((inv: any) => ({
            company_code: req.user.company_code,
            doc_type: inv.doc_type ?? doc_type,
            doc_no,
            serial_no: inv.serial_no,
            dtl_sr_no: inv.dtl_sr_no,
            doc_date: inv.doc_date,
            ac_code: inv.ac_code,
            inv_no: inv.inv_no,
            inv_date: inv.inv_date,
            due_date: inv.due_date,
            chq_no: inv.chq_no,
            chq_date: inv.chq_date,
            chq_bank: inv.chq_bank,
            amount: inv.amount,
            lcur_amount: inv.lcur_amount,
            sign_ind: inv.sign_ind,
            curr_code: inv.curr_code,
            ex_rate: inv.ex_rate,
            div_code: inv.div_code,
            oracle_upload: inv.oracle_upload,
            oracle_dt: inv.oracle_dt,
            created_by: req.user.loginid,
            updated_by: req.user.loginid,
          }))
        );
      }

      if (Array.isArray(children.job) && children.job.length > 0) {
        await conn.executeMany(
          `INSERT INTO ${constants.TABLE.TR_AC_JOBDETAIL} (
             company_code, doc_type, doc_no, serial_no, dtl_sr_no, doc_date, ac_code, job_no, doc_refno, doc_refno_2, amount, sign_ind, lcur_amount, curr_code, ex_rate, div_code, created_by, updated_by
           ) VALUES (
             :company_code, :doc_type, :doc_no, :serial_no, :dtl_sr_no, TO_DATE(SUBSTR(:doc_date,1,10),'YYYY-MM-DD'), :ac_code, :job_no, :doc_refno, :doc_refno_2, :amount, :sign_ind, :lcur_amount, :curr_code, :ex_rate, :div_code, :created_by, :updated_by
           )`,
          children.job.map((j: any) => ({
            company_code: req.user.company_code,
            doc_type: j.doc_type ?? doc_type,
            doc_no,
            serial_no: j.serial_no,
            dtl_sr_no: j.dtl_sr_no,
            doc_date: j.doc_date,
            ac_code: j.ac_code,
            job_no: j.job_no,
            doc_refno: j.doc_refno,
            doc_refno_2: j.doc_refno_2,
            amount: j.amount,
            sign_ind: j.sign_ind,
            lcur_amount: j.lcur_amount,
            curr_code: j.curr_code,
            ex_rate: j.ex_rate,
            div_code: j.div_code,
            created_by: req.user.loginid,
            updated_by: req.user.loginid,
          }))
        );
      }

      if (Array.isArray(children.expense) && children.expense.length > 0) {
        await conn.executeMany(
          `INSERT INTO ${constants.TABLE.TR_AC_EXPDETAIL} (
             company_code, doc_type, doc_no, serial_no, dtl_sr_no, doc_date, ac_code, exp_type_code, exp_subtype_code, exp_code, amount, sign_ind, lcur_amount, curr_code, ex_rate, div_code, job_no, created_by, updated_by
           ) VALUES (
             :company_code, :doc_type, :doc_no, :serial_no, :dtl_sr_no, TO_DATE(SUBSTR(:doc_date,1,10),'YYYY-MM-DD'), :ac_code, :exp_type_code, :exp_subtype_code, :exp_code, :amount, :sign_ind, :lcur_amount, :curr_code, :ex_rate, :div_code, :job_no, :created_by, :updated_by
           )`,
          children.expense.map((e: any) => ({
            company_code: req.user.company_code,
            doc_type: e.doc_type ?? doc_type,
            doc_no,
            serial_no: e.serial_no,
            dtl_sr_no: e.dtl_sr_no,
            doc_date: e.doc_date,
            ac_code: e.ac_code,
            exp_type_code: e.exp_type_code,
            exp_subtype_code: e.exp_subtype_code,
            exp_code: e.exp_code,
            amount: e.amount,
            sign_ind: e.sign_ind,
            lcur_amount: e.lcur_amount,
            curr_code: e.curr_code,
            ex_rate: e.ex_rate,
            div_code: e.div_code,
            job_no: e.job_no,
            created_by: req.user.loginid,
            updated_by: req.user.loginid,
          }))
        );
      }

      // ---------- Files ----------
      if (Array.isArray(files) && files.length > 0) {
        await conn.executeMany(
          `INSERT INTO UPLOADED_FILES_DLTS (request_number, file_name) VALUES (:request_number, :file_name)`,
          files.map((f: any) => ({
            request_number: req.body.doc_type + doc_no,
            file_name: f.file_name,
          }))
        );
      }

      // ---------- Call store process SP ----------
      await callSpAcTxnControl(req.user.company_code, doc_type, doc_no, req.user.loginid);

      await conn.commit();

      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        data: constants.MESSAGES.CREATED_SUCCESSFULLY,
      });
      return;
    } catch (err: any) {
      try {
        await conn.rollback();
      } catch (er) {
        console.warn("Rollback failed:", er);
      }
      throw err;
    }
  } catch (err: any) {
    console.error(err);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Error occurred while updating data: " + (err?.message ?? err),
    });
    return;
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch (e) {
        console.warn("Error closing connection:", e);
      }
    }
  }
};

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

