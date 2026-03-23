import { Request, Response } from "express";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import oracledb from "oracledb";

export const upsertPrepaid = async (req: Request, res: Response): Promise<void> => {

  let connection;

  try {
    const data = req.body;

    if (!data?.company_code || !data?.doc_type) {
      res.status(400).json({
        success: false,
        message: "company_code and doc_type are required"
      });
      return;
    }

    // Get tenant
    let tenantId: string | undefined;
    try { tenantId = getCurrentTenantId(); } catch (e) {}

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

    // Get connection
    connection = await TenantManager.getConnection(tenantId);

    // Get the Oracle object type class
    const TR_AC_PREPAID_OBJ = await connection.getDbObjectClass("WMSTST.TR_AC_PREPAID_OBJ");

    // Create Oracle object instance
    const objInstance = new TR_AC_PREPAID_OBJ({
      COMPANY_CODE: data.company_code,
      DOC_TYPE:     data.doc_type,
      DOC_NO:       data.doc_no,
      DOC_DATE:     data.doc_date ? new Date(data.doc_date) : null,
      DESCRIPTION:  data.description,
      REMARKS:      data.remarks,
      AMOUNT:       data.amount,
      CURR_CODE:    data.curr_code,
      EX_RATE:      data.ex_rate,
      LCUR_AMOUNT:  data.lcur_amount,
      MONTHLY_AMOUNT: data.monthly_amount,
      CREDIT_AC:    data.credit_ac,
      DEBIT_AC:     data.debit_ac,
      TOTAL_ALLOCATED_AMOUNT: data.total_allocated_amount,
      BALANCE_AMOUNT: data.balance_amount,
      USER_ID:      data.user_id,
      START_DATE:   data.start_date ? new Date(data.start_date) : null,
      END_DATE:     data.end_date ? new Date(data.end_date) : null,
      OPENING_AMOUNT: data.opening_amount,
      DAILY_RATE:   data.daily_rate,
      CURRENT_MONTH: data.current_month ? new Date(data.current_month) : null,
      AC_EXP_CODE:  data.ac_exp_code,
      EXP_SUBTYPE_CODE: data.exp_subtype_code,
      EXP_TYPE_CODE: data.exp_type_code,
      SIGN_IND:     data.sign_ind,
      GROUPING:     data.grouping,
      DIV_CODE:     data.div_code
    });

    // Call the PL/SQL procedure
    await connection.execute(
      `BEGIN
         WMSTST.PROC_UPSERT_AC_PREPAID(:p_data);
       END;`,
      {
        p_data: objInstance
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Prepaid record saved successfully"
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