import { Response }           from 'express';
import oracledb               from 'oracledb';
import constants              from '../../../../helpers/constants';
import { RequestWithUser }    from '../../../../interfaces/common.interface';
import { IUser }              from '../../../../interfaces/user.interface';
import {
  chequePaymentSchema,
  LpoSchema,
  purchaseSchema,
  salesSchema,
  pettyCashSchema
} from '../../../../validation/finance/accounts/transaction.validation';
import TenantManager          from '../../../../database/TenantManager';
import { getCurrentTenantId } from '../../../../middleware/tenantContext.middleware';

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId) tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenantId) throw Object.assign(new Error('Unable to determine tenant database'), { status: 400 });
  return TenantManager.getConnection(tenantId);
}

async function closeConn(conn?: oracledb.Connection) {
  if (conn) try { await conn.close(); } catch (e) { console.warn('Close conn error:', e); }
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

/** Calls SP_INSERT_DETAIL_SINGLE via executeMany — owns TR_AC_DETAIL INSERT */
async function spInsertDetailRows(
  conn: oracledb.Connection,
  company_code: string,
  doc_type: string,
  doc_no: string,
  detail: any[],
  login_user: string
) {
  if (!detail?.length) return;
  await conn.executeMany(
    `BEGIN SP_INSERT_DETAIL_SINGLE(
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
    ); END;`,
    detail.map((d: any) => ({
      company_code,          doc_type,             doc_no,
      serial_no:             d.serial_no,
      doc_date:              toDate(d.doc_date),
      ac_code:               d.ac_code               ?? null,
      header_ac_code:        d.header_ac_code         ?? null,
      bank_ac_code:          d.bank_ac_code           ?? null,
      remarks:               d.remarks               ?? null,
      amount:                d.amount                ?? 0,
      sign_ind:              d.sign_ind              ?? 1,
      curr_code:             d.curr_code             ?? null,
      ex_rate:               d.ex_rate               ?? 1,
      lcur_amount:           d.lcur_amount ?? d.amount ?? 0,
      pdc_ind:               d.pdc_ind               ?? null,
      cheque_no:             d.cheque_no             ?? null,
      cheque_date:           toDate(d.cheque_date),
      cheque_desc:           d.cheque_desc           ?? null,
      pdc_cleared_date:      toDate(d.pdc_cleared_date),
      cancelled:             d.cancelled             ?? 'N',
      job_no:                d.job_no                ?? null,
      recon_ind:             d.recon_ind             ?? null,
      recon_date:            toDate(d.recon_date),
      dept_code:             d.dept_code             ?? null,
      qty:                   d.qty                   ?? null,
      price:                 d.price                 ?? null,
      uom:                   d.uom                   ?? null,
      pdc_clear_jvno:        d.pdc_clear_jvno        ?? null,
      ref_doc_type:          d.ref_doc_type          ?? null,
      ref_doc_no:            d.ref_doc_no            ?? null,
      ref_doc_serial_no:     d.ref_doc_serial_no     ?? null,
      div_code:              d.div_code              ?? null,
      tx_cat_code:           d.tx_cat_code           ?? null,
      tx_compntcat_code_1:   d.tx_compntcat_code_1   ?? null,
      tx_compntcat_code_2:   d.tx_compntcat_code_2   ?? null,
      tx_compntcat_code_3:   d.tx_compntcat_code_3   ?? null,
      tx_compntcat_code_4:   d.tx_compntcat_code_4   ?? null,
      tx_compnt_perc_1:      d.tx_compnt_perc_1      ?? null,
      tx_compnt_perc_2:      d.tx_compnt_perc_2      ?? null,
      tx_compnt_perc_3:      d.tx_compnt_perc_3      ?? null,
      tx_compnt_perc_4:      d.tx_compnt_perc_4      ?? null,
      tx_compnt_amt_1:       d.tx_compnt_amt_1       ?? null,
      tx_compnt_amt_2:       d.tx_compnt_amt_2       ?? null,
      tx_compnt_amt_3:       d.tx_compnt_amt_3       ?? null,
      tx_compnt_amt_4:       d.tx_compnt_amt_4       ?? null,
      tx_compnt_lcuramt_1:   d.tx_compnt_lcuramt_1   ?? null,
      tx_compnt_lcuramt_2:   d.tx_compnt_lcuramt_2   ?? null,
      tx_compnt_lcuramt_3:   d.tx_compnt_lcuramt_3   ?? null,
      tx_compnt_lcuramt_4:   d.tx_compnt_lcuramt_4   ?? null,
      tx_compnt_1_expmt:     d.tx_compnt_1_expmt     ?? null,
      tx_compnt_2_expmt:     d.tx_compnt_2_expmt     ?? null,
      tx_compnt_3_expmt:     d.tx_compnt_3_expmt     ?? null,
      tx_compnt_4_expmt:     d.tx_compnt_4_expmt     ?? null,
      tx_tax_filed:          d.tx_tax_filed           ?? null,
      tx_tax_filed_dt:       toDate(d.tx_tax_filed_dt),
      tx_tax_filed_refno:    d.tx_tax_filed_refno    ?? null,
      tx_compnt_hdisc_amt_1: d.tx_compnt_hdisc_amt_1 ?? null,
      login_user,
    }))
  );
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
  await conn.executeMany(
    `BEGIN SP_INSERT_INVOICE_SINGLE(
      :company_code, :doc_type, :doc_no,
      :serial_no, :dtl_sr_no, :doc_date, :ac_code,
      :inv_no, :inv_date, :due_date,
      :chq_no, :chq_date, :chq_bank,
      :amount, :lcur_amount,
      :curr_code, :ex_rate, :div_code,
      :is_payment, :amount_origin, :login_user
    ); END;`,
    invoice.map((inv: any) => ({
      company_code,
      doc_type:      inv.doc_type  ?? doc_type,
      doc_no,                                   
      serial_no:     inv.serial_no,
      dtl_sr_no:     inv.dtl_sr_no,
      doc_date:      toDate(inv.doc_date),
      ac_code:       inv.ac_code,
      inv_no:        inv.inv_no,
      inv_date:      toDate(inv.inv_date),
      due_date:      toDate(inv.due_date),
      chq_no:        inv.chq_no    ?? null,
      chq_date:      toDate(inv.chq_date),
      chq_bank:      inv.chq_bank  ?? null,
      amount:        inv.amount    ?? 0,
      lcur_amount:   Math.abs(inv.lcur_amount || inv.amount || 0),
      curr_code:     inv.curr_code ?? curr_code ?? 'USD',
      ex_rate:       inv.ex_rate   ?? ex_rate   ?? 1,
      div_code:      inv.div_code  ?? div_code,
      is_payment:    flag,
      amount_origin: is_payment ? null : (inv.lcur_amount ?? inv.amount ?? 0),
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
      doc_type:    j.doc_type    ?? doc_type,
      doc_no,
      serial_no:   j.serial_no,
      dtl_sr_no:   j.dtl_sr_no,
      doc_date:    toDate(j.doc_date),
      ac_code:     j.ac_code,
      job_no:      j.job_no,
      doc_refno:   j.doc_refno   ?? null,
      doc_refno_2: j.doc_refno_2 ?? null,
      amount:      j.amount,
      sign_ind:    j.sign_ind,
      lcur_amount: j.lcur_amount,
      curr_code:   j.curr_code,
      ex_rate:     j.ex_rate     ?? 1,
      div_code:    j.div_code,
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
  expense: any[],
  login_user: string
) {
  if (!expense?.length) return;
  await conn.executeMany(
    `BEGIN SP_INSERT_EXPENSE_SINGLE(
      :company_code, :doc_type, :doc_no,
      :serial_no, :dtl_sr_no, :doc_date,
      :ac_code, :exp_type_code, :exp_subtype_code, :exp_code,
      :job_no, :amount, :sign_ind, :lcur_amount,
      :curr_code, :ex_rate, :div_code, :login_user
    ); END;`,
    expense.map((e: any) => ({
      company_code,
      doc_type:          e.doc_type ?? doc_type,
      doc_no,
      serial_no:         e.serial_no,
      dtl_sr_no:         e.dtl_sr_no,
      doc_date:          toDate(e.doc_date),
      ac_code:           e.ac_code,
      exp_type_code:     e.exp_type_code,
      exp_subtype_code:  e.exp_subtype_code,
      exp_code:          e.exp_code,
      job_no:            e.job_no    ?? null,
      amount:            e.amount,
      sign_ind:          e.sign_ind,
      lcur_amount:       e.lcur_amount,
      curr_code:         e.curr_code,
      ex_rate:           e.ex_rate   ?? 1,
      div_code:          e.div_code,
      login_user,
    }))
  );
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
      file_name:      f.file_name,
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
  detail:   any[],
  children: { invoice?: any[]; job?: any[]; expense?: any[] },
  files:    any[]
) {
  await spInsertDetailRows(conn, company_code, doc_type, doc_no, detail,                   login_user);
  await spInsertInvoiceRows(conn, company_code, doc_type, doc_no, div_code, curr_code, ex_rate, is_payment, children?.invoice ?? [], login_user);
  await spInsertJobRows(conn,     company_code, doc_type, doc_no, children?.job     ?? [], login_user);
  await spInsertExpenseRows(conn, company_code, doc_type, doc_no, children?.expense ?? [], login_user);
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
    const p     = { cc: req.user.company_code, dn: req.params.doc_no, dc: req.query.div_code, dt: req.query.doc_type };
    const where = `WHERE company_code = :cc AND TO_CHAR(doc_no) = :dn
                     AND div_code = :dc AND doc_type = :dt ORDER BY serial_no, dtl_sr_no`;
    const [inv, job, exp] = await Promise.all([
      conn.execute(`SELECT * FROM VW_TXN_INVOICE_CHILDREN ${where}`, p, { outFormat: oracledb.OUT_FORMAT_OBJECT }),
      conn.execute(`SELECT * FROM VW_TXN_JOB_CHILDREN     ${where}`, p, { outFormat: oracledb.OUT_FORMAT_OBJECT }),
      conn.execute(`SELECT * FROM VW_TXN_EXPENSE_CHILDREN ${where}`, p, { outFormat: oracledb.OUT_FORMAT_OBJECT }),
    ]);
    res.json({ success: true, data: {
      invoice: normalize(inv.rows || []),
      job:     normalize(job.rows || []),
      expense: normalize(exp.rows || []),
    }});
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
    if      (row.L4_BILL === 'Y')                                       data = { table: 'invoice', code: '' };
    else if (row.L4_JOB  === 'Y')                                       data = { table: 'job',     code: '' };
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
      const pd  = Number(r.PAID_AMOUNT || 0);
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
    const rows   = await cursor.getRows(10000);
    await cursor.close();
    res.json({ success: true, data: rows });
  } catch (err) { sendError(res, err); } finally { await closeConn(conn); }
};

// =============================================================================
// WRITE HANDLERS — zero raw SQL, all delegate to SPs
// =============================================================================
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
        cc: user.company_code, dn: d.doc_no,         dt: d.doc_type,
        dc: d.div_code,        dd: toDate(d.doc_date), ac: d.ac_code ?? null,
        lu: user.loginid,
      }))
    );
    await conn.commit();
    res.json({ success: true, message: 'Document ' + constants.MESSAGES.IMPORTED_SUCCESSFULLY });
  } catch (err: any) {
    if (conn) try { await conn.rollback(); } catch {}
    sendError(res, err);
  } finally { await closeConn(conn); }
};

export const createChequePaymentDocument = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    if (typeof req.body.doc_no === 'number') req.body.doc_no = String(req.body.doc_no);
    // Normalize children.invoice entries so required fields exist for validation
    if (req.body.children && Array.isArray(req.body.children.invoice)) {
      req.body.children.invoice = req.body.children.invoice.map((inv: any) => ({
        ...inv,
        company_code: inv.company_code ?? req.user.company_code,
      }));
    }
    // Normalize detail entries so required fields exist for validation
    if (Array.isArray(req.body.detail)) {
      req.body.detail = req.body.detail.map((d: any) => ({
        ...d,
        company_code: d.company_code ?? req.user.company_code,
      }));
    }
    const { error } = chequePaymentSchema(req.body);
    if (error) { res.status(400).json({ success: false, message: error.message }); return; }

    const { detail = [], children = {}, files = [], ...h } = req.body;
    conn = await getConn(req);

    // Step 1 — call header SP, get generated doc_no
    const hdrResult = await conn.execute(
      `BEGIN SP_CREATE_CHQ_HEADER(
        :cc, :dv, :dt, :dd, :ac, :bk, :rn, :rd, :rm,
        :cu, :er, :cn, :cd, :ap, :cb, :pt, :ln, :ld, :lu,
        :doc_no
      ); END;`,
      {
        cc: req.user.company_code,  dv: h.div_code,
        dt: h.doc_type,             dd: toDate(h.doc_date),
        ac: h.ac_code        ?? null, bk: h.bank_ac_code  ?? null,
        rn: h.ref_no         ?? null, rd: toDate(h.ref_date),
        rm: h.remarks        ?? null, cu: h.curr_code      ?? null,
        er: h.ex_rate        ?? null, cn: h.cheque_no      ?? null,
        cd: toDate(h.cheque_date),   ap: h.ac_payee        ?? null,
        cb: h.cheque_bank    ?? null, pt: h.payment_terms  ?? null,
        ln: h.lpo_no         ?? null, ld: toDate(h.lpo_date),
        lu: req.user.loginid,
        doc_no: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 50 },
      }
    );

    const doc_no = (hdrResult.outBinds as any).doc_no;
    if (!doc_no) throw new Error('Failed to generate document number');

    // Step 2 — insert all children via _SINGLE SPs, then commit
    const isPayment = ['BP', 'BR', 'CR', 'CP'].includes(h.doc_type);
    await spInsertAllChildren(conn, req.user.company_code, h.doc_type, doc_no, h.div_code, h.curr_code, h.ex_rate, isPayment, req.user.loginid, detail, children, files);

    console.log(`Created document ${h.doc_type} ${doc_no} with ${detail.length} detail rows, ${children.invoice?.length ?? 0} invoice rows, ${children.job?.length ?? 0} job rows and ${children.expense?.length ?? 0} expense rows`);
    
    res.json({ success: true, data: { data: constants.MESSAGES.CREATED_SUCCESSFULLY, doc_no, doc_type: h.doc_type } });
  } catch (err: any) {
    if (conn) try { await conn.rollback(); } catch {}
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
    // Normalize children.invoice entries so required fields exist for validation
    if (req.body.children && Array.isArray(req.body.children.invoice)) {
      req.body.children.invoice = req.body.children.invoice.map((inv: any) => ({
        ...inv,
        company_code: inv.company_code ?? req.user.company_code,
      }));
    }
    // Normalize detail entries so required fields exist for validation
    if (Array.isArray(req.body.detail)) {
      req.body.detail = req.body.detail.map((d: any) => ({
        ...d,
        company_code: d.company_code ?? req.user.company_code,
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
        :rm, :cu, :er, :cn, :cd, :ca, :pt, :ln, :ld, :lu
      ); END;`,
      {
        cc: req.user.company_code, dn: h.doc_no,         dt: h.doc_type,   dv: h.div_code,
        ac: h.ac_code       ?? null, bk: h.bank_ac_code  ?? null,
        rn: h.ref_no        ?? null, rd: toDate(h.ref_date),
        rm: h.remarks       ?? null, cu: h.curr_code      ?? null,
        er: h.ex_rate       ?? null, cn: h.cheque_no      ?? null,
        cd: toDate(h.cheque_date),   ca: h.canceled       ?? null,
        pt: h.payment_terms ?? null, ln: h.lpo_no         ?? null,
        ld: toDate(h.lpo_date),      lu: req.user.loginid,
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

    // Step 3 — re-insert children via _SINGLE SPs, then commit
    const isPayment = ['BP', 'BR', 'CR', 'CP'].includes(h.doc_type);
    await spInsertAllChildren(conn, req.user.company_code, h.doc_type, h.doc_no, h.div_code, h.curr_code, exRate, isPayment, req.user.loginid, detail, updatedChildren, files);

    // Step 4 — store process
    await callSpAcTxnControl(req.user.company_code, h.doc_type, h.doc_no, req.user.loginid);

    res.json({ success: true, data: constants.MESSAGES.CREATED_SUCCESSFULLY });
  } catch (err: any) {
    if (conn) try { await conn.rollback(); } catch {}
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
    const result = await conn.execute(
      `BEGIN SP_CREATE_PURCHASE_HEADER(
        :cc, :dv, :dt, :dd, :ac, :cu, :er, :rm, :pa, :pp, :rn, :lu, :pno, :ino, :inv_dt
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
        pno: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 50 },
        ino: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 50 },
      }
    );

    const { pno: purchase_no, ino: invoice_no } = result.outBinds as any;
    // Detail rows SP
    await spInsertDetailRows(conn, req.user.company_code, v.doc_type, purchase_no, v.detail ?? [], req.user.loginid);
    if (v.detail?.length) {
      await conn.executeMany(
        `BEGIN SP_INSERT_PURCHASE_INVOICE_SINGLE(:cc,:dt,:dn,:sn,:dd,:ac,:iv,:am,:cu,:er,:dv,:lu); END;`,
        v.detail.map((d: any) => ({
          cc: req.user.company_code, 
          dt: v.doc_type,    
          dn: purchase_no,
          sn: d.serial_no,           
          dd: toDate(v.inv_date || v.doc_date), 
          ac: v.ac_code,
          iv: invoice_no,            
          am: d.amount,      
          cu: d.curr_code,
          er: d.ex_rate ?? 1,        
          dv: d.div_code,    
          lu: req.user.loginid,
        }))
      );
    }

    await conn.commit();
    res.status(201).json({ 
      success: true, 
      message: 'Purchase and Invoice created successfully', 
      data: { 
        purchase_doc_no: purchase_no, 
        invoice_doc_no: invoice_no 
      } 
    });
  } catch (err: any) {
    if (conn) try { await conn.rollback(); } catch {}
    sendError(res, err);
  } finally { 
    await closeConn(conn); 
  }
};

export const createSalesDocument = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { error, value: v } = salesSchema(req.body);
    if (error) { res.status(400).json({ success: false, message: error.message }); return; }

    conn = await getConn(req);

    const result = await conn.execute(
      `BEGIN SP_CREATE_SALES_HEADER(:cc,:dv,:dt,:dd,:ac,:cu,:er,:rm,:sc,:se,:lu,:inv_dt,:sno,:ino); END;`,
      {
        cc: req.user.company_code, dv: v.div_code,       dt: v.doc_type,
        dd: toDate(v.doc_date),    ac: v.ac_code,         cu: v.curr_code,
        er: v.ex_rate,             rm: v.remarks        ?? null,
        sc: v.salesman_code     ?? null, se: v.sector_code ?? null,
        lu: req.user.loginid,
        inv_dt: toDate(v.inv_date || v.doc_date),
        sno: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 50 },
        ino: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 50 },
      }
    );

    const { sno: sales_no, ino: invoice_no } = result.outBinds as any;

    await spInsertDetailRows(conn, req.user.company_code, v.doc_type, sales_no, v.detail ?? [], req.user.loginid);

    // Sales invoice rows SP (sign = +1)
    if (v.detail?.length) {
      await conn.executeMany(
        `BEGIN SP_INSERT_SALES_INVOICE_SINGLE(:cc,:dt,:dn,:sn,:dd,:ac,:iv,:am,:cu,:er,:dv,:lu); END;`,
        v.detail.map((d: any) => ({
          cc: req.user.company_code, dt: v.doc_type,    dn: sales_no,
          sn: d.serial_no,           dd: toDate(v.doc_date), ac: v.ac_code,
          iv: invoice_no,            am: d.amount,      cu: d.curr_code,
          er: d.ex_rate ?? 1,        dv: d.div_code,    lu: req.user.loginid,
        }))
      );
    }

    await conn.commit();
    res.status(201).json({ success: true, message: 'Sales Invoice created successfully', data: { purchase_doc_no: sales_no, invoice_doc_no: invoice_no } });
  } catch (err: any) {
    if (conn) try { await conn.rollback(); } catch {}
    sendError(res, err);
  } finally { await closeConn(conn); }
};

export const createLPODocument = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { error, value: v } = LpoSchema(req.body);
    if (error) { res.status(400).json({ success: false, message: error.message }); return; }

    conn = await getConn(req);

    const result = await conn.execute(
      `BEGIN SP_CREATE_LPO_HEADER(:cc,:dv,:dt,:dd,:ac,:cu,:er,:rm,:lu,:dn); END;`,
      {
        cc: req.user.company_code, dv: v.div_code, dt: v.doc_type,
        dd: toDate(v.doc_date),    ac: v.ac_code,  cu: v.curr_code,
        er: v.ex_rate,             rm: v.remarks ?? null,
        lu: req.user.loginid,
        dn: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 50 },
      }
    );

    const doc_no = (result.outBinds as any).dn;

    if (v.detail?.length) {
      await conn.executeMany(
        `BEGIN SP_INSERT_LPO_DETAIL_SINGLE(:cc,:dt,:dn,:sn,:ac,:hac,:am,:cu,:er,:si,:dv,:la); END;`,
        v.detail.map((d: any) => ({
          cc: req.user.company_code, dt: v.doc_type, dn: doc_no,
          sn: d.serial_no,           ac: d.ac_code,  hac: v.ac_code,
          am: d.amount,              cu: d.curr_code, er: d.ex_rate,
          si: d.sign_ind,            dv: d.div_code,  la: d.lcur_amount,
        }))
      );
    }

    await conn.commit();
    res.status(201).json({ success: true, message: 'LPO created successfully', data: { purchase_doc_no: doc_no } });
  } catch (err: any) {
    if (conn) try { await conn.rollback(); } catch {}
    sendError(res, err);
  } finally { await closeConn(conn); }
};

// =============================================================================
// DELETE / CANCEL HANDLERS
// =============================================================================
export const cancelDocument = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { doc_no, doc_type } = req.query as any;
    conn = await getConn(req);
    await conn.execute(
      `BEGIN SP_CANCEL_DOCUMENT(:cc, :dn, :dt, :lu); END;`,
      { cc: req.user.company_code, dn: doc_no, dt: doc_type, lu: req.user.loginid }
    );
    res.json({ success: true, message: constants.MESSAGES.UPDATED_SUCCESSFULLY });
  } catch (err: any) { sendError(res, err); } finally { await closeConn(conn); }
};

export const deleteDocument = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const doc_no   = JSON.parse(req.query.doc_no as any);
    const doc_type = req.params.doc_type;
    conn = await getConn(req);
    await conn.execute(
      `BEGIN SP_DELETE_DOCUMENT(:cc, :dn, :dt); END;`,
      { cc: req.user.company_code, dn: doc_no, dt: doc_type }
    );
    res.json({ success: true, message: constants.MESSAGES.DELETED_SUCCESSFULLY });
  } catch (err: any) { sendError(res, err); } finally { await closeConn(conn); }
};

export const deleteDetailItem = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { doc_no, doc_type, serial_no, div_code, table } = req.query as any;
    conn = await getConn(req);
    await conn.execute(
      `BEGIN SP_DELETE_DETAIL_ITEM(:cc, :dn, :dt, :dc, :sn, :tb); END;`,
      { cc: req.user.company_code, dn: doc_no, dt: doc_type, dc: div_code, sn: Number(serial_no), tb: table }
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
        cc: req.user.company_code, dn: doc_no,          dt: doc_type,
        dc: div_code,              sn: Number(serial_no), ds: Number(dtl_sr_no),
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
        :cc, :dn, :dt, :dv, :dd, :ac, :cu, :er, :rm, :pa, :pp, :rn, :lu, :inv_dt
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

    // Insert detail rows
    await spInsertDetailRows(
      conn, 
      req.user.company_code, 
      h.doc_type, 
      h.doc_no,
      cleanDetail, 
      req.user.loginid
    );

    // Insert invoice child rows
    await conn.executeMany(
      `BEGIN SP_INSERT_PURCHASE_INVOICE_SINGLE(:cc,:dt,:dn,:sn,:dd,:ac,:iv,:am,:cu,:er,:dv,:lu); END;`,
      cleanDetail.map((d: any) => ({
        cc: req.user.company_code, 
        dt: h.doc_type,    
        dn: h.doc_no,
        sn: d.serial_no, 
        dd: toDate(h.doc_date), 
        ac: h.ac_code,
        iv: h.doc_no,
        am: d.amount, 
        cu: d.curr_code,
        er: d.ex_rate, 
        dv: d.div_code,    
        lu: req.user.loginid,
      }))
    );

    await conn.commit();
    
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