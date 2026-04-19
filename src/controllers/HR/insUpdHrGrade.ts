import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

// Optional: Types for better safety
interface HrGradeHeader {
  company_code: string;
  grade_code: string;
  grade_name: string;
  grade_short_name?: string;
  ot_eligibility?: string;
  airfare_entitlement?: string;
  spouse_af_entitlement?: string;
  dep_af_entitlement?: string;
  medical_entitlement?: string;
  spouse_med_entitlement?: string;
  dep_med_entitlement?: string;
  remarks?: string;
  status?: string;
  user_id?: string;
  user_dt?: string;
  type?: string;
  grade_status?: string;
  main_grade_code?: string;
  def_grade_code?: string;
}

export const insUpdHrGrade = async (req: Request, res: Response): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {
    const { header, details } = req.body;

    // ✅ Validate input
    if (!header || !Array.isArray(details)) {
      res.status(400).json({
        success: false,
        message: "Header and details are required"
      });
      return;
    }

    // ✅ Tenant validation (FIXED ERROR)
    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    // ✅ Header mapping
    const headerRow = {
      COMPANY_CODE: header.company_code ?? null,
      GRADE_CODE: header.grade_code ?? null,
      GRADE_NAME: header.grade_name ?? null,
      GRADE_SHORT_NAME: header.grade_short_name ?? null,
      OT_ELIGIBILITY: header.ot_eligibility ?? 'N',
      AIRFARE_ENTITLEMENT: header.airfare_entitlement ?? 'N',
      SPOUSE_AF_ENTITLEMENT: header.spouse_af_entitlement ?? 'N',
      DEP_AF_ENTITLEMENT: header.dep_af_entitlement ?? 'N',
      MEDICAL_ENTITLEMENT: header.medical_entitlement ?? 'N',
      SPOUSE_MED_ENTITLEMENT: header.spouse_med_entitlement ?? 'N',
      DEP_MED_ENTITLEMENT: header.dep_med_entitlement ?? 'N',
      REMARKS: header.remarks ?? null,
      STATUS: header.status ?? 'A',
      USER_ID: header.user_id ?? null,
      USER_DT: header.user_dt ? new Date(header.user_dt) : null,
      TYPE: header.type ?? null,
      GRADE_STATUS: header.grade_status ?? null,
      MAIN_GRADE_CODE: header.main_grade_code ?? null,
      DEF_GRADE_CODE: header.def_grade_code ?? null
    };

    // ✅ Detail mapping
    const detailRows = details.map((d: any) => ({
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

    // ✅ Execute procedure
    await connection.execute(
      `BEGIN
         PROC_INS_UPD_HR_GRADE(:p_header, :p_details);
       END;`,
      {
        p_header: { type: "HR_GRADE_TAB", val: [headerRow] },
        p_details: { type: "HR_GRADE_COMP_TAB", val: detailRows }
      },
      { autoCommit: false }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Grade saved successfully"
    });

  } catch (err: any) {

    console.error("ERROR:", err);

    if (connection) {
      try { await connection.rollback(); } catch {}
    }

    res.status(500).json({
      success: false,
      message: "Failed to save grade",
      details: err?.message || "Unknown error"
    });

  } finally {
    if (connection) {
      try { await connection.close(); } catch {}
    }
  }
};