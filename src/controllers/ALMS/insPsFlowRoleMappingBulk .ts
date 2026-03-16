import { Request, Response } from "express";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";

export const insPsFlowRoleMappingBulk = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection;

  try {

    const { company_code, flow_code, mappings } = req.body;

    if (!company_code || !flow_code) {
      res.status(400).json({
        success: false,
        message: "company_code and flow_code are required"
      });
      return;
    }

    let tenantId: string | undefined;

    try {
      tenantId = getCurrentTenantId();
    } catch {}

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
        PROC_INS_PS_FLOW_ROLE_MAPPING(
          :p_company_code,
          :p_flow_code,
          :p_mappings
        );
      END;
      `,
      {
        p_company_code: company_code,
        p_flow_code: flow_code,

        p_mappings: {
          type: "MS_PS_FLOW_ROLE_MAP_TAB",
          val: mappings.map((m: any) => ({
            FLOW_CODE: m.flow_code,
            FLOW_LEVEL: m.flow_level,
            FLOW_ROLE: m.flow_role,
            CONDITION1: m.condition1,
            COMPANY_CODE: m.company_code,
            USER_ID: m.user_id
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
      message: "Bulk flow role mapping failed",
      details: err.message
    });

  } finally {

    if (connection) {
      await connection.close().catch(() => {});
    }

  }

};