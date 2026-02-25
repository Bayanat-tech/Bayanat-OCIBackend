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
    const loginid = req.body?.loginid;

    if (!Array.isArray(sites) || sites.length === 0) {
      res.status(400).json({
        success: false,
        message: "sites array is required"
      });
      return;
    }

    // Resolve tenant
    let tenantId: string | undefined;

    try {
      tenantId = getCurrentTenantId();
    } catch (e) {}

    if (!tenantId && loginid) {
      tenantId = await TenantManager.getTenantForUser(loginid);
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
        PROC_INS_UPD_MS_SITE_EDI(:p_sites);
      END;
      `,
      {
        p_sites: {
          type: "MS_SITE_EDI_TAB",
          val: sites.map((s: any) => ({
            SITE_CODE:     s.site_code,
            SITE_IND:      s.site_ind,
            SITE_TYPE:     s.site_type,
            SITE_NAME:     s.site_name,
            SITE_ADDR1:    s.site_addr1,
            SITE_ADDR2:    s.site_addr2,
            SITE_ADDR3:    s.site_addr3,
            SITE_ADDR4:    s.site_addr4,
            CITY:          s.city,
            COUNTRY_CODE:  s.country_code,
            CONTACT_NAME:  s.contact_name,
            TEL_NO:        s.tel_no,
            CHARGE_IND:    s.charge_ind,
            PRIN_CODE:     s.prin_code,
            GROUP_CODE:    s.group_code,
            LOC_TYPE:      s.loc_type,
            COMPANY_CODE:  s.company_code,
            DIV_CODE:      s.div_code,
            SITE_RPT_NAME: s.site_rpt_name,
            CREATED_BY: loginid
          }))
        }
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: `${sites.length} sites processed successfully`
    });

  } catch (err: any) {

    console.error("Oracle error:", err);

    res.status(500).json({
      success: false,
      message: "Bulk site procedure execution failed",
      details: err.message
    });

  } finally {
    if (connection) {
      await connection.close().catch(() => {});
    }
  }
};