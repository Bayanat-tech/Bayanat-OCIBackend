import { Request, Response } from "express";
import oracledb from "oracledb";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import TenantManager from "../../database/TenantManager";

const toDate = (value: any): Date | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: ${value}`);
  }

  return date;
};

const toNumber = (value: any): number | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    throw new Error(`Invalid number value: ${value}`);
  }

  return numberValue;
};

export const insUpdHrSalaryAdvDed = async (
  req: Request,
  res: Response
): Promise<void> => {
  console.log("insUpdHrSalaryAdvDed called-------------");
  console.log("req.body:------------------", req.body);

  let connection: oracledb.Connection | undefined;

  try {
    const header = req.body?.header;
    const details = req.body?.details;

    if (!header) {
      res.status(400).json({
        success: false,
        message: "Header is required",
      });
      return;
    }

    if (!Array.isArray(details)) {
      res.status(400).json({
        success: false,
        message: "Details array is required",
      });
      return;
    }

    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found",
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    /*
     * ============================================================
     * HEADER
     * ============================================================
     *
     * DOC_TYPE intentionally hard-coded as ADV.
     */
    const headerRow = {
      COMPANY_CODE: header.company_code ?? null,

      // HARD CODE
      DOC_TYPE: "SA",

      DOC_NO: toNumber(header.doc_no),
      DOC_DATE: toDate(header.doc_date),

      REF_NO: header.ref_no ?? null,
      NAME_FROM: header.name_from ?? null,
      ADDR_FROM: header.addr_from ?? null,
      NAME_TO: header.name_to ?? null,
      ADDR_TO: header.addr_to ?? null,
      LETTR_SUBJECT: header.lettr_subject ?? null,

      REMARKS_1: header.remarks_1 ?? null,
      REMARKS_2: header.remarks_2 ?? null,
      REMARKS_3: header.remarks_3 ?? null,

      CURR_CODE: header.curr_code ?? null,

      EX_RATE:
        header.ex_rate !== undefined &&
        header.ex_rate !== null &&
        header.ex_rate !== ""
          ? toNumber(header.ex_rate)
          : 1,

      AMOUNT:
        header.amount !== undefined &&
        header.amount !== null &&
        header.amount !== ""
          ? toNumber(header.amount)
          : 0,

      SIGNATORY_NAME: header.signatory_name ?? null,
      SIGNATORY_POSITION: header.signatory_position ?? null,

      USER_ID: header.user_id ?? null,
      USER_DT: toDate(header.user_dt),

      EMPLOYEE_ID: header.employee_id ?? null,
      EMPLOYEE_CODE: header.employee_code ?? null,
      PAY_COMP_ID: header.pay_comp_id ?? null,

      RECOVER_MTH_AMT:
        header.recover_mth_amt !== undefined &&
        header.recover_mth_amt !== null &&
        header.recover_mth_amt !== ""
          ? toNumber(header.recover_mth_amt)
          : 0,

      RECOVER_FROM_DT: toDate(header.recover_from_dt),

      ALLOCATED_AMT:
        header.allocated_amt !== undefined &&
        header.allocated_amt !== null &&
        header.allocated_amt !== ""
          ? toNumber(header.allocated_amt)
          : 0,

      BALANCE_AMT:
        header.balance_amt !== undefined &&
        header.balance_amt !== null &&
        header.balance_amt !== ""
          ? toNumber(header.balance_amt)
          : 0,

      DEDUCT_FROM_LEAVE: header.deduct_from_leave ?? "N",

      DEDUCT_NOOF_LEAVEDAYS:
        header.deduct_noof_leavedays !== undefined &&
        header.deduct_noof_leavedays !== null &&
        header.deduct_noof_leavedays !== ""
          ? toNumber(header.deduct_noof_leavedays)
          : 0,

      REF_HDR_LVE_SLNO: toNumber(header.ref_hdr_lve_slno),

      REF_LEAVE_DOC_NO: header.ref_leave_doc_no ?? null,

      CANCEL_BY: header.cancel_by ?? null,

      CANCEL_DATE: toDate(header.cancel_date),

      DOC_STATUS: header.doc_status ?? null,

      RECOVERY_PERIOD: toNumber(header.recovery_period),

      SYS_GEN: header.sys_gen ?? "N",

      PAY_MONTH: toNumber(header.pay_month),

      PAY_YEAR: toNumber(header.pay_year),
    };

    /*
     * ============================================================
     * DETAILS
     * ============================================================
     */
    const detailRows = details.map((d: any) => ({
      COMPANY_CODE: d.company_code ?? header.company_code ?? null,

      // HARD CODE
      DOC_TYPE: "ADV",

      DOC_NO: toNumber(d.doc_no),

      SERIAL_NO: toNumber(d.serial_no),

      EMPLOYEE_ID: d.employee_id ?? null,

      EMPLYEE_CODE: d.emplyee_code ?? d.employee_code ?? null,

      PAY_COMP_ID: d.pay_comp_id ?? null,

      RECOVER_MTH_AMT:
        d.recover_mth_amt !== undefined &&
        d.recover_mth_amt !== null &&
        d.recover_mth_amt !== ""
          ? toNumber(d.recover_mth_amt)
          : 0,

      RECOVER_FROM_DT: toDate(d.recover_from_dt),

      AMOUNT:
        d.amount !== undefined &&
        d.amount !== null &&
        d.amount !== ""
          ? toNumber(d.amount)
          : 0,

      ALLOCATED_AMT:
        d.allocated_amt !== undefined &&
        d.allocated_amt !== null &&
        d.allocated_amt !== ""
          ? toNumber(d.allocated_amt)
          : 0,

      BALANCE_AMT:
        d.balance_amt !== undefined &&
        d.balance_amt !== null &&
        d.balance_amt !== ""
          ? toNumber(d.balance_amt)
          : 0,

      DEDUCT_FROM_LEAVE: d.deduct_from_leave ?? "N",

      DEDUCT_NOOF_LEAVEDAYS:
        d.deduct_noof_leavedays !== undefined &&
        d.deduct_noof_leavedays !== null &&
        d.deduct_noof_leavedays !== ""
          ? toNumber(d.deduct_noof_leavedays)
          : 0,

      REF_LEAVE_DOC_NO: d.ref_leave_doc_no ?? null,

      REF_HDR_LVE_SLNO: toNumber(d.ref_hdr_lve_slno),

      LAST_POSTED_MONTH: toNumber(d.last_posted_month),

      POST_PAYROLL: d.post_payroll ?? null,

      POST_DATE: toDate(d.post_date),

      CANCEL_BY: d.cancel_by ?? null,

      CANCEL_DATE: toDate(d.cancel_date),

      CANCEL_STATUS: d.cancel_status ?? null,

      LEAVE_DAYS_PAID: toNumber(d.leave_days_paid),

      SAL_TYPE_FLAG: d.sal_type_flag ?? "N",

      /*
       * SR_NO is generated by Oracle procedure.
       */
      SR_NO: null,

      PAYROLL_CLOSED: d.payroll_closed ?? "N",

      REMARKS: d.remarks ?? null,

      PAY_MONTH: toNumber(d.pay_month),

      PAY_YEAR: toNumber(d.pay_year),

      LAST_UPDATED_BY: d.last_updated_by ?? null,

      SYS_GEN: d.sys_gen ?? null,
    }));

    /*
     * ============================================================
     * GET ORACLE OBJECT CLASSES
     * ============================================================
     */
    const HeaderObjClass = await connection.getDbObjectClass(
      "HR_SALARY_ADVDED_FORM_HDR_OBJ"
    );

    const HeaderTabClass = await connection.getDbObjectClass(
      "HR_SALARY_ADVDED_FORM_HDR_TAB"
    );

    const DetailObjClass = await connection.getDbObjectClass(
      "HR_SALARY_ADVDED_FORM_DET_OBJ"
    );

    const DetailTabClass = await connection.getDbObjectClass(
      "HR_SALARY_ADVDED_FORM_DET_TAB"
    );

    /*
     * ============================================================
     * CREATE ORACLE OBJECTS
     * ============================================================
     */
    const headerObject = new HeaderObjClass(headerRow);
    const headerCollection = new HeaderTabClass([headerObject]);

    const detailObjects = detailRows.map(
      (row: any) => new DetailObjClass(row)
    );
    const detailCollection = new DetailTabClass(detailObjects);

    /*
     * ============================================================
     * EXECUTE PROCEDURE
     * ============================================================
     */
    await (connection.execute as any)(
      `
      BEGIN
        PROC_INS_UPD_HR_SALARY_ADVDED(
          :p_header,
          :p_details
        );
      END;
      `,
      {
        p_header: {
          type: HeaderTabClass,
          val: headerCollection,
        },
        p_details: {
          type: DetailTabClass,
          val: detailCollection,
        },
      },
      {
        autoCommit: false,
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Salary advance/deduction saved successfully",
    });
  } catch (err: any) {
    console.error("HR Salary Advance/Deduction Oracle Error:", err);

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback Error:", rollbackError);
      }
    }

    res.status(500).json({
      success: false,
      message: "Salary advance/deduction transaction failed",
      details: err?.message || "Unknown error",
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error("Connection close error:", closeError);
      }
    }
  }
};