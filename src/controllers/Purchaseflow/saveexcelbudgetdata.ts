import oracledb from "oracledb";
import { oracleDb } from "../../database/connection"; // your Oracle DB connection pool
import { Request, Response } from "express";

export const saveExcelBudgetData = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { request_number, data: transformedRows } = req.body;

  // Validate input
  if (!request_number || !transformedRows || transformedRows.length === 0) {
    res.status(400).json({ success: false, message: "Invalid data" });
    return;
  }

  let connection;

  try {
    connection = await oracleDb.getConnection();
    await connection.execute("ALTER SESSION SET NLS_DATE_FORMAT = 'DD/MM/YYYY'");

    // Start a transaction
    await connection.execute("BEGIN NULL; END;"); // No explicit BEGIN needed, execute will be in transaction mode
    console.log("log 1");

    // Fetch project_code and request_date
    const headerResults = await connection.execute<{
      PROJECT_CODE: string;
      REQUEST_DATE: Date;
    }>(
      `SELECT project_code, request_date 
       FROM PURCHASE_REQUEST_HEADER 
       WHERE request_number = :request_number`,
      { request_number },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    console.log("headerResults:", headerResults.rows);

    if (!headerResults.rows || headerResults.rows.length === 0) {
      res.status(404).json({ success: false, message: "Request not found" });
      return;
    }

    const { PROJECT_CODE: project_code, REQUEST_DATE: request_date } =
      headerResults.rows[0];

    console.log("Fetched project_code and request_date:", { project_code, request_date });

    // Format the request_date as dd/mm/yyyy
    const formattedDate = `${String(request_date.getDate()).padStart(2, "0")}/${String(
      request_date.getMonth() + 1
    ).padStart(2, "0")}/${request_date.getFullYear()}`;

    // Delete existing budget rows for this request_number
    await connection.execute(
      `DELETE FROM MS_PROJ_COST_MONTHWISE_BUDGET WHERE request_number = :request_number`,
      { request_number }
    );

    console.log("log 6");

    // Insert each transformed row
    const insertQuery = `
      INSERT INTO MS_PROJ_COST_MONTHWISE_BUDGET (
        PROJECT_CODE, COST_CODE, COMPANY_CODE, MONTH_DATE,
        MONTH_BUDGET, BUDGET_YEAR, REQUEST_NUMBER,
        REQUESTED_AMT, APPROVED_AMT, REQUESTED_DATE
      ) VALUES (
        :project_code, :cost_code, :company_code, TO_DATE(:monthDate, 'YYYY-MM-DD'),
        :month_budget, :budget_year, :request_number,
        :requested_amt, :approved_amt, TO_DATE(:requested_date, 'DD/MM/YYYY')
      )
    `;

    for (const row of transformedRows) {
      const { budget_year, company_code, cost_code, month_budget, requested_amt } = row;
      const monthDate = `${budget_year}-${month_budget.toString().padStart(2, "0")}-01`;

      await connection.execute(insertQuery, {
        project_code,
        cost_code,
        company_code,
        monthDate,
        month_budget,
        budget_year,
        request_number,
        requested_amt,
        approved_amt: requested_amt, // same as requested_amt
        requested_date: formattedDate,
      });
    }

    // Commit the transaction
    await connection.commit();
    console.log("log 7");

    res.json({
      success: true,
      message: `Excel Data for Request Number ${request_number} saved successfully!`,
    });
  } catch (error) {
    console.error("Error during transaction:", error);
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback failed:", rollbackError);
      }
    }

    res.status(500).json({
      success: false,
      message: "An error occurred while saving data.",
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error("Error closing connection:", closeError);
      }
    }
  }
};
