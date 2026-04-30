import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager"
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware"

export const insUpdHrPayCompDepend = async (req: Request, res: Response): Promise<void> => {
  console.log("insUpdHrPayCompDepend called-------------");
  console.log("req.body:------------------", req.body);

  let connection: oracledb.Connection | undefined;

  try {
    const header = req.body?.header;
    const details = req.body?.details;

    if (!header || !Array.isArray(details)) {
      res.status(400).json({ success: false, message: "Header and details required" });
      return;
    }

    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    /* ================= HEADER ================= */
    const headerRow = {
      COMPANY_CODE: header.company_code ?? null,
      PAY_COMP_ID: header.pay_comp_id ?? null,
      PAY_COMP_ID_DEPEND: header.pay_comp_id_depend ?? null,
      PERCENT: Number(header.percent ?? 0),
      REMARKS: header.remarks ?? null,
      STATUS_FLAG: header.status_flag ?? 'A',
      USER_ID: header.user_id ?? null,
      USER_DT: header.user_dt ? new Date(header.user_dt) : new Date(),
      EMPR_PERCENT: Number(header.empr_percent ?? 0)
    };

    /* ================= DETAILS ================= */
    const detailRows = details.map((d: any) => ({
      COMPANY_CODE: d.company_code ?? header.company_code,
      PAY_COMP_ID: d.pay_comp_id ?? header.pay_comp_id,
      PAY_COMP_ID_DEPEND: d.pay_comp_id_depend ?? header.pay_comp_id_depend,
      NATIONALITY: d.nationality ?? null,
      AGE: Number(d.age ?? 0),
      STATUS: d.status ?? 'A',
      USER_ID: d.user_id ?? null,
      USER_DT: d.user_dt ? new Date(d.user_dt) : new Date(),
      REMARKS: d.remarks ?? null,
      AMT_LIMIT: Number(d.amt_limit ?? 0)
    }));

    /* ================= CALL PROCEDURE ================= */
    await connection.execute(
      `BEGIN
         WMSTST.PROC_INS_UPD_HR_PAYCOMP_DEP(:p_header, :p_details);
       END;`,
      {
     p_header: { type: "HR_PAYCOMP_DEP_TAB_V1", val: [headerRow] },
    p_details: { type: "HR_PAYCOMP_DEP_PARAM_TAB_V1", val: detailRows }
      },
      { autoCommit: false }
    );

    await connection.commit();

    res.json({ success: true, message: "HR Pay Component Dependency saved successfully" });

  } catch (err: any) {
    console.error("Oracle Error:", err);
    if (connection) await connection.rollback();

    res.status(500).json({
      success: false,
      message: "Transaction failed",
      details: err?.message || "Unknown error"
    });

  } finally {
    if (connection) await connection.close();
  }
};