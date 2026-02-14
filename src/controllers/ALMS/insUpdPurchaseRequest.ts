import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";

// Type for header/detail/term can be refined if using TypeScript interfaces
export const insUpdPurchaseRequest = async (req: Request, res: Response): Promise<void> => {
  let connection;

  try {
    const body = req.body;

    // Basic validation
    if (!body?.header || !body?.detail || !body?.term) {
      res.status(400).json({
        success: false,
        message: "header, detail and term arrays are required"
      });
      return;
    }

    // Tenant resolution
    let tenantId: string | undefined;
    try {
      tenantId = getCurrentTenantId();
    } catch (e) {}
    if (!tenantId && body?.loginid) {
      tenantId = await TenantManager.getTenantForUser(body.loginid);
    }

    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found for request" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    // Call the procedure
    await connection.execute(
      `
      BEGIN
        PROC_INS_UPD_PURCHASE_REQUEST(
          :p_header,
          :p_detail,
          :p_term
        );
      END;
      `,
      {
        p_header: { type: "PR_HEADER_TAB", val: body.header },
        p_detail: { type: "PR_DETAIL_TAB", val: body.detail },
        p_term: { type: "PR_TERM_TAB", val: body.term }
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Purchase request inserted/updated successfully"
    });

  } catch (err: any) {
    console.error("Oracle error:", err);
    res.status(500).json({
      success: false,
      message: "Procedure execution failed",
      details: err.message
    });
  } finally {
    if (connection) await connection.close().catch(() => {});
  }
};
