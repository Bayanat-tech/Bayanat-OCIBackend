import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";

export const insUpdMsApproverLevels = async (
  req: Request,
  res: Response
): Promise<void> => {
  console.log("insUpdMsApproverLevels called----------------");
  console.log("req.body----------------", req.body);

  let connection: oracledb.Connection | undefined;

  try {
    const rows = req.body?.rows;

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({
        success: false,
        message: "Rows are required."
      });
      return;
    }

    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found."
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    // Map data for Oracle Object Type
    const approverRows = rows.map((r: any) => ({
      COMPANY_CODE: r.company_code ?? null,
      PROCESS: r.process ?? null,
      LEVEL1_ROLE: r.level1_role ?? null,
      LEVEL2_ROLE: r.level2_role ?? null,
      LEVEL3_ROLE: r.level3_role ?? null,
      LEVEL4_ROLE: r.level4_role ?? null,
      LEVEL5_ROLE: r.level5_role ?? null,
      LAST_LEVEL:
        r.last_level !== undefined &&
        r.last_level !== null &&
        r.last_level !== ""
          ? Number(r.last_level)
          : 0
    }));

    await connection.execute(
      `
      BEGIN
          PROC_INS_UPD_MS_APPROVER_LEVELS(:p_data);
      END;
      `,
      {
        p_data: {
          type: "MS_APPROVER_LEVEL_TAB",
          val: approverRows
        }
      },
      {
        autoCommit: false
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Approver Levels saved successfully."
    });

  } catch (err: any) {
    console.error("Oracle Error:", err);

    if (connection) {
      await connection.rollback();
    }

    res.status(500).json({
      success: false,
      message: "Failed to save Approver Levels.",
      details: err?.message || "Unknown error"
    });

  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing connection:", err);
      }
    }
  }
};