
import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

export const insDocAccodeBulk = async (
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

    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    // 🔹 Map rows
    const mappedRows = rows.map((d: any) => ({
      COMPANY_CODE: d.company_code ?? null,
      DOC_ID: d.doc_id ?? null,
      HDR_DTL: d.hdr_dtl ?? null,
      AC_CODE: d.ac_code ?? null,
      DIV_CODE: d.div_code ?? null
    }));

    await connection.execute(
      `BEGIN
         PROC_INS_DOC_ACCODE(
           :p_loginid,
           :p_tab
         );
       END;`,
      {
        p_loginid: loginId,
        p_tab: { type: "TAB_DOC_ACCODE", val: mappedRows }
      },
      { autoCommit: true }
    );

    res.json({
      success: true,
      message: "Document Account Codes inserted successfully"
    });

  } catch (err: any) {
    console.error("Oracle Error:", err);

    if (connection) await connection.rollback();

    res.status(500).json({
      success: false,
      message: "Transaction failed",
      details: err?.message || "Unknown error"
    });

  } finally {
    if (connection) await connection.close();
  }
};