import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";


const toNumOrNull = (v: unknown): number | null =>
  v === "" || v === undefined || v === null ? null : Number(v);

export const upsertHrEmpLeaveEntitle = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection: oracledb.Connection | undefined;

  try {
    const rows = Array.isArray(req.body) ? req.body : [];

    if (!rows.length) {
      res.status(400).json({ success: false, message: "No rows to save" });
      return;
    }

    if (!rows[0]?.company_code || !rows[0]?.employee_id) {
      res.status(400).json({
        success: false,
        message: "company_code and employee_id are required",
      });
      return;
    }

    let tenantId: string | undefined;
    try {
      tenantId = getCurrentTenantId();
    } catch {
      // tenant may come from body / other context
    }

    if (!tenantId && rows[0]?.user_id) {
      tenantId = await TenantManager.getTenantForUser(rows[0].user_id);
    }

    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const ObjClass = await connection.getDbObjectClass("TR_HR_EMP_LEAVE_ENTITLE_OBJ");
    const TabClass = await connection.getDbObjectClass("TR_HR_EMP_LEAVE_ENTITLE_TAB");

    const objects = rows.map(
      (row: any) =>
        new ObjClass({
          COMPANY_CODE: row.company_code ?? null,
          EMPLOYEE_ID: row.employee_id ?? null,
          LEAVE_TYPE: row.leave_type ?? null,
          LEAVE_SLAB_ID: toNumOrNull(row.leave_slab_id),
          LEAVE_DAYS: toNumOrNull(row.leave_days),
          SERVICE_DAYS: toNumOrNull(row.service_days),
          STATUS_FLAG: row.status_flag ?? null,
          REMARKS: row.remarks ?? null,
          USER_ID: row.user_id ?? null,
        })
    );

    const collection = new TabClass(objects);

    await connection.execute(
      `BEGIN
         PROC_UPSERT_HR_EMP_LEAVE_ENTITLE(:p_data);
       END;`,
      { p_data: collection }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Leave entitlement saved successfully",
    });
  } catch (err: any) {
    console.error(err);

    if (connection) {
      try {
        await connection.rollback();
      } catch {
        // ignore rollback errors
      }
    }

    res.status(500).json({
      success: false,
      message: "Upsert failed",
      details: err.message,
    });
  } finally {
    if (connection) {
      await connection.close().catch(() => {});
    }
  }
};