import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

export type TBTProject = {
  SUB_MODULES: string;
  ACTIVITY: string;
  WEIGHTAGE?: number;
  DEVELOPER?: string;
  START_DATE?: string | Date;
  EST_COMPLETION_DATE?: string | Date;
  END_DATE?: string | Date;
  VARIANCE?: number;
  STATUS?: string;
  RESULTS?: number;
  TESTER?: string;
  STANDARD_1?: string;
  STANDARD_2?: string;
  STANDARD_3?: string;
  STANDARD_4?: string;
  STANDARD_5?: string;
  STANDARD_6?: string;
  STANDARD_7?: string;
  RESULTS1?: number;
  OVERALL_RESULT?: number;
  OVERALL_WEIGHTAGE_ACCOMPLISHED?: number;
  ID?: number;
};

export const insUpdBTProject = async (req: Request, res: Response): Promise<void> => {
  let connection: oracledb.Connection | undefined;

  try {
    const { module, data } = req.body;
    if (!module || !Array.isArray(data)) {
      res.status(400).json({ success: false, message: "Module and data array are required" });
      return;
    }

    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    // Map JS objects to Oracle object type
    const oracleData = data.map((d: TBTProject) => ({
      SUB_MODULES: d.SUB_MODULES,
      ACTIVITY: d.ACTIVITY,
      WEIGHTAGE: d.WEIGHTAGE ?? 0,
      DEVELOPER: d.DEVELOPER ?? null,
      START_DATE: d.START_DATE ? new Date(d.START_DATE) : null,
      EST_COMPLETION_DATE: d.EST_COMPLETION_DATE ? new Date(d.EST_COMPLETION_DATE) : null,
      END_DATE: d.END_DATE ? new Date(d.END_DATE) : null,
      VARIANCE: d.VARIANCE ?? 0,
      STATUS: d.STATUS ?? null,
      RESULTS: d.RESULTS ?? 0,
      TESTER: d.TESTER ?? null,
      STANDARD_1: d.STANDARD_1 ?? null,
      STANDARD_2: d.STANDARD_2 ?? null,
      STANDARD_3: d.STANDARD_3 ?? null,
      STANDARD_4: d.STANDARD_4 ?? null,
      STANDARD_5: d.STANDARD_5 ?? null,
      STANDARD_6: d.STANDARD_6 ?? null,
      STANDARD_7: d.STANDARD_7 ?? null,
      RESULTS1: d.RESULTS1 ?? 0,
      OVERALL_RESULT: d.OVERALL_RESULT ?? 0,
      OVERALL_WEIGHTAGE_ACCOMPLISHED: d.OVERALL_WEIGHTAGE_ACCOMPLISHED ?? 0,
      MODULE: module,
      ID: d.ID ?? 0,
    }));

    await connection.execute(
      `BEGIN
         PROC_INS_UPD_BT_PROJECT(:p_module, :p_data);
       END;`,
      {
        p_module: module,
        p_data: { type: "BT_PROJECT_TAB", val: oracleData }
      },
      { autoCommit: true }
    );

    res.json({ success: true, message: "Data saved successfully" });
  } catch (err: any) {
    console.error("Oracle Error:", err);
    if (connection) await connection.rollback();
    res.status(500).json({ success: false, message: "Failed to save data", details: err?.message || "Unknown" });
  } finally {
    if (connection) await connection.close();
  }
};