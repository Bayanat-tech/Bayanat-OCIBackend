import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

type Connection = oracledb.Connection;

export const frtRfqActivityList = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_RFQ_ACTIVITY_LIST(:p_company_code, :p_rfq_nr, :p_result);
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_rfq_nr: req.body.enquiry_nr ?? req.body.rfq_nr ?? req.body.RFQ_NR,
        p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = await rowsFromCursor((result.outBinds as any).p_result);
    res.json({ success: true, data: rows, totalCount: rows.length });
  });
};

export const frtRfqActivitySave = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const { details } = req.body;
    if (!Array.isArray(details)) {
      res.status(400).json({ success: false, message: "Details are required" });
      return;
    }

    const result = await connection.execute(
      `BEGIN
         PROC_FRT_RFQ_ACTIVITY_SAVE(
           :p_company_code,
           :p_rfq_nr,
           :p_prin_code,
           :p_userid,
           :p_details,
           :p_rows_out
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_rfq_nr: req.body.enquiry_nr ?? req.body.rfq_nr ?? req.body.RFQ_NR,
        p_prin_code: req.body.prin_code ?? req.body.PRIN_CODE,
        p_userid: req.body.userid ?? req.body.USERID,
        p_details: { type: "FRT_ENQUIRY_DET_TAB", val: details.map((row: Record<string, unknown>) => toDetailObject(row, req.body)) },
        p_rows_out: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      { autoCommit: true }
    );

    res.json({
      success: true,
      message: "RFQ activities saved successfully",
      data: { rows: (result.outBinds as any).p_rows_out },
    });
  });
};

export const frtRfqActivityDelete = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    await connection.execute(
      `BEGIN
         PROC_FRT_RFQ_ACTIVITY_DELETE(:p_company_code, :p_rfq_nr, :p_srno, :p_act_code);
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_rfq_nr: req.body.enquiry_nr ?? req.body.rfq_nr ?? req.body.RFQ_NR,
        p_srno: numberValue(req.body.srno),
        p_act_code: req.body.act_code ?? req.body.ACT_CODE,
      },
      { autoCommit: true }
    );

    res.json({ success: true, message: "RFQ activity deleted successfully" });
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
    console.error("Freight RFQ activity procedure error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to execute Freight RFQ activity procedure",
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

function toDetailObject(row: Record<string, unknown>, header: Record<string, unknown>) {
  return {
    COMPANY_CODE: stringValue(row.company_code, stringValue(header.company_code)),
    PRIN_CODE: stringValue(row.prin_code, stringValue(header.prin_code)),
    ENQUIRY_NR: stringValue(row.enquiry_nr, stringValue(header.enquiry_nr ?? header.rfq_nr)),
    ACT_CODE: stringValue(row.act_code),
    QUANTITY: numberValue(row.quantity),
    UOM: stringValue(row.uom),
    BILL_RATE: numberValue(row.bill_rate),
    COST_RATE: numberValue(row.cost_rate),
    BILL: numberValue(row.bill),
    USERID: stringValue(row.userid, stringValue(header.userid)),
    COST: numberValue(row.cost),
    USER_DT: new Date(),
    CURR_CODE: stringValue(row.curr_code, "OMR"),
    EX_RATE: numberValue(row.ex_rate, 1),
    UOC: stringValue(row.uoc),
    MOC1: stringValue(row.moc1),
    MOC2: stringValue(row.moc2),
    PARTNERS_PRICE: numberValue(row.partners_price),
    FC_COST: numberValue(row.fc_cost),
    FC_BILL: numberValue(row.fc_bill),
    FC_PARTNERS: numberValue(row.fc_partners),
    FC_COSTRATE: numberValue(row.fc_costrate),
    FC_BILLRATE: numberValue(row.fc_billrate),
    ORIGIN_PORT: stringValue(row.origin_port),
    DESTINATION_PORT: stringValue(row.destination_port),
    SRNO: numberValue(row.srno),
    TRANSPORT_MODE: stringValue(row.transport_mode, "A"),
    COST_CURR_CODE: stringValue(row.cost_curr_code, stringValue(row.curr_code, "OMR")),
    COST_EX_RATE: numberValue(row.cost_ex_rate, numberValue(row.ex_rate, 1)),
    PARTNERS_CURR_CODE: stringValue(row.partners_curr_code, stringValue(row.curr_code, "OMR")),
    PARTNERS_EX_RATE: numberValue(row.partners_ex_rate, numberValue(row.ex_rate, 1)),
    ENQUIRY_TYPE: "RFQ",
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
