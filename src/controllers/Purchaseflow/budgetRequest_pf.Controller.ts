import { Request, Response } from "express";
import constants1 from "../../helpers/constants";
import { format } from "date-fns";
import { NextFunction } from "express";
import cors from "cors";
import mysql, { RowDataPacket } from "mysql2";
import { Sequelize, QueryTypes } from "sequelize";

import { getBudgetData } from "./getBudgetData";
import oracledb from "oracledb";
import { oracleDb } from "../../database/connection"

import { insertBudgetCost } from "./budgetRequestdbupdate_pf.Controller";
import { upsertBudgetRequest } from "./budgetRequestdbupdate_pf.Controller";
import { TCostbudget } from "../../interfaces/Purchaseflow/Budgetflow.interface";
import { parse } from "date-fns";
// Define interfaces for Purchase Request Header and Detail
import { RequestWithUser } from "../../interfaces/common.interface";
import { TBasicBrequest } from "../../interfaces/Purchaseflow/Budgetflow.interface";
interface Row {
  PROJECT_CODE: string;
  COST_CODE: string;
  EQUAL_AMOUNT: number;
  TOTAL_AMOUNT: number;
  FROM_DATE: number | string; // Adjust based on your data type
  TO_DATE: number | string; // Adjust based on your data type
}

import constants from "../../helpers/constants";
interface RequestWithBody extends Request {
  body: {
    request_number: string;
    data: Array<{
      budget_year: string;
      company_code: string;
      cost_code: string;
      month_budget: number;
      requested_amt: number;
    }>;
  };
}
// Define a schema for validation
// Define a schema for validation
// Geting excel data fro temp_data table
/**
 * Fetch Budget Excel Data from TEMP_LOAD table (Oracle version)
 */


/**
 * Controller: getBudgetexcel
 * Description: Fetches budget data from Oracle TEMP_LOAD table for a given request_number
 */
export const getBudgetexcel = async (req: Request, res: Response): Promise<void> => {
  let connection: oracledb.Connection | undefined;

  try {
    console.log("▶ Inside backend getBudgetexcel (Oracle)");

    const { request_number } = req.params;

    // ✅ Input validation
    if (!request_number || typeof request_number !== "string") {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Invalid or missing request_number.",
      });
      return;
    }

    // ✅ Sanitize request_number
    const ls_request_number = request_number.replace(/\$\$/g, "/");
    console.log("Sanitized request_number:", ls_request_number);

    // ✅ Get connection from Oracle connection pool
    connection = await oracleDb.getConnection();

    // ✅ Update TEMP_LOAD with the given request_number
    const updateQuery = `
      UPDATE TEMP_LOAD
         SET REQUEST_NUMBER = :ls_request_number
       WHERE REQUEST_NUMBER IS NULL
    `;

    const updateResult = await connection.execute(updateQuery, {
      ls_request_number,
    }, { autoCommit: false });

    console.log(`Updated TEMP_LOAD rows: ${updateResult.rowsAffected ?? 0}`);

    // ✅ Select data from TEMP_LOAD
    const selectQuery = `
      SELECT 
        PROJECT_CODE AS project_code,
        COST_CODE AS cost_code,
        MONTH_BUDGET AS month_budget,
        BUDGET_YEAR AS budget_year,
        REQUESTED_AMT AS requested_amt,
        APPROVED_AMT AS approved_amt
      FROM TEMP_LOAD
      ORDER BY COST_CODE, BUDGET_YEAR, MONTH_BUDGET
    `;

    const result = await connection.execute(selectQuery, {}, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    // ✅ Handle no data found
    if (!result.rows || result.rows.length === 0) {
      await connection.rollback();
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "No data found in TEMP_LOAD for the given request_number.",
      });
      return;
    }

    // ✅ Commit transaction
    await connection.commit();

    // ✅ Send success response
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: result.rows,
    });

  } catch (error: any) {
    console.error("❌ Error in getBudgetexcel (Oracle):", error);

    // Rollback on error
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error("Error rolling back transaction:", rollbackErr);
      }
    }

    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "An unexpected error occurred.",
    });

  } finally {
    // ✅ Ensure connection is closed
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) {
        console.error("Error closing Oracle connection:", closeErr);
      }
    }
  }
};



export const budgetexcelupload = async (req: Request, res: Response): Promise<void> => {
  let connection: oracledb.Connection | undefined;

  try {
    console.log("▶ Starting Oracle budgetexcelupload");

    const { values, request_number } = req.body;

    if (!values || !Array.isArray(values) || values.length === 0) {
      res.status(400).json({
        success: false,
        message: "No budget data (values) provided.",
      });
      return;
    }

    if (!request_number) {
      res.status(400).json({
        success: false,
        message: "Missing request_number.",
      });
      return;
    }

    // ✅ Get Oracle connection
    connection = await oracleDb.getConnection();

    // ✅ Start transaction
    await connection.execute(`BEGIN NULL; END;`);

    console.log("Inside budgetexcelupload2", { count: values.length, request_number });

    // ✅ 1. Execute Oracle procedure equivalent to PRO_MANAGE_BUDGET_GT_TABLES()
    console.log("Calling procedure: PRO_MANAGE_BUDGET_GT_TABLES");
    await connection.execute(`BEGIN PRO_MANAGE_BUDGET_GT_TABLES(); END;`);

    // ✅ 2. Insert into GT_LOAD_BUDGET_DATA
    const insertSql = `
      INSERT INTO GT_LOAD_BUDGET_DATA
      (PROJECT_CODE, COST_CODE, EQUAL_AMOUNT, TOTAL_AMOUNT, FROM_DATE, TO_DATE)
      VALUES (:PROJECT_CODE, :COST_CODE, :EQUAL_AMOUNT, :TOTAL_AMOUNT, TO_DATE(:FROM_DATE, 'YYYY-MM-DD'), TO_DATE(:TO_DATE, 'YYYY-MM-DD'))
    `;

    console.log(`Inserting ${values.length} rows into GT_LOAD_BUDGET_DATA...`);

    for (const row of values) {
      const {
        project_code: PROJECT_CODE,
        cost_code: COST_CODE,
        equal_amount: EQUAL_AMOUNT,
        total_amount: TOTAL_AMOUNT,
        from_date,
        to_date,
      } = row;

      // Parse "dd/MM/yyyy" → format "yyyy-MM-dd"
      const l_FROM_DATE = parse(from_date, "dd/MM/yyyy", new Date());
      const l_TO_DATE = parse(to_date, "dd/MM/yyyy", new Date());

      if (isNaN(l_FROM_DATE.getTime()) || isNaN(l_TO_DATE.getTime())) {
        throw new Error(`Invalid date format: from_date=${from_date}, to_date=${to_date}`);
      }

      const formatted_FROM_DATE = format(l_FROM_DATE, "yyyy-MM-dd");
      const formatted_TO_DATE = format(l_TO_DATE, "yyyy-MM-dd");

      await connection.execute(insertSql, {
        PROJECT_CODE,
        COST_CODE,
        EQUAL_AMOUNT,
        TOTAL_AMOUNT,
        FROM_DATE: formatted_FROM_DATE,
        TO_DATE: formatted_TO_DATE,
      });
    }

    console.log("Inserted all rows successfully.");

    // ✅ 3. Call stored procedure PRO_LOAD_DATA(:request_number)
    console.log("Calling procedure: PRO_LOAD_DATA");
    await connection.execute(`BEGIN PRO_LOAD_DATA(:req_num); END;`, {
      req_num: request_number,
    });

    // ✅ 4. Commit transaction
    await connection.commit();

    console.log("✅ Data uploaded successfully!");
    res.status(200).json({
      success: true,
      message: `Data uploaded successfully and procedure executed for request_number: ${request_number}`,
    });

  } catch (error: any) {
    console.error("❌ Error in budgetexcelupload:", error);

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error("Rollback failed:", rollbackErr);
      }
    }

    res.status(500).json({
      success: false,
      message: "Failed to upload data or execute Oracle procedure.",
      error: error.message || error,
    });

  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) {
        console.error("Error closing Oracle connection:", closeErr);
      }
    }
  }
};




/**
 * Create or Update Budget Request Sequentially (Oracle)
 */
export const createOrUpdateBudgetRequestSequential = async (
  req: Request,
  res: Response,
  next?: NextFunction
): Promise<void> => {
  let connection: oracledb.Connection | undefined;

  try {
    console.log("▶ Incoming request data:", req.body);

    const {
      request_number,
      company_code,
      request_date,
      description,
      remarks,
      last_action,
      project_code,
      updated_by,
      created_by,
    } = req.body;

    // ✅ Parse request_date safely
    const parsedRequestDate =
      request_date && !isNaN(new Date(request_date).getTime())
        ? new Date(request_date)
        : undefined;

    const budgetRequest: TBasicBrequest = {
      request_number,
      company_code,
      request_date: parsedRequestDate,
      description,
      remarks,
      last_action,
      project_code,
      created_by,
      updated_by,
    };

    console.log("🧱 Constructed budgetRequest:", budgetRequest);

    // ✅ Get Oracle connection
    connection = await oracleDb.getConnection();

    // ✅ Begin transaction
    await connection.execute(`BEGIN NULL; END;`);

    // ✅ Upsert Logic for Oracle (insert if not exists, else update)
    // Assumes a table: BUDGET_REQUEST with primary key REQUEST_NUMBER
    const upsertSql = `
      MERGE INTO BUDGET_REQUEST target
      USING (
        SELECT :REQUEST_NUMBER AS REQUEST_NUMBER FROM DUAL
      ) source
      ON (target.REQUEST_NUMBER = source.REQUEST_NUMBER)
      WHEN MATCHED THEN
        UPDATE SET
          COMPANY_CODE = :COMPANY_CODE,
          REQUEST_DATE = :REQUEST_DATE,
          DESCRIPTION = :DESCRIPTION,
          REMARKS = :REMARKS,
          LAST_ACTION = :LAST_ACTION,
          PROJECT_CODE = :PROJECT_CODE,
          UPDATED_BY = :UPDATED_BY,
          UPDATED_AT = SYSDATE
      WHEN NOT MATCHED THEN
        INSERT (
          REQUEST_NUMBER, COMPANY_CODE, REQUEST_DATE, DESCRIPTION, REMARKS,
          LAST_ACTION, PROJECT_CODE, CREATED_BY, CREATED_AT
        )
        VALUES (
          :REQUEST_NUMBER, :COMPANY_CODE, :REQUEST_DATE, :DESCRIPTION, :REMARKS,
          :LAST_ACTION, :PROJECT_CODE, :CREATED_BY, SYSDATE
        )
    `;

    await connection.execute(upsertSql, {
      REQUEST_NUMBER: request_number,
      COMPANY_CODE: company_code,
      REQUEST_DATE: parsedRequestDate,
      DESCRIPTION: description,
      REMARKS: remarks,
      LAST_ACTION: last_action,
      PROJECT_CODE: project_code,
      CREATED_BY: created_by,
      UPDATED_BY: updated_by,
    });

    // ✅ Commit transaction
    await connection.commit();

    console.log("✅ Budget request upsert successful.");

    // ✅ Return result
    if (!res.headersSent) {
      res.status(200).json({
        success: true,
        message: "Budget request processed successfully.",
        requestNumber: request_number,
      });
    }
  } catch (error: any) {
    console.error("❌ Error saving/updating budget request:", error);

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error("Error rolling back transaction:", rollbackErr);
      }
    }

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Error saving/updating budget request.",
        error: error.message || "An unknown error occurred",
      });
    }
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) {
        console.error("Error closing Oracle connection:", closeErr);
      }
    }
  }
};


// Controller to handle fetching the budget request details

/**
 * Fetch Budget Request data from Oracle based on request_number and cost_code
 */
export const getBudgetRequest = async (
  req: Request,
  res: Response
): Promise<Response> => {
  let connection: oracledb.Connection | undefined;

  try {
    console.log("▶ Inside getBudgetRequest (Oracle)");

    const { request_number, cost_code } = req.params;

    if (!request_number) {
      return res.status(400).json({
        success: false,
        message: "Missing request_number parameter.",
      });
    }

    // ✅ Sanitize request number
    const ls_request_number = request_number.replace(/\$\$/g, "/");
    console.log("Sanitized request_number:", ls_request_number);

    // ✅ Get Oracle connection
    connection = await oracleDb.getConnection();

    // ✅ SQL Query — filter by request_number (and cost_code if provided)
    const query = `
      SELECT
        REQUEST_NUMBER,
        PROJECT_CODE,
        COST_CODE,
        MONTH_BUDGET,
        BUDGET_YEAR,
        REQUESTED_AMT,
        APPROVED_AMT,
        COMPANY_CODE,
        DESCRIPTION,
        REMARKS,
        LAST_ACTION,
        PROJECT_CODE
      FROM BUDGET_REQUEST_DETAILS
      WHERE REQUEST_NUMBER = :REQUEST_NUMBER
        ${cost_code ? "AND COST_CODE = :COST_CODE" : ""}
      ORDER BY COST_CODE, BUDGET_YEAR, MONTH_BUDGET
    `;

    // ✅ Bind parameters dynamically
    const bindParams: Record<string, any> = { REQUEST_NUMBER: ls_request_number };
    if (cost_code) bindParams.COST_CODE = cost_code;

    // ✅ Execute query
    const result = await connection.execute(query, bindParams, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    // ✅ Handle no data found
    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No data found for the given request number and cost code.",
      });
    }

    // ✅ Success response
    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    console.error("❌ Error fetching budget request (Oracle):", error);

    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching the budget request.",
      error: error.message || "Unknown error",
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) {
        console.error("Error closing Oracle connection:", closeErr);
      }
    }
  }
};

/**
 * Inserts budget costs for a given request_number into Oracle
 */
export const handleInsertBudgetCosts = async (
  req: Request,
  res: Response
): Promise<void> => {
  const values: TCostbudget[] = req.body;

  console.log("▶ Inside handleInsertBudgetCosts (Oracle)");

  // ✅ Validate input
  if (!Array.isArray(values) || values.length === 0) {
    res.status(400).json({ success: false, message: "Invalid input data. Array expected." });
    return;
  }

  const { request_number, cost_code, updated_by } = values[0];
  const user = req.user as { loginid: string; company_code?: string };

  if (!request_number || !cost_code) {
    res.status(400).json({
      success: false,
      message: "Missing request_number or cost_code in input data.",
    });
    return;
  }

  let connection: oracledb.Connection | undefined;

  try {
    // ✅ Get Oracle connection
    connection = await oracleDb.getConnection();

    // ✅ Begin transaction
    await connection.execute(`BEGIN NULL; END;`);

    console.log("Deleting old budget records for request_number:", request_number);

    // ✅ Delete existing records for this request_number
    const deleteSql = `
      DELETE FROM MS_PROJ_COST_MONTHWISE_BUDGET
      WHERE REQUEST_NUMBER = :REQUEST_NUMBER
    `;

    await connection.execute(deleteSql, { REQUEST_NUMBER: request_number });

    console.log(`Deleted existing records for request_number ${request_number}`);

    // ✅ Insert new records
    const insertSql = `
      INSERT INTO MS_PROJ_COST_MONTHWISE_BUDGET (
        REQUEST_NUMBER,
        COST_CODE,
        MONTH_BUDGET,
        BUDGET_YEAR,
        REQUESTED_AMT,
        APPROVED_AMT,
        CREATED_BY,
        CREATED_AT
      )
      VALUES (
        :REQUEST_NUMBER,
        :COST_CODE,
        :MONTH_BUDGET,
        :BUDGET_YEAR,
        :REQUESTED_AMT,
        :APPROVED_AMT,
        :CREATED_BY,
        SYSDATE
      )
    `;

    for (const row of values) {
      await connection.execute(insertSql, {
        REQUEST_NUMBER: row.request_number,
        COST_CODE: row.cost_code,
        MONTH_BUDGET: row.month_budget,
        BUDGET_YEAR: row.budget_year,
        REQUESTED_AMT: row.requested_amt,
        APPROVED_AMT: row.approved_amt,
        CREATED_BY: row.updated_by || updated_by || user?.loginid,
      });
    }

    console.log(`Inserted ${values.length} new records successfully.`);

    // ✅ Call success message procedure (PROC_LOADMESSAGEBOX)
    console.log("Calling PROC_LOADMESSAGEBOX (success)...");
    await connection.execute(
      `BEGIN PROC_LOADMESSAGEBOX(:screen, :type, :document_number, :userId, ''); END;`,
      {
        screen: "BudgetAllocation",
        type: "success",
        document_number: request_number,
        userId: updated_by || user?.loginid,
      }
    );

    // ✅ Commit transaction
    await connection.commit();

    res.status(constants1.STATUS_CODES.OK).json({
      success: true,
      message: "Records updated successfully.",
    });
  } catch (error: any) {
    console.error("❌ Error in handleInsertBudgetCosts (Oracle):", error);

    // ✅ Rollback transaction
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error("Rollback failed:", rollbackErr);
      }
    }

    // ✅ Call error message procedure
    if (connection) {
      try {
        await connection.execute(
          `BEGIN PROC_LOADMESSAGEBOX(:screen, :type, '', :userId, ''); END;`,
          {
            screen: "BudgetAllocation",
            type: "error",
            userId: user?.loginid || updated_by,
          }
        );
        await connection.commit();
      } catch (procErr) {
        console.error("Error calling PROC_LOADMESSAGEBOX (error):", procErr);
      }
    }

    res.status(constants1.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Update unsuccessful.",
      error: error.message || "Unknown error",
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) {
        console.error("Error closing Oracle connection:", closeErr);
      }
    }
  }
};


/**
 * Save Excel budget data to MS_PROJ_COST_MONTHWISE_BUDGET in Oracle
 */
export const saveExcelBudgetDataOracle = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { request_number, data: transformedRows } = req.body;

  if (!request_number || !transformedRows || transformedRows.length === 0) {
    res.status(400).json({ success: false, message: "Invalid data" });
    return;
  }

  let connection: oracledb.Connection | undefined;

  try {
    connection = await oracleDb.getConnection();

    // Start transaction
    await connection.execute(`BEGIN NULL; END;`);

    // Fetch project_code and request_date
    const headerResult = await connection.execute<{
      PROJECT_CODE: string;
      REQUEST_DATE: Date;
    }>(
      `SELECT PROJECT_CODE, REQUEST_DATE 
       FROM PURCHASE_REQUEST_HEADER 
       WHERE REQUEST_NUMBER = :request_number`,
      { request_number },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!headerResult.rows || headerResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: "Request not found or missing required data",
      });
      return;
    }

    const { PROJECT_CODE: project_code, REQUEST_DATE: request_date } = headerResult.rows[0];

    // Format request_date as dd/MM/yyyy
    const formattedDate = request_date
      ? `${String(request_date.getDate()).padStart(2, "0")}/${
          String(request_date.getMonth() + 1).padStart(2, "0")
        }/${request_date.getFullYear()}`
      : null;

    // Delete existing budget data
    await connection.execute(
      `DELETE FROM MS_PROJ_COST_MONTHWISE_BUDGET WHERE REQUEST_NUMBER = :request_number`,
      { request_number }
    );

    // Insert each row
    const insertSql = `
      INSERT INTO MS_PROJ_COST_MONTHWISE_BUDGET (
        PROJECT_CODE, COST_CODE, COMPANY_CODE, MONTH_DATE,
        MONTH_BUDGET, BUDGET_YEAR, REQUEST_NUMBER,
        REQUESTED_AMT, APPROVED_AMT, REQUESTED_DATE
      ) VALUES (
        :project_code, :cost_code, :company_code, TO_DATE(:month_date, 'YYYY-MM-DD'),
        :month_budget, :budget_year, :request_number,
        :requested_amt, :approved_amt, TO_DATE(:requested_date, 'DD/MM/YYYY')
      )
    `;

    for (const row of transformedRows) {
      const { budget_year, company_code, cost_code, month_budget, requested_amt } = row;

      // Format month_date as YYYY-MM-DD
      const monthDate = `${budget_year}-${month_budget < 10 ? "0" : ""}${month_budget}-01`;

      await connection.execute(insertSql, {
        project_code,
        cost_code,
        company_code,
        month_date: monthDate,
        month_budget,
        budget_year,
        request_number,
        requested_amt,
        approved_amt: requested_amt, // same as requested
        requested_date: formattedDate,
      });
    }

    // Commit transaction
    await connection.commit();

    res.json({
      success: true,
      message: `Excel data for Request Number ${request_number} saved successfully!`,
    });
  } catch (error) {
    console.error("Error during Oracle transaction:", error);
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error("Rollback failed:", rollbackErr);
      }
    }

    res.status(500).json({
      success: false,
      message: "An error occurred while saving data.",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) {
        console.error("Error closing Oracle connection:", closeErr);
      }
    }
  }
};


// Checking Budget Status
export const checkBudgetStatusOracle = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { request_number, company_code } = req.body;

  if (!company_code || !request_number) {
    res.status(400).json({
      success: false,
      message: "Missing required parameters: company_code or request_number",
    });
    return;
  }

  let connection: oracledb.Connection | undefined;

  try {
    connection = await oracleDb.getConnection();

    // Replace '/' with '$' if needed
    const request_number1 = request_number.replace(/\//g, "$");

    // Call the Oracle function using SELECT FROM DUAL
    const result = await connection.execute<{ RESULT: string }>(
      `SELECT FUN_CHECK_PR_EXCEED(:company_code, :request_number1) AS RESULT FROM DUAL`,
      { company_code, request_number1 },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const resultString = result.rows?.[0]?.RESULT || "No result found";

    res.status(200).json({
      success: true,
      result: resultString,
    });
  } catch (error) {
    console.error("Error calling Oracle function:", error);

    res.status(500).json({
      success: false,
      message: "Failed to execute function",
      error: error instanceof Error ? error.message : "Internal Server Error",
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) {
        console.error("Error closing Oracle connection:", closeErr);
      }
    }
  }
};
