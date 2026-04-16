import { Request, Response } from "express";
import oracledb from "oracledb";

import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

export const upsertSetupDoc = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection;

  try {

    const data = req.body;

    if (!data?.company_code || !data?.doc_id) {
      res.status(400).json({
        success: false,
        message: "company_code and doc_id are required"
      });
      return;
    }

    // Resolve tenant
    let tenantId: string | undefined;

    try {
      tenantId = getCurrentTenantId();
    } catch {}

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
        PROC_UPSERT_SETUP_DOC(:p_data);
      END;
      `,
      {
        p_data: {
          type: "TR_AC_SETUP_DOC_OBJ",
          val: {
            COMPANY_CODE: data.company_code,
            DOC_ID: data.doc_id,
            DOC_SHORTNAME: data.doc_shortname,
            DOC_NAME: data.doc_name,
            DOC_OBJECT: data.doc_object,
            SEQ_NO: data.seq_no,
            DEFAULT_H_AC: data.default_h_ac,
            DEFAULT_D_AC: data.default_d_ac,
            DEFAULT_SIGN: data.default_sign,
            SIGN_EDITABLE: data.sign_editable,
            LAST_DOC_NO: data.last_doc_no,
            PREPARED: data.prepared,
            VERIFIED: data.verified,
            APPROVED: data.approved,
            RECEIVED: data.received,
            BACK_DATE: data.back_date,
            PRIN_ON_SAVE: data.prin_on_save,
            DEFAULT_DIV_CODE: data.default_div_code,
            TRANS_TYPE: data.trans_type,
            DOC_CODE: data.doc_code,
            DOCNO_PREFIX: data.docno_prefix,
            DEFAULT_H_CODE_CO: data.default_h_code_co,
            CURR_CODE: data.curr_code
          }
        }
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Setup document saved successfully"
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