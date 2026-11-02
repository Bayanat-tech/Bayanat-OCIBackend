import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";
import { toHeaderObject } from "./freightEnquiryProcedures";

type Connection = oracledb.Connection;

export const frtEnquiryActivityList = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = req.body.company_code ?? req.body.COMPANY_CODE;
    const enquiryType = req.body.enquiry_type ?? req.body.ENQUIRY_TYPE ?? "ENQ";
    const enquiryNr = req.body.enquiry_nr ?? req.body.ENQUIRY_NR;

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
        p_company_code: companyCode,
        p_enquiry_type: enquiryType,
        p_enquiry_nr: enquiryNr,
        p_header: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        p_details: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const outBinds = result.outBinds as any;
    await rowsFromCursor(outBinds.p_header);
    const details = await rowsFromCursor(outBinds.p_details);
    res.json({ success: true, data: details, totalCount: details.length });
  });
};

export const frtEnquiryActivitySave = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const { details } = req.body;
    if (!Array.isArray(details)) {
      res.status(400).json({ success: false, message: "Details are required" });
      return;
    }

    const companyCode = req.body.company_code ?? req.body.COMPANY_CODE;
    const enquiryType = req.body.enquiry_type ?? req.body.ENQUIRY_TYPE ?? "ENQ";
    const enquiryNr = req.body.enquiry_nr ?? req.body.ENQUIRY_NR;

    // 1. Retrieve current header via PROC_FRT_ENQUIRY_GET
    const getResult = await connection.execute(
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
        p_company_code: companyCode,
        p_enquiry_type: enquiryType,
        p_enquiry_nr: enquiryNr,
        p_header: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        p_details: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const outBinds = getResult.outBinds as any;
    const headerRows = await rowsFromCursor(outBinds.p_header);
    await rowsFromCursor(outBinds.p_details);

    if (!headerRows || headerRows.length === 0) {
      res.status(404).json({ success: false, message: "Enquiry not found" });
      return;
    }

    const header = headerRows[0] as Record<string, unknown>;

    // 2. Persist details atomically via official Stored Procedure PROC_FRT_ENQUIRY_SAVE
    const saveResult = await connection.execute(
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

    res.json({
      success: true,
      message: "Enquiry activities saved successfully",
      data: { rows: details.length, enquiry_nr: (saveResult.outBinds as any).p_enquiry_nr_out },
    });
  });
};

export const frtEnquiryActivityDelete = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = req.body.company_code ?? req.body.COMPANY_CODE;
    const enquiryType = req.body.enquiry_type ?? req.body.ENQUIRY_TYPE ?? "ENQ";
    const enquiryNr = req.body.enquiry_nr ?? req.body.ENQUIRY_NR;
    const srno = numberValue(req.body.srno);
    const actCode = req.body.act_code ?? req.body.ACT_CODE;

    // 1. Retrieve current header & details via PROC_FRT_ENQUIRY_GET
    const getResult = await connection.execute(
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
        p_company_code: companyCode,
        p_enquiry_type: enquiryType,
        p_enquiry_nr: enquiryNr,
        p_header: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        p_details: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const outBinds = getResult.outBinds as any;
    const headerRows = await rowsFromCursor(outBinds.p_header);
    const details = await rowsFromCursor(outBinds.p_details);

    if (!headerRows || headerRows.length === 0) {
      res.status(404).json({ success: false, message: "Enquiry not found" });
      return;
    }

    const header = headerRows[0] as Record<string, unknown>;
    const remaining = (details as Record<string, unknown>[]).filter(
      (d) => Number(d.SRNO || d.srno) !== srno && String(d.ACT_CODE || d.act_code) !== actCode
    );

    // 2. Persist updated lines via PROC_FRT_ENQUIRY_SAVE
    await connection.execute(
      `BEGIN
         PROC_FRT_ENQUIRY_SAVE(:p_header, :p_details, :p_enquiry_nr_out);
       END;`,
      {
        p_header: { type: "FRT_ENQUIRY_HDR_TAB", val: [toHeaderObject(header)] },
        p_details: { type: "FRT_ENQUIRY_DET_TAB", val: remaining.map((row) => toDetailObject(row, header)) },
        p_enquiry_nr_out: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 50 },
      },
      { autoCommit: true }
    );

    res.json({ success: true, message: "Enquiry activity deleted successfully" });
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
    console.error("Freight enquiry activity procedure error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to execute Freight enquiry activity procedure",
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
  const company = stringValue(row.company_code ?? row.COMPANY_CODE, stringValue(header.company_code ?? header.COMPANY_CODE));
  const prin = stringValue(row.prin_code ?? row.PRIN_CODE, stringValue(header.prin_code ?? header.PRIN_CODE));
  const enqNr = stringValue(row.enquiry_nr ?? row.ENQUIRY_NR, stringValue(header.enquiry_nr ?? header.ENQUIRY_NR));
  const enqType = stringValue(row.enquiry_type ?? row.ENQUIRY_TYPE, stringValue(header.enquiry_type ?? header.ENQUIRY_TYPE, "ENQ"));
  const curr = stringValue(row.curr_code ?? row.CURR_CODE, stringValue(header.curr_code ?? header.CURR_CODE, "OMR"));
  const exRate = numberValue(row.ex_rate ?? row.EX_RATE, numberValue(header.ex_rate ?? header.EX_RATE, 1));
  const user = stringValue(row.userid ?? row.USERID, stringValue(header.userid ?? header.USERID, "ADMIN"));
  const orgPort = stringValue(row.origin_port ?? row.ORIGIN_PORT, stringValue(header.origin_port ?? header.ORIGIN_PORT));
  const dstPort = stringValue(row.destination_port ?? row.DESTINATION_PORT, stringValue(header.destination_port ?? header.DESTINATION_PORT));
  const transMode = stringValue(row.transport_mode ?? row.TRANSPORT_MODE, stringValue(header.transport_mode ?? header.TRANSPORT_MODE, "A"));

  return {
    COMPANY_CODE: company,
    PRIN_CODE: prin,
    ENQUIRY_NR: enqNr,
    ACT_CODE: stringValue(row.act_code ?? row.ACT_CODE),
    QUANTITY: numberValue(row.quantity ?? row.QUANTITY),
    UOM: stringValue(row.uom ?? row.UOM),
    BILL_RATE: numberValue(row.bill_rate ?? row.BILL_RATE),
    COST_RATE: numberValue(row.cost_rate ?? row.COST_RATE),
    BILL: numberValue(row.bill ?? row.BILL),
    USERID: user,
    COST: numberValue(row.cost ?? row.COST),
    USER_DT: new Date(),
    CURR_CODE: curr,
    EX_RATE: exRate,
    UOC: stringValue(row.uoc ?? row.UOC),
    MOC1: stringValue(row.moc1 ?? row.MOC1),
    MOC2: stringValue(row.moc2 ?? row.MOC2),
    PARTNERS_PRICE: numberValue(row.partners_price ?? row.PARTNERS_PRICE),
    FC_COST: numberValue(row.fc_cost ?? row.FC_COST),
    FC_BILL: numberValue(row.fc_bill ?? row.FC_BILL),
    FC_PARTNERS: numberValue(row.fc_partners ?? row.FC_PARTNERS),
    FC_COSTRATE: numberValue(row.fc_costrate ?? row.FC_COSTRATE),
    FC_BILLRATE: numberValue(row.fc_billrate ?? row.FC_BILLRATE),
    ORIGIN_PORT: orgPort,
    DESTINATION_PORT: dstPort,
    SRNO: numberValue(row.srno ?? row.SRNO),
    TRANSPORT_MODE: transMode,
    COST_CURR_CODE: stringValue(row.cost_curr_code ?? row.COST_CURR_CODE, curr),
    COST_EX_RATE: numberValue(row.cost_ex_rate ?? row.COST_EX_RATE, exRate),
    PARTNERS_CURR_CODE: stringValue(row.partners_curr_code ?? row.PARTNERS_CURR_CODE, curr),
    PARTNERS_EX_RATE: numberValue(row.partners_ex_rate ?? row.PARTNERS_EX_RATE, exRate),
    ENQUIRY_TYPE: enqType,
    REMARKS: stringValue(row.remarks ?? row.REMARKS),
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
