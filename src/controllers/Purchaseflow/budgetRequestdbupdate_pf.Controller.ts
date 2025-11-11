import { oracleDb } from "../../database/connection";
import {
  TBasicBrequest,
  TCostbudget,
} from "../../interfaces/Purchaseflow/Budgetflow.interface";

import oracledb from "oracledb";


export async function upsertBudgetRequestOracle(data: TBasicBrequest) {
  let connection: oracledb.Connection | undefined;

  try {
    connection = await oracleDb.getConnection();

    const isInsert = !data.request_number || data.request_number === "";

    if (!isInsert) {
      // UPDATE existing request
      await connection.execute(
        `
        UPDATE PURCHASE_REQUEST_HEADER
        SET LAST_ACTION = :lastAction,
            DESCRIPTION = :description,
            REMARKS = :remarks,
            UPDATED_BY = :updatedBy,
            LAST_UPDATED = SYSDATE,
            HISTORY_SERIAL = 1
        WHERE REQUEST_NUMBER = :requestNumber
          AND COMPANY_CODE = :companyCode
      `,
        {
          lastAction: data.last_action,
          description: data.description,
          remarks: data.remarks,
          updatedBy: data.updated_by,
          requestNumber: data.request_number,
          companyCode: data.company_code,
        }
      );

      // Call procedure
      await connection.execute(
        `BEGIN PROC_LOADMESSAGEBOX(:screen, :type, :document_number, :userId, :message); END;`,
        {
          screen: "BUDGETSUBMIT",
          type: "success",
          document_number: data.request_number,
          userId: data.updated_by,
          message: "Transaction Updated Successfully",
        }
      );

      await connection.commit();
      return { requestNumber: data.request_number };
    }

    // INSERT new request
    await connection.execute(
      `
      INSERT INTO PURCHASE_REQUEST_HEADER (
        company_code, request_date, description, remarks,
        last_action, project_code, updated_by, created_by,
        flow_type, flow_code, flow_level_running, flow_level_initial, flow_level_final
      ) VALUES (
        :companyCode, :requestDate, :description, :remarks,
        :lastAction, :projectCode, :updatedBy, :createdBy,
        :flowType, '003', 1, 1, 3
      )
    `,
      {
        companyCode: data.company_code,
        requestDate: data.request_date || new Date(),
        description: data.description,
        remarks: data.remarks || null,
        lastAction: data.last_action,
        projectCode: data.project_code,
        updatedBy: data.updated_by || null,
        createdBy: data.created_by,
        flowType: "BUDGET",
      }
    );

    // Generate request number (Oracle sequence example)
    const result = await connection.execute<{ REQUEST_NUMBER: string }>(
      `SELECT 'BUDGET/' || LPAD(SEQ_REQUEST_HEADER.NEXTVAL, 5, '0') AS REQUEST_NUMBER FROM DUAL`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const requestNumber = result.rows?.[0]?.REQUEST_NUMBER ?? "";

    // Call procedure with generated request number
    await connection.execute(
      `BEGIN PROC_LOADMESSAGEBOX(:screen, :type, :document_number, :userId, :message); END;`,
      {
        screen: "BUDGETSUBMIT",
        type: "success",
        document_number: requestNumber,
        userId: data.updated_by,
        message: `Generated Request Number: ${requestNumber}`,
      }
    );

    await connection.commit();
    return { requestNumber };
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error("Rollback failed:", rollbackErr);
      }
    }
    console.error("Error in upsertBudgetRequestOracle:", error);
    throw error;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) {
        console.error("Error closing connection:", closeErr);
      }
    }
  }
}
export const insertBudgetCost = async (
  value: TCostbudget,
  connection: any // pass an Oracle connection
): Promise<void> => {
  try {
    if (value.requested_amt === 0) {
      return;
    }

    const sql = `
      INSERT INTO MS_PROJ_COST_MONTHWISE_BUDGET (
        PROJECT_CODE,
        COST_CODE,
        COMPANY_CODE,
        USER_DT,
        USER_ID,
        MONTH_BUDGET,
        BUDGET_YEAR,
        REQUEST_NUMBER,
        REQUESTED_AMT,
        APPROVED_AMT,
        FINAL_APPROVED,
        REQUESTED_DATE
      ) VALUES (
        :projectCode,
        :costCode,
        :companyCode,
        SYSDATE,
        :userId,
        :monthBudget,
        :budgetYear,
        :requestNumber,
        :requestedAmt,
        :approvedAmt,
        NULL,
        SYSDATE
      )
    `;

    await connection.execute(sql, {
      projectCode: value.project_code,
      costCode: value.cost_code,
      companyCode: value.company_code,
  //   userId: value.user_id || null,
      monthBudget: value.month_budget,
      budgetYear: value.budget_year ?? "",
      requestNumber: value.request_number,
      requestedAmt: value.requested_amt,
      approvedAmt: value.approved_amt,
    });

    console.log("Budget cost inserted successfully:", value);
  } catch (error: any) {
    console.error(
      "Error inserting budget cost, transaction rolled back:",
      error.message
    );
    throw new Error("Failed to insert budget cost");
  }
};