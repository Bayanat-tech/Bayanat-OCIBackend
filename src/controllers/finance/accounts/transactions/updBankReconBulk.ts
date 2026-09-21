import { Request, Response } from "express";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

export const updBankReconBulk = async (
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
        PROC_UPD_TR_AC_DETAIL_RECON(:p_details);
      END;
      `,
      {
        p_details: {
          type: "TR_AC_DETAIL_RECON_TAB",
          val: details.map((d: any) => ({
            DOC_TYPE: d.doc_type,
            DOC_NO: d.doc_no,
            CHEQUE_NO: d.cheque_no,
            RECON_IND: d.recon_ind,
            RECON_DATE: d.recon_date ? new Date(d.recon_date) : null,
            COMPANY_CODE: d.company_code,
          }))
        }
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: `${details.length} records updated successfully`
    });

  } catch (err: any) {

    console.error("Oracle error:", err);

    res.status(500).json({
      success: false,
      message: "Bulk bank reconciliation update failed",
      details: err.message
    });

  } finally {

    if (connection) {
      await connection.close().catch(() => {});
    }

  }
};