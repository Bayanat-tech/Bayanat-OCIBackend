import { Response } from "express";
import constants from "../../helpers/constants";
import { ISearch, RequestWithUser } from "../../interfaces/common.interface";
import { ITrAcInvdetail } from "../../interfaces/finance/accounts/transactions/chequePaymentTransaction.interface";
import { IUser } from "../../interfaces/user.interface";
import { getChequePaymentInvoiceDetail } from "../../utils/query";
import { getSearchFilterQuery } from "../../helpers/functions";
import oracledb from "oracledb";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";

export const getFinanceListData = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  let connection;

  try {
    // Extract master parameter from request
    const { master } = req.params;
    const requestUser: IUser = req.user;
    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const offset = page * limit - limit;

    let fetchedData: unknown[] = [];
    let totalCount = 0;
    const filter: ISearch = req.query.filter
      ? JSON.parse(req.query.filter as string)
      : {};

    connection = await TenantManager.getConnection(tenantId);

    switch (master) {
      case "doc": {
        console.log("doc")
        let whereClause = `WHERE company_code = :company_code`;
        let binds: any = {
          company_code: requestUser.company_code,
        };

        if (filter?.search) {
          if (Array.isArray(filter.search)) {
            (filter.search as any[]).forEach((group, gi) => {
              if (!Array.isArray(group)) return;
              const groupClauses: string[] = [];
              group.forEach((cond: any, ci: number) => {
                const { field_name, field_value, operator } = cond;
                if (field_value === undefined || field_value === null || field_value === "") return;

                const columnMap: Record<string, string> = {
                  doc_no: "doc_no",
                  doc_type: "doc_type",
                  div_code: "div_code",
                  fy_period: "fy_period",
                  ac_code: "ac_name",
                  ac_name: "ac_name",
                  party_name: "ac_name",
                  ref_no: "ref_no",
                  ac_payee: "ac_name",
                };
                const dbField = columnMap[field_name];
                if (!dbField) return;

                const safeParam = `${dbField.replace(/\W/g, "")}_${gi}_${ci}`;
                switch ((operator || "").toLowerCase()) {
                  case "exactmatch":
                  case "=":
                    groupClauses.push(`UPPER(TO_CHAR(${dbField})) = UPPER(:${safeParam})`);
                    binds[safeParam] = field_value;
                    break;
                  case "like":
                  case "contains":
                    groupClauses.push(`UPPER(TO_CHAR(${dbField})) LIKE UPPER(:${safeParam})`);
                    binds[safeParam] = `%${field_value}%`;
                    break;
                  default:
                    groupClauses.push(`UPPER(TO_CHAR(${dbField})) LIKE UPPER(:${safeParam})`);
                    binds[safeParam] = `%${field_value}%`;
                }
              });
              if (groupClauses.length) {
                whereClause += ` AND (${groupClauses.join(" OR ")})`;
              }
            });
          } else {
            whereClause += `
              AND (
                UPPER(doc_no) LIKE UPPER(:search)
                OR UPPER(doc_type) LIKE UPPER(:search)
                OR UPPER(div_code) LIKE UPPER(:search)
              )
            `;
            binds.search = `%${filter.search}%`;
          }
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
        console.log('Get doc count from view:', countResult)

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

        fetchedData = (dataResult.rows || []).map((row: any) => {
          const mapped: any = {};
          Object.keys(row).forEach((k) => {
            mapped[k.toLowerCase()] = (row as any)[k];
          });
          return mapped;
        });
        console.log('Get data from doc :', fetchedData);
      };
        break;

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
      }
        break;

      //     case "account": {
      //         console.log('account master')
      //       let whereClause = `WHERE a.company_code = :company_code`;
      //       let bindParams: any = {
      //         company_code: requestUser.company_code,
      //       };

      //       if (filter?.search) {
      //         whereClause += `
      //           AND (
      //             a.ac_code LIKE :search
      //             OR a.ac_name LIKE :search
      //           )
      //         `;
      //         bindParams.search = `%${filter.search}%`;
      //       }

      // // Sorting 
      // const sortColumnMap: Record<string, string> = {
      //   ac_code: "AC_CODE",
      //   ac_name: "AC_NAME",
      //   created_at: "CREATE_DATE",
      //   updated_at: "EDIT_DATE",
      // };

      // let orderByClause = "";
      // if (filter?.sort?.field_name) {
      //   const column = sortColumnMap[filter.sort.field_name];
      //   if (column) {
      //     orderByClause = `ORDER BY ${column} ${filter.sort.desc ? "DESC" : "ASC"}`;
      //   }
      // }
      //       // let orderByClause = ``;
      //       // if (filter?.sort && Object.keys(filter.sort).length > 0) {
      //       //   orderByClause = `
      //       //     ORDER BY ${filter.sort.field_name} ${
      //       //     filter.sort.desc ? "DESC" : "ASC"
      //       //   }
      //       //   `;
      //       // }

      //       const countResult = await connection.execute(
      //         `
      //         SELECT COUNT(*) AS TOTAL_COUNT
      //         FROM MS_ACCODES a
      //         ${whereClause}
      //         `,
      //         bindParams,
      //         { outFormat: oracledb.OUT_FORMAT_OBJECT }
      //       );

      //       totalCount =
      //         (countResult.rows?.[0] as { TOTAL_COUNT?: number })?.TOTAL_COUNT ?? 0;

      //       const dataResult = await connection.execute(
      //         `
      //          SELECT
      //     a.ac_code     AS "ac_code",
      //     a.ac_name     AS "ac_name",
      //     a.create_date AS "created_at",
      //     a.edit_date   AS "updated_at"
      //   FROM MS_ACCODES a
      //         ${whereClause}
      //         ${orderByClause}
      //         OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
      //         `,
      //         {
      //           ...bindParams,
      //           offset,
      //           limit,
      //         },
      //         { outFormat: oracledb.OUT_FORMAT_OBJECT }
      //       );

      //       fetchedData = dataResult.rows || [];
      //     }
      //       break;

      case "account": {
        console.log("account master");

        let whereClause = `
    WHERE company_code = :company_code
      AND doc_id = :doc_id
      AND hdr_dtl = :hdr_dtl
      AND (div_code = :div_code OR div_code = '*')
  `;

        const accountFilter = filter as ISearch & { doc_id?: string; hdr_dtl?: string; div_code?: string };

        let bindParams: any = {
          company_code: requestUser.company_code,
          doc_id: accountFilter.doc_id,
          hdr_dtl: accountFilter.hdr_dtl,
          div_code: accountFilter.div_code,
        };

        if (filter?.search) {
          whereClause += `
      AND (
        ac_code LIKE :search
        OR ac_name LIKE :search
      )
    `;
          bindParams.search = `%${filter.search}%`;
        }

        const sortColumnMap: Record<string, string> = {
          ac_code: "AC_CODE",
          ac_name: "AC_NAME",
        };

        let orderByClause = "ORDER BY AC_CODE ASC";
        if (filter?.sort?.field_name) {
          const column = sortColumnMap[filter.sort.field_name];
          if (column) {
            orderByClause = `ORDER BY ${column} ${filter.sort.desc ? "DESC" : "ASC"}`;
          }
        }

        // COUNT QUERY
        const countResult = await connection.execute(
          `
    SELECT COUNT(*) AS TOTAL_COUNT
    FROM VW_HDR_DOC_ACCOUNTS
    ${whereClause}
    `,
          bindParams,
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        totalCount =
          (countResult.rows?.[0] as { TOTAL_COUNT?: number })?.TOTAL_COUNT ?? 0;

        // DATA QUERY
        const dataResult = await connection.execute(
          `
    SELECT ac_code AS "ac_code", 
           ac_name AS "ac_name", 
           curr_code AS "curr_code", 
           l4_bill AS "l4_bill", 
           l4_description AS "l4_description",
           address AS "address", 
           fax AS "fax", 
           phone AS "phone", 
           salesman_code AS "salesman_code", 
           sector_code AS "sector_code"
    FROM VW_HDR_DOC_ACCOUNTS
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

        // Ensure lowercase column names by normalizing
        fetchedData = (dataResult.rows || []).map((row: any) => {
          const normalizedRow: any = {};
          Object.keys(row).forEach((key) => {
            normalizedRow[key.toLowerCase()] = row[key];
          });
          return normalizedRow;
        });

        break;
      }


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
        OR UPPER(tx_compntcat_name) LIKE UPPER(:search)
      )
    `;
          binds.search = `%${filter.search}%`;
        }

        // SORTING
        const sortColumnMap: Record<string, string> = {
          tx_compntcat_code: "TX_COMPNTCAT_CODE",
          tx_compntcat_name: "TX_COMPNTCAT_NAME",
          created_at: "CREATE_DATE",
          updated_at: "EDIT_DATE",
        };

        let orderByClause = "ORDER BY TX_COMPNTCAT_CODE";
        if (filter?.sort?.field_name) {
          const column = sortColumnMap[filter.sort.field_name];
          if (column) {
            orderByClause = `ORDER BY ${column} ${filter.sort.desc ? "DESC" : "ASC"
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
      tx_compntcat_code AS "tx_compntcat_code",
      tx_compntcat_name AS "tx_compntcat_name"
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

      case "invoice": {
        const {
          code,
          extra_param1,
          extra_param2,
          extra_param3,
          extra_param4,
        } = req.query;

        let defaultData: { [key: string]: any } = {};

        const invoiceResult = await connection.execute(
          `
    ${getChequePaymentInvoiceDetail}
    `,
          {
            company_code: req.user.company_code,
            ac_code: code,
            div_code: extra_param1,
            invrsno: `${extra_param2}${extra_param3}${extra_param4}`,
          },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        // Use the outer `fetchedData` (do not shadow it) so the response includes data and count consistently
        fetchedData = invoiceResult.rows || [];

        const fetchedInvoiceNumbers = (fetchedData as any[]).map((row: any) => {
          defaultData[row.inv_no] = row;
          return row.inv_no;
        });



        const existingResult = await connection.execute(
          `
    SELECT
      tid.*,
      c.curr_name
    FROM TR_AC_INVDETAIL tid
    LEFT JOIN MS_CURRENCY c
      ON tid.curr_code = c.curr_code
    WHERE tid.company_code = :company_code
      AND tid.doc_type = :doc_type
      AND tid.doc_no   = :doc_no
      AND tid.serial_no = :serial_no
    `,
          {
            company_code: req.user.company_code,
            doc_type: extra_param2,
            doc_no: extra_param3,
            serial_no: extra_param4,
          },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const existingInvoiceDetails = existingResult.rows || [];

        let maxDtlSrNo = 0;
        const existingInvoiceInvNos = existingInvoiceDetails.map((row: any) => {
          maxDtlSrNo = Math.max(maxDtlSrNo, row.dtl_sr_no || 0);
          return row.inv_no;
        });

        const matchedData: any[] = [];
        const remainingExistingInvoices: any[] = [];

        for (const eachExistingData of existingInvoiceDetails) {
          const existingData = eachExistingData as any;
          if (fetchedInvoiceNumbers.includes(existingData.inv_no)) {
            matchedData.push({
              ...existingData,
              inv_amt: defaultData[existingData.inv_no]?.inv_amt ?? 0,
              c_bal_amt_org:
                defaultData[existingData.inv_no]?.c_bal_amt_org ?? 0,
            });
          } else {
            remainingExistingInvoices.push({
              ...existingData,
              IsDeletable: true,
            });
          }
        }

        const newFetchedDataWithDtlSrNo = fetchedData.filter((item: any) => {
          if (!existingInvoiceInvNos.includes(item.inv_no)) {
            maxDtlSrNo += 1;
            item.dtl_sr_no = maxDtlSrNo;
            item.IsDeletable = false;
            return true;
          }
          return false;
        });

        fetchedData = [
          ...matchedData,
          ...newFetchedDataWithDtlSrNo,
          ...remainingExistingInvoices,
        ].map((row: any) => {
          const mapped: any = {};
          Object.keys(row).forEach((k) => {
            mapped[k.toLowerCase()] = (row as any)[k];
          });
          return mapped;
        });

        totalCount = fetchedData.length;
      }
        break;


      case "ac_code_search": {
        console.log("account code search");
        let whereClause = `
    WHERE company_code = :company_code
      AND doc_id = :doc_id
      AND hdr_dtl = :hdr_dtl
      AND (div_code = :div_code)
  `;

        const accountFilter = filter as ISearch & { doc_id?: string; hdr_dtl?: string; div_code?: string };

        let binds: any = {
          company_code: requestUser.company_code,
          doc_id: accountFilter.doc_id,
          hdr_dtl: accountFilter.hdr_dtl,
          div_code: accountFilter.div_code,
        };
        console.log("Initial binds:", binds);

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
        };

        let orderByClause = "ORDER BY AC_CODE";
        if (filter?.sort?.field_name) {
          const column = sortColumnMap[filter.sort.field_name];
          if (column) {
            orderByClause = `ORDER BY ${column} ${filter.sort.desc ? "DESC" : "ASC"
              }`;
          }
        }

        // COUNT
        const countResult = await connection.execute(
          // `
          //   SELECT COUNT(*) AS TOTAL_COUNT
          //   FROM VW_AC_CODES_SEARCH
          //   ${whereClause}
          //   `,

          `
    SELECT COUNT(*) AS TOTAL_COUNT
    FROM VW_HDR_DOC_ACCOUNTS
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
    ac_code AS "ac_code",
    ac_name AS "ac_name"
    FROM VW_HDR_DOC_ACCOUNTS
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


      case "job_no": {
        console.log("finance Job No");

        let whereClause = `
    WHERE company_code = :company_code
  `;

        let binds: any = {
          company_code: requestUser.company_code,
        };

        // SEARCH FILTER (equivalent to getSearchFilterQuery)
        if (filter?.search) {
          whereClause += `
      AND (
        UPPER(job_no) LIKE UPPER(:search)
        OR UPPER(prin_code) LIKE UPPER(:search)
        OR UPPER(doc_ref) LIKE UPPER(:search)
        OR UPPER(dept_code) LIKE UPPER(:search)
      )
    `;
          binds.search = `%${filter.search}%`;
        }

        // SORTING
        const sortColumnMap: Record<string, string> = {
          job_no: "JOB_NO",
        };

        let orderByClause = "ORDER BY JOB_NO DESC";
        if (filter?.sort?.field_name) {
          const column = sortColumnMap[filter.sort.field_name];
          if (column) {
            orderByClause = `ORDER BY ${column} ${filter.sort.desc ? "DESC" : "ASC"
              }`;
          }
        }

        const countResult = await connection.execute(
          `
    SELECT COUNT(*) AS TOTAL_COUNT
    FROM TI_JOB
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
      job_no as "job_no",
      job_date as "job_date",
      confirm_date as "confirm_date",
      prin_code as "prin_code",
      doc_ref as "doc_ref",
      dept_code as "dept_code"
    FROM TI_JOB
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

      case "job": {
        console.log("finance Job ");
        let whereClause = `
          WHERE company_code = :company_code
        `;

        let binds: any = {
          company_code: requestUser.company_code,
        };

        // if (filter?.search) {
        //   whereClause += `
        //     AND (
        //       UPPER(job_no) LIKE UPPER(:search)
        //       OR UPPER(doc_no) LIKE UPPER(:search)
        //       OR UPPER(prin_code) LIKE UPPER(:search)
        //       OR UPPER(doc_refno) LIKE UPPER(:search)
        //     )
        //   `;
        //   binds.search = `%${filter.search}%`;
        // }
        if (filter?.search) {
          whereClause += `
            AND (
              UPPER(job_no) LIKE UPPER(:search)
              OR UPPER(doc_no) LIKE UPPER(:search)
              OR UPPER(doc_refno) LIKE UPPER(:search)
            )
          `;
          binds.search = `%${filter.search}%`;
        }
        console.log("-------------------->", filter?.search, binds)

        // SORTING
        const sortColumnMap: Record<string, string> = {
          job_no: "JOB_NO",
          doc_no: "DOC_NO",
        };

        let orderByClause = "";
        if (filter?.sort?.field_name) {
          const column = sortColumnMap[filter.sort.field_name];
          if (column) {
            orderByClause = `ORDER BY ${column} ${filter.sort.desc ? "DESC" : "ASC"
              }`;
          }
        }

        // COUNT
        const countResult = await connection.execute(
          `
          SELECT COUNT(*) AS TOTAL_COUNT
          FROM TR_AC_JOBDETAIL
          ${whereClause}
          `,
          binds,
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        totalCount =
          (countResult.rows?.[0] as { TOTAL_COUNT?: number })?.TOTAL_COUNT ?? 0;


        console.log(`SELECT *
          FROM TR_AC_JOBDETAIL
          ${whereClause}
          ${orderByClause}
          `)
        const dataResult = await connection.execute(
          `
          SELECT *
          FROM TR_AC_JOBDETAIL
          ${whereClause}
          ${orderByClause}
          `,
          binds,
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        fetchedData = dataResult.rows || [];
        console.log("Get data from job detail:", fetchedData);
      }
        break;


      case "expense": {
        let whereClause = `
    WHERE ted.company_code = :company_code
  `;

        let binds: any = {
          company_code: requestUser.company_code,
        };

        //  SEARCH (equivalent to getSearchFilterQuery)
        if (filter?.search) {
          whereClause += `
      AND (
        UPPER(ted.exp_type_code) LIKE UPPER(:search)
        OR UPPER(ted.exp_subtype_code) LIKE UPPER(:search)
        OR UPPER(et.exp_description) LIKE UPPER(:search)
        OR UPPER(est.exp_subtype_description) LIKE UPPER(:search)
      )
    `;
          binds.search = `%${filter.search}%`;
        }

        //  SORTING
        const sortColumnMap: Record<string, string> = {
          exp_type_code: "ted.EXP_TYPE_CODE",
          exp_subtype_code: "ted.EXP_SUBTYPE_CODE",
          exp_description: "et.EXP_DESCRIPTION",
          exp_subtype_description: "est.EXP_SUBTYPE_DESCRIPTION",
          created_at: "ted.CREATE_DATE",
          updated_at: "ted.EDIT_DATE",
        };

        let orderByClause = "";
        if (filter?.sort?.field_name) {
          const column = sortColumnMap[filter.sort.field_name];
          if (column) {
            orderByClause = `ORDER BY ${column} ${filter.sort.desc ? "DESC" : "ASC"
              }`;
          }
        }

        //  COUNT
        const countResult = await connection.execute(
          `
    SELECT COUNT(*) AS TOTAL_COUNT
    FROM TR_AC_EXPDETAIL ted
    INNER JOIN MS_AC_EXPSUBTYPE est
      ON ted.exp_type_code = est.exp_type_code
     AND ted.exp_subtype_code = est.exp_subtype_code
    LEFT JOIN MS_AC_EXPCODE et
      ON ted.exp_type_code = et.exp_type_code
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
      ted.*,
      et.exp_description,
      est.exp_subtype_description
    FROM TR_AC_EXPDETAIL ted
    INNER JOIN MS_AC_EXPSUBTYPE est
      ON ted.exp_type_code = est.exp_type_code
     AND ted.exp_subtype_code = est.exp_subtype_code
    LEFT JOIN MS_AC_EXPCODE et
      ON ted.exp_type_code = et.exp_type_code
    ${whereClause}
    ${orderByClause}
    `,
          binds,
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        fetchedData = dataResult.rows || [];
      }
        break;

      case "expense_type": {
        let whereClause = `WHERE company_code = :company_code`;
        let binds: any = {
          company_code: requestUser.company_code,
        };

        if (filter?.search) {
          whereClause += `
      AND (
        UPPER(exp_code) LIKE UPPER(:search)
        OR UPPER(exp_description) LIKE UPPER(:search)
      )
      `;
          binds.search = `%${filter.search}%`;
        }

        const countResult = await connection.execute(
          `
    SELECT COUNT(*) AS TOTAL_COUNT
    FROM MS_AC_EXPCODE
    ${whereClause}
    `,
          binds,
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        totalCount = (countResult.rows?.[0] as { TOTAL_COUNT?: number })?.TOTAL_COUNT ?? 0;

        let orderByClause = `ORDER BY exp_code`;
        if (filter?.sort?.field_name) {
          orderByClause = `
      ORDER BY ${filter.sort.field_name} ${filter.sort.desc ? 'DESC' : 'ASC'}
    `;
        }

        const dataResult = await connection.execute(
          `
    SELECT
      exp_code,
      exp_description
    FROM MS_AC_EXPCODE
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

      case "expense_sub_type": {
        let whereClause = `WHERE company_code = :company_code`;
        let binds: any = {
          company_code: requestUser.company_code,
        };

        if (filter?.search) {
          whereClause += `
      AND (
        UPPER(exp_subtype_code) LIKE UPPER(:search)
        OR UPPER(exp_subtype_description) LIKE UPPER(:search)
      )
    `;
          binds.search = `%${filter.search}%`;
        }

        const countResult = await connection.execute(
          `
    SELECT COUNT(*) AS TOTAL_COUNT
    FROM MS_AC_EXPSUBTYPE
    ${whereClause}
    `,
          binds,
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        totalCount = (countResult.rows?.[0] as { TOTAL_COUNT?: number })?.TOTAL_COUNT ?? 0;

        let orderByClause = `ORDER BY exp_subtype_code`;
        if (filter?.sort?.field_name) {
          orderByClause = `
      ORDER BY ${filter.sort.field_name} ${filter.sort.desc ? 'DESC' : 'ASC'}
    `;
        }

        const dataResult = await connection.execute(
          `
    SELECT
      exp_type_code,
      exp_subtype_code,
      exp_subtype_description
    FROM MS_AC_EXPSUBTYPE
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

      case "pl_setup": {
        let whereClause = `WHERE company_code = :company_code`;
        let binds: any = {
          company_code: requestUser.company_code,
        };

        if (filter?.search) {
          whereClause += `
      AND (
        UPPER(pl_code) LIKE UPPER(:search)
        OR UPPER(pl_description) LIKE UPPER(:search)
      )
    `;
          binds.search = `%${filter.search}%`;
        }

        const countResult = await connection.execute(
          `
    SELECT COUNT(*) AS TOTAL_COUNT
    FROM MS_AC_PLSETUP
    ${whereClause}
    `,
          binds,
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        totalCount = (countResult.rows?.[0] as { TOTAL_COUNT?: number })?.TOTAL_COUNT ?? 0;

        let orderByClause = `ORDER BY pl_code`;
        if (filter?.sort?.field_name) {
          orderByClause = `
      ORDER BY ${filter.sort.field_name} ${filter.sort.desc ? 'DESC' : 'ASC'}
    `;
        }

        const dataResult = await connection.execute(
          `
    SELECT *
    FROM MS_AC_PLSETUP
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

      case "bl_setup": {
        let whereClause = `WHERE company_code = :company_code`;
        let binds: any = {
          company_code: requestUser.company_code,
        };

        // SEARCH
        if (filter?.search) {
          whereClause += `
      AND (
        UPPER(bl_code) LIKE UPPER(:search)
        OR UPPER(bl_description) LIKE UPPER(:search)
      )
    `;
          binds.search = `%${filter.search}%`;
        }

        // COUNT
        const countResult = await connection.execute(
          `
    SELECT COUNT(*) AS TOTAL_COUNT
    FROM MS_AC_BLSETUP
    ${whereClause}
    `,
          binds,
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        totalCount = (countResult.rows?.[0] as { TOTAL_COUNT?: number })?.TOTAL_COUNT ?? 0;

        // SORT
        let orderByClause = `ORDER BY bl_code`;
        if (filter?.sort?.field_name) {
          orderByClause = `
      ORDER BY ${filter.sort.field_name} ${filter.sort.desc ? "DESC" : "ASC"}
    `;
        }

        const dataResult = await connection.execute(
          `
    SELECT *
    FROM MS_AC_BLSETUP
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
