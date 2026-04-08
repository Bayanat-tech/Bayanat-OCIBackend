import { Request, Response } from "express";
import oracledb from "oracledb";

import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

const toNumber = (val: any): number | null => {
  if (val === undefined || val === null || val === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
};

// 🔹 Safe Date Converter
const toDate = (val: any): Date | null => {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

export const upsertAcBudget = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {
    const data = req.body;

    if (!data?.company_code || !data?.budget_year || !data?.ac_code) {
      res.status(400).json({
        success: false,
        message: "company_code, budget_year, ac_code are required"
      });
      return;
    }

    // 🔹 Resolve tenant
    let tenantId: string | undefined;

    try {
      tenantId = getCurrentTenantId();
    } catch {}

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

    // 🔹 Get Oracle Object Class (NO schema prefix)
    const BudgetObjClass = await connection.getDbObjectClass(
      "TR_AC_BUDGET_OBJ"
    );

    // 🔹 Create object (VW format → object)
    const obj: any = new BudgetObjClass({
      COMPANY_CODE: data.company_code,

      DOC_TYPE: data.doc_type,
      DOC_NO: toNumber(data.doc_no),
      DOC_DATE: toDate(data.doc_date),

      BUDGET_YEAR: data.budget_year,
      AC_CODE: data.ac_code,

      JAN_AMOUNT: toNumber(data.jan_budget_month),
      FEB_AMOUNT: toNumber(data.feb_budget_month),
      MAR_AMOUNT: toNumber(data.mar_budget_month),
      APR_AMOUNT: toNumber(data.apr_budget_month),
      MAY_AMOUNT: toNumber(data.may_budget_month),
      JUN_AMOUNT: toNumber(data.jun_budget_month),
      JUL_AMOUNT: toNumber(data.jul_budget_month),
      AUG_AMOUNT: toNumber(data.aug_budget_month),
      SEP_AMOUNT: toNumber(data.sep_budget_month),
      OCT_AMOUNT: toNumber(data.oct_budget_month),
      NOV_AMOUNT: toNumber(data.nov_budget_month),
      DEC_AMOUNT: toNumber(data.dec_budget_month),

      CURR_CODE: data.curr_code,
      EX_RATE: toNumber(data.ex_rate),

      USER_ID: data.user_id,
      VERSION: data.version,
      DIV_CODE: data.div_code
    });

    // 🔹 Call procedure (NO schema prefix)
    await connection.execute(
      `BEGIN
         PROC_UPSERT_BUDGET(:p_data);
       END;`,
      {
        p_data: obj
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Budget saved successfully"
    });

  } catch (err: any) {
    console.error("Oracle error:", err);

    res.status(500).json({
      success: false,
      message: "Budget upsert failed",
      details: err.message
    });

  } finally {
    if (connection) {
      await connection.close().catch(() => {});
    }
  }
};