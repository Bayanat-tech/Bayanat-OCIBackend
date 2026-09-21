// Import necessary modules and interfaces
import { Response } from "express";
import constants from "../helpers/constants";
import { ISearch, RequestWithUser } from "../interfaces/common.interface";
import { IUser } from "../interfaces/user.interface";
import { QueryExecutor } from "../database/QueryExecutor";

// Import HR-related interfaces
import { IHrBank } from "../interfaces/Hr/hr_bank";


import { In, FindOptionsWhere, FindManyOptions } from "typeorm";

// Import models
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

async function queryEntityWithFilters(
  entityClass: any,
  companyCode: string,
  filter: any,
  paginationOptions: any
): Promise<{ data: any[]; count: number }> {
  const repo = TypeORMService.getRepository(entityClass);

  // Build where conditions
  const where: FindOptionsWhere<any> = { company_code: companyCode };

  // Apply search filter if exists
  if (filter?.search) {
    // // You'll need to update getSearchFilterQuery for TypeORM
    Object.assign(where, getSearchFilterQuery(filter.search));
  }

  // Build find options
  const findOptions: FindManyOptions<any> = {
    where,
    ...paginationOptions
  };

  // Apply sorting
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
  //---------------- Get Data based on master name -------------

  try {
    // Extract parameters from the request
    const { masters } = req.params; // Extract 'masters' parameter from the request
    const requestUser: IUser = req.user; // Get the user making the request
    const uniqueCode = req.query.code; // Extract 'code' query parameter from the request
    const page = Number(req.query.page) || 1; // Extract 'page' query parameter, default to 1
    const limit = Number(req.query.limit) || 10; // Extract 'limit' query parameter, default to 10
    const skip = Number(page * limit - limit); // Calculate the offset for pagination
    let fetchedData: unknown[] = [], // Initialize an empty array to store fetched data
      totalCount = 0; // Initialize a variable to store the total count of data
    const paginationOptions = limit ? { skip, take: limit } : {}; // Create pagination options based on the limit
    const filter: ISearch = req.query.filter // Extract 'filter' query parameter
      ? JSON.parse(req.query.filter) // Parse the filter query parameter as JSON
      : {}; // Default to an empty object if no filter is provided
    switch (masters) {
      // employeemaster case
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
      case "Pg_Leave_flow":
      case "Pg_leave_flow_Rejected":
      case "Pg_leave_flow_close":
      case "Pg_leave_flow_cancel":
      case "Pg_leave_flow_InProgress": {

        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 10;
        const offset = (page - 1) * limit;



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
              AND UPPER(TRIM(NVL(LAST_ACTION, ''))) NOT IN ('REJECTED', 'CANCEL')
              AND (
                (NEXT_ACTION_BY = :loginid AND UPPER(TRIM(NVL(FINAL_APPROVED, 'NO'))) <> 'YES')
                OR (UPPER(TRIM(NVL(LAST_ACTION, ''))) = 'SAVEASDRAFT' AND CREATED_BY = :loginid)
                OR
                (
                  IMMEDIATE_SUPERVISOR = :loginid
                  AND ACTUAL_RESUME_DATE IS NOT NULL
                  AND RESUME_DATE_APPROVED = 'NO'
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
        )
`;
            break;
         case "Pg_leave_flow_InProgress":
    whereConditions = `
        company_code = :company_code
        AND UPPER(TRIM(NVL(LAST_ACTION, ''))) <> 'REJECTED'
        AND UPPER(TRIM(NVL(FINAL_APPROVED, 'NO'))) <> 'YES'
        AND UPPER(TRIM(NVL(LAST_ACTION, ''))) <> 'CANCEL'
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
        )
    `;


            break;
        }
        try {
          const countQuery = `
      SELECT COUNT(*) as totalCount
      FROM LEAVE_REQUEST_FLOW
      WHERE ${whereConditions}
    `;

          console.log("Count Query:", countQuery);
          console.log("Bind Params:", bindParams);


          const countResult = await QueryExecutor.executeRawQuery(countQuery, bindParams);

          const totalCount = (countResult.rows || countResult)[0]?.TOTALCOUNT || 0;

          const fetchQuery = `
      SELECT *
      FROM VW_HR_LEAVE_REQUEST_FLOW
      WHERE ${whereConditions}
      ORDER BY request_number DESC
      OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
    `;

          const fetchParams = {
            ...bindParams,
            offset: offset,
            limit: limit
          };

  

          const fetchedData = await QueryExecutor.executeRawQuery(fetchQuery, fetchParams);


          res.status(constants.STATUS_CODES.OK).json({
            success: true,
            data: {
              tableData: fetchedData.rows,
              count: totalCount,
            },
          });
        } catch (error) {
          console.error(`Error in ${masters}:`, error);
          res.status(500).json({ success: false, message: "Server Error" });
        }

        return;
      }

      case "Leaveflow_request": {
        const request_number = req.query.code as string;

        const whereConditions = `company_code = :company_code ${request_number ? 'AND request_number = :request_number' : ''}`;

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


  
          
          // const queryParams = [requestUser.company_code];
          // if (request_number) queryParams.push(request_number);

               console.log("Leaveflow_request Query:", fetchQuery);
          console.log("Leaveflow_request Params:", bindParams);
          
          const fetchedData = await QueryExecutor.executeRawQuery(fetchQuery, bindParams);

          console.log("fetchedData.rows", fetchedData.rows)
          

          

          res.status(constants.STATUS_CODES.OK).json({
            success: true,
            data: {
              tableData: fetchedData.rows,
              count: fetchedData.rows.length,
            },
          });
          return;
        } catch (error) {
          console.error("Error in Leaveflow_request:", error);
          res.status(500).json({ success: false, message: "Server Error" });
          return;
        }
      }

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

      // hrSection case
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

      // grademaster case
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

      // designation case
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
        const countResult = await QueryExecutor.executeRawQuery(
          `SELECT COUNT(*) AS COUNT FROM MS_HR_DIVISION WHERE COMPANY_CODE = :company_code`,
          { company_code: requestUser.company_code }
        );
        const dataResult = await QueryExecutor.executeRawQuery(
          `SELECT
             COMPANY_CODE AS company_code,
             DIV_CODE AS div_code,
             DIV_NAME AS div_name,
             DIV_SHORT_NAME AS div_short_name,
             DIV_ADDRESS1 AS div_address1,
             DIV_ADDRESS2 AS div_address2,
             DIV_ADDRESS3 AS div_address3,
             COUNTRY_CODE AS country_code,
             PHONE AS phone,
             FAX AS fax,
             EMAIL AS email,
             NULL AS div_head_id,
             NULL AS remarks,
             'Y' AS status
           FROM MS_HR_DIVISION
           WHERE COMPANY_CODE = :company_code
           ORDER BY DIV_CODE
           OFFSET :skip ROWS FETCH NEXT :take ROWS ONLY`,
          { company_code: requestUser.company_code, skip, take: limit }
        );
        fetchedData = dataResult.rows || [];
        totalCount = Number(countResult.rows?.[0]?.COUNT || countResult.rows?.[0]?.count || 0);
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
        const searchText = String((req.query.search as string) || "").trim().toUpperCase();
        const binds: any = { company_code: requestUser.company_code };
        let whereClause = "WHERE COMPANY_CODE = :company_code";
        if (searchText) {
          binds.search = `%${searchText}%`;
          whereClause += ` AND (
            UPPER(PAY_COMP_ID) LIKE :search OR
            UPPER(PAY_COMP_DESC) LIKE :search OR
            UPPER(REMARKS) LIKE :search
          )`;
        }

        const countQuery = `SELECT COUNT(*) AS TOTALCOUNT FROM MS_HR_PAY_COMPONENTS ${whereClause}`;
        const countResult = await QueryExecutor.executeRawQuery(countQuery, binds);
        totalCount = Number((countResult.rows || countResult)[0]?.TOTALCOUNT || 0);

        const fetchQuery = `
          SELECT
            COMPANY_CODE AS company_code,
            PAY_COMP_ID AS pay_comp_id,
            PAY_COMP_DESC AS pay_comp_desc,
            REMARKS AS remarks
          FROM MS_HR_PAY_COMPONENTS
          ${whereClause}
          ORDER BY PAY_COMP_ID
          OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
        `;
        const fetchedResult = await QueryExecutor.executeRawQuery(fetchQuery, {
          ...binds,
          offset: skip,
          limit,
        });
        fetchedData = fetchedResult.rows || fetchedResult;
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

      // bank case
      case "bank": {
        const bankResult = await QueryExecutor.executeRawQuery(
          `SELECT * FROM (
             SELECT t.*, ROW_NUMBER() OVER (ORDER BY BANK_CODE) AS rn
             FROM MS_HR_BANK t
             WHERE COMPANY_CODE = :company_code
           )
           WHERE rn > :skip AND rn <= :endRow`,
          { company_code: requestUser.company_code, skip, endRow: skip + limit }
        );
        const rows = bankResult.rows || [];
        fetchedData = rows.map((row: any) => ({
          company_code: valueOf(row, "COMPANY_CODE"),
          bank_code: valueOf(row, "BANK_CODE"),
          bank_name: valueOf(row, "BANK_NAME"),
          bank_short_name: valueOf(row, "BANK_SHORT_NAME"),
          main_bank_code: valueOf(row, "MAIN_BANK_CODE"),
          bank_addr1: valueOf(row, "BANK_ADDR1"),
          bank_addr2: valueOf(row, "BANK_ADDR2"),
          bank_addr3: valueOf(row, "BANK_ADDR3"),
          country_code: valueOf(row, "COUNTRY_CODE"),
          phone: valueOf(row, "PHONE"),
          fax: valueOf(row, "FAX"),
          email: valueOf(row, "EMAIL"),
          remarks: valueOf(row, "REMARKS"),
          company_flag: valueOf(row, "COMPANY_FLAG"),
          comp_acct_code: valueOf(row, "COMP_ACCT_CODE"),
        }));
        totalCount = fetchedData.length < limit && page === 1 ? fetchedData.length : skip + fetchedData.length;
      }
        break;

      default: {
        res.status(400).json({ success: false, message: "Invalid request type" });
        return;
      }

    }// Return a successful response with the fetched data
    res.status(constants.STATUS_CODES.OK).json({
      // Indicate that the operation was successful
      success: true,
      // Return the fetched data along with the total count
      data: {
        // Table data contains the fetched records
        tableData: fetchedData,
        // Count represents the total number of records
        count: totalCount
      },
    });
    return;
  } catch (error: any) {
    // Log the error for debugging purposes
    console.error(error);

    // Return an error response with a generic error message
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      // Indicate that the operation was unsuccessful
      success: false,
      // Return a generic error message
      message: error?.message || "Error occurred while fetching data",
    });
  }
};

function valueOf(row: any, key: string) {
  return row?.[key] ?? row?.[key.toLowerCase()] ?? row?.[key.toUpperCase()] ?? null;
}



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

      case "hrContract":
      case "contract": {
        const repo = TypeORMService.getRepository(HrContract);
        await repo.delete({
          company_code: requestUser.company_code,
          contract_type: In(ids)
        });
        break;
      }

      case "hrSponsor":
      case "sponsor": {
        const repo = TypeORMService.getRepository(HrSponsor);
        await repo.delete({
          company_code: requestUser.company_code,
          sponsor_code: In(ids)
        });
        break;
      }

      case "hrDepartment":
      case "department": {
        const repo = TypeORMService.getRepository(HrDepartment);
        await repo.delete({
          company_code: requestUser.company_code,
          dept_code: In(ids)
        });
        break;
      }

      case "hrDivision":
      case "division": {
        const repo = TypeORMService.getRepository(HrDivision);
        await repo.delete({
          company_code: requestUser.company_code,
          div_code: In(ids)
        });
        break;
      }

      case "hrAirport":
      case "airport": {
        const repo = TypeORMService.getRepository(HrAirport);
        await repo.delete({
          company_code: requestUser.company_code,
          airport_code: In(ids)
        });
        break;
      }

      case "hrEmployeeStatus":
      case "employeestatus": {
        const repo = TypeORMService.getRepository(HrEmpStatus);
        await repo.delete({
          company_code: requestUser.company_code,
          empstatus_code: In(ids)
        });
        break;
      }

      default:
        throw new Error(`Unknown master type: ${master}`);
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `${master} is successfully deleted`,
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
