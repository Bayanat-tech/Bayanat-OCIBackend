import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

export const insUpdMsLocationEdiBulk = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection;

  try {
    const locations = req.body?.locations;
    const loginid = req.body?.loginid;

    if (!Array.isArray(locations) || locations.length === 0) {
      res.status(400).json({
        success: false,
        message: "locations array is required"
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
        PROC_INS_UPD_MS_LOCATION_EDI(:p_locations);
      END;
      `,
      {
        p_locations: {
          type: "MS_LOCATION_EDI_TAB",
          val: locations.map((l: any) => ({
            COMPANY_CODE:  l.company_code,
            SITE_CODE:     l.site_code,
            LOCATION_CODE: l.location_code,
            LOC_DESC:      l.loc_desc,
            LOC_TYPE:      l.loc_type,
            LOC_STAT:      l.loc_stat,
            AISLE:         l.aisle,
            COLUMN_NO:     l.column_no,
            HEIGHT:        l.height,
            BLOCKCYC:      l.blockcyc ?? 'N',
            CREATED_BY:    loginid,
          }))
        }
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: `${locations.length} locations processed successfully`
    });

  } catch (err: any) {

    console.error("Oracle error:", err);

    res.status(500).json({
      success: false,
      message: "Bulk location procedure execution failed",
      details: err.message
    });

  } finally {
    if (connection) {
      await connection.close().catch(() => {});
    }
  }
};