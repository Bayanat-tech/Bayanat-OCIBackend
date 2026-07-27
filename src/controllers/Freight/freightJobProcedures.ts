import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

type Connection = oracledb.Connection;

export const frtJobList = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_JOB_LIST(
           :p_company_code,
           :p_transport_mode,
           :p_job_type,
           :p_search,
           :p_result
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_transport_mode: req.body.transport_mode ?? req.body.TRANSPORT_MODE,
        p_job_type: req.body.job_type ?? req.body.JOB_TYPE,
        p_search: req.body.search ?? req.body.SEARCH ?? null,
        p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = await rowsFromCursor((result.outBinds as any).p_result);
    res.json({ success: true, data: rows, totalCount: rows.length });
  });
};

export const frtJobGet = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_JOB_GET(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_header,
           :p_packlist
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_prin_code: req.body.prin_code ?? req.body.PRIN_CODE,
        p_job_no: req.body.job_no ?? req.body.JOB_NO,
        p_header: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        p_packlist: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const outBinds = result.outBinds as any;
    const headerRows = await rowsFromCursor(outBinds.p_header);
    const packlistRows = await rowsFromCursor(outBinds.p_packlist);
    res.json({ success: true, data: { header: headerRows[0] ?? null, packlist: packlistRows[0] ?? null } });
  });
};

export const frtJobSave = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const job = req.body.job ?? req.body.header ?? req.body;
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_JOB_SAVE(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_job_date,
           :p_job_type,
           :p_transport_mode,
           :p_dept_code,
           :p_quotation_ref,
           :p_doc_ref,
           :p_hawb,
           :p_port_code,
           :p_destination_port,
           :p_vessel_name,
           :p_voyage_no,
           :p_carrier,
           :p_forwarder_code,
           :p_eta,
           :p_etd,
           :p_payment_terms,
           :p_payableat,
           :p_curr_code,
           :p_ex_rate,
           :p_be_no,
           :p_be_date,
           :p_country_origin,
           :p_country_destination,
           :p_custom_recno,
           :p_ref_customs,
           :p_remarks,
           :p_user_id,
           :p_job_no_out
         );
       END;`,
      {
        p_company_code: value(job.company_code ?? job.COMPANY_CODE),
        p_prin_code: value(job.prin_code ?? job.PRIN_CODE),
        p_job_no: value(job.job_no ?? job.JOB_NO),
        p_job_date: toDate(job.job_date ?? job.JOB_DATE),
        p_job_type: value(job.job_type ?? job.JOB_TYPE),
        p_transport_mode: value(job.transport_mode ?? job.TRANSPORT_MODE),
        p_dept_code: value(job.dept_code ?? job.DEPT_CODE),
        p_quotation_ref: value(job.quotation_ref ?? job.QUOTATION_REF),
        p_doc_ref: value(job.doc_ref ?? job.DOC_REF),
        p_hawb: value(job.hawb ?? job.HAWB),
        p_port_code: value(job.port_code ?? job.PORT_CODE),
        p_destination_port: value(job.destination_port ?? job.DESTINATION_PORT),
        p_vessel_name: value(job.vessel_name ?? job.VESSEL_NAME),
        p_voyage_no: value(job.voyage_no ?? job.VOYAGE_NO),
        p_carrier: value(job.carrier ?? job.CARRIER),
        p_forwarder_code: value(job.forwarder_code ?? job.FORWARDER_CODE),
        p_eta: toDate(job.eta ?? job.ETA),
        p_etd: toDate(job.etd ?? job.ETD),
        p_payment_terms: value(job.payment_terms ?? job.PAYMENT_TERMS),
        p_payableat: value(job.payableat ?? job.PAYABLEAT),
        p_curr_code: value(job.curr_code ?? job.CURR_CODE),
        p_ex_rate: numberValue(job.ex_rate ?? job.EX_RATE),
        p_be_no: value(job.be_no ?? job.BE_NO),
        p_be_date: toDate(job.be_date ?? job.BE_DATE),
        p_country_origin: value(job.country_origin ?? job.COUNTRY_ORIGIN),
        p_country_destination: value(job.country_destination ?? job.COUNTRY_DESTINATION),
        p_custom_recno: value(job.custom_recno ?? job.CUSTOM_RECNO),
        p_ref_customs: value(job.ref_customs ?? job.REF_CUSTOMS),
        p_remarks: value(job.remarks ?? job.REMARKS),
        p_user_id: value(job.user_id ?? job.USER_ID ?? req.body.user_id ?? req.body.USER_ID),
        p_job_no_out: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 30 },
      },
      { autoCommit: true }
    );

    res.json({ success: true, message: "Freight job saved successfully", data: { job_no: (result.outBinds as any).p_job_no_out } });
  });
};

export const frtJobCancel = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    await connection.execute(
      `BEGIN
         PROC_FRT_JOB_CANCEL(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_cancelled_by,
           :p_cancel_remarks
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_prin_code: req.body.prin_code ?? req.body.PRIN_CODE,
        p_job_no: req.body.job_no ?? req.body.JOB_NO,
        p_cancelled_by: req.body.cancelled_by ?? req.body.CANCELLED_BY ?? req.body.user_id ?? req.body.USER_ID,
        p_cancel_remarks: req.body.cancel_remarks ?? req.body.CANCEL_REMARKS ?? null,
      },
      { autoCommit: true }
    );

    res.json({ success: true, message: "Freight job cancelled successfully" });
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
    console.error("Freight job procedure error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to execute Freight job procedure",
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

function value(input: unknown) {
  if (input === undefined || input === null) return null;
  const text = String(input).trim();
  return text ? text : null;
}

function numberValue(input: unknown) {
  const text = value(input);
  if (text === null) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function toDate(input: unknown) {
  if (!input) return null;
  if (input instanceof Date) return input;
  const date = new Date(String(input));
  return Number.isNaN(date.getTime()) ? null : date;
}
