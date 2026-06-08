import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { IUser } from '../../../../interfaces/user.interface';

const normalizeSignInd = (value: unknown, fallback = 1): 1 | -1 => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "cr" || normalized === "credit") return 1;
    if (normalized === "dr" || normalized === "debit") return -1;
  }
  const numeric = Number(value);
  if (numeric === 1 || numeric === -1) return numeric as 1 | -1;
  return fallback === -1 ? -1 : 1;
};

const defaultDetailSign = (docType?: string): 1 | -1 =>
  docType === "PI" || docType === "PO" ? 1 : -1;

const defaultInvoiceSign = (docType?: string): 1 | -1 | undefined => {
  if (docType === "PI" || docType === "PO") return -1;
  if (docType === "SI" || docType === "SV") return 1;
  return undefined;
};

const oneChar = (value: unknown, fallback: string | null = null): string | null => {
  const source = value ?? fallback;
  if (source === null || source === undefined || source === "") return null;
  return String(source).substring(0, 1);
};

export const procBulkAccountEntry = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {
    const user = req.user as IUser;
    const header = req.body?.header;
    const details = req.body?.details || [];
    const invoiceDetail = req.body?.invoiceDetails || req.body?.invoiceDetail || [];
    const expenseDetail = req.body?.expenseDetails || req.body?.expenseDetail || [];
    const jobDetail = req.body?.jobDetails || req.body?.jobDetail || [];
    const loginid = req.body?.loginid || header?.create_user || header?.edit_user;

    if (!header) {

      res.status(400).json({
        success: false,
        message: "Header required"
      });

      return;
    }

    const tenantId = getCurrentTenantId();

    if (!tenantId) {

      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });

      return;
    }

    connection = await TenantManager.getConnection(tenantId);
    console.log("========================>", header.doc_no);
    console.log("invoiceDetail raw:", invoiceDetail);
    console.log("invoiceDetail length:", invoiceDetail?.length);
    if (header.doc_no == 0) {
      header.doc_no = '0'
    }
    console.log("Header doc_no after check:", header.inv_no);
    const result = await connection.execute(
      `
      BEGIN
        PROC_BULK_ACCOUNT_ENTRY(
          :p_header,
          :p_detail,
          :p_invdetail,
          :p_expdetail,
          :p_jobdetail
        );
      END;
      `,
      {
        p_header: {
          type: "TY_TR_AC_HEADER_ACENTRY_TAB",
          dir: oracledb.BIND_INOUT,
          val: [
            {
              COMPANY_CODE: header.company_code,
              DOC_TYPE: header.doc_type,
              DOC_NO: header.doc_no || '0',
              DOC_DATE: header.doc_date ? new Date(header.doc_date) : null,
              AC_CODE: header.ac_code,
              AC_PAYEE: header.ac_payee,
              BANK_AC_CODE: header.bank_ac_code,
              REMARKS: header.remarks,
              CURR_CODE: header.curr_code,
              EX_RATE: header.ex_rate,
              CHEQUE_NO: header.cheque_no,
              CHEQUE_DATE: header.cheque_date
                ? new Date(header.cheque_date)
                : null,
              CANCELED: oneChar(header.canceled),
              CREATE_USER: header.create_user || loginid,
              EDIT_USER: header.edit_user || loginid,
              CREATE_DATE: header.create_date
                ? new Date(header.create_date)
                : null,
              EDIT_DATE: header.edit_date
                ? new Date(header.edit_date)
                : null,
              LAST_DTL_SERIAL_NO: header.last_dtl_serial_no,
              AUTO_REVERSE: oneChar(header.auto_reverse),
              DIV_CODE: header.div_code,
              SYS_GEN: oneChar(header.sys_gen),
              TX_COMPNTCAT_CODE_2: header.tx_compntcat_code_2,
              TX_COMPNTCAT_CODE_3: header.tx_compntcat_code_3,
              TX_COMPNTCAT_CODE_4: header.tx_compntcat_code_4,
              TX_COMPNT_1_EXPMT: oneChar(header.tx_compnt_1_expmt),
              TX_TAX_FILED: oneChar(header.tx_tax_filed),
              TX_COMPNT_HDISC_AMT_1: header.tx_compnt_hdisc_amt_1,
              PDO_TYPE: oneChar(header.pdo_type, "N"),
              CREATED_BY: user.loginid,
              UPDATED_BY: user.loginid,
              INV_NO: header.inv_no || header.invoice_no || null,
              INV_DATE: header.inv_date || header.invoice_date
                ? new Date(header.inv_date || header.invoice_date)
                : null,
              REF_NO: header.ref_no || header.inv_no || header.invoice_no || null,
              REF_DATE: header.ref_date || header.inv_date || header.invoice_date
                ? new Date(header.ref_date || header.inv_date || header.invoice_date)
                : null,
              REF_DOC_NO: header.ref_doc_no || null,
              PARTY_NAME: header.party_name || header.ac_name || null,
              PARTY_ADDRESS: header.party_address || null,
              PARTY_PHONE: header.party_phone || null,
              PARTY_FAX: header.party_fax || null,
              PAYMENT_TERMS: header.payment_terms || null,
              TX_CAT_CODE: header.tx_cat_code || null,
              TX_COMPNTCAT_CODE_1: header.tx_compntcat_code_1 || null,
              TX_COMPNT_PERC_1: header.tx_compnt_perc_1 ?? null,
              SALESMAN_CODE: header.salesman_code || null,
              SECTOR_CODE: header.sector_code || null,
              DLVR_CONTACT: header.dlvr_contact || null,
              DLVR_EMAIL: header.dlvr_email || null,
              DLVR_MOBILE: header.dlvr_mobile || null,
              DLVR_TERM: header.dlvr_term || null,
              DELIVERY_TO: header.delivery_to || null,
              APP_REF_NO: header.app_ref_no || null,
            }
          ]
        },

        p_detail: {
          type: "TY_TR_AC_DETAIL_ACENTRY_TAB",
          val: details.map((d: any) => ({
            COMPANY_CODE: d.company_code,
            DOC_TYPE: d.doc_type,
            DOC_NO: d.doc_no || '0',
            SERIAL_NO: d.serial_no,
            DOC_DATE: d.doc_date ? new Date(d.doc_date) : null,
            AC_CODE: d.ac_code,
            HEADER_AC_CODE: d.header_ac_code,
            REMARKS: d.remarks,
            AMOUNT: d.amount,
            SIGN_IND: normalizeSignInd(d.sign_ind, defaultDetailSign(d.doc_type || header.doc_type)),
            CURR_CODE: d.curr_code,
            EX_RATE: d.ex_rate,
            LCUR_AMOUNT: d.lcur_amount,
            PDC_IND: oneChar(d.pdc_ind),
            CHEQUE_NO: d.cheque_no,
            CHEQUE_DATE: d.cheque_date
              ? new Date(d.cheque_date)
              : null,
            CANCELLED: oneChar(d.canceled ?? d.cancelled),
            RECON_IND: oneChar(d.recon_ind),
            DIV_CODE: d.div_code,
            TX_CAT_CODE: d.tx_cat_code,
            TX_COMPNTCAT_CODE_1: d.tx_compntcat_code_1,
            TX_COMPNTCAT_CODE_2: d.tx_compntcat_code_2,
            TX_COMPNTCAT_CODE_3: d.tx_compntcat_code_3,
            TX_COMPNTCAT_CODE_4: d.tx_compntcat_code_4,
            TX_COMPNT_PERC_1: d.tx_compnt_perc_1,
            TX_COMPNT_PERC_2: d.tx_compnt_perc_2,
            TX_COMPNT_PERC_3: d.tx_compnt_perc_3,
            TX_COMPNT_PERC_4: d.tx_compnt_perc_4,
            TX_COMPNT_AMT_1: d.tx_compnt_amt_1,
            TX_COMPNT_AMT_2: d.tx_compnt_amt_2,
            TX_COMPNT_AMT_3: d.tx_compnt_amt_3,
            TX_COMPNT_AMT_4: d.tx_compnt_amt_4,
            TX_COMPNT_LCURAMT_1: d.tx_compnt_lcuramt_1,
            TX_COMPNT_LCURAMT_2: d.tx_compnt_lcuramt_2,
            TX_COMPNT_LCURAMT_3: d.tx_compnt_lcuramt_3,
            TX_COMPNT_LCURAMT_4: d.tx_compnt_lcuramt_4,
            TX_COMPNT_1_EXPMT: oneChar(d.tx_compnt_1_expmt),
            TX_COMPNT_2_EXPMT: oneChar(d.tx_compnt_2_exmpt ?? d.tx_compnt_2_expmt),
            TX_COMPNT_3_EXPMT: oneChar(d.tx_compnt_3_exmpt ?? d.tx_compnt_3_expmt),
            TX_COMPNT_4_EXPMT: oneChar(d.tx_compnt_4_exmpt ?? d.tx_compnt_4_expmt),
            TX_TAX_FILED: oneChar(d.tx_tax_filed),
            TX_COMPNT_HDISC_AMT_1: d.tx_compnt_hdisc_amt_1,
            QTY: d.qty,
            PRICE: d.price,
            SIGN_CODE: d.sign_code,
          }))
        },

        p_invdetail: {
          type: "TY_TR_AC_INVDETAIL_ACENTRY_TAB",
          val: invoiceDetail.map((d: any) => ({
            COMPANY_CODE: d.company_code,
            DOC_TYPE: d.doc_type,
            DOC_NO: d.doc_no || '0',
            SERIAL_NO: d.serial_no,
            DTL_SR_NO: d.dtl_sr_no,
            DOC_DATE: d.doc_date ? new Date(d.doc_date) : null,
            AC_CODE: d.ac_code,
            INV_NO: d.inv_no,
            INV_DATE: d.inv_date ? new Date(d.inv_date) : (header.inv_date ? new Date(header.inv_date) : null),
            AMOUNT: d.amount,
            LCUR_AMOUNT: d.lcur_amount,
            SIGN_IND: defaultInvoiceSign(d.doc_type || header.doc_type) ?? normalizeSignInd(d.sign_ind, defaultDetailSign(d.doc_type || header.doc_type)),
            CURR_CODE: d.curr_code,
            EX_RATE: d.ex_rate,
            EX_RATE_ORIGIN: d.ex_rate_origin,
            CURR_CODE_ORIGIN: d.curr_code_origin,
            AMOUNT_ORIGIN: d.amount_origin,
            INDICATOR_ORIGIN: oneChar(d.indicator_origin),
            DIV_CODE: d.div_code
          }))
        },

        p_expdetail: {
          type: "TY_TR_AC_EXPDETAIL_ACENTRY_TAB",
          val: expenseDetail.map((d: any) => ({
            COMPANY_CODE: d.company_code,
            DOC_TYPE: d.doc_type,
            DOC_NO: d.doc_no || '0',
            SERIAL_NO: d.serial_no,
            DTL_SR_NO: d.dtl_sr_no,
            DOC_DATE: d.doc_date ? new Date(d.doc_date) : null,
            AC_CODE: d.ac_code,
            EXP_TYPE_CODE: d.exp_type_code,
            EXP_SUBTYPE_CODE: d.exp_subtype_code,
            EXP_CODE: d.exp_code,
            AMOUNT: d.amount,
            SIGN_IND: normalizeSignInd(d.sign_ind, defaultDetailSign(d.doc_type || header.doc_type)),
            CURR_CODE: d.curr_code,
            EX_RATE: d.ex_rate,
            DIV_CODE: d.div_code
          }))
        },

        p_jobdetail: {
          type: "TY_TR_AC_JOBDETAIL_ACENTRY_TAB",
          val: jobDetail.map((d: any) => ({
            COMPANY_CODE: d.company_code,
            DOC_TYPE: d.doc_type,
            DOC_NO: d.doc_no || '0',
            SERIAL_NO: d.serial_no,
            DTL_SR_NO: d.dtl_sr_no,
            DOC_DATE: d.doc_date ? new Date(d.doc_date) : null,
            AC_CODE: d.ac_code,
            JOB_NO: d.job_no,
            DOC_REFNO: d.doc_refno,
            DOC_REFNO_2: d.doc_refno_2,
            AMOUNT: d.amount,
            SIGN_IND: normalizeSignInd(d.sign_ind, defaultDetailSign(d.doc_type || header.doc_type)),
            LCUR_AMOUNT: d.lcur_amount,
            CURR_CODE: d.curr_code,
            EX_RATE: d.ex_rate,
            DIV_CODE: d.div_code
          }))
        }
      },
      {
        autoCommit: false
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Account Entry saved successfully",
      data: result.outBinds
    });

  } catch (err: any) {

    if (connection) {
      try {
        await connection.rollback();
      } catch { }
    }

    res.status(500).json({
      success: false,
      message: "Transaction failed",
      details: err?.message
    });

  } finally {

    if (connection) {
      try {
        await connection.close();
      } catch { }
    }

  }
};
