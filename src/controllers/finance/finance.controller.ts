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
                  doc_date: "doc_date",
                  date: "doc_date",
                  ac_code: "ac_code",
                  ac_name: "ac_name",
                  party_name: "ac_name",
                  ref_no: "ref_no",
                  ac_payee: "ac_payee",
                  cheque_no: "cheque_no",
                  canceled: "canceled",
                  cancelled: "canceled",
                  status: "canceled",
                  doc_status: "canceled",
                };
                const dbField = columnMap[field_name];
                if (!dbField) return;

                const safeParam = `${dbField.replace(/\W/g, "")}_${gi}_${ci}`;

                if (dbField === "canceled") {
                  const normVal = String(field_value).trim().toUpperCase();
                  if (normVal === "Y" || normVal.startsWith("CANCEL")) {
                    groupClauses.push(`UPPER(NVL(canceled, 'N')) = 'Y'`);
                  } else if (normVal === "N" || normVal.startsWith("ACTIVE")) {
                    groupClauses.push(`UPPER(NVL(canceled, 'N')) = 'N'`);
                  } else {
                    groupClauses.push(`UPPER(NVL(canceled, 'N')) = UPPER(:${safeParam})`);
                    binds[safeParam] = normVal;
                  }
                  return;
                }

                if (dbField === "doc_date") {
                  let fromVal: string | undefined;
                  let toVal: string | undefined;

                  if (typeof field_value === "object" && field_value !== null) {
                    fromVal = (field_value as any).from;
                    toVal = (field_value as any).to;
                  } else if (typeof field_value === "string") {
                    try {
                      const parsed = JSON.parse(field_value);
                      if (parsed && typeof parsed === "object") {
                        fromVal = parsed.from;
                        toVal = parsed.to;
                      }
                    } catch {
                      const match = field_value.match(/\d{4}-\d{2}-\d{2}/);
                      if (match) {
                        fromVal = match[0];
                        toVal = match[0];
                      }
                    }
                  }

                  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
                  if (fromVal && dateRegex.test(String(fromVal).slice(0, 10))) fromVal = String(fromVal).slice(0, 10);
                  else fromVal = undefined;
                  if (toVal && dateRegex.test(String(toVal).slice(0, 10))) toVal = String(toVal).slice(0, 10);
                  else toVal = undefined;

                  if (fromVal && toVal) {
                    const pFrom = `doc_date_from_${gi}_${ci}`;
                    const pTo = `doc_date_to_${gi}_${ci}`;
                    groupClauses.push(`TRUNC(doc_date) >= TO_DATE(:${pFrom}, 'YYYY-MM-DD') AND TRUNC(doc_date) <= TO_DATE(:${pTo}, 'YYYY-MM-DD')`);
                    binds[pFrom] = fromVal;
                    binds[pTo] = toVal;
                  } else if (fromVal) {
                    const pFrom = `doc_date_from_${gi}_${ci}`;
                    groupClauses.push(`TRUNC(doc_date) >= TO_DATE(:${pFrom}, 'YYYY-MM-DD')`);
                    binds[pFrom] = fromVal;
                  } else if (toVal) {
                    const pTo = `doc_date_to_${gi}_${ci}`;
                    groupClauses.push(`TRUNC(doc_date) <= TO_DATE(:${pTo}, 'YYYY-MM-DD')`);
                    binds[pTo] = toVal;
                  }
                  return;
                }

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
                OR UPPER(NVL(ac_name, ' ')) LIKE UPPER(:search)
                OR UPPER(NVL(ref_no, ' ')) LIKE UPPER(:search)
                OR UPPER(NVL(cheque_no, ' ')) LIKE UPPER(:search)
                OR UPPER(NVL(ac_payee, ' ')) LIKE UPPER(:search)
              )
            `;
            binds.search = `%${filter.search}%`;
          }
        }

        // The search view can repeat one header when its account joins find more
        // than one matching account row. A finance document is identified by its
        // company, document type and document number. Deduplicate on that key
        // before counting and paging so another company's matching document is
        // never merged with this one.
        const documentSource = `(
          SELECT ranked.* FROM (
            SELECT source.*,
                   ROW_NUMBER() OVER (
                     PARTITION BY company_code, doc_type, doc_no
                     ORDER BY doc_date DESC NULLS LAST
                   ) AS document_row_rank
            FROM VW_AC_HEADER_SEARCH source
            ${whereClause}
          ) ranked
          WHERE document_row_rank = 1
        )`;

        const countResult = await connection.execute(
          `
          SELECT COUNT(*) AS TOTAL_COUNT
          FROM ${documentSource}
          `,
          binds,
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('Get doc count from view:', countResult)

        const countRow = countResult.rows?.[0] as { TOTAL_COUNT?: number };
        totalCount = countRow?.TOTAL_COUNT ?? 0;

        const dataResult = await connection.execute(
          `
          SELECT ranked.*,
                 COALESCE(
                   ranked.ac_name,
                   (SELECT m.ac_name 
                    FROM tr_ac_detail d, MS_ACCODES m 
                    WHERE d.company_code = ranked.company_code 
                      AND d.doc_type = ranked.doc_type 
                      AND d.doc_no = ranked.doc_no 
                      AND d.ac_code = m.ac_code(+) 
                      AND ROWNUM = 1)
                 ) AS resolved_ac_name,
                 COALESCE(
                   ranked.amount,
                   (SELECT GREATEST(
                             NVL(SUM(CASE WHEN d.sign_ind = 1 THEN d.lcur_amount ELSE 0 END), 0),
                             NVL(SUM(CASE WHEN d.sign_ind = -1 THEN d.lcur_amount ELSE 0 END), 0)
                           )
                    FROM tr_ac_detail d
                    WHERE d.company_code = ranked.company_code 
                      AND d.doc_type = ranked.doc_type 
                      AND d.doc_no = ranked.doc_no)
                 ) AS resolved_amount
          FROM ${documentSource} ranked
          ORDER BY doc_no DESC, doc_type
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
            if (k.toLowerCase() !== "document_row_rank") mapped[k.toLowerCase()] = (row as any)[k];
          });
          if (mapped.resolved_ac_name !== undefined) mapped.ac_name = mapped.resolved_ac_name;
          if (mapped.resolved_amount !== undefined) mapped.amount = mapped.resolved_amount;
          return mapped;
        });
        console.log('Get data from doc count:', fetchedData.length);
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
          SELECT 
            fy_period AS "fy_period",
            date_from AS "date_from",
            date_to AS "date_to",
            sort_order AS "sort_order"
          FROM MS_FY_PERIOD
          ${whereClause}
          ORDER BY sort_order, fy_period
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
      tx_compntcat_name AS "tx_compntcat_name",
      NVL(tx_type, 'N') AS "tx_type",
      NVL(tx_percnt, 0) AS "tx_percnt"
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

        const voucherType = String(extra_param2 || "").toUpperCase();
        const isReceipt = ["BR", "CR", "RJV", "CN"].includes(voucherType);
        const isPayment = ["BP", "CP", "PJV", "DN"].includes(voucherType);
        const isInvoicePI = voucherType === "PI";
        const isInvoiceSI = ["SI", "SV"].includes(voucherType);

        // 1. Primary: Query TR_AC_HEADER for all open invoices for this account & division
        let headerInvoices: any[] = [];
        const knownDocNos = new Set<string>();
        const knownRefNos = new Set<string>();
        const knownKeys = new Set<string>();

        try {
          const headerInvoicesResult = await connection.execute(
            `SELECT 
               h.doc_no AS inv_no,
               h.doc_no,
               h.ref_no,
               h.doc_date AS inv_date,
               NVL((
                 SELECT MAX(NVL(invd.amount_origin, ABS(invd.lcur_amount)))
                 FROM TR_AC_INVDETAIL invd
                 WHERE invd.company_code = h.company_code
                   AND invd.doc_type     = h.doc_type
                   AND invd.doc_no       = h.doc_no
                   AND invd.indicator_origin = 'Y'
               ), NVL((
                 SELECT ABS(NVL(d.lcur_amount, d.amount))
                 FROM TR_AC_DETAIL d
                 WHERE d.company_code = h.company_code
                   AND d.doc_type     = h.doc_type
                   AND d.doc_no       = h.doc_no
                   AND d.serial_no    = 9001
               ), (
                 SELECT NVL(SUM(CASE WHEN d.ac_code = h.ac_code THEN ABS(NVL(d.lcur_amount, d.amount)) END),
                            SUM(ABS(NVL(d.lcur_amount, d.amount))) / 2)
                 FROM TR_AC_DETAIL d
                 WHERE d.company_code = h.company_code
                   AND d.doc_type     = h.doc_type
                   AND d.doc_no       = h.doc_no
                   AND d.serial_no    <> 9001
               ))) AS inv_amt,
               h.curr_code AS c_curr_code_origin,
               h.ex_rate AS c_ex_rate_origin,
               h.div_code,
               h.ac_code,
               h.company_code,
               h.doc_type AS origin_doc_type,
               NVL((
                 SELECT SUM(ABS(d.lcur_amount))
                 FROM TR_AC_INVDETAIL d
                 JOIN TR_AC_HEADER pay_h
                   ON pay_h.company_code = d.company_code
                  AND pay_h.doc_no       = d.doc_no
                  AND pay_h.doc_type     = d.doc_type
                  AND NVL(pay_h.canceled, 'N') = 'N'
                 WHERE d.company_code = h.company_code
                   AND d.div_code     = h.div_code
                   AND (d.ac_code = h.ac_code OR pay_h.ac_code = h.ac_code)
                   AND (
                     (h.doc_type IN ('PI', 'PO') AND pay_h.doc_type IN ('BP', 'CP', 'PJV', 'DN', 'JV', 'UJV', 'CN'))
                     OR (h.doc_type IN ('SI', 'SV', 'IV') AND pay_h.doc_type IN ('BR', 'CR', 'RJV', 'CN', 'JV', 'UJV', 'DN'))
                     OR (h.doc_type NOT IN ('PI', 'PO', 'SI', 'SV', 'IV'))
                   )
                   AND (d.inv_no = h.doc_no OR (h.ref_no IS NOT NULL AND d.inv_no = h.ref_no))
                   AND NVL(d.indicator_origin, 'N') = 'N'
                   AND (TRIM(d.doc_type) || TRIM(TO_CHAR(d.doc_no)) || TRIM(TO_CHAR(d.serial_no)) <> :invrsno)
               ), 0) AS amount
             FROM TR_AC_HEADER h
             WHERE h.company_code = :company_code
               AND (:div_code IS NULL OR :div_code = '' OR :div_code = '*' OR h.div_code = :div_code)
               AND h.ac_code      = :ac_code
               AND NVL(h.canceled, 'N') = 'N'
               AND (
                 (:is_receipt = 1 AND h.doc_type IN ('SI', 'SV', 'IV'))
                 OR (:is_payment = 1 AND h.doc_type IN ('PI', 'PO'))
                 OR (:is_invoice_pi = 1 AND h.doc_type IN ('BP', 'CP', 'PJV', 'DN'))
                 OR (:is_invoice_si = 1 AND h.doc_type IN ('BR', 'CR', 'RJV', 'CN'))
                 OR (:is_receipt = 0 AND :is_payment = 0 AND :is_invoice_pi = 0 AND :is_invoice_si = 0)
               )`,
            {
              company_code: req.user.company_code,
              div_code: extra_param1,
              ac_code: code,
              invrsno: `${extra_param2}${extra_param3}${extra_param4}`,
              is_receipt: isReceipt ? 1 : 0,
              is_payment: isPayment ? 1 : 0,
              is_invoice_pi: isInvoicePI ? 1 : 0,
              is_invoice_si: isInvoiceSI ? 1 : 0,
            },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
          );

          (headerInvoicesResult.rows || []).forEach((hRow: any) => {
            const docNo = String(hRow.DOC_NO || hRow.doc_no || '').trim();
            const refNo = String(hRow.REF_NO || hRow.ref_no || '').trim();
            const primaryInvNo = refNo || docNo;

            // Register all invoice documents from TR_AC_HEADER so secondary query NEVER resurrects paid or duplicate invoices
            if (docNo) { knownDocNos.add(docNo.toUpperCase()); knownKeys.add(docNo.toUpperCase()); }
            if (refNo) { knownRefNos.add(refNo.toUpperCase()); knownKeys.add(refNo.toUpperCase()); }
            if (primaryInvNo) { knownKeys.add(primaryInvNo.toUpperCase()); }

            const invAmt = Number(hRow.INV_AMT || hRow.inv_amt || 0);
            const paidAmt = Number(hRow.AMOUNT || hRow.amount || 0);
            const bal = Math.max(0, invAmt - paidAmt);
            if (bal > 0.001) {
              const rowObj: any = {
                inv_no: primaryInvNo,
                doc_no: docNo,
                ref_no: docNo,
                inv_date: hRow.INV_DATE || hRow.inv_date,
                amount: paidAmt,
                sign_ind: 1,
                ac_code: hRow.AC_CODE || hRow.ac_code,
                company_code: hRow.COMPANY_CODE || hRow.company_code,
                inv_amt: invAmt,
                c_curr_code: ' ',
                c_curr_amt: 0.0,
                c_indicator_origin: 'N',
                c_curr_code_origin: hRow.C_CURR_CODE_ORIGIN || hRow.c_curr_code_origin,
                c_ex_rate_origin: hRow.C_EX_RATE_ORIGIN || hRow.c_ex_rate_origin,
                c_bal_amt_org: bal,
                job_no: null,
                bl_no: null,
                doc_ref: null,
                div_code: hRow.DIV_CODE || hRow.div_code,
                origin_doc_type: hRow.ORIGIN_DOC_TYPE || hRow.origin_doc_type,
              };
              headerInvoices.push(rowObj);
            }
          });
        } catch (hdrErr) {
          console.warn('[finance.controller invoice] Header invoices query error:', hdrErr);
        }

        // Also register CANCELLED documents from TR_AC_HEADER so they are NEVER resurrected by legacy/fallback queries
        try {
          const cancelledRes = await connection.execute(
            `SELECT UPPER(TRIM(doc_no)) AS doc_no, UPPER(TRIM(ref_no)) AS ref_no 
             FROM TR_AC_HEADER 
             WHERE company_code = :company_code AND (:div_code IS NULL OR :div_code = '' OR :div_code = '*' OR div_code = :div_code) AND NVL(canceled, 'N') = 'Y'`,
            { company_code: req.user.company_code, div_code: extra_param1 },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
          );
          (cancelledRes.rows || []).forEach((cRow: any) => {
            if (cRow.DOC_NO) { knownDocNos.add(String(cRow.DOC_NO).toUpperCase()); knownKeys.add(String(cRow.DOC_NO).toUpperCase()); }
            if (cRow.REF_NO) { knownRefNos.add(String(cRow.REF_NO).toUpperCase()); knownKeys.add(String(cRow.REF_NO).toUpperCase()); }
          });
        } catch (cErr) {
          console.warn('[finance.controller invoice] Cancelled invoices check error:', cErr);
        }

        // 2. Secondary: Query TR_AC_INVDETAIL for any legacy open items not found in TR_AC_HEADER
        let legacyInvoices: any[] = [];
        try {
          const invoiceResult = await connection.execute(
            `\n${getChequePaymentInvoiceDetail}\n`,
            {
              company_code: req.user.company_code,
              ac_code: code,
              div_code: extra_param1,
              invrsno: `${extra_param2}${extra_param3}${extra_param4}`,
            },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
          );

          let rawInvoices = (invoiceResult.rows || []) as any[];
          if (isReceipt) {
            rawInvoices = rawInvoices.filter((row: any) => {
              const dt = String(row.ORIGIN_DOC_TYPE || row.origin_doc_type || "").toUpperCase();
              return !["PI", "PO", "BP", "CP", "PJV"].includes(dt);
            });
          } else if (isPayment) {
            rawInvoices = rawInvoices.filter((row: any) => {
              const dt = String(row.ORIGIN_DOC_TYPE || row.origin_doc_type || "").toUpperCase();
              return !["SI", "SV", "IV", "BR", "CR", "RJV"].includes(dt);
            });
          } else if (isInvoicePI) {
            rawInvoices = rawInvoices.filter((row: any) => {
              const dt = String(row.ORIGIN_DOC_TYPE || row.origin_doc_type || "").toUpperCase();
              return ["BP", "CP", "PJV", "DN"].includes(dt);
            });
          } else if (isInvoiceSI) {
            rawInvoices = rawInvoices.filter((row: any) => {
              const dt = String(row.ORIGIN_DOC_TYPE || row.origin_doc_type || "").toUpperCase();
              return ["BR", "CR", "RJV", "CN"].includes(dt);
            });
          }

          rawInvoices.forEach((r: any) => {
            const rDocNo = String(r.DOC_NO || r.doc_no || '').trim().toUpperCase();
            const rInvNo = String(r.INV_NO || r.inv_no || '').trim().toUpperCase();
            const rRefNo = String(r.REF_NO || r.ref_no || '').trim().toUpperCase();

            // Strict deduplication: skip if already in TR_AC_HEADER by doc_no, inv_no, or ref_no
            if (rDocNo && knownKeys.has(rDocNo)) return;
            if (rInvNo && knownKeys.has(rInvNo)) return;
            if (rRefNo && knownKeys.has(rRefNo)) return;
            if (knownDocNos.has(rDocNo) || knownDocNos.has(rInvNo)) return;
            if (rRefNo && (knownRefNos.has(rRefNo) || knownDocNos.has(rRefNo))) return;
            if (rInvNo && knownRefNos.has(rInvNo)) return;

            legacyInvoices.push(r);
            if (rDocNo) { knownDocNos.add(rDocNo); knownKeys.add(rDocNo); }
            if (rInvNo) { knownDocNos.add(rInvNo); knownKeys.add(rInvNo); }
            if (rRefNo) { knownRefNos.add(rRefNo); knownKeys.add(rRefNo); }
          });
        } catch (invErr) {
          console.warn('[finance.controller invoice] TR_AC_INVDETAIL query error:', invErr);
        }

        // Final strict deduplication across both queries by invoice/voucher identifier
        const combinedInvoices = [...headerInvoices, ...legacyInvoices];
        const seenInvoiceKeys = new Set<string>();
        const uniqueInvoices: any[] = [];
        for (const item of combinedInvoices) {
          const dNo = String(item.DOC_NO || item.doc_no || '').trim().toUpperCase();
          const iNo = String(item.INV_NO || item.inv_no || '').trim().toUpperCase();
          const rNo = String(item.REF_NO || item.ref_no || '').trim().toUpperCase();
          const id = dNo || iNo || rNo;
          if (!id) continue;
          if ((dNo && seenInvoiceKeys.has(`DOC_${dNo}`)) ||
              (iNo && seenInvoiceKeys.has(`INV_${iNo}`)) ||
              (rNo && seenInvoiceKeys.has(`REF_${rNo}`))) {
            continue;
          }
          if (dNo) seenInvoiceKeys.add(`DOC_${dNo}`);
          if (iNo) seenInvoiceKeys.add(`INV_${iNo}`);
          if (rNo) seenInvoiceKeys.add(`REF_${rNo}`);
          uniqueInvoices.push(item);
        }

        fetchedData = uniqueInvoices;

        const fetchedInvoiceNumbers = (fetchedData as any[]).map((row: any) => {
          defaultData[row.inv_no] = row;
          return row.inv_no;
        });



        const existingResult = await connection.execute(
          `
    SELECT
      tid.*,
      c.curr_name,
      h.ref_no
    FROM TR_AC_INVDETAIL tid
    LEFT JOIN MS_CURRENCY c
      ON tid.curr_code = c.curr_code
     AND tid.company_code = c.company_code
    LEFT JOIN TR_AC_HEADER h
      ON h.company_code = tid.company_code
     AND h.doc_no       = tid.inv_no
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
