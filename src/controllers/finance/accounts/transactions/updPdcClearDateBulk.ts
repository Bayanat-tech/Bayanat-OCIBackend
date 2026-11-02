import { Request, Response } from "express";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

export const updPdcClearDateBulk = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection;

  try {
    const details = req.body?.details;

    if (!Array.isArray(details) || details.length === 0) {
      res.status(400).json({
        success: false,
        message: "details array is required"
      });
      return;
    }

    // Resolve tenant
    let tenantId: string | undefined;
    try {
      tenantId = getCurrentTenantId();
    } catch (e) {}

    if (!tenantId && req.body?.loginid) {
      tenantId = await TenantManager.getTenantForUser(req.body.loginid);
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
        PROC_UPD_PDC_CLEAR_DATE(:p_details);
      END;
      `,
      {
        p_details: {
          type: "TR_AC_PDC_CLEAR_TAB",
          val: details.map((d: any) => ({
            COMPANY_CODE: d.company_code,
            DOC_TYPE: d.doc_type,
            DOC_NO: String(d.doc_no),
            CHEQUE_NO: d.cheque_no || null,
            CLEAR_DATE: d.clear_date ? new Date(d.clear_date) : null,
          }))
        }
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: `${details.length} Post Dated Cheque record(s) updated successfully`
    });

  } catch (err: any) {
    console.error("Oracle error in updPdcClearDateBulk:", err);

    res.status(500).json({
      success: false,
      message: "Bulk PDC clear date update failed",
      details: err.message
    });

  } finally {
    if (connection) {
      await connection.close().catch(() => {});
    }
  }
};

