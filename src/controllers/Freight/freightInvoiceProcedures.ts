import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

type Connection = oracledb.Connection;

export const frtInvoiceList = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await runFreightInvoiceProcedure(connection, req, "LIST");
    const rows = await rowsFromCursor((result.outBinds as any).p_result);
    res.json({ success: true, data: rows, totalCount: rows.length });
  });
};

export const frtInvoiceJobSelection = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await runFreightInvoiceQuery(connection, req, "JOB_SELECTION");
    const rows = await rowsFromCursor((result.outBinds as any).p_result);
    const requestedInvoiceNo = value(req.body.invoice_no ?? req.body.INVOICE_NO);
    const seen = new Set<string>();
    const eligibleRows = rows.filter((row: any) => {
      const consolidatedInvoiceNo = value(row.CONSOLIDATED_INVNO ?? row.consolidated_invno);
      if (consolidatedInvoiceNo && consolidatedInvoiceNo !== requestedInvoiceNo) return false;

      const key = [
        value(row.COMPANY_CODE ?? row.company_code),
        value(row.INVOICE_NO ?? row.invoice_no),
        value(row.PRIN_CODE ?? row.prin_code),
        value(row.JOB_NO ?? row.job_no),
        value(row.SRNO ?? row.srno),
        value(row.ACT_CODE ?? row.act_code),
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    res.json({ success: true, data: eligibleRows, totalCount: eligibleRows.length });
  });
};

export const frtInvoiceGet = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await runFreightInvoiceQuery(connection, req, "GET");
    const outBinds = result.outBinds as any;
    const headerRows = await rowsFromCursor(outBinds.p_header);
    const details = await rowsFromCursor(outBinds.p_details);
    const jobSelection = await rowsFromCursor(outBinds.p_jobs);
    res.json({
      success: true,
      data: {
        header: headerRows[0] || null,
        details,
        jobSelection,
      },
    });
  });
};

export const frtInvoiceSave = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await runFreightInvoiceSave(connection, req);
    const invoiceNo = String((result.outBinds as any).p_invoice_no || "");
    res.json({
      success: true,
      message: "Freight invoice saved successfully",
      data: { invoice_no: invoiceNo },
    });
  });
};

async function runFreightInvoiceQuery(connection: Connection, req: Request, action: "GET" | "JOB_SELECTION") {
  return connection.execute(
    `BEGIN PROC_FRT_INVOICE_QUERY(
       :p_action, :p_company_code, :p_invoice_no, :p_prin_code,
       :p_job_no, :p_from_date, :p_to_date, :p_search,
       :p_result, :p_header, :p_details, :p_jobs
     ); END;`,
    {
      p_action: action,
      p_company_code: value(req.body.company_code ?? req.body.COMPANY_CODE),
      p_invoice_no: value(req.body.invoice_no ?? req.body.INVOICE_NO),
      p_prin_code: value(req.body.prin_code ?? req.body.PRIN_CODE),
      p_job_no: value(req.body.job_no ?? req.body.JOB_NO),
      p_from_date: toDate(req.body.from_date ?? req.body.FROM_DATE),
      p_to_date: toDate(req.body.to_date ?? req.body.TO_DATE),
      p_search: value(req.body.search ?? req.body.SEARCH),
      p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      p_header: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      p_details: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      p_jobs: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
    },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
}

async function runFreightInvoiceSave(connection: Connection, req: Request) {
  const headerRows = buildHeaderRows(req);
  const detailRows = buildDetailRows(req, headerRows);
  const jobRows = buildJobRows(req, headerRows);
  await validateFreightInvoiceSave(connection, headerRows, jobRows);
  return connection.execute(
    `BEGIN PROC_FRT_INVOICE_SAVE(
       :p_company_code, :p_user_id, :p_invoice_hdr,
       :p_invoice_dtl, :p_job_sel, :p_invoice_no
     ); END;`,
    {
      p_company_code: value(req.body.company_code ?? req.body.COMPANY_CODE ?? headerRows[0]?.COMPANY_CODE),
      p_user_id: value(req.body.user_id ?? req.body.USER_ID ?? headerRows[0]?.USER_ID),
      p_invoice_hdr: { type: "T_INVOICE_TAB", val: headerRows },
      p_invoice_dtl: { type: "T_INVOICE_DTL_TAB", val: detailRows },
      p_job_sel: { type: "P_INVOICE_JOB_SELECTION_TAB", val: jobRows },
      p_invoice_no: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 50 },
    },
    { outFormat: oracledb.OUT_FORMAT_OBJECT, autoCommit: true }
  );
}

async function validateFreightInvoiceSave(
  connection: Connection,
  headerRows: Record<string, any>[],
  jobRows: Record<string, any>[]
) {
  const header = headerRows[0];
  const selected = jobRows.filter((row) => value(row.SELECTED, "N") === "Y");
  if (!header) throw new Error("Freight invoice header is required.");
  if (!selected.length) throw new Error("Select at least one freight activity.");

  for (const row of selected) {
    if (value(row.PRIN_CODE) !== value(header.PRIN_CODE)) {
      throw new Error("One freight invoice can contain one principal only.");
    }

    const jobResult = await connection.execute(
      `SELECT j.confirm_date,
              NVL(j.canceled, 'N') canceled,
              NVL(j.job_lock, 'N') job_lock,
              NVL(j.ind_freight, 'N') ind_freight,
              NVL((SELECT MAX(v.last_inv_date)
                     FROM VW_PRINWISE_LASTINVDATE v
                    WHERE v.company_code = j.company_code
                      AND v.prin_code = j.prin_code), DATE '1900-01-01') last_inv_date
         FROM TI_JOB j
        WHERE j.company_code = :company_code
          AND j.prin_code = :prin_code
          AND j.job_no = :job_no`,
      {
        company_code: value(row.COMPANY_CODE ?? header.COMPANY_CODE),
        prin_code: value(row.PRIN_CODE),
        job_no: value(row.JOB_NO),
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const job = (jobResult.rows as any[])?.[0];
    if (!job || job.IND_FREIGHT !== "Y") throw new Error(`Not a Freight job: ${row.JOB_NO}`);
    if (job.CANCELED === "Y") throw new Error(`Cancelled job cannot be invoiced: ${row.JOB_NO}`);
    if (job.JOB_LOCK === "Y") throw new Error(`Job is locked by Finance: ${row.JOB_NO}`);
    if (!job.CONFIRM_DATE) throw new Error(`Job must be confirmed before invoicing: ${row.JOB_NO}`);
    if (new Date(job.CONFIRM_DATE).getTime() <= new Date(job.LAST_INV_DATE).getTime()) {
      throw new Error(`Job confirmation date is in a closed invoice period: ${row.JOB_NO}`);
    }

    const activityResult = await connection.execute(
      `SELECT COUNT(*) available_count
         FROM TN_INVOICE_DET d
        WHERE d.company_code = :company_code
          AND d.prin_code = :prin_code
          AND d.invoice_no = :source_invoice_no
          AND d.job_no = :job_no
          AND d.srno = :srno
          AND d.act_code = :act_code
          AND NVL(d.flag_freight, 'N') = 'Y'
          AND (d.consolidated_invno IS NULL OR d.consolidated_invno = :consolidated_invoice_no)`,
      {
        company_code: value(row.COMPANY_CODE ?? header.COMPANY_CODE),
        prin_code: value(row.PRIN_CODE),
        source_invoice_no: value(row.INVOICE_NO),
        job_no: value(row.JOB_NO),
        srno: numberValue(row.SRNO),
        act_code: value(row.ACT_CODE),
        consolidated_invoice_no: value(header.INVOICE_NO),
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const count = Number((activityResult.rows as any[])?.[0]?.AVAILABLE_COUNT || 0);
    if (!count) throw new Error(`Freight activity is already invoiced or unavailable: ${row.JOB_NO}/${row.ACT_CODE}`);
  }
}

async function runFreightInvoiceProcedure(connection: Connection, req: Request, action: string, isSave = false) {
  const headerRows = buildHeaderRows(req);
  const detailRows = buildDetailRows(req, headerRows);
  const jobRows = buildJobRows(req, headerRows);

  return connection.execute(
    `BEGIN
       PROC_FRT_INVOICE(
         :p_action,
         :p_company_code,
         :p_invoice_no_in,
         :p_prin_code,
         :p_job_no,
         :p_from_date,
         :p_to_date,
         :p_search,
         :p_user_id,
         :p_invoice_hdr,
         :p_invoice_dtl,
         :p_job_sel,
         :p_result,
         :p_header,
         :p_details,
         :p_jobs,
         :p_invoice_no
       );
     END;`,
    {
      p_action: action,
      p_company_code: value(req.body.company_code ?? req.body.COMPANY_CODE ?? headerRows[0]?.COMPANY_CODE),
      p_invoice_no_in: value(req.body.invoice_no ?? req.body.INVOICE_NO ?? headerRows[0]?.INVOICE_NO),
      p_prin_code: value(req.body.prin_code ?? req.body.PRIN_CODE ?? headerRows[0]?.PRIN_CODE),
      p_job_no: value(req.body.job_no ?? req.body.JOB_NO ?? headerRows[0]?.JOB_NO),
      p_from_date: toDate(req.body.from_date ?? req.body.FROM_DATE ?? headerRows[0]?.FROM_DATE),
      p_to_date: toDate(req.body.to_date ?? req.body.TO_DATE ?? headerRows[0]?.TO_DATE),
      p_search: value(req.body.search ?? req.body.SEARCH),
      p_user_id: value(req.body.user_id ?? req.body.USER_ID ?? headerRows[0]?.USER_ID),
      p_invoice_hdr: { type: "T_INVOICE_TAB", val: headerRows },
      p_invoice_dtl: { type: "T_INVOICE_DTL_TAB", val: detailRows },
      p_job_sel: { type: "P_INVOICE_JOB_SELECTION_TAB", val: jobRows },
      p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      p_header: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      p_details: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      p_jobs: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      p_invoice_no: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 50 },
    },
    { outFormat: oracledb.OUT_FORMAT_OBJECT, autoCommit: isSave }
  );
}

function buildHeaderRows(req: Request) {
  return (Array.isArray(req.body.invoiceHeader) ? req.body.invoiceHeader : []).map((h: any) => ({
    COMPANY_CODE: value(h.COMPANY_CODE ?? h.company_code),
    INVOICE_NO: value(h.INVOICE_NO ?? h.invoice_no),
    INVOICE_DATE: toDate(h.INVOICE_DATE ?? h.invoice_date),
    FROM_DATE: toDate(h.FROM_DATE ?? h.from_date),
    TO_DATE: toDate(h.TO_DATE ?? h.to_date),
    JOB_NO: value(h.JOB_NO ?? h.job_no),
    PRIN_CODE: value(h.PRIN_CODE ?? h.prin_code),
    CUST_CODE: value(h.CUST_CODE ?? h.cust_code),
    INV_AMOUNT: numberValue(h.INV_AMOUNT ?? h.inv_amount),
    CURR_CODE: value(h.CURR_CODE ?? h.curr_code, "OMR"),
    INV_STATUS: value(h.INV_STATUS ?? h.inv_status, "N"),
    INV_DESC1: value(h.INV_DESC1 ?? h.inv_desc1),
    INV_DESC2: value(h.INV_DESC2 ?? h.inv_desc2),
    USER_ID: value(h.USER_ID ?? h.user_id),
  }));
}

function buildDetailRows(req: Request, headerRows: Record<string, unknown>[]) {
  return (Array.isArray(req.body.invoiceDetails) ? req.body.invoiceDetails : []).map((d: any, index: number) => ({
    COMPANY_CODE: value(d.COMPANY_CODE ?? d.company_code ?? headerRows[0]?.COMPANY_CODE),
    INVOICE_NO: value(d.INVOICE_NO ?? d.invoice_no),
    SRNO: numberValue(d.SRNO ?? d.srno, index + 1),
    ACT_CODE: value(d.ACT_CODE ?? d.act_code),
    BILL: numberValue(d.BILL ?? d.bill),
    COST: numberValue(d.COST ?? d.cost ?? d.actual_cost),
    QUANTITY: numberValue(d.QUANTITY ?? d.quantity, 1),
    BILL_RATE: numberValue(d.BILL_RATE ?? d.bill_rate),
    COST_RATE: numberValue(d.COST_RATE ?? d.cost_rate),
    INV_DESC: value(d.INV_DESC ?? d.inv_desc ?? d.activity ?? d.ACTIVITY),
    USER_ID: value(d.USER_ID ?? d.user_id ?? headerRows[0]?.USER_ID),
  }));
}

function buildJobRows(req: Request, headerRows: Record<string, unknown>[]) {
  return (Array.isArray(req.body.jobSelection) ? req.body.jobSelection : []).map((j: any) => ({
    INVOICE_NO: value(j.INVOICE_NO ?? j.invoice_no),
    JOB_NO: value(j.JOB_NO ?? j.job_no),
    PRIN_CODE: value(j.PRIN_CODE ?? j.prin_code),
    ACT_CODE: value(j.ACT_CODE ?? j.act_code),
    ACTIVITY: value(j.ACTIVITY ?? j.activity),
    BILL: numberValue(j.BILL ?? j.bill),
    ACTUAL_COST: numberValue(j.ACTUAL_COST ?? j.actual_cost),
    BILL_RATE: numberValue(j.BILL_RATE ?? j.bill_rate),
    COST_RATE: numberValue(j.COST_RATE ?? j.cost_rate),
    JOB_DATE: toDate(j.JOB_DATE ?? j.job_date),
    TXN_DATE: toDate(j.TXN_DATE ?? j.txn_date),
    QUANTITY: numberValue(j.QUANTITY ?? j.quantity, 1),
    COMPANY_CODE: value(j.COMPANY_CODE ?? j.company_code ?? headerRows[0]?.COMPANY_CODE),
    CONSOLIDATED_INVNO: value(j.CONSOLIDATED_INVNO ?? j.consolidated_invno),
    SELECTED: value(j.SELECTED ?? j.selected, "Y"),
    STORAGE_NO: value(j.STORAGE_NO ?? j.storage_no),
    SITE_IND: value(j.SITE_IND ?? j.site_ind),
    SEQ_NUMBER: numberValue(j.SEQ_NUMBER ?? j.seq_number),
    SRNO: numberValue(j.SRNO ?? j.srno),
  }));
}

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
    console.error("Freight invoice procedure error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to execute Freight invoice procedure",
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

function value(input: unknown, fallback: string | null = null) {
  if (input === undefined || input === null) return fallback;
  const text = String(input).trim();
  if (!text || text.toUpperCase() === "NULL") return fallback;
  return text;
}

function numberValue(input: unknown, fallback = 0) {
  const text = value(input);
  if (text === null) return fallback;
  const number = Number(text);
  return Number.isFinite(number) ? number : fallback;
}

function toDate(input: unknown) {
  if (!input) return null;
  if (input instanceof Date) return input;
  const text = String(input).trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}
