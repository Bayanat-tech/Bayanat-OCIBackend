import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

type Connection = oracledb.Connection;

export const frtJobActivityJobList = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = req.body.company_code ?? req.body.COMPANY_CODE;
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_JOB_ACTIVITY_JOB_LIST(
           :p_company_code,
           :p_transport_mode,
           :p_job_type,
           :p_search,
           :p_supplier_code,
           :p_result
         );
       END;`,
      {
        p_company_code: companyCode,
        p_transport_mode: req.body.transport_mode ?? req.body.TRANSPORT_MODE,
        p_job_type: req.body.job_type ?? req.body.JOB_TYPE,
        p_search: req.body.search ?? req.body.SEARCH ?? null,
        p_supplier_code: req.body.supplier_code ?? req.body.SUPPLIER_CODE ?? null,
        p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = await rowsFromCursor((result.outBinds as any).p_result);

    // Fetch summary of Purchase Invoices booked against jobs to support PB unbooked-only filtering
    try {
      if (rows.length > 0 && companyCode) {
        const piSummary = await connection.execute(
          `SELECT JOB_NO, COUNT(*) AS PI_LINE_COUNT, SUM(AMOUNT) AS PI_BOOKED_AMOUNT, MAX(DOC_NO) AS LAST_PI_NO
           FROM TR_AC_DETAIL
           WHERE COMPANY_CODE = :cc AND DOC_TYPE = 'PI' AND JOB_NO IS NOT NULL
           GROUP BY JOB_NO`,
          { cc: companyCode },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const piMap = new Map<string, any>();
        ((piSummary.rows as any[]) || []).forEach((r: any) => {
          if (r.JOB_NO) piMap.set(String(r.JOB_NO).toUpperCase(), r);
        });

        rows.forEach((job: any) => {
          const jNo = String(job.job_no || job.JOB_NO || "").toUpperCase();
          const piInfo = piMap.get(jNo);
          const expense = Number(job.expense || job.EXPENSE || 0);
          const bookedAmt = Number(piInfo?.PI_BOOKED_AMOUNT || 0);
          job.pi_booked_amount = bookedAmt;
          job.pi_line_count = Number(piInfo?.PI_LINE_COUNT || 0);
          job.last_pi_no = piInfo?.LAST_PI_NO || null;
          job.is_fully_booked = expense > 0 && bookedAmt >= expense;
        });
      }
    } catch (piErr) {
      console.warn("frtJobActivityJobList: error fetching PI booking summary", piErr);
    }

    res.json({ success: true, data: rows, totalCount: rows.length });
  });
};

export const frtJobActivityGet = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = req.body.company_code ?? req.body.COMPANY_CODE;
    const prinCode = req.body.prin_code ?? req.body.PRIN_CODE;
    const jobNo = req.body.job_no ?? req.body.JOB_NO;

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
        p_company_code: companyCode,
        p_prin_code: prinCode,
        p_job_no: jobNo,
        p_header: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        p_lines: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const outBinds = result.outBinds as any;
    const headerRows = await rowsFromCursor(outBinds.p_header);
    const lines = await rowsFromCursor(outBinds.p_lines);

    // Fetch individual PI lines booked for this job
    let bookedPI: any[] = [];
    let salesInvoices: any[] = [];
    try {
      if (companyCode && jobNo) {
        const piRes = await connection.execute(
          `SELECT d.DOC_NO, d.DOC_DATE, d.AC_CODE, d.AMOUNT, d.REMARKS, d.JOB_NO, h.REF_NO AS DOC_REFNO
           FROM TR_AC_DETAIL d
           LEFT JOIN TR_AC_HEADER h ON h.COMPANY_CODE = d.COMPANY_CODE AND h.DOC_TYPE = d.DOC_TYPE AND h.DOC_NO = d.DOC_NO
           WHERE d.COMPANY_CODE = :cc AND d.DOC_TYPE = 'PI' AND (d.JOB_NO = :job_no OR d.REMARKS LIKE '%' || :job_no || '%')`,
          { cc: companyCode, job_no: jobNo },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        bookedPI = (piRes.rows as any[]) || [];

        const siRes = await connection.execute(
          `SELECT DISTINCT h.DOC_TYPE, h.DOC_NO, h.DOC_DATE, h.REF_NO, h.JOB_NO, h.PARTY_NAME
           FROM TR_AC_HEADER h
           WHERE h.COMPANY_CODE = :cc AND h.DOC_TYPE IN ('IV', 'SI')
             AND (
               TRIM(h.JOB_NO) = :job_no
               OR TRIM(h.REF_NO) = :job_no
               OR TRIM(h.REF_NO) IN (
                 SELECT TRIM(d.CONSOLIDATED_INVNO) FROM TN_INVOICE_DET d WHERE d.COMPANY_CODE = :cc AND d.JOB_NO = :job_no AND d.CONSOLIDATED_INVNO IS NOT NULL
               )
             )`,
          { cc: companyCode, job_no: jobNo },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        salesInvoices = (siRes.rows as any[]) || [];
      }
    } catch (piErr) {
      console.warn("frtJobActivityGet: error fetching booked PI/SI details", piErr);
    }

    res.json({ success: true, data: { header: headerRows[0] ?? null, lines, booked_pi: bookedPI, sales_invoices: salesInvoices } });
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

export const frtJobActivityPopulateQuotation = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_JOB_ACTIVITY_POPULATE_QTN(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_lines
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_prin_code: req.body.prin_code ?? req.body.PRIN_CODE,
        p_job_no: req.body.job_no ?? req.body.JOB_NO,
        p_lines: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const lines = await rowsFromCursor((result.outBinds as any).p_lines);
    res.json({
      success: true,
      message: lines.length
        ? `${lines.length} quotation activities populated for review`
        : "No new quotation activities are available",
      data: { lines },
      totalCount: lines.length,
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
    OTHER_SERVICES: stringValue(row.other_services ?? row.OTHER_SERVICES)?.substring(0, 50) || null,
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

  copyString(activity, row, "TX_CAT_CODE");
  copyString(activity, row, "TX_CAT_CODE_COST");
  for (let component = 1; component <= 4; component += 1) {
    copyString(activity, row, `TX_COMPNTCAT_CODE_${component}`);
    copyNumber(activity, row, `TX_COMPNT_PERC_${component}`);
    copyNumber(activity, row, `TX_COMPNT_AMT_${component}`);
    copyNumber(activity, row, `TX_COMPNT_LCURAMT_${component}`);
    copyString(activity, row, `TX_COMPNT_${component}_EXPMT`);
    copyString(activity, row, `TX_COMPNTCAT_CODE_${component}_COST`);
    copyNumber(activity, row, `TX_COMPNT_PERC_${component}_COST`);
    copyNumber(activity, row, `TX_COMPNT_AMT_${component}_COST`);
    copyNumber(activity, row, `TX_COMPNT_LCURAMT_${component}_COST`);
    copyString(activity, row, `TX_COMPNT_${component}_EXPMT_COST`);
  }

  return activity;
}

function sourceValue(row: Record<string, unknown>, key: string) {
  return row[key] ?? row[key.toLowerCase()];
}

function copyString(target: Record<string, unknown>, row: Record<string, unknown>, key: string) {
  target[key] = stringValue(sourceValue(row, key));
}

function copyNumber(target: Record<string, unknown>, row: Record<string, unknown>, key: string) {
  target[key] = numberValue(sourceValue(row, key));
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
