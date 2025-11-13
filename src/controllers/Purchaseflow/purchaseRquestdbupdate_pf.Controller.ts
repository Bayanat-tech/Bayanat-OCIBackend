import { sequelize } from "../../database/connection";
import { Request, Response } from "express";
import { QueryTypes, Transaction } from "sequelize"; // Add Transaction import
import { NextFunction } from "express";
import { IFiles, RequestWithUser } from "../../interfaces/common.interface";
import {
  IPurchaseRequestPf,
  IItemPrRequest,
  IPrtermnscondition,
} from "../../interfaces/Purchaseflow/Purucahseflow.interface";
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

export const updatePrintSignatureInfo = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const transaction = await sequelize.transaction();

  try {
    const { ref_doc_no, loginid, flag_yes_no } = req.body;
    console.log(
      "ref_doc_no, loginid, flag_yes_no",
      ref_doc_no,
      loginid,
      flag_yes_no
    );
    const formattedRefDocNo = ref_doc_no.replace(/\//g, "$");
    console.log("formattedRefDocNo", formattedRefDocNo);

    // Call the stored procedure with formatted ref_doc_no
    const procCall = `CALL PROC_PRINT_SIGNATURE_INFO(:ref_doc_no, :loginid, :flag_yes_no)`;

    await sequelize.query(procCall, {
      replacements: {
        ref_doc_no: formattedRefDocNo,
        loginid,
        flag_yes_no,
      },
      transaction,
    });

    await transaction.commit();

    res.status(200).json({
      success: true,
      message: "Signature info updated successfully",
    });
  } catch (error: any) {
    await transaction.rollback();
    console.error("Error calling stored procedure:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

export const updateReasonForPO = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const transaction = await sequelize.transaction(); // Optional, but good for consistency

  try {
    const { ref_doc_no, company_code, reason_po_modify, loginid } = req.body;

    // Validate input
    if (!ref_doc_no || !company_code || !reason_po_modify || !loginid) {
      res.status(400).json({
        success: false,
        message:
          "All fields (ref_doc_no, company_code, reason_po_modify, loginid) are required",
      });
      return;
    }

    if (reason_po_modify.trim() === "") {
      res.status(400).json({
        success: false,
        message: "Enter Reason for Purchase Order",
      });
      return;
    }

    const updateQuery = `
      UPDATE PURCHASE_REQUEST_DETAILS
      SET reason_for_po_modify = :reason_po_modify,
          updated_by = :loginid
      WHERE company_code = :company_code AND ref_doc_no = :ref_doc_no
    `;

    await sequelize.query(updateQuery, {
      replacements: {
        reason_po_modify,
        company_code,
        ref_doc_no,
        loginid,
      },
      type: QueryTypes.UPDATE,
      transaction,
    });

    await transaction.commit();

    res.status(200).json({
      success: true,
      message: "Reason for PO modification updated successfully",
    });
  } catch (error: any) {
    await transaction.rollback();
    console.error("Error updating reason for PO:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

// Replace the existing upsertPurchaseRequest function
export async function upsertPurchaseRequest(data: IPurchaseRequestPf) {
  let transaction: Transaction | undefined;
  const transactionState = {
    committed: false,
    rolledBack: false,
  };

  try {
    transaction = await sequelize.transaction();

    const isAddMode = !data.requestNumber;
    let generatedRequestNumber = data.requestNumber;

    // Handle POGEN case
    if (data.last_action === "POGEN") {
      let key_request_number = data.requestNumber.replace(/\//g, "$");
      await sequelize.query(
        "CALL PRO_GEN_JESRA_PO_NO(:companyCode, :requestNumber, :userId, :prinCode)",
        {
          replacements: {
            companyCode: data.companyCode,
            requestNumber: key_request_number,
            userId: "RIJASC",
            prinCode: "10001",
          },
          transaction,
        }
      );
      await transaction.commit();
      return;
    }

    // Ensure transaction exists before proceeding
    if (!transaction) {
      throw new Error("Failed to start transaction");
    }

    // Core database operations
    const requestNumber = await upsertPurchaseRequestHeader(data, transaction);

    if (isAddMode) {
      const [[{ code }]]: any = await sequelize.query(
        `SELECT code FROM GT_SESSION_INFO WHERE session_id = CONNECTION_ID() LIMIT 1;`,
        { transaction }
      );
      if (code) {
        generatedRequestNumber = code;
      }
    }

    await upsertPurchaseRequestDetails(
      data.div_code ?? '',              // Ensure string
      data.items,
      data.companyCode,
      generatedRequestNumber,
      data.projectCode,
      transaction
    );

    await updatetermscondition(
      data.termconditions,
      data.companyCode,
      generatedRequestNumber,
      transaction
    );

    // Commit transaction before email operations
    await transaction.commit();
    transactionState.committed = true;
    transaction = undefined; // Mark as committed

    // Email operations outside transaction
    if (data.last_action !== "SAVEASDRAFT") {
      try {
        const request_users = await getRequestUsers(data);
        const cc = await getCCList(data, request_users, generatedRequestNumber);
        const formattedRequestNumber = generatedRequestNumber.replace(
          /\//g,
          "$"
        );
        const [createdByResult]: any = await sequelize.query(
          `SELECT CREATED_BY FROM PURCHASE_REQUEST_HEADER WHERE REQUEST_NUMBER = :requestNumber LIMIT 1`,
          { replacements: { requestNumber: formattedRequestNumber } }
        );
        const createdBy = createdByResult?.[0]?.CREATED_BY || "Unknown";
        const htmlMessage = await generateEmailTemplate(
          data,
          generatedRequestNumber,
          createdBy
        );
        await notifyUser({
          event: constants.EVENTS.TRANSACTION_COMPLETED,
          request_users,
          cc,
          message: "",
          htmlMessage,
        });
      } catch (error) {
        console.error("Error sending notification:", error);
        // Don't rethrow - email errors shouldn't fail the transaction
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

// Add these helper functions
async function getRequestUsers(data: IPurchaseRequestPf) {
  await sequelize.query(
    `CALL PROC_LOADMESSAGEBOX(:screen, :type, :document_number, :userId,'')`,
    {
      replacements: {
        screen: "PRSUBMIT",
        type: "success",
        document_number: data.requestNumber,
        userId: data.updated_by,
      },
    }
  );

  const [rows]: any = await sequelize.query(
    `SELECT FUN_EMAIL_SENT_STRING(:companyCode, FUN_GET_FLOW_ROLE_AL(:updatedBy, :companyCode)) AS email_cc`,
    {
      replacements: {
        companyCode: data.companyCode,
        updatedBy: data.updated_by,
      },
    }
  );
  return rows[0].email_cc;
}

async function getCCList(
  data: IPurchaseRequestPf,
  request_users: string,
  requestNumber: string
) {
  const [rows]: any = await sequelize.query(
    `SELECT FUN_EMAIL_CC_STRING(:companyCode, :createdBy, :requestUsers, :requestNumber) AS email_cc`,
    {
      replacements: {
        companyCode: data.companyCode,
        createdBy: data.created_by,
        requestUsers: request_users,
        requestNumber,
      },
    }
  );
  return rows[0].email_cc;
}

// Function to insert or update PURCHASE_REQUEST_HEADER
async function upsertPurchaseRequestHeader(
  data: IPurchaseRequestPf,
  transaction: Transaction
): Promise<string> {
  if (!transaction) {
    throw new Error("Transaction is required");
  }
  // If requestNumber is null or an empty string, directly insert a new record
  let ls_new_flag = "No";
  if (!data.requestNumber || data.requestNumber === "") {
    ls_new_flag = "Yes";
    data.service_type =
      data.service_type === undefined ? "" : data.service_type;
    data.type_of_pr = data.type_of_pr === undefined ? "" : data.type_of_pr;
    data.covered_by_contract_yes = data.covered_by_contract_yes || "No";
    data.flag_sharing_cost = data.flag_sharing_cost || "No";
    data.budgeted_yes = data.budgeted_yes || "No";
    data.checked_store_yes = data.checked_store_yes || "No";
    let ls_flow_type = "PUR";
    //SECOND LINE FOR HARDCODE VALUE
    console.log("updatedby", data.updated_by);
    console.log('print div_code', data.div_code);
    const insertQuery = `INSERT INTO PURCHASE_REQUEST_HEADER (AMC_FROM,AMC_TO,
    DIV_CODE,ACCOMMODATION,
   CATERING, LAUNDRY_HOUSEKEEPING, MEDICAL, TRANSPORTATION, TRAINING, RECRUITMENT_HR, UNIFORM, STATIONARY, IT_TECH, FURNITURE, ENTERTAINMENT, BARBER, OTHERS, REQUESTOR_NAME,
  CONTRACT_SOFT_HARD, AMC_SERVICE_STATUS, MATERIAL_MECHANICAL, MATERIAL_ELECTRICAL, MATERIAL_PLUMBING, MATERIAL_TOOLS, MATERIAL_CIVIL, MATERIAL_AC, MATERIAL_CLEANING, MATERIAL_OTHER,
  SERVICES_TEMP_STAFF, SERVICES_RENTALS, SERVICES_SUBCON_CONSLT, SERVICES_OTHER, OTHER_STATIONERY, OTHER_IT, OTHER_NEW_UNIFORM_PPE, OTHER_RPLCMT_UNIFORM, OTHER_OTHER, GOOD_MATERIAL_REQUEST,
  SERVICE_REQUEST, TYPE_OF_CONTRACT, TYPE_OF_MATERIAL_SUPPLY, REMARKS, WO_NUMBER, REQUEST_DATE, DESCRIPTION, PROJECT_CODE, COMPANY_CODE, CREATED_BY, LAST_ACTION, LAST_UPDATED,
  FLOW_TYPE, FLOW_CODE, HISTORY_SERIAL, UPDATED_AT, SERVICE_TYPE, NEED_BY_DATE, TYPE_OF_PR, COVERED_BY_CONTRACT_YES, FLAG_SHARING_COST, BUDGETED_YES, CHECKED_STORE_YES
) VALUES (?, ?,
 ?, ?,
 ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
  ?, ?, 'PUR', '001', 1, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?
)
`;

    const [result]: any = await sequelize.query(insertQuery, {
      replacements: [
        //added this
         data.amc_from,
      data.amc_to,
        data.div_code,
        data.accommodation,
        data.catering,
data.laundry_housekeeping,
data.medical,
data.transportation,
data.training,
data.recruitment_hr,
data.uniform,
data.stationary,
data.it_tech,
data.furniture,
data.entertainment,
data.barber,
data.others,
data.requestor_name,
// end here.

        data.contract_soft_hard,
        data.amc_service_status,
        data.material_mechanical,
        data.material_electrical,
        data.material_plumbing,
        data.material_tools,
        data.material_civil,
        data.material_ac,
        data.material_cleaning,
        data.material_other,
        data.services_temp_staff,
        data.services_rentals,
        data.services_subcon_conslt,
        data.services_other,
        data.other_stationery,
        data.other_it,
        data.other_new_uniform_ppe,
        data.other_rplcmt_uniform,
        data.other_other,
        data.good_material_request,
        data.service_request,
        data.type_of_contract,
        data.type_of_material_supply,
        data.remarks,
        data.wo_number,
        data.requestDate,
        data.description,
        data.projectCode,
        data.companyCode,
        data.created_by,
        data.last_action,
        data.updated_by,
        data.service_type, // New column
        data.need_by_date, // Newly added column
        data.type_of_pr,
        data.covered_by_contract_yes,
        data.flag_sharing_cost,
        data.budgeted_yes,
        data.checked_store_yes,
      ],
      transaction,
    });

    // Retrieve the generated request number from the insert result
    const userid = data.updated_by;
    // Query to get the session code
    /*  const getSessionCode: { code: string }[][] = (await sequelize.query(
      `SELECT code from GT_SESSION_INFO WHERE USERID='${userid}'`
    )) as { code: string }[][];

    // return $code; // Return the newly generated request number
    console.log("header3");
    const generatedRequestNumber = getSessionCode[0][0].code;
    console.log(
      `Inserted new record with request number: ${generatedRequestNumber}`
    );*/
    return data.requestNumber;
    // return generatedRequestNumber; // Return the newly generated request number
  }
  let key_request_number = data.requestNumber.replace(/\//g, "$");
  // If requestNumber is provided and is not empty, check if the record exists
  const exists = await headerRecordExists(
    data.requestNumber,
    data.companyCode,
    transaction
  );

  if (!exists) {
    // Raise an error if the requestNumber does not exist
    throw new Error(
      `Request number ${data.requestNumber} does not exist in PURCHASE_REQUEST_HEADER.`
    );
  }

    // Update existing record if it exists
  if (ls_new_flag === "No") {
    console.log("update purchase request   No");
    ls_new_flag = "No";
    const updateQuery = `
    UPDATE PURCHASE_REQUEST_HEADER
    SET 
    ACCOMMODATION = ?,
   CATERING = ?, LAUNDRY_HOUSEKEEPING = ?, MEDICAL = ?, TRANSPORTATION = ?, TRAINING = ?, RECRUITMENT_HR = ?, UNIFORM = ?, STATIONARY = ?, IT_TECH = ?, FURNITURE = ?, ENTERTAINMENT = ?, BARBER = ?, OTHERS = ?, REQUESTOR_NAME = ?,

      REQUEST_DATE = ?,
      DESCRIPTION = ?,
      PROJECT_CODE = ?,
      UPDATED_BY = ?,
      LAST_UPDATED = ?,
      WO_NUMBER = ?,
      REMARKS = ?,
      TYPE_OF_CONTRACT = ?,
      AMC_FROM = ?,
      AMC_TO = ?,
      TYPE_OF_MATERIAL_SUPPLY = ?,
      CONTRACT_SOFT_HARD = ?,
      AMC_SERVICE_STATUS = ?,
      MATERIAL_MECHANICAL= ?,
MATERIAL_ELECTRICAL = ?,
MATERIAL_PLUMBING = ?,
MATERIAL_TOOLS = ?,
MATERIAL_CIVIL = ?,
MATERIAL_AC = ?,
MATERIAL_CLEANING = ?,
MATERIAL_OTHER = ?,
SERVICES_TEMP_STAFF = ?,
SERVICES_RENTALS = ?,
SERVICES_SUBCON_CONSLT = ?,
SERVICES_OTHER = ?,
OTHER_STATIONERY = ?,
OTHER_IT = ?,
OTHER_NEW_UNIFORM_PPE = ?,
OTHER_RPLCMT_UNIFORM = ?,
OTHER_OTHER = ?,
GOOD_MATERIAL_REQUEST = ?,
SERVICE_REQUEST = ?,
LAST_ACTION = ?,
    SERVICE_TYPE = ?,         -- newly added
      NEED_BY_DATE = ?,         -- newly added
HISTORY_SERIAL = 1,

TYPE_OF_PR = ?,
 COVERED_BY_CONTRACT_YES = ?,
    FLAG_SHARING_COST = ?,  
      BUDGETED_YES = ?,
      CHECKED_STORE_YES = ?,
      FLOW_LEVEL_RUNNING = ?
    
    WHERE REQUEST_NUMBER = ? AND COMPANY_CODE = ?;
  `;
    console.log("flow_level_running", data.flow_level_running);
    const replacements = [
      data.accommodation,
        data.catering,
data.laundry_housekeeping,
data.medical,
data.transportation,
data.training,
data.recruitment_hr,
data.uniform,
data.stationary,
data.it_tech,
data.furniture,
data.entertainment,
data.barber,
data.others,
data.requestor_name,
      data.requestDate,
      data.description,
      data.projectCode,
      data.updated_by,
      data.updated_by,
      data.wo_number,
      data.remarks,
      data.type_of_contract,
     data.amc_from,
     data.amc_to,
      data.type_of_material_supply,
      data.contract_soft_hard,
      data.amc_service_status,
      data.material_mechanical,
      data.material_electrical,
      data.material_plumbing,
      data.material_tools,
      data.material_civil,
      data.material_ac,
      data.material_cleaning,
      data.material_other,
      data.services_temp_staff,
      data.services_rentals,
      data.services_subcon_conslt,
      data.services_other,
      data.other_stationery,
      data.other_it,
      data.other_new_uniform_ppe,
      data.other_rplcmt_uniform,
      data.other_other,
      data.good_material_request,
      data.service_request,
      data.last_action,
      data.service_type, // newly added
      data.need_by_date, // newly added
      data.type_of_pr,
      data.covered_by_contract_yes,
      data.flag_sharing_cost,
      data.budgeted_yes,
      data.checked_store_yes,
      data.flow_level_running,
      key_request_number,
      data.companyCode,
    ];

    // Log each replacement value with its index
    replacements.forEach((value, index) => {
      console.log(`Replacement [${index}]:`, value);
    });

    await sequelize.query(updateQuery, {
      replacements: [
          data.accommodation,
        data.catering,
data.laundry_housekeeping,
data.medical,
data.transportation,
data.training,
data.recruitment_hr,
data.uniform,
data.stationary,
data.it_tech,
data.furniture,
data.entertainment,
data.barber,
data.others,
data.requestor_name,
        data.requestDate,
        data.description,
        data.projectCode,
        data.updated_by,
        data.updated_by,
        data.wo_number,
        data.remarks,
        data.type_of_contract,
        data.amc_from,
        data.amc_to,
        data.type_of_material_supply,
        data.contract_soft_hard,
        data.amc_service_status,
        data.material_mechanical,
        data.material_electrical,
        data.material_plumbing,
        data.material_tools,
        data.material_civil,
        data.material_ac,
        data.material_cleaning,
        data.material_other,
        data.services_temp_staff,
        data.services_rentals,
        data.services_subcon_conslt,
        data.services_other,
        data.other_stationery,
        data.other_it,
        data.other_new_uniform_ppe,
        data.other_rplcmt_uniform,
        data.other_other,
        data.good_material_request,
        data.service_request,
        data.last_action,
        data.service_type, // newly added
        data.need_by_date, // newly added
        data.type_of_pr,
        data.covered_by_contract_yes,
        data.flag_sharing_cost,
        data.budgeted_yes,
        data.checked_store_yes,
        data.flow_level_running,
        key_request_number,
        data.companyCode,
      ],
      transaction,
    });
    console.log(
      `Updated existing record for request number: ${data.requestNumber}`
    );
  }
  return data.requestNumber; // Return the existing request number
}

// Function to insert or update PURCHASE_REQUEST_DETAILS items
async function upsertPurchaseRequestDetails(
  div_code: string,
  items: IItemPrRequest[],
  companyCode: string,
  requestNumber: string,
  projectcode: string,
  transaction: Transaction
) {
  // Sort items before processing
  const sortedItems = [...items].sort((a, b) => {
    const seqA = a.item_sequence_no ?? Number.MAX_SAFE_INTEGER;
    const seqB = b.item_sequence_no ?? Number.MAX_SAFE_INTEGER;
    return seqA - seqB;
  });
  console.log("inside discount checking");
  // Delete existing records
  const key_request_number = requestNumber.replace(/\//g, "$");
  await sequelize.query(
    `DELETE FROM PURCHASE_REQUEST_DETAILS WHERE request_number = ? AND company_code = ?`,
    {
      replacements: [key_request_number, companyCode],
      transaction,
    }
  );

  // Insert new records
  for (const item of sortedItems) {
    console.log("1", item.item_code);
    console.log("2", item.item_rate);
    console.log("3", item.amount);
    console.log("4", item.cost_code);
    console.log("5", item.service_rm_flag);
    console.log("6", item.item_p_qty);
    console.log("6b", item.addl_item_desc);
    console.log("6a", item.allocated_approved_quantity);
    console.log("6c", item.upp);
    //   console.log("7", item.p_uom);
    console.log("8", item.item_l_qty);
    console.log("9", item.l_uom);
    console.log("10", item.supplier);
    console.log("discount", item.discount_amount);
    console.log("final rate", item.final_rate);
    console.log("div_code");
    //  console.log("10", item.last_action); 15
    const insertQuery = `
   INSERT INTO PURCHASE_REQUEST_DETAILS (currency_rate,
        request_number, company_code, item_code, item_rate, amount, cost_code,
        SERVICE_RM_FLAG, ITEM_P_QTY, P_UOM, ITEM_L_QTY, L_UOM,
        ALLOCATED_APPROVED_QUANTITY, DISCOUNT_AMOUNT, FINAL_RATE, ADDL_ITEM_DESC,
        UPP, SUPPLIER, PRIN_CODE, PROJECT_CODE, DIV_CODE, ITEM_SEQUENCE_NO, CURR_CODE
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    await sequelize.query(insertQuery, {
      replacements: [
        item.currency_rate,
        key_request_number,
        companyCode,
        item.item_code,
        item.item_rate,
        item.amount,
        item.cost_code,
        item.service_rm_flag,
        item.item_p_qty,
        item.p_uom,
        item.item_l_qty,
        item.l_uom,
        item.allocated_approved_quantity,
        item.discount_amount,
        item.final_rate,
        item.addl_item_desc,
        item.upp,
        item.supplier,
        "10001",
        projectcode,
        div_code,
        item.item_sequence_no,
           item.curr_code // ✅ Only this line is added
      ],
      transaction,
    });

    console.log(`Inserted new record for item ${item.item_code}`);
  }
  // ✅ Call the stored procedure after completing the loop to check old po amount for cancel po and created new PR
  await sequelize.query(`CALL PRO_CHECK_OLD_PO_AMOUNT(?, ?)`, {
    replacements: [companyCode, key_request_number],
    transaction,
  });
}

// Function to check if a header record exists
async function headerRecordExists(
  requestNumber: string,
  companyCode: string,
  transaction: Transaction
): Promise<boolean> {
  if (!transaction) {
    throw new Error("Transaction is required");
  }
  if (requestNumber == null) {
    return false; // Return false if requestNumber is null
  }

  const query = `
    SELECT count(*) FROM PURCHASE_REQUEST_HEADER
    WHERE REQUEST_NUMBER = ? AND COMPANY_CODE = ?;
  `;
  const [results] = await sequelize.query(query, {
    replacements: [requestNumber, companyCode],
    transaction,
  });

  return results.length > 0;
}

// Function to check if a detail record exists
async function detailRecordExists(
  requestNumber: string,
  companyCode: string,
  itemCode: string,
  transaction: Transaction
): Promise<boolean> {
  const query = `
    SELECT 1 FROM PURCHASE_REQUEST_DETAILS
    WHERE request_number = ? AND company_code = ? AND item_code = ?;
  `;
  const [results] = await sequelize.query(query, {
    replacements: [requestNumber, companyCode, itemCode],
    transaction,
  });
  return results.length > 0;
}

async function updatetermscondition(
  termconditions: IPrtermnscondition[],
  companyCode: string,
  requestNumber: string,
  transaction: Transaction
) {
  try {
    let key_request_number = requestNumber.replace(/\//g, "$");

    // Step 1: Delete existing records for the given request_number and company_code
    const deleteQuery = `
      DELETE FROM PR_SUPPL_TERM_COND
      WHERE request_number = ? AND company_code = ?;
    `;
    await sequelize.query(deleteQuery, {
      replacements: [key_request_number, companyCode],
      transaction,
    });
    console.log(
      `Deleted existing records for request_number ${requestNumber} and company_code ${companyCode}`
    );
    if (!termconditions || termconditions.length === 0) {
      console.log("No term conditions received from backend.");
      // return; // or handle accordingly
    }

    // Step 2: Insert new records for each item in the termconditions array
    for (const Termscondition of termconditions) {
      const insertQuery = `
        INSERT INTO PR_SUPPL_TERM_COND(request_number, company_code, supplier, remarks, dlvr_term, payment_terms, quatation_reference,delivery_address)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?);
      `;

      await sequelize.query(insertQuery, {
        replacements: [
          key_request_number,
          companyCode,
          Termscondition.tsupplier,
          Termscondition.remarks,
          Termscondition.dlvr_term,
          Termscondition.payment_terms,
          Termscondition.quotation_reference, // Corrected spelling
          Termscondition.delivery_address,
        ],
        transaction,
      });
      //  await transaction.commit();
      // Log the inserted record, typically log more meaningful info
      console.log(
        `Inserted new record for supplier ${Termscondition.tsupplier}`
      );
    }
  } catch (error) {
    console.error("Error in upserting purchase request details:", error);
    throw error; // Re-throw error to be handled by the caller if needed
  }
}
export const saveFile = async (
  req: RequestWithUser,
  res: Response
): Promise<Response | void> => {
  const { request_number, files } = req.body;

  // Validate request_number
  if (!request_number) {
    return res.status(400).json({
      success: false,
      message: "request_number is required.",
    });
  }

  // Validate files array
  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({
      success: false,
      message: "files array is required and should not be empty.",
    });
  }

  try {
    const query = `
      INSERT INTO UPLOADED_FILES_DLTS (
        company_code, request_number, file_name, extensions, org_file_name, 
        aws_file_locn, flow_level, modules, updated_by, created_by, user_file_name, created_at, updated_at
      ) VALUES (
        :company_code, :request_number, :file_name, :extensions, :org_file_name, 
        :aws_file_locn, :flow_level, :modules, :updated_by, :created_by, :user_file_name, NOW(), NOW()
      )
    `;

    for (const file of files) {
      const {
        company_code,
        file_name,
        extensions,
        org_file_name,
        aws_file_locn,
        flow_level,
        modules,
        updated_by,
        created_by,
        user_file_name,
      } = file;

      await sequelize.query(query, {
        replacements: {
          company_code: company_code || null,
          request_number,
          file_name: file_name || null,
          extensions: extensions || null,
          org_file_name: org_file_name || null,
          aws_file_locn: aws_file_locn || null,
          flow_level: flow_level || null,
          modules: modules || null,
          updated_by: updated_by || null,
          created_by: created_by || null,
          user_file_name: user_file_name || null,
        },
        type: QueryTypes.INSERT,
      });
    }

    return res.status(200).json({
      success: true,
      message: "File data stored successfully.",
    });
  } catch (error) {
    console.error("Error storing file data:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while storing file data.",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
// Controller to handle the request updatecancelrejectsentback
// export const updatecancelrejectsentback = async (
//   req: RequestWithUser,
//   res: Response
// ) => {
//   console.log("Incoming request dataXXXX:", req.body);

//   const { LAST_ACTION, REQUEST_NUMBER, COMPANY_CODE, loginid } = req.body;

//   if (!LAST_ACTION || !REQUEST_NUMBER || !COMPANY_CODE || !loginid) {
//     return res.status(400).json({
//       success: false,
//       message: "Invalid request data",
//     });
//   }

//   try {
//     console.log("Before executing update statement with data:", req.body);
//     await sequelize.query(
//       `UPDATE PURCHASE_REQUEST_HEADER
//            SET LAST_ACTION = ?, UPDATED_AT = NOW(), UPDATED_BY = ?
//            WHERE REQUEST_NUMBER = ? AND COMPANY_CODE = ?`,
//       { replacements: [LAST_ACTION, loginid, REQUEST_NUMBER, COMPANY_CODE] }
//     );

//     console.log("After executing update statement");

//     res.status(200).json({
//       success: true,
//       message: "Purchase request processed successfully.",
//     });
//   } catch (error) {
//     console.error("Error saving/updating purchase request:", error);
//     res.status(500).json({
//       success: false,
//       message: "Error saving/updating purchase request.",
//       error:
//         error instanceof Error ? error.message : "An unknown error occurred",
//     });
//   }
// };
/*export const updatecancelrejectsentback = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    console.log("Incoming request data:", req.body);

    const {
      LAST_ACTION,
      REQUEST_NUMBER,
      COMPANY_CODE,
      loginid,
      REMARKS,
      CREATEPR,
    } = req.body;

    console.log(CREATEPR);

    if (
      !LAST_ACTION ||
      !REQUEST_NUMBER ||
      !COMPANY_CODE ||
      !loginid ||
      !REMARKS
    ) {
      res.status(400).json({
        success: false,
        message: "Invalid request data",
      });
      return;
    }

    console.log("Before executing update statement with data:", req.body);

    if (REQUEST_NUMBER.startsWith("PO$")) {
      await sequelize.query(
        `UPDATE PURCHASE_REQUEST_DETAILS 
         SET PO_CANCEL = 'Y', REASON_FOR_PO_CANCEL = ?, CANCEL_PO_BY = ?, UPDATED_AT = NOW() 
         WHERE REF_DOC_NO = ? AND COMPANY_CODE = ?`,
        { replacements: [REMARKS, loginid, REQUEST_NUMBER, COMPANY_CODE] }
      );
    } else {
      await sequelize.query(
        `UPDATE PURCHASE_REQUEST_HEADER 
         SET LAST_ACTION = ?, UPDATED_AT = NOW(), UPDATED_BY = ?
         WHERE REQUEST_NUMBER = ? AND COMPANY_CODE = ?`,
        { replacements: [LAST_ACTION, loginid, REQUEST_NUMBER, COMPANY_CODE] }
      );
    }

    console.log("After executing update statement");

    res.status(200).json({
      success: true,
      message: "Purchase request processed successfully.",
    });
  } catch (error) {
    console.error("Error saving/updating purchase request:", error);
    res.status(500).json({
      success: false,
      message: "Error saving/updating purchase request.",
      error:
        error instanceof Error ? error.message : "An unknown error occurred",
    });
  }
};*/
async function generateEmailTemplate(
  data: IPurchaseRequestPf,
  requestNumber: string,
  createdBy: string
): Promise<string> {
  const formatRequestNumber = (num: string) =>
    num ? num.replace(/\$/g, "/") : "";
  console.log("Generating email template for request number:", requestNumber);

  return `<!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
              /* Reset styles */
              * { 
                  margin: 0;
                  padding: 0;
                  box-sizing: border-box;
              }
              
              body { 
                  font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Roboto', Arial, sans-serif; 
                  line-height: 1.6; 
                  color: #333;
                  -webkit-text-size-adjust: 100%;
                  margin: 0;
                  padding: 10px;
                  background-color: #f5f5f5;
              }
              
              .container { 
                  max-width: 600px; 
                  width: 100%;
                  margin: 0 auto; 
                  background-color: #ffffff; 
                  border-radius: 8px; 
                  border: 1px solid #2c3e50;
                  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              }
              
              @media screen and (max-width: 480px) {
                  body {
                      padding: 5px;
                  }
                  
                  .container {
                      margin: 0;
                      border-radius: 0;
                      border-left: none;
                      border-right: none;
                  }
                  
                  .content {
                      padding: 10px !important;
                  }
                  
                  .detail-row {
                      padding: 8px 5px !important;
                  }
                  
                  .detail-label, .detail-value {
                      font-size: 13px !important;
                  }
                  
                  .header h1 {
                      font-size: 16px !important;
                  }
                  
                  .notification-header {
                      font-size: 14px !important;
                      padding: 8px 5px !important;
                  }
                  
                  .footer {
                      font-size: 11px !important;
                      padding: 10px 5px !important;
                  }
              }
              
              .header { 
                  background-color: #2c3e50; 
                  color: white; 
                  padding: 15px 10px;
                  text-align: center;
              }
              
              .header h1 { 
                  margin: 0;
                  font-size: clamp(16px, 4vw, 20px);
                  word-spacing: 4px;
              }
              
              .notification-header { 
                  background-color: #ecf0f1; 
                  padding: 12px 10px;
                  text-align: center; 
                  font-weight: bold;
                  font-size: clamp(14px, 3.5vw, 16px);
                  color: #666;
              }
              
              .content { 
                  padding: 15px;
              }
              
              .detail-row { 
                  margin-bottom: 8px; 
                  display: flex; 
                  flex-direction: column;
                  padding: 8px;
                  border-bottom: 1px solid #eee;
              }
              
              @media screen and (max-width: 480px) {
                .no-border-mobile {
                    border-bottom: none !important;
                }
              }
              
              @media screen and (min-width: 481px) {
                  .detail-row {
                      flex-direction: row;
                      align-items: flex-start;
                  }
                  
                  .detail-label {
                      width: 150px;
                      padding-right: 15px;
                      text-align: right;
                  }
                  
                  .detail-value {
                      flex: 1;
                  }
              }
              
              .detail-label { 
                  font-weight: bold; 
                  color: #7f8c8d;
                  margin-bottom: 4px;
                  font-size: clamp(13px, 3.2vw, 15px);
              }
              
              .detail-value { 
                  padding-left: 8px;
                  font-size: clamp(13px, 3.2vw, 15px);
                  word-break: break-word;
              }
              
              .footer { 
                  padding: 15px 10px;
                  text-align: center;
                  font-size: clamp(11px, 2.8vw, 13px);
                  color: #000000;
                  border-top: 1px solid #2c3e50;
                  background-color: transparent;
              }
              
              .link { 
                  color: #3498db; 
                  text-decoration: none;
                  word-break: break-all;
                  display: inline-block;
                  padding: 4px 0;
              }
              
              .link:hover {
                  text-decoration: underline;
              }

              /* Tablet Styles */
              @media screen and (min-width: 768px) {
                  .detail-row {
                      flex-direction: row;
                      align-items: center;
                  }
                  
                  .detail-label {
                      width: 150px;
                      margin-bottom: 0;
                      padding-right: 15px;
                  }
                  
                  .footer {
                      text-align: right;
                  }
              }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>N O T I F I C A T I O N</h1>
              </div>
              <div class="notification-header">
                  An Item has been Assigned to you
              </div>
              <div class="content">
                  <div class="detail-row no-border-mobile">
                      <span class="detail-label">Link to Item:</span>
                      <span class="detail-value"><a href="https://qa-app.bayanattechnology.com/login" class="link">${formatRequestNumber(
                        requestNumber
                      )}</a></span>
                  </div>
                  <div class="detail-row">
                      <span class="detail-label">Description:</span>
                      <span class="detail-value">A Purchase Request Number ${formatRequestNumber(
                        requestNumber
                      )} initiated by ${createdBy} is now with you for the next step</span>
                  </div>
                  <div class="detail-row no-border-mobile">
                      <span class="detail-label">Initiated By:</span>
                      <span class="detail-value">${createdBy}</span>
                  </div>
                  <div class="detail-row">
                      <span class="detail-label">Initiated On:</span>
                      <span class="detail-value">${formatDate(
                        data.created_at
                      )}</span>
                  </div>
                  <div class="detail-row">
                      <span class="detail-label">Current Status:</span>
                      <span class="detail-value">${data.last_action}</span>
                  </div>
                  <div class="detail-row no-border-mobile">
                      <span class="detail-label">Last Modified By:</span>
                      <span class="detail-value">${data.updated_by}</span>
                  </div>
                  <div class="detail-row">
                      <span class="detail-label">Last Modified On:</span>
                      <span class="detail-value">${formatDate(
                        new Date()
                      )}</span>
                  </div>
              </div>
              <div class="footer">
                  Powered by Bayanat Technology – Procurement Management System (PMS)
              </div>
          </div>
      </body>
      </html>`;
}
