import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

// ─── Types ───────────────────────────────────────────────────────────────────

interface HrGradeHeader {
  company_code: string;
  grade_code?: string;          // optional now — blank/undefined means "generate on insert"
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

const GRADE_CODE_LENGTH = 3; 

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns the next zero-padded grade code for a company, e.g. "001", "002".
 * Reads MAX(GRADE_CODE) for numeric-looking codes only, so manually entered
 * non-numeric codes (if any existed historically) are ignored safely.
 */
async function getNextGradeCode(connection: oracledb.Connection, companyCode: string): Promise<string> {
  const result = await connection.execute<{ NEXT_CODE: number }>(
    `SELECT NVL(MAX(TO_NUMBER(GRADE_CODE)), 0) + 1 AS NEXT_CODE
       FROM MS_HR_GRADE
      WHERE COMPANY_CODE = :companyCode
        AND REGEXP_LIKE(GRADE_CODE, '^[0-9]+$')`,
    { companyCode },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );

  const nextValue = (result.rows?.[0] as { NEXT_CODE: number } | undefined)?.NEXT_CODE ?? 1;
  return String(nextValue).padStart(GRADE_CODE_LENGTH, "0");
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

// ─── Controller ──────────────────────────────────────────────────────────────

export const insUpdHrGrade = async (req: Request, res: Response): Promise<void> => {
  let connection: oracledb.Connection | undefined;

  try {
    const { header, details } = req.body as { header: HrGradeHeader; details: unknown[] };

    // ✅ Validate input shape
    if (!header || typeof header !== "object") {
      res.status(400).json({ success: false, message: "Header is required" });
      return;
    }
    if (!Array.isArray(details)) {
      res.status(400).json({ success: false, message: "Details must be an array" });
      return;
    }
    if (isBlank(header.company_code)) {
      res.status(400).json({ success: false, message: "Company code is required" });
      return;
    }
    if (isBlank(header.grade_name)) {
      res.status(400).json({ success: false, message: "Grade name is required" });
      return;
    }

    // ✅ Tenant validation
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    
    const isNewGrade = isBlank(header.grade_code);
    const resolvedGradeCode = isNewGrade
      ? await getNextGradeCode(connection, header.company_code)
      : String(header.grade_code).trim();

    // ✅ Header mapping
    const headerRow = {
      COMPANY_CODE: header.company_code,
      GRADE_CODE: resolvedGradeCode,
      GRADE_NAME: header.grade_name,
      GRADE_SHORT_NAME: header.grade_short_name ?? null,
      OT_ELIGIBILITY: header.ot_eligibility ?? "N",
      AIRFARE_ENTITLEMENT: header.airfare_entitlement ?? "N",
      SPOUSE_AF_ENTITLEMENT: header.spouse_af_entitlement ?? "N",
      DEP_AF_ENTITLEMENT: header.dep_af_entitlement ?? "N",
      MEDICAL_ENTITLEMENT: header.medical_entitlement ?? "N",
      SPOUSE_MED_ENTITLEMENT: header.spouse_med_entitlement ?? "N",
      DEP_MED_ENTITLEMENT: header.dep_med_entitlement ?? "N",
      REMARKS: header.remarks ?? null,
      STATUS: header.status ?? "A",
      USER_ID: header.user_id ?? null,
      USER_DT: header.user_dt ? new Date(header.user_dt) : null,
      TYPE: header.type ?? null,
      GRADE_STATUS: header.grade_status ?? null,
      MAIN_GRADE_CODE: header.main_grade_code ?? null,
      DEF_GRADE_CODE: header.def_grade_code ?? null,
    };

    
    const detailRows = (details as Record<string, unknown>[]).map((d) => ({
      COMPANY_CODE: d.company_code ?? header.company_code,
      GRADE_CODE: resolvedGradeCode,
      PAY_COMP_ID: d.pay_comp_id ?? null,
      MIN_PAY_AMT: d.min_pay_amt != null ? Number(d.min_pay_amt) : 0,
      MEDIUM_PAY_AMT: d.medium_pay_amt != null ? Number(d.medium_pay_amt) : 0,
      MAX_PAY_AMT: d.max_pay_amt != null ? Number(d.max_pay_amt) : 0,
      REIMBURSEMENT: d.reimbursement ?? null,
      MIN_REIMB_AMT: d.min_reimb_amt != null ? Number(d.min_reimb_amt) : 0,
      MAX_REIMB_AMT: d.max_reimb_amt != null ? Number(d.max_reimb_amt) : 0,
      REMARKS: d.remarks ?? null,
      STATUS: d.status ?? "A",
      USER_ID: d.user_id ?? null,
      USER_DT: d.user_dt ? new Date(d.user_dt as string) : null,
      GRADE_PAYCOMP_AMT: d.grade_paycomp_amt != null ? Number(d.grade_paycomp_amt) : 0,
      OLD_GRADE_PAYCOMP_AMT: d.old_grade_paycomp_amt != null ? Number(d.old_grade_paycomp_amt) : 0,
      ARREARS_POSTED: d.arrears_posted ?? "N",
      ARREARS_AMT: d.arrears_amt != null ? Number(d.arrears_amt) : 0,
      APPROVED_DATE: d.approved_date ? new Date(d.approved_date as string) : null,
      APPROVAL_STATUS: d.approval_status ?? null,
      OLD_MIN_PAY_AMT: d.old_min_pay_amt != null ? Number(d.old_min_pay_amt) : 0,
      OLD_MEDIUM_PAY_AMT: d.old_medium_pay_amt != null ? Number(d.old_medium_pay_amt) : 0,
      OLD_MAX_PAY_AMT: d.old_max_pay_amt != null ? Number(d.old_max_pay_amt) : 0,
      ARREARS_PERCENT: d.arrears_percent != null ? Number(d.arrears_percent) : 0,
      SORT_ORDER: d.sort_order != null ? Number(d.sort_order) : 0,
    }));

    // ✅ Execute procedure
    await connection.execute(
      `BEGIN
         PROC_INS_UPD_HR_GRADE(:p_header, :p_details);
       END;`,
      {
        p_header: { type: "HR_GRADE_TAB", val: [headerRow] },
        p_details: { type: "HR_GRADE_COMP_TAB_V1", val: detailRows },
      },
      { autoCommit: false },
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Grade saved successfully",
      data: { grade_code: resolvedGradeCode }, 
    });
  } catch (err: any) {
    console.error("ERROR:", err);

    if (connection) {
      try {
        await connection.rollback();
      } catch {
        /* ignore rollback failure */
      }
    }

    // ✅ Surface a PK-collision (rare race condition) as a clear, retryable error
    const isUniqueViolation = err?.errorNum === 1 || /ORA-00001/.test(err?.message ?? "");
    res.status(isUniqueViolation ? 409 : 500).json({
      success: false,
      message: isUniqueViolation
        ? "Grade code was just taken by another request. Please try saving again."
        : "Failed to save grade",
      details: err?.message || "Unknown error",
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch {
        /* ignore close failure */
      }
    }
  }
};