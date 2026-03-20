import { Request, Response } from "express";
import oracledb from "oracledb";

import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

export const upsertBankRemittance = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection;

  try {

    const data = req.body;

    if (!data?.company_code || !data?.doc_no) {
      res.status(400).json({
        success: false,
        message: "company_code and doc_no are required"
      });
      return;
    }

    // Resolve tenant
    let tenantId: string | undefined;

    try {
      tenantId = getCurrentTenantId();
    } catch (e) {}

    if (!tenantId && data?.loginid) {
      tenantId = await TenantManager.getTenantForUser(data.loginid);
    }

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
        PROC_UPSERT_BANK_REMITTANCE(:p_data);
      END;
      `,
      {
        p_data: {
          type: "TR_AC_BANKREMIT_OBJ",
          val: {
            COMPANY_CODE: data.company_code,
            DOC_TYPE: data.doc_type,
            DOC_NO: data.doc_no,

            BANK_CODE: data.bank_code,
            BANK_NAME: data.bank_name,
            BANK_ADDRESS: data.bank_address,

            DOC_DATE: data.doc_date ? new Date(data.doc_date) : null,

            BYORDER_OF: data.byorder_of,
            BYORDER_OF_ADDR: data.byorder_of_addr,

            BEN_NAME: data.ben_name,
            BEN_ADDR: data.ben_addr,

            BEN_BANK_CODE: data.ben_bank_code,
            BEN_BANK_NAME: data.ben_bank_name,
            BEN_BANK_ADDR: data.ben_bank_addr,
            BEN_SWIFT: data.ben_swift,

            CURR_CODE: data.curr_code,
            AMOUNT: data.amount,
            LCUR_AMOUNT: data.lcur_amount,

            REMARKS: data.remarks,
            PAYMENT_DETAILS: data.payment_details,

            DIV_CODE: data.div_code
          }
        }
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Bank remittance saved successfully"
    });

  } catch (err: any) {

    console.error("Oracle error:", err);

    res.status(500).json({
      success: false,
      message: "Upsert failed",
      details: err.message
    });

  } finally {

    if (connection) {
      await connection.close().catch(() => {});
    }

  }

};