import { sequelize } from "../../database/connection";
import { Request, Response } from "express";
import { QueryTypes, Transaction } from "sequelize";
import { NextFunction } from "express";
import { IFiles, RequestWithUser } from "../../interfaces/common.interface";
import {
  IMaterialRequestPf,
  IItemMrRequest,
} from "../../interfaces/Purchaseflow/Materialflow.interface";
import constants from "../../helpers/constants";
import { createLog, notifyUser } from "../../helpers/functions";
import { formatDate } from "../../utils/formatDate";

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryOnDeadlock<T>(
  operation: () => Promise<T>,
  retries = MAX_RETRIES
): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    if (retries > 0 && error.original?.code === "ER_LOCK_DEADLOCK") {
      await sleep(RETRY_DELAY);
      return retryOnDeadlock(operation, retries - 1);
    }
    throw error;
  }
}

// Main upsert function
export async function upsertMaterialRequest(data: IMaterialRequestPf) {
  let transaction: Transaction | undefined;
  const transactionState = {
    committed: false,
    rolledBack: false,
  };

  try {
    transaction = await sequelize.transaction();

    const isAddMode = !data.request_number;
    let generatedRequestNumber = data.request_number;

    // Core DB operations
    const requestNumber = await upsertMaterialRequestHeader(data, transaction);

    if (isAddMode) {
      const [[{ code }]]: any = await sequelize.query(
        `SELECT code FROM GT_SESSION_INFO WHERE session_id = CONNECTION_ID() LIMIT 1;`,
        { transaction }
      );
      if (code) {
        generatedRequestNumber = code;
      }
    }

    await upsertMaterialRequestDetails(
      data.items ?? [],
      data.company_code ?? '',
      generatedRequestNumber ?? '',
      transaction
    );

    await transaction.commit();
    transactionState.committed = true;
    transaction = undefined;

    // Notification without email template
    if (data.last_action !== "SAVEASDRAFT") {
      try {
        const request_users = await getRequestUsers(data);
        if (!generatedRequestNumber) {
          throw new Error('generatedRequestNumber is undefined');
        }
      //  const cc = await getCCList(data, request_users, generatedRequestNumber);
   const cc = '';
       await notifyUser({
          event: constants.EVENTS.TRANSACTION_COMPLETED,
          request_users,
          cc,
          message: "", // Optional: add plain text message here
          htmlMessage: "", // No HTML template anymore
        });
      } catch (error) {
        console.error("Error sending notification:", error);
      }
    }

    return generatedRequestNumber;
  } catch (error) {
    if (
      transaction &&
      !transactionState.committed &&
      !transactionState.rolledBack
    ) {
      try {
        await transaction.rollback();
        transactionState.rolledBack = true;
      } catch (rollbackError) {
        console.error("Error during rollback:", rollbackError);
      }
    }
    throw error;
  }
}

// Helper functions
async function getRequestUsers(data: IMaterialRequestPf) {
  await sequelize.query(
    `CALL PROC_LOADMESSAGEBOX(:screen, :type, :document_number, :userId,'')`,
    {
      replacements: {
        screen: "PRSUBMIT",
        type: "success",
        document_number: data.request_number,
        userId: data.updated_by,
      },
    }
  );

  const [rows]: any = await sequelize.query(
    `SELECT FUN_EMAIL_SENT_STRING(:companyCode, FUN_GET_FLOW_ROLE_AL(:updatedBy, :companyCode)) AS email_cc`,
    {
      replacements: {
        companyCode: data.company_code,
        updatedBy: data.updated_by,
      },
    }
  );
  return rows[0].email_cc;
}

async function getCCList(
  data: IMaterialRequestPf,
  request_users: string,
  requestNumber: string
) {
  const [rows]: any = await sequelize.query(
    `SELECT FUN_EMAIL_CC_STRING(:companyCode, :createdBy, :requestUsers, :requestNumber) AS email_cc`,
    {
      replacements: {
        companyCode: data.company_code,
        createdBy: data.created_by,
        requestUsers: request_users,
        requestNumber,
      },
    }
  );
  return rows[0].email_cc;
}

async function upsertMaterialRequestHeader(
  data: IMaterialRequestPf,
  transaction: Transaction
): Promise<string> {
  if (!transaction) {
    throw new Error("Transaction is required");
  }

  let ls_new_flag = "No";

  if (!data.request_number || data.request_number === "") {
    ls_new_flag = "Yes";

    const insertQuery = `
      INSERT INTO MATERIAL_REQUEST_HEADER (
        REQUESTOR_NAME, NEED_BY_DATE,
        REQUEST_NUMBER, REQUEST_DATE, DESCRIPTION, REMARKS, AMOUNT,
        FLOW_CODE, FLOW_LEVEL_INITIAL, FLOW_LEVEL_RUNNING, FLOW_LEVEL_FINAL,
        COMPANY_CODE, CREATE_USER, CREATE_DATE, LAST_UPDATED, LAST_ACTION,
        HISTORY_SERIAL, CREATED_AT, CREATED_BY, UPDATED_AT, UPDATED_BY, FLOW_TYPE
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )
    `;

    const safeDate = (val: any) => (val ? new Date(val) : null);
    const safeString = (val: any) => (typeof val === 'string' ? val : '');
    const safeNumber = (val: any) => (typeof val === 'number' ? val : 0);

    const replacements = [
      safeString(data.requestor_name),                // 1. REQUESTOR_NAME
      safeDate(data.need_by_date),                   // 2. NEED_BY_DATE
      safeString(data.request_number),               // 3. REQUEST_NUMBER
      safeDate(data.request_date),                   // 4. REQUEST_DATE
      safeString(data.description),                  // 5. DESCRIPTION
      safeString(data.remarks),                      // 6. REMARKS
      safeNumber(data.amount),                       // 7. AMOUNT

      safeString(data.flow_code) || '003',           // 8. FLOW_CODE
      safeNumber(data.flow_level_initial) || 1,      // 9. FLOW_LEVEL_INITIAL
      safeNumber(data.flow_level_running) || 1,      // 10. FLOW_LEVEL_RUNNING
      safeNumber(data.flow_level_final) || 3,        // 11. FLOW_LEVEL_FINAL

      safeString(data.company_code),                 // 12. COMPANY_CODE
      safeString(data.create_user),                  // 13. CREATE_USER
      safeDate(data.create_date),                    // 14. CREATE_DATE
      safeDate(data.last_updated),                   // 15. LAST_UPDATED
      safeString(data.last_action),                  // 16. LAST_ACTION

      1,                                             // 17. HISTORY_SERIAL
      new Date(),                                    // 18. CREATED_AT
      safeString(data.created_by),                   // 19. CREATED_BY
      safeDate(data.updated_at),                     // 20. UPDATED_AT
      safeString(data.updated_by),                   // 21. UPDATED_BY
      safeString(data.flow_type) || 'MAT'            // 22. FLOW_TYPE
    ];

    if (replacements.length !== 22) {
      throw new Error(`Expected 22 values, got ${replacements.length}`);
    }

    try {
      await sequelize.query(insertQuery, {
        replacements,
        transaction,
      });
    } catch (error) {
      console.error("❌ Error executing insert:", error);
      throw error;
    }

    return data.request_number ?? '';
  }

  const key_request_number = (data.request_number ?? '').replace(/\//g, '$');

  const exists = await headerRecordExists(
    data.request_number ?? '',
    data.company_code ?? '',
    transaction
  );

  if (!exists) {
    throw new Error(`Request number ${data.request_number} does not exist in MATERIAL_REQUEST_HEADER.`);
  }

  if (ls_new_flag === "No") {
    const updateQuery = `
      UPDATE MATERIAL_REQUEST_HEADER SET 
        REQUESTOR_NAME = ?, NEED_BY_DATE = ?, REQUEST_DATE = ?, DESCRIPTION = ?, REMARKS = ?, AMOUNT = ?, 
        DEPARTMENT_CODE = ?, FLOW_CODE = ?, FLOW_LEVEL_INITIAL = ?, FLOW_LEVEL_RUNNING = ?, FLOW_LEVEL_FINAL = ?, 
        COMPANY_CODE = ?, CURRENCY_RATE = ?, USER_DT = ?, USER_ID = ?, FA_UPLOADED = ?, FINAL_APPROVED = ?, 
        REMARKS_HISTRY = ?, CURR_CODE = ?, CREATE_USER = ?, CREATE_DATE = ?, LAST_UPDATED = ?, LAST_ACTION = ?, 
        HISTORY_SERIAL = ?, ATTACH_FILE_NAME = ?, ATTACH_FILE_NAME1 = ?, ATTACH_FILE_NAME2 = ?, 
        REJECT_HISTRY = ?, SENDBACK_HISTRY = ?, REQ_DOC_NO = ?, REQ_DIV_CODE = ?, COST_CODE = ?, 
        PO_AMOUNT = ?, DOC_DATE = ?, PROJECT_CODE = ?, STATUS = ?, PROJECT_PR_NO = ?, DIV_CODE = ?, 
        FINAL_APPROVED_DATE = ?, CREATED_AT = ?, CREATED_BY = ?, UPDATED_AT = ?, UPDATED_BY = ?, 
        FLOW_TYPE = ?, PROJECT_CODE_FROM = ?, PROJECT_CODE_TO = ?
      WHERE REQUEST_NUMBER = ? AND COMPANY_CODE = ?
    `;

    const updateReplacements = [
      data.requestor_name ?? '',
      data.need_by_date ?? null,
      data.request_date ?? null,
      data.description ?? '',
      data.remarks ?? '',
      data.amount ?? 0,
      data.department_code ?? '',
      data.flow_code ?? '',
      data.flow_level_initial ?? 0,
      data.flow_level_running ?? 0,
      data.flow_level_final ?? 0,
      data.company_code ?? '',
      data.currency_rate ?? 1,
      data.user_dt ?? new Date(),
      data.user_id ?? '',
      data.fa_uploaded ?? 'N',
      data.final_approved ?? 'N',
      data.remarks_histry ?? '',
      data.curr_code ?? '',
      data.create_user ?? '',
      data.create_date ?? new Date(),
      data.last_updated ?? new Date(),
      data.last_action ?? '',
      1,
      data.attach_file_name ?? '',
      data.attach_file_name1 ?? '',
      data.attach_file_name2 ?? '',
      data.reject_histry ?? '',
      data.sendback_histry ?? '',
      data.req_doc_no ?? '',
      data.req_div_code ?? '',
      data.cost_code ?? '',
      data.po_amount ?? 0,
      data.doc_date ?? null,
      data.projectCode ?? '',
      data.status ?? '',
      data.project_pr_no ?? '',
      data.div_code ?? '',
      data.final_approved_date ?? null,
      new Date(), // CREATED_AT
      data.created_by ?? '',
      data.updated_at ?? new Date(),
      data.updated_by ?? '',
      data.flow_type ?? '',
      data.project_code_from ?? '',
      data.project_code_to ?? '',
      key_request_number,
      data.company_code ?? '',
    ];

    await sequelize.query(updateQuery, {
      replacements: updateReplacements,
      transaction,
    });
  }

  return data.request_number ?? '';
}


async function headerRecordExists(
  requestNumber: string,
  companyCode: string,
  transaction: Transaction
): Promise<boolean> {
  const key_request_number = requestNumber.replace(/\//g, "$");
  const [results]: any = await sequelize.query(
    `SELECT 1 FROM MATERIAL_REQUEST_HEADER WHERE request_number = ? AND company_code = ? LIMIT 1`,
    {
      replacements: [key_request_number, companyCode],
      type: QueryTypes.SELECT,
      transaction,
    }
  );
  return !!results;
}

async function detailRecordExists(
  requestNumber: string,
  companyCode: string,
  transaction: Transaction
): Promise<boolean> {
  const key_request_number = requestNumber.replace(/\//g, "$");
  const [results]: any = await sequelize.query(
    `SELECT 1 FROM MATERIAL_REQUEST_DETAILS WHERE request_number = ? AND company_code = ? LIMIT 1`,
    {
      replacements: [key_request_number, companyCode],
      type: QueryTypes.SELECT,
      transaction,
    }
  );
  return !!results;
}

async function upsertMaterialRequestDetails(
  items: IItemMrRequest[],
  companyCode: string,
  requestNumber: string,
  transaction: Transaction
) {
  const sortedItems = [...items].sort((a, b) => {
    const seqA = a.item_sequence_no ?? Number.MAX_SAFE_INTEGER;
    const seqB = b.item_sequence_no ?? Number.MAX_SAFE_INTEGER;
    return seqA - seqB;
  });

  const key_request_number = requestNumber.replace(/\//g, "$");

  await sequelize.query(
    `DELETE FROM MATERIAL_REQUEST_DETAILS WHERE request_number = ? AND company_code = ?`,
    { replacements: [key_request_number, companyCode], transaction }
  );

  for (const item of sortedItems) {
    const insertQuery = `
  INSERT INTO MATERIAL_REQUEST_DETAILS (
    request_number, company_code, item_code, item_rate, item_p_qty,
    history_serial, item_srno, p_uom, from_cost_code, to_cost_code,
    from_project_code, to_project_code, l_uom, item_l_qty
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;


  const replacements = [
  key_request_number,
  companyCode,
  item.item_code ?? '',
  item.item_rate ?? 0,
  item.item_p_qty ?? 0,
  1, // history_serial
  item.item_sequence_no ?? 0,
  item.p_uom ?? '',
  item.from_cost_code ?? '',
  item.to_cost_code ?? '',
  item.from_project_code ?? '',
  item.to_project_code ?? '',
  item.l_uom ?? '',
  item.item_l_qty ?? 0,
];

    await sequelize.query(insertQuery, {
      replacements,
      transaction,
    });
  }
}
