import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

export const insUpdHrSalaryAdvDed = async (req: Request, res: Response): Promise<void> => {
  let connection: oracledb.Connection | undefined;

  try {
    const { header, details } = req.body;

    if (!header || !Array.isArray(details)) {
      res.status(400).json({ success: false, message: "Header and details required" });
      return;
    }

    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    // ================= HEADER =================
    const headerRow = {
      COMPANY_CODE: header.company_code ?? null,
      DOC_TYPE: header.doc_type ?? null,
      DOC_NO: header.doc_no ?? 0,
      DOC_DATE: header.doc_date ? new Date(header.doc_date) : null,
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
      EX_RATE: header.ex_rate ?? 1,
      AMOUNT: header.amount ?? 0,
      SIGNATORY_NAME: header.signatory_name ?? null,
      SIGNATORY_POSITION: header.signatory_position ?? null,
      USER_ID: header.user_id ?? null,
      USER_DT: header.user_dt ? new Date(header.user_dt) : null,
      EMPLOYEE_ID: header.employee_id ?? null,
      EMPLOYEE_CODE: header.employee_code ?? null,
      PAY_COMP_ID: header.pay_comp_id ?? null,
      RECOVER_MTH_AMT: header.recover_mth_amt ?? 0,
      RECOVER_FROM_DT: header.recover_from_dt ? new Date(header.recover_from_dt) : null,
      ALLOCATED_AMT: header.allocated_amt ?? 0,
      BALANCE_AMT: header.balance_amt ?? 0,
      DEDUCT_FROM_LEAVE: header.deduct_from_leave ?? 'N',
      DEDUCT_NOOF_LEAVEDAYS: header.deduct_noof_leavedays ?? 0,
      REF_HDR_LVE_SLNO: header.ref_hdr_lve_slno ?? null,
      REF_LEAVE_DOC_NO: header.ref_leave_doc_no ?? null,
      DOC_STATUS: header.doc_status ?? 'N',
      RECOVERY_PERIOD: header.recovery_period ?? null,
      SYS_GEN: header.sys_gen ?? 'N',
      PAY_MONTH: header.pay_month ?? null,
      PAY_YEAR: header.pay_year ?? null
    };

    // ================= DETAILS =================
    const detailRows = details.map((d: any, index: number) => ({
      COMPANY_CODE: header.company_code ?? null,
      DOC_TYPE: header.doc_type ?? null,
      DOC_NO: header.doc_no ?? 0,
      SR_NO: d.sr_no ?? index + 1,
      EMPLOYEE_ID: d.employee_id ?? null,
      EMPLYEE_CODE: d.emplyee_code ?? null,
      PAY_COMP_ID: d.pay_comp_id ?? null,
      RECOVER_MTH_AMT: d.recover_mth_amt ?? 0,
      RECOVER_FROM_DT: d.recover_from_dt ? new Date(d.recover_from_dt) : null,
      AMOUNT: d.amount ?? 0,
      ALLOCATED_AMT: d.allocated_amt ?? 0,
      BALANCE_AMT: d.balance_amt ?? 0,
      DEDUCT_FROM_LEAVE: d.deduct_from_leave ?? 'N',
      DEDUCT_NOOF_LEAVEDAYS: d.deduct_noof_leavedays ?? 0,
      REF_LEAVE_DOC_NO: d.ref_leave_doc_no ?? null,
      REF_HDR_LVE_SLNO: d.ref_hdr_lve_slno ?? null,
      PAY_MONTH: d.pay_month ?? null,
      PAY_YEAR: d.pay_year ?? null,
      LAST_UPDATED_BY: d.last_updated_by ?? null,
      SYS_GEN: d.sys_gen ?? 'N'
    }));

    // ================= CALL PROCEDURE =================
    await connection.execute(
      `BEGIN
         PROC_INS_UPD_HR_ADVDED(:p_header, :p_details);
       END;`,
      {
        p_header: { type: "HR_ADVDED_HDR_TAB", val: [headerRow] },
        p_details: { type: "HR_ADVDED_DTL_TAB", val: detailRows }
      },
      { autoCommit: false }
    );

    await connection.commit();

    res.json({ success: true, message: "Saved successfully" });

  } catch (err: any) {
    if (connection) await connection.rollback();
    res.status(500).json({
      success: false,
      message: "Transaction failed",
      details: err.message
    });
  } finally {
    if (connection) await connection.close();
  }
};