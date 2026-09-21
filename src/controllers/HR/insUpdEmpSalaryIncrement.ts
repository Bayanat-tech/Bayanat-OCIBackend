import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

export const insUpdEmpSalaryIncrement = async (
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
        PROC_INS_UPD_EMP_SAL_INCREMENT(
          :p_data
        );
      END;
      `,
      {
        p_data: {
          type: "HR_EMP_SAL_INC_TAB",   // 👈 IMPORTANT CHANGE (collection)
          val: data.map((item: any) => ({
            COMPANY_CODE: item.company_code,
            EMPLOYEE_ID: item.employee_id,
            SLNO: item.slno,

            PAY_COMP_ID: item.pay_comp_id,
            OLD_PAY_COMP_AMT: item.old_pay_comp_amt,
            INCR_PERC: item.incr_perc,
            INCR_AMOUNT: item.incr_amount,

            EFFECTIVE_DATE: item.effective_date ? new Date(item.effective_date) : null,
            ACTUAL_EFFECTIVE_DATE: item.actual_effective_date ? new Date(item.actual_effective_date) : null,

            ARREARS_FLAG: item.arrears_flag,
            ARREARS_AMT: item.arrears_amt,

            REVISED_BY: item.revised_by,
            REVISED_ON: item.revised_on ? new Date(item.revised_on) : null,

            APPROVED_BY: item.approved_by,
            APPROVED_ON: item.approved_on ? new Date(item.approved_on) : null,

            PAY_MONTH: item.pay_month,
            PAY_YEAR: item.pay_year,

            INCREMENT_SOURCE: item.increment_source,
            WORK_DAYS_TYPE: item.work_days_type,

            REMARKS: item.remarks,
            STATUS_FLAG: item.status_flag,

            USER_ID: item.user_id,
            USER_DT: item.user_dt ? new Date(item.user_dt) : null,

            APPROVAL_STATUS: item.approval_status,
            POSTED: item.posted,

            ARREARS_PERC: item.arrears_perc,
            TRN_TYPE: item.trn_type,
            DOC_NO: item.doc_no,

            INCREMENT_TYPE: item.increment_type,
            CALLED_FROM: item.called_from,

            CURR_CODE: item.curr_code
          }))
        }
      },
      { autoCommit: false }
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: "Employee Salary Increment saved successfully"
    });

  } catch (error: any) {

    if (connection) await connection.rollback();

    res.status(500).json({
      success: false,
      message: error.message
    });

  } finally {

    if (connection) await connection.close();

  }
};