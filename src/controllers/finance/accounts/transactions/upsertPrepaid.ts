import { Request, Response } from "express";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import oracledb from "oracledb";

/**
 * Safely convert input to Oracle-compatible JS Date
 */
function toOracleDate(val: any): Date | null {
  if (!val) return null;

  try {
    // Force ISO format with time to avoid timezone issues
    const d = new Date(val.includes("T") ? val : val + "T00:00:00");

    if (isNaN(d.getTime())) {
      console.warn("Invalid date:", val);
      return null;
    }

    return d;
  } catch (err) {
    console.warn("Date parse error:", val);
    return null;
  }
}

/**
 * Safely convert numbers
 */
function toNumber(val: any): number | null {
  if (val === undefined || val === null || val === "") return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

export const upsertPrepaid = async (req: Request, res: Response): Promise<void> => {

  let connection;

  try {
    const data = req.body;

    // ✅ Required validation
    if (!data?.company_code || !data?.doc_type) {
      res.status(400).json({
        success: false,
        message: "company_code and doc_type are required"
      });
      return;
    }

    // ✅ Get tenant
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

    // ✅ Get DB connection
    connection = await TenantManager.getConnection(tenantId);

    // ✅ Get Oracle object class
    const TR_AC_PREPAID_OBJ = await connection.getDbObjectClass("TR_AC_PREPAID_OBJ");

    // 🔍 Debug incoming payload (IMPORTANT)
    console.log("Incoming Payload:", data);

    // ✅ Create Oracle object safely
    const objInstance = new TR_AC_PREPAID_OBJ({

      COMPANY_CODE: data.company_code || null,
      DOC_TYPE:     data.doc_type || null,
      DOC_NO:       toNumber(data.doc_no),

      DOC_DATE:     toOracleDate(data.doc_date),

      DESCRIPTION:  data.description || null,
      REMARKS:      data.remarks || null,

      AMOUNT:       toNumber(data.amount),
      CURR_CODE:    data.curr_code || null,
      EX_RATE:      toNumber(data.ex_rate),
      LCUR_AMOUNT:  toNumber(data.lcur_amount),
      MONTHLY_AMOUNT: toNumber(data.monthly_amount),

      CREDIT_AC:    data.credit_ac || null,
      DEBIT_AC:     data.debit_ac || null,

      TOTAL_ALLOCATED_AMOUNT: toNumber(data.total_allocated_amount),
      BALANCE_AMOUNT: toNumber(data.balance_amount),

      USER_ID:      data.user_id || null,

      START_DATE:   toOracleDate(data.start_date),
      END_DATE:     toOracleDate(data.end_date),

      OPENING_AMOUNT: toNumber(data.opening_amount),
      DAILY_RATE:   toNumber(data.daily_rate),

      CURRENT_MONTH: toOracleDate(data.current_month),

      AC_EXP_CODE:  data.ac_exp_code || null,
      EXP_SUBTYPE_CODE: data.exp_subtype_code || null,
      EXP_TYPE_CODE: data.exp_type_code || null,

      SIGN_IND:     toNumber(data.sign_ind),

      GROUPING:     data.grouping || null,
      DIV_CODE:     data.div_code || null
    });

    // 🔍 Debug object before sending
    console.log("Oracle Object:", objInstance);

    // ✅ Execute procedure with explicit binding
    await connection.execute(
      `BEGIN
         PROC_UPSERT_AC_PREPAID(:p_data);
       END;`,
      {
        p_data: {
          val: objInstance,
          dir: oracledb.BIND_IN,
          type: "TR_AC_PREPAID_OBJ"
        }
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Prepaid record saved successfully"
    });

  } catch (err: any) {

    console.error("Oracle error FULL:", err);

    res.status(500).json({
      success: false,
      message: "Upsert failed",
      details: err.message
    });

  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (e) {
        console.error("Connection close error:", e);
      }
    }
  }
};