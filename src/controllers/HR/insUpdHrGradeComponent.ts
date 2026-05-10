import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

// Optional interface (you can extend later)
interface HrGradeComponent {
  company_code: string;
  grade_code: string;
  pay_comp_id: string;
  min_pay_amt?: number;
  medium_pay_amt?: number;
  max_pay_amt?: number;
  reimbursement?: string;
  min_reimb_amt?: number;
  max_reimb_amt?: number;
  remarks?: string;
  status?: string;
  user_id?: string;
  user_dt?: string;
  grade_paycomp_amt?: number;
  old_grade_paycomp_amt?: number;
  arrears_posted?: string;
  arrears_amt?: number;
  approved_date?: string;
  approval_status?: string;
  old_min_pay_amt?: number;
  old_medium_pay_amt?: number;
  old_max_pay_amt?: number;
  arrears_percent?: number;
  sort_order?: number;
}

export const insUpdHrGradeComponent = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {
    const { details } = req.body;

    // ✅ Validate input
    if (!Array.isArray(details)) {
      res.status(400).json({
        success: false,
        message: "Details array is required"
      });
      return;
    }

    // ✅ Tenant validation
    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    // ================= DETAILS MAPPING =================
    const detailRows = details.map((d: HrGradeComponent) => ({
      COMPANY_CODE: d.company_code ?? null,
      GRADE_CODE: d.grade_code ?? null,
      PAY_COMP_ID: d.pay_comp_id ?? null,

      MIN_PAY_AMT: d.min_pay_amt != null ? Number(d.min_pay_amt) : 0,
      MEDIUM_PAY_AMT: d.medium_pay_amt != null ? Number(d.medium_pay_amt) : 0,
      MAX_PAY_AMT: d.max_pay_amt != null ? Number(d.max_pay_amt) : 0,

      REIMBURSEMENT: d.reimbursement ?? null,
      MIN_REIMB_AMT: d.min_reimb_amt != null ? Number(d.min_reimb_amt) : 0,
      MAX_REIMB_AMT: d.max_reimb_amt != null ? Number(d.max_reimb_amt) : 0,

      REMARKS: d.remarks ?? null,
      STATUS: d.status ?? 'A',
      USER_ID: d.user_id ?? null,
      USER_DT: d.user_dt ? new Date(d.user_dt) : null,

      GRADE_PAYCOMP_AMT: d.grade_paycomp_amt != null ? Number(d.grade_paycomp_amt) : 0,
      OLD_GRADE_PAYCOMP_AMT: d.old_grade_paycomp_amt != null ? Number(d.old_grade_paycomp_amt) : 0,

      ARREARS_POSTED: d.arrears_posted ?? 'N',
      ARREARS_AMT: d.arrears_amt != null ? Number(d.arrears_amt) : 0,

      APPROVED_DATE: d.approved_date ? new Date(d.approved_date) : null,
      APPROVAL_STATUS: d.approval_status ?? null,

      OLD_MIN_PAY_AMT: d.old_min_pay_amt != null ? Number(d.old_min_pay_amt) : 0,
      OLD_MEDIUM_PAY_AMT: d.old_medium_pay_amt != null ? Number(d.old_medium_pay_amt) : 0,
      OLD_MAX_PAY_AMT: d.old_max_pay_amt != null ? Number(d.old_max_pay_amt) : 0,

      ARREARS_PERCENT: d.arrears_percent != null ? Number(d.arrears_percent) : 0,
      SORT_ORDER: d.sort_order != null ? Number(d.sort_order) : 0
    }));

    // ================= EXECUTE =================
    await connection.execute(
      `BEGIN
         PROC_INS_UPD_HR_GRADECOMP_V1(:p_data);
       END;`,
      {
        p_data: {
          type: "HR_GRADE_COMP_TAB_V1",
          val: detailRows
        }
      },
      { autoCommit: false }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Grade components saved successfully"
    });

  } catch (err: any) {

    console.error("ERROR:", err);

    if (connection) {
      try {
        await connection.rollback();
      } catch {}
    }

    res.status(500).json({
      success: false,
      message: "Failed to save grade components",
      details: err?.message || "Unknown error"
    });

  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch {}
    }
  }
};