import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";
import { toDetailObject, toHeaderObject } from "./freightEnquiryProcedures";

type Connection = oracledb.Connection;

export const frtRfqList = async (req: Request, res: Response): Promise<void> => {
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
        p_enquiry_type: "RFQ",
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

export const frtRfqGet = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_ENQUIRY_GET(
           :p_company_code,
           :p_enquiry_type,
           :p_rfq_nr,
           :p_header,
           :p_details
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_enquiry_type: "RFQ",
        p_rfq_nr: req.body.enquiry_nr ?? req.body.rfq_nr ?? req.body.RFQ_NR,
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

export const frtRfqSave = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const { header, details } = req.body;
    if (!header || !Array.isArray(details)) {
      res.status(400).json({ success: false, message: "Header and details are required" });
      return;
    }

    const rfqHeader = { ...header, enquiry_type: "RFQ" };
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_ENQUIRY_SAVE(:p_header, :p_details, :p_rfq_nr_out);
       END;`,
      {
        p_header: { type: "FRT_ENQUIRY_HDR_TAB", val: [toHeaderObject(rfqHeader)] },
        p_details: { type: "FRT_ENQUIRY_DET_TAB", val: details.map((row: Record<string, unknown>) => toDetailObject({ ...row, enquiry_type: "RFQ" }, rfqHeader)) },
        p_rfq_nr_out: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 50 },
      },
      { autoCommit: true }
    );

    const rfqNr = (result.outBinds as any).p_rfq_nr_out;
    res.json({ success: true, message: "RFQ saved successfully", data: { enquiry_nr: rfqNr, rfq_nr: rfqNr } });
  });
};

export const frtRfqDelete = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    await connection.execute(
      `BEGIN
         PROC_FRT_ENQUIRY_DELETE(:p_company_code, :p_enquiry_type, :p_rfq_nr);
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_enquiry_type: "RFQ",
        p_rfq_nr: req.body.enquiry_nr ?? req.body.rfq_nr ?? req.body.RFQ_NR,
      },
      { autoCommit: true }
    );

    res.json({ success: true, message: "RFQ deleted successfully" });
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
    console.error("Freight RFQ procedure error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to execute Freight RFQ procedure",
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

function toDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
