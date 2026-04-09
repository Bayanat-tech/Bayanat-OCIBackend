import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

export type TMSACPLSetup = {
  COMPANY_CODE: string;
  PL_CODE: string;
  PL_NAME?: string;
  PL_TYPE?: string;
  H_CODE?: string;
  PRV_CODE?: string;
};

export const insUpdMSACPLSetup = async (req: Request, res: Response): Promise<void> => {
  let connection: oracledb.Connection | undefined;

  try {
    const { data } = req.body;

    if (!Array.isArray(data)) {
      res.status(400).json({ success: false, message: "Data array is required" });
      return;
    }

    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const oracleData = data.map((d: TMSACPLSetup) => ({
      COMPANY_CODE: d.COMPANY_CODE,
      PL_CODE: d.PL_CODE,
      PL_NAME: d.PL_NAME ?? null,
      PL_TYPE: d.PL_TYPE ?? null,
      H_CODE: d.H_CODE ?? null,
      PRV_CODE: d.PRV_CODE ?? null
    }));

    await connection.execute(
      `BEGIN
         PROC_INS_UPD_MS_AC_PLSETUP(:p_data);
       END;`,
      {
        p_data: {
          type: "MS_AC_PLSETUP_TAB",
          val: oracleData
        }
      },
      { autoCommit: true }
    );

    res.json({
      success: true,
      message: "PL Setup data saved successfully"
    });

  } catch (err: any) {
    console.error("Oracle Error:", err);

    if (connection) await connection.rollback();

    res.status(500).json({
      success: false,
      message: "Failed to save data",
      details: err?.message || "Unknown"
    });

  } finally {
    if (connection) await connection.close();
  }
};