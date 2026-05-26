import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";

const toNumber = (val: any): number | null => {

  if (val === undefined || val === null || val === "") {
    return null;
  }

  const n = Number(val);

  return isNaN(n) ? null : n;

};

const toDate = (val: any): Date | null => {

  if (!val) {
    return null;
  }

  const d = new Date(val);

  return isNaN(d.getTime()) ? null : d;

};

export const upsertHrEmpComponents = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {

    const data = req.body;

    if (
      !data?.company_code ||
      !Array.isArray(data?.component_details)
    ) {

      res.status(400).json({
        success: false,
        message: "company_code and component_details are required"
      });

      return;

    }

    // Resolve Tenant
    let tenantId: string | undefined;

    try {

      tenantId = getCurrentTenantId();

    } catch {}

    if (!tenantId && data?.loginid) {

      tenantId = await TenantManager.getTenantForUser(
        data.loginid
      );

    }

    if (!tenantId) {

      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });

      return;

    }

    connection = await TenantManager.getConnection(
      tenantId
    );

    // Oracle Object Class
    const ComponentsObjClass =
      await connection.getDbObjectClass(
        "TR_HR_EMP_COMPONENTS_OBJ"
      );

    const ComponentsTabClass =
      await connection.getDbObjectClass(
        "TR_HR_EMP_COMPONENTS_TAB"
      );

    // Create Object Array
    const componentRows = data.component_details.map(
      (row: any) => {

        return new ComponentsObjClass({

          EMPLOYEE_ID: row.employee_id,

          PAY_COMP_ID: row.pay_comp_id,

          PAY_COMP_AMT: toNumber(
            row.pay_comp_amt
          ),

          PAY_COMP_PERC: toNumber(
            row.pay_comp_perc
          ),

          PAY_COMP_AMT_OLD: toNumber(
            row.pay_comp_amt_old
          ),

          ENTERED_ON: toDate(
            row.entered_on
          ),

          ENTERED_BY: row.entered_by,

          VERIFIED_ON: toDate(
            row.verified_on
          ),

          VERIFIED_BY: row.verified_by,

          APPROVED_ON: toDate(
            row.approved_on
          ),

          APPROVED_BY: row.approved_by,

          REVISED_ON: toDate(
            row.revised_on
          ),

          REVISED_BY: row.revised_by,

          FREEZED_ON: toDate(
            row.freezed_on
          ),

          FREEZED_REASON: row.freezed_reason,

          FREEZED_TILL: toDate(
            row.freezed_till
          ),

          REMARKS: row.remarks,

          STATUS_FLAG: row.status_flag,

          USER_ID: row.user_id,

          USER_DT: toDate(
            row.user_dt
          ),

          COMPANY_CODE: data.company_code,

          PAY_COMP_EARN_DED:
            row.pay_comp_earn_ded,

          PAY_ROLL_STATUS:
            row.pay_roll_status,

          COMP_STATUS:
            row.comp_status,

          ARREARS_AMT: toNumber(
            row.arrears_amt
          ),

          ARREARS_TYPE:
            row.arrears_type,

          ARREARS_POSTED:
            row.arrears_posted,

          REF_DOC_TYPE:
            row.ref_doc_type,

          REF_DOC_NO: toNumber(
            row.ref_doc_no
          ),

          PAY_COMP_AMT_VAC: toNumber(
            row.pay_comp_amt_vac
          ),

          VAC_UPDATED:
            row.vac_updated,

          SOURCE_FROM:
            row.source_from,

          SOURCE_UPDATED: toDate(
            row.source_updated
          ),

          CURR_CODE:
            row.curr_code || "OMR",

          DOC_NO: toNumber(
            row.doc_no
          )

        });

      }
    );

    const componentCollection =
      new ComponentsTabClass(componentRows);

    // Execute Procedure
    await connection.execute(
      `
      BEGIN
          PROC_UPSERT_HR_EMP_COMPONENTS(:p_data);
      END;
      `,
      {
        p_data: componentCollection
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message:
        "Employee components saved successfully"
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