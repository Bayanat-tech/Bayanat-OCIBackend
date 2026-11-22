import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

export const generateAbsentMemoDaily = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {
    const { company_code, user_id, doc_type, record_date } = req.body ?? {};

    if (!company_code || !user_id) {
      res.status(400).json({
        success: false,
        message: "company_code and user_id are required"
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

    // ================= PARAMS =================
    // Optional params are passed only when supplied, so the procedure's own
    // DEFAULTs ('ABM' and TRUNC(SYSDATE) - 1) still apply.
    const binds: Record<string, unknown> = {
      company_code,
      user_id
    };
    let args = "p_company_code => :company_code, p_user_id => :user_id";

    if (doc_type) {
      binds.doc_type = doc_type;
      args += ", p_doc_type => :doc_type";
    }

    if (record_date) {
      const parsed = new Date(record_date);
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({
          success: false,
          message: "record_date is invalid. Use YYYY-MM-DD"
        });
        return;
      }
      binds.record_date = parsed;
      args += ", p_record_date => :record_date";
    }

    connection = await TenantManager.getConnection(tenantId);

    // ================= EXECUTE =================
    // The procedure COMMITs / ROLLBACKs internally.
    await connection.execute(
      `BEGIN
         PROC_GENERATE_ABSENT_MEMO_DAILY(${args});
       END;`,
      binds as oracledb.BindParameters,
      { autoCommit: false }
    );

    res.json({
      success: true,
      message: "Absent Memo documents generated successfully"
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