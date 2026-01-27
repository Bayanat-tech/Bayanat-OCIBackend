import { Response } from "express";
// import { Op, QueryTypes } from "sequelize";
// import { sequelize } from "../../database/connection";
import constants from "../../helpers/constants";
//import { getSearchFilterQuery } from "../../helpers/functions";
import { ISearch, RequestWithUser } from "../../interfaces/common.interface";
import { ITrAcInvdetail } from "../../interfaces/finance/accounts/transactions/chequePaymentTransaction.interface";
import { IUser } from "../../interfaces/user.interface";
// import Account from "../../models/finance/accounts/masters/account_finance.model";
// import AccountBlSetup from "../../models/finance/accounts/masters/account_finance_bl.model";
// import AccountPlSetup from "../../models/finance/accounts/masters/account_finance_pl.model";
// import ExpenseSubType from "../../models/finance/accounts/transactions/expenseSubType.model";
// import ExpenseType from "../../models/finance/accounts/transactions/expenseType.model";
//import MS_FY_PERIOD from "../../models/finance/accounts/transactions/ms_fy_period.model";
// import TaxCompntancy from "../../models/finance/accounts/transactions/msTaxComPntcategory.model";
// import TransactionHeader from "../../models/finance/accounts/transactions/tranasctionHeader_account.model";
// import TransactionExpenseDetail from "../../models/finance/accounts/transactions/transactionExpenseDetail.model";
// import TransactionInvoiceDetail from "../../models/finance/accounts/transactions/transactionInvoiceDetail.model";
// import TransactionJobDetail from "../../models/finance/accounts/transactions/transactionJobDetail.model";
// import JobInboundWms from "../../models/wms/transaction/inbound/inboundJobWms.model";
import { getChequePaymentInvoiceDetail } from "../../utils/query";
import VW_AC_HEADER_SEARCH from "../../views/finance/accounts/transactions/ac_header_search.view";
import AcCodesSearchView from "../../views/finance/accounts/transactions/acCodesSearch.view";
//import Currency from "../../models/wms/currency_wms.model";
import oracledb from "oracledb"
import { getSearchFilterQuery } from "../../helpers/functions";

export const getFinanceListData = async (
  req: RequestWithUser,
  res: Response
): Promise <void> => {
  let connection;

  try {
    // Extract master parameter from request
    const { master } = req.params;
    const requestUser: IUser = req.user;

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const offset = page * limit - limit;

    let fetchedData: unknown[] = [];
    let totalCount = 0;
    // Set pagination options if limit is provided
    //const paginationOptions = limit ? { offset: skip, limit: limit } : {};
   // Parse and set filter from query parameters
    const filter: ISearch = req.query.filter
      ? JSON.parse(req.query.filter as string)
      : {};

    connection = await oracledb.getConnection();

    switch (master) {
      // DOC 
      case "doc": {
        console.log("doc")
        let whereClause = `WHERE company_code = :company_code`;
        let binds: any = {
          company_code: requestUser.company_code,
        };

        if (filter?.search) {
          whereClause += `
            AND (
              UPPER(doc_no) LIKE UPPER(:search)
              OR UPPER(doc_type) LIKE UPPER(:search)
              OR UPPER(div_code) LIKE UPPER(:search)
            )
          `;
          binds.search = `%${filter.search}%`;
        }

        const countResult = await connection.execute(
          `
          SELECT COUNT(*) AS TOTAL_COUNT
          FROM VW_AC_HEADER_SEARCH
          ${whereClause}
          `,
          binds,
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('Get doc count from view:',countResult)

        const countRow = countResult.rows?.[0] as { TOTAL_COUNT?: number };
        totalCount = countRow?.TOTAL_COUNT ?? 0;

        const dataResult = await connection.execute(
          `
          SELECT *
          FROM VW_AC_HEADER_SEARCH
          ${whereClause}
          ORDER BY doc_no DESC
          OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
          `,
          {
            ...binds,
            offset,
            limit,
          },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        fetchedData = dataResult.rows || [];
        console.log('Get data from doc :',fetchedData)
    };
    break;
    

      // FY PERIOD
      case "fy_period": {
        let whereClause = `WHERE company_code = :company_code`;
        let binds: any = {
          company_code: requestUser.company_code,
        };

        if (filter?.search) {
          whereClause += `
            AND UPPER(fy_period) LIKE UPPER(:search)
          `;
          binds.search = `%${filter.search}%`;
        }

        const countResult = await connection.execute(
          `
          SELECT COUNT(*)
          FROM MS_FY_PERIOD
          ${whereClause}
          `,
          binds,
          { outFormat: oracledb.OUT_FORMAT_ARRAY }
        );

        //totalCount = Number(countResult.rows?.[0]?.[0] ?? 0);
        const row = countResult.rows?.[0] as { TOTAL_COUNT?: number };
        totalCount = row?.TOTAL_COUNT ?? 0;


        const dataResult = await connection.execute(
          `
          SELECT fy_period AS "fy_period"
          FROM MS_FY_PERIOD
          ${whereClause}
          ORDER BY fy_period
          `,
          binds,
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        fetchedData = dataResult.rows || [];
        console.log('Get data from fy_period :',fetchedData)
    }
        break;

    case "account": {
          console.log('account master')
        let whereClause = `WHERE a.company_code = :company_code`;
        let bindParams: any = {
          company_code: requestUser.company_code,
        };

        if (filter?.search) {
          whereClause += `
            AND (
              a.ac_code LIKE :search
              OR a.ac_name LIKE :search
            )
          `;
          bindParams.search = `%${filter.search}%`;
        }
   
  // Sorting 
  const sortColumnMap: Record<string, string> = {
    ac_code: "AC_CODE",
    ac_name: "AC_NAME",
    created_at: "CREATE_DATE",
    updated_at: "EDIT_DATE",
  };

  let orderByClause = "";
  if (filter?.sort?.field_name) {
    const column = sortColumnMap[filter.sort.field_name];
    if (column) {
      orderByClause = `ORDER BY ${column} ${filter.sort.desc ? "DESC" : "ASC"}`;
    }
  }
        // let orderByClause = ``;
        // if (filter?.sort && Object.keys(filter.sort).length > 0) {
        //   orderByClause = `
        //     ORDER BY ${filter.sort.field_name} ${
        //     filter.sort.desc ? "DESC" : "ASC"
        //   }
        //   `;
        // }

        const countResult = await connection.execute(
          `
          SELECT COUNT(*) AS TOTAL_COUNT
          FROM MS_ACCODES a
          ${whereClause}
          `,
          bindParams,
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        totalCount =
          (countResult.rows?.[0] as { TOTAL_COUNT?: number })?.TOTAL_COUNT ?? 0;

        const dataResult = await connection.execute(
          `
           SELECT
      a.ac_code     AS "ac_code",
      a.ac_name     AS "ac_name",
      a.create_date AS "created_at",
      a.edit_date   AS "updated_at"
    FROM MS_ACCODES a
          ${whereClause}
          ${orderByClause}
          OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
          `,
          {
            ...bindParams,
            offset,
            limit,
          },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        fetchedData = dataResult.rows || [];
        console.log('Get data from account :',fetchedData)
      }
        break;
      
    case "bank": {
      console.log('feteching.... ')
       let whereClause = `
         WHERE a.company_code = :company_code
         AND (a.ac_status <> 'C' OR a.ac_status IS NULL)
         AND a.ac_code IN (SELECT ac_code FROM MS_AC_BANKCODE)
        `;

     let binds: any = {
     company_code: requestUser.company_code,
    };

    // SEARCH FILTER
   if (filter?.search) {
    whereClause += `
      AND (
        UPPER(a.ac_code) LIKE UPPER(:search)
        OR UPPER(a.ac_name) LIKE UPPER(:search)
      )
    `;
    binds.search = `%${filter.search}%`;
   }

   // COUNT
   const countResult = await connection.execute(
    `
    SELECT COUNT(*) AS TOTAL_COUNT
    FROM MS_ACCODES a
    ${whereClause}
    `,
    binds,
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
   );

   totalCount =
    (countResult.rows?.[0] as { TOTAL_COUNT?: number })?.TOTAL_COUNT ?? 0;

   const dataResult = await connection.execute(
    `
    SELECT
      a.ac_code AS "ac_code",
      a.ac_name AS "ac_name"
    FROM MS_ACCODES a
    ${whereClause}
    `,
    binds,
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
   );

   fetchedData = dataResult.rows || [];
  };
 break;

  case "ac_payee": {
      console.log("fetching ac_payee...");

  let whereClause = `
    WHERE company_code = :company_code
      AND TRIM(ac_payee) IS NOT NULL
      AND TRIM(ac_payee) <> ''
  `;

  let binds: any = {
    company_code: req.user.company_code,
  };

  // SEARCH FILTER
  if (filter?.search) {
    whereClause += `
      AND UPPER(ac_payee) LIKE UPPER(:search)
    `;
    binds.search = `%${filter.search}%`;
  }

  const countResult = await connection.execute(
    `
    SELECT COUNT(DISTINCT ac_payee) AS TOTAL_COUNT
    FROM TR_AC_HEADER
    ${whereClause}
    `,
    binds,
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );

  totalCount =
    (countResult.rows?.[0] as { TOTAL_COUNT?: number })?.TOTAL_COUNT ?? 0;

  const dataResult = await connection.execute(
    `
    SELECT DISTINCT
      ac_payee AS "ac_payee"
    FROM TR_AC_HEADER
    ${whereClause}
    ORDER BY ac_payee
    `,
    binds,
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );

  fetchedData = dataResult.rows || [];
}
break;


    case "tax": {
  let whereClause = `
    WHERE company_code = :company_code
  `;

  let binds: any = {
    company_code: requestUser.company_code,
  };

  // SEARCH
  if (filter?.search) {
    whereClause += `
      AND (
        UPPER(tx_compntcat_code) LIKE UPPER(:search)
        OR UPPER(tx_compntcat_desc) LIKE UPPER(:search)
      )
    `;
    binds.search = `%${filter.search}%`;
  }

  // SORTING
  const sortColumnMap: Record<string, string> = {
    tx_compntcat_code: "TX_COMPNTCAT_CODE",
    tx_compntcat_desc: "TX_COMPNTCAT_DESC",
    created_at: "CREATE_DATE",
    updated_at: "EDIT_DATE",
  };

  let orderByClause = "ORDER BY TX_COMPNTCAT_CODE";
  if (filter?.sort?.field_name) {
    const column = sortColumnMap[filter.sort.field_name];
    if (column) {
      orderByClause = `ORDER BY ${column} ${
        filter.sort.desc ? "DESC" : "ASC"
      }`;
    }
  }

  // COUNT
  const countResult = await connection.execute(
    `
    SELECT COUNT(*) AS TOTAL_COUNT
    FROM MS_TAX_COMPNTCATEGORY
    ${whereClause}
    `,
    binds,
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );

  totalCount =
    (countResult.rows?.[0] as { TOTAL_COUNT?: number })?.TOTAL_COUNT ?? 0;

  const dataResult = await connection.execute(
    `
    SELECT
      tx_compntcat_code,
      tx_compntcat_desc
    FROM MS_TAX_COMPNTCATEGORY
    ${whereClause}
    ${orderByClause}
    OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
    `,
    {
      ...binds,
      offset,
      limit,
    },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );

  fetchedData = dataResult.rows || [];
 }
break;


    //   case "invoice":
    //     {
    //       const {
    //         code,
    //         extra_param1,
    //         extra_param2,
    //         extra_param3,
    //         extra_param4,
    //       } = req.query;
    //       let defaultData: { [key: string]: ITrAcInvdetail } = {};

    //       fetchedData = await sequelize.query(getChequePaymentInvoiceDetail, {
    //         replacements: {
    //           company_code: req.user.company_code,
    //           ac_code: code,
    //           div_code: extra_param1,
    //           invrsno: `${extra_param2}${extra_param3}${extra_param4}`,
    //         },
    //         type: QueryTypes.SELECT,
    //       });
    //       const fetchedInvoiceNumbers = (fetchedData as ITrAcInvdetail[]).map(
    //         (value: ITrAcInvdetail) => {
    //           defaultData[`${value.inv_no}`] = value;
    //           return value.inv_no;
    //         }
    //       );

    //       const existingInvoiceDetails: any =
    //         await TransactionInvoiceDetail.findAll({
    //           where: {
    //             company_code: req.user.company_code,
    //             doc_no: extra_param3,
    //             doc_type: extra_param2,
    //             serial_no: extra_param4,
    //           },
    //           include: [{ model: Currency, attributes: ["curr_name"] }],
    //         });

    //       let maxDtlSrNo = 0;
    //       const existingInvoiceDetailsInvNos = (
    //         existingInvoiceDetails as ITrAcInvdetail[]
    //       ).map((value) => {
    //         maxDtlSrNo = Math.max(maxDtlSrNo, value.dtl_sr_no);
    //         return value.inv_no;
    //       });

    //       const matchedData = [];
    //       const remainingExistingInvoices = [];

    //       for (const eachExistingData of existingInvoiceDetails) {
    //         if (fetchedInvoiceNumbers.includes(eachExistingData.inv_no)) {
    //           matchedData.push({
    //             ...eachExistingData.dataValues,
    //             inv_amt: defaultData[eachExistingData.inv_no].inv_amt ?? 0,
    //             c_bal_amt_org:
    //               defaultData[eachExistingData.inv_no].c_bal_amt_org ?? 0,
    //           });
    //         } else {
    //           remainingExistingInvoices.push({
    //             ...eachExistingData.toJSON(),
    //             IsDeletable: true,
    //           });
    //         }
    //       }

    //       const newFetchedDataWithDtlSrNo = (
    //         fetchedData as ITrAcInvdetail[]
    //       ).filter((item) => {
    //         if (!existingInvoiceDetailsInvNos.includes(item.inv_no)) {
    //           item.dtl_sr_no = maxDtlSrNo + 1;
    //           item.IsDeletable = false;
    //           maxDtlSrNo++;
    //           return true;
    //         }
    //         return false;
    //       });

    //       const finalFetchedData = [
    //         ...matchedData,
    //         ...newFetchedDataWithDtlSrNo,
    //       ];

    //       fetchedData = [...finalFetchedData, ...remainingExistingInvoices];

    //       totalCount = fetchedData.length;
    //     }
    //     break;


    case "ac_code_search": {
  let whereClause = `
    WHERE company_code = :company_code
  `;

  let binds: any = {
    company_code: requestUser.company_code,
  };

  // SEARCH (replacement for getSearchFilterQuery)
  if (filter?.search) {
    whereClause += `
      AND (
        UPPER(ac_code) LIKE UPPER(:search)
        OR UPPER(ac_name) LIKE UPPER(:search)
      )
    `;
    binds.search = `%${filter.search}%`;
  }

  // SORTING
  const sortColumnMap: Record<string, string> = {
    ac_code: "AC_CODE",
    ac_name: "AC_NAME",
    created_at: "CREATE_DATE",
    updated_at: "EDIT_DATE",
  };

  let orderByClause = "ORDER BY AC_CODE";
  if (filter?.sort?.field_name) {
    const column = sortColumnMap[filter.sort.field_name];
    if (column) {
      orderByClause = `ORDER BY ${column} ${
        filter.sort.desc ? "DESC" : "ASC"
      }`;
    }
  }

  // COUNT
  const countResult = await connection.execute(
    `
    SELECT COUNT(*) AS TOTAL_COUNT
    FROM VW_AC_CODES_SEARCH
    ${whereClause}
    `,
    binds,
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );

  totalCount =
    (countResult.rows?.[0] as { TOTAL_COUNT?: number })?.TOTAL_COUNT ?? 0;

  // DATA
  const dataResult = await connection.execute(
    `
    SELECT *
    FROM VW_AC_CODES_SEARCH
    ${whereClause}
    ${orderByClause}
    OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
    `,
    {
      ...binds,
      offset,
      limit,
    },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );

  fetchedData = dataResult.rows || [];
}
break;

    //   case "job_no": {
    //     console.log("finance Job No ")
    //     let insideQuery: any = [],
    //       outsideQuery = {
    //         [Op.and]: [{ company_code: requestUser.company_code }],
    //       };
    //     outsideQuery = getSearchFilterQuery({
    //       insideQuery,
    //       filter: filter.search,
    //       outsideQuery,
    //     });
    //     totalCount = await JobInboundWms.count({
    //       where: outsideQuery,
    //     });

    //     fetchedData = await JobInboundWms.findAll({
    //       attributes: [
    //         "job_no",
    //         "job_date",
    //         "confirm_date",
    //         "prin_code",
    //         "doc_ref",
    //         "dept_code",
    //       ],
    //       where: outsideQuery,
    //       ...(!!filter?.sort &&
    //         Object.keys(filter?.sort).length > 0 && {
    //           order: [
    //             [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
    //           ],
    //         }),
    //       ...paginationOptions,
    //     });
    //     break;
    //   }
    //   case "job": {
    //     let insideQuery: any = [],
    //       outsideQuery = {
    //         [Op.and]: [{ company_code: requestUser.company_code }],
    //       };
    //     outsideQuery = getSearchFilterQuery({
    //       insideQuery,
    //       filter: filter.search,
    //       outsideQuery,
    //     });
    //     totalCount = await TransactionJobDetail.count({
    //       where: outsideQuery,
    //     });

    //     fetchedData = await TransactionJobDetail.findAll({
    //       where: outsideQuery,
    //       ...(!!filter?.sort &&
    //         Object.keys(filter?.sort).length > 0 && {
    //           order: [
    //             [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
    //           ],
    //         }),
    //       // ...paginationOptions,
    //     });
    //     break;
    //   }
    //   case "expense": {
    //     let insideQuery: any = [],
    //       outsideQuery = {
    //         [Op.and]: [{ company_code: requestUser.company_code }],
    //       };
    //     outsideQuery = getSearchFilterQuery({
    //       insideQuery,
    //       filter: filter.search,
    //       outsideQuery,
    //     });
    //     totalCount = await TransactionExpenseDetail.count({
    //       where: outsideQuery,
    //     });

    //     fetchedData = await TransactionExpenseDetail.findAll({
    //       where: outsideQuery,
    //       include: [
    //         { model: ExpenseType, attributes: ["exp_description"] },
    //         {
    //           model: ExpenseSubType,
    //           attributes: ["exp_subtype_description"],
    //           where: sequelize.where(
    //             sequelize.col("TransactionExpenseDetail.exp_type_code"),
    //             sequelize.col("ExpenseSubType.exp_type_code")
    //           ),
    //           required: true,
    //           on: sequelize.where(
    //             sequelize.col("TransactionExpenseDetail.exp_subtype_code"),
    //             sequelize.col("ExpenseSubType.exp_subtype_code")
    //           ),
    //         },
    //       ],
    //       ...(!!filter?.sort &&
    //         Object.keys(filter?.sort).length > 0 && {
    //           order: [
    //             [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
    //           ],
    //         }),
    //       // ...paginationOptions,
    //     });
    //     break;
    //   }
    //   case "expense_type": {
    //     let insideQuery: any = [],
    //       outsideQuery = {
    //         [Op.and]: [{ company_code: requestUser.company_code }],
    //       };
    //     outsideQuery = getSearchFilterQuery({
    //       insideQuery,
    //       filter: filter.search,
    //       outsideQuery,
    //     });
    //     totalCount = await ExpenseType.count({
    //       where: outsideQuery,
    //     });

    //     fetchedData = await ExpenseType.findAll({
    //       where: outsideQuery,
    //       ...(!!filter?.sort &&
    //         Object.keys(filter?.sort).length > 0 && {
    //           order: [
    //             [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
    //           ],
    //         }),
    //       ...paginationOptions,
    //     });
    //     break;
    //   }
    //   case "expense_sub_type": {
    //     let insideQuery: any = [],
    //       outsideQuery = {
    //         [Op.and]: [{ company_code: requestUser.company_code }],
    //       };
    //     outsideQuery = getSearchFilterQuery({
    //       insideQuery,
    //       filter: filter.search,
    //       outsideQuery,
    //     });
    //     totalCount = await ExpenseSubType.count({
    //       where: outsideQuery,
    //     });

    //     fetchedData = await ExpenseSubType.findAll({
    //       where: outsideQuery,
    //       ...(!!filter?.sort &&
    //         Object.keys(filter?.sort).length > 0 && {
    //           order: [
    //             [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
    //           ],
    //         }),
    //       ...paginationOptions,
    //     });
    //     break;
    //   }
    //   case "pl_setup":
    //     {
    //       let insideQuery: any = [],
    //         outsideQuery = {
    //           [Op.and]: [{ company_code: requestUser.company_code }],
    //         };
    //       outsideQuery = getSearchFilterQuery({
    //         insideQuery,
    //         filter: filter.search,
    //         outsideQuery,
    //       });
    //       totalCount = await AccountPlSetup.count({ where: outsideQuery });
    //       fetchedData = await AccountPlSetup.findAll({
    //         where: outsideQuery,
    //         ...(!!filter?.sort &&
    //           Object.keys(filter?.sort).length > 0 && {
    //             order: [
    //               [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
    //             ],
    //           }),
    //         ...paginationOptions,
    //       });
    //     }
    //     break;
    //   //------bl_setup-------------
    //   case "bl_setup":
    //     {
    //       let insideQuery: any = [],
    //         outsideQuery = {
    //           [Op.and]: [{ company_code: requestUser.company_code }],
    //         };
    //       outsideQuery = getSearchFilterQuery({
    //         insideQuery,
    //         filter: filter.search,
    //         outsideQuery,
    //       });
    //       totalCount = await AccountBlSetup.count({ where: outsideQuery });
    //       fetchedData = await AccountBlSetup.findAll({
    //         where: outsideQuery,
    //         ...(!!filter?.sort &&
    //           Object.keys(filter?.sort).length > 0 && {
    //             order: [
    //               [filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"],
    //             ],
    //           }),
    //         ...paginationOptions,
    //       });
    //     }
    //     break;

      

    default:
        res.status(constants.STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: "Invalid master type",
        });
        return;
    }

     res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: { tableData: fetchedData, count: totalCount },
    });
    return;

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

