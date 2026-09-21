import { Request, Response } from "express";
import oracledb from "oracledb";

import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

const toNumber = (val: any): number | null => {
  if (val === undefined || val === null || val === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
};

const toDate = (val: any): Date | null => {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

export const upsertHrDocTypes = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {
    const data = req.body;

    if (!data?.company_code || !data?.doctype_name || !data?.status_flag) {
      res.status(400).json({
        success: false,
        message: "company_code, doctype_name, status_flag are required"
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

    // 🔹 Get Object
    const ObjClass = await connection.getDbObjectClass(
      "MS_HR_DOCTYPES_OBJ"
    );
    if (data.doc_type && String(data.doc_type).length > 5) {
  res.status(400).json({
    success: false,
    message: "doc_type must not exceed 5 characters"
  });
  return;
}
    const obj: any = new ObjClass({
      COMPANY_CODE: data.company_code,
      DOC_TYPE: data.doc_type, // null for insert
      DOCTYPE_NAME: data.doctype_name,
      DOCTYPE_SHORT_DESC: data.doctype_short_desc,

      RENEWAL_PERIOD_DAYS: toNumber(data.renewal_period_days),
      RENEWAL_CHGS: toNumber(data.renewal_chgs),

      MAND_FLAG: data.mand_flag,
      ATTACH_FOLDER: data.attach_folder,
      ATTACH_PREFIX: data.attach_prefix,
      ATTACH_TYPE: data.attach_type,

      DOC_NOTES: data.doc_notes,
      DOC_EDITABLE: data.doc_editable,

      EMAIL_ID_FOR_ALERTS: data.email_id_for_alerts,
      ALERT_BEFORE: toNumber(data.alert_before),

      STATUS_FLAG: data.status_flag,
      USER_DT: toDate(data.user_dt),
      USER_ID: data.user_id
    });

    await connection.execute(
      `BEGIN
         PROC_UPSERT_MS_HR_DOCTYPES(:p_data);
       END;`,
      { p_data: obj }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "HR DocType saved successfully"
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