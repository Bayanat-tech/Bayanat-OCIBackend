import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

type DocAccodeRow = {
  company_code?: string;
  doc_id?: string;
  hdr_dtl?: string;
  ac_code?: string;
  div_code?: string;
};

export const delDocAccodeBulk = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection: oracledb.Connection | undefined;

  try {
    const rows = req.body?.rows;
    const loginId = req.body?.loginId;

    if (!Array.isArray(rows) || !loginId) {
      res.status(400).json({
        success: false,
        message: "rows and loginId required"
      });
      return;
    }

    let tenantId = getCurrentTenantId();
    if (!tenantId && loginId) {
      tenantId = await TenantManager.getTenantForUser(loginId);
    }

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const docAccodeTab = (rows as DocAccodeRow[]).map((row) => ({
      COMPANY_CODE: String(row.company_code || "").trim(),
      DOC_ID: String(row.doc_id || "").trim(),
      HDR_DTL: String(row.hdr_dtl || "").trim().toUpperCase().slice(0, 1),
      AC_CODE: String(row.ac_code || "").trim(),
      DIV_CODE: String(row.div_code || "").trim() || null,
    }));

    // Call native stored procedure
    await connection.execute(
      `
      BEGIN
        PROC_DEL_DOC_ACCODE(:p_loginid, :p_tab);
      END;
      `,
      {
        p_loginid: loginId,
        p_tab: {
          type: "TAB_DOC_ACCODE",
          val: docAccodeTab,
        },
      }
    );

    res.json({
      success: true,
      message: `${rows.length} Document account mapping deleted successfully`,
      deleted: rows.length
    });
  } catch (err: any) {
    console.error("Oracle Error in delDocAccodeBulk:", err);

    res.status(500).json({
      success: false,
      message: "Delete failed",
      details: err?.message || "Unknown error"
    });
  } finally {
    if (connection) await connection.close().catch(() => {});
  }
};
