/**
 * @fileoverview Controller for handling inbound job operations in WMS (Oracle version)
 */
import oracledb from "oracledb";
import { oracleDb } from "../../../../database/connection";
import { Response } from "express";
import constants from "../../../../helpers/constants";
import {
  RequestWithUser,
  ISearch,
} from "../../../../interfaces/common.interface";
import { IUser } from "../../../../interfaces/user.interface";

import { getSearchFilterQuery, groupByContainerNo, formatData, getTiPackdetSeriesData } from "../../../../helpers/functions";
import { getTallyProductDataQ } from "../../../../utils/query";

/**
 * @function getInboundJob
 * @description Retrieves a single inbound job by job number from Oracle
 */
export const getInboundJob = async (req: RequestWithUser, res: Response) => {
  let connection;
  try {
    const { job_no } = req.params;

    connection = await oracleDb.getConnection();
    const query = `
      SELECT * FROM JOB_INBOUND_WMS
      WHERE JOB_NO = :job_no
    `;
    const result = await connection.execute(query, { job_no });

    if (!result.rows || result.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: `Job Data ${constants.MESSAGES.DOES_NOT_EXISTS}`,
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error("Error fetching inbound job:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Error fetching inbound job data.",
    });
  } finally {
    if (connection) await connection.close();
  }
};

/**
 * @function getReports
 * @description Retrieves GRN reports from Oracle with pagination, filtering, and sorting
 */
export const getReports = async (req: RequestWithUser, res: Response) => {
  let connection;
  try {
    const requestUser: IUser = req.user;
    const { prin_code, job_no } = req.query;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter: ISearch = req.query.filter ? JSON.parse(req.query.filter) : {};

    let baseQuery = `
      SELECT * FROM GRN_REPORT
      WHERE COMPANY_CODE = :company_code
        AND PRIN_CODE = :prin_code
        AND JOB_NO = :job_no
    `;

    // Apply dynamic filters (manual for Oracle)
    const filterClause = [];
    const bindParams: any = {
      company_code: requestUser.company_code,
      prin_code,
      job_no,
    };

    if (filter?.search) {
      for (const key in filter.search) {
        filterClause.push(`${key.toUpperCase()} LIKE :${key}`);
        bindParams[key] = `%${filter.search[key]}%`;
      }
    }

    if (filterClause.length > 0) {
      baseQuery += " AND " + filterClause.join(" AND ");
    }

    // Sorting
    if (filter?.sort?.field_name) {
      baseQuery += ` ORDER BY ${filter.sort.field_name} ${filter.sort.desc ? "DESC" : "ASC"}`;
    } else {
      baseQuery += " ORDER BY GRN_DATE DESC";
    }

    // Pagination
    const paginatedQuery = `
      SELECT * FROM (
        SELECT ROWNUM AS RNUM, A.* FROM (
          ${baseQuery}
        ) A WHERE ROWNUM <= :max_row
      ) WHERE RNUM > :min_row
    `;

    bindParams.max_row = skip + limit;
    bindParams.min_row = skip;

    connection = await oracleDb.getConnection();

    // Get total count
    const countResult = await connection.execute(
      `
      SELECT COUNT(*) AS TOTAL_COUNT
      FROM GRN_REPORT
      WHERE COMPANY_CODE = :company_code
        AND PRIN_CODE = :prin_code
        AND JOB_NO = :job_no
      `,
      bindParams
    );
    const totalCount = (countResult.rows as any)?.[0]?.TOTAL_COUNT || 0;

    // Get paginated results
    const result = await connection.execute(paginatedQuery, bindParams, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    const groupedData = groupByContainerNo(result.rows || []);
    const formattedData = await Promise.all(
      groupedData.map((data: any) => formatData(data, getTiPackdetSeriesData))
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      totalCount,
      data: formattedData,
    });
  } catch (error: any) {
    console.error("Error in getReports:", error);
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message || "Failed to fetch GRN reports.",
    });
  } finally {
    if (connection) await connection.close();
  }
};

/**
 * @function getTallyProductData
 * @description Fetch tally product data (JOIN with Product) using Oracle native query
 */
export const getTallyProductData = async (req: RequestWithUser, res: Response) => {
  let connection;
  try {
    const { prin_code, job_no, container_no } = req.query;
    connection = await oracleDb.getConnection();

    const query = `
      SELECT 
        PD.*,
        P.UOM_COUNT
      FROM PACKING_DETAILS_INBOUND_WMS_VIEW PD
      INNER JOIN PRODUCT_WMS P 
        ON P.PRIC_CODE = PD.PRIN_CODE
       AND P.PRODUCT_CODE = PD.PRODUCT_CODE
      WHERE PD.PRIN_CODE = :prin_code
        AND PD.JOB_NO = :job_no
        AND PD.CONTAINER_NO = :container_no
    `;

    const result = await connection.execute(
      query,
      { prin_code, job_no, container_no },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    console.error("Error fetching tally product data:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Error fetching tally product data.",
    });
  } finally {
    if (connection) await connection.close();
  }
};
