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
  deposits: "PROC_FRT_REPORT_DEPOSITS",
  container_deposit: "PROC_FRT_REPORT_CONTAINER_DEPOSIT",
};

export const frtReportRun = async (req: Request, res: Response): Promise<void> => {
  const reportKey = String(req.body.report_key ?? req.body.REPORT_KEY ?? "").toLowerCase();
  const procName = reportProcedures[reportKey];
  if (!procName) {
    res.status(400).json({ success: false, message: "Invalid freight report key" });
    return;
  }

  await withConnection(res, async (connection) => {
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
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_from_date: toDate(req.body.from_date),
        p_to_date: toDate(req.body.to_date),
        p_prin_code: value(req.body.prin_code ?? req.body.PRIN_CODE),
        p_job_no: value(req.body.job_no ?? req.body.JOB_NO),
        p_transport_mode: value(req.body.transport_mode ?? req.body.TRANSPORT_MODE),
        p_job_type: value(req.body.job_type ?? req.body.JOB_TYPE),
        p_status: value(req.body.status ?? req.body.STATUS),
        p_search: value(req.body.search ?? req.body.SEARCH),
        p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = await rowsFromCursor((result.outBinds as any).p_result);
    res.json({ success: true, data: rows, totalCount: rows.length });
  });
};

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
