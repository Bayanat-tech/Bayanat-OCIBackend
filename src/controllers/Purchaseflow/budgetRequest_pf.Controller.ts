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
export const getBudgetexcel = async (req: Request, res: Response) => {
  let connection;

  try {
    console.log("Inside backend getBudgetexcel (Oracle)");

    const { request_number } = req.params;

    if (!request_number || typeof request_number !== "string") {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Invalid or missing request_number.",
      });
    }

    // Replace $$ with /
    const ls_request_number = request_number.replace(/\$\$/g, "/");
    console.log("Sanitized request_number:", ls_request_number);

    // Get connection from Oracle pool
    connection = await oracleDb.getConnection();

    // Start transaction
    await connection.execute(`BEGIN NULL; END;`); // Ensures transaction block begins

    // Update TEMP_LOAD with the request_number (Oracle SQL)
    const updateQuery = `
      UPDATE TEMP_LOAD
         SET REQUEST_NUMBER = :ls_request_number
       WHERE REQUEST_NUMBER IS NULL
    `;

    const updateResult = await connection.execute(updateQuery, {
      ls_request_number,
    });

    console.log(
      `Updated TEMP_LOAD rows: ${updateResult.rowsAffected ?? 0}`
    );

    // Select data from TEMP_LOAD (Oracle SQL)
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

    const result = await connection.execute(selectQuery, {}, { outFormat: oracleDb.OUT_FORMAT_OBJECT });

    if (!result.rows || result.rows.length === 0) {
      await connection.rollback();
      return res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "No data found in TEMP_LOAD for the given request_number.",
      });
    }

    // Commit transaction
    await connection.commit();

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    if (connection) await connection.rollback();
    console.error("Error in getBudgetexcel (Oracle):", error);

    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "An unexpected error occurred.",
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


export const budgetexcelupload = async (req: Request, res: Response) => {
  const transaction = await sequelize.transaction(); // Initialize transaction

  console.log("Before assigning values");

  try {
    const { values, request_number } = req.body;
    console.log("Inside budgetexcelupload2", { values, request_number });

    const proc_query = "CALL PRO_MANAGE_BUDGET_GT_TABLES()";
    await sequelize.query(proc_query, {
      transaction,
    });

    const insertQuery = `
      INSERT INTO GT_LOAD_BUDGET_DATA 
      (PROJECT_CODE, COST_CODE, EQUAL_AMOUNT, TOTAL_AMOUNT, FROM_DATE, TO_DATE) 
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    // Insert budget data function
    for (const row of values) {
      const {
        project_code: PROJECT_CODE,
        cost_code: COST_CODE,
        equal_amount: EQUAL_AMOUNT,
        total_amount: TOTAL_AMOUNT,
        from_date,
        to_date,
      } = row;

      // Parse dates from "dd/MM/yyyy" format
      const l_FROM_DATE = parse(from_date, "dd/MM/yyyy", new Date());
      const l_TO_DATE = parse(to_date, "dd/MM/yyyy", new Date());

      // Validate parsed dates
      if (isNaN(l_FROM_DATE.getTime()) || isNaN(l_TO_DATE.getTime())) {
        throw new Error(
          `Invalid date format: from_date=${from_date}, to_date=${to_date}`
        );
      }

      // Convert to MySQL-compatible "YYYY-MM-DD" format
      const formatted_FROM_DATE = format(l_FROM_DATE, "yyyy-MM-dd");
      const formatted_TO_DATE = format(l_TO_DATE, "yyyy-MM-dd");

      console.log("Inserting row:", {
        PROJECT_CODE,
        COST_CODE,
        EQUAL_AMOUNT,
        TOTAL_AMOUNT,
        formatted_FROM_DATE,
        formatted_TO_DATE,
      });

      // Execute the insert query within the transaction
      await sequelize.query(insertQuery, {
        replacements: [
          PROJECT_CODE,
          COST_CODE,
          EQUAL_AMOUNT,
          TOTAL_AMOUNT,
          formatted_FROM_DATE,
          formatted_TO_DATE,
        ],
        transaction, // Pass the transaction object
      });
    }

    console.log("Inside budgetexcelupload3", { values, request_number });

    // Execute the stored procedure
    const procedureQuery = `CALL PRO_load_DATA(:request_number)`;
    await sequelize.query(procedureQuery, {
      replacements: { request_number },
      transaction,
    });

    console.log("Inside budgetexcelupload4", { values, request_number });

    // Commit the transaction
    await transaction.commit();
    console.log("✅ Data uploaded successfully!");

    res.status(200).json({
      success: true,
      message: `Data uploaded successfully, and procedure executed for request_number: ${request_number}!`,
    });
  } catch (error) {
    // Rollback the transaction in case of an error
    if (transaction) await transaction.rollback();

    console.error(
      "❌ Error inserting data or executing procedure:",
      error instanceof Error ? error.message : JSON.stringify(error)
    );

    res.status(500).json({
      success: false,
      message: "Failed to upload data or execute procedure",
      error: error instanceof Error ? error.message : error,
    });
  }
};



export const createOrUpdateBudgetRequestSequential = async (
  req: Request,
  res: Response,
  next?: NextFunction
): Promise<void> => {
  try {
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

    console.log("Incoming request data30012025:", req.body);

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

    console.log("Constructed budgetRequest:", budgetRequest);
    console.log("log 30012025");

    const { requestNumber } = await upsertBudgetRequest(budgetRequest);

    console.log("After upsertBudgetRequest");
    console.log("Generated Request Number:", requestNumber);

    // Respond only if headers haven't already been sent
    if (!res.headersSent) {
      res.status(200).json({
        success: true,
        message: "Budget request processed successfully.",
        requestNumber,
      });
    }
  } catch (error) {
    console.error("Error saving/updating budget request:", error);

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Error saving/updating budget request.",
        error:
          error instanceof Error ? error.message : "An unknown error occurred",
      });
    }
  }
};


// Controller to handle fetching the budget request details

export const getBudgetRequest = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { request_number, cost_code } = req.params;
    const ls_request_number = request_number.replace(/\$\$/g, "/");

    // Call the service function to fetch data from the database
    const result = await getBudgetData(ls_request_number, cost_code);

    // If result is empty or null, return a not found response
    if (!result) {
      return res.status(404).json({
        success: false,
        message: "No data found for the given request number and cost code.",
      });
    }

    // Return the response with the fetched data
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error fetching budget request:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching the budget request.",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const handleInsertBudgetCosts = async (
  req: Request,
  res: Response
): Promise<void> => {
  const values: TCostbudget[] = req.body;

  console.log("inside handleInsertBudgetCosts ");
  // Validate input
  if (!Array.isArray(values) || values.length === 0) {
    // return res.status(400).json({ error: "Invalid input data. Array expected." });
  }

  const firstRecord = values[0];
  const { cost_code } = firstRecord;
  //dfdf
  const { request_number } = firstRecord;
  const { updated_by } = firstRecord;
  const user = req.user as { loginid: string; company_code?: string };
  console.log('loginid:', user.loginid);
  if (!cost_code) {
    //  return res.status(400).json({ error: "First record is missing cost_code." });
  }

  // Start a transaction
  const transaction = await sequelize.transaction();

  try {
    // Delete existing records for the cost_code within the transaction
    await sequelize.query(
      `DELETE FROM MS_PROJ_COST_MONTHWISE_BUDGET 
       WHERE  request_number = :request_number`,
      {
        replacements: { request_number },
        transaction,
        type: QueryTypes.DELETE,
      }
    );
    // console.log(`Deleted existing records for cost_code: ${cost_code}`);

    // Insert new records inside the same transaction using Promise.all
    await Promise.all(
      values.map((costBudget) => insertBudgetCost(costBudget, transaction))
    );

    // Commit the transaction
      // Send success response
    // res.status(200).json({ message: "Records processed successfully" });
     // Call success message procedure
     console.log('before PROC_LOAD',updated_by);
     await sequelize.query(
      `CALL PROC_LOADMESSAGEBOX(:screen, :type, :document_number, :userId,'')`,
      {
        replacements: {
          screen: 'BudetAllocation',
          type: 'success',
          document_number: '', // empty string as in your original call
          userId: updated_by, // pass this properly as a named replacement
        },
      }
    );
    await transaction.commit();

  
    res.status(constants1.STATUS_CODES.OK).json({
      success: true,
      message: "Records " + constants.MESSAGES.UPDATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
     // Call success message procedure
     await sequelize.query(`CALL PROC_LOADMESSAGEBOX(:screen, :type,'',user.loginid,"")`, {
      replacements: { screen: 'BudetAllocation', type: 'error' },
    });
    // If there's an error, roll back the transaction
    await transaction.rollback();
    res.status(constants1.STATUS_CODES.NOT_FOUND).json({
      success: false,
      message: "UPDATE UNSUCCESSFULLLY",
    });
  }
};

//Save data to MS_PROJ_COST_MONTHWISE_BUDGET after user viewing data of excel and pressing save button
export const saveexcelbudgetdata = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { request_number, data: transformedRows } = req.body;

  // Check for missing or invalid data
  if (!request_number || !transformedRows || transformedRows.length === 0) {
    res.status(400).json({ success: false, message: "Invalid data" });
    return; // Exit the function without returning a response object
  }
  console.log("log 1");
  let transaction;

  try {
    transaction = await sequelize.transaction(); // Start a transaction

    // Query to get project_code and request_date based on the request_number
    const ls_query = `SELECT project_code, request_date FROM PURCHASE_REQUEST_HEADER WHERE request_number = :request_number`;
    console.log("log 2");
    // Explicitly type the result as an array of objects with project_code and request_date
    const headerResults = (await sequelize.query(ls_query, {
      replacements: { request_number },
      type: QueryTypes.SELECT,
      transaction,
    })) as { project_code: string; request_date: Date }[]; // Type assertion here

    // Log the headerResults to verify the structure
    console.log("headerResults:", headerResults);
    console.log("log 3");
    // Check if results exist and the first item contains project_code and request_date
    if (
      !headerResults ||
      headerResults.length === 0 ||
      !headerResults[0].project_code ||
      !headerResults[0].request_date
    ) {
      res.status(404).json({
        success: false,
        message: "Request not found or missing required data",
      });
      return;
    }
    console.log("log 4");
    // Destructure project_code and request_date from the first result
    const { project_code, request_date } = headerResults[0];
    console.log("Fetched project_code and request_date:", {
      project_code,
      request_date,
    });
    console.log("log 5");
    // Format the request_date as dd/mm/yyyy
    const formattedRequestedDate = new Date(request_date);
    const dd = String(formattedRequestedDate.getDate()).padStart(2, "0");
    const mm = String(formattedRequestedDate.getMonth() + 1).padStart(2, "0");
    const yyyy = formattedRequestedDate.getFullYear();
    const formattedDate = `${dd}/${mm}/${yyyy}`;
    await sequelize.query(
      `DELETE FROM MS_PROJ_COST_MONTHWISE_BUDGET 
       WHERE  request_number = :request_number`,
      {
        replacements: { request_number },
        transaction,
        type: QueryTypes.DELETE,
      }
    );
    console.log("log 6");
    // Loop through transformedRows to insert data into MS_PROJ_COST_MONTHWISE_BUDGET
    for (const row of transformedRows) {
      const {
        budget_year,
        company_code,
        cost_code,
        month_budget,
        requested_amt,
      } = row;

      const monthDate = `${budget_year}-${
        month_budget < 10 ? "0" : ""
      }${month_budget}-01`; // Format the date

      const insertQuery = `
        INSERT INTO MS_PROJ_COST_MONTHWISE_BUDGET (
          PROJECT_CODE, COST_CODE, COMPANY_CODE, MONTH_DATE, 
          MONTH_BUDGET, BUDGET_YEAR, REQUEST_NUMBER, 
          REQUESTED_AMT, APPROVED_AMT, REQUESTED_DATE
        ) VALUES (
          :project_code, :cost_code, :company_code, :monthDate,
          :month_budget, :budget_year, :request_number,
          :requested_amt, :approved_amt, :requested_date
        )
      `;

      await sequelize.query(insertQuery, {
        replacements: {
          project_code,
          cost_code,
          company_code,
          monthDate,
          month_budget,
          budget_year,
          request_number,
          requested_amt,
          approved_amt: requested_amt, // approved_amt is the same as requested_amt
          requested_date: formattedDate, // Use the formatted date
        },
        type: QueryTypes.INSERT,
        transaction, // Pass the transaction to ensure consistency
      });
    }
    console.log("log 7");
    await transaction.commit(); // Commit the transaction

    res.json({
      success: true,
      message: `Excel Data for Request Number ${request_number} saved successfully!`,
    });
  } catch (error) {
    console.error("Error during transaction:", error);
    if (transaction) await transaction.rollback(); // Rollback the transaction on error

    res.status(500).json({
      success: false,
      message: "An error occurred while saving data.",
    });
  }
};

// Checking Budget Status

export const CheckBudgetStatus = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // Extract company_code and request_number from the request body
    const { request_number, company_code } = req.body;
    console.log("inside CheckBudgetStatus1");
    // Validate required parameters
    if (!company_code || !request_number) {
      res.status(400).json({
        success: false,
        message: "Missing required parameters: company_code or request_number",
      });
      return;
    }

    // Query to call the MySQL function
    const query = `SELECT FUN_CHECK_PR_EXCEED(:company_code, :request_number1) AS result;`;
    let request_number1 = request_number.replace(/\//g, "$");
    // Execute the function and get the result
    const results: any = await sequelize.query(query, {
      replacements: { company_code, request_number1 },
      type: QueryTypes.SELECT,
    });
    console.log("inside CheckBudgetStatus2");
    // Extract the function result
    const resultString = results[0]?.result || "No result found";
    console.log("inside CheckBudgetStatus3", resultString);
    // Send the result to the frontend
    res.status(200).json({
      success: true,
      result: resultString,
    });
  } catch (err: any) {
    console.error("Error calling function:", err);

    // Handle errors
    res.status(500).json({
      success: false,
      message: "Failed to execute function",
      error: err.message || "Internal Server Error",
    });
  }
};
