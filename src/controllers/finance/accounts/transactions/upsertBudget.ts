import { Request, Response } from "express";
import oracledb from "oracledb";

import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

export const upsertBudget = async (req: Request, res: Response): Promise<void> => {
  let connection;

  try {
    const data = req.body;

    if (!data?.company_code || !data?.doc_no || !data?.ac_code || !data?.budget_year) {
      res.status(400).json({
        success: false,
        message: "company_code, doc_no, ac_code and budget_year are required"
      });
      return;
    }

    // Resolve tenant
    let tenantId: string | undefined;
    try {
      tenantId = getCurrentTenantId();
    } catch (e) {}

    if (!tenantId && data?.loginid) {
      tenantId = await TenantManager.getTenantForUser(data.loginid);
    }

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const BudgetObjType: any = await connection.getDbObjectClass("TR_AC_BUDGET_OBJ");
    const budgetData = new BudgetObjType({
      COMPANY_CODE: data.company_code,
      DOC_TYPE: data.doc_type || "BDG",
      DOC_NO: Number(data.doc_no),
      DOC_DATE: data.doc_date ? new Date(data.doc_date) : new Date(),
      BUDGET_YEAR: String(data.budget_year),
      AC_CODE: String(data.ac_code),
      JAN_AMOUNT: Number(data.JAN_BUDGET_MONTH ?? data.JAN_AMOUNT ?? 0),
      FEB_AMOUNT: Number(data.FEB_BUDGET_MONTH ?? data.FEB_AMOUNT ?? 0),
      MAR_AMOUNT: Number(data.MAR_BUDGET_MONTH ?? data.MAR_AMOUNT ?? 0),
      APR_AMOUNT: Number(data.APR_BUDGET_MONTH ?? data.APR_AMOUNT ?? 0),
      MAY_AMOUNT: Number(data.MAY_BUDGET_MONTH ?? data.MAY_AMOUNT ?? 0),
      JUN_AMOUNT: Number(data.JUN_BUDGET_MONTH ?? data.JUN_AMOUNT ?? 0),
      JUL_AMOUNT: Number(data.JUL_BUDGET_MONTH ?? data.JUL_AMOUNT ?? 0),
      AUG_AMOUNT: Number(data.AUG_BUDGET_MONTH ?? data.AUG_AMOUNT ?? 0),
      SEP_AMOUNT: Number(data.SEP_BUDGET_MONTH ?? data.SEP_AMOUNT ?? 0),
      OCT_AMOUNT: Number(data.OCT_BUDGET_MONTH ?? data.OCT_AMOUNT ?? 0),
      NOV_AMOUNT: Number(data.NOV_BUDGET_MONTH ?? data.NOV_AMOUNT ?? 0),
      DEC_AMOUNT: Number(data.DEC_BUDGET_MONTH ?? data.DEC_AMOUNT ?? 0),
      CURR_CODE: data.curr_code || "AED",
      EX_RATE: Number(data.ex_rate ?? 1),
      USER_ID: data.user_id || data.loginid || "SYSTEM",
      VERSION: data.version || "1.0",
      DIV_CODE: data.div_code || "01"
    });

    await connection.execute(
      `BEGIN PROC_UPSERT_BUDGET(:p_data); END;`,
      { p_data: budgetData }
    );

    res.json({
      success: true,
      message: "Budget data saved successfully"
    });

  } catch (err: any) {
    console.error("Oracle error:", err);
    res.status(500).json({
      success: false,
      message: "Upsert failed",
      details: err.message
    });
  } finally {
    if (connection) {
      await connection.close().catch(() => {});
    }
  }
};
