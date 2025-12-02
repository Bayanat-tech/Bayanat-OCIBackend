import { Request, Response } from "express";
import oracledb from "oracledb";
import { oracleDb } from "../../database/connection";  // <-- use shared connection pool
import { TCostbudget } from "../../interfaces/Purchaseflow/Budgetflow.interface";
import { insertBudgetCost } from "./insertBudgetCost";

export const handleInsertBudgetCosts = async (
  req: Request,
  res: Response
): Promise<void> => {
  const values: TCostbudget[] = req.body;

  console.log("inside handleInsertBudgetCosts");

  // Validate input
  if (!Array.isArray(values) || values.length === 0) {
    res.status(400).json({ error: "Invalid input data. Array expected." });
    return;
  }

  const firstRecord = values[0];
  const { cost_code, request_number, updated_by } = firstRecord;

  const user = req.user as { loginid: string; company_code?: string };
  console.log("loginid:", user.loginid);

  if (!cost_code) {
    res.status(400).json({ error: "First record is missing cost_code." });
    return;
  }

  let connection: oracledb.Connection | undefined;

  try {
    // -----------------------------------------------------------------------------------
    // ✔ USE EXISTING POOL CONNECTION (NO NEW DB LOGIN)
    // -----------------------------------------------------------------------------------
    connection = await oracleDb.getConnection();

    // Start transaction context
    await connection.execute("BEGIN NULL; END;");

    // 1. DELETE old records
    await connection.execute(
      `
      DELETE FROM MS_PROJ_COST_MONTHWISE_BUDGET
      WHERE request_number = :request_number
      `,
      { request_number },
      { autoCommit: false }
    );

    console.log(`Deleted existing records for request_number: ${request_number}`);

    // 2. INSERT new records using your helper function
    for (const costBudget of values) {
      await insertBudgetCost(costBudget, connection);
    }

    // 3. Success message procedure
    await connection.execute(
      `BEGIN
         PROC_LOADMESSAGEBOX(:screen, :type, :document_number, :userId, '');
       END;`,
      {
        screen: "BudetAllocation",
        type: "success",
        document_number: "",
        userId: updated_by,
      }
    );

    // 4. Commit transaction
    await connection.commit();

    res.status(200).json({
      success: true,
      message: "Records updated successfully",
    });
  } catch (error: any) {
    console.error("Error in handleInsertBudgetCosts:", error.message);

    if (connection) {
      try {
        await connection.execute(
          `BEGIN
             PROC_LOADMESSAGEBOX(:screen, :type, :document_number, :userId, '');
           END;`,
          {
            screen: "BudetAllocation",
            type: "error",
            document_number: "",
            userId: user.loginid,
          }
        );
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback error:", rollbackError);
      }
    }

    res.status(500).json({
      success: false,
      message: "Update unsuccessfully",
    });
  } finally {
    if (connection) {
      await connection.close(); // release back to pool
    }
  }
};
