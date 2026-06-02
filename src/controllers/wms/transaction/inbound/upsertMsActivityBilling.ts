import { Request, Response } from "express";
import oracledb from "oracledb";

import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

const toNumber = (val: any): number | null => {
  if (val === undefined || val === null || val === "") {
    return null;
  }

  const n = Number(val);

  return isNaN(n) ? null : n;
};

// 🔹 Safe Date Converter
const toDate = (val: any): Date | null => {
  if (!val) {
    return null;
  }

  const d = new Date(val);

  return isNaN(d.getTime()) ? null : d;
};

export const upsertMsActivityBilling = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {

    const data = req.body;

    // 🔹 Required Validation
    if (
      !data?.company_code ||
      !data?.prin_code ||
      !data?.jobtype ||
      !data?.act_code
    ) {

      res.status(400).json({
        success: false,
        message:
          "company_code, prin_code, jobtype and act_code are required"
      });

      return;
    }

    // 🔹 Resolve Tenant
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

    // 🔹 Open Connection
    connection = await TenantManager.getConnection(tenantId);

    // 🔹 Oracle Object Class
    const ActivityBillingObjClass = await connection.getDbObjectClass(
      "MS_ACTIVITY_BILLING_OBJ"
    );

    // 🔹 Create Oracle Object
    const obj: any = new ActivityBillingObjClass({

      PRIN_CODE: data.prin_code,
      ACT_CODE: data.act_code,

      WIP_CODE: data.wip_code,

      COST: toNumber(data.cost),

      INCOME_CODE: data.income_code,

      BILL_AMOUNT: toNumber(data.bill_amount),

      USER_DT: toDate(data.user_dt),

      USER_ID: data.user_id,

      JOBTYPE: data.jobtype,

      COMPANY_CODE: data.company_code,

      FREEZE_FLAG: data.freeze_flag,

      MANDATORY_FLAG: data.mandatory_flag,

      VALIDATE_FLAG: data.validate_flag,

      UOC: data.uoc,

      MOC: toNumber(data.moc),

      MOC1: data.moc1,

      MOC2: data.moc2,

      CUST_CODE: data.cust_code,

      START_POINT: data.start_point,

      END_POINT: data.end_point,

      CUSTOMER_TYPE: data.customer_type,

      VTYPE_CODE: data.vtype_code,

      SERIAL_NO: toNumber(data.serial_no),

      SERIAL_NO2: toNumber(data.serial_no2),

      SITE_IND: data.site_ind,

      INB_SHOW: data.inb_show,

      OUB_SHOW: data.oub_show,

      COST_DUP: toNumber(data.cost_dup),

      BILL_DUP: toNumber(data.bill_dup),

      EDIT_USER: data.edit_user,

      GROUP_ACT_CODE: data.group_act_code,

      UPDATED_BY: data.updated_by,

      UPDATED_AT: toDate(data.updated_at),

      CREATED_BY: data.created_by,

      CREATED_AT: toDate(data.created_at)

    });

    // 🔹 Execute Procedure
    await connection.execute(
      `BEGIN
          PROC_UPSERT_MS_ACTIVITY_BILLING(:p_data);
       END;`,
      {
        p_data: obj
      }
    );

    // 🔹 Commit
    await connection.commit();

    // 🔹 Response
    res.json({
      success: true,
      message: "Record saved successfully"
    });

  } catch (err: any) {

    console.error("Oracle Error:", err);

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