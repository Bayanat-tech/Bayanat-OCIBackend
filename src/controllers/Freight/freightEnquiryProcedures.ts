import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

type Connection = oracledb.Connection;

export const frtApprovalConfig = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = req.body.company_code ?? req.body.COMPANY_CODE;
    const process = req.body.process ?? req.body.PROCESS;
    const result = await connection.execute(
      `SELECT NVL(MAX(LAST_LEVEL), 0) AS LAST_LEVEL
         FROM MS_APPROVER_LEVELS
        WHERE COMPANY_CODE = :company_code
          AND PROCESS = :process`,
      {
        company_code: companyCode,
        process,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const row = (result.rows?.[0] ?? {}) as Record<string, unknown>;
    const lastLevel = Number(row.LAST_LEVEL ?? 0);
    res.json({ success: true, data: { approval_enabled: lastLevel > 0, last_level: lastLevel } });
  });
};

export const frtEnquiryList = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_ENQUIRY_LIST(
           :p_company_code,
           :p_enquiry_type,
           :p_search,
           :p_from_date,
           :p_to_date,
           :p_result
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_enquiry_type: req.body.enquiry_type ?? "ENQ",
        p_search: req.body.search ?? null,
        p_from_date: toDate(req.body.from_date),
        p_to_date: toDate(req.body.to_date),
        p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = await rowsFromCursor((result.outBinds as any).p_result);
    res.json({ success: true, data: rows, totalCount: rows.length });
  });
};

export const frtEnquiryGet = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_ENQUIRY_GET(
           :p_company_code,
           :p_enquiry_type,
           :p_enquiry_nr,
           :p_header,
           :p_details
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_enquiry_type: req.body.enquiry_type ?? "ENQ",
        p_enquiry_nr: req.body.enquiry_nr ?? req.body.ENQUIRY_NR,
        p_header: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        p_details: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const outBinds = result.outBinds as any;
    const headerRows = await rowsFromCursor(outBinds.p_header);
    const details = await rowsFromCursor(outBinds.p_details);
    res.json({ success: true, data: { header: headerRows[0] ?? null, details } });
  });
};

export const frtEnquirySave = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const { header, details } = req.body;
    if (!header || !Array.isArray(details)) {
      res.status(400).json({ success: false, message: "Header and details are required" });
      return;
    }

    if (!header.enquiry_nr || ["0", "AUTO", "NEW"].includes(String(header.enquiry_nr).toUpperCase().trim())) {
      try {
        const numRes = await connection.execute(
          `SELECT NVL(MAX(enquiry_nr), 50) AS MAX_NO FROM MS_COMPANYINFO WHERE company_code = :company_code AND (country = 'OMAN' OR UPPER(currency) = 'OMR' OR ROWNUM = 1)`,
          { company_code: header.company_code || "BSG" },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const nextNo = (Number((numRes.rows?.[0] as any)?.MAX_NO) || 50) + 1;
        try {
          await connection.execute(
            `UPDATE MS_COMPANYINFO SET enquiry_nr = :nextNo WHERE company_code = :company_code AND (country = 'OMAN' OR UPPER(currency) = 'OMR')`,
            { nextNo, company_code: header.company_code || "BSG" },
            { autoCommit: true }
          );
        } catch (_) {}
        const mode = String(header.transport_mode || "A").substring(0, 1).toUpperCase();
        const type = String(header.job_type || "I").substring(0, 1).toUpperCase();
        const prin = String(header.prin_code || "00001").padStart(5, "0");
        header.enquiry_nr = `${mode}${type}/${prin}/${String(nextNo).padStart(5, "0")}`;
      } catch (_) {}
    }

    const result = await connection.execute(
      `BEGIN
         PROC_FRT_ENQUIRY_SAVE(:p_header, :p_details, :p_enquiry_nr_out);
       END;`,
      {
        p_header: { type: "FRT_ENQUIRY_HDR_TAB", val: [toHeaderObject(header)] },
        p_details: { type: "FRT_ENQUIRY_DET_TAB", val: details.map((row: Record<string, unknown>) => toDetailObject(row, header)) },
        p_enquiry_nr_out: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 50 },
      },
      { autoCommit: true }
    );

    const enquiryNr = (result.outBinds as any).p_enquiry_nr_out || header.enquiry_nr;
    res.json({ success: true, message: "Enquiry saved successfully", data: { enquiry_nr: enquiryNr } });
  });
};

export const frtEnquiryDelete = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    await connection.execute(
      `BEGIN
         PROC_FRT_ENQUIRY_DELETE(:p_company_code, :p_enquiry_type, :p_enquiry_nr);
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_enquiry_type: req.body.enquiry_type ?? "ENQ",
        p_enquiry_nr: req.body.enquiry_nr ?? req.body.ENQUIRY_NR,
      },
      { autoCommit: true }
    );

    res.json({ success: true, message: "Enquiry deleted successfully" });
  });
};

export const frtEnquiryCancel = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    await connection.execute(
      `BEGIN
         PROC_FRT_ENQUIRY_CANCEL(
           :p_company_code,
           :p_enquiry_type,
           :p_enquiry_nr,
           :p_cancel_by,
           :p_cancel_remarks
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_enquiry_type: req.body.enquiry_type ?? req.body.ENQUIRY_TYPE ?? "EQI",
        p_enquiry_nr: req.body.enquiry_nr ?? req.body.ENQUIRY_NR,
        p_cancel_by: req.body.cancel_by ?? req.body.CANCEL_BY ?? req.body.userid ?? req.body.USERID,
        p_cancel_remarks: req.body.cancel_remarks ?? req.body.CANCEL_REMARKS,
      },
      { autoCommit: true }
    );

    res.json({ success: true, message: "Enquiry cancelled successfully" });
  });
};

export const frtEnquiryApprove = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    await connection.execute(
      `BEGIN
         PROC_FRT_ENQUIRY_APPROVE(
           :p_company_code,
           :p_enquiry_type,
           :p_enquiry_nr,
           :p_approved_by,
           :p_approval_remarks
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_enquiry_type: req.body.enquiry_type ?? req.body.ENQUIRY_TYPE ?? "EQI",
        p_enquiry_nr: req.body.enquiry_nr ?? req.body.ENQUIRY_NR,
        p_approved_by: req.body.approved_by ?? req.body.APPROVED_BY ?? req.body.userid ?? req.body.USERID,
        p_approval_remarks: req.body.approval_remarks ?? req.body.APPROVAL_REMARKS,
      },
      { autoCommit: true }
    );

    res.json({ success: true, message: "Enquiry approved successfully" });
  });
};

export const frtEnquiryWorkflowAction = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const action = String(req.body.action ?? req.body.ACTION ?? "").trim().toUpperCase();
    if (!action) {
      res.status(400).json({ success: false, message: "Workflow action is required" });
      return;
    }

    const result = await connection.execute(
      `BEGIN
         PROC_FRT_ENQUIRY_WORKFLOW_ACTION(
           :p_company_code,
           :p_enquiry_type,
           :p_enquiry_nr,
           :p_action,
           :p_action_by,
           :p_action_remarks,
           :p_sentback_to,
           :p_result
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_enquiry_type: req.body.enquiry_type ?? req.body.ENQUIRY_TYPE ?? "EQI",
        p_enquiry_nr: req.body.enquiry_nr ?? req.body.ENQUIRY_NR,
        p_action: action,
        p_action_by: req.body.action_by ?? req.body.ACTION_BY ?? req.body.userid ?? req.body.USERID,
        p_action_remarks: req.body.action_remarks ?? req.body.ACTION_REMARKS ?? null,
        p_sentback_to: req.body.sentback_to ?? req.body.SENTBACK_TO ?? null,
        p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { autoCommit: true, outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = await rowsFromCursor((result.outBinds as any).p_result);
    res.json({
      success: true,
      message: workflowMessage(action),
      data: rows[0] ?? null,
    });
  });
};

async function withConnection(res: Response, handler: (connection: Connection) => Promise<void>) {
  let connection: Connection | undefined;
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);
    await handler(connection);
  } catch (error: any) {
    console.error("Freight enquiry procedure error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to execute Freight enquiry procedure",
      details: error?.message || "Unknown error",
    });
  } finally {
    if (connection) await connection.close();
  }
}

async function rowsFromCursor(cursor: any) {
  if (!cursor) return [];
  try {
    return await cursor.getRows(10000);
  } finally {
    await cursor.close();
  }
}

export function toHeaderObject(header: Record<string, unknown>) {
  return {
    ENQUIRY_NR: stringValue(header.enquiry_nr ?? header.ENQUIRY_NR, "0"),
    ENQUIRY_DATE: toDate(header.enquiry_date ?? header.ENQUIRY_DATE),
    COMPANY_CODE: stringValue(header.company_code ?? header.COMPANY_CODE),
    PRIN_CODE: stringValue(header.prin_code ?? header.PRIN_CODE),
    DEPT_CODE: stringValue(header.dept_code ?? header.DEPT_CODE),
    ORIGIN_PORT: stringValue(header.origin_port ?? header.ORIGIN_PORT),
    DESTINATION_PORT: stringValue(header.destination_port ?? header.DESTINATION_PORT),
    TRANSIT_TIME: stringValue(header.transit_time ?? header.TRANSIT_TIME),
    CARGO_DETAIL: stringValue(header.cargo_detail ?? header.CARGO_DETAIL),
    FREQUENCY: stringValue(header.frequency ?? header.FREQUENCY),
    TOS: stringValue(header.tos ?? header.TOS),
    COMMODITY: stringValue(header.commodity ?? header.COMMODITY),
    DIMENSION: stringValue(header.dimension ?? header.DIMENSION),
    CARRIER: stringValue(header.carrier ?? header.CARRIER),
    WEIGHT: numberValue(header.weight ?? header.WEIGHT),
    VOLUME: numberValue(header.volume ?? header.VOLUME),
    REMARKS: stringValue(header.remarks ?? header.REMARKS),
    PAYMENT_TERMS: stringValue(header.payment_terms ?? header.PAYMENT_TERMS)?.substring(0, 3) || null,
    CURR_CODE: stringValue(header.curr_code ?? header.CURR_CODE),
    EX_RATE: numberValue(header.ex_rate ?? header.EX_RATE, 1),
    JOB_TYPE: stringValue(header.job_type ?? header.JOB_TYPE),
    TRANSPORT_MODE: stringValue(header.transport_mode ?? header.TRANSPORT_MODE),
    USERID: stringValue(header.userid ?? header.USERID),
    USER_DATE: toDate(header.user_date ?? header.USER_DATE) ?? new Date(),
    VIA: stringValue(header.via ?? header.VIA),
    IND_JOB: stringValue(header.ind_job ?? header.IND_JOB),
    JOB_NUMBER: stringValue(header.job_number ?? header.JOB_NUMBER),
    SCHEDULE_DATE: toDate(header.schedule_date ?? header.SCHEDULE_DATE),
    COUNTRY_ORIGIN: stringValue(header.country_origin ?? header.COUNTRY_ORIGIN),
    COUNTRY_DESTINATION: stringValue(header.country_destination ?? header.COUNTRY_DESTINATION),
    INDSTATUS: stringValue(header.indstatus ?? header.INDSTATUS),
    ENQUIRY_TYPE: stringValue(header.enquiry_type ?? header.ENQUIRY_TYPE, "ENQ"),
    OFFER_VALIDITY: toDate(header.offer_validity ?? header.OFFER_VALIDITY),
    SPL_INSTRUCTIONS: stringValue(header.spl_instructions ?? header.SPL_INSTRUCTIONS),
    WALKIN_PRIN_CODE: stringValue(header.walkin_prin_code ?? header.WALKIN_PRIN_CODE),
    SALESMAN_CODE: stringValue(header.salesman_code ?? header.SALESMAN_CODE),
    MEMBER_TYPE: stringValue(header.member_type ?? header.MEMBER_TYPE),
    SALE_TYPE: stringValue(header.sale_type ?? header.SALE_TYPE, "Normal"),
    SHIPPER_NAME: stringValue(header.shipper_name ?? header.SHIPPER_NAME),
    SHIPPER_ADDRESS: stringValue(header.shipper_address ?? header.SHIPPER_ADDRESS),
    CONSIGNEE_NAME: stringValue(header.consignee_name ?? header.CONSIGNEE_NAME),
    CONSIGNEE_ADDRESS: stringValue(header.consignee_address ?? header.CONSIGNEE_ADDRESS),
    JOB_CATEGORY: stringValue(header.job_category ?? header.JOB_CATEGORY),
    REF_ENQUIRY_TYPE: stringValue(header.ref_enquiry_type ?? header.REF_ENQUIRY_TYPE),
    REF_ENQUIRY_NR: stringValue(header.ref_enquiry_nr ?? header.REF_ENQUIRY_NR),
    B: numberValue(header.b ?? header.B),
    H: numberValue(header.h ?? header.H),
    L: numberValue(header.l ?? header.L),
    FORWARDER_CODE: stringValue(header.forwarder_code ?? header.FORWARDER_CODE),
    GROSS_WT: numberValue(header.gross_wt),
    SHIPMENT_STATUS: stringValue(header.shipment_status),
    CONTAINER_TYPE: stringValue(header.container_type),
    NO_OF_CONTANERS: numberValue(header.no_of_contaners),
    VEHICLE_TYPE: stringValue(header.vehicle_type),
    T_F: stringValue(header.t_f),
    FLOW_LEVEL_RUNNING: numberValue(header.flow_level_running),
    FLOW_LEVEL_INITIAL: numberValue(header.flow_level_initial),
    FLOW_LEVEL_FINAL: numberValue(header.flow_level_final),
    FINAL_APPROVED: stringValue(header.final_approved, "N"),
    LAST_ACTION: stringValue(header.last_action, "SAVEASDRAFT"),
    NEXT_ACTION_BY: stringValue(header.next_action_by),
    SENTBACK_REASON: stringValue(header.sentback_reason),
    REJECT_REASON: stringValue(header.reject_reason),
    SUBMITTED_BY: stringValue(header.submitted_by),
    SUBMITTED_DATE: toDate(header.submitted_date),
  };
}

export function toDetailObject(row: Record<string, unknown>, header: Record<string, unknown>) {
  return {
    COMPANY_CODE: stringValue(row.company_code, stringValue(header.company_code)),
    PRIN_CODE: stringValue(row.prin_code, stringValue(header.prin_code)),
    ENQUIRY_NR: stringValue(row.enquiry_nr, stringValue(header.enquiry_nr, "0")),
    ACT_CODE: stringValue(row.act_code),
    QUANTITY: numberValue(row.quantity),
    UOM: stringValue(row.uom),
    BILL_RATE: numberValue(row.bill_rate),
    COST_RATE: numberValue(row.cost_rate),
    BILL: numberValue(row.bill),
    USERID: stringValue(row.userid, stringValue(header.userid)),
    COST: numberValue(row.cost),
    USER_DT: toDate(row.user_dt) ?? new Date(),
    CURR_CODE: stringValue(row.curr_code, stringValue(header.curr_code)),
    EX_RATE: numberValue(row.ex_rate, numberValue(header.ex_rate, 1)),
    UOC: stringValue(row.uoc),
    MOC1: stringValue(row.moc1),
    MOC2: stringValue(row.moc2),
    PARTNERS_PRICE: numberValue(row.partners_price),
    FC_COST: numberValue(row.fc_cost),
    FC_BILL: numberValue(row.fc_bill),
    FC_PARTNERS: numberValue(row.fc_partners),
    FC_COSTRATE: numberValue(row.fc_costrate),
    FC_BILLRATE: numberValue(row.fc_billrate),
    ORIGIN_PORT: stringValue(row.origin_port, stringValue(header.origin_port)),
    DESTINATION_PORT: stringValue(row.destination_port, stringValue(header.destination_port)),
    SRNO: numberValue(row.srno),
    TRANSPORT_MODE: stringValue(row.transport_mode, stringValue(header.transport_mode)),
    COST_CURR_CODE: stringValue(row.cost_curr_code, stringValue(header.curr_code)),
    COST_EX_RATE: numberValue(row.cost_ex_rate, numberValue(header.ex_rate, 1)),
    PARTNERS_CURR_CODE: stringValue(row.partners_curr_code, stringValue(header.curr_code)),
    PARTNERS_EX_RATE: numberValue(row.partners_ex_rate, numberValue(header.ex_rate, 1)),
    ENQUIRY_TYPE: stringValue(row.enquiry_type, stringValue(header.enquiry_type, "ENQ")),
    REMARKS: stringValue(row.remarks),
  };
}

function stringValue(value: unknown, fallback: string | null = null) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}

function numberValue(value: unknown, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function workflowMessage(action: string) {
  if (action === "SAVEASDRAFT") return "Draft saved successfully";
  if (action === "SUBMITTED") return "Submitted for approval";
  if (action === "APPROVED") return "Approval action completed";
  if (action === "SENTBACK") return "Sent back successfully";
  if (action === "REJECTED") return "Rejected successfully";
  if (action === "CANCEL") return "Cancelled successfully";
  return "Workflow action completed";
}
