import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

export const insUpdHrPayComponent = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {
    const { header, details } = req.body;

    if (!header || !Array.isArray(details)) {
      res.status(400).json({
        success: false,
        message: "Header and details required"
      });
      return; // ✅ IMPORTANT
    }

    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return; // ✅ IMPORTANT
    }

    connection = await TenantManager.getConnection(tenantId);

    // ================= HEADER =================
    const headerRow = {
      COMPANY_CODE: header.company_code ?? null,
      PAY_COMP_ID: header.pay_comp_id ?? null,
      PAY_COMP_DESC: header.pay_comp_desc ?? null,
      PAY_COMP_SHORT_DESC: header.pay_comp_short_desc ?? null,
      PAY_COMP_TYPE: header.pay_comp_type ?? null,
      PAY_COMP_EARN_DED: header.pay_comp_earn_ded ?? null,
      ATTENDANCE_DEPENDENCY: header.attendance_dependency ?? null,
      PERIODICITY: header.periodicity ?? null,
      TAXABLE: header.taxable ?? null,
      ROUND_OFF_TO: header.round_off_to ?? 0,
      REMARKS: header.remarks ?? null,
      STATUS: header.status ?? 'A',
      USER_ID: header.user_id ?? null,
      USER_DT: header.user_dt ? new Date(header.user_dt) : null,
      PAY_COMP_CLASS: header.pay_comp_class ?? null,
      PAY_FLAG: header.pay_flag ?? null,
      PAY_COMP_DEPENDENT: header.pay_comp_dependent ?? null,
      PAY_COMP_AMT: header.pay_comp_amt ?? 0,
      TYPE: header.type ?? null,
      ACCT_CODE: header.acct_code ?? null,
      ACCT_TYPE: header.acct_type ?? null,
      SORT_ORDER: header.sort_order ?? 0,
      REF_DOC_TYPE: header.ref_doc_type ?? null,
      REF_DOC_NO: header.ref_doc_no ?? null,
      LEAVE_PAID: header.leave_paid ?? 'Y',
      SALARY_LINK: header.salary_link ?? 'N',
      DIV_CODE: header.div_code ?? null
    };

    // ================= DETAILS =================
    const detailRows = details.map((d: any) => ({
      COMPANY_CODE: d.company_code ?? null,
      PAY_COMP_ID: d.pay_comp_id ?? null,
      PAY_COMP_ID_DEPEND: d.pay_comp_id_depend ?? null,
      PERCENT: d.percent ?? 0,
      REMARKS: d.remarks ?? null,
      STATUS_FLAG: d.status_flag ?? 'A',
      USER_ID: d.user_id ?? null,
      USER_DT: d.user_dt ? new Date(d.user_dt) : null,
      EMPR_PERCENT: d.empr_percent ?? 0
    }));

    // ================= EXECUTE =================
    await connection.execute(
      `BEGIN
         PROC_INS_UPD_HR_PAYCOMP(:p_header, :p_details);
       END;`,
      {
        p_header: { type: "HR_PAYCOMP_TAB", val: [headerRow] },
        p_details: { type: "HR_PAYCOMP_DEP_TAB", val: detailRows }
      },
      { autoCommit: false }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Saved successfully"
    });

  } catch (err: any) {

    if (connection) await connection.rollback();

    res.status(500).json({
      success: false,
      message: err.message
    });

  } finally {
    if (connection) await connection.close();
  }
};