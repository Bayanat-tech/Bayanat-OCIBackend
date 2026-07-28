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
           :p_div_code,
           :p_job_category,
           :p_job_class,
           :p_member_type,
           :p_sale_type,
           :p_tx_cat_code,
           :p_quotation_ref,
           :p_doc_ref,
           :p_doc_ref2,
           :p_hawb,
           :p_port_code,
           :p_destination_port,
           :p_place_receipt,
           :p_place_delivery,
           :p_vessel_name,
           :p_feeder_vessel_name,
           :p_voyage_no,
           :p_carrier,
           :p_forwarder_code,
           :p_eta,
           :p_ata,
           :p_etd,
           :p_schedule_date,
           :p_job_start_date,
           :p_transit_time,
           :p_payment_terms,
           :p_payableat,
           :p_curr_code,
           :p_ex_rate,
           :p_frieght_value,
           :p_insurance_value,
           :p_no_of_original_bl,
           :p_cust_code,
           :p_broker_code,
           :p_prin_ref1,
           :p_prin_ref2,
           :p_description1,
           :p_description2,
           :p_salesman_code,
           :p_be_no,
           :p_be_date,
           :p_country_origin,
           :p_country_destination,
           :p_custom_recno,
           :p_ref_customs,
           :p_ref_customs_date,
           :p_ref_jobno,
           :p_combined_jobno,
           :p_reexport,
           :p_job_flag,
           :p_confirmed,
           :p_confirm_date,
           :p_completed,
           :p_complete_date,
           :p_invoiced,
           :p_invoice_date,
           :p_packdet,
           :p_packdet_date,
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
        p_div_code: value(job.div_code ?? job.DIV_CODE),
        p_job_category: value(job.job_category ?? job.JOB_CATEGORY),
        p_job_class: value(job.job_class ?? job.JOB_CLASS),
        p_member_type: value(job.member_type ?? job.MEMBER_TYPE),
        p_sale_type: value(job.sale_type ?? job.SALE_TYPE),
        p_tx_cat_code: value(job.tx_cat_code ?? job.TX_CAT_CODE),
        p_quotation_ref: value(job.quotation_ref ?? job.QUOTATION_REF),
        p_doc_ref: value(job.doc_ref ?? job.DOC_REF),
        p_doc_ref2: value(job.doc_ref2 ?? job.DOC_REF2),
        p_hawb: value(job.hawb ?? job.HAWB),
        p_port_code: value(job.port_code ?? job.PORT_CODE),
        p_destination_port: value(job.destination_port ?? job.DESTINATION_PORT),
        p_place_receipt: value(job.place_receipt ?? job.PLACE_RECEIPT),
        p_place_delivery: value(job.place_delivery ?? job.PLACE_DELIVERY),
        p_vessel_name: value(job.vessel_name ?? job.VESSEL_NAME),
        p_feeder_vessel_name: value(job.feeder_vessel_name ?? job.FEEDER_VESSEL_NAME),
        p_voyage_no: value(job.voyage_no ?? job.VOYAGE_NO),
        p_carrier: value(job.carrier ?? job.CARRIER),
        p_forwarder_code: value(job.forwarder_code ?? job.FORWARDER_CODE),
        p_eta: toDate(job.eta ?? job.ETA),
        p_ata: toDate(job.ata ?? job.ATA),
        p_etd: toDate(job.etd ?? job.ETD),
        p_schedule_date: toDate(job.schedule_date ?? job.SCHEDULE_DATE),
        p_job_start_date: toDate(job.job_start_date ?? job.JOB_START_DATE),
        p_transit_time: value(job.transit_time ?? job.TRANSIT_TIME),
        p_payment_terms: value(job.payment_terms ?? job.PAYMENT_TERMS),
        p_payableat: value(job.payableat ?? job.PAYABLEAT),
        p_curr_code: value(job.curr_code ?? job.CURR_CODE),
        p_ex_rate: numberValue(job.ex_rate ?? job.EX_RATE),
        p_frieght_value: numberValue(job.frieght_value ?? job.FRIEGHT_VALUE ?? job.freight_value ?? job.FREIGHT_VALUE),
        p_insurance_value: numberValue(job.insurance_value ?? job.INSURANCE_VALUE),
        p_no_of_original_bl: numberValue(job.no_of_original_bl ?? job.NO_OF_ORIGINAL_BL),
        p_cust_code: value(job.cust_code ?? job.CUST_CODE),
        p_broker_code: value(job.broker_code ?? job.BROKER_CODE),
        p_prin_ref1: value(job.prin_ref1 ?? job.PRIN_REF1),
        p_prin_ref2: value(job.prin_ref2 ?? job.PRIN_REF2),
        p_description1: value(job.description1 ?? job.DESCRIPTION1),
        p_description2: value(job.description2 ?? job.DESCRIPTION2),
        p_salesman_code: value(job.salesman_code ?? job.SALESMAN_CODE),
        p_be_no: value(job.be_no ?? job.BE_NO),
        p_be_date: toDate(job.be_date ?? job.BE_DATE),
        p_country_origin: value(job.country_origin ?? job.COUNTRY_ORIGIN),
        p_country_destination: value(job.country_destination ?? job.COUNTRY_DESTINATION),
        p_custom_recno: value(job.custom_recno ?? job.CUSTOM_RECNO),
        p_ref_customs: value(job.ref_customs ?? job.REF_CUSTOMS),
        p_ref_customs_date: toDate(job.ref_customs_date ?? job.REF_CUSTOMS_DATE),
        p_ref_jobno: value(job.ref_jobno ?? job.REF_JOBNO),
        p_combined_jobno: value(job.combined_jobno ?? job.COMBINED_JOBNO),
        p_reexport: value(job.reexport ?? job.REEXPORT),
        p_job_flag: value(job.job_flag ?? job.JOB_FLAG),
        p_confirmed: value(job.confirmed ?? job.CONFIRMED),
        p_confirm_date: toDate(job.confirm_date ?? job.CONFIRM_DATE),
        p_completed: value(job.completed ?? job.COMPLETED),
        p_complete_date: toDate(job.complete_date ?? job.COMPLETE_DATE),
        p_invoiced: value(job.invoiced ?? job.INVOICED),
        p_invoice_date: toDate(job.invoice_date ?? job.INVOICE_DATE),
        p_packdet: value(job.packdet ?? job.PACKDET),
        p_packdet_date: toDate(job.packdet_date ?? job.PACKDET_DATE),
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
