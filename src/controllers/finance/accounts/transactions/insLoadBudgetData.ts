import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

export const insLoadBudgetData = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {

    const { details } = req.body;

    if (!Array.isArray(details) || details.length === 0) {
      res.status(400).json({
        success: false,
        message: "Details required"
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

    const rows = details.map((d: any) => ({
      DIV_CODE: d.div_code ?? null,
      COST_CODE: d.cost_code ?? null,

      EQUAL_AMOUNT:
        d.equal_amount == null || d.equal_amount === ""
          ? null
          : Number(d.equal_amount),

      TOTAL_AMOUNT:
        d.total_amount == null || d.total_amount === ""
          ? null
          : Number(d.total_amount),

      FROM_DATE:
        d.from_date
          ? new Date(d.from_date)
          : null,

      TO_DATE:
        d.to_date
          ? new Date(d.to_date)
          : null,

      REQUEST_NUMBER: d.request_number ?? null
    }));

   await connection.execute(
  `BEGIN
      PROC_INS_GT_LOAD_BUDGET_DATA(:p_data);
   END;`,
  {
    p_data: {
      type: "GT_LOAD_BUDGET_DATA_TAB",
      val: rows
    }
  },
  {
    autoCommit: false
  }
);
    await connection.commit();

    res.json({
      success: true,
      message: "Records inserted successfully"
    });

  } catch (err: any) {

    if (connection) {
      await connection.rollback();
    }

    res.status(500).json({
      success: false,
      message: err.message
    });

  } finally {

    if (connection) {
      await connection.close();
    }

  }

};