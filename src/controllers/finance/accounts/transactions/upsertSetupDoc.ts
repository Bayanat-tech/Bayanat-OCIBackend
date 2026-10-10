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

    const toStr = (v: any): string | null => {
      if (v === undefined || v === null) return null;
      const s = String(v).trim();
      return s.length > 0 ? s : null;
    };

    const toNum = (v: any): number | null => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(v);
      return isNaN(n) ? null : n;
    };

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
            COMPANY_CODE: toStr(data.company_code),
            DOC_ID: toStr(data.doc_id),
            DOC_SHORTNAME: toStr(data.doc_shortname),
            DOC_NAME: toStr(data.doc_name),
            DOC_OBJECT: toStr(data.doc_object),
            SEQ_NO: toStr(data.seq_no),
            DEFAULT_H_AC: toStr(data.default_h_ac),
            DEFAULT_D_AC: toStr(data.default_d_ac),
            DEFAULT_SIGN: toNum(data.default_sign) ?? 1,
            SIGN_EDITABLE: toStr(data.sign_editable) ?? "Y",
            LAST_DOC_NO: toNum(data.last_doc_no),
            PREPARED: toStr(data.prepared),
            VERIFIED: toStr(data.verified),
            APPROVED: toStr(data.approved),
            RECEIVED: toStr(data.received),
            BACK_DATE: toNum(data.back_date) ?? 0,
            PRIN_ON_SAVE: toStr(data.prin_on_save) ?? "N",
            DEFAULT_DIV_CODE: toStr(data.default_div_code),
            TRANS_TYPE: toStr(data.trans_type),
            DOC_CODE: toStr(data.doc_code),
            DOCNO_PREFIX: toStr(data.docno_prefix),
            DEFAULT_H_CODE_CO: toStr(data.default_h_code_co),
            CURR_CODE: toStr(data.curr_code)
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