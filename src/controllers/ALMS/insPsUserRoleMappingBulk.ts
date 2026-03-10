import { Request, Response } from "express";
import oracledb from "oracledb";

import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";

export const insPsUserRoleMappingBulk = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection;

  try {

    const { company_code, user_role, mappings } = req.body;

    if (!company_code || !user_role) {
      res.status(400).json({
        success: false,
        message: "company_code and user_role are required"
      });
      return;
    }

  /*  if (!Array.isArray(mappings) || mappings.length === 0) {
      res.status(400).json({
        success: false,
        message: "mappings array is required"
      });
      return;
    }*/

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
        PROC_INS_PS_USER_ROLE_MAPPING(
          :p_company_code,
          :p_user_role,
          :p_mappings
        );
      END;
      `,
      {
        p_company_code: company_code,
        p_user_role: user_role,

        p_mappings: {
          type: "MS_PS_USER_ROLE_MAP_TAB",
          val: mappings.map((m: any) => ({
            COMPANY_CODE: m.company_code,
            USER_CODE: m.user_code,
            USER_ID: m.user_id,
            USER_NAME: m.user_name,
            USER_ROLE: m.user_role
          }))
        }

      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: `${mappings.length} mappings processed successfully`
    });

  } catch (err: any) {

    console.error("Oracle error:", err);

    res.status(500).json({
      success: false,
      message: "Bulk mapping procedure execution failed",
      details: err.message
    });

  } finally {

    if (connection) {
      await connection.close().catch(() => {});
    }

  }

};