import { oracleDb } from "../../database/connection";
import {
  TBasicBrequest,
  TCostbudget,
} from "../../interfaces/Purchaseflow/Budgetflow.interface";

export async function upsertBudgetRequest(data: TBasicBrequest) {
  const transaction = await oracleDb.transaction();

  try {
    console.log("Starting upsertBudgetRequest.30012025..");

    // Log input data for debugging
    console.log("Request number:", data.request_number);
    console.log("Request Date:", data.request_date);
    console.log("Description:", data.description);
    console.log("Project Code:", data.project_code);
    console.log("Company Code:", data.company_code);
    console.log("Created By:", data.created_by);
    console.log("Last Action:", data.last_action);

    let ls_insert = "NO";
    // if (data.last_action === "SAVEASDRAFT" || data.request_number === null) {
    if (data.request_number === null || data.request_number === "") {
      ls_insert = "YES";
    }
    console.log("ls_insert", ls_insert);
    console.log("request number", data.request_number);
    if (data.last_action === "SUBMITTED" || ls_insert === "NO") {
      // Update existing record in PURCHASE_REQUEST_HEADER
      await oracleDb.query(
        `UPDATE PURCHASE_REQUEST_HEADER
        SET
          LAST_ACTION = :lastAction,
            DESCRIPTION= :description,
            REMARKS= :remarks,
          updated_by = :updatedBy,
          LAST_UPDATED = NOW(), 
          HISTORY_SERIAL = 1
        WHERE request_number = :requestNumber AND company_code = :companyCode;`,
        {
          replacements: {
            lastAction: data.last_action,
            description: data.description, // ✅ Added
            remarks: data.remarks, // ✅ Added
            updatedBy: data.updated_by,
            requestNumber: data.request_number,
            companyCode: data.company_code,
          },
          transaction,
        }
      );

      console.log("Update committed successfully1.");
      await oracleDb.query(
        `CALL PROC_LOADMESSAGEBOX(:screen, :type, :document_number, :userId,'Transaction Updated Successfully')`,
        {
          replacements: {
            screen: "BUDGETSUBMIT",
            type: "success",
            document_number: data.request_number, // empty string as in your original call
            userId: data.updated_by, // pass this properly as a named replacement
          },
        }
      );
      await transaction.commit();
      return { requestNumber: "" };
    }

    // Parse and validate request date
    const requestDate =
      data.request_date && !isNaN(new Date(data.request_date).getTime())
        ? data.request_date
        : new Date().toISOString().split("T")[0];

    // Define the SQL INSERT statement
    console.log("Before insert");
    const insertQuery = `
    INSERT INTO PURCHASE_REQUEST_HEADER (
      company_code,
      request_date,
      description,
      remarks,
      last_action,
      project_code,
      updated_by,
      created_by,
      flow_type,
      flow_code,
      flow_level_running,
      flow_level_initial,
      flow_level_final
    ) VALUES (
      :companyCode,
      :requestDate,
      :description,
      :remarks,
      :lastAction,
      :projectCode,
      :updatedBy,
      :createdBy,
      :flowType,
      '003', -- Flow Code
      1,     -- Flow Level Running
      1,     -- Flow Level Initial
      3      -- Flow Level Final
    );
    `;

    // Execute the INSERT statement
    await oracleDb.query(insertQuery, {
      replacements: {
        companyCode: data.company_code,
        requestDate: requestDate,
        description: data.description,
        remarks: data.remarks || null,
        lastAction: data.last_action,
        projectCode: data.project_code,
        updatedBy: data.updated_by || null,
        createdBy: data.created_by,
        flowType: "BUDGET",
      },
      transaction,
    });

    // Fetch the latest generated request_number within the same transaction sagar b
    const [requestNumberResult] = await oracleDb.query(
      `SELECT  CONCAT(
      'BUDGET$',
      SUBSTRING_INDEX(SUBSTRING_INDEX(request_number, '$', 2), '$', -1),
      '$',
      LPAD(MAX(CAST(SUBSTRING_INDEX(request_number, '$', -1) AS UNSIGNED)), 5, '0')
    ) AS request_number 
       FROM PURCHASE_REQUEST_HEADER
       WHERE company_code = :companyCode 
         AND request_number LIKE 'BUDGET%' 
       ORDER BY last_updated DESC 
       LIMIT 1;`,
      {
        replacements: { companyCode: data.company_code },
        transaction,
      }
    );

    const requestNumber = (requestNumberResult[0] as { request_number: string })
      ?.request_number;

    console.log("Data successfully inserted into PURCHASE_REQUEST_HEADER222.");
    console.log("Generated Request Number:", requestNumber);
    console.log("requestNumber", requestNumber);
    const formattedRequestNumber = requestNumber.replace(/\$/g, "/");

    console.log("Transaction committed successfully.");
    await oracleDb.query(
      `CALL PROC_LOADMESSAGEBOX(:screen, :type, :document_number, :userId, :message)`,
      {
        replacements: {
          screen: "BUDGETSUBMIT",
          type: "success",
          document_number: requestNumber,
          userId: data.updated_by,
          message: `Generated Request Number: ${formattedRequestNumber}`,
        },
      }
    );
    await transaction.commit();
    console.log("Update committed successfully.");

    return { requestNumber };
  } catch (error) {
    await oracleDb.query(
      `CALL PROC_LOADMESSAGEBOX(:screen, :type, :document_number, :userId,"")`,
      {
        replacements: {
          screen: "TRNFAIL",
          type: "error",
          document_number: data.request_number, // empty string as in your original call
          userId: data.updated_by, // pass this properly as a named replacement
        },
      }
    );
    console.error("Error in upsertBudgetRequest:", error);
    await oracleDb.query(
      `CALL PROC_LOADMESSAGEBOX(:screen, :type, :document_number, :userId,"")`,
      {
        replacements: {
          screen: "TRNFAIL",
          type: "error",
          document_number: "", // empty string as in your original call
          userId: data.updated_by, // pass this properly as a named replacement
        },
      }
    );
    await transaction.rollback();
    throw error;
  }
}

export const insertBudgetCost = async (
  value: TCostbudget,
  transaction: any
): Promise<void> => {
  try {
    if (value.requested_amt === 0) {
      return;
    }
    const sql = `
      INSERT INTO MS_PROJ_COST_MONTHWISE_BUDGET (
        PROJECT_CODE, COST_CODE, COMPANY_CODE, USER_DT, USER_ID,
        MONTH_BUDGET, BUDGET_YEAR, REQUEST_NUMBER, REQUESTED_AMT,
        APPROVED_AMT, FINAL_APPROVED, REQUESTED_DATE
      ) VALUES (
        ?, ?, ?, CURDATE(), ?,
        ?, ?, ?, ?, ?, NULL, CURDATE()
      );
    `;

    const params = [
      value.project_code,
      value.cost_code,
      value.company_code,
      null, // Adjusted user ID retrieval
      value.month_budget,
      value.budget_year ?? "", // Ensure budget_year exists
      value.request_number,
      value.requested_amt,
      value.approved_amt,
    ];

    await oracleDb.query(sql, {
      replacements: params,
      transaction,
    });

    console.log("after insert Budget cost inserted successfully:", value);
  } catch (error: any) {
    console.error(
      "Error inserting budget cost, transaction rolled back:",
      error.message
    );
    throw new Error("Failed to insert budget cost");
  }
};
