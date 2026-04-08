import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

export const insUpdAcExpTypeBulk = async (req: Request, res: Response): Promise<void> => {
  console.log("insUpdAcExpTypeBulk called-------------");
  console.log("req.body:------------------", req.body);

  let connection: oracledb.Connection | undefined;

  try {
    const expsubtypes = req.body?.expsubtypes;
    const expcodes = req.body?.expcodes;
    const loginId = req.body?.loginId;

    if (!Array.isArray(expsubtypes) || !Array.isArray(expcodes) || !loginId) {
      res.status(400).json({ success: false, message: "expsubtypes, expcodes, and loginId required" });
      return;
    }

    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    // Map EXPSUBTYPE array
    const expsubtypeRows = expsubtypes.map((d: any) => ({
      COMPANY_CODE: d.company_code ?? null,
      EXP_SUBTYPE_CODE: d.exp_subtype_code ?? null,
      EXP_SUBTYPE_DESCRIPTION: d.exp_subtype_description ?? null,
      EXP_TYPE_CODE: d.exp_type_code ?? null,
      DEPT_CODE: d.dept_code ?? null,
      CREATED_BY: null, // procedure will set loginId
      CREATED_AT: null,
      UPDATED_BY: null,
      UPDATED_AT: null
    }));

    // Map EXPCODE array
    const expcodeRows = expcodes.map((d: any) => ({
      COMPANY_CODE: d.company_code ?? null,
      EXP_TYPE_CODE: d.exp_type_code ?? null,
      EXP_CODE: d.exp_code ?? null,
      EXP_DESCRIPTION: d.exp_description ?? null,
      REF_CODE: d.ref_code ?? null,
      CREATED_BY: null, // procedure will set loginId
      CREATED_AT: null,
      UPDATED_BY: null,
      UPDATED_AT: null
    }));

    // Execute procedure
    await connection.execute(
      `BEGIN
         PROC_INS_UPD_AC_EXPSTYPE(
           :p_loginid,
           :p_expsubtype_tab,
           :p_expcode_tab
         );
       END;`,
      {
        p_loginid: loginId,
        p_expsubtype_tab: { type: "TAB_EXPSUBTYPE", val: expsubtypeRows },
        p_expcode_tab: { type: "TAB_EXPCODE", val: expcodeRows }
      },
      { autoCommit: true }
    );

    res.json({ success: true, message: "Expense subtypes and codes saved successfully" });

  } catch (err: any) {
    console.error("Oracle Error:", err);
    if (connection) await connection.rollback();
    res.status(500).json({ success: false, message: "Transaction failed", details: err?.message || "Unknown error" });
  } finally {
    if (connection) await connection.close();
  }
};