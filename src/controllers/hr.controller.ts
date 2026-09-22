// Import necessary modules and interfaces
import { Response } from "express";
import constants from "../helpers/constants";
import { ISearch, RequestWithUser } from "../interfaces/common.interface";
import { IUser } from "../interfaces/user.interface";

import { IHrBank } from "../interfaces/Hr/hr_bank";

import { In, FindOptionsWhere, FindManyOptions } from "typeorm";

import { getSearchFilterQuery } from "../helpers/functions";
import { HrAirport } from "../models/Hr/hr_airport";
import { HrBank } from "../models/Hr/hr_bank";
import { Categorymaster } from "../models/Hr/hr_category";
import { HrContract } from "../models/Hr/hr_contract";
import { HrDepartment } from "../models/Hr/hr_department";
import { HrDesignation } from "../models/Hr/hr_designation";
import { HrDivision } from "../models/Hr/hr_division";
import { HrEmpStatus } from "../models/Hr/hr_employee_status";
import { HrGrade } from "../models/Hr/hr_grade";
import { KpiNamemaster } from "../models/Hr/hr_kpiname";
import { HrLabourDesignation } from "../models/Hr/hr_labour_designation";
import { Leavetype } from "../models/Hr/hr_leavetype";
import { OperationMaster } from "../models/Hr/hr_operation";
import { HrPaycomponent } from "../models/Hr/hr_paycomponents";
import { HrSection } from "../models/Hr/hr_section";
import { HrSponsor } from "../models/Hr/hr_sponsor";
import { HrViewEmp } from "../views/hr/hr_view_employee";
import { oracleDb, TypeORMService } from "../database/connection";


const ALLOWED_SORT_FIELDS: Record<string, string> = {
  REQUEST_NUMBER: 'REQUEST_NUMBER',
  REQUEST_DATE: 'REQUEST_DATE',
  LAST_UPDATED: 'LAST_UPDATED',
  LEAVE_START_DATE: 'LEAVE_START_DATE',
  LEAVE_END_DATE: 'LEAVE_END_DATE',
  LEAVE_TYPE: 'LEAVE_TYPE',
  LEAVE_TYPE_DESC: 'LEAVE_TYPE_DESC',
  EMPLOYEE_CODE: 'EMPLOYEE_CODE',
  EMPLOYEE_NAME_DISPLAY: 'EMPLOYEE_NAME_DISPLAY',
  NEXT_ACTION_BY_NAME: 'NEXT_ACTION_BY_NAME',
  REMARKS: 'REMARKS'
};

const ALLOWED_FILTER_COLUMNS = new Set<string>([
  'REQUEST_NUMBER',
  'REQUEST_DATE',
  'LAST_UPDATED',
  'LEAVE_START_DATE',
  'LEAVE_END_DATE',
  'LEAVE_TYPE',
  'LEAVE_TYPE_DESC',
  'EMPLOYEE_CODE',
  'EMPLOYEE_NAME_DISPLAY',
  'NEXT_ACTION_BY_NAME',
  'REMARKS'
]);

function buildFilterSql(
  search: any
): { sql: string; binds: Record<string, any> } {
  const clauses: string[] = [];
  const binds: Record<string, any> = {};
  if (!Array.isArray(search)) return { sql: '', binds };

  search.forEach((group: any, gi: number) => {
    if (!Array.isArray(group)) return;
    group.forEach((clause: any, ci: number) => {
      const col = String(clause?.field_name ?? '').toUpperCase();
      if (!ALLOWED_FILTER_COLUMNS.has(col)) return; // 🔒 whitelist

      const key = `f_${gi}_${ci}`;
      const op = String(clause?.operator ?? 'equals').toLowerCase();
      const val = clause?.field_value;

      switch (op) {
        case 'contains':
          clauses.push(`UPPER(${col}) LIKE :${key}`);
          binds[key] = `%${String(val).toUpperCase()}%`;
          break;
        case 'not_contains':
          clauses.push(`UPPER(${col}) NOT LIKE :${key}`);
          binds[key] = `%${String(val).toUpperCase()}%`;
          break;
        case 'starts_with':
          clauses.push(`UPPER(${col}) LIKE :${key}`);
          binds[key] = `${String(val).toUpperCase()}%`;
          break;
        case 'ends_with':
          clauses.push(`UPPER(${col}) LIKE :${key}`);
          binds[key] = `%${String(val).toUpperCase()}`;
          break;
        case 'equals':
          clauses.push(`UPPER(${col}) = :${key}`);
          binds[key] = String(val).toUpperCase();
          break;
        case 'not_equals':
          clauses.push(`UPPER(${col}) <> :${key}`);
          binds[key] = String(val).toUpperCase();
          break;
        case 'gt':
          clauses.push(`${col} > :${key}`);
          binds[key] = val;
          break;
        case 'gte':
          clauses.push(`${col} >= :${key}`);
          binds[key] = val;
          break;
        case 'lt':
          clauses.push(`${col} < :${key}`);
          binds[key] = val;
          break;
        case 'lte':
          clauses.push(`${col} <= :${key}`);
          binds[key] = val;
          break;
        case 'between': {
          const from = Array.isArray(val) ? val[0] : val;
          const to   = Array.isArray(val) ? val[1] : val;
          clauses.push(`${col} BETWEEN :${key}_from AND :${key}_to`);
          binds[`${key}_from`] = from;
          binds[`${key}_to`]   = to;
          break;
        }
        case 'is_null':
          clauses.push(`${col} IS NULL`);
          break;
        case 'is_not_null':
          clauses.push(`${col} IS NOT NULL`);
          break;
        default:
          break;
      }
    });
  });

  return {
    sql: clauses.length ? ` AND (${clauses.join(' AND ')})` : '',
    binds
  };
}



async function queryEntityWithFilters(
  entityClass: any,
  companyCode: string,
  filter: any,
  paginationOptions: any
): Promise<{ data: any[]; count: number }> {
  const repo = TypeORMService.getRepository(entityClass);

  const where: FindOptionsWhere<any> = { company_code: companyCode };

  if (filter?.search) {
    Object.assign(where, getSearchFilterQuery(filter.search));
  }

  const findOptions: FindManyOptions<any> = {
    where,
    ...paginationOptions
  };

  if (filter?.sort && Object.keys(filter.sort).length > 0) {
    findOptions.order = {
      [filter.sort.field_name]: filter.sort.desc ? "DESC" : "ASC"
    };
  }

  const [data, count] = await repo.findAndCount(findOptions);
  return { data, count };
}

export const getHrMaster = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { masters } = req.params;
    const requestUser: IUser = req.user;
    const uniqueCode = req.query.code;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = Number(page * limit - limit);
    let fetchedData: unknown[] = [],
      totalCount = 0;
    const paginationOptions = limit ? { offset: skip, limit: limit } : {};
    let filter: Partial<ISearch> = {};
    try {
      filter = req.query.filter ? JSON.parse(String(req.query.filter)) : {};
    } catch (err) {
      console.warn('Invalid filter payload for HR master request:', req.query.filter);
      filter = {};
    }

    switch (masters) {
      case "employeemaster": {
        const result = await queryEntityWithFilters(
          HrViewEmp,
          requestUser.company_code,
          filter,
          paginationOptions
        );
        fetchedData = result.data;
        totalCount = result.count;
        break;
      }

      // ---------------------------------------------------------------
      //  🔧 UPDATED: all leave-flow cases now honour filter + sort
      // ---------------------------------------------------------------
      case "Pg_Leave_flow":
      case "Pg_leave_flow_Rejected":
      case "Pg_leave_flow_close":
      case "Pg_leave_flow_cancel":
      case "Pg_leave_flow_InProgress": {

        const page = Math.max(Number(req.query.page) || 1, 1);
        const requestedLimit = Number(req.query.limit) || 10;
        const maxLimit = masters === 'Pg_leave_flow_close' ? 20 : 100;
        const limit = Math.min(Math.max(requestedLimit, 1), maxLimit);
        const offset = (page - 1) * limit;
        const isCloseFlow = masters === 'Pg_leave_flow_close';

        // ---- SORT (honours filter.sort.desc from the grid) ----
        const requestedSort = String(filter?.sort?.field_name ?? '').toUpperCase();
        const orderByColumn = ALLOWED_SORT_FIELDS[requestedSort] ?? 'REQUEST_DATE';
        const orderDirection =
          !requestedSort || !ALLOWED_SORT_FIELDS[requestedSort]
            ? 'DESC'                                              // fallback case
            : filter?.sort?.desc === false ? 'ASC' : 'DESC';

        const loginid = req.query.code as string;

        if (!requestUser?.company_code || !loginid) {
          console.error("Missing company_code or loginid");
          res.status(400).json({ success: false, message: "Invalid request" });
          return;
        }

        const bindParams: any = {
          company_code: requestUser.company_code,
          loginid: loginid
        };

        let whereConditions = "";

        switch (masters) {
          case "Pg_Leave_flow":
            whereConditions = `
              company_code = :company_code
              AND LAST_ACTION NOT IN ('REJECTED', 'CANCEL')
              AND (
                    (NEXT_ACTION_BY = :loginid AND FINAL_APPROVED <> 'YES')
                    OR (
                        IMMEDIATE_SUPERVISOR = :loginid
                        AND ACTUAL_RESUME_DATE IS NOT NULL
                        AND RESUME_DATE_APPROVED = 'NO'
                        AND FINAL_APPROVED <> 'YES'
                    )
                  )
            `;
            break;
          case "Pg_leave_flow_Rejected":
            whereConditions = `
              company_code = :company_code
              AND LAST_ACTION = 'REJECTED'
              AND (
                    CREATED_BY = :loginid
                    OR IMMEDIATE_SUPERVISOR = :loginid
                    OR HOD = :loginid
                    OR DEPT_HEAD = :loginid
              )`;
            break;
          case "Pg_leave_flow_close":
            whereConditions = `
              company_code = :company_code
              AND FINAL_APPROVED = 'YES'
              AND LAST_ACTION <> 'CANCEL'
              AND (
                    CREATED_BY = :loginid
                    OR IMMEDIATE_SUPERVISOR = :loginid
                    OR HOD = :loginid
                    OR DEPT_HEAD = :loginid
              )`;
            break;
          case "Pg_leave_flow_cancel":
            whereConditions = `
              company_code = :company_code
              AND LAST_ACTION = 'CANCEL'
              AND (
                    CREATED_BY = :loginid
              )`;
            break;
          case "Pg_leave_flow_InProgress":
            whereConditions = `
              company_code = :company_code
              AND LAST_ACTION <> 'REJECTED'
              AND FINAL_APPROVED <> 'YES'
              AND LAST_ACTION <> 'CANCEL'
              AND NEXT_ACTION_BY NOT IN (
                  SELECT EMPLOYEE_ID
                  FROM VW_HR_EMPLOYEE_AWARE
                  WHERE EMPLOYEE_ID = :loginid
              )
              AND (
                  :loginid IN (
                      SELECT NEXT_ACTION_BY
                      FROM LEAVE_REQUEST_FLOW_HISTRY
                  )
                  OR CREATED_BY = :loginid
              )
              AND (
                  CREATED_BY = :loginid
                  OR HOD = :loginid
                  OR DEPT_HEAD = :loginid
                  OR IMMEDIATE_SUPERVISOR = :loginid
              )`;
            break;
        }

        // ---- FILTER (built from filter.search; empty array → no clause) ----
        const { sql: filterSql, binds: filterBinds } = buildFilterSql(
          (filter as any)?.search
        );

        const finalWhere = whereConditions + filterSql;
        const finalBinds = { ...bindParams, ...filterBinds };

        try {
          const fetchQuery = `
            SELECT *
            FROM VW_LEAVE_REQUEST_FLOW_DTL
            WHERE ${finalWhere}
            ORDER BY ${orderByColumn} ${orderDirection}
            OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
          `;

          const countQuery = `
            SELECT COUNT(*) AS TOTAL_COUNT
            FROM VW_LEAVE_REQUEST_FLOW_DTL
            WHERE ${finalWhere}
          `;

          const fetchParams = {
            ...finalBinds,
            offset: offset,
            limit: limit
          };

          console.log('fetchQuery', fetchQuery);
          console.log('fetchParams', fetchParams);

          const [fetchedData, countData] = await Promise.all([
            oracleDb.query(fetchQuery, fetchParams),
            oracleDb.query(countQuery, finalBinds) // ⚠️ finalBinds, not bindParams
          ]);

          const rows = Array.isArray(fetchedData.rows) ? fetchedData.rows : [];
          const totalCountRow =
            Array.isArray(countData.rows) && countData.rows.length > 0
              ? countData.rows[0]
              : null;
          const totalCountValue = totalCountRow
            ? Number(Object.values(totalCountRow)[0] ?? 0)
            : 0;

          res.status(constants.STATUS_CODES.OK).json({
            success: true,
            data: {
              tableData: rows,
              count: totalCountValue
            }
          });
        } catch (error) {
          console.error(`Error in ${masters}:`, error);
          res.status(constants.STATUS_CODES.OK).json({
            success: false,
            data: {
              tableData: [],
              count: 0
            },
            message: "Leave request data is temporarily unavailable. Please try again later."
          });
        }

        return;
      }

      case "Leaveflow_request": {
        const request_number = req.query.code as string;

        const whereConditions = `company_code = :company_code ${
          request_number ? 'AND request_number = :request_number' : ''
        }`;

        const bindParams: any = {
          company_code: requestUser.company_code
        };

        if (request_number) {
          bindParams.request_number = request_number;
        }

        try {
          const fetchQuery = `
            SELECT *
            FROM VW_HR_LEAVE_REQUEST_FLOW
            WHERE ${whereConditions}
            ORDER BY request_number ASC
          `;
          console.log("Leaveflow_request Query:", fetchQuery);
          console.log("Leaveflow_request Params:", bindParams);

          const fetchedData = await oracleDb.query(fetchQuery, bindParams);

          console.log("fetchedData.rows", fetchedData.rows);

          res.status(constants.STATUS_CODES.OK).json({
            success: true,
            data: {
              tableData: fetchedData.rows,
              count: fetchedData.rows.length
            }
          });
          return;
        } catch (error) {
          console.error("Error in Leaveflow_request:", error);
          res.status(500).json({ success: false, message: "Server Error" });
          return;
        }
      }

      default: {
        res.status(400).json({ success: false, message: "Invalid request type" });
        return;
      }
        break;

      // hrDepartment case
      case "hrDepartment": {
        const result = await queryEntityWithFilters(
          HrDepartment,
          requestUser.company_code,
          filter,
          paginationOptions
        );
        fetchedData = result.data;
        totalCount = result.count;
        break;
      }

      case "hrSection": {
        const result = await queryEntityWithFilters(
          HrSection,
          requestUser.company_code,
          filter,
          paginationOptions
        );
        fetchedData = result.data;
        totalCount = result.count;
        break;
      }

      case "grademaster": {
        const result = await queryEntityWithFilters(
          HrGrade,
          requestUser.company_code,
          filter,
          paginationOptions
        );
        fetchedData = result.data;
        totalCount = result.count;
        break;
      }

      case "designation": {
        const result = await queryEntityWithFilters(
          HrDesignation,
          requestUser.company_code,
          filter,
          paginationOptions
        );
        fetchedData = result.data;
        totalCount = result.count;
        break;
      }
      case "formaldesignation": {
        const result = await queryEntityWithFilters(
          HrLabourDesignation,
          requestUser.company_code,
          filter,
          paginationOptions
        );
        fetchedData = result.data;
        totalCount = result.count;
        break;
      }
      case "categorymaster": {
        const result = await queryEntityWithFilters(
          Categorymaster,
          requestUser.company_code,
          filter,
          paginationOptions
        );
        fetchedData = result.data;
        totalCount = result.count;
        break;
      }
      case "section": {
        const result = await queryEntityWithFilters(
          HrSection,
          requestUser.company_code,
          filter,
          paginationOptions
        );
        fetchedData = result.data;
        totalCount = result.count;
        break;
      }
      case "kpiname": {
        const result = await queryEntityWithFilters(
          KpiNamemaster,
          requestUser.company_code,
          filter,
          paginationOptions
        );
        fetchedData = result.data;
        totalCount = result.count;
        break;
      }
      case "kpioperation": {
        const result = await queryEntityWithFilters(
          OperationMaster,
          requestUser.company_code,
          filter,
          paginationOptions
        );
        fetchedData = result.data;
        totalCount = result.count;
        break;
      }
      case "hrAirport": {
        const result = await queryEntityWithFilters(
          HrAirport,
          requestUser.company_code,
          filter,
          paginationOptions
        );
        fetchedData = result.data;
        totalCount = result.count;
        break;
      }
      case "hrEmployeeStatus": {
        const result = await queryEntityWithFilters(
          HrEmpStatus,
          requestUser.company_code,
          filter,
          paginationOptions
        );
        fetchedData = result.data;
        totalCount = result.count;
        break;
      }

      case "hrBank": {
        const result = await queryEntityWithFilters(
          HrBank,
          requestUser.company_code,
          filter,
          paginationOptions
        );
        fetchedData = result.data;
        totalCount = result.count;
        break;
      }
      case "hrDivision": {
        const result = await queryEntityWithFilters(
          HrDivision,
          requestUser.company_code,
          filter,
          paginationOptions
        );
        fetchedData = result.data;
        totalCount = result.count;
        break;
      }
      case "leavetype": {
        const result = await queryEntityWithFilters(
          Leavetype,
          requestUser.company_code,
          filter,
          paginationOptions
        );
        fetchedData = result.data;
        totalCount = result.count;
        break;
      }
      case "paycomponent": {
        const result = await queryEntityWithFilters(
          HrPaycomponent,
          requestUser.company_code,
          filter,
          paginationOptions
        );
        fetchedData = result.data;
        totalCount = result.count;
        break;
      }
      case "hrSponsor": {
        const result = await queryEntityWithFilters(
          HrSponsor,
          requestUser.company_code,
          filter,
          paginationOptions
        );
        fetchedData = result.data;
        totalCount = result.count;
        break;
      }
      case "hrContract": {
        const result = await queryEntityWithFilters(
          HrContract,
          requestUser.company_code,
          filter,
          paginationOptions
        );
        fetchedData = result.data;
        totalCount = result.count;
        break;
      }

      case "bank": {
        const bankRepo = TypeORMService.getRepository(HrBank);

        const [data, count] = await bankRepo.findAndCount({
          where: { company_code: requestUser.company_code },
          ...paginationOptions
        });

        fetchedData = data as unknown[] as IHrBank[];
        totalCount = count;
      }
        break;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: {
        tableData: fetchedData,
        count: fetchedData?.length
      }
    });
    return;
  } catch (error: any) {
    console.error(error);

    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Error occurred while fetching data"
    });
  }
};

// Delete master data with optional pagination based on the `master` type.
export const deleteHrMaster = async (req: RequestWithUser, res: Response) => {
  try {
    const { master } = req.params;
    const requestUser: IUser = req.user;
    const { ids } = req.body;

    if (!ids || ids.length === 0) {
      throw new Error("IDs are required");
    }

    switch (master) {
      case "bank": {
        const repo = TypeORMService.getRepository(HrBank);
        await repo.delete({
          company_code: requestUser.company_code,
          bank_code: In(ids)
        });
        break;
      }

      case "categorymaster": {
        const repo = TypeORMService.getRepository(Categorymaster);
        await repo.delete({
          company_code: requestUser.company_code,
          category_code: In(ids)
        });
        break;
      }

      case "section": {
        const repo = TypeORMService.getRepository(HrSection);
        await repo.delete({
          company_code: requestUser.company_code,
          section_code: In(ids)
        });
        break;
      }

      case "formaldesignation": {
        const repo = TypeORMService.getRepository(HrLabourDesignation);
        await repo.delete({
          company_code: requestUser.company_code,
          labour_desg_code: In(ids)
        });
        break;
      }

      case "kpiname": {
        const repo = TypeORMService.getRepository(KpiNamemaster);
        await repo.delete({
          company_code: requestUser.company_code,
          serial_no: In(ids)
        });
        break;
      }

      case "kpioperation": {
        const repo = TypeORMService.getRepository(OperationMaster);
        await repo.delete({
          company_code: requestUser.company_code,
          serial_no: In(ids)
        });
        break;
      }

      default:
        throw new Error(`Unknown master type: ${master}`);
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `${master} is successfully deleted`
    });
    return;
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message
    });
    return;
  }
};