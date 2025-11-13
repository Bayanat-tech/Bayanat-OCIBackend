import { Request, Response } from "express";
import { sequelize } from "../../database/connection";
import { QueryTypes } from "sequelize";
import { upsertPurchaseRequest } from "./purchaseRquestdbupdate_pf.Controller";
import { createLog, notifyUser } from "../../helpers/functions";
import constants from "../../helpers/constants";
import { format } from "date-fns";
import { IFiles, RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import { setUserLevel } from "../../helpers/globalVariables";
import { BoldReportsController } from "../BoldReportsController";
import {
  IPurchaseOrder,
  IPurchaseRequestPf,
  IItemPrRequest,
  IPrtermnscondition,
  IBasicPrRequest,
} from "../../interfaces/Purchaseflow/Purucahseflow.interface";

interface RequestWithUsercrs extends Request {
  body: {
    LAST_ACTION: string;
    REQUEST_NUMBER: string;
    COMPANY_CODE: string;
    loginid: string;
  };
}
interface VPurchaseRequestHeader {
  request_number: string;
  request_date: Date;
  description: string;
  company_code: string;
}

interface VPurchaseRequestDetail {
  item_code: string;
  item_rate: number;
  service_rm_flag: string;
  item_p_qty: number;
  supplier: string;
  p_uom: string;
  item_l_qty: number;
  allocated_approved_quantity: number;
  l_uom: string;
  amount: number;
  upp: number;
  last_action: string;
  cost_code: string;
  addl_item_desc: string;
  old_item_code: string; // Ensure this exists if you're using it in the update
}

import { number } from "joi";
import { PurchaseRequestHeader } from "../../models/Purchaseflow/purchaserequest_pf.model";
import { PurchaseRequestDetail } from "../../models/Purchaseflow/purchaserequest_pf.model";
import { DecimalDataType } from "sequelize";

interface RevisionResult {
  REVISION_NUMBER: number;
}

export const getPurchaserequest = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser: IUser = req.user;
    //console.log(RequestWithUser);
    console.log("inside getrequest");
    console.log("request_number");
    const { request_number, company_code } = req.params;

    console.log("request_number");
    console.log(request_number);

    if (typeof request_number === "string") {
      let ls_request_number = request_number.replace(/\$\$/g, "/");
      console.log("Replacement successful:", request_number); // Output: PR/24/0001
    } else {
      console.error("Error: request_number is not a string.", request_number);
    }
    const querycount =
      "SELECT COUNT(*) AS count FROM PURCHASE_REQUEST_HEADER WHERE REQUEST_NUMBER = :request_number";

    try {
      const [countResult] = await sequelize.query(querycount, {
        replacements: { request_number: request_number },
        type: QueryTypes.SELECT,
      });

      const count = (countResult as { count: number }).count;

      console.log(`Count for request_number ${request_number}:`, count);
      let count1 = 1;
      if (request_number.includes("PO$")) {
        const poquerydetail = `select * from GT_PO_PRINT_DETAILS
        order by item_sequence_no;`;
        console.log(poquerydetail);

        const procedureQuery = `CALL PRO_PO_PRINT_DATA( :request_number, :company_code)`;
        const procedureResult = await sequelize.query(procedureQuery, {
          replacements: {
            company_code: requestUser.company_code,
            request_number: request_number,
          },
          type: QueryTypes.RAW, // For calling stored procedures
        });
        const poquery = `select * from GT_PO_PRINT_HEADER;`;
        // Execute the SQL query using Sequelize
        const [RequestheaderData] = await sequelize.query(poquery, {
          replacements: { request_number },
          type: QueryTypes.SELECT,
        });

        // Fetch RequestdetailData (multiple rows)
        const RequestdetailData = await sequelize.query(poquerydetail, {
          replacements: { request_number },
          type: QueryTypes.SELECT,
        });
        const items = RequestdetailData.map((detail) => detail);
        if (!RequestheaderData || !RequestdetailData) {
          res.status(constants.STATUS_CODES.NOT_FOUND).json({
            success: false,
            message: "Purchase Request " + constants.MESSAGES.DOES_NOT_EXISTS,
          });
          return;
        }
        res.status(constants.STATUS_CODES.OK).json({
          success: true,
          data: {
            ...RequestheaderData, // Spread the header data
            items: RequestdetailData.map((detail) => detail),
          },
          console,
        });
        return;
      }
    } catch (error: unknown) {
      const knownError = error as { message: string };
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: knownError.message });
      return;
    }
    console.log("company_code:", company_code);
    // Continue with the rest of your logic if count is not 0
    console.log("Count is not zero, proceeding with other operations.");

    const [prinCodeResult] = (await sequelize.query(
      `SELECT prin_code 
   FROM MS_PRINCIPAL 
   WHERE PRIN_DEPT_CODE IN (
       SELECT distinct div_code 
       FROM PURCHASE_REQUEST_DETAILS
       WHERE REQUEST_NUMBER = :request_number
   );`,
      {
        replacements: { request_number },
        type: QueryTypes.SELECT,
      }
    )) as { prin_code: string }[];
    if (!prinCodeResult) {
      console.log("No PRIN_CODE found, exiting.");
      return;
    }

    const ls_prin_code = prinCodeResult.prin_code;

    const query = `SELECT REPLACE(request_number, '$', '/') as request_number,final_approved,fa_uploaded, flow_level_running,request_date, description, type_of_contract,
    amc_from,amc_to, type_of_material_supply, wo_number, remarks, 
    project_code, contract_soft_hard, amc_service_status, material_mechanical, material_electrical, material_plumbing,
     material_tools, material_civil, material_ac, material_cleaning, material_other, services_temp_staff, services_rentals,
     services_subcon_conslt, services_other, other_stationery, other_it, other_new_uniform_ppe, other_rplcmt_uniform, other_other, 
    good_material_request, service_request,last_action, need_by_date,service_type,type_of_pr,covered_by_contract_yes,flag_sharing_cost,budgeted_yes,checked_store_yes,project_name,div_code,
others,it_tech,stationary,laundry_housekeeping,accommodation,catering,medical,transportation, training, recruitment_hr, uniform, furniture, entertainment, barber, requestor_name
     FROM VW_PURCHASE_REQUEST_HEADER AS PurchaseRequestHeader WHERE PurchaseRequestHeader.request_number = :request_number    LIMIT 1;`;

    /*  const querydetail = `SELECT request_number, item_code, item_rate, amount, cost_code, service_rm_flag, item_p_qty, p_uom, item_l_qty, allocated_approved_quantity,
 l_uom, addl_item_desc, upp,discount_amount,supplier FROM PURCHASE_REQUEST_DETAILS AS PurchaseRequestDetails WHERE PurchaseRequestDetails.request_number =  :request_number ;`;*/

    const querydetail = `SELECT * FROM VW_PURCHASE_REQUEST_TRANSACTION1 AS PurchaseRequestDetails WHERE PurchaseRequestDetails.REQUEST_NUMBER = :request_number AND PRIN_CODE = :ls_prin_code ORDER BY ITEM_SEQUENCE_NO ;`;
    console.log(querydetail);

    const termcondition = `
  SELECT request_number, supplier as tsupplier, remarks, dlvr_term, payment_terms, quatation_reference,delivery_address
  FROM PR_SUPPL_TERM_COND
  WHERE request_number = :request_number
`;

    /*const querydetail =
      'SELECT * FROM VW_PURCHASE_RQUEST_TRANSACTION AS PurchaseRequestDetails WHERE PurchaseRequestDetails.request_number =  :request_number ;`*/

    // Execute the SQL query using Sequelize
    const [RequestheaderData] = await sequelize.query(query, {
      replacements: { request_number, company_code },
      type: QueryTypes.SELECT,
    });

    // Fetch RequestdetailData (multiple rows)
    const RequestdetailData = await sequelize.query(querydetail, {
      replacements: { request_number, ls_prin_code },
      type: QueryTypes.SELECT,
    });

    const Termconditiondata = await sequelize.query(termcondition, {
      replacements: { request_number },
      type: QueryTypes.SELECT,
    });

    console.log(RequestheaderData);
    console.log(RequestdetailData);
    console.log(Termconditiondata);
    const items = Termconditiondata.map((detail) => detail);

    // const Termscondition = Termconditiondata.map((detail) => detail);

    if (!RequestheaderData || !RequestdetailData) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Purchase Request " + constants.MESSAGES.DOES_NOT_EXISTS,
      });
      return;
    }
    // Pass the array to the frontend
    // Pass the array to the frontend
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: {
        ...RequestheaderData, // Include header data
        items: RequestdetailData, // Include request details
        Termscondition: Termconditiondata, // Include the array of terms and conditions
      },
    });

    return;
  } catch (error: unknown) {
    const knownError = error as { message: string };
    res
      .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: knownError.message });
  }
};



// Construct the purchase request object
// Assuming termconditions is passed into the function or available in the current context
export const createOrUpdatePurchaseRequestSequential = async (
  req: RequestWithUser,
  res: Response
) => {
  console.log("Incoming request dataXXXX:", req.body);

  // Destructure the incoming request body
  const {
    request_number,
    request_date,
    description,
    project_code,
    company_code,
    created_by,
    updated_by,
    wo_number,
    remarks,
    type_of_contract,
    amc_from,
    amc_to,
    type_of_material_supply,
    contract_soft_hard,
    amc_service_status,
    material_mechanical,
    material_electrical,
    material_plumbing,
    material_tools,
    material_civil,
    material_ac,
    material_cleaning,
    material_other,
    services_temp_staff,
    services_rentals,
    services_subcon_conslt,
    services_other,
    other_stationery,
    other_it,
    other_new_uniform_ppe,
    other_rplcmt_uniform,
    other_other,
    good_material_request,
    service_request,
    last_action,
    created_at,
    updated_at,
    flow_level_running,
    fa_uploaded,
    final_approved,
    items,
    Termscondition,
    service_type,
    need_by_date,
  } = req.body;

  try {
    const purchaseRequest = mapIncomingRequestData(req.body);
    console.log("Before upsertPurchaseRequest with data:", purchaseRequest);
    console.log("sandeep2", purchaseRequest.service_type);
    console.log("sandeep2", purchaseRequest.need_by_date);
    await upsertPurchaseRequest(purchaseRequest); // Call the function with the correctly structured data
    console.log("After upsertPurchaseRequest");

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
};

export const updatePurchaseOrder = async (
  req: RequestWithUser,
  res: Response
) => {
  const requestUser: IUser = req.user;
  const {
    companyCode,
    doc_no,
    doc_date,
    ref_doc_no,
    supplier,
    request_number,
    div_code,
    po_confirm,
    po_cancel,
    cancel_type,
    supp_name,
    dlvr_term,
    supp_addr1,
    supp_addr2,
    supp_addr3,
    supp_addr4,
    supp_telno1,
    supp_faxno1,
    supp_email1,
    project_code,
    project_name,
    wo_number,
    remarks,
    payment_terms,
    last_action,
    items,
  } = req.body;

  console.log("Incoming request data:", req.body);

  const purchaseRequest: IPurchaseOrder = {
    companyCode,
    doc_no,
    doc_date,
    ref_doc_no,
    supplier,
    request_number,
    div_code,
    po_confirm,
    po_cancel,
    cancel_type,
    supp_name,
    delvr_term: dlvr_term,
    supp_addr1,
    supp_addr2,
    supp_addr3,
    supp_addr4,
    supp_telno1,
    supp_faxno1,
    supp_email1,
    project_code,
    project_name,
    wo_number,
    remarks,
    payment_terms,
    last_action,
    items: Array.isArray(items)
      ? items.map((item) => ({
          request_number,
          cost_code: item.cost_code,
          item_code: item.item_code,
          final_rate: item.final_rate,
          allocated_approved_quantity: item.allocated_approved_quantity,
          item_p_qty: item.item_p_qty,
          item_l_qty: item.item_l_qty,
          p_uom: item.puom,
          upp: item.upp,
          appr_item_l_qty: item.appr_item_l_qty,
          appr_item_p_qty: item.appr_item_p_qty,
          currency_rate: item.currency_rate,
          amount: item.amount,
          company_code: item.company_code,
          curr_code: item.curr_code,
          lcurr_amt: item.lcurr_amt,
          item_cancel: item.item_cancel,
          supplier: item.supplier,
          service_rm_flag: item.service_rm_flag,
          addl_item_desc: item.addl_item_desc,
          div_code: item.div_code,
          ref_doc_no: item.ref_doc_no,
          sr_no: item.sr_no,
          po_mod_appr_qty: item.po_mod_appr_qty,
          po_mod_final_rate: item.po_mod_final_rate,
          po_mod_amount: item.po_mod_amount,
          po_confirm: item.po_confirm,
          po_cancel: item.po_cancel,
        }))
      : [],
  };

  const transaction = await sequelize.transaction();
  try {
    // Handle PO Modification
    if (purchaseRequest.last_action === "Pomodify") {
      for (const item of purchaseRequest.items) {
        await sequelize.query(
          `UPDATE PURCHASE_REQUEST_DETAILS
           SET po_mod_final_rate = ?, 
               po_mod_amount = ?, 
               po_confirm = 'N', 
               po_cancel = 'N'
           WHERE company_code = ? 
             AND ref_doc_no = ? 
             AND item_code = ? 
             AND final_rate = ? 
             AND allocated_approved_quantity = ? 
             AND item_p_qty = ? 
             AND item_l_qty = ? 
             AND addl_item_desc = ?`,
          {
            replacements: [
              item.po_mod_final_rate,
              item.po_mod_amount,
              requestUser.company_code,
              item.ref_doc_no,
              item.item_code,
              item.final_rate,
              item.allocated_approved_quantity,
              item.item_p_qty,
              item.item_l_qty,
              item.addl_item_desc,
            ],
            transaction,
          }
        );
      }
      await transaction.commit();
      res.status(200).json({ message: "PO modification successful." });
      return;
    }

    // Handle PO Confirmation
    if (purchaseRequest.last_action === "Confirm") {
      // Database updates
      await sequelize.query(
        "UPDATE PURCHASE_REQUEST_DETAILS SET HISTORY_SERIAL = 0, PO_CONFIRM = 'Y', PO_CANCEL = 'N', PO_DATE = NOW() WHERE REF_DOC_NO = ? AND COMPANY_CODE = ?",
        {
          replacements: [purchaseRequest.ref_doc_no, requestUser.company_code],
          transaction,
        }
      );

      await sequelize.query(
        `UPDATE PO_DETAILS
         SET REVISION_NUMBER = DUMM_REVISION_NUMBER
         WHERE ref_doc_no = ? AND company_code = ? AND REVISION_NUMBER IS NULL`,
        {
          replacements: [purchaseRequest.ref_doc_no, requestUser.company_code],
          transaction,
        }
      );

      await transaction.commit();

      try {
        // Commented out email notifications and PDF generation
        /*
        const [revisionResults] = await sequelize.query<RevisionResult>(
          `SELECT MAX(REVISION_NUMBER) as REVISION_NUMBER FROM PO_DETAILS WHERE REF_DOC_NO = ?`,
          {
            replacements: [purchaseRequest.ref_doc_no],
            type: QueryTypes.SELECT,
          }
        );

        const isModifiedPO = revisionResults?.REVISION_NUMBER > 0;
        console.log("PO Revision Number:", revisionResults?.REVISION_NUMBER);

        const supplierEmail = "Sandeep.dandekar@bayanattechnology.com,gaurang.pai@bayanattechnology.com";

        if (supplierEmail) {
          try {
            console.log("Starting PDF generation for PO:", purchaseRequest.ref_doc_no);
            const pdfBase64 = await BoldReportsController.exportPOAsBase64(
              purchaseRequest.ref_doc_no,
              requestUser.company_code
            );

            await notifyUser({
              event: isModifiedPO ? "PO_MODIFIED" : "PO_CONFIRMED",
              subject: `${isModifiedPO ? "Modified" : "Confirmed"} PO: ${purchaseRequest.ref_doc_no.replace(/\$/g, "/")}`,
              message: isModifiedPO
                ? `Dear Sir,...` 
                : `Dear Sir,...`,
              request_users: supplierEmail,
              attachments: [
                {
                  filename: `PO_${purchaseRequest.ref_doc_no.replace(/\$/g, "/")}.pdf`,
                  content: pdfBase64,
                  encoding: "base64",
                  contentType: "application/pdf",
                },
              ],
            });
          } catch (error) {
            console.error("Failed to generate/attach PDF:", error);
            console.log("Continuing with transaction despite PDF error");
          }
        }
        */

        res
          .status(200)
          .json({ message: "Purchase order processed successfully." });
      } catch (error) {
        try {
          await transaction.rollback();
        } catch (rollbackError) {
          console.error("Error during transaction rollback:", rollbackError);
        }
        console.error("Transaction rolled back due to error:", error);
        res.status(500).json({ error: "Failed to process purchase order." });
      }
    }
  } catch (error) {
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      console.error("Error rolling back transaction:", rollbackError);
    }
    console.error("Transaction rolled back due to error:", error);
    res.status(500).json({ error: "Failed to process purchase order." });
  }
};

// Updated function
export function mapIncomingRequestData(data: any): IPurchaseRequestPf {
  // Map Items
  const mapItems = Array.isArray(data.items)
    ? data.items.map(
        (item: any): IItemPrRequest => ({
          item_code: item.item_code || "",
          item_desp: item.item_desp || "",
          item_group_code: item.item_group_code || "",
          item_rate: parseFloat(item.item_rate) || 0,
          p_uom: item.p_uom || "",
          l_uom: item.l_uom || "",
          upp: parseFloat(item.upp) || 0,
          item_l_qty: parseFloat(item.item_l_qty) || 0,
          item_p_qty: parseFloat(item.item_p_qty) || 0,
          appr_upp: item.appr_upp ? parseFloat(item.appr_upp) : 0,
          appr_item_l_qty: item.appr_item_l_qty
            ? parseFloat(item.appr_item_l_qty)
            : 0,
          appr_item_p_qty: item.appr_item_p_qty
            ? parseFloat(item.appr_item_p_qty)
            : 0,
          currency_rate: item.currency_rate
            ? parseFloat(item.currency_rate)
            : 0,
          amount: parseFloat(item.amount) || 0,
          discount_amount: parseFloat(item.discount_amount) || 0,
          final_rate: parseFloat(item.final_rate) || 0,
          company_code: item.company_code || "",
          updated_at: new Date(item.updated_at || Date.now()),
          updated_by: item.updated_by || "",
          request_number: item.request_number || "",
          curr_code: item.curr_code || "",
          lcurr_amt: item.lcurr_amt ? parseFloat(item.lcurr_amt) : 0,
          allocated_approved_quantity:
            parseFloat(item.allocated_approved_quantity) || 0,
          supplier: item.supplier || "",
          service_rm_flag: item.service_rm_flag || "",
          addl_item_desc: item.addl_item_desc || "",
          flow_level_running: parseInt(item.flow_level_running, 10) || 0,
          pr_amount: item.pr_amount ? parseFloat(item.pr_amount) : 0,
          po_amount: item.po_amount ? parseFloat(item.po_amount) : 0,
          month_budget: item.month_budget ? parseFloat(item.month_budget) : 0,
          cost_code: item.cost_code || "",
          cost_name: item.cost_name || "",
          item_sequence_no: item.item_sequence_no || 0,
        })
      )
    : [];

  // Debug Logging for Items
  if (!Array.isArray(data.items)) {
    console.warn("Items is not an array or does not exist:", data.items);
  }

  // Map Terms Conditions
  const mapTermsConditions = Array.isArray(data.Termscondition)
    ? data.Termscondition.map(
        (term: any): IPrtermnscondition => ({
          tsupplier: term.tsupplier || "",
          remarks: term.remarks || "",
          dlvr_term: term.dlvr_term || "",
          payment_terms: term.payment_terms || "",
          quotation_reference: term.quatation_reference || "", // Corrected key name
          delivery_address: term.delivery_address || "", // <-- Add this line
        })
      )
    : [];

  // Debug Logging for TermsCondition
  if (!Array.isArray(data.Termscondition)) {
    console.warn(
      "Termscondition is not an array or does not exist:",
      data.Termscondition
    );
  }

  // Map Basic Request Data
  const basicPrRequest: IBasicPrRequest = {
    requestNumber: data.request_number || "",
    requestDate: new Date(data.request_date || Date.now()),
    description: data.description || "",
    projectCode: data.project_code || "",
    wo_number: data.wo_number || "",
    remarks: data.remarks || "",
    type_of_contract: data.type_of_contract || "",
    amc_from: new Date(data.amc_from || Date.now()),
    amc_to: new Date(data.amc_to || Date.now()),
    type_of_material_supply: data.type_of_material_supply || "",
    contract_soft_hard: data.contract_soft_hard || "",
    amc_service_status: data.amc_service_status || "",
    material_mechanical: data.material_mechanical || "",
    material_electrical: data.material_electrical || "",
    material_plumbing: data.material_plumbing || "",
    material_tools: data.material_tools || "",
    material_civil: data.material_civil || "",
    material_ac: data.material_ac || "",
    material_cleaning: data.material_cleaning || "",
    material_other: data.material_other || "",
    services_temp_staff: data.services_temp_staff || "",
    services_rentals: data.services_rentals || "",
    services_subcon_conslt: data.services_subcon_conslt || "",
    services_other: data.services_other || "",
    other_stationery: data.other_stationery || "",
    other_it: data.other_it || "",
    other_new_uniform_ppe: data.other_new_uniform_ppe || "",
    other_rplcmt_uniform: data.other_rplcmt_uniform || "",
    other_other: data.other_other || "",
    good_material_request: data.good_material_request || "",
    service_request: data.service_request || "",
    last_action: data.last_action || "",
    created_by: data.created_by || "",
    updated_by: data.updated_by || "",
    created_at: new Date(data.created_at || Date.now()),
    updated_at: new Date(data.updated_at || Date.now()),
    flow_level_running: parseInt(data.flow_level_running, 10) || 0,
    final_approved: data.final_approved || "",
    fa_uploaded: data.fa_uploaded || "",
    type_of_pr: data.type_of_pr,
    covered_by_contract_yes: data.covered_by_contract_yes,
    flag_sharing_cost: data.flag_sharing_cost,
    budgeted_yes: data.budgeted_yes,
    checked_store_yes: data.checked_store_yes,
    amount: data.amount,
    need_by_date: data.need_by_date,
    service_type: data.service_type,
    // ✅ Newly added from interface
    accommodation: data.accommodation,

    div_code: data.div_code,

    catering: data.catering || "N",
    laundry_housekeeping: data.laundry_housekeeping || "N", // corrected spelling
    medical: data.medical || "N",
    transportation: data.transportation || "N",
    training: data.training || "N",
    recruitment_hr: data.recruitment_hr || "N",
    uniform: data.uniform || "N",
    stationary: data.stationary || "N",
    it_tech: data.it_tech || "N",
    furniture: data.furniture || "N",
    entertainment: data.entertainment || "N",
    barber: data.barber || "N",
    others: data.others || "N",
    requestor_name: data.requestor_name || "",
  };
  console.log("print div_code", data.div_code);
  // Combine Data into Final Purchase Request Object
  const purchaseRequest: IPurchaseRequestPf = {
    ...basicPrRequest,
    companyCode: data.company_code || "",
    items: mapItems,
    termconditions: mapTermsConditions,
  };

  // Final Debug Logging
  console.log("Mapped Purchase Request:", purchaseRequest);

  return purchaseRequest;
}
export const getPurchaseRequestLog = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    console.log("✅ getPurchaseRequestLog called");

    const { requestNumber } = req.params;

    if (!requestNumber) {
      res
        .status(400)
        .json({ success: false, message: "❌ requestNumber is required" });
      return;
    }

    const query = `
      SELECT 
          * FROM VW_JASRA_PURCHASE_REQUEST_LOGTREE
      WHERE REQUEST_NUMBER = :requestNumber;
    `;

    const results = await sequelize.query(query, {
      replacements: { requestNumber },
      type: QueryTypes.SELECT,
    });

    console.log(
      "✅ Query executed successfully. Retrieved",
      results.length,
      "records"
    );

    res.status(200).json({ success: true, data: results });
  } catch (error: unknown) {
    console.error("❌ Error fetching PR log:", error);

    res.status(500).json({
      success: false,
      message: "An error occurred while fetching PR log",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

const formatDate = (dateString: string): string => {
  const parsedDate = new Date(dateString);
  return format(parsedDate, "yyyy-MM-dd"); // Formats to 'YYYY-MM-DD'
};

export const fetchPRregisterdata = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    console.log("✅ fetchPRregisterdata called");
    console.log("✅ Query Params:", req.query);

    // Extract and sanitize query parameters
    const fromDate = String(req.query.fromDate || "").trim();
    const toDate = String(req.query.toDate || "").trim();
    const selectedProjectCode = String(
      req.query.selectedProjectCode || ""
    ).trim();
    const requestStatus = String(req.query.requestStatus || "").trim();
    const prType = String(req.query.prType || "").trim();
    const serviceRmFlag = String(req.query.serviceRmFlag || "").trim();
    const reportType = String(req.query.reportType || "").trim();

    // Construct dynamic SQL query
    let query =
      reportType === "Summary"
        ? `SELECT DISTINCT request_number, header_amount, project_name, request_date, status,type_of_pr,div_code FROM VW_PR_REGISTER`
        : `SELECT * FROM VW_PR_REGISTER`;

    const conditions: string[] = [];
    const replacements: Record<string, string> = {};

    // Add date range filter

    if (fromDate?.trim() && toDate?.trim()) {
      conditions.push("REQUEST_DATE BETWEEN :fromDate AND :toDate");
      replacements.fromDate = format(new Date(fromDate), "yyyy-MM-dd");
      replacements.toDate = format(new Date(toDate), "yyyy-MM-dd");
    }

    // Add conditions only if relevant
    if (selectedProjectCode) {
      conditions.push("PROJECT_CODE = :selectedProjectCode");
      replacements.selectedProjectCode = selectedProjectCode;
    }

    if (requestStatus && requestStatus !== "All") {
      conditions.push("LAST_ACTION = :requestStatus");
      replacements.requestStatus = requestStatus;
    }

    if (prType && prType !== "All") {
      conditions.push("TYPE_OF_PR = :prType");
      replacements.prType = prType;
    }

    if (serviceRmFlag && serviceRmFlag !== "All") {
      conditions.push("SERVICE_RM_FLAG = :serviceRmFlag");
      replacements.serviceRmFlag = serviceRmFlag;
    }

    // Append conditions if available
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    console.log("✅ Final Query:", query);
    console.log("✅ Query Replacements:", replacements);

    // Execute the query
    const rows = await sequelize.query(query, {
      replacements,
      type: QueryTypes.SELECT,
    });

    console.log(
      `✅ Query executed successfully. Retrieved ${rows.length} records.`
    );

    // Send response
    res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("❌ Error fetching PR register data:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while fetching PR register data.",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const fetchPOregisterdata = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    console.log("✅ fetchPoregisterdata called");
    console.log("✅ Query Params:", req.query);

    // Extract and sanitize query parameters
    const fromDate = String(req.query.fromDate || "").trim();
    const toDate = String(req.query.toDate || "").trim();
    const selectedProjectCode = String(
      req.query.selectedProjectCode || ""
    ).trim();
    const requestStatus = String(req.query.requestStatus || "").trim();
    const prType = String(req.query.prType || "").trim();
    const serviceRmFlag = String(req.query.serviceRmFlag || "").trim();
    const reportType = String(req.query.reportType || "").trim();

    // Ensure required parameters exist
    /*if (!fromDate || !toDate) {
      res.status(400).json({
        success: false,
        message: "❌ fromDate and toDate are required.",
      });
      return;
    }*/

    // Construct dynamic SQL query
    /*let query = `
      SELECT * FROM VW_PO_REGISTER_JASRA
      WHERE REQUEST_DATE BETWEEN :fromDate AND :toDate
    `;*/
    let query =
      reportType === "Summary"
        ? `SELECT * FROM VW_PO_REGISTER_JASRA`
        : `SELECT * FROM VW_PO_REGISTER_JASRA`;

    const conditions: string[] = [];
    const replacements: Record<string, string> = {};

    // Add date range filter

    if (fromDate?.trim() && toDate?.trim()) {
      conditions.push("REQUEST_DATE BETWEEN :fromDate AND :toDate");
      replacements.fromDate = format(new Date(fromDate), "yyyy-MM-dd");
      replacements.toDate = format(new Date(toDate), "yyyy-MM-dd");
    }

    // Add conditions only if relevant
    if (selectedProjectCode) {
      conditions.push("PROJECT_CODE = :selectedProjectCode");
      replacements.selectedProjectCode = selectedProjectCode;
    }

    if (requestStatus && requestStatus !== "All") {
      conditions.push("LAST_ACTION = :requestStatus");
      replacements.requestStatus = requestStatus;
    }

    if (prType && prType !== "All") {
      conditions.push("TYPE_OF_PR = :prType");
      replacements.prType = prType;
    }

    if (serviceRmFlag && serviceRmFlag !== "All") {
      conditions.push("SERVICE_RM_FLAG = :serviceRmFlag");
      replacements.serviceRmFlag = serviceRmFlag;
    }

    // Append conditions if available
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    console.log("✅ Final Query:", query);
    console.log("✅ Query Replacements:", replacements);

    // Execute the query
    const rows = await sequelize.query(query, {
      replacements,
      type: QueryTypes.SELECT,
    });

    console.log(
      `✅ Query executed successfully. Retrieved ${rows.length} records.`
    );

    // Send response
    res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("❌ Error fetching PR register data:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while fetching PR register data.",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const fetchRequestNoFromGTSession = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const [[sessionData]]: any = await sequelize.query(
      `SELECT code FROM GT_SESSION_INFO WHERE session_id = CONNECTION_ID() LIMIT 1;`
    );

    if (sessionData?.code) {
      console.log(`Generated request number from session: ${sessionData.code}`);
      res.status(200).json({ success: true, data: sessionData.code });
    } else {
      console.log("No session code found.");
      res.status(404).json({
        success: false,
        message: "Request number not found in session.",
      });
    }
  } catch (error) {
    console.error("Error querying GT_SESSION_INFO table:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const fetchUserlevel = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { userId, companyCode, flow_code } = req.query; // Extract query params

    if (!userId || !companyCode) {
      res
        .status(400)
        .json({ success: false, message: "Missing userId or companyCode" });
      return;
    }

    const [[userLevel]]: any = await sequelize.query(
      `SELECT MIN(FLOW_LEVEL) AS flowLevel FROM V_USER_FLOW_DETAILS WHERE USER_CODE = ? AND COMPANY_CODE = ? AND FLOW_CODE = ?`,
      { replacements: [userId, companyCode, flow_code] }
    );

    if (userLevel?.flowLevel !== null) {
      setUserLevel(userLevel.flowLevel);
      res.status(200).json({ success: true, data: userLevel.flowLevel });
    } else {
      res.status(404).json({
        success: false,
        message: "No flow level found for the given user and company.",
      });
    }
  } catch (error) {
    console.error("Error fetching user level:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const CheckCostcontroller = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // Extract and validate query parameters
    const userId = String(req.query.userId || "").trim();
    const companyCode = String(req.query.companyCode || "").trim();

    if (!userId || !companyCode) {
      console.error("❌ Missing userId or companyCode:", {
        userId,
        companyCode,
      });
      res
        .status(400)
        .json({ success: false, message: "Missing userId or companyCode" });
      return;
    }

    console.log("✅ Inside backend CheckCostcontroller", {
      userId,
      companyCode,
    });

    // Execute the query with proper parameter binding
    const [[result]]: any = await sequelize.query(
      `SELECT
          CASE
              WHEN COUNT(*) > 0 THEN 'YES'
              ELSE 'NO'
          END AS Costcontroller
       FROM V_USER_FLOW_DETAILS
       WHERE (FLOW_ROLE = '009' or FLOW_ROLE = '010') AND USER_CODE = ? AND COMPANY_CODE = ?`,
      { replacements: [userId, companyCode] }
    );

    // If query execution fails, result will be undefined
    if (!result) {
      console.error("❌ Database query failed:", { userId, companyCode });
      res.status(500).json({ success: false, message: "Database query error" });
      return;
    }

    console.log("✅ Query result:", result);
    res
      .status(200)
      .json({ success: true, data: result.Costcontroller || "NO" });
  } catch (error) {
    console.error("❌ Error fetching Costcontroller:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const Fetchmessagebox = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { userId, companyCode } = req.query;

    if (!userId || !companyCode) {
      res
        .status(400)
        .json({ success: false, message: "Missing userId or companyCode" });
      return;
    }

    console.log("✅ Inside backend Fetchmessagebox");

    // Fetch actual message box data
    const [results]: any = await sequelize.query(
      `SELECT MESSAGE_BOX, MESSAGE_TYPE 
       FROM GT_SESSION_MESSAGEBOX 
       WHERE USER_ID = :userId`,
      {
        replacements: { userId },
      }
    );

    console.log("✅ Messages fetched:", results);

    res.status(200).json({ success: true, data: results });
  } catch (error) {
    console.error("❌ Error fetching Fetchmessagebox:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const bugetcurstatusprojectwiseconsolidated = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    console.log("✅ bugetcurstatusprojectwiseconsolidated called");
    console.log("✅ Query Params:", req.query);

    const fromDate = String(req.query.fromDate || "").trim();
    const toDate = String(req.query.toDate || "").trim();
    const selectedProjectCode = String(
      req.query.selectedProjectCode || ""
    ).trim();
    const requestStatus = String(req.query.requestStatus || "").trim();
    const prType = String(req.query.prType || "").trim();
    const serviceRmFlag = String(req.query.serviceRmFlag || "").trim();

    if (!fromDate || !toDate) {
      res.status(400).json({
        success: false,
        message: "❌ fromDate and toDate are required.",
      });
      return;
    }

    let query = `
      SELECT * FROM VW_BUDGET_CURR_STAT_PROJECTWISE_CONSOLIDATED
      WHERE REQUEST_DATE BETWEEN :fromDate AND :toDate
    `;

    // Prepare replacements object
    const replacements: Record<string, string> = { fromDate, toDate };

    if (selectedProjectCode) {
      query += " AND PROJECT_CODE = :selectedProjectCode";
      replacements.selectedProjectCode = selectedProjectCode;
    }
    if (requestStatus) {
      query += " AND LAST_ACTION = :requestStatus";
      replacements.requestStatus = requestStatus;
    }
    if (prType) {
      query += " AND TYPE_OF_PR = :prType";
      replacements.prType = prType;
    }
    if (serviceRmFlag) {
      query += " AND SERVICE_RM_FLAG = :serviceRmFlag";
      replacements.serviceRmFlag = serviceRmFlag;
    }

    console.log("✅ Final Query:", query);
    console.log("✅ Query Replacements:", replacements);
    query = "SELECT * FROM VW_BUDGET_CURR_STAT_PROJECTWISE_CONSOLIDATED";
    // Execute the query
    const rows = await sequelize.query(query, {
      replacements,
      type: QueryTypes.SELECT,
    });

    console.log(
      `✅ Query executed successfully. Retrieved ${rows.length} records.`
    );

    // Send response (ensure no return statement)
    res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error(
      "❌ Error fetching bugetcurstatusprojectwiseconsolidated  data:",
      error
    );
    res.status(500).json({
      success: false,
      message: "An error occurred while fetching PR register data.",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
export const fetchProjectwisebudgetAllocation = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    console.log("✅ fetchProjectwisebudgetAllocation  called");
    console.log("✅ Query Params:", req.query);

    // Extract and sanitize query parameters
    const fromDate = String(req.query.fromDate || "").trim();
    const toDate = String(req.query.toDate || "").trim();
    const selectedProjectCode = String(
      req.query.selectedProjectCode || ""
    ).trim();
    const requestStatus = String(req.query.requestStatus || "").trim();
    const prType = String(req.query.prType || "").trim();
    const serviceRmFlag = String(req.query.serviceRmFlag || "").trim();

    // Ensure required parameters exist
    if (!fromDate || !toDate) {
      res.status(400).json({
        success: false,
        message: "❌ fromDate and toDate are required.",
      });
      return;
    }

    // Construct dynamic SQL query
    let query = `
      SELECT * FROM VW_PROJECTWISE_BUDGET_ALLOCATION 
      WHERE REQUEST_DATE BETWEEN :fromDate AND :toDate
    `;

    // Prepare replacements object
    const replacements: Record<string, string> = { fromDate, toDate };

    if (selectedProjectCode) {
      query += " AND PROJECT_CODE = :selectedProjectCode";
      replacements.selectedProjectCode = selectedProjectCode;
    }
    if (requestStatus) {
      query += " AND LAST_ACTION = :requestStatus";
      replacements.requestStatus = requestStatus;
    }
    if (prType) {
      query += " AND TYPE_OF_PR = :prType";
      replacements.prType = prType;
    }
    if (serviceRmFlag) {
      query += " AND SERVICE_RM_FLAG = :serviceRmFlag";
      replacements.serviceRmFlag = serviceRmFlag;
    }

    console.log("✅ Final Query:", query);
    console.log("✅ Query Replacements:", replacements);
    //query = "npm";
    // Execute the query
    let query1 = "SELECT * FROM VW_PROJECTWISE_BUDGET_ALLOCATION ";
    const rows = await sequelize.query(query1, {
      replacements,
      type: QueryTypes.SELECT,
    });

    console.log(
      `✅ Query executed successfully. Retrieved ${rows.length} records.`
    );

    // Send response (ensure no return statement)
    res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("❌ Error fetchProjectwisebudgetAllocation  data:", error);
    res.status(500).json({
      success: false,
      message:
        "An error occurred while fetching fetchProjectwisebudgetAllocation   data.",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const fetchCostwisebudgetAllocation = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // Extract and sanitize query parameters
    const fromDate = String(req.query.fromDate || "").trim();
    const toDate = String(req.query.toDate || "").trim();
    const selectedProjectCode = String(
      req.query.selectedProjectCode || ""
    ).trim();
    const requestStatus = String(req.query.requestStatus || "").trim();
    const prType = String(req.query.prType || "").trim();
    const serviceRmFlag = String(req.query.serviceRmFlag || "").trim();

    // Ensure required parameters exist
    if (!fromDate || !toDate) {
      res.status(400).json({
        success: false,
        message: "❌ fromDate and toDate are required.",
      });
      return;
    }

    // Construct dynamic SQL query
    let query = `
      SELECT * FROM VW_COSTWISE_BUDGET_ALLOCATION 
      WHERE REQUEST_DATE BETWEEN :fromDate AND :toDate
    `;

    // Prepare replacements object
    const replacements: Record<string, string> = { fromDate, toDate };

    if (selectedProjectCode) {
      query += " AND PROJECT_CODE = :selectedProjectCode";
      replacements.selectedProjectCode = selectedProjectCode;
    }
    if (requestStatus) {
      query += " AND LAST_ACTION = :requestStatus";
      replacements.requestStatus = requestStatus;
    }
    if (prType) {
      query += " AND TYPE_OF_PR = :prType";
      replacements.prType = prType;
    }
    if (serviceRmFlag) {
      query += " AND SERVICE_RM_FLAG = :serviceRmFlag";
      replacements.serviceRmFlag = serviceRmFlag;
    }

    console.log("✅ Final Query:", query);
    console.log("✅ Query Replacements:", replacements);
    query = "SELECT * FROM VW_COSTWISE_BUDGET_ALLOCATION ";
    // Execute the query
    const rows = await sequelize.query(query, {
      replacements,
      type: QueryTypes.SELECT,
    });

    console.log(
      `✅ Query executed successfully. Retrieved ${rows.length} records.`
    );

    // Send response (ensure no return statement)
    res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("❌ Error fetchCostwisebudgetAllocation  data:", error);
    res.status(500).json({
      success: false,
      message:
        "An error occurred while fetching fetchCostwisebudgetAllocation   data.",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const saveFile = async (
  req: RequestWithUser,
  res: Response
): Promise<Response | void> => {
  const { request_number, files } = req.body;

  // Validate required fields
  if (
    !request_number ||
    !files ||
    !Array.isArray(files) ||
    files.length === 0
  ) {
    return res.status(400).json({
      success: false,
      message: "request_number and files are required.",
    });
  }

  const duplicateRecords: string[] = [];
  const successfulRecords: { org_file_name: string; sr_no: number }[] = [];

  try {
    for (const file of files) {
      const { org_file_name } = file;

      // Check for duplicate entry
      const duplicateCheckQuery = `
        SELECT COUNT(*) AS count
        FROM UPLOADED_FILES_DLTS
        WHERE request_number = :request_number AND org_file_name = :org_file_name
      `;

      const [duplicateCheckResult]: any = await sequelize.query(
        duplicateCheckQuery,
        {
          replacements: { request_number, org_file_name },
          type: QueryTypes.SELECT,
        }
      );

      if (duplicateCheckResult.count > 0) {
        // Log duplicate record and skip insertion
        duplicateRecords.push(org_file_name);
        continue;
      }

      // Insert new file record
      const query = `
        INSERT INTO UPLOADED_FILES_DLTS (
          company_code, request_number, file_name, extensions, org_file_name, 
          aws_file_locn, flow_level, modules, updated_by, created_by, user_file_name, created_at, updated_at
        ) VALUES (
          :company_code, :request_number, :file_name, :extensions, :org_file_name, 
          :aws_file_locn, :flow_level, :modules, :updated_by, :created_by, :user_file_name, NOW(), NOW()
        )
      `;

      const {
        company_code,
        file_name,
        extensions,
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

      // Fetch the SR_NO generated by the trigger
      const fetchSrNoQuery = `
        SELECT SR_NO 
        FROM UPLOADED_FILES_DLTS
        WHERE request_number = :request_number AND org_file_name = :org_file_name
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const [srNoResult]: any = await sequelize.query(fetchSrNoQuery, {
        replacements: { request_number, org_file_name },
        type: QueryTypes.SELECT,
      });

      if (srNoResult?.SR_NO) {
        successfulRecords.push({ org_file_name, sr_no: srNoResult.SR_NO });
      }
    }

    return res.status(200).json({
      success: true,
      message: "File data processed successfully.",
      data: {
        successfulRecords,
        duplicateRecords,
      },
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

export const fetchPurchaseRecovery = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    console.log("✅ PurchaseRecovery API called");

    const { type_of_pr } = req.params;

    if (!type_of_pr) {
      res
        .status(400)
        .json({ success: false, message: "❌ type_of_pr is required" });
      return;
    }

    console.log("🔍 Received type_of_pr:", type_of_pr);

    const query = `
  SELECT * 
  FROM VW_PURCHASE_RECOVERY 
  WHERE type_of_pr = ? 
    AND (RECOVERY_CONFIRM = 'NO' OR RECOVERY_CONFIRM IS NULL);
`;

    const results = await sequelize.query(query, {
      replacements: [type_of_pr],
      type: QueryTypes.SELECT,
    });

    console.log(
      "✅ Query executed successfully. Retrieved",
      results.length,
      "records"
    );

    res.status(200).json({ success: true, data: results });
  } catch (error: unknown) {
    console.error("❌ Error fetching PurchaseRecovery data:", error);

    res.status(500).json({
      success: false,
      message: "An error occurred while fetching PurchaseRecovery data",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const updatecancelrejectsentBack = async (
  req: Request,
  res: Response
): Promise<void> => {
  const t = await sequelize.transaction();
  try {
    console.log("Incoming request data:", req.body);

    const {
      LAST_ACTION,
      REQUEST_NUMBER,
      COMPANY_CODE,
      loginid,
      REMARKS,
      CREATEPR,
      LEVEL,
    } = req.body;

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
    console.log("CREATEPR:", CREATEPR);

    let generatedRequestNumber: string | null = null;

    // Check if it's a PO cancellation request
    if (REQUEST_NUMBER.includes("PO$")) {
      const todaydate: Date = new Date();
      const formattedDate = todaydate.toISOString().split("T")[0];
      // Update PO details
      await sequelize.query(
        `UPDATE PURCHASE_REQUEST_DETAILS 
         SET PO_CANCEL = 'Y', 
             REASON_FOR_PO_CANCEL = ?, 
             CANCEL_PO_BY = ?, 
             PO_CANCEL_DATE = ?,
             UPDATED_AT = NOW() 
         WHERE REF_DOC_NO = ? AND COMPANY_CODE = ?`,
        {
          replacements: [
            REMARKS,
            loginid,
            formattedDate,
            REQUEST_NUMBER,
            COMPANY_CODE,
          ],
          transaction: t,
        }
      );

      if (CREATEPR === "Y") {
        console.log("Calling stored procedure PRO_GEN_PR_FOR_CANCEL_PO...");
        await sequelize.query(
          `CALL PRO_GEN_PR_FOR_CANCEL_PO(?, ?, 'BUYER', 'FULL', @code)`,
          {
            replacements: [COMPANY_CODE, REQUEST_NUMBER],
            transaction: t,
          }
        );

        console.log("Fetching generated request number...");
        const [[result]]: any = await sequelize.query(`SELECT @code AS code`, {
          transaction: t,
        });

        if (result && result.code) {
          generatedRequestNumber = result.code;
          console.log(`Generated request number: ${generatedRequestNumber}`);
        } else {
          console.log("No new PR generated.");
        }
      }

      await sequelize.query(
        `CALL PROC_LOADMESSAGEBOX(:screen, :type, :document_number, :userId,'')`,
        {
          replacements: {
            screen: "POCANCEL",
            type: "success",
            document_number: "",
            userId: loginid,
          },
        }
      );

      // Commented out supplier email lookup - using static emails for testing
      /*
      const supplierResult = await sequelize.query(
        "SELECT SUPPLIER FROM PURCHASE_REQUEST_DETAILS WHERE REF_DOC_NO = ?",
        {
          replacements: [REQUEST_NUMBER],
          type: QueryTypes.SELECT,
          transaction: t,
        }
      );
      console.log("Supplier result:", supplierResult);
      const supplier =
        (supplierResult as { SUPPLIER: string }[])[0]?.SUPPLIER || "";

      if (supplier) {
        const emailResult = await sequelize.query(
          "SELECT SUPP_EMAIL1 FROM MS_SUPPLIER WHERE SUPP_CODE = ?",
          {
            replacements: [supplier],
            type: QueryTypes.SELECT,
            transaction: t,
          }
        );
        const supplierEmail =
          (emailResult as { SUPP_EMAIL1: string }[])[0]?.SUPP_EMAIL1 || "";
      */

      // Using static test emails
      const supplierEmail = "Sandeep.dandekar@bayanattechnology.com";

      if (supplierEmail) {
        try {
          console.log(
            "Starting PDF generation for cancelled PO:",
            REQUEST_NUMBER
          );

          await new Promise((resolve) => setTimeout(resolve, 500));
          const pdfBase64 = await BoldReportsController.exportPOCANCELAsBase64(
            REQUEST_NUMBER,
            COMPANY_CODE
          );

          console.log(
            "PDF generated successfully for cancelled PO, sending email..."
          );

          await notifyUser({
            event: "PO_CANCELLED",
            subject: `Cancelled PO: ${REQUEST_NUMBER.replace(/\$/g, "/")}`,
            message: `Dear Sir,

Please find attached herewith our cancelled LPO for your information and further action. Please refer to the terms & conditions as stated in the LPO.

If you require any further information, please do not hesitate to contact us at procurement@the-maintainers.com.

Thank you.`,
            request_users: supplierEmail,
            attachments: [
              {
                filename: `PO_${REQUEST_NUMBER.replace(
                  /\$/g,
                  "/"
                )}_CANCELLED.pdf`,
                content: pdfBase64,
                encoding: "base64",
                contentType: "application/pdf",
              },
            ],
          });
        } catch (error) {
          console.error(
            "Failed to generate/attach PDF for cancelled PO:",
            error
          );
          console.log("Continuing with transaction despite PDF error");
        }
      }

      // Commit transaction for PO cancellation and return early
      await t.commit();
      console.log("Transaction committed successfully for PO cancellation!");

      res.status(200).json({
        success: true,
        message: generatedRequestNumber
          ? `New PR Generated: ${generatedRequestNumber}`
          : "PO Cancelled Successfully",
        generatedRequestNumber: generatedRequestNumber || null,
      });
      return; // Exit the function
    }

    // The following code will only execute for PR requests (not PO cancellations)
    console.log("Updating PURCHASE_REQUEST_HEADER/MATERIAL REQUEST HEADER...");
    if (LAST_ACTION === "SENTBACK" && REQUEST_NUMBER.includes("MAT$")) {
      await sequelize.query(
        `UPDATE MATERIAL_REQUEST_HEADER 
         SET LAST_ACTION = ?, UPDATED_AT = NOW(), UPDATED_BY = ?, FLOW_LEVEL_RUNNING = ?,
     SENDBACK_HISTRY = CONCAT(IFNULL(SENDBACK_HISTRY, ''), '; ', ?)
         WHERE REQUEST_NUMBER = ? AND COMPANY_CODE = ?`,
        {
          replacements: [
            LAST_ACTION,
            loginid,
            LEVEL,
            REMARKS,
            REQUEST_NUMBER.replace(/\//g, "$"),
            COMPANY_CODE,
          ],
          transaction: t,
        }
      );
      await t.commit();
      res.status(200).json({
        success: true,
        message: "Updated Successfully",
      });
      return;
    }

    if (LAST_ACTION === "SENTBACK") {
      console.log("Updating with SENTBACK action...");
      await sequelize.query(
        `UPDATE PURCHASE_REQUEST_HEADER 
         SET LAST_ACTION = ?, UPDATED_AT = NOW(), UPDATED_BY = ?, FLOW_LEVEL_RUNNING = ?,
         SENDBACK_HISTRY = CONCAT(IFNULL(SENDBACK_HISTRY, ''), '; ', ?)
         WHERE REQUEST_NUMBER = ? AND COMPANY_CODE = ?`,
        {
          replacements: [
            LAST_ACTION,
            loginid,
            LEVEL,
            REMARKS,
            REQUEST_NUMBER.replace(/\//g, "$"),
            COMPANY_CODE,
          ],
          transaction: t,
        }
      );
      await sequelize.query(
        `CALL PROC_LOADMESSAGEBOX(:screen, :type, :document_number, :userId,'')`,
        {
          replacements: {
            screen: "PRSENTBACK",
            type: "success",
            document_number: "",
            userId: loginid,
          },
        }
      );
    } else {
      console.log("Updating without SENTBACK action...");
      await sequelize.query(
        `UPDATE PURCHASE_REQUEST_HEADER 
         SET LAST_ACTION = ?, UPDATED_AT = NOW(), UPDATED_BY = ?
         WHERE REQUEST_NUMBER = ? AND COMPANY_CODE = ?`,
        {
          replacements: [
            LAST_ACTION,
            loginid,
            REQUEST_NUMBER.replace(/\//g, "$"),
            COMPANY_CODE,
          ],
          transaction: t,
        }
      );
    }

    console.log("Committing transaction...");
    await t.commit();
    console.log("Transaction committed successfully!");

    // Get CC email from PURCHASE_REQUEST_HEADER joined with SEC_LOGIN
    const [ccResultRows] = await sequelize.query(
      `SELECT prh.CREATED_BY, sl.email_id
       FROM PURCHASE_REQUEST_HEADER prh
       LEFT JOIN SEC_LOGIN sl ON prh.CREATED_BY = sl.user_id
       WHERE prh.REQUEST_NUMBER = :requestNumber 
       LIMIT 1`,
      {
        replacements: { requestNumber: REQUEST_NUMBER.replace(/\//g, "$") },
        type: QueryTypes.SELECT,
      }
    );
    console.log("CC Result Rows:", ccResultRows);

    const ccEmail = Array.isArray(ccResultRows)
      ? ccResultRows.length > 0
        ? (ccResultRows[0] as { email_id: string }).email_id
        : ""
      : (ccResultRows as { email_id: string }).email_id || "";

    console.log("CC Email found:", ccEmail);

    // Format request number for display (replace $ with /)
    const displayRequestNumber = REQUEST_NUMBER.replace(/\$/g, "/");

    // Fetch email address of the last updater - modified to handle array result
    const [emailResultRows] = await sequelize.query(
      `SELECT email_id FROM SEC_LOGIN 
       WHERE LOGINID IN (
         SELECT DISTINCT LAST_UPDATED 
         FROM PURCHASE_REQUST_RUNING_STATS 
         WHERE REQUEST_NUMBER = ?
       )`,
      {
        replacements: [REQUEST_NUMBER.replace(/\//g, "$")],
        type: QueryTypes.SELECT,
      }
    );

    const userEmails = Array.isArray(emailResultRows)
      ? emailResultRows.length > 0
        ? LAST_ACTION === "SENTBACK"
          ? `${
              (emailResultRows[0] as { email_id: string }).email_id
            },admin1@the-maintainers.com`
          : (emailResultRows[0] as { email_id: string }).email_id
        : LAST_ACTION === "SENTBACK"
        ? "admin1@the-maintainers.com"
        : ""
      : LAST_ACTION === "SENTBACK"
      ? "admin1@the-maintainers.com"
      : (emailResultRows as { email_id: string }).email_id || "";

    console.log("CC Email found:", userEmails);

    if (userEmails.length > 0) {
      let emailSubject = "";
      let emailMessage = "";
      let eventType = "";

      switch (LAST_ACTION.toUpperCase()) {
        case "CANCELLED":
          eventType = "CANCEL";
          emailSubject = `Purchase Request ${displayRequestNumber} Cancelled`;
          emailMessage = `<!DOCTYPE html>
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
                        Purchase Request Cancelled
                    </div>
                    <div class="content">
                        <div class="detail-row no-border-mobile">
                            <span class="detail-label">Request Number:</span>
                            <span class="detail-value">${REQUEST_NUMBER}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Status:</span>
                            <span class="detail-value">Cancelled</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Remarks:</span>
                            <span class="detail-value">${REMARKS}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Action By:</span>
                            <span class="detail-value">${loginid}</span>
                        </div>
                        <div class="detail-row no-border-mobile">
                            <span class="detail-label">Action Date:</span>
                            <span class="detail-value">${new Date().toLocaleDateString()}</span>
                        </div>
                    </div>
                    <div class="footer">
                        Powered by Bayanat Technology – Procurement Management System (PMS)
                    </div>
                </div>
            </body>
            </html>`;
          break;
        case "SENTBACK":
          eventType = "SENTBACK";
          emailSubject = `Purchase Request ${displayRequestNumber} Sent Back`;
          emailMessage = `<!DOCTYPE html>
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
                      padding:  8px 5px !important;
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
                        Purchase Request Sent Back
                    </div>
                    <div class="content">
                        <div class="detail-row no-border-mobile">
                            <span class="detail-label">Request Number:</span>
                            <span class="detail-value">${REQUEST_NUMBER}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Status:</span>
                            <span class="detail-value">Sent Back</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Remarks:</span>
                            <span class="detail-value">${REMARKS}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Action By:</span>
                            <span class="detail-value">${loginid}</span>
                        </div>
                        <div class="detail-row no-border-mobile">
                            <span class="detail-label">Action Date:</span>
                            <span class="detail-value">${new Date().toLocaleDateString()}</span>
                        </div>
                    </div>
                    <div class="footer">
                        Powered by Bayanat Technology – Procurement Management System (PMS)
                    </div>
                </div>
            </body>
            </html>`;
          break;
        case "REJECTED":
          eventType = "REJECT";
          emailSubject = `Purchase Request ${displayRequestNumber} Rejected`;
          emailMessage = `<!DOCTYPE html>
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
                      padding:  8px 5px !important;
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
                        Purchase Request Rejected
                    </div>
                    <div class="content">
                        <div class="detail-row no-border-mobile">
                            <span class="detail-label">Request Number:</span>
                            <span class="detail-value">${REQUEST_NUMBER}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Status:</span>
                            <span class="detail-value">Rejected</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Remarks:</span>
                            <span class="detail-value">${REMARKS}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Action By:</span>
                            <span class="detail-value">${loginid}</span>
                        </div>
                        <div class="detail-row no-border-mobile">
                            <span class="detail-label">Action Date:</span>
                            <span class="detail-value">${new Date().toLocaleDateString()}</span>
                        </div>
                    </div>
                    <div class="footer">
                        Powered by Bayanat Technology – Procurement Management System (PMS)
                    </div>
                </div>
            </body>
            </html>`;
          break;
      }

      console.log(`Sending email notification for event: ${eventType}`);
      console.log("Email subject:", emailSubject);
      console.log("Email message:", emailMessage);

      if (emailSubject && emailMessage && eventType) {
        try {
          await notifyUser({
            event: eventType,
            subject: emailSubject,
            message: emailMessage,
            request_users: userEmails,
            cc: ccEmail,
            htmlMessage: emailMessage,
          });
          console.log("Email notification sent successfully");
        } catch (error) {
          console.error("Failed to send email notification:", error);
        }
      }
    } else {
      console.log("No email addresses found for notification");
    }

    res.status(200).json({
      success: true,
      message: "Updated Successfully",
    });
  } catch (error) {
    console.error("Error occurred, rolling back transaction:", error);
    await t.rollback();

    res.status(500).json({
      success: false,
      message: "Update Unsuccessful",
    });
  }
};

export const FetchGenPOString = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    console.log("✅ Fetching GEN_PO_NUMBER from GT_SESSION_INFO");

    const [[result]]: any = await sequelize.query(
      `SELECT GEN_PO_NUMBER FROM GT_SESSION_INFO LIMIT 1;`
    );

    if (!result || !result.GEN_PO_NUMBER) {
      console.warn("⚠️ No GEN_PO_NUMBER found in GT_SESSION_INFO");
      res.status(200).json({ success: true, data: "NO" });
      return;
    }

    console.log("✅ GEN_PO_NUMBER fetched:", result.GEN_PO_NUMBER);
    res.status(200).json({ success: true, data: result.GEN_PO_NUMBER });
  } catch (error) {
    console.error("❌ Error fetching GEN_PO_NUMBER:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const cancelFinalApproval = async (
  req: Request,
  res: Response
): Promise<void> => {
  const transaction = await sequelize.transaction();
  try {
    console.log("✅ cancelFinalApproval API called");

    const { company_code, request_number, user_id } = req.body;

    console.log(company_code);
    console.log(request_number);
    console.log(user_id);
    // Validate required fields
    if (!company_code || !request_number || !user_id) {
      res.status(400).json({
        success: false,
        message: "❌ company_code, request_number, and user_id are required",
      });
      return;
    }

    console.log("🔍 Received:", {
      company_code,
      request_number,
      user_id,
    });

    // Step 1: Call stored procedure
    console.log("📞 Calling stored procedure PRO_CANCEL_FINAL_APPROVAL_PR...");
    await sequelize.query(
      `CALL PRO_CANCEL_FINAL_APPROVAL_PR(:company_code, :request_number, :user_id)`,
      {
        replacements: { company_code, request_number, user_id },
        transaction,
      }
    );

    // Step 2: Commit transaction
    await transaction.commit();
    console.log("✅ Stored procedure executed and transaction committed.");

    res.status(200).json({
      success: true,
      message: "✅ Final approval cancelled successfully.",
    });
  } catch (error: unknown) {
    // Step 3: Rollback on error
    await transaction.rollback();
    console.error("❌ Error in cancelFinalApproval:", error);

    res.status(500).json({
      success: false,
      message: "An error occurred while cancelling final approval.",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const fetchPOlisting = async (
  req: Request,
  res: Response
): Promise<void> => {
  const transaction = await sequelize.transaction();
  try {
    console.log("✅ fetchPOlisting API called");

    const { request_number } = req.params;

    if (!request_number) {
      res
        .status(400)
        .json({ success: false, message: "❌ request_number is required" });
      return;
    }

    console.log("🔍 Received request_number:", request_number);

    // Step 1: Call stored procedure
    console.log(
      "📞 Calling stored procedure PRO_CALL_GEN_JESRA_PO_NO_DRAFT..."
    );
    await sequelize.query(
      `CALL PRO_CALL_GEN_JESRA_PO_NO_DRAFT(:request_number)`,
      {
        replacements: { request_number },
        transaction,
      }
    );

    // Step 2: Commit transaction after procedure call
    await transaction.commit();
    console.log("✅ Stored procedure executed and transaction committed.");

    // Step 3: Query the VW_PO_LISTING view
    const query = `
      SELECT * 
      FROM VW_PO_LISTING
      WHERE REQUEST_NUMBER = ?;
    `;

    const results = await sequelize.query(query, {
      replacements: [request_number],
      type: QueryTypes.SELECT,
    });

    console.log(
      "✅ Query executed successfully. Retrieved",
      results.length,
      "records"
    );

    res.status(200).json({ success: true, data: results });
  } catch (error: unknown) {
    // Rollback transaction in case of any error
    await transaction.rollback();
    console.error("❌ Error in fetchPOlisting:", error);

    res.status(500).json({
      success: false,
      message: "An error occurred while fetching PO listing",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
