import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";



export const insUpdMsSiteEdiBulk = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection;

  try {

    const sites = req.body?.sites;

    if (!Array.isArray(sites) || sites.length === 0) {
      res.status(400).json({
        success: false,
        message: "sites array is required"
      });
      return;
    }

    let tenantId: string | undefined;

    try { tenantId = getCurrentTenantId(); } catch (e) {}

    if (!tenantId && req.body?.loginid) {
      tenantId = await TenantManager.getTenantForUser(req.body.loginid);
    }

    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    await connection.execute(
      `
      BEGIN
        PROC_INS_UPD_MS_SITE_EDI(:p_sites);
      END;
      `,
      {
        p_sites: {
          type: "MS_SITE_EDI_TAB",
          val: sites
        }
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: `${sites.length} sites processed successfully`
    });

  } catch (err: any) {

    res.status(500).json({
      success: false,
      message: "Bulk site procedure execution failed",
      details: err.message
    });

  } finally {
    if (connection) await connection.close().catch(() => {});
  }
};