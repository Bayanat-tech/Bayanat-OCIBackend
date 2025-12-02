import { sequelize } from "../../../../database/connection";
import {
  IPurchaseRequestPf,
  IItemPrRequest,
  IPrtermnscondition,
} from "../../../../interfaces/Purchaseflow/Purucahseflow.interface";
import { notifyUser } from "../../../../helpers/functions";
import constants from "../../../../helpers/constants";
// Function to upsert a purchase request
export async function upsertPurchaseRequest(data: IPurchaseRequestPf) {
  const transaction = await sequelize.transaction();

  try {
    const isAddMode = !data.requestNumber;
    let generatedRequestNumber = data.requestNumber;

    // Insert or update header and retrieve requestNumber if in add mode
    console.log("DATA AFTER SUBMIT", data);

    console.log("before upsertPurchaseRequestHeader");
    if (data.last_action === "POGEN") {
      let key_request_number = data.requestNumber.replace(/\//g, "$");

      try {
        const [rows] = await sequelize.query(
          "CALL PRO_GEN_JESRA_PO_NO(:companyCode, :requestNumber, :userId, :prinCode)",
          {
            replacements: {
              companyCode: data.companyCode,
              requestNumber: key_request_number,
              userId: "RIJASC",
              prinCode: "10001",
            },
          }
        );
        console.log("Procedure executed successfully:", rows);
      } catch (error) {
        console.error("Error executing procedure:", error);
        throw error;
      }

      return;
    }

    const requestNumber = await upsertPurchaseRequestHeader(data, transaction);
    const userid = data.updated_by;

    if (isAddMode) {
      try {
        const [[{ code }]]: any = await sequelize.query(
          `SELECT code FROM GT_SESSION_INFO WHERE session_id = CONNECTION_ID() LIMIT 1;`,
          { transaction }
        );

        if (code) {
          generatedRequestNumber = code;
          console.log(`Generated request number: ${generatedRequestNumber}`);
        } else {
          console.log("No session code found, using provided request number.");
        }
      } catch (error) {
        console.error("Error querying GT_SESSION_INFO table:", error);
      }
    }

    await upsertPurchaseRequestDetails(
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

    await transaction.commit();

    // Get request_users dynamically
    let request_users = "";
    try {
      const sqlQuery = `
        SELECT FUN_EMAIL_SENT_STRING(:companyCode, FUN_GET_FLOW_ROLE_AL(:updatedBy, :companyCode)) AS email_cc;
      `;
      const [rows]: any = await sequelize.query(sqlQuery, {
        replacements: {
          companyCode: data.companyCode,
          updatedBy: data.updated_by,
        },
      });
      request_users = rows[0].email_cc;
      console.log("Email TO List:", request_users);
    } catch (error) {
      console.error("Error executing query:", error);
    }

    // Get CC list
    let cc = "";
    try {
      const sqlQuery = `
        SELECT FUN_EMAIL_CC_STRING(:companyCode, :createdBy, :requestUsers, :requestNumber) AS email_cc;
      `;
      const [rows]: any = await sequelize.query(sqlQuery, {
        replacements: {
          companyCode: data.companyCode,
          createdBy: data.created_by,
          requestUsers: request_users,
          requestNumber: generatedRequestNumber,
        },
      });
      cc = rows[0].email_cc;
      console.log("Email CC List:", cc);
    } catch (error) {
      console.error("Error executing query:", error);
    }

    let message = `An Item has been Assigned to you\n\nIn Request, the item ${generatedRequestNumber} initiated by ${
      data.created_by
    } 
    is now with you for the next step\n\nPurchase Request No - ${generatedRequestNumber}
    \n\nInitiated By: ${
      data.created_by
    }\n\nInitiated At: ${data.created_at.toISOString()}
    \n\nStatus: ${data.last_action}\n\nLast Modified By: ${
      data.updated_by
    }\n\nLast Modified At: ${new Date().toISOString()}`;

    await notifyUser({
      event: constants.EVENTS.TRANSACTION_COMPLETED,
      request_users: request_users,
      cc: cc,
      message: message,
    });
    console.log("Notification email sent.");
  } catch (error) {
    await transaction.rollback();
    console.error("Error upserting purchase request:", error);
  }
}

// Function to insert or update PURCHASE_REQUEST_HEADER
async function upsertPurchaseRequestHeader(
  data: IPurchaseRequestPf,
  transaction: any
): Promise<string> {
  // If requestNumber is null or an empty string, directly insert a new record
  console.log("header1");
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
    const insertQuery = `
    INSERT INTO PURCHASE_REQUEST_HEADER (
      CONTRACT_SOFT_HARD, AMC_SERVICE_STATUS, MATERIAL_MECHANICAL, MATERIAL_ELECTRICAL, MATERIAL_PLUMBING, MATERIAL_TOOLS, MATERIAL_CIVIL, MATERIAL_AC, MATERIAL_CLEANING, MATERIAL_OTHER,
      SERVICES_TEMP_STAFF, SERVICES_RENTALS, SERVICES_SUBCON_CONSLT, SERVICES_OTHER, OTHER_STATIONERY, OTHER_IT, OTHER_NEW_UNIFORM_PPE, OTHER_RPLCMT_UNIFORM, OTHER_OTHER, GOOD_MATERIAL_REQUEST,
      SERVICE_REQUEST, TYPE_OF_CONTRACT, TYPE_OF_MATERIAL_SUPPLY, REMARKS, WO_NUMBER, REQUEST_DATE, DESCRIPTION, PROJECT_CODE, COMPANY_CODE, CREATED_BY, LAST_ACTION, LAST_UPDATED,
      FLOW_TYPE, FLOW_CODE, HISTORY_SERIAL, UPDATED_AT, SERVICE_TYPE, TYPE_OF_PR, COVERED_BY_CONTRACT_YES, FLAG_SHARING_COST, BUDGETED_YES, CHECKED_STORE_YES
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
      ?, ?, 'PUR', '001', 1, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?
    )
`;

    const [result]: any = await sequelize.query(insertQuery, {
      replacements: [
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
        data.service_type, // New column data
        data.type_of_pr, // New column data
        data.covered_by_contract_yes, // New column data
        data.flag_sharing_cost, // New column data
        data.budgeted_yes, // New column data
        data.checked_store_yes, // New column data
      ],
      transaction,
    });

    console.log("header2");
    // Retrieve the generated request number from the insert result
    const userid = data.updated_by;
    return data.requestNumber;
    // return generatedRequestNumber; // Return the newly generated request number
  }
  let key_request_number = data.requestNumber.replace(/\//g, "$");
  console.log("header4");
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
      REQUEST_DATE = ?,
      DESCRIPTION = ?,
      PROJECT_CODE = ?,
      UPDATED_BY = ?,
      LAST_UPDATED = ?,
      WO_NUMBER = ?,
      REMARKS = ?,
      TYPE_OF_CONTRACT = ?,
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
      data.requestDate,
      data.description,
      data.projectCode,
      data.updated_by,
      data.updated_by,
      data.wo_number,
      data.remarks,
      data.type_of_contract,
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
        data.requestDate,
        data.description,
        data.projectCode,
        data.updated_by,
        data.updated_by,
        data.wo_number,
        data.remarks,
        data.type_of_contract,
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
  items: IItemPrRequest[],
  companyCode: string,
  requestNumber: string,
  projectcode: string,
  transaction: any
) {
  try {
    let key_request_number = requestNumber.replace(/\//g, "$");
    // Step 1: Delete existing records for the given request_number and company_code
    const deleteQuery = `
      DELETE FROM PURCHASE_REQUEST_DETAILS
      WHERE request_number = ? AND company_code = ?;
    `;
    await sequelize.query(deleteQuery, {
      replacements: [key_request_number, companyCode],
      transaction,
    });
    console.log(
      `Deleted existing records for request_number ${requestNumber} and company_code ${companyCode}`
    );

    // Step 2: Insert new records for each item
    for (const item of items) {
      console.log("1", item.item_code);
      console.log("2", item.item_rate);
      console.log("3", item.amount);
      console.log("4", item.cost_code);
      console.log("5", item.service_rm_flag);
      console.log("6", item.item_p_qty);
      console.log("6b", item.addl_item_desc);
      console.log("6a", item.allocated_approved_quantity);
      console.log("6c", item.upp);
      console.log('discount',item.discount_amount)
        console.log('discount',item.final_rate)
      //   console.log("7", item.p_uom);
      console.log("8", item.item_l_qty);
      console.log("9", item.l_uom);
      console.log("10", item.supplier);
      //  console.log("10", item.last_action); 15
      const insertQuery = `
        INSERT INTO PURCHASE_REQUEST_DETAILS (request_number, discount_amount,final_rate,company_code, item_code, item_rate, amount, cost_code,
        SERVICE_RM_FLAG,
ITEM_P_QTY,
P_UOM,
ITEM_L_QTY,    
L_UOM,ALLOCATED_APPROVED_QUANTITY,ADDL_ITEM_DESC,UPP,SUPPLIER,PRIN_CODE,PROJECT_CODE,DIV_CODE,ITEM_SEQUENCE_NO)
        VALUES (?,?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?);
      `;

      await sequelize.query(insertQuery, {
        replacements: [
          key_request_number,
          item.discount_amount,
          item.final_rate,
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
          item.addl_item_desc,
          item.upp,
          item.supplier,
          "10001",
          projectcode,
          "10",
          item.item_sequence_no
        ],
        transaction,
      });
      console.log(`Inserted new record for item ${item.item_code}`);
    }
  } catch (error) {
    console.error("Error in upserting purchase request details:", error);
    throw error; // Re-throw error to be handled by the caller if needed
  }
}

// Function to check if a header record exists
async function headerRecordExists(
  requestNumber: string,
  companyCode: string,
  transaction: any
): Promise<boolean> {
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
  transaction: any
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
  transaction: any
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
