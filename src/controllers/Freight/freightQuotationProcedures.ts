import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

type Connection = oracledb.Connection;

export const frtQuotationList = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_QUOTATION_LIST(
           :p_company_code,
           :p_search,
           :p_from_date,
           :p_to_date,
           :p_result
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
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

export const frtQuotationGet = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_QUOTATION_GET(
           :p_company_code,
           :p_prin_code,
           :p_quotation_nr,
           :p_header,
           :p_details,
           :p_terms
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_prin_code: req.body.prin_code ?? req.body.PRIN_CODE,
        p_quotation_nr: req.body.quotation_nr ?? req.body.QUOTATION_NR,
        p_header: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        p_details: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        p_terms: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const outBinds = result.outBinds as any;
    const headerRows = await rowsFromCursor(outBinds.p_header);
    const details = await rowsFromCursor(outBinds.p_details);
    const terms = await rowsFromCursor(outBinds.p_terms);
    res.json({ success: true, data: { header: headerRows[0] ?? null, details, terms } });
  });
};

export const frtQuotationSave = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const { header, details, terms } = req.body;
    if (!header || !Array.isArray(details)) {
      res.status(400).json({ success: false, message: "Header and details are required" });
      return;
    }

    const result = await connection.execute(
      `BEGIN
         PROC_FRT_QUOTATION_SAVE(:p_header, :p_details, :p_terms, :p_quotation_nr_out);
       END;`,
      {
        p_header: { type: "FRT_QUOTATION_HDR_TAB", val: [toQuotationHeaderObject(header)] },
        p_details: { type: "FRT_QUOTATION_DET_TAB", val: details.map((row: Record<string, unknown>) => toQuotationDetailObject(row, header)) },
        p_terms: { type: "FRT_QUOTATION_TERMS_TAB", val: Array.isArray(terms) ? terms.map((row: Record<string, unknown>, index: number) => toQuotationTermObject(row, header, index + 1)) : [] },
        p_quotation_nr_out: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 50 },
      },
      { autoCommit: true }
    );

    const quotationNr = (result.outBinds as any).p_quotation_nr_out;
    res.json({ success: true, message: "Quotation saved successfully", data: { quotation_nr: quotationNr } });
  });
};

export const frtQuotationDelete = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    await connection.execute(
      `BEGIN
         PROC_FRT_QUOTATION_DELETE(:p_company_code, :p_prin_code, :p_quotation_nr);
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_prin_code: req.body.prin_code ?? req.body.PRIN_CODE,
        p_quotation_nr: req.body.quotation_nr ?? req.body.QUOTATION_NR,
      },
      { autoCommit: true }
    );

    res.json({ success: true, message: "Quotation deleted successfully" });
  });
};

export const frtQuotationApprove = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    await connection.execute(
      `BEGIN
         PROC_FRT_QUOTATION_APPROVE(
           :p_company_code,
           :p_prin_code,
           :p_quotation_nr,
           :p_approved_by,
           :p_approval_remarks
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_prin_code: req.body.prin_code ?? req.body.PRIN_CODE,
        p_quotation_nr: req.body.quotation_nr ?? req.body.QUOTATION_NR,
        p_approved_by: req.body.approved_by ?? req.body.APPROVED_BY ?? req.body.userid ?? req.body.USERID,
        p_approval_remarks: req.body.approval_remarks ?? req.body.APPROVAL_REMARKS,
      },
      { autoCommit: true }
    );

    res.json({ success: true, message: "Quotation approved successfully" });
  });
};

export const frtQuotationWorkflowAction = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const action = String(req.body.action ?? req.body.ACTION ?? "").trim().toUpperCase();
    if (!action) {
      res.status(400).json({ success: false, message: "Workflow action is required" });
      return;
    }

    const result = await connection.execute(
      `BEGIN
         PROC_FRT_QUOTATION_WORKFLOW_ACTION(
           :p_company_code,
           :p_prin_code,
           :p_quotation_nr,
           :p_action,
           :p_action_by,
           :p_action_remarks,
           :p_sentback_to,
           :p_result
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_prin_code: req.body.prin_code ?? req.body.PRIN_CODE,
        p_quotation_nr: req.body.quotation_nr ?? req.body.QUOTATION_NR,
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
    console.error("Freight quotation procedure error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to execute Freight quotation procedure",
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

function toQuotationHeaderObject(header: Record<string, unknown>) {
  return {
    COMPANY_CODE: stringValue(header.company_code),
    PRIN_CODE: stringValue(header.prin_code),
    QUOTATION_NR: stringValue(header.quotation_nr, "0"),
    QUOTATION_DATE: toDate(header.quotation_date),
    DEPT_CODE: stringValue(header.dept_code),
    ORIGIN_PORT: stringValue(header.origin_port),
    DESTINATION_PORT: stringValue(header.destination_port),
    TRANSIT_TIME: stringValue(header.transit_time),
    CARGO_DETAIL: stringValue(header.cargo_detail),
    FREQUENCY: stringValue(header.frequency),
    TOS: stringValue(header.tos),
    COMMODITY: stringValue(header.commodity),
    DIMENSION: stringValue(header.dimension),
    CARRIER: stringValue(header.carrier),
    WEIGHT: numberValue(header.weight),
    VOLUME: numberValue(header.volume),
    REMARKS: stringValue(header.remarks),
    PAYMENT_TERMS: stringValue(header.payment_terms),
    CURR_CODE: stringValue(header.curr_code),
    EX_RATE: numberValue(header.ex_rate, 1),
    JOB_TYPE: stringValue(header.job_type),
    TRANSPORT_MODE: stringValue(header.transport_mode),
    USERID: stringValue(header.userid),
    USER_DATE: toDate(header.user_date) ?? new Date(),
    VIA: stringValue(header.via),
    IND_JOB: stringValue(header.ind_job),
    JOB_NUMBER: stringValue(header.job_number),
    SCHEDULE_DATE: toDate(header.schedule_date),
    COUNTRY_ORIGIN: stringValue(header.country_origin),
    COUNTRY_DESTINATION: stringValue(header.country_destination),
    INDSTATUS: stringValue(header.indstatus, "N"),
    QUOTATION_TYPE: stringValue(header.quotation_type, "QTN"),
    ENQUIRY_NO: stringValue(header.enquiry_no),
    ENQUIRY_TYPE: stringValue(header.enquiry_type),
    OFFER_VALIDITY: toDate(header.offer_validity),
    SPL_INSTRUCTIONS: stringValue(header.spl_instructions),
    SALESMAN_CODE: stringValue(header.salesman_code),
    MEMBER_TYPE: stringValue(header.member_type),
    SALE_TYPE: stringValue(header.sale_type, "Normal"),
    JOB_CATEGORY: stringValue(header.job_category, "International"),
    FORWARDER_CODE: stringValue(header.forwarder_code),
    GROSS_WT: numberValue(header.gross_wt),
    SHIPMENT_STATUS: stringValue(header.shipment_status),
    CONTAINER_TYPE: stringValue(header.container_type),
    NO_OF_CONTANERS: numberValue(header.no_of_contaners),
    VEHICLE_TYPE: stringValue(header.vehicle_type),
    T_F: stringValue(header.t_f),
    WALKIN_PRIN_CODE: stringValue(header.walkin_prin_code),
    CONTACT_PERSON: stringValue(header.contact_person),
    DOC_DATE: toDate(header.doc_date),
    SUBJECT: stringValue(header.subject),
    B: numberValue(header.b),
    H: numberValue(header.h),
    L: numberValue(header.l),
  };
}

function toQuotationDetailObject(row: Record<string, unknown>, header: Record<string, unknown>) {
  return {
    COMPANY_CODE: stringValue(row.company_code, stringValue(header.company_code)),
    PRIN_CODE: stringValue(row.prin_code, stringValue(header.prin_code)),
    QUOTATION_NR: stringValue(row.quotation_nr, stringValue(header.quotation_nr, "0")),
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
    ACTIVITY_REMARKS: stringValue(row.activity_remarks),
    RATE_REMARKS: stringValue(row.rate_remarks),
  };
}

function toQuotationTermObject(row: Record<string, unknown>, header: Record<string, unknown>, index: number) {
  return {
    COMPANY_CODE: stringValue(row.company_code, stringValue(header.company_code)),
    PRIN_CODE: stringValue(row.prin_code, stringValue(header.prin_code)),
    QUOTATION_NR: stringValue(row.quotation_nr, stringValue(header.quotation_nr, "0")),
    SERIAL_NO: numberValue(row.serial_no, index),
    SR_NO: stringValue(row.sr_no, String(index)),
    TYPE_IND: stringValue(row.type_ind),
    DESCRIPTION: stringValue(row.description),
    FONT_TYPE: stringValue(row.font_type, "Normal"),
    FONT_SIZE: stringValue(row.font_size, "Normal"),
    USER_ID: stringValue(row.user_id, stringValue(header.userid)),
    USER_DT: toDate(row.user_dt) ?? new Date(),
  };
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
