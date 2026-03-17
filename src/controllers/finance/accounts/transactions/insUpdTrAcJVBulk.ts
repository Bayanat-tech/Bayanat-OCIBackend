import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";



export const insUpdTrAcJVBulk = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {

    const header = req.body?.header;
    const details = req.body?.details;

    if (!header || !Array.isArray(details)) {
      res.status(400).json({
        success: false,
        message: "Header and details required"
      });
      return;
    }

    // -------------------------------
    // Resolve Tenant Safely
    // -------------------------------
    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return;
    }
console.log('header',header)
console.log('details',details)
    connection = await TenantManager.getConnection(tenantId);

    // -------------------------------
    // Execute Procedure
    // -------------------------------
    await connection.execute(
      `
      BEGIN
        PROC_INS_UPD_TR_AC(:p_header, :p_details);
      END;
      `,
      {
        p_header: {
          type: "TR_AC_HEADER_TAB",
          val: [
            {
              DOC_TYPE: header.doc_type,
              DOC_NO: header.doc_no,
              DOC_DATE: header.doc_date ? new Date(header.doc_date) : null,
              AC_CODE: header.ac_code,
              BANK_AC_CODE: header.bank_ac_code,
              REF_NO: header.ref_no,
              REF_DATE: header.ref_date ? new Date(header.ref_date) : null,
              REMARKS: header.remarks,
              CURR_CODE: header.curr_code,
              EX_RATE: header.ex_rate,
              CHEQUE_NO: header.cheque_no,
              CHEQUE_DATE: header.cheque_date ? new Date(header.cheque_date) : null,
              CANCELED: header.canceled,
              CREATE_USER: header.create_user,
              EDIT_USER: header.edit_user,
              CREATE_DATE: header.create_date ? new Date(header.create_date) : null,
              EDIT_DATE: header.edit_date ? new Date(header.edit_date) : null,
              LAST_DTL_SERIAL_NO: header.last_dtl_serial_no,
              COMPANY_CODE: header.company_code,
              LAST_SERIAL_NO: header.last_serial_no,
              REF_DOC_TYPE: header.ref_doc_type,
              DIV_CODE: header.div_code,
              SALESMAN_CODE: header.salesman_code,
              SECTOR_CODE: header.sector_code,
              SYS_GEN: header.sys_gen,
              REF_DOC_NO: header.ref_doc_no
            }
          ]
        },

        p_details: {
          type: "TR_AC_DETAIL_TAB",
          val: details.map((d: any) => ({
            DOC_TYPE: d.doc_type,
            DOC_NO: d.doc_no,
            SERIAL_NO: d.serial_no,
            DOC_DATE: d.doc_date ? new Date(d.doc_date) : null,
            AC_CODE: d.ac_code,
            HEADER_AC_CODE: d.header_ac_code,
            BANK_AC_CODE: d.bank_ac_code,
            REMARKS: d.remarks,
            AMOUNT: d.amount,
            SIGN_IND: d.sign_ind,
            CURR_CODE: d.curr_code,
            EX_RATE: d.ex_rate,
            LCUR_AMOUNT: d.lcur_amount,
            PDC_IND: d.pdc_ind,
            CHEQUE_NO: d.cheque_no,
            CHEQUE_DATE: d.cheque_date ? new Date(d.cheque_date) : null,
            CHEQUE_DESC: d.cheque_desc,
            PDC_CLEARED_DATE: d.pdc_cleared_date ? new Date(d.pdc_cleared_date) : null,
            CANCELLED: d.cancelled,
            JOB_NO: d.job_no,
            RECON_IND: d.recon_ind,
            RECON_DATE: d.recon_date ? new Date(d.recon_date) : null,
            COMPANY_CODE: d.company_code,
            DEPT_CODE: d.dept_code,
            PDC_CLEAR_JVNO: d.pdc_clear_jvno,
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
            TX_COMPNT_1_EXPMT: d.tx_compnt_1_expmt,
            TX_COMPNT_2_EXPMT: d.tx_compnt_2_expmt,
            TX_COMPNT_3_EXPMT: d.tx_compnt_3_expmt,
            TX_COMPNT_4_EXPMT: d.tx_compnt_4_expmt,
            TX_COMPNT_HDISC_AMT_1: d.tx_compnt_hdisc_amt_1
          }))
        }
      },
      { autoCommit: false }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Transaction saved successfully"
    });

  } catch (err: any) {

    console.error("Oracle Error:", err);

    if (connection) {
      try {
        await connection.rollback();
      } catch {}
    }

    res.status(500).json({
      success: false,
      message: "Transaction failed",
      details: err?.message || "Unknown error"
    });

  } finally {

    if (connection) {
      try {
        await connection.close();
      } catch {}
    }

  }
};