import { Request, Response, RequestHandler } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager"
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware"

// ---------- helpers ----------
const toDate = (v: any) => (v ? new Date(v) : null);
const toNumber = (v: any) => (v !== undefined && v !== null ? Number(v) : null);

// ---------- FULL OBJECT ----------
const buildEmployeeObject = (e: any) => ({
  // --- Existing fields ---
  COMPANY_CDOE: e.company_code ?? null,
  EMPLOYER_CODE: e.employer_code ?? null,
  EMPLOYEE_ID: e.employee_id ?? null,
  EMPLOYEE_CODE: e.employee_code ?? null,
  ALTERNATE_ID: e.alternate_id ?? null,
  TITLE: e.title ?? null,
  FIRST_NAME: e.first_name ?? null,
  SECOND_NAME: e.second_name ?? null,
  THIRD_NAME: e.third_name ?? null,
  FOURTH_NAME: e.fourth_name ?? null,
  LAST_NAME: e.last_name ?? null,
  FAMILY_NAME: e.family_name ?? null,
  ALIAS_NAME: e.alias_name ?? null,
  RPT_NAME: e.rpt_name ?? null,
  PPT_NAME: e.ppt_name ?? null,
  PPT_NO: e.ppt_no ?? null,
  PPT_COUNTRY: e.ppt_country ?? null,
  PPT_VALID_FROM: toDate(e.ppt_valid_from),
  PPT_VALID_TO: toDate(e.ppt_valid_to),
  PPT_STATUS: e.ppt_status ?? null,
  DESG_CODE: e.desg_code ?? null,
  LABOUR_DESG_CODE: e.labour_desg_code ?? null,
  POSITION_ID: toNumber(e.position_id),
  SUB_POSITION_ID: toNumber(e.sub_position_id),
  GRADE_CODE: e.grade_code ?? null,
  OT_ELIGIBILITY: e.ot_eligibility ?? null,
  BIRTH_DATE: toDate(e.birth_date),
  BIRTH_PLACE: e.birth_place ?? null,
  GENDER: e.gender ?? "M",
  FATHER_NAME: e.father_name ?? null,
  MOTHER_NAME: e.mother_name ?? null,
  MARRITAL_STATUS: e.marrital_status ?? null,
  SPOUSE_NAME: e.spouse_name ?? null,
  NO_OF_CHILDREN: toNumber(e.no_of_children),
  BLOOD_GROUP: e.blood_group ?? null,
  NATIONALITY: e.nationality ?? null,
  RELIGION_CODE: toNumber(e.religion_code),
  CASTE_CODE: toNumber(e.caste_code),
  COUNTRY_CODE: e.country_code ?? null,
  JOIN_DATE: toDate(e.join_date),
  PROBATION_END_DATE: toDate(e.probation_end_date),
  EMP_STATUS: e.emp_status ?? null,
  COMPANY_CODE: e.company_code ?? null,
  DIV_CODE: e.div_code ?? null,
  DEPT_CODE: e.dept_code ?? null,
  SECTION_CODE: e.section_code ?? null,
  USER_ID: e.user_id ?? null,
  USER_DT: toDate(e.user_dt),

  // --- TPersnolHr: missing fields ---
  EMP_PHOTO: e.emp_photo ?? null,
  CATEGORY_CODE: e.category_code ?? null,
  PROBATION_CONFIRM_DATE: toDate(e.probation_confirm_date),

  // --- TPayrollHr ---
  INCLUDE_IN_PAYROLL: e.include_in_payroll ?? null,
  PAYROLL_START_DATE: toDate(e.payroll_start_date),
  PAYMENT_MODE: e.payment_mode ?? null,
  COMPANY_BANK_CODE: e.company_bank_code ?? null,
  SALARY_ACCT_NO: e.salary_acct_no ?? null,
  SALARY_BANK_CODE: e.salary_bank_code ?? null,
  CURRENCY_ID: e.currency_id ?? null,
  EXCH_RATE: toNumber(e.exch_rate),
  EMP_IBAN_NO: e.emp_iban_no ?? null,

  // --- TContractHr ---
  CONTRACT_TYPE: e.contract_type ?? null,
  CONTRACT_START_DATE: toDate(e.contract_start_date),
  CONTRACT_END_DATE: toDate(e.contract_end_date),
  CONTRACT_RENEWABLE: e.contract_renewable ?? null,

  // --- TSponsorHr ---
  SPONSOR_ID: e.sponsor_id ?? null,
  VISA_TYPE: e.visa_type ?? null,
  VISA_VALID_FROM: toDate(e.visa_valid_from),
  VISA_VALID_TO: toDate(e.visa_valid_to),

  // --- TIsuranceHr ---
  INS_CARD_NO: e.ins_card_no ?? null,
  INS_CARD_ISSUE_DT: toDate(e.ins_card_issue_dt),
  INS_CARD_EXP_DT: toDate(e.ins_card_exp_dt),
  INS_CARD_TYPE: e.ins_card_type ?? null,

  // --- TILPHr ---
  LABOURCARD_NO: e.labourcard_no ?? null,
  PASI_NO: e.pasi_no ?? null,
  LABOURCARD_VALID_FROM: toDate(e.labourcard_valid_from),
  LABOURCARD_VALID_TO: toDate(e.labourcard_valid_to),
  LABOURCARD_STATUS: e.labourcard_status ?? null,

  // --- TAirfareHr ---
  AIRPORT_CODE: e.airport_code ?? null,
  TICKET_ELIGIBILITY: e.ticket_eligibility ?? null,
  TICKET_DPEND_ADULT: toNumber(e.ticket_dpend_adult),
  TA_NO: toNumber(e.ta_no),
  TC_NO: toNumber(e.tc_no),
  TI_NO: toNumber(e.ti_no),
  TICKET_ELIGIBLE_PERIOD: toNumber(e.ticket_eligible_period),

  // --- Timestamps ---
  UPDATED_AT: new Date(),
  CREATED_AT: new Date(),
});

// ---------- CONTROLLER ----------
export const insUpdHrEmployee: RequestHandler = async (req: Request, res: Response) => {

  // 🔴 FIX: use null instead of undefined
  let connection: oracledb.Connection | null = null;

  try {
    const { employee } = req.body;

    if (!employee) {
      res.status(400).json({
        success: false,
        message: "Employee object required"
      });
      return;
    }

    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return;
    }

    // ---------------- CONNECTION ----------------
    connection = await TenantManager.getConnection(tenantId);

    const empObj = buildEmployeeObject(employee);

    await connection.execute(
      `BEGIN
         PROC_INS_UPD_HR_EMPLOYEE(:p_emp);
       END;`,
      {
        p_emp: {
          type: "HR_EMP_OBJ",
          val: empObj
        }
      },
      { autoCommit: false }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Employee saved successfully"
    });

  } catch (err: any) {

    // ---------------- SAFE ROLLBACK ----------------
    if (connection) {
      try {
        await connection.rollback();
      } catch (e) {
        console.error("Rollback error:", e);
      }
    }

    res.status(500).json({
      success: false,
      message: err.message
    });

  } finally {

    // ---------------- SAFE CLOSE ----------------
    if (connection) {
      try {
        await connection.close();
      } catch (e) {
        console.error("Close error:", e);
      }
    }
  }
};