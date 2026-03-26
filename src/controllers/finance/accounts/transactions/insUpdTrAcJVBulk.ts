import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

export const insUpdTrAcJVBulk = async (req: Request, res: Response): Promise<void> => {
  console.log('insUpdTrAcJVBulk called-------------'); 
  console.log('req.body:------------------', req.body); 

  let connection: oracledb.Connection | undefined;

  try {
    const header = req.body?.header;
    const details = req.body?.details;

    if (!header || !Array.isArray(details)) {
      res.status(400).json({ success: false, message: "Header and details required" });
      return;
    }

    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    // Prepare full header mapping with all columns
  const headerRow = {
  COMPANY_CODE: header.company_code ?? null,
  DOC_TYPE: header.doc_type ?? null, // Fixed as JV
  DOC_NO: header.doc_no != null ? String(header.doc_no) : null,
  DOC_DATE: header.doc_date ? new Date(header.doc_date) : null,
  AC_CODE: header.ac_code ?? null,
  BANK_AC_CODE: header.bank_ac_code ?? null,
  REF_NO: header.ref_no ?? null,
  REF_DATE: header.ref_date ? new Date(header.ref_date) : null,
  REMARKS: header.remarks ?? null,
  CURR_CODE: header.curr_code ?? null,
  EX_RATE: header.ex_rate ?? null,
  CHEQUE_NO: header.cheque_no ?? null,
  CHEQUE_DATE: header.cheque_date ? new Date(header.cheque_date) : null,
  CANCELED: header.canceled ?? null,
  CREATE_USER: header.create_user ?? null,
  EDIT_USER: header.edit_user ?? null,
  CREATE_DATE: header.create_date ? new Date(header.create_date) : null,
  EDIT_DATE: header.edit_date ? new Date(header.edit_date) : null,
  LAST_SERIAL_NO: header.last_serial_no ?? null,
  LAST_DTL_SERIAL_NO: header.last_dtl_serial_no ?? null,
  PAYMENT_TERMS: header.payment_terms ?? null,
  LPO_NO: header.lpo_no ?? null,
  LPO_DATE: header.lpo_date ? new Date(header.lpo_date) : null,
  CREDIT_PERIOD: header.credit_period ?? null,
  DUE_DATE: header.due_date ? new Date(header.due_date) : null,
  REF_DOC_NO: header.ref_doc_no ?? null,
  REF_DOC_TYPE: header.ref_doc_type ?? null,
  AC_PAYEE: header.ac_payee ?? null,
  CHEQUE_BANK: header.cheque_bank ?? null,
  PARTY_NAME: header.party_name ?? null,
  PARTY_ADDRESS: header.party_address ?? null,
  PARTY_PHONE: header.party_phone ?? null,
  PARTY_FAX: header.party_fax ?? null,
  REMITTANCE: String(header.remittance ?? 'N'),
  AUTO_REVERSE: String(header.auto_reverse ?? 'N'),
  DIV_CODE: header.div_code ?? null,
  SALESMAN_CODE: header.salesman_code ?? null,
  SECTOR_CODE: header.sector_code ?? null,
  SYS_GEN: String(header.sys_gen ?? 'M'),
  TX_CAT_CODE: header.tx_cat_code ?? 'N/A',
  TX_COMPNTCAT_CODE_1: header.tx_compntcat_code_1 ?? 'N/A',
  TX_COMPNTCAT_CODE_2: header.tx_compntcat_code_2 ?? 'N/A',
  TX_COMPNTCAT_CODE_3: header.tx_compntcat_code_3 ?? 'N/A',
  TX_COMPNTCAT_CODE_4: header.tx_compntcat_code_4 ?? 'N/A',
  TX_COMPNT_1_EXPMT: String(header.tx_compnt_1_expmt ?? 'S'),
  TX_TAX_FILED: String(header.tx_tax_filed ?? 'N'),
  TX_TAX_FILED_DT: header.tx_tax_filed_dt ? new Date(header.tx_tax_filed_dt) : null,
  TX_TAX_FILED_REFNO: header.tx_tax_filed_refno ?? null,
  TX_COMPNT_HDISC_AMT_1: header.tx_compnt_hdisc_amt_1 ?? 0,
  DOC_PATH: header.doc_path ?? null,
  RETURN_CONFIRMED: String(header.return_confirmed ?? 'N'),
  DISC_HDR_PERCENT: header.disc_hdr_percent ?? null,
  DISC_HDR_PRICE: header.disc_hdr_price ?? null,
  DEPT_CODE: header.dept_code ?? null,
  DLVR_CONTACT: header.dlvr_contact ?? null,
  DLVR_EMAIL: header.dlvr_email ?? null,
  DLVR_MOBILE: header.dlvr_mobile ?? null,
  DLVR_TERM: header.dlvr_term ?? null,
  DELIVERY_TO: header.delivery_to ?? null,
  APPROVED: String(header.approved ?? 'N'),
  APPROVED_BY: header.approved_by ?? null,
  APPROVED_DT: header.approved_dt ? new Date(header.approved_dt) : null,
  DIS_CODE: header.dis_code ?? null,
  DISC_CODE: header.disc_code ?? null,
  CANCELED_DT: header.canceled_dt ? new Date(header.canceled_dt) : null,
  WARRANTY_DESC: header.warranty_desc ?? null,
  CANCELLED_DT: header.cancelled_dt ? new Date(header.cancelled_dt) : null,
  JOB_NO: header.job_no ?? null,
  WARRANTY_PERIOD: header.warranty_period ?? null,
  WARRANTY_UOM: header.warranty_uom ?? null,
  CREATED_BY: header.created_by ?? null,
  UPDATED_BY: header.updated_by ?? null
};
    // Map details with null defaults
    const detailRows = details.map((d: any) => ({
  DOC_TYPE: header.doc_type ?? null,
  DOC_NO: d.doc_no ?? null,
  SERIAL_NO: d.serial_no ?? null,
  DOC_DATE: d.doc_date ? new Date(d.doc_date) : null,
  AC_CODE: d.ac_code ?? null,
  HEADER_AC_CODE: d.header_ac_code ?? null,
  BANK_AC_CODE: d.bank_ac_code ?? null,
  REMARKS: d.remarks ?? null,
  AMOUNT: d.amount ?? 0,
  SIGN_IND: d.sign_ind ?? 1,
  CURR_CODE: d.curr_code ?? null,
  EX_RATE: d.ex_rate ?? 1,
  LCUR_AMOUNT: d.lcur_amount ?? 0,
  PDC_IND: String(d.pdc_ind ?? 'N'),
  CHEQUE_NO: d.cheque_no ?? null,
  CHEQUE_DATE: d.cheque_date ? new Date(d.cheque_date) : null,
  CHEQUE_DESC: d.cheque_desc ?? null,
  PDC_CLEARED_DATE: d.pdc_cleared_date ? new Date(d.pdc_cleared_date) : null,
  CANCELLED: String(d.cancelled ?? 'N'),
  JOB_NO: d.job_no ?? null,
  RECON_IND: String(d.recon_ind ?? 'N'),
  RECON_DATE: d.recon_date ? new Date(d.recon_date) : null,
  COMPANY_CODE: d.company_code ?? null,
  DEPT_CODE: d.dept_code ?? null,
  QTY: d.qty ?? null,
  PRICE: d.price ?? null,
  UOM: d.uom ?? null,
  PDC_CLEAR_JVNO: d.pdc_clear_jvno ?? null,
  REF_DOC_TYPE: d.ref_doc_type ?? null,
  REF_DOC_NO: d.ref_doc_no ?? null,
  REF_DOC_SERIAL_NO: d.ref_doc_serial_no ?? null,
  DIV_CODE: d.div_code ?? null,
  TX_CAT_CODE: d.tx_cat_code ?? 'N/A',
  TX_COMPNTCAT_CODE_1: d.tx_compntcat_code_1 ?? 'N/A',
  TX_COMPNTCAT_CODE_2: d.tx_compntcat_code_2 ?? 'N/A',
  TX_COMPNTCAT_CODE_3: d.tx_compntcat_code_3 ?? 'N/A',
  TX_COMPNTCAT_CODE_4: d.tx_compntcat_code_4 ?? 'N/A',
  TX_COMPNT_PERC_1: d.tx_compnt_perc_1 ?? 0,
  TX_COMPNT_PERC_2: d.tx_compnt_perc_2 ?? 0,
  TX_COMPNT_PERC_3: d.tx_compnt_perc_3 ?? 0,
  TX_COMPNT_PERC_4: d.tx_compnt_perc_4 ?? 0,
  TX_COMPNT_AMT_1: d.tx_compnt_amt_1 ?? 0,
  TX_COMPNT_AMT_2: d.tx_compnt_amt_2 ?? 0,
  TX_COMPNT_AMT_3: d.tx_compnt_amt_3 ?? 0,
  TX_COMPNT_AMT_4: d.tx_compnt_amt_4 ?? 0,
  TX_COMPNT_LCURAMT_1: d.tx_compnt_lcuramt_1 ?? 0,
  TX_COMPNT_LCURAMT_2: d.tx_compnt_lcuramt_2 ?? 0,
  TX_COMPNT_LCURAMT_3: d.tx_compnt_lcuramt_3 ?? 0,
  TX_COMPNT_LCURAMT_4: d.tx_compnt_lcuramt_4 ?? 0,
  TX_COMPNT_1_EXPMT: String(d.tx_compnt_1_expmt ?? 'S'),
  TX_COMPNT_2_EXPMT: String(d.tx_compnt_2_expmt ?? 'S'),
  TX_COMPNT_3_EXPMT: String(d.tx_compnt_3_expmt ?? 'S'),
  TX_COMPNT_4_EXPMT: String(d.tx_compnt_4_expmt ?? 'S'),
  TX_TAX_FILED: String(d.tx_tax_filed ?? 'N'),
  TX_TAX_FILED_DT: d.tx_tax_filed_dt ? new Date(d.tx_tax_filed_dt) : null,
  TX_TAX_FILED_REFNO: d.tx_tax_filed_refno ?? null,
  TX_COMPNT_HDISC_AMT_1: d.tx_compnt_hdisc_amt_1 ?? 0,
  CREATE_USER: d.create_user ?? null,
  CREATED_BY: d.created_by ?? null,
  UPDATED_BY: d.updated_by ?? null
}));
    // Execute procedure
    await connection.execute(
      `BEGIN
         PROC_INS_UPD_TR_AC(:p_header, :p_details);
       END;`,
      {
        p_header: { type: "TR_AC_HEADER_TAB", val: [headerRow] },
        p_details: { type: "TR_AC_DETAIL_TAB", val: detailRows }
      },
      { autoCommit: false }
    );

    await connection.commit();

    res.json({ success: true, message: "Transaction saved successfully" });

  } catch (err: any) {
    console.error("Oracle Error:", err);
    if (connection) await connection.rollback();
    res.status(500).json({ success: false, message: "Transaction failed", details: err?.message || "Unknown error" });
  } finally {
    if (connection) await connection.close();
  }
};