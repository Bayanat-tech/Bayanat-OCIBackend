import { Request, Response } from "express";
import { sequelize } from "../../database/connection";
import { QueryTypes } from "sequelize";
import { upsertMaterialRequest } from "./materialRquestdbupdate_pf.Controller";
import { createLog, notifyUser } from "../../helpers/functions";
import constants from "../../helpers/constants";
import { IFiles, RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import { NextFunction } from "express";
import {
  IMaterialRequestPf,
  IItemMrRequest,
  IBasicMrRequest,
} from "../../interfaces/Purchaseflow/Materialflow.interface";

// GET MATERIAL REQUEST BY NUMBER

export async function getMaterialRequestNumber(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Cast req to extended type only when needed
  const reqWithUser = req as RequestWithUser;

  try {
    const { request_number } = req.params;

    if (typeof request_number !== "string") {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Invalid request number format.",
      });
      return;
    }

    const formattedRequestNumber = request_number.replace(/\$\$/g, "/");

    const [header] = await sequelize.query(
      `SELECT * FROM VW_MATERIAL_REQUEST_HEADER WHERE request_number = :request_number LIMIT 1;`,
      {
        replacements: { request_number: formattedRequestNumber },
        type: QueryTypes.SELECT,
      }
    );

    const details = await sequelize.query(
      `SELECT * FROM VW_MATERIAL_REQUEST_DETAILS WHERE request_number = :request_number ORDER BY ITEM_SRNO;`,
      {
        replacements: { request_number: formattedRequestNumber },
        type: QueryTypes.SELECT,
      }
    );

    if (!header || details.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: `Material Request ${constants.MESSAGES.DOES_NOT_EXISTS}`,
      });
      return;
    }

    // Example usage of user if needed
    // console.log("User info:", reqWithUser.user);

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: {
        ...header,
        items: details,
      },
    });
  } catch (error) {
    next(error); // Forward error to Express error handler middleware
  }
}

// CREATE OR UPDATE MATERIAL REQUEST
export const  createOrUpdateMaterialRequestSequential = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const purchaseRequest = MatmapIncomingRequestData(req.body);

    await upsertMaterialRequest(purchaseRequest);

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

// MAPPER FUNCTION: RAW REQUEST DATA -> TYPED OBJECT
export function MatmapIncomingRequestData(data: any): IMaterialRequestPf {
  const mapItems: IItemMrRequest[] = Array.isArray(data.items)
    ? data.items.map((item: any): IItemMrRequest => ({
        request_number: item.request_number?.toString() || "",
        item_code: item.item_code?.toString() || "",
        item_rate: Number(item.item_rate) || 0,
        item_p_qty: Number(item.item_qty) || 0,
        p_uom: item.p_uom?.toString() || "",
        from_cost_code: item.from_cost_code?.toString() || null,
        to_cost_code: item.to_cost_code?.toString() || null,
        from_project_code: item.from_project_code?.toString() || null,
        to_project_code: item.to_project_code?.toString() || null,
       l_uom: item.l_uom?.toString() || "",
         item_l_qty: item.item_l_qty ? Number(item.item_l_qty) : null,
          item_sequence_no: item.item_sequence_no ? Number(item.item_sequence_no) : null,
      }))
    : [];

  const request: IMaterialRequestPf = {
    need_by_date: data.need_by_date ? new Date(data.need_by_date) : undefined,
    requestor_name: data.requestor_name,
    request_number: data.request_number?.toString() || "",
request_date: data.request_date ? new Date(data.request_date) : undefined,
    description: data.description || "",
    remarks: data.remarks || "",
    amount: Number(data.amount) || 0,
    department_code: data.department_code || "",
    flow_code: data.flow_code || "",
    flow_level_initial: Number(data.flow_level_initial) || 0,
    flow_level_running: Number(data.flow_level_running) || 0,
    flow_level_final: Number(data.flow_level_final) || 0,
    company_code: data.company_code?.toString() || "",
    currency_rate: Number(data.currency_rate) || 0,
    user_dt: data.user_dt ? new Date(data.user_dt) : undefined,
    user_id: data.user_id?.toString() || "",
    fa_uploaded: data.fa_uploaded || "",
    final_approved: data.final_approved || "",
    remarks_histry: data.remarks_histry || "",
    curr_code: data.curr_code || "",
    create_user: data.create_user || "",
    create_date: data.create_date ? new Date(data.create_date) : undefined,
    last_updated: data.last_updated || "",
    last_action: data.last_action || "",
    history_serial: data.history_serial ? Number(data.history_serial) : 1,
    attach_file_name: data.attach_file_name || "",
    attach_file_name1: data.attach_file_name1 || "",
    attach_file_name2: data.attach_file_name2 || "",
    reject_histry: data.reject_histry || "",
    sendback_histry: data.sendback_histry || "",
    req_doc_no: data.req_doc_no ? Number(data.req_doc_no) : undefined,
    req_div_code: data.req_div_code || "",
    cost_code: data.cost_code || "",
    po_amount: data.po_amount ? Number(data.po_amount) : undefined,
    doc_date: data.doc_date ? new Date(data.doc_date) : undefined,
    projectCode: data.project_code || "",
    status: data.status || "",
    project_pr_no: data.project_pr_no ? Number(data.project_pr_no) : undefined,
    div_code: data.div_code || "",
    final_approved_date: data.final_approved_date
      ? new Date(data.final_approved_date)
      : undefined,
    created_at: data.created_at ? new Date(data.created_at) : undefined,
    created_by: data.created_by || "",
    updated_at: data.updated_at ? new Date(data.updated_at) : undefined,
    updated_by: data.updated_by || "",
    flow_type: data.flow_type || "",
    project_code_from: data.project_code_from || "",
    project_code_to: data.project_code_to || "",
    items: mapItems,
  };

  return request;
}

export const MaterialRequestListing = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    console.log("✅ MaterialRequestListing API called");

    const query = `
      SELECT Request_number, Request_date, Description ,requestor_name,need_by_date
      FROM MATERIAL_REQUEST_HEADER;
    `;

    const results = await sequelize.query(query, {
      type: QueryTypes.SELECT,
    });

    console.log("✅ Query executed. Retrieved", results.length, "records");
    console.log("📦 Sample record:", results[0]);

    // Add 'id' field required by frontend table renderers
    const dataWithIds = results.map((item: any, index: number) => ({
      id: index + 1, // or use item.Request_number if unique
      ...item,
    }));

    res.status(200).json({ success: true, data: dataWithIds });
  } catch (error: unknown) {
    console.error("❌ Error fetching MATERIAL_REQUEST_HEADER data:", error);

    res.status(500).json({
      success: false,
      message: "An error occurred while fetching material request data",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};