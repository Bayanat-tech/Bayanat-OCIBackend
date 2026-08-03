import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

type Connection = oracledb.Connection;

const reportProcedures: Record<string, string> = {
  enquiry_list: "PROC_FRT_REPORT_ENQUIRY_LIST",
  rfq_list: "PROC_FRT_REPORT_RFQ_LIST",
  quotation_list: "PROC_FRT_REPORT_QUOTATION_LIST",
  freight_job_list: "PROC_FRT_REPORT_JOB_LIST",
  freight_profit: "PROC_FRT_REPORT_PROFIT",
  freight_expense: "PROC_FRT_REPORT_EXPENSE",
  freight_revenue: "PROC_FRT_REPORT_REVENUE",
  freight_brokerage: "PROC_FRT_REPORT_BROKERAGE",
  query_report: "PROC_FRT_REPORT_QUERY",
  deposits: "PROC_FRT_REPORT_DEPOSITS",
  container_deposit: "PROC_FRT_REPORT_CONTAINER_DEPOSIT",
  freight_summary: "PROC_FRT_REPORT_SUMMARY",
};

export const frtReportRun = async (req: Request, res: Response): Promise<void> => {
  const reportKey = String(req.body.report_key ?? req.body.REPORT_KEY ?? "").toLowerCase();
  const procName = reportProcedures[reportKey];
  if (!procName) {
    res.status(400).json({ success: false, message: "Invalid freight report key" });
    return;
  }

  await withConnection(res, async (connection) => {
    const binds = reportBinds(req);
    let rows: unknown[];
    let source = "PROC_FRT_REPORT_RUN_PB";
    try {
      rows = await runPowerBuilderReport(connection, reportKey, binds);
    } catch (error: any) {
      const message = String(error?.message || "");
      const canFallback = message.includes("PLS-00201") || message.includes("PLS-00306") || message.includes("PROC_FRT_REPORT_RUN_PB");
      if (!canFallback) throw error;
      source = procName;
      rows = await runLegacyReport(connection, procName, binds);
    }

    res.json({ success: true, data: rows, totalCount: rows.length, source });
  });
};

async function runPowerBuilderReport(connection: Connection, reportKey: string, binds: Record<string, unknown>) {
  const result = await connection.execute(
    `BEGIN
       PROC_FRT_REPORT_RUN_PB(
         :p_report_key,
         :p_company_code,
         :p_from_date,
         :p_to_date,
         :p_schedule_from_date,
         :p_schedule_to_date,
         :p_confirm_from_date,
         :p_confirm_to_date,
         :p_collection_from_date,
         :p_collection_to_date,
         :p_deposit_from_date,
         :p_deposit_to_date,
         :p_expiry_from_date,
         :p_expiry_to_date,
         :p_eta_from_date,
         :p_eta_to_date,
         :p_ata_from_date,
         :p_ata_to_date,
         :p_prin_code_from,
         :p_prin_code_to,
         :p_job_no_from,
         :p_job_no_to,
         :p_doc_no_from,
         :p_doc_no_to,
         :p_broker_code_from,
         :p_broker_code_to,
         :p_dept_code_from,
         :p_dept_code_to,
         :p_div_code,
         :p_origin_port,
         :p_destination_port,
         :p_transport_mode,
         :p_job_type,
         :p_status,
         :p_report_period,
         :p_report_mode,
         :p_report_variant,
         :p_invoice_no,
         :p_vessel_name,
         :p_voyage_no,
         :p_container_no,
         :p_bl_no,
         :p_be_no,
         :p_claim_ref,
         :p_exit_bill1,
         :p_exit_bill2,
         :p_cleared_flag,
         :p_consignee_name,
         :p_shipper_name,
         :p_job_category,
         :p_member_type,
         :p_sale_type,
         :p_inco_terms,
         :p_forwarder_code,
         :p_doc_ref,
         :p_po_no,
         :p_search,
         :p_result
       );
     END;`,
    {
      p_report_key: reportKey,
      ...binds,
      p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
    } as oracledb.BindParameters,
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  return rowsFromCursor((result.outBinds as any).p_result);
}

async function runLegacyReport(connection: Connection, procName: string, binds: Record<string, unknown>) {
    const result = await connection.execute(
      `BEGIN
         ${procName}(
           :p_company_code,
           :p_from_date,
           :p_to_date,
           :p_prin_code,
           :p_job_no,
           :p_transport_mode,
           :p_job_type,
           :p_status,
           :p_search,
           :p_result
         );
       END;`,
      {
        p_company_code: binds.p_company_code,
        p_from_date: binds.p_from_date,
        p_to_date: binds.p_to_date,
        p_prin_code: binds.p_prin_code_from,
        p_job_no: binds.p_job_no_from,
        p_transport_mode: binds.p_transport_mode,
        p_job_type: binds.p_job_type,
        p_status: binds.p_status,
        p_search: binds.p_search,
        p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      } as oracledb.BindParameters,
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

  return rowsFromCursor((result.outBinds as any).p_result);
}

function reportBinds(req: Request) {
  const body = req.body || {};
  return {
    p_company_code: body.company_code ?? body.COMPANY_CODE,
    p_from_date: toDate(body.from_date),
    p_to_date: toDate(body.to_date),
    p_schedule_from_date: toDate(body.schedule_from_date),
    p_schedule_to_date: toDate(body.schedule_to_date),
    p_confirm_from_date: toDate(body.confirm_from_date),
    p_confirm_to_date: toDate(body.confirm_to_date),
    p_collection_from_date: toDate(body.collection_from_date),
    p_collection_to_date: toDate(body.collection_to_date),
    p_deposit_from_date: toDate(body.deposit_from_date),
    p_deposit_to_date: toDate(body.deposit_to_date),
    p_expiry_from_date: toDate(body.expiry_from_date),
    p_expiry_to_date: toDate(body.expiry_to_date),
    p_eta_from_date: toDate(body.eta_from_date),
    p_eta_to_date: toDate(body.eta_to_date),
    p_ata_from_date: toDate(body.ata_from_date),
    p_ata_to_date: toDate(body.ata_to_date),
    p_prin_code_from: value(body.prin_code_from ?? body.prin_code ?? body.PRIN_CODE),
    p_prin_code_to: value(body.prin_code_to ?? body.prin_code ?? body.PRIN_CODE),
    p_job_no_from: value(body.job_no_from ?? body.job_no ?? body.JOB_NO),
    p_job_no_to: value(body.job_no_to ?? body.job_no ?? body.JOB_NO),
    p_doc_no_from: value(body.doc_no_from ?? body.doc_no),
    p_doc_no_to: value(body.doc_no_to ?? body.doc_no),
    p_broker_code_from: value(body.broker_code_from ?? body.broker_code),
    p_broker_code_to: value(body.broker_code_to ?? body.broker_code),
    p_dept_code_from: value(body.dept_code_from ?? body.dept_code),
    p_dept_code_to: value(body.dept_code_to ?? body.dept_code),
    p_div_code: value(body.div_code),
    p_origin_port: value(body.origin_port),
    p_destination_port: value(body.destination_port),
    p_transport_mode: value(body.transport_mode ?? body.TRANSPORT_MODE),
    p_job_type: value(body.job_type ?? body.JOB_TYPE),
    p_status: value(body.status ?? body.STATUS),
    p_report_period: value(body.report_period),
    p_report_mode: value(body.report_mode),
    p_report_variant: value(body.report_variant),
    p_invoice_no: value(body.invoice_no),
    p_vessel_name: value(body.vessel_name),
    p_voyage_no: value(body.voyage_no),
    p_container_no: value(body.container_no),
    p_bl_no: value(body.bl_no),
    p_be_no: value(body.be_no),
    p_claim_ref: value(body.claim_ref),
    p_exit_bill1: value(body.exit_bill1),
    p_exit_bill2: value(body.exit_bill2),
    p_cleared_flag: value(body.cleared_flag),
    p_consignee_name: value(body.consignee_name),
    p_shipper_name: value(body.shipper_name),
    p_job_category: value(body.job_category),
    p_member_type: value(body.member_type),
    p_sale_type: value(body.sale_type),
    p_inco_terms: value(body.inco_terms),
    p_forwarder_code: value(body.forwarder_code),
    p_doc_ref: value(body.doc_ref),
    p_po_no: value(body.po_no),
    p_search: value(body.search ?? body.SEARCH),
  };
}

function value(input: unknown) {
  const next = input === undefined || input === null ? "" : String(input).trim();
  return next || null;
}

function toDate(input: unknown) {
  if (!input) return null;
  const date = new Date(String(input));
  return Number.isNaN(date.getTime()) ? null : date;
}

async function withConnection(res: Response, handler: (connection: Connection) => Promise<void>) {
  let connection: Connection | undefined;
  try {
    const tenantId = String(getCurrentTenantId() || "");
    connection = await TenantManager.getConnection(tenantId);
    await handler(connection);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to execute Freight report procedure",
      details: error?.message || String(error),
    });
  } finally {
    if (connection) await connection.close().catch(() => undefined);
  }
}

async function rowsFromCursor(cursor: oracledb.ResultSet<unknown> | undefined) {
  if (!cursor) return [];
  const rows = await cursor.getRows();
  await cursor.close();
  return rows;
}
