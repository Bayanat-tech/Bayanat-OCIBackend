import { Response } from 'express';
import oracledb from 'oracledb';
import constants from '../../../../helpers/constants';
import { RequestWithUser } from '../../../../interfaces/common.interface';
import { IUser } from '../../../../interfaces/user.interface';
import {
  chequePaymentSchema,
  LpoSchema,
  purchaseSchema,
  salesSchema,
  pettyCashSchema
} from '../../../../validation/finance/accounts/transaction.validation';
import TenantManager from '../../../../database/TenantManager';
import { getCurrentTenantId } from '../../../../middleware/tenantContext.middleware';

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId) tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenantId) throw Object.assign(new Error('Unable to determine tenant database'), { status: 400 });
  return TenantManager.getConnection(tenantId);
}

async function closeConn(conn?: oracledb.Connection) {
  if (conn) try { await conn.close(); } catch (e: any) { console.warn('Close conn error:', e); }
}
function normalize(rows: any[]): any[] {
  return rows.map(row =>
    Object.keys(row).reduce((acc: any, k) => { acc[k.toLowerCase()] = row[k]; return acc; }, {})
  );
}

function sendError(res: Response, err: any) {
  console.error(err);
  res.status(err.status ?? constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
    .json({ success: false, message: err.message ?? 'Error occurred' });
}

/** Safely trim any value to YYYY-MM-DD string or return null */
function toDate(v: any): string | null {
  if (!v) return null;
  return typeof v === 'string' ? v.substring(0, 10) : new Date(v).toISOString().substring(0, 10);
}

/** Normalize tax-exempt flags to single-character 'S'/'N' or null */
function expmtToChar(v: any): string | null {
  if (v == null) return null;
  if (typeof v === 'boolean') return v ? 'S' : 'N';
  const s = String(v).trim();
  if (s === '') return null;
  return s.substring(0, 1);
}
/**
 * Fetch round-off GL account from MS_DOCCONFIG per company+doc_type.
 */
async function getRoundOffAc(
  conn: oracledb.Connection,
  company_code: string,
  doc_type: string
): Promise<string> {
  const FALLBACK = '5030800009';
  try {
    const result: any = await conn.execute(
      `SELECT ROUND_OFF_AC
       FROM   WMSTST.MS_DOCCONFIG
       WHERE  company_code = :cc
         AND  doc_type     = :dt
         AND  ROWNUM       = 1`,
      { cc: company_code, dt: doc_type },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const rows: any[] = result?.rows ?? [];
    return (rows.length && rows[0].ROUND_OFF_AC)
      ? String(rows[0].ROUND_OFF_AC)
      : FALLBACK;
  } catch (e: any) {
    console.warn('getRoundOffAc fallback to static:', e?.message ?? e);
    return FALLBACK;
  }
}
/**
 * Calculate and append a round-off detail row when needed.
 */
function applyRoundOff(detail: any[], roundOffAc: string): any[] {
  if (!Array.isArray(detail) || detail.length === 0) return detail;

  // Skip if round-off row already exists
  if (detail.some(d =>
    String(d.ac_code) === roundOffAc ||
    String(d.remarks || '').toUpperCase().includes('ROUND OFF')
  )) {
    return detail;
  }

  // Sum base + tax
  const totalBase = detail.reduce((s, d) => s + Number(d.amount ?? 0), 0);
  const totalTax  = detail.reduce((s, d) => s + Number(d.tx_compnt_amt_1 ?? 0), 0);
  const grandTotal = totalBase + totalTax;

  // Round to nearest integer
  const rounded   = Math.round(grandTotal);
  const roundDiff = rounded - grandTotal;

  if (Math.abs(roundDiff) < 0.001) return detail;

  // Dynamic serial: next after max existing
  const maxSerial = detail.reduce((max, d) => Math.max(max, Number(d.serial_no ?? 0)), 0);

  const first = detail[0] ?? {};
  const roundRow: any = {
    serial_no:           maxSerial + 1,
    ac_code:             roundOffAc,
    header_ac_code:      first.header_ac_code ?? null,
    amount:              Math.abs(roundDiff),
    sign_ind:            roundDiff > 0 ? 1 : -1,
    curr_code:           first.curr_code  ?? null,
    ex_rate:             first.ex_rate    ?? 1,
    lcur_amount:         Math.abs(roundDiff),
    div_code:            first.div_code   ?? null,
    doc_date:            first.doc_date   ?? null,
    dept_code:           first.dept_code  ?? null,
    cheque_no:           first.cheque_no  ?? null,
    cheque_date:         first.cheque_date ?? null,
    cheque_desc:         first.cheque_desc ?? null,
    remarks:             'ROUND OFF',
    tx_compnt_amt_1:     0,
    tx_compnt_perc_1:    0,
    tx_compnt_lcuramt_1: 0,
    tx_compntcat_code_1: null,
    tx_cat_code:         null,
    tx_compnt_1_expmt:   'N',
  };

  console.log(
    `Round-off row: serial=${roundRow.serial_no}, ac=${roundOffAc}, diff=${roundDiff.toFixed(5)}`
  );

  return [...detail, roundRow];
}

async function spInsertDetailRows(
  conn: oracledb.Connection,
  company_code: string,
  doc_type: string,
  doc_no: string,
  detail: any[],
  login_user: string
) {
  if (!detail?.length) return;

  let headerAc: string | null = null;
  try {
    const hdr: any = await conn.execute(
      `SELECT ac_code FROM TR_AC_HEADER 
       WHERE company_code = :cc AND doc_type = :dt AND doc_no = :dn`,
      { cc: company_code, dt: doc_type, dn: doc_no },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const rows: any[] = hdr?.rows ?? [];
    if (rows.length) headerAc = rows[0].AC_CODE ?? rows[0].ac_code ?? null;
  } catch (e: any) {
    console.warn('Unable to fetch header ac_code:', e?.message ?? e);
  }

  const spSql = `BEGIN SP_INSERT_DETAIL_SINGLE(
      :company_code, :doc_type, :doc_no, :serial_no, :doc_date,
      :ac_code, :header_ac_code, :bank_ac_code, :remarks,
      :amount, :sign_ind, :curr_code, :ex_rate, :lcur_amount,
      :pdc_ind, :cheque_no, :cheque_date, :cheque_desc, :pdc_cleared_date,
      :cancelled, :job_no, :recon_ind, :recon_date, :dept_code,
      :qty, :price, :uom, :pdc_clear_jvno,
      :ref_doc_type, :ref_doc_no, :ref_doc_serial_no,
      :div_code, :tx_cat_code,
      :tx_compntcat_code_1, :tx_compntcat_code_2, :tx_compntcat_code_3, :tx_compntcat_code_4,
      :tx_compnt_perc_1, :tx_compnt_perc_2, :tx_compnt_perc_3, :tx_compnt_perc_4,
      :tx_compnt_amt_1, :tx_compnt_amt_2, :tx_compnt_amt_3, :tx_compnt_amt_4,
      :tx_compnt_lcuramt_1, :tx_compnt_lcuramt_2, :tx_compnt_lcuramt_3, :tx_compnt_lcuramt_4,
      :tx_compnt_1_expmt, :tx_compnt_2_expmt, :tx_compnt_3_expmt, :tx_compnt_4_expmt,
      :tx_tax_filed, :tx_tax_filed_dt, :tx_tax_filed_refno, :tx_compnt_hdisc_amt_1,
      :login_user
    ); END;`;

  const buildBind = (d: any) => ({
    company_code, doc_type, doc_no,
    serial_no: d.serial_no,
    doc_date: toDate(d.doc_date),
    ac_code: d.ac_code ?? null,
    header_ac_code: d.header_ac_code ?? headerAc ?? null,
    bank_ac_code: d.bank_ac_code ?? null,
    remarks: d.remarks ?? null,
    amount: d.amount ?? 0,
    sign_ind: d.sign_ind ?? 1,
    curr_code: d.curr_code ?? null,
    ex_rate: d.ex_rate ?? 1,
    lcur_amount: d.lcur_amount ?? d.amount ?? 0,
    pdc_ind: d.pdc_ind ?? null,
    cheque_no: d.cheque_no ?? null,
    cheque_date: toDate(d.cheque_date),
    cheque_desc: d.cheque_desc ?? null,
    pdc_cleared_date: toDate(d.pdc_cleared_date),
    cancelled: d.cancelled ?? 'N',
    job_no: d.job_no ?? null,
    recon_ind: d.recon_ind ?? null,
    recon_date: toDate(d.recon_date),
    dept_code: d.dept_code ?? null,
    qty: d.qty ?? null,
    price: d.price ?? null,
    uom: d.uom ?? null,
    pdc_clear_jvno: d.pdc_clear_jvno ?? null,
    ref_doc_type: d.ref_doc_type ?? null,
    ref_doc_no: d.ref_doc_no ?? null,
    ref_doc_serial_no: d.ref_doc_serial_no ?? null,
    div_code: d.div_code ?? null,
    tx_cat_code: d.tx_cat_code ?? null,
    tx_compntcat_code_1: d.tx_compntcat_code_1 ?? null,
    tx_compntcat_code_2: d.tx_compntcat_code_2 ?? null,
    tx_compntcat_code_3: d.tx_compntcat_code_3 ?? null,
    tx_compntcat_code_4: d.tx_compntcat_code_4 ?? null,
    tx_compnt_perc_1: d.tx_compnt_perc_1 ?? null,
    tx_compnt_perc_2: d.tx_compnt_perc_2 ?? null,
    tx_compnt_perc_3: d.tx_compnt_perc_3 ?? null,
    tx_compnt_perc_4: d.tx_compnt_perc_4 ?? null,
    tx_compnt_amt_1: d.tx_compnt_amt_1 ?? null,
    tx_compnt_amt_2: d.tx_compnt_amt_2 ?? null,
    tx_compnt_amt_3: d.tx_compnt_amt_3 ?? null,
    tx_compnt_amt_4: d.tx_compnt_amt_4 ?? null,
    tx_compnt_lcuramt_1: d.tx_compnt_lcuramt_1 ?? null,
    tx_compnt_lcuramt_2: d.tx_compnt_lcuramt_2 ?? null,
    tx_compnt_lcuramt_3: d.tx_compnt_lcuramt_3 ?? null,
    tx_compnt_lcuramt_4: d.tx_compnt_lcuramt_4 ?? null,
    tx_compnt_1_expmt: d.tx_compnt_1_expmt ?? null,
    tx_compnt_2_expmt: d.tx_compnt_2_expmt ?? null,
    tx_compnt_3_expmt: d.tx_compnt_3_expmt ?? null,
    tx_compnt_4_expmt: d.tx_compnt_4_expmt ?? null,
    tx_tax_filed: d.tx_tax_filed ?? null,
    tx_tax_filed_dt: toDate(d.tx_tax_filed_dt),
    tx_tax_filed_refno: d.tx_tax_filed_refno ?? null,
    tx_compnt_hdisc_amt_1: d.tx_compnt_hdisc_amt_1 ?? null,
    login_user,
  });

  // Split: never insert 9001 from client — SP_AC_TXN_CONTROL owns it
  const normalRows = detail.filter((d: any) => d.serial_no !== 9001);
  const reverseRows = detail.filter((d: any) => d.serial_no === 9001);

  for (const d of reverseRows) {
    await conn.execute(spSql, buildBind(d));
  }

  if (normalRows.length > 0) {
    await conn.executeMany(spSql, normalRows.map(buildBind));
  }
}

/** Calls SP_INSERT_INVOICE_SINGLE via executeMany — owns TR_AC_INVDETAIL INSERT */
async function spInsertInvoiceRows(
  conn: oracledb.Connection,
  company_code: string,
  doc_type: string,
  doc_no: string,
  div_code: string,
  curr_code: string,
  ex_rate: number,
  is_payment: boolean,
  invoice: any[],
  login_user: string
) {
  if (!invoice?.length) return;

  const flag = is_payment ? 'Y' : 'N';
  const isPurchaseOrSales = ['PI', 'PO', 'GRN', 'SI', 'SO'].includes(doc_type.toUpperCase());

  if (isPurchaseOrSales) {
    // For PI/SI etc — AGG SP handles everything from TR_AC_DETAIL
    // This path should not be reached since purchase/sales call their own AGG SP directly
    return;
  }

  // Cheque payment (BP, BR, CR, CP, CN, DN) — insert each invoice row individually
  await conn.executeMany(
    `BEGIN SP_INSERT_INVOICE_SINGLE(
      :company_code, :doc_type, :doc_no,
      :serial_no, :dtl_sr_no, :doc_date,
      :ac_code, :inv_no, :inv_date, :due_date,
      :chq_no, :chq_date, :chq_bank,
      :amount, :lcur_amount,
      :curr_code, :ex_rate,
      :div_code, :is_payment,
      :amount_origin, :login_user
    ); END;`,
    invoice.map((inv: any, idx: number) => ({
      company_code,
      doc_type,
      doc_no,
      serial_no:      inv.serial_no      ?? (idx + 1),
      dtl_sr_no:      inv.dtl_sr_no      ?? 1,
      doc_date:       toDate(inv.doc_date)   ?? toDate(new Date().toISOString()),
      ac_code:        inv.ac_code         ?? null,
      inv_no:         inv.inv_no          ?? doc_no,
      inv_date:       toDate(inv.inv_date)   ?? null,
      due_date:       toDate(inv.due_date)   ?? null,
      chq_no:         inv.chq_no          ?? null,
      chq_date:       toDate(inv.chq_date)   ?? null,
      chq_bank:       inv.chq_bank        ?? null,
      amount:         Number(inv.amount   ?? 0),
      lcur_amount:    Math.abs(Number(inv.lcur_amount ?? inv.amount ?? 0)),
      curr_code:      inv.curr_code       ?? curr_code ?? null,
      ex_rate:        Number(inv.ex_rate  ?? ex_rate ?? 1),
      div_code:       inv.div_code        ?? div_code ?? null,
      is_payment:     flag,
      amount_origin:  inv.amount_origin   != null
                        ? Number(inv.amount_origin)
                        : Number(inv.amount ?? 0),
      login_user,
    }))
  );
}

/** Calls SP_INSERT_JOB_SINGLE via executeMany — owns TR_AC_JOBDETAIL INSERT */
async function spInsertJobRows(
  conn: oracledb.Connection,
  company_code: string,
  doc_type: string,
  doc_no: string,
  curr_code: string | undefined,
  job: any[],
  login_user: string
) {
  if (!job?.length) return;
  await conn.executeMany(
    `BEGIN SP_INSERT_JOB_SINGLE(
      :company_code, :doc_type, :doc_no,
      :serial_no, :dtl_sr_no, :doc_date,
      :ac_code, :job_no, :doc_refno, :doc_refno_2,
      :amount, :sign_ind, :lcur_amount,
      :curr_code, :ex_rate, :div_code, :login_user
    ); END;`,
    job.map((j: any) => ({
      company_code,
      doc_type: j.doc_type ?? doc_type,
      doc_no,
      serial_no: j.serial_no,
      dtl_sr_no: j.dtl_sr_no,
      doc_date: toDate(j.doc_date),
      ac_code: j.ac_code,
      job_no: j.job_no,
      doc_refno: j.doc_refno ?? null,
      doc_refno_2: j.doc_refno_2 ?? null,
      amount: j.amount,
      sign_ind: j.sign_ind,
      lcur_amount: j.lcur_amount,
      curr_code: j.curr_code ?? curr_code ?? null,
      ex_rate: j.ex_rate ?? 1,
      div_code: j.div_code,
      login_user,
    }))
  );
}

/** Calls SP_INSERT_EXPENSE_SINGLE via executeMany — owns TR_AC_EXPDETAIL INSERT */
async function spInsertExpenseRows(
  conn: oracledb.Connection,
  company_code: string,
  doc_type: string,
  doc_no: string,
  curr_code: string | undefined,
  expense: any[],
  login_user: string
) {
  if (!expense?.length) return;
  const sql = `BEGIN SP_INSERT_EXPENSE_SINGLE(
      :company_code, :doc_type, :doc_no,
      :serial_no, :dtl_sr_no, :doc_date,
      :ac_code, :exp_type_code, :exp_subtype_code, :exp_code,
      :job_no, :amount, :sign_ind, :lcur_amount,
      :curr_code, :ex_rate, :div_code, :login_user
    ); END;`;

  const binds = expense.map((e: any) => ({
    company_code,
    doc_type: e.doc_type ?? doc_type,
    // Keep full header doc_no (may include prefix like 'BP') so expense rows store the same display value
    doc_no: typeof doc_no === 'string' ? doc_no : String(doc_no),
    serial_no: e.serial_no == null || e.serial_no === '' ? null : Number(e.serial_no),
    dtl_sr_no: e.dtl_sr_no == null || e.dtl_sr_no === '' ? null : Number(e.dtl_sr_no),
    doc_date: toDate(e.doc_date),
    ac_code: e.ac_code == null || e.ac_code === '' ? null : String(e.ac_code),
    exp_type_code: e.exp_type_code == null || e.exp_type_code === '' ? null : String(e.exp_type_code),
    exp_subtype_code: e.exp_subtype_code == null || e.exp_subtype_code === '' ? null : String(e.exp_subtype_code),
    exp_code: e.exp_code == null || e.exp_code === '' ? null : String(e.exp_code),
    job_no: e.job_no == null || e.job_no === '' ? null : String(e.job_no),
    amount: e.amount == null || e.amount === '' ? 0 : Number(e.amount),
    sign_ind: e.sign_ind == null || e.sign_ind === '' ? 1 : Number(e.sign_ind),
    lcur_amount: e.lcur_amount == null || e.lcur_amount === '' ? (e.amount == null || e.amount === '' ? 0 : Number(e.amount)) : Number(e.lcur_amount),
    curr_code: e.curr_code ?? curr_code ?? null,
    ex_rate: e.ex_rate == null || e.ex_rate === '' ? 1 : Number(e.ex_rate),
    div_code: e.div_code == null || e.div_code === '' ? null : String(e.div_code),
    login_user,
  }));

  try {
    console.log('spInsertExpenseRows binds:', JSON.stringify(binds, null, 2));
    const bindDefs = {
      company_code: { type: oracledb.STRING, maxSize: 10 },
      doc_type: { type: oracledb.STRING, maxSize: 5 },
      doc_no: { type: oracledb.STRING, maxSize: 50 },
      serial_no: { type: oracledb.NUMBER },
      dtl_sr_no: { type: oracledb.NUMBER },
      doc_date: { type: oracledb.STRING, maxSize: 10 },
      ac_code: { type: oracledb.STRING, maxSize: 20 },
      exp_type_code: { type: oracledb.STRING, maxSize: 10 },
      exp_subtype_code: { type: oracledb.STRING, maxSize: 10 },
      exp_code: { type: oracledb.STRING, maxSize: 10 },
      job_no: { type: oracledb.STRING, maxSize: 20 },
      amount: { type: oracledb.NUMBER },
      sign_ind: { type: oracledb.NUMBER },
      lcur_amount: { type: oracledb.NUMBER },
      curr_code: { type: oracledb.STRING, maxSize: 10 },
      ex_rate: { type: oracledb.NUMBER },
      div_code: { type: oracledb.STRING, maxSize: 10 },
      login_user: { type: oracledb.STRING, maxSize: 50 },
    };
    await conn.executeMany(sql, binds, { bindDefs });
  } catch (err) {
    console.error('spInsertExpenseRows executeMany error, binds:', JSON.stringify(binds, null, 2));
    throw err;
  }
}

/** Calls SP_INSERT_FILE_SINGLE via executeMany — owns UPLOADED_FILES_DLTS INSERT */
async function spInsertFiles(
  conn: oracledb.Connection,
  doc_type: string,
  doc_no: string,
  files: any[]
) {
  if (!files?.length) return;
  await conn.executeMany(
    `BEGIN SP_INSERT_FILE_SINGLE(:request_number, :file_name); END;`,
    files.map((f: any) => ({
      request_number: doc_type + doc_no,
      file_name: f.file_name,
    }))
  );
}

async function spInsertAllChildren(
  conn: oracledb.Connection,
  company_code: string,
  doc_type: string,
  doc_no: string,
  div_code: string,
  curr_code: string,
  ex_rate: number,
  is_payment: boolean,
  login_user: string,
  detail: any[],
  children: { invoice?: any[]; job?: any[]; expense?: any[] },
  files: any[]
) {
  const roundOffAc = await getRoundOffAc(conn, company_code, doc_type);
  const detailWithRounding = applyRoundOff(detail, roundOffAc);
  await spInsertDetailRows(conn, company_code, doc_type, doc_no, detailWithRounding, login_user);
  await spInsertInvoiceRows(conn, company_code, doc_type, doc_no, div_code, curr_code, ex_rate, is_payment, children?.invoice ?? [], login_user);
  await spInsertJobRows(conn, company_code, doc_type, doc_no, curr_code, children?.job ?? [], login_user);
  await spInsertExpenseRows(conn, company_code, doc_type, doc_no, curr_code, children?.expense ?? [], login_user);
  await spInsertFiles(conn, doc_type, doc_no, files ?? []);
  await conn.commit();
}

export const getDefaultTransactionDetails = async (req: RequestWithUser, res: Response) => {
  let conn: oracledb.Connection | undefined;
  try {
    const { doc_id, isEditMode } = req.query;
    conn = await getConn(req);
    const view = isEditMode === 'false' ? 'VW_DEFAULT_TRANSACTION_DETAILS' : 'VW_DEFAULT_TRANSACTION_EDIT';
    const result = await conn.execute(
      `SELECT * FROM ${view} WHERE company_code = :cc AND doc_id = :id`,
      { cc: req.user.company_code, id: doc_id as string },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    if (!result.rows?.length) { res.status(500).json({ success: false }); return; }
    res.json({ success: true, data: normalize(result.rows)[0] });
  } catch (err) { sendError(res, err); } finally { await closeConn(conn); }
};

export const getCompanyInfo = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    conn = await getConn(req);
    const result = await conn.execute(
      `SELECT * FROM VW_COMPANY_INFO WHERE company_code = :cc`,
      { cc: req.user.company_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    if (!result.rows?.length) { res.status(500).json({ success: false }); return; }

    // Normalize uppercase keys to lowercase
    const row = result.rows[0] as Record<string, any>;
    const normalizedData = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key.toLowerCase(), value])
    );

    res.json({ success: true, data: normalizedData });
  } catch (err) { sendError(res, err); } finally { await closeConn(conn); }
};

export const getChequePaymentHeader = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    conn = await getConn(req);
    const result = await conn.execute(
      `SELECT * FROM VW_CHQ_PAYMENT_HEADER
       WHERE company_code = :cc AND doc_no = :dn AND doc_type = :dt`,
      { cc: req.user.company_code, dn: req.params.doc_no, dt: req.query.doc_type },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const row = result.rows?.[0] || null;
    res.json({ success: true, data: row ? normalize([row])[0] : null });
  } catch (err) { sendError(res, err); } finally { await closeConn(conn); }
};

export const getPurchaseHeader = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    conn = await getConn(req);
    const result = await conn.execute(
      `SELECT * FROM VW_PURCHASE_HEADER
       WHERE company_code = :cc AND doc_no = :dn AND doc_type = :dt`,
      { cc: req.user.company_code, dn: req.params.doc_no, dt: req.query.doc_type },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const row = result.rows?.[0] || null;
    res.json({ success: true, data: row ? normalize([row])[0] : null });
  } catch (err) { sendError(res, err); } finally { await closeConn(conn); }
};

export const getChequePaymentDetail = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    conn = await getConn(req);
    const result = await conn.execute(
      `SELECT * FROM VW_TR_AC_DETAIL_DATA
       WHERE company_code = :cc AND TO_CHAR(doc_no) = :dn
         AND div_code = :dc AND doc_type = :dt
       ORDER BY serial_no`,
      { cc: req.user.company_code, dn: String(req.params.doc_no), dc: req.query.div_code, dt: req.query.doc_type },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.json({ success: true, data: normalize(result.rows || []) });
  } catch (err) { sendError(res, err); } finally { await closeConn(conn); }
};

export const getTransactionChildren = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    conn = await getConn(req);
    const p = { cc: req.user.company_code, dn: req.params.doc_no, dc: req.query.div_code, dt: req.query.doc_type };
    const where = `WHERE company_code = :cc AND TO_CHAR(doc_no) = :dn
                     AND div_code = :dc AND doc_type = :dt ORDER BY serial_no, dtl_sr_no`;
    const [inv, job, exp] = await Promise.all([
      conn.execute(`SELECT * FROM VW_TXN_INVOICE_CHILDREN ${where}`, p, { outFormat: oracledb.OUT_FORMAT_OBJECT }),
      conn.execute(`SELECT * FROM VW_TXN_JOB_CHILDREN     ${where}`, p, { outFormat: oracledb.OUT_FORMAT_OBJECT }),
      conn.execute(`SELECT * FROM VW_TXN_EXPENSE_CHILDREN ${where}`, p, { outFormat: oracledb.OUT_FORMAT_OBJECT }),
    ]);
    const invRows = normalize(inv.rows || []);
    const jobRows = normalize(job.rows || []);
    const expRows = normalize(exp.rows || []).map((r: any) => ({
      ...r,
      // Child tables store numeric DOC_NO; provide a display field combining doc_type + doc_no
      display_doc_no: (r.doc_type ?? '') + String(r.doc_no ?? ''),
    }));

    res.json({
      success: true, data: {
        invoice: invRows,
        job: jobRows,
        expense: expRows,
      }
    });
  } catch (err) { sendError(res, err); } finally { await closeConn(conn); }
};

export const getChildTableName = async (req: RequestWithUser, res: Response) => {
  let conn: oracledb.Connection | undefined;
  try {
    const { ac_code } = req.params;
    if (!ac_code) { res.status(400).json({ success: false, message: constants.MESSAGES.BAD_REQUEST }); return; }
    conn = await getConn(req);
    const result = await conn.execute(
      `SELECT * FROM VW_CHILD_TABLE_NAME WHERE company_code = :cc AND ac_code = :ac`,
      { cc: req.user.company_code, ac: ac_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    if (!result.rows?.length) { res.status(404).json({ success: false, message: constants.MESSAGES.NOT_FOUND }); return; }
    const row: any = result.rows[0];
    let data: { table: string; code: string } | null = null;
    if (row.L4_BILL === 'Y') data = { table: 'invoice', code: '' };
    else if (row.L4_JOB === 'Y') data = { table: 'job', code: '' };
    else if (row.EXP_TYPE_CODE != null && row.EXP_SUBTYPE_CODE != null) data = { table: 'expense', code: row.EXP_TYPE_CODE };
    if (!data) throw new Error('Does not have a child table');
    res.json({ success: true, data });
  } catch (err: any) { sendError(res, err); } finally { await closeConn(conn); }
};

export const getChequeDetail = async (req: RequestWithUser, res: Response) => {
  let conn: oracledb.Connection | undefined;
  try {
    conn = await getConn(req);
    const result = await conn.execute(
      `SELECT * FROM VW_BANK_LAST_CHEQUE WHERE company_code = :cc AND ac_code = :ac`,
      { cc: req.user.company_code, ac: req.query.ac_code as string },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const row: any = result.rows?.[0] || null;
    res.json({ success: true, data: row ? { last_cheque_no: row.LAST_CHEQUE_NO } : null });
  } catch (err) { sendError(res, err); } finally { await closeConn(conn); }
};

export const getInvoiceOutstandingBalances = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { inv_nos, div_code } = req.query;
    if (!inv_nos || !div_code) { res.status(400).json({ success: false, message: 'inv_nos and div_code are required' }); return; }
    const list = (inv_nos as string).split(',').map(n => n.trim()).filter(Boolean);
    if (!list.length) { res.status(400).json({ success: false, message: 'At least one invoice number is required' }); return; }
    conn = await getConn(req);
    const placeholders = list.map((_, i) => `:inv${i}`).join(',');
    const binds: Record<string, any> = { cc: req.user.company_code, dc: div_code };
    list.forEach((n, i) => (binds[`inv${i}`] = n));
    const result = await conn.execute(
      `SELECT * FROM VW_INVOICE_OUTSTANDING WHERE company_code = :cc AND div_code = :dc AND inv_no IN (${placeholders})`,
      binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const found: Record<string, any> = {};
    (result.rows || []).forEach((r: any) => {
      const out = Math.max(0, Number(r.OUTSTANDING_AMOUNT || 0));
      const org = Number(r.ORIGINAL_AMOUNT || 0);
      const pd = Number(r.PAID_AMOUNT || 0);
      found[r.INV_NO] = { inv_no: r.INV_NO, original_amount: org, paid_amount: pd, outstanding_amount: out, payment_percentage: org > 0 ? Math.round((pd / org) * 10000) / 100 : 0, is_fully_paid: out <= 0.01 };
    });
    const balances = list.map(inv => found[inv] ?? { inv_no: inv, original_amount: 0, paid_amount: 0, outstanding_amount: 0, payment_percentage: 0, is_fully_paid: true, error: 'Invoice not found' });
    res.json({ success: true, data: { balances, count: balances.length } });
  } catch (err) { sendError(res, err); } finally { await closeConn(conn); }
};

export const getDocAccounts = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { doc_id, hdr_dtl, div_code } = req.query;
    if (!doc_id || !hdr_dtl || !div_code) { res.status(400).json({ success: false, message: 'doc_id, hdr_dtl and div_code are required' }); return; }
    conn = await getConn(req);
    const result = await conn.execute(
      `BEGIN SP_GET_DOC_ACCOUNTS(:cc, :id, :hd, :dc, :cur); END;`,
      { cc: req.user.company_code, id: doc_id, hd: hdr_dtl, dc: div_code, cur: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR } },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const cursor = (result.outBinds as any).cur;
    const rows = await cursor.getRows(10000);
    await cursor.close();
    res.json({ success: true, data: rows });
  } catch (err) { sendError(res, err); } finally { await closeConn(conn); }
};

export const getLpoDoc = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    conn = await getConn(req);

    // ── Pagination ───────────────────────────────────────────────
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 10);
    const offset = (page - 1) * limit;

    // ── Base WHERE ───────────────────────────────────────────────
    let whereClause = `WHERE company_code = :company_code`;
    const binds: any = {
      company_code: req.user.company_code,
    };

    // ── div_code filter ──────────────────────────────────────────
    if (req.query.div_code) {
      whereClause += ` AND div_code = :div_code`;
      binds.div_code = req.query.div_code;
    }

    // ── Year / FY / Date Range filter ────────────────────────────
    if (req.query.from_date && req.query.to_date) {
      whereClause += ` AND doc_date BETWEEN TO_DATE(:fd, 'YYYY-MM-DD') AND TO_DATE(:td, 'YYYY-MM-DD')`;
      binds.fd = req.query.from_date;
      binds.td = req.query.to_date;
    } else if (req.query.fy_period) {
      whereClause += ` AND fy_period = :fy_period`;
      binds.fy_period = req.query.fy_period;
    } else if (req.query.year) {
      whereClause += ` AND EXTRACT(YEAR FROM doc_date) = :yr`;
      binds.yr = Number(req.query.year);
    } else {
      // Default → current calendar year
      whereClause += ` AND EXTRACT(YEAR FROM doc_date) = :yr`;
      binds.yr = new Date().getFullYear();
    }

    // ── Search filter ────────────────────────────────────────────
    const search = req.query.search as string;
    if (search?.trim()) {
      whereClause += `
        AND (
          UPPER(doc_no)          LIKE UPPER(:search)
          OR UPPER(party_name)   LIKE UPPER(:search)
          OR UPPER(ref_no)       LIKE UPPER(:search)
          OR UPPER(div_code)     LIKE UPPER(:search)
          OR UPPER(invoice_number) LIKE UPPER(:search)
        )
      `;
      binds.search = `%${search.trim()}%`;
    }

    // ── Specific field filters ────────────────────────────────────
    const allowedFields = [
      "doc_no", "doc_type", "div_code", "ac_code",
      "ref_no", "party_name", "final_approved",
      "last_action", "invoice_number", "canceled",
    ];
    allowedFields.forEach((field) => {
      if (req.query[field]) {
        const safeParam = `f_${field}`;
        whereClause += ` AND UPPER(${field}) = UPPER(:${safeParam})`;
        binds[safeParam] = req.query[field];
      }
    });

    // ── COUNT query ───────────────────────────────────────────────
    const countResult = await conn.execute(
      `SELECT COUNT(*) AS TOTAL_COUNT
       FROM VW_AC_LPO_HEADER_DETAIL
       ${whereClause}`,
      binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    console.log("LPO count result:", countResult);

    const countRow = countResult.rows?.[0] as { TOTAL_COUNT?: number };
    const totalCount = countRow?.TOTAL_COUNT ?? 0;
    const totalPages = Math.ceil(totalCount / limit);

    // ── DATA query with pagination ────────────────────────────────
    const dataResult = await conn.execute(
      `SELECT *
       FROM VW_AC_LPO_HEADER_DETAIL
       ${whereClause}
       ORDER BY doc_date DESC, doc_no DESC
       OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
      { ...binds, offset, limit },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    console.log("LPO data result:", dataResult.rows?.length, "rows");

    const data = (dataResult.rows || []).map((row: any) => {
      const mapped: any = {};
      Object.keys(row).forEach((k) => {
        mapped[k.toLowerCase()] = row[k];
      });
      return mapped;
    });

    res.json({
      success: true,
      data,
      pagination: {
        total: totalCount,
        total_pages: totalPages,
        page,
        limit,
        has_next: page < totalPages,
        has_prev: page > 1,
      },
    });
  } catch (err) { sendError(res, err); } finally { await closeConn(conn); }
};

// ── GET SINGLE LPO HEADER ────────────────────────────────────────────────────
export const getLPOHeader = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { doc_no } = req.params;
    const { doc_type } = req.query;

    if (!doc_no || !doc_type) {
      res.status(400).json({ success: false, message: 'doc_no and doc_type are required' });
      console.log('Missing required parameters:', { doc_no, doc_type });
      return;
    }

    conn = await getConn(req);

    const result = await conn.execute(
      `SELECT *
       FROM   VW_AC_LPO_HEADER_DETAIL
       WHERE  company_code = :cc
         AND  doc_no       = :dn
         AND  doc_type     = :dt
        ORDER BY doc_no DESC`,
      {
        cc: req.user.company_code,
        dn: String(doc_no),
        dt: doc_type,
        // ...(div_code && { dc: div_code }),
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!result.rows?.length) {
      res.status(404).json({ success: false, message: 'LPO document not found' });
      return;
    }

    const row = normalize([result.rows[0] as any])[0];
    res.json({ success: true, data: row });

  } catch (err) { sendError(res, err); } finally { await closeConn(conn); }
};


// ── GET LPO DETAIL ─────────────────────────────────────────────────────
export const getLpoDetail = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { doc_no } = req.params;
    const { doc_type } = req.query;

    // if (!doc_no || !doc_type ) {
    //   res.status(400).json({
    //     success: false,
    //     message: 'doc_no and doc_type are required',
    //   });
    //   console.log('Detailssssssssssss:', { doc_no, doc_type });
    //   return;
    // }

    conn = await getConn(req);

    const result = await conn.execute(
      `SELECT
          d.company_code,
          d.doc_type,
          d.doc_no,
          d.serial_no,
          d.doc_date,
          d.ac_code,
          m.ac_name,
          d.header_ac_code,
          d.remarks,
          d.amount,
          d.sign_ind,
          d.curr_code,
          d.ex_rate,
          d.lcur_amount,
          d.job_no,
          d.dept_code,
          d.qty,
          d.price,
          d.uom,
          d.prod_code,
          d.qty_rcv,
          d.amount_rcv,
          d.other_remarks,
          d.item_remark,
          d.div_code,
          d.tx_cat_code,
          d.tx_compntcat_code_1,
          d.tx_compntcat_code_2,
          d.tx_compntcat_code_3,
          d.tx_compntcat_code_4,
          d.tx_compnt_perc_1,
          d.tx_compnt_perc_2,
          d.tx_compnt_perc_3,
          d.tx_compnt_perc_4,
          d.tx_compnt_amt_1,
          d.tx_compnt_amt_2,
          d.tx_compnt_amt_3,
          d.tx_compnt_amt_4,
          d.tx_compnt_lcuramt_1,
          d.tx_compnt_lcuramt_2,
          d.tx_compnt_lcuramt_3,
          d.tx_compnt_lcuramt_4,
          d.tx_compnt_1_expmt,
          d.tx_compnt_2_expmt,
          d.tx_compnt_3_expmt,
          d.tx_compnt_4_expmt,
          d.original_qty,
          d.edit_user,
          d.create_user
       FROM   TR_AC_LPO_DETAIL  d
       LEFT JOIN wmstst.ms_accodes m
              ON m.ac_code = d.ac_code
       WHERE  d.company_code        = :cc
         AND  d.doc_no              = :dn
         AND  d.doc_type            = :dt
         AND  NVL(d.cancelled, 'N') = 'N'
       ORDER BY d.serial_no`,
      {
        cc: req.user.company_code,
        dn: String(doc_no),
        dt: doc_type
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    res.json({
      success: true,
      data: normalize(result.rows as any[] || []),
      count: result.rows?.length ?? 0,
    });
    console.log('Fetched LPO details:', result.rows?.length ?? 0, 'rows');

  } catch (err) { sendError(res, err); } finally { await closeConn(conn); }
};


// ── GET LPO PRINT (header + details + company) ─────────────────────────────
export const getLPOPrint = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { doc_no } = req.params;
    const { doc_type } = req.query;
    if (!doc_no || !doc_type) { res.status(400).json({ success: false, message: 'doc_no and doc_type are required' }); return; }
    conn = await getConn(req);

    // header
    const hdr = await conn.execute(
      `SELECT * FROM VW_AC_LPO_HEADER_DETAIL WHERE company_code = :cc AND doc_no = :dn AND doc_type = :dt`,
      { cc: req.user.company_code, dn: String(doc_no), dt: doc_type },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    if (!hdr.rows || hdr.rows.length === 0) { res.status(404).json({ success: false, message: 'LPO document not found' }); return; }
    const header = normalize([hdr.rows[0] as any])[0];

    // details
    const det = await conn.execute(
      `SELECT d.company_code,d.doc_type,d.doc_no,d.serial_no,d.doc_date,d.ac_code,m.ac_name,d.header_ac_code,d.remarks,d.amount,d.sign_ind,d.curr_code,d.ex_rate,d.lcur_amount,d.job_no,d.dept_code,d.qty,d.price,d.uom,d.prod_code,d.qty_rcv,d.amount_rcv,d.other_remarks,d.item_remark,d.div_code,d.tx_cat_code,d.tx_compntcat_code_1,d.tx_compntcat_code_2,d.tx_compntcat_code_3,d.tx_compntcat_code_4,d.tx_compnt_perc_1,d.tx_compnt_perc_2,d.tx_compnt_perc_3,d.tx_compnt_perc_4,d.tx_compnt_amt_1,d.tx_compnt_amt_2,d.tx_compnt_amt_3,d.tx_compnt_amt_4,d.tx_compnt_lcuramt_1,d.tx_compnt_lcuramt_2,d.tx_compnt_lcuramt_3,d.tx_compnt_lcuramt_4,d.tx_compnt_1_expmt,d.tx_compnt_2_expmt,d.tx_compnt_3_expmt,d.tx_compnt_4_expmt FROM TR_AC_LPO_DETAIL d LEFT JOIN WMSTST.MS_ACCODES m ON m.ac_code = d.ac_code WHERE d.company_code = :cc AND d.doc_no = :dn AND d.doc_type = :dt AND NVL(d.cancelled,'N') = 'N' ORDER BY d.serial_no`,
      { cc: req.user.company_code, dn: String(doc_no), dt: doc_type },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const details = normalize(det.rows as any[] || []);

    // company info
    const comp = await conn.execute(
      `SELECT * FROM MS_COMPANYINFO WHERE company_code = :cc`,
      { cc: req.user.company_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const company = (comp.rows && comp.rows[0]) ? (comp.rows[0] as any) : null;

    res.json({ success: true, data: { header, details, company } });
  } catch (err) { sendError(res, err); } finally { await closeConn(conn); }
};

export const createBulkTransactionDocument = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const user: IUser = req.user;
    const { error } = chequePaymentSchema(req.body, user.company_code, true);
    if (error) { res.status(400).json({ success: false, message: error.message }); return; }
    conn = await getConn(req);
    await conn.executeMany(
      `BEGIN SP_BULK_INSERT_HEADER_SINGLE(:cc, :dn, :dt, :dc, :dd, :ac, :lu); END;`,
      (req.body as any[]).map((d: any) => ({
        cc: user.company_code, dn: d.doc_no, dt: d.doc_type,
        dc: d.div_code, dd: toDate(d.doc_date), ac: d.ac_code ?? null,
        lu: user.loginid,
      }))
    );
    await conn.commit();
    res.json({ success: true, message: 'Document ' + constants.MESSAGES.IMPORTED_SUCCESSFULLY });
  } catch (err: any) {
    if (conn) try { await conn.rollback(); } catch { }
    sendError(res, err);
  } finally { await closeConn(conn); }
};

export const createChequePaymentDocument = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    // If client incorrectly passes doc_no as 0 (merge/artifact), remove it so DB generates a new doc_no
    if (typeof req.body.doc_no === 'number') req.body.doc_no = String(req.body.doc_no);
    if (req.body.doc_no === 0 || req.body.doc_no === '0') delete req.body.doc_no;
    console.log('createChequePaymentDocument payload preview:', { doc_no: req.body.doc_no, doc_type: req.body.doc_type, div_code: req.body.div_code });
    // Remove transient UI fields that Joi schema doesn't allow
    if (req.body.div_name !== undefined) delete req.body.div_name;
    // Normalize children.invoice entries so required fields exist for validation
    if (req.body.children && Array.isArray(req.body.children.invoice)) {
      const allowedInvoiceFields = [
        'doc_date', 'ac_code', 'IsDeletable', 'serial_no', 'dtl_sr_no', 'doc_no', 'doc_type', 'div_code',
        'company_code', 'sign_ind', 'inv_no', 'inv_date', 'due_date', 'chq_date', 'chq_bank', 'chq_no',
        'inv_amt', 'indicator_origin', 'amount_origin', 'c_bal_amt_org', 'amount', 'lcur_amount',
        'curr_code', 'ex_rate', 'c_curr_amt', 'ref_no'
      ];
      req.body.children.invoice = req.body.children.invoice.map((inv: any) => {
        const out: any = {};
        for (const k of allowedInvoiceFields) {
          if (inv[k] !== undefined) out[k] = inv[k];
        }
        out.company_code = out.company_code ?? req.user.company_code;
        // coerce numeric doc_no to string if present
        if (out.doc_no == null) out.doc_no = '';
        else if (typeof out.doc_no === 'number') out.doc_no = String(out.doc_no);
        return out;
      });
    }
    // Normalize children.job entries
    if (req.body.children && Array.isArray(req.body.children.job)) {
      req.body.children.job = req.body.children.job.map((j: any) => ({
        ...j,
        company_code: j.company_code ?? req.user.company_code,
        ac_code: j.ac_code ?? req.body.ac_code ?? (Array.isArray(req.body.detail) && req.body.detail[0]?.ac_code) ?? null,
      }));
    }
    // Normalize children.expense entries
    if (req.body.children && Array.isArray(req.body.children.expense)) {
      req.body.children.expense = req.body.children.expense.map((e: any) => ({
        ...e,
        company_code: e.company_code ?? req.user.company_code,
        ac_code: e.ac_code ?? req.body.ac_code ?? (Array.isArray(req.body.detail) && req.body.detail[0]?.ac_code) ?? null,
      }));
    }
    if (req.body.div_name !== undefined) delete req.body.div_name;
    // Normalize detail entries so required fields exist for validation
    if (Array.isArray(req.body.detail)) {
      req.body.detail = req.body.detail.map((d: any) => ({
        ...d,
        company_code: d.company_code ?? req.user.company_code,
        doc_no: d.doc_no == null ? '' : (typeof d.doc_no === 'number' ? String(d.doc_no) : d.doc_no),
      }));
    }
    const { error } = chequePaymentSchema(req.body);
    if (error) { res.status(400).json({ success: false, message: error.message }); return; }

    const { detail = [], children = {}, files = [], ...h } = req.body;
    conn = await getConn(req);

    // Step 1 — call header SP, get generated doc_no
    const hdrResult = await conn.execute(
      `BEGIN SP_CREATE_CHQ_HEADER(
        :cc, :dv, :dt, :dd, :ac, :bk, :rn, :rd, :rm,:pa , :pp,:pf,
        :cu, :er, :cn, :cd, :ap, :cb, :pt, :ln, :ld, :lu,
        :doc_no
      ); END;`,
      {
        cc: req.user.company_code, dv: h.div_code,
        dt: h.doc_type, dd: toDate(h.doc_date),
        ac: h.ac_code ?? null, bk: h.bank_ac_code ?? null,
        rn: h.ref_no ?? null, rd: toDate(h.ref_date),
        rm: h.remarks ?? null, 
        pa: h.party_address ?? null,
        pp: h.party_phone ?? null, pf: h.party_fax ?? null,
        cu: h.curr_code ?? null,
        er: h.ex_rate ?? null, cn: h.cheque_no ?? null,
        cd: toDate(h.cheque_date), ap: h.ac_payee ?? null,
        cb: h.cheque_bank ?? null, pt: h.payment_terms ?? null,
        ln: h.lpo_no ?? null, ld: toDate(h.lpo_date),
        lu: req.user.loginid,
        doc_no: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 50 },
      }
    );

    const doc_no = (hdrResult.outBinds as any).doc_no;
    if (!doc_no) throw new Error('Failed to generate document number');

    // Step 2 — insert all children via _SINGLE SPs, then commit
    const isPayment = ['BP', 'BR', 'CR', 'CP', 'CN', 'DN'].includes(h.doc_type);
    const enrichedDetail = (detail ?? []).map((d: any) => ({
      ...d,
      cheque_no: d.cheque_no ?? h.cheque_no ?? null,
      cheque_date: d.cheque_date ?? h.cheque_date ?? null,
      chq_no: d.chq_no ?? d.cheque_no ?? h.cheque_no ?? null,
      chq_date: d.chq_date ?? d.cheque_date ?? h.cheque_date ?? null,
      cheque_desc: d.cheque_desc ?? h.remarks ?? null,
    }));

    await spInsertAllChildren(conn, req.user.company_code, h.doc_type, doc_no, h.div_code, h.curr_code, h.ex_rate, isPayment, req.user.loginid, enrichedDetail, children, files);

    // Rebuild txn control row on same connection and commit
    await conn.execute(
      `BEGIN SP_AC_TXN_CONTROL(:cc, :dt, :dn, :lu); END;`,
      { cc: req.user.company_code, dt: h.doc_type, dn: doc_no, lu: req.user.loginid }
    );
    await conn.commit();

    console.log(`Created document ${h.doc_type} ${doc_no} with ${detail.length} detail rows, ${children.invoice?.length ?? 0} invoice rows, ${children.job?.length ?? 0} job rows and ${children.expense?.length ?? 0} expense rows`);

    res.status(201).json({
      success: true,
      message: constants.MESSAGES.CREATED_SUCCESSFULLY,
      data: { doc_no, doc_type: h.doc_type }
    });
  } catch (err: any) {
    if (conn) try { await conn.rollback(); } catch { }
    sendError(res, err);
  } finally { await closeConn(conn); }
};

export const createChequePaymentStoreProcess = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    await callSpAcTxnControl(req.user.company_code, req.body.doc_type, req.body.doc_no, req.user.loginid);
    res.json({ success: true, data: constants.MESSAGES.STORE_PROCESS });
  } catch (err: any) { sendError(res, err); }
};

export const updateChequePaymentDocument = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    if (typeof req.body.doc_no === 'number') req.body.doc_no = String(req.body.doc_no);
    // Remove transient UI fields that Joi schema doesn't allow
    if (req.body.div_name !== undefined) delete req.body.div_name;
    // Normalize children.invoice entries so required fields exist for validation
    if (req.body.children && Array.isArray(req.body.children.invoice)) {
      const allowedInvoiceFields = [
        'doc_date', 'ac_code', 'IsDeletable', 'serial_no', 'dtl_sr_no', 'doc_no', 'doc_type', 'div_code',
        'company_code', 'sign_ind', 'inv_no', 'inv_date', 'due_date', 'chq_date', 'chq_bank', 'chq_no',
        'inv_amt', 'indicator_origin', 'amount_origin', 'c_bal_amt_org', 'amount', 'lcur_amount',
        'curr_code', 'ex_rate', 'c_curr_amt', 'ref_no'
      ];
      req.body.children.invoice = req.body.children.invoice.map((inv: any) => {
        const out: any = {};
        for (const k of allowedInvoiceFields) {
          if (inv[k] !== undefined) out[k] = inv[k];
        }
        out.company_code = out.company_code ?? req.user.company_code;
        if (out.doc_no == null) out.doc_no = '';
        else if (typeof out.doc_no === 'number') out.doc_no = String(out.doc_no);
        return out;
      });
    }
    // Normalize children.job entries
    if (req.body.children && Array.isArray(req.body.children.job)) {
      req.body.children.job = req.body.children.job.map((j: any) => ({
        ...j,
        company_code: j.company_code ?? req.user.company_code,
        ac_code: j.ac_code ?? req.body.ac_code ?? (Array.isArray(req.body.detail) && req.body.detail[0]?.ac_code) ?? null,
      }));
    }
    // Normalize children.expense entries
    if (req.body.children && Array.isArray(req.body.children.expense)) {
      req.body.children.expense = req.body.children.expense.map((e: any) => ({
        ...e,
        company_code: e.company_code ?? req.user.company_code,
        ac_code: e.ac_code ?? req.body.ac_code ?? (Array.isArray(req.body.detail) && req.body.detail[0]?.ac_code) ?? null,
      }));
    }
    // Normalize detail entries so required fields exist for validation
    if (Array.isArray(req.body.detail)) {
      req.body.detail = req.body.detail.map((d: any) => ({
        ...d,
        company_code: d.company_code ?? req.user.company_code,
        doc_no: d.doc_no == null ? '' : (typeof d.doc_no === 'number' ? String(d.doc_no) : d.doc_no),
      }));
    }
    const { error } = chequePaymentSchema(req.body);
    if (error) { res.status(400).json({ success: false, message: error.message }); return; }

    const { detail = [], children = {}, files = [], ...h } = req.body;
    if (!h.doc_no) { res.status(400).json({ success: false, message: 'Missing doc_no in request' }); return; }

    conn = await getConn(req);

    // Step 1 — update header + delete existing children via SP
    await conn.execute(
      `BEGIN SP_UPDATE_CHQ_PAYMENT_HEADER(
        :cc, :dn, :dt, :dv, :ac, :bk, :rn, :rd,
        :rm, :pa , :pp,:pf,:cu, :er, :cn, :cd, :ca, :pt, :ln, :ld, :lu
      ); END;`,
      {
        cc: req.user.company_code, dn: h.doc_no, dt: h.doc_type, dv: h.div_code,
        ac: h.ac_code ?? null, bk: h.bank_ac_code ?? null,
        rn: h.ref_no ?? null, rd: toDate(h.ref_date),
        rm: h.remarks ?? null, pa: h.party_address ?? null,
        pp: h.party_phone ?? null, pf: h.party_fax ?? null,
        cu: h.curr_code ?? null, er: h.ex_rate ?? null,
        cn: h.cheque_no ?? null, cd: toDate(h.cheque_date),
        ca: h.canceled ?? null, pt: h.payment_terms ?? null,
        ln: h.lpo_no ?? null, ld: toDate(h.lpo_date), lu: req.user.loginid,
      }
    );

    // Step 2 — recalculate LCUR_AMOUNT for invoices based on updated amount
    const exRate = h.ex_rate ?? 1;
    const updatedInvoices = (children.invoice ?? []).map((inv: any) => ({
      ...inv,
      lcur_amount: Math.abs(Number(inv.amount ?? inv.lcur_amount ?? 0)),
    }));
    const updatedChildren = {
      ...children,
      invoice: updatedInvoices,
    };

    const isPayment = ['BP', 'BR', 'CR', 'CP', 'CN', 'DN'].includes(h.doc_type);
    const enrichedDetail = (detail ?? []).map((d: any) => ({
      ...d,
      cheque_no: d.cheque_no ?? h.cheque_no ?? null,
      cheque_date: d.cheque_date ?? h.cheque_date ?? null,
      chq_no: d.chq_no ?? d.cheque_no ?? h.cheque_no ?? null,
      chq_date: d.chq_date ?? d.cheque_date ?? h.cheque_date ?? null,
      cheque_desc: d.cheque_desc ?? h.remarks ?? null,
    }));

    await spInsertAllChildren(conn, req.user.company_code, h.doc_type, h.doc_no, h.div_code, h.curr_code, exRate, isPayment, req.user.loginid, enrichedDetail, updatedChildren, files);

    // Step 4 — rebuild txn control row on same connection and commit
    await conn.execute(
      `BEGIN SP_AC_TXN_CONTROL(:cc, :dt, :dn, :lu); END;`,
      { cc: req.user.company_code, dt: h.doc_type, dn: h.doc_no, lu: req.user.loginid }
    );
    await conn.commit();

    res.json({
      success: true,
      message: constants.MESSAGES.UPDATED_SUCCESSFULLY,
      data: { doc_no: h.doc_no, doc_type: h.doc_type }
    });
  } catch (err: any) {
    if (conn) try { await conn.rollback(); } catch { }
    sendError(res, err);
  } finally { await closeConn(conn); }
};

export const createPurchaseDocument = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    if ((req.body as any).address && !(req.body as any).party_address)
      (req.body as any).party_address = (req.body as any).address;
    if ((req.body as any).phone && !(req.body as any).party_phone)
      (req.body as any).party_phone = (req.body as any).phone;

    delete (req.body as any).doc_no;

    const { error, value: v } = purchaseSchema(req.body);
    if (error) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }

    conn = await getConn(req);

    // Step 1 — create header, get generated doc_no
    const result = await conn.execute(
      `BEGIN SP_CREATE_PURCHASE_HEADER(
        :cc, :dv, :dt, :dd, :ac, :cu, :er, :rm, :pa, :pp, :rn,
        :lu, :inv_dt, :pf, :pt, :tcc, :tc, :te, :ref, :pno, :ino
      ); END;`,
      {
        cc: req.user.company_code,
        dv: v.div_code,
        dt: v.doc_type,
        dd: toDate(v.doc_date),
        ac: v.ac_code,
        cu: v.curr_code,
        er: v.ex_rate,
        rm: v.remarks ?? null,
        pa: v.party_address ?? null,
        pp: v.party_phone ?? null,
        rn: v.ref_doc_no ?? null,
        lu: req.user.loginid,
        inv_dt: toDate(v.inv_date || v.doc_date),
        pf: v.party_fax ?? null,
        pt: v.payment_terms ?? null,
        tcc: v.tx_cat_code ?? null,
        tc: v.tx_compntcat_code_1 ?? null,
        te: v.tx_compnt_1_expmt ?? null,
        ref: v.ref_no ?? null,
        pno: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 50 },
        ino: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 50 },
      }
    );

    const { pno: purchase_no, ino: invoice_no } = result.outBinds as any;
    if (!purchase_no) throw new Error('Failed to generate purchase document number');

    // Step 2 — update invoice number on header if user provided one
    try {
      const userInvNo = v.inv_no?.trim() || null;
      const invToSet = userInvNo || invoice_no || purchase_no;
      await conn.execute(
        `UPDATE TR_AC_HEADER SET INVOICE_NUMBER = :inv
         WHERE company_code = :cc AND doc_no = :dn AND doc_type = :dt`,
        { inv: invToSet, cc: req.user.company_code, dn: purchase_no, dt: v.doc_type }
      );
    } catch (uerr) {
      console.warn('Failed to update TR_AC_HEADER.INVOICE_NUMBER:', uerr);
    }

    // Step 3 — insert detail rows (auto-generates 9010 tax row inside SP)
    const purchaseRoundOffAc = await getRoundOffAc(conn, req.user.company_code, v.doc_type);
    await spInsertDetailRows(
      conn, req.user.company_code, v.doc_type, purchase_no,
      applyRoundOff(v.detail ?? [], purchaseRoundOffAc), req.user.loginid
    );

    // Step 4 — aggregate invoice rows from detail
    if (v.detail?.length) {
      await conn.execute(
        `BEGIN SP_INSERT_PURCHASE_INVOICE_SINGLE_AGG(:cc, :dt, :dn, :lu); END;`,
        { cc: req.user.company_code, dt: v.doc_type, dn: purchase_no, lu: req.user.loginid }
      );
    }

    // Step 5 — rebuild 9001 control row (same connection, no new conn needed)
    await conn.execute(
      `BEGIN SP_AC_TXN_CONTROL(:cc, :dt, :dn, :lu); END;`,
      { cc: req.user.company_code, dt: v.doc_type, dn: purchase_no, lu: req.user.loginid }
    );

    await conn.commit();

    // *** Response always reached on success ***
    res.status(201).json({
      success: true,
      message: constants.MESSAGES.CREATED_SUCCESSFULLY,
      data: {
        purchase_doc_no: purchase_no,
        invoice_doc_no:  invoice_no,
      }
    });

  } catch (err: any) {
    if (conn) try { await conn.rollback(); } catch { }
    sendError(res, err);
  } finally {
    await closeConn(conn);
  }
};

export const createSalesDocument = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { error, value: v } = salesSchema(req.body);
    if (error) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }

    conn = await getConn(req);

    const rawTe    = v.tx_compnt_1_expmt;
    const teNorm   = expmtToChar(rawTe);
    const teFinal  = teNorm == null ? null : String(teNorm).charAt(0);
    const teBind   = teFinal == null ? null : String(teFinal).substring(0, 1);

    // Step 1 — create header, get generated doc_no
    const result = await conn.execute(
      `BEGIN SP_CREATE_SALES_HEADER(
        :cc, :dv, :dt, :dd, :ac, :cu, :er, :rm,
        :sc, :se, :lu, :pa, :pp, :rn, :pf, :pt,
        :tcc, :tc, :te, :inv_dt, :sno, :ino
      ); END;`,
      {
        cc:     req.user.company_code,
        dv:     v.div_code,
        dt:     v.doc_type,
        dd:     toDate(v.doc_date),
        ac:     v.ac_code,
        cu:     v.curr_code,
        er:     v.ex_rate,
        rm:     v.remarks ?? null,
        sc:     v.salesman_code ?? null,
        se:     v.sector_code   ?? null,
        lu:     req.user.loginid,
        pa:     v.party_address ?? null,
        pp:     v.party_phone   ?? null,
        rn:     v.ref_no        ?? null,
        pf:     v.party_fax     ?? null,
        pt:     v.payment_terms ?? null,
        tcc:    v.tx_cat_code          ?? null,
        tc:     v.tx_compntcat_code_1  ?? null,
        te:     teBind,
        inv_dt: toDate(v.inv_date || v.doc_date),
        sno: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 50 },
        ino: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 50 },
      }
    );

    const { sno: sales_no, ino: invoice_no } = result.outBinds as any;
    if (!sales_no) throw new Error('Failed to generate sales document number');

    // Step 2 — insert detail rows (auto-generates 9010 tax row inside SP)
    const salesRoundOffAc = await getRoundOffAc(conn, req.user.company_code, v.doc_type);
    await spInsertDetailRows(
      conn, req.user.company_code, v.doc_type, sales_no,
      applyRoundOff(v.detail ?? [], salesRoundOffAc), req.user.loginid
    );

    // Step 3 — aggregate invoice rows from detail
    if (v.detail?.length) {
      await conn.execute(
        `BEGIN SP_INSERT_SALES_INVOICE_SINGLE_AGG(:cc, :dt, :dn, :lu); END;`,
        { cc: req.user.company_code, dt: v.doc_type, dn: sales_no, lu: req.user.loginid }
      );
    }

    // Step 4 — rebuild 9001 control row (same connection)
    await conn.execute(
      `BEGIN SP_AC_TXN_CONTROL(:cc, :dt, :dn, :lu); END;`,
      { cc: req.user.company_code, dt: v.doc_type, dn: sales_no, lu: req.user.loginid }
    );

    await conn.commit();

    // *** Response always reached on success ***
    res.status(201).json({
      success: true,
      message: constants.MESSAGES.CREATED_SUCCESSFULLY,
      data: {
        purchase_doc_no: sales_no,
        invoice_doc_no:  invoice_no,
      }
    });

  } catch (err: any) {
    if (conn) try { await conn.rollback(); } catch { }
    sendError(res, err);
  } finally {
    await closeConn(conn);
  }
};

export const createLPODocument = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { error, value: v } = LpoSchema(req.body);
    if (error) { res.status(400).json({ success: false, message: error.message }); return; }

    conn = await getConn(req);

    const result = await conn.execute(
      `BEGIN SP_CREATE_LPO_HEADER(
    :cc,:dv,:dt,:dd,:ac,:cu,:er,:rm,:lu,
    :pa,:pn,:pp,:pf,:de,:di,:dm,:dc,
    :pt,:dtm,:cp,:rn,:rd,:ar,:tcc,:tc,:pdo,:dn
  ); END;`,
      {
        cc: req.user.company_code,
        dv: v.div_code,
        dt: v.doc_type,
        dd: toDate(v.doc_date),
        ac: v.ac_code,
        cu: v.curr_code,
        er: v.ex_rate,
        rm: v.remarks ?? null,
        lu: req.user.loginid,
        pa: v.party_address,
        pn: v.party_name,
        pp: v.party_phone,
        pf: v.party_fax,
        de: v.dlvr_email,
        di: v.delivery_to,
        dm: v.dlvr_mobile,
        dc: v.dlvr_contact,
        pt: v.payment_terms,
        dtm: v.dlvr_term,
        cp: v.credit_period,
        rn: v.ref_no,
        rd: toDate(v.ref_date),
        ar: v.app_ref_no,
        pdo: v.pdo_type,          
        tcc: v.tx_cat_code,
        tc: v.tx_compntcat_code_1 ?? null,

        dn: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 50 },
      }
    );
    console.log('SP_LPO_HEADER result:', result.outBinds);

    const doc_no = (result.outBinds as any).dn;

    if (v.detail?.length) {
      await conn.executeMany(
        `BEGIN SP_INSERT_LPO_DETAIL_SINGLE(:cc,:dt,:dn,:sn,:ac,:hac,:am,:cu,:er,:si,:dv,:la,:qty,:pr,:pc,:or,:rm,:tcc,:tc,:tp,:tm ,:dd); END;`,
        v.detail.map((d: any) => ({
          cc: req.user.company_code, dt: v.doc_type, dn: doc_no,
          sn: d.serial_no, ac: d.ac_code, hac: v.ac_code,
          am: d.amount, cu: d.curr_code, er: d.ex_rate,
          si: d.sign_ind, dv: d.div_code, la: d.lcur_amount,
          qty: d.qty, pr: d.price, pc: d.prod_code,
          or: d.other_remarks ?? null,
          rm: d.remarks ?? null,
          tcc: d.tx_cat_code ?? null, tc: d.tx_compntcat_code_1 ?? null,
          tp: d.tx_compnt_perc_1 ?? null, tm: d.tx_compnt_amt_1 ?? null,
          // dd:  toDate(v.doc_date), 
          // dd: (d.doc_date ?? v.doc_date)?.toString().slice(0, 10),
          dd: new Date(d.doc_date ?? v.doc_date).toISOString().slice(0, 10),
        }))
      );
      console.log(`Inserted ${v.detail.length} LPO detail rows for document ${doc_no}`);
    }

    await conn.commit();
    res.status(201).json({ success: true, message: 'LPO created successfully', data: { purchase_doc_no: doc_no } });
  } catch (err: any) {
    if (conn) try { await conn.rollback(); } catch { }
    sendError(res, err);
  } finally { await closeConn(conn); }
};

export const updateLPODocument = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;

  try {
    const { doc_no, doc_type } = req.body;
    if (!doc_no || !doc_type) {
      res.status(400).json({
        success: false,
        message: 'doc_no and doc_type are required'
      });
      return;
    }

    conn = await getConn(req);

    // Fetch existing header (VERY IMPORTANT for partial update)
    const existing = await conn.execute(
      `SELECT * FROM TR_AC_LPO_HEADER
       WHERE company_code = :cc
         AND doc_no = :dn
         AND doc_type = :dt`,
      {
        cc: req.user.company_code,
        dn: doc_no,
        dt: doc_type
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!existing.rows?.length) {
      res.status(404).json({
        success: false,
        message: 'LPO not found'
      });
      return;
    }

    const old: any = existing.rows[0];

    //  Merge payload + existing DB values
    const h = {
      doc_date: req.body.doc_date ?? old.DOC_DATE,
      ac_code: req.body.ac_code ?? old.AC_CODE,
      curr_code: req.body.curr_code ?? old.CURR_CODE,
      ex_rate: req.body.ex_rate ?? old.EX_RATE ?? 1,
      remarks: req.body.remarks ?? old.REMARKS,
      party_name: req.body.party_name ?? old.PARTY_NAME,
      party_address: req.body.party_address ?? old.PARTY_ADDRESS,
      party_phone: req.body.party_phone ?? old.PARTY_PHONE,
      party_fax: req.body.party_fax ?? old.PARTY_FAX,
      ref_no: req.body.ref_no ?? old.REF_NO,
      ref_date: req.body.ref_date ?? old.REF_DATE,
      invoice_no: req.body.invoice_no ?? old.INVOICE_NUMBER,
      invoice_date: req.body.invoice_date ?? old.INVOICE_DATE,
      div_code: req.body.div_code ?? old.DIV_CODE,
      qty: req.body.qty ?? old.QTY,
      price: req.body.price ?? old.PRICE,
      prod_code: req.body.prod_code ?? old.PROD_CODE,
      other_remarks: req.body.other_remarks ?? old.OTHER_REMARKS
    };

    //  Call your SP safely
    await conn.execute(
      `BEGIN WMSTST.SP_UPDATE_LPO(
        :cc, :dt, :dn,
        :dd, :ac, :cu, :er,
        :rm,
        :pn, :pa, :pp, :pf,
        :rn, :rd,
        :ino, :idt,
        :dv, :lu
      ); END;`,
      {
        cc: req.user.company_code,
        dt: doc_type,
        dn: doc_no,
        dd: toDate(h.doc_date),
        ac: h.ac_code,
        cu: h.curr_code,
        er: h.ex_rate,
        rm: h.remarks,
        pn: h.party_name,
        pa: h.party_address,
        pp: h.party_phone,
        pf: h.party_fax,
        rn: h.ref_no,
        rd: toDate(h.ref_date),
        ino: h.invoice_no,
        idt: toDate(h.invoice_date),
        dv: h.div_code,
        lu: req.user.loginid
      }
    );

    // Delete + reinsert details (your existing logic is fine)
    await conn.execute(
      `DELETE FROM TR_AC_LPO_DETAIL
       WHERE company_code = :cc
         AND doc_no = :dn
         AND doc_type = :dt`,
      {
        cc: req.user.company_code,
        dn: doc_no,
        dt: doc_type
      }
    );

    if (req.body.detail?.length) {
      await conn.executeMany(
        `BEGIN SP_INSERT_LPO_DETAIL_SINGLE(
          :cc,:dt,:dn,:sn,:ac,:hac,:am,:cu,:er,:si,:dv,:la,
          :qty,:pr,:pc,:or,:rm,:tcc,:tc,:tp,:tm,:dd
        ); END;`,
        req.body.detail.map((d: any, i: number) => ({
          cc: req.user.company_code,
          dt: doc_type,
          dn: doc_no,
          sn: d.serial_no ?? (i + 1),
          ac: d.ac_code,
          hac: h.ac_code,
          am: Number(d.amount || 0),
          cu: d.curr_code ?? h.curr_code,
          er: d.ex_rate ?? h.ex_rate ?? 1,
          si: d.sign_ind ?? 1,
          dv: d.div_code ?? h.div_code,
          la: d.lcur_amount ?? (Number(d.amount || 0) * Number(h.ex_rate ?? 1)),
          qty: Number(d.qty ?? 1),
          pr: Number(d.price ?? 0),
          pc: d.prod_code ?? null,
          or: d.other_remarks ?? null,
          rm: d.remarks ?? null,
          tcc: d.tx_cat_code ?? null,
          tc: d.tx_compntcat_code_1 ?? null,
          tp: d.tx_compnt_perc_1 ?? null,
          tm: d.tx_compnt_amt_1 ?? null,
          // dd: (d.doc_date ?? h.doc_date)?.toString().slice(0, 10),
          dd: new Date(d.doc_date ?? h.doc_date).toISOString().slice(0, 10),
        }))
      );
    }

    await conn.commit();

    res.json({
      success: true,
      message: 'LPO updated successfully',
      data: { doc_no }
    });


  } catch (err: any) {
    if (conn) await conn.rollback().catch(() => { });
    sendError(res, err);
  } finally {
    await closeConn(conn);
  }
};

// =============================================================================
// DELETE / CANCEL HANDLERS
// =============================================================================
export const cancelDocument = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    // validate query params early to provide clearer errors
    const { doc_no, doc_type } = req.query as any;
    // Defensive logging to help debug client request issues
    console.info('cancelDocument called', { query: req.query, user: { loginid: req.user?.loginid, company_code: req.user?.company_code } });

    if (!doc_no || !doc_type) {
      res.status(400).json({ success: false, message: 'Missing required query parameters: doc_no and doc_type' });
      return;
    }

    // normalize doc_no/doc_type to strings (client may send JSON-encoded values)
    const docNo = typeof doc_no === 'string' ? doc_no : (Array.isArray(doc_no) ? doc_no[0] : String(doc_no));
    const docType = typeof doc_type === 'string' ? doc_type : (Array.isArray(doc_type) ? doc_type[0] : String(doc_type));

    conn = await getConn(req);
    await conn.execute(
      `BEGIN SP_CANCEL_DOCUMENT(:cc, :dn, :dt, :lu); END;`,
      { cc: req.user.company_code, dn: docNo, dt: docType, lu: req.user.loginid }
    );
    res.json({ success: true, message: constants.MESSAGES.UPDATED_SUCCESSFULLY });
  } catch (err: any) { sendError(res, err); } finally { await closeConn(conn); }
};

export const deleteDocument = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const doc_no = JSON.parse(req.query.doc_no as any);
    const doc_type = req.params.doc_type;
    conn = await getConn(req);
    await conn.execute(
      `BEGIN SP_DELETE_DOCUMENT(:cc, :dn, :dt); END;`,
      { cc: req.user.company_code, dn: doc_no, dt: doc_type }
    );
    res.json({ success: true, message: constants.MESSAGES.DELETED_SUCCESSFULLY });
  } catch (err: any) { sendError(res, err); } finally { await closeConn(conn); }
};

// export const deleteDetailItem = async (req: RequestWithUser, res: Response): Promise<void> => {
//   let conn: oracledb.Connection | undefined;
//   try {
//     const { doc_no, doc_type, serial_no, div_code, table } = req.query as any;
//     conn = await getConn(req);
//     await conn.execute(
//       `BEGIN SP_DELETE_DETAIL_ITEM(:cc, :dn, :dt, :dc, :sn, :tb); END;`,
//       { cc: req.user.company_code, dn: doc_no, dt: doc_type, dc: div_code, sn: Number(serial_no), tb: table }
//     );
//     res.json({ success: true, data: 'Detail Item ' + constants.MESSAGES.DELETED_SUCCESSFULLY });
//   } catch (err: any) { sendError(res, err); } finally { await closeConn(conn); }
// };
export const deleteDetailItem = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { doc_no, doc_type, serial_no, div_code, table } = req.query as any;
    conn = await getConn(req);

    // Step 1: Delete the item
    await conn.execute(
      `BEGIN SP_DELETE_DETAIL_ITEM(:cc, :dn, :dt, :dc, :sn, :tb); END;`,
      { cc: req.user.company_code, dn: doc_no, dt: doc_type, dc: div_code, sn: Number(serial_no), tb: table }
    );

    // Step 2: use req.query values (not req.body) ✅
    await conn.execute(
      `BEGIN SP_AC_TXN_CONTROL(:cc, :dt, :dn, :usr); END;`,
      { cc: req.user.company_code, dt: doc_type, dn: doc_no, usr: req.user.loginid }
    );

    res.json({ success: true, data: 'Detail Item ' + constants.MESSAGES.DELETED_SUCCESSFULLY });
  } catch (err: any) { sendError(res, err); } finally { await closeConn(conn); }
};

export const deleteChildrenItem = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { doc_no, doc_type, serial_no, div_code, table, dtl_sr_no } = req.query as any;
    conn = await getConn(req);
    const result = await conn.execute(
      `BEGIN SP_DELETE_CHILD_ITEM(:cc, :dn, :dt, :dc, :sn, :ds, :tb, :rd); END;`,
      {
        cc: req.user.company_code, dn: doc_no, dt: doc_type,
        dc: div_code, sn: Number(serial_no), ds: Number(dtl_sr_no),
        tb: table,
        rd: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      }
    );
    const rowsDeleted = (result.outBinds as any).rd;
    if (rowsDeleted > 0) {
      res.json({ success: true, data: `${String(table).toUpperCase()} ${constants.MESSAGES.DELETED_SUCCESSFULLY}` });
    } else {
      res.status(400).json({ success: false, message: 'No record deleted' });
    }
  } catch (err: any) { sendError(res, err); } finally { await closeConn(conn); }
};

export const cancelLPODocument = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { doc_no, doc_type } = req.query as any;
    conn = await getConn(req);
    await conn.execute(
      `BEGIN SP_CANCEL_LPO_DOCUMENT(:cc, :dn, :dt, :lu); END;`,
      { cc: req.user.company_code, dn: doc_no, dt: doc_type, lu: req.user.loginid }
    );
    res.json({ success: true, message: constants.MESSAGES.CANCELLED_SUCCESSFULLY });
  } catch (err: any) { sendError(res, err); } finally { await closeConn(conn); }
};

// =============================================================================
// STORE PROCESS SP CALLER
// =============================================================================
export const callSpAcTxnControl = async (
  company_code: string,
  doc_type: string | number,
  doc_no: string,
  user: string
) => {
  let conn: oracledb.Connection | undefined;
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) throw new Error('Unable to determine tenant database for SP call');
    conn = await TenantManager.getConnection(tenantId);
    await conn.execute(
      `BEGIN SP_AC_TXN_CONTROL(:cc, :dt, :dn, :lu); END;`,
      { cc: company_code, dt: doc_type, dn: doc_no, lu: user }
    );
    await conn.commit();
  } finally { await closeConn(conn); }
};

export const updatePurchaseDocument = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    // Data cleanup
    if ((req.body as any).address && !(req.body as any).party_address)
      (req.body as any).party_address = (req.body as any).address;
    if ((req.body as any).phone && !(req.body as any).party_phone)
      (req.body as any).party_phone = (req.body as any).phone;
    if (typeof req.body.doc_no === 'number')
      req.body.doc_no = String(req.body.doc_no);

    // Validate schema
    const { error, value: v } = purchaseSchema(req.body);
    if (error) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }

    const { detail = [], children = {}, files = [], ...h } = req.body;

    if (!h.doc_no) {
      res.status(400).json({ success: false, message: 'Missing doc_no in request' });
      return;
    }

    if (!h.doc_type) {
      res.status(400).json({ success: false, message: 'Missing doc_type in request' });
      return;
    }

    conn = await getConn(req);

    // Update header and delete existing child records
    await conn.execute(
      `BEGIN SP_UPDATE_PURCHASE_DOCUMENT(
        :cc, :dn, :dt, :dv, :dd, :ac, :cu, :er, :rm, :pa, :pp, :rn,:pf,:pt, :tcc, :tc, :lu, :inv_dt
      ); END;`,
      {
        cc: req.user.company_code,
        dn: h.doc_no,
        dt: h.doc_type,
        dv: h.div_code,
        dd: toDate(h.doc_date),
        ac: h.ac_code,
        cu: h.curr_code,
        er: h.ex_rate ? Number(h.ex_rate) : 1,
        rm: h.remarks || null,
        pa: h.party_address || null,
        pp: h.party_phone || null,
        rn: h.ref_doc_no || null,
        pf: h.party_fax || null,
        pt: h.payment_terms || null,
        tcc: h.tx_cat_code || null,
        tc: h.tx_compntcat_code_1 || null,
        lu: req.user.loginid,
        inv_dt: toDate(h.inv_date || h.doc_date),
      }
    );

    // Clean detail items - CRITICAL: Remove doc_no and ensure proper types
    const detailToUse = detail?.length ? detail : (v.detail || []);

    if (detailToUse.length === 0) {
      throw new Error('At least one detail row is required');
    }

    // Thoroughly clean each detail item
    const cleanDetail = detailToUse.map((d: any, index: number) => {
      const clean: any = {};

      // Copy only the fields we need, with proper types
      clean.serial_no = d.serial_no ? Number(d.serial_no) : (index + 1);
      clean.ac_code = d.ac_code || h.ac_code;
      clean.amount = d.amount ? Number(d.amount) : 0;
      clean.sign_ind = d.sign_ind ? Number(d.sign_ind) : 1;
      clean.curr_code = d.curr_code || h.curr_code;
      clean.ex_rate = d.ex_rate ? Number(d.ex_rate) : (h.ex_rate ? Number(h.ex_rate) : 1);
      clean.lcur_amount = d.lcur_amount ? Number(d.lcur_amount) : (Number(d.amount) * Number(d.ex_rate || h.ex_rate || 1));
      clean.div_code = d.div_code || h.div_code;
      clean.dept_code = d.dept_code || null;
      clean.job_no = d.job_no || null;
      clean.remarks = d.remarks || null;
      clean.qty = d.qty ? Number(d.qty) : null;
      clean.price = d.price ? Number(d.price) : null;
      clean.uom = d.uom || null;

      // Tax related fields
      clean.tx_cat_code = d.tx_cat_code || null;
      clean.tx_compntcat_code_1 = d.tx_compntcat_code_1 || null;
      clean.tx_compnt_perc_1 = d.tx_compnt_perc_1 ? Number(d.tx_compnt_perc_1) : null;
      clean.tx_compnt_amt_1 = d.tx_compnt_amt_1 ? Number(d.tx_compnt_amt_1) : null;
      clean.tx_compnt_lcuramt_1 = d.tx_compnt_lcuramt_1 ? Number(d.tx_compnt_lcuramt_1) : null;
      clean.tx_compnt_1_expmt = d.tx_compnt_1_expmt || 'S';

      // IMPORTANT: Remove any doc_no field if present
      // Do NOT include doc_no in the clean object

      return clean;
    });

    console.log('Cleaned detail items:', JSON.stringify(cleanDetail, null, 2));

    // Insert detail rows (append round-off row if needed)
    const updateRoundOffAc = await getRoundOffAc(conn, req.user.company_code, h.doc_type);
    await spInsertDetailRows(
      conn,
      req.user.company_code,
      h.doc_type,
      h.doc_no,
      applyRoundOff(cleanDetail, updateRoundOffAc),
      req.user.loginid
    );

    await conn.execute(
      `BEGIN SP_INSERT_PURCHASE_INVOICE_SINGLE_AGG(:cc,:dt,:dn,:lu); END;`,
      { cc: req.user.company_code, dt: h.doc_type, dn: h.doc_no, lu: req.user.loginid }
    );

    // *** ADD: Recalculate 9001 control row — now correctly includes 9010 tax ***
    await conn.execute(
      `BEGIN SP_AC_TXN_CONTROL(:cc, :dt, :dn, :lu); END;`,
      { cc: req.user.company_code, dt: h.doc_type, dn: h.doc_no, lu: req.user.loginid }
    );

    await conn.commit(); // no-op, kept for safety

    console.log(`Updated purchase document ${h.doc_type} ${h.doc_no} with ${cleanDetail.length} detail rows`);

    res.json({
      success: true,
      message: 'Purchase and Invoice updated successfully',
      data: {
        purchase_doc_no: h.doc_no,
        invoice_doc_no: h.doc_no
      }
    });

  } catch (err: any) {
    console.error('Update purchase error:', err);
    if (conn) {
      try {
        await conn.rollback();
      } catch (rollbackErr) {
        console.error('Rollback error:', rollbackErr);
      }
    }

    const statusCode = err.status ?? constants.STATUS_CODES.INTERNAL_SERVER_ERROR;
    const message = err.message ?? 'Error updating purchase document';
    res.status(statusCode).json({ success: false, message });
  } finally {
    await closeConn(conn);
  }
};