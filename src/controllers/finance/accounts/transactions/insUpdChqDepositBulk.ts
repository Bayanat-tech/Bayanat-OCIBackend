
import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

export const insUpdChqDepositBulk = async (
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

    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    await connection.execute(
      `
      BEGIN
        PROC_INS_UPD_CHQ_DEPOSIT(:p_header, :p_details);
      END;
      `,
      {
        p_header: {
          type: "TR_AC_CHQDEP_HDR_TAB",
          val: [
            {
              COMPANY_CODE: header.company_code,
              DOC_TYPE: header.doc_type,
              DOC_NO: header.doc_no ?? 0,
              DOC_DATE: header.doc_date ? new Date(header.doc_date) : null,
              BANK_AC_CODE: header.bank_ac_code,
              AC_CODE: header.ac_code,
              REMARKS: header.remarks,
              USER_ID: header.user_id,
              USER_DT: header.user_dt ? new Date(header.user_dt) : null,
              DIV_CODE: header.div_code
            }
          ]
        },

        p_details: {
          type: "TR_AC_CHQDEP_DTL_TAB",
          val: details.map((d: any) => ({
            COMPANY_CODE: d.company_code,
            DOC_TYPE: d.doc_type,
            DOC_NO: d.doc_no,
            SERIAL_NO: d.serial_no,
            CHEQUE_NO: d.cheque_no,
            CHEQUE_DATE: d.cheque_date ? new Date(d.cheque_date) : null,
            CHEQUE_BANK: d.cheque_bank,
            CURR_CODE: d.curr_code,
            AMOUNT: d.amount,
            REF_DOC_TYPE: d.ref_doc_type,
            REF_DOC_NO: d.ref_doc_no,
            USER_ID: d.user_id,
            USER_DT: d.user_dt ? new Date(d.user_dt) : null,
            DIV_CODE: d.div_code
          }))
        }
      },
      { autoCommit: false }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Cheque Deposit saved successfully"
    });

  } catch (err: any) {

    if (connection) {
      try { await connection.rollback(); } catch {}
    }

    res.status(500).json({
      success: false,
      message: "Transaction failed",
      details: err?.message
    });

  } finally {

    if (connection) {
      try { await connection.close(); } catch {}
    }

  }
};