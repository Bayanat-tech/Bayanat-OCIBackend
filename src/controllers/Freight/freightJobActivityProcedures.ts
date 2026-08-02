import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

type Connection = oracledb.Connection;

export const frtJobActivityJobList = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_JOB_ACTIVITY_JOB_LIST(
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

export const frtJobActivityGet = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_JOB_ACTIVITY_GET(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_header,
           :p_lines
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_prin_code: req.body.prin_code ?? req.body.PRIN_CODE,
        p_job_no: req.body.job_no ?? req.body.JOB_NO,
        p_header: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        p_lines: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const outBinds = result.outBinds as any;
    const headerRows = await rowsFromCursor(outBinds.p_header);
    const lines = await rowsFromCursor(outBinds.p_lines);
    res.json({ success: true, data: { header: headerRows[0] ?? null, lines } });
  });
};

export const frtJobActivitySave = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
    await connection.execute(
      `BEGIN
         PROC_FRT_JOB_ACTIVITY_SAVE(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_user_id,
           :p_lines
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_prin_code: req.body.prin_code ?? req.body.PRIN_CODE,
        p_job_no: req.body.job_no ?? req.body.JOB_NO,
        p_user_id: req.body.user_id ?? req.body.USER_ID,
        p_lines: { type: "FRT_JOB_ACTIVITY_TAB", val: lines.map(toActivityObject) },
      },
      { autoCommit: true }
    );

    res.json({ success: true, message: "Freight job activities saved successfully" });
  });
};

export const frtJobActivityDelete = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    await connection.execute(
      `BEGIN
         PROC_FRT_JOB_ACTIVITY_DELETE(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_srno
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_prin_code: req.body.prin_code ?? req.body.PRIN_CODE,
        p_job_no: req.body.job_no ?? req.body.JOB_NO,
        p_srno: numberValue(req.body.srno ?? req.body.SRNO),
      },
      { autoCommit: true }
    );

    res.json({ success: true, message: "Freight job activity deleted successfully" });
  });
};

export const frtJobActivityConfirm = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    await connection.execute(
      `BEGIN
         PROC_FRT_JOB_ACTIVITY_CONFIRM(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_user_id
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_prin_code: req.body.prin_code ?? req.body.PRIN_CODE,
        p_job_no: req.body.job_no ?? req.body.JOB_NO,
        p_user_id: req.body.user_id ?? req.body.USER_ID,
      },
      { autoCommit: true }
    );

    res.json({ success: true, message: "Freight job activities confirmed successfully" });
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
    console.error("Freight job activity procedure error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to execute Freight job activity procedure",
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

function toActivityObject(row: Record<string, unknown>) {
  const activity: Record<string, unknown> = {
    SRNO: numberValue(row.srno ?? row.SRNO),
    ACT_CODE: stringValue(row.act_code ?? row.ACT_CODE),
    OTHER_SERVICES: stringValue(row.other_services ?? row.OTHER_SERVICES),
    QUANTITY: numberValue(row.quantity ?? row.QUANTITY, 1),
    BILL_RATE: numberValue(row.bill_rate ?? row.BILL_RATE),
    BILL: numberValue(row.bill ?? row.BILL),
    ACTUAL_COST: numberValue(row.actual_cost ?? row.ACTUAL_COST),
    BROKER_CODE: stringValue(row.broker_code ?? row.BROKER_CODE),
    PARTNERS_PRICE: numberValue(row.partners_price ?? row.PARTNERS_PRICE),
    TRANSPORTER_CODE: stringValue(row.transporter_code ?? row.TRANSPORTER_CODE),
    VEHICLE_NO: stringValue(row.vehicle_no ?? row.VEHICLE_NO),
    TRANSPORT_PRICE: numberValue(row.transport_price ?? row.TRANSPORT_PRICE),
    PRINT_FLAG: stringValue(row.print_flag ?? row.PRINT_FLAG, "Y"),
    CONFIRMED: stringValue(row.confirmed ?? row.CONFIRMED, "Y"),
    PAYMENT_MODE: stringValue(row.payment_mode ?? row.PAYMENT_MODE),
    CHQ_CARD_NO: stringValue(row.chq_card_no ?? row.CHQ_CARD_NO),
    CHEQ_DETAILS: stringValue(row.cheq_details ?? row.CHEQ_DETAILS),
    CHEQ_DATE: toDate(row.cheq_date ?? row.CHEQ_DATE),
    DIV_CODE: stringValue(row.div_code ?? row.DIV_CODE),
    REMARKS: stringValue(row.remarks ?? row.REMARKS),
    BILL_CURR_CODE: stringValue(row.bill_curr_code ?? row.BILL_CURR_CODE),
    BILL_EX_RATE: numberValue(row.bill_ex_rate ?? row.BILL_EX_RATE),
    AC_CURR_CODE: stringValue(row.ac_curr_code ?? row.AC_CURR_CODE),
    AC_EX_RATE: numberValue(row.ac_ex_rate ?? row.AC_EX_RATE),
    PARTNER_CURR_CODE: stringValue(row.partner_curr_code ?? row.PARTNER_CURR_CODE),
    PARTNER_EX_RATE: numberValue(row.partner_ex_rate ?? row.PARTNER_EX_RATE),
    TP_CURR_CODE: stringValue(row.tp_curr_code ?? row.TP_CURR_CODE),
    TP_EX_RATE: numberValue(row.tp_ex_rate ?? row.TP_EX_RATE),
  };

  addIfPresent(activity, "TX_CAT_CODE", row.tx_cat_code ?? row.TX_CAT_CODE);
  addIfPresent(activity, "TX_COMPNTCAT_CODE_1", row.tx_compntcat_code_1 ?? row.TX_COMPNTCAT_CODE_1);
  addIfPresent(activity, "TX_COMPNT_PERC_1", row.tx_compnt_perc_1 ?? row.TX_COMPNT_PERC_1, true);
  addIfPresent(activity, "TX_COMPNT_AMT_1", row.tx_compnt_amt_1 ?? row.TX_COMPNT_AMT_1, true);
  addIfPresent(activity, "TX_COMPNT_LCURAMT_1", row.tx_compnt_lcuramt_1 ?? row.TX_COMPNT_LCURAMT_1, true);
  addIfPresent(activity, "TX_COMPNT_1_EXPMT", row.tx_compnt_1_expmt ?? row.TX_COMPNT_1_EXPMT);
  addIfPresent(activity, "TX_CAT_CODE_COST", row.tx_cat_code_cost ?? row.TX_CAT_CODE_COST);
  addIfPresent(activity, "TX_COMPNTCAT_CODE_1_COST", row.tx_compntcat_code_1_cost ?? row.TX_COMPNTCAT_CODE_1_COST);
  addIfPresent(activity, "TX_COMPNT_PERC_1_COST", row.tx_compnt_perc_1_cost ?? row.TX_COMPNT_PERC_1_COST, true);
  addIfPresent(activity, "TX_COMPNT_AMT_1_COST", row.tx_compnt_amt_1_cost ?? row.TX_COMPNT_AMT_1_COST, true);
  addIfPresent(activity, "TX_COMPNT_LCURAMT_1_COST", row.tx_compnt_lcuramt_1_cost ?? row.TX_COMPNT_LCURAMT_1_COST, true);
  addIfPresent(activity, "TX_COMPNT_1_EXPMT_COST", row.tx_compnt_1_expmt_cost ?? row.TX_COMPNT_1_EXPMT_COST);

  return activity;
}

function addIfPresent(target: Record<string, unknown>, key: string, input: unknown, numeric = false) {
  const val = numeric ? numberValue(input) : stringValue(input);
  if (val !== null) target[key] = val;
}

function stringValue(input: unknown, fallback: string | null = null) {
  if (input === undefined || input === null) return fallback;
  const text = String(input).trim();
  return text ? text : fallback;
}

function numberValue(input: unknown, fallback: number | null = null) {
  const text = stringValue(input);
  if (text === null) return fallback;
  const number = Number(text);
  return Number.isFinite(number) ? number : fallback;
}

function toDate(input: unknown) {
  if (!input) return null;
  if (input instanceof Date) return input;
  const date = new Date(String(input));
  return Number.isNaN(date.getTime()) ? null : date;
}
