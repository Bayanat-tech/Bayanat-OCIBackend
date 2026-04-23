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

    console.log('oracleData1',data);

    const oracleData = data.map((d: any) => ({
      COMPANY_CODE: d.COMPANY_CODE ?? d.company_code ?? null,
      PL_CODE: d.PL_CODE ?? d.pl_code ?? null,
      PL_NAME: d.PL_NAME ?? d.pl_name ?? null,
      PL_TYPE: d.PL_TYPE ?? d.pl_type ?? null,
      H_CODE:  d.H_CODE  ?? d.h_code  ?? null,
      PRV_CODE:d.PRV_CODE ?? d.prv_code ?? null
    }));

    console.log('oracleData2',oracleData);

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
    )
    console.log('executing PROC_INS_UPD_MS_AC_PLSETUP');

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