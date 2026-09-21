import { Request, Response } from "express";
import oracledb from "oracledb";
import { IUser } from "../../interfaces/user.interface";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import TenantManager from "../../database/TenantManager";


export const saveLeaveSlap = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection: oracledb.Connection | undefined;

  try {
    const user = req.user as IUser;
    const {
      companyCode,
      leaveType,
      rows = [],
      loginid,
    } = req.body;

    if (!companyCode || !leaveType) {
      res.status(400).json({
        success: false,
        message: "companyCode and leaveType are required",
      });
      return;
    }

    if (!Array.isArray(rows)) {
      res.status(400).json({
        success: false,
        message: "rows must be an array",
      });
      return;
    }

    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found",
      });
      return;
    }

    const userId =
      loginid || user?.loginid || "SYSTEM";

    const jsonData = JSON.stringify(
      rows.map((r: any, index: number) => ({
        slno: r.slno ?? r.sino ?? index + 1,
        daysFrom: r.daysFrom ?? r.days_from ?? null,
        daysTo: r.daysTo ?? r.days_to ?? null,
        deductionAmount: r.deductionAmount ?? r.ded_amt ?? null,
        deductionPct: r.deductionPct ?? r.ded_per ?? null,
        calculationBase: r.calculationBase ?? r.ded_base ?? null,
        status: r.status ?? "A",
        remarks: r.remarks ?? null,
      }))
    );

    connection = await TenantManager.getConnection(tenantId);

    const result = await connection.execute(
      `
      BEGIN
        PROC_HR_LEAVE_SLAP_SAVE(
          :p_company_code,
          :p_leave_type,
          :p_user_id,
          :p_json_data,
          :p_return_msg
        );
      END;
      `,
      {
        p_company_code: {
          type: oracledb.STRING,
          dir: oracledb.BIND_IN,
          val: companyCode,
        },
        p_leave_type: {
          type: oracledb.STRING,
          dir: oracledb.BIND_IN,
          val: leaveType,
        },
        p_user_id: {
          type: oracledb.STRING,
          dir: oracledb.BIND_IN,
          val: userId,
        },
        p_json_data: {
          type: oracledb.CLOB,
          dir: oracledb.BIND_IN,
          val: jsonData,
        },
        p_return_msg: {
          type: oracledb.STRING,
          dir: oracledb.BIND_OUT,
          maxSize: 4000,
        },
      },
      {
        autoCommit: false,
      }
    );

    const returnMsg = (result.outBinds as any)?.p_return_msg as string;

    if (!returnMsg || returnMsg.startsWith("ERROR")) {
      await connection.rollback();
      res.status(500).json({
        success: false,
        message: "Leave Slap save failed",
        details: returnMsg || "Unknown error from procedure",
      });
      return;
    }

    await connection.commit();

    res.json({
      success: true,
      message: "Leave Slap saved successfully",
      data: returnMsg,
    });
  } catch (err: any) {
    if (connection) {
      try {
        await connection.rollback();
      } catch {
        /* ignore */
      }
    }

    res.status(500).json({
      success: false,
      message: "Transaction failed",
      details: err?.message,
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch {
        /* ignore */
      }
    }
  }
};