import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

export const insUpdHrJoinRpt = async (req: Request, res: Response): Promise<void> => {
  console.log("insUpdHrJoinRpt called-------------");
  console.log("req.body:------------------", req.body);

  let connection: oracledb.Connection | undefined;

  try {
    const header = req.body?.header;
    const details = req.body?.details;

    if (!header || !Array.isArray(details)) {
      res.status(400).json({ success: false, message: "Header and details required" });
      return;
    }

    // ★ guardrail so EMPLOYEE_ID never reaches Oracle as NULL
    if (!header.cand_no) {
      res.status(400).json({ success: false, message: "cand_no (Employee/Candidate No) is required" });
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
      DOC_NO: header.doc_no ?? null,
      DOC_REF_NO: header.doc_ref_no ?? null,
      CAND_NO: header.cand_no ?? null,
      CAND_NAME: header.cand_name ?? null,
      BASIC_SAL: Number(header.basic_sal ?? 0),
      DESIG: header.desig ?? null,
      HRA: Number(header.hra ?? 0),
      JOIN_DATE: header.join_date ? new Date(header.join_date) : null,
      FA: Number(header.fa ?? 0),
      DIVISION: header.division ?? null,
      TA: Number(header.ta ?? 0),
      BANK: header.bank ?? null,
      BRANCH: header.branch ?? null,
      TELE_ALLOW: Number(header.tele_allow ?? 0),
      BANK_ACCT_NUMBER: header.bank_acct_number ?? null,
      GROSS_SAL: Number(header.gross_sal ?? 0),
      SIGN_1: header.sign_1 ?? null,
      DATE_1: header.date_1 ? new Date(header.date_1) : null,
      SIGN_2: header.sign_2 ?? null,
      DATE_2: header.date_2 ? new Date(header.date_2) : null,
      SIGN_3: header.sign_3 ?? null,
      DATE_3: header.date_3 ? new Date(header.date_3) : null,
      SIGN_4: header.sign_4 ?? null,
      DATE_4: header.date_4 ? new Date(header.date_4) : null,
      USER_ID: header.user_id ?? null,
      USER_DT: header.user_dt ? new Date(header.user_dt) : new Date(),
      DOC_DATE: header.doc_date ? new Date(header.doc_date) : null
    };

    // ================= DETAILS =================
    const detailRows = details.map((d: any) => ({
      EMPLOYEE_ID: d.employee_id ?? header.cand_no,
      PAY_COMP_ID: d.pay_comp_id ?? null,
      PAY_COMP_AMT: Number(d.pay_comp_amt ?? 0),
      PAY_COMP_PERC: Number(d.pay_comp_perc ?? 0),
      PAY_COMP_AMT_OLD: Number(d.pay_comp_amt_old ?? 0),
      ENTERED_ON: d.entered_on ? new Date(d.entered_on) : new Date(),
     ENTERED_BY: d.entered_by ?? d.user_id ?? header.user_id ?? null,
      VERIFIED_ON: d.verified_on ? new Date(d.verified_on) : null,
      VERIFIED_BY: d.verified_by ?? null,
      APPROVED_ON: d.approved_on ? new Date(d.approved_on) : null,
      APPROVED_BY: d.approved_by ?? null,
      REVISED_ON: d.revised_on ? new Date(d.revised_on) : null,
      REVISED_BY: d.revised_by ?? null,
      FREEZED_ON: d.freezed_on ? new Date(d.freezed_on) : null,
      FREEZED_REASON: d.freezed_reason ?? null,
      FREEZED_TILL: d.freezed_till ? new Date(d.freezed_till) : null,
      REMARKS: d.remarks ?? null,
      STATUS_FLAG: d.status_flag ?? null,
      USER_ID: d.user_id ?? null,
      USER_DT: d.user_dt ? new Date(d.user_dt) : new Date(),
      COMPANY_CODE: d.company_code ?? header.company_code,
      PAY_COMP_EARN_DED: d.pay_comp_earn_ded ?? null,
      PAY_ROLL_STATUS: d.pay_roll_status ?? null,
      COMP_STATUS: d.comp_status ?? null,
      ARREARS_AMT: Number(d.arrears_amt ?? 0),
      ARREARS_TYPE: d.arrears_type ?? null,
      ARREARS_POSTED: d.arrears_posted ?? null,
      REF_DOC_TYPE: d.ref_doc_type ?? null,
      REF_DOC_NO: d.ref_doc_no ?? null,
      PAY_COMP_AMT_VAC: Number(d.pay_comp_amt_vac ?? 0),
      VAC_UPDATED: d.vac_updated ?? null,
      SOURCE_FROM: d.source_from ?? null,
      SOURCE_UPDATED: d.source_updated ? new Date(d.source_updated) : new Date(),
      CURR_CODE: d.curr_code ?? 'OMR'
    }));

    // ================= CALL PROCEDURE =================
    await connection.execute(
      `BEGIN
         PROC_INS_UPD_HR_JOIN(:p_header, :p_details);
       END;`,
      {
        p_header: { type: "HR_JOIN_RPT_TAB", val: [headerRow] },
        p_details: { type: "HR_EMP_COMP_TAB", val: detailRows }
      },
      { autoCommit: false }
    );

    await connection.commit();

    res.json({ success: true, message: "HR Join saved successfully" });

  } catch (err: any) {
    console.error("Oracle Error:", err);
    if (connection) await connection.rollback();
    res.status(500).json({
      success: false,
      message: "Transaction failed",
      details: err?.message || "Unknown error"
    });
  } finally {
    if (connection) await connection.close();
  }
};