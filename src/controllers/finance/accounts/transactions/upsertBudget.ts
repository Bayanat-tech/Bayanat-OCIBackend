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

    const months = [
      { name: "JAN", code: "01" },
      { name: "FEB", code: "02" },
      { name: "MAR", code: "03" },
      { name: "APR", code: "04" },
      { name: "MAY", code: "05" },
      { name: "JUN", code: "06" },
      { name: "JUL", code: "07" },
      { name: "AUG", code: "08" },
      { name: "SEP", code: "09" },
      { name: "OCT", code: "10" },
      { name: "NOV", code: "11" },
      { name: "DEC", code: "12" },
    ];

    // Prepare data for executeMany
    const binds = months.map(m => ({
      COMPANY_CODE: data.company_code,
      DOC_TYPE: data.doc_type || null,
      DOC_NO: data.doc_no,
      DOC_DATE: data.doc_date ? new Date(data.doc_date) : null,
      BUDGET_YEAR: data.budget_year,
      BUDGET_MONTH: m.code,
      AC_CODE: data.ac_code,
      BDG_AMOUNT: data[`${m.name}_BUDGET_MONTH`] || 0,
      CURR_CODE: data.curr_code || null,
      DIV_CODE: data.div_code || null
    }));

    const sql = `
      INSERT INTO TR_AC_BUDGET (
        COMPANY_CODE, DOC_TYPE, DOC_NO, DOC_DATE, BUDGET_YEAR,
        BUDGET_MONTH, AC_CODE, BDG_AMOUNT, CURR_CODE, DIV_CODE
      ) VALUES (
        :COMPANY_CODE, :DOC_TYPE, :DOC_NO, :DOC_DATE, :BUDGET_YEAR,
        :BUDGET_MONTH, :AC_CODE, :BDG_AMOUNT, :CURR_CODE, :DIV_CODE
      )
    `;

    // Bulk insert
    await connection.executeMany(sql, binds, { autoCommit: true });

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