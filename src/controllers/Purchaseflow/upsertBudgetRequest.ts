import oracledb from "oracledb";
import { oracleDb } from "../../database/connection";
import {
  TBasicBrequest,
  TCostbudget,
} from "../../interfaces/Purchaseflow/Budgetflow.interface";

/**
 * Upsert Budget Request using existing connection from oracleDb
 */
export async function upsertBudgetRequest(data: TBasicBrequest) {
  let connection: oracledb.Connection | undefined;

  try {
    // Use existing connection wrapper
    connection = await oracleDb.getConnection();

    console.log("Starting upsertBudgetRequest...");
    console.log("Request Number:", data.request_number);

    // -----------------------------------------
    // DECIDE INSERT OR UPDATE
    // -----------------------------------------
    let ls_insert = "NO";

    if (!data.request_number || data.request_number === "") {
      ls_insert = "YES";
    }

    console.log("ls_insert:", ls_insert);

    // -----------------------------------------
    // UPDATE LOGIC
    // -----------------------------------------
    if (data.last_action === "SUBMITTED" || ls_insert === "NO") {
      await connection.execute(
        `
        UPDATE PURCHASE_REQUEST_HEADER
        SET 
          LAST_ACTION = :lastAction,
          DESCRIPTION = :description,
          REMARKS = :remarks,
          UPDATED_BY = :updatedBy,
          LAST_UPDATED = SYSDATE,
          HISTORY_SERIAL = 1
        WHERE request_number = :requestNumber
          AND company_code = :companyCode
        `,
        {
          lastAction: data.last_action,
          description: data.description,
          remarks: data.remarks,
          updatedBy: data.updated_by,
          requestNumber: data.request_number,
          companyCode: data.company_code,
        },
        { autoCommit: false }
      );

      // Message call
      await connection.execute(
        `BEGIN 
            PROC_LOADMESSAGEBOX(:screen, :type, :doc, :user, 'Transaction Updated Successfully'); 
         END;`,
        {
          screen: "BUDGETSUBMIT",
          type: "success",
          doc: data.request_number,
          user: data.updated_by,
        }
      );

      await connection.commit();

      return { requestNumber: data.request_number };
    }

    // -----------------------------------------
    // INSERT LOGIC
    // -----------------------------------------
    let requestDate =
      data.request_date && !isNaN(new Date(data.request_date).getTime())
        ? new Date(data.request_date)
        : new Date();

    await connection.execute(
      `
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
      )
      VALUES (
        :company,
        :reqDate,
        :description,
        :remarks,
        :lastAction,
        :project,
        :updatedBy,
        :createdBy,
        'BUDGET',
        '003',
        1,
        1,
        3
      )
      `,
      {
        company: data.company_code,
        reqDate: requestDate,
        description: data.description,
        remarks: data.remarks,
        lastAction: data.last_action,   // fixed bind name
        project: data.project_code,
        updatedBy: data.updated_by,     // fixed bind name
        createdBy: data.created_by,     // fixed bind name
      },
      { autoCommit: false }
    );

    // ------------------------------------------------------
    // GET GENERATED REQUEST NUMBER FROM GT_SESSION_INFO
    // ------------------------------------------------------
    const result = await connection.execute<{ CODE: string }>(
      `
      SELECT CODE 
      FROM GT_SESSION_INFO
      WHERE USER_ID = :uid
      FETCH FIRST 1 ROW ONLY
      `,
      { uid: data.updated_by },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const generatedRequestNumber = result.rows?.[0]?.CODE;

    console.log("Generated Request Number (GT_SESSION_INFO):", generatedRequestNumber);

    // -----------------------------------------
    // MESSAGE CALL
    // -----------------------------------------
    await connection.execute(
      `BEGIN 
         PROC_LOADMESSAGEBOX(:screen, :type, :doc, :user, :msg); 
       END;`,
      {
        screen: "BUDGETSUBMIT",
        type: "success",
        doc: generatedRequestNumber,
        user: data.updated_by,
        msg: `Generated Request Number: ${generatedRequestNumber}`,
      }
    );

    await connection.commit();

    return { requestNumber: generatedRequestNumber };
  } catch (error) {
    console.error("Error in upsertBudgetRequest:", error);

    if (connection) {
      await connection.execute(
        `BEGIN 
           PROC_LOADMESSAGEBOX('TRNFAIL', 'error', :doc, :user, ''); 
         END;`,
        {
          doc: data.request_number || "",
          user: data.updated_by,
        }
      );

      await connection.rollback();
    }

    throw error;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error("❌ Error closing Oracle connection:", closeError);
      }
    }
  }
}
