

import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

export const insUpdGradeSalaryIncrement = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {

    const data = req.body;

    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    await connection.execute(
      `
      BEGIN
        PROC_INS_UPD_GRADE_SAL_INCREMENT(
          :p_data
        );
      END;
      `,
      {
        p_data: {
          type: "HR_GRADE_SAL_INC_TAB",   // 👈 CHANGED TO COLLECTION TYPE
          val: data.map((item: any) => ({

            COMPANY_CODE: item.company_code,
            GRADE_CODE: item.grade_code,
            PAY_COMP_ID: item.pay_comp_id,

            OLD_GRADE_AMT: item.old_grade_amt,
            PERC_INCREMENT: item.perc_increment,
            AMT_INCREMENT: item.amt_increment,

            INCREMENTED_BY: item.incremented_by,

            INCREMENTED_ON: item.incremented_on
              ? new Date(item.incremented_on)
              : null,

            APPROVED_BY: item.approved_by,

            APPROVED_ON: item.approved_on
              ? new Date(item.approved_on)
              : null,

            ARREARS_FLAG: item.arrears_flag,
            ARREARS_AMT: item.arrears_amt,

            EFFECTIVE_DATE: item.effective_date
              ? new Date(item.effective_date)
              : null,

            ACTUAL_EFFECTIVE_DATE: item.actual_effective_date
              ? new Date(item.actual_effective_date)
              : null,

            USER_ID: item.user_id,

            USER_DT: item.user_dt
              ? new Date(item.user_dt)
              : null,

            VERIFIED_BY: item.verified_by,

            VERIFIED_ON: item.verified_on
              ? new Date(item.verified_on)
              : null,

            STATUS: item.status,
            REMARKS: item.remarks,
            APPROVAL_STATUS: item.approval_status,
            POSTED: item.posted,

            ARREARS_PERCENT: item.arrears_percent,
            POSTED_TO_EMP_INCR: item.posted_to_emp_incr,

            SLNO: item.slno,

            INCREMENT_TYPE: item.increment_type

          }))
        }
      },
      {
        autoCommit: false
      }
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: "Grade Salary Increment saved successfully"
    });

  } catch (error: any) {

    if (connection) {
      await connection.rollback();
    }

    res.status(500).json({
      success: false,
      message: error.message
    });

  } finally {

    if (connection) {
      await connection.close();
    }

  }
};