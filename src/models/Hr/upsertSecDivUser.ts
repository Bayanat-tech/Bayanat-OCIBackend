import { Request, Response } from "express";
import oracledb from "oracledb";



import TenantManager from ".././../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";

const toDate = (val: any): Date | null => {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

export const upsertSecDivUser = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {

    const rows = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({
        success: false,
        message: "Data array is required"
      });
      return;
    }

    if (!rows[0]?.company_code) {
      res.status(400).json({
        success: false,
        message: "company_code is required"
      });
      return;
    }

    let tenantId: string | undefined;

    try {
      tenantId = getCurrentTenantId();
    } catch {}

    if (!tenantId && rows[0]?.user_id) {
      tenantId = await TenantManager.getTenantForUser(
        rows[0].user_id
      );
    }

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const ObjClass = await connection.getDbObjectClass(
      "TR_SEC_DIV_USER_OBJ"
    );

    const TabClass = await connection.getDbObjectClass(
      "TR_SEC_DIV_USER_TAB"
    );

    const objects = rows.map(
      (row: any) =>
        new ObjClass({
          COMPANY_CODE: row.company_code,
          DIV_CODE: row.div_code,
          USER_ID: row.user_id,
          REMARKS: row.remarks,
          ASSIGNED_BY: row.assigned_by,
          ASSIGNED_DATE: toDate(row.assigned_date),
          DEFAULT_DIV: row.default_div || "N"
        })
    );

    const collection = new TabClass(objects);

    await connection.execute(
      `
      BEGIN
        PROC_UPSERT_SEC_DIV_USER(:p_data);
      END;
      `,
      {
        p_data: collection
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Records saved successfully"
    });

  } catch (err: any) {

    console.error(err);

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