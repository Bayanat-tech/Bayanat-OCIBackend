import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

export const insUpdSecPayCompAc = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {
    const { data } = req.body;

    // ================= VALIDATION =================
    if (!Array.isArray(data) || data.length === 0) {
      res.status(400).json({
        success: false,
        message: "Data array is required"
      });
      return;
    }

    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    // ================= MAP DATA =================
    const rows = data.map((d: any) => ({
      COMPANY_CODE: d.company_code ?? null,
      DIV_CODE: d.div_code ?? null,
      DEPT_CODE: d.dept_code ?? null,
      SECTION_CODE: d.section_code ?? null,
      PAY_COMP_ID: d.pay_comp_id ?? null,

      AC_CODE_DB: d.ac_code_db ?? null,
      AC_CODE_CR: d.ac_code_cr ?? null,

      USER_ID: d.user_id ?? null,
      USER_DT: d.user_dt ? new Date(d.user_dt) : null,

      REMARKS: d.remarks ?? null,

      EXP_TYPE_CODE: d.exp_type_code ?? null,
      EXP_SUBTYPE_CODE: d.exp_subtype_code ?? null,

      PAY_COMP_TYPE: d.pay_comp_type ?? null,
      PAY_COMP_EARN_DED: d.pay_comp_earn_ded ?? null,

      SEPN_FLAG: d.sepn_flag ?? "N"
    }));

    // ================= EXECUTE =================
    await connection.execute(
      `BEGIN
         PROC_INS_UPD_SEC_PAYCOMP_AC(:p_data);
       END;`,
      {
        p_data: {
          type: "HR_SEC_PAYCOMP_AC_TAB",
          val: rows
        }
      },
      { autoCommit: false }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Saved successfully"
    });

  } catch (err: any) {

    if (connection) await connection.rollback();

    res.status(500).json({
      success: false,
      message: err.message
    });

  } finally {
    if (connection) await connection.close();
  }
};