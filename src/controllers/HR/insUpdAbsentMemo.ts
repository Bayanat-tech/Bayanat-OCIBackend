import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

export const insUpdAbsentMemo = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {
    const { company_code, user_id, header, details } = req.body ?? {};

    if (!company_code || !user_id || !header || !Array.isArray(details)) {
      res.status(400).json({
        success: false,
        message: "company_code, user_id, header and details are required"
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

    connection = await TenantManager.getConnection(tenantId);
    

    // ================= HEADER =================
    const headerRow = {
      COMPANY_CODE: company_code,
      DOC_TYPE: header.doc_type ?? "ABM",
      DOC_NO: Number(header.doc_no) || 0,
      DOC_DATE: header.doc_date ? new Date(header.doc_date) : null,
      REF_NO: header.ref_no ?? null,
      NAME_FROM: header.name_from ?? null,
      ADDR_FROM: header.addr_from ?? null,
      NAME_TO: header.name_to ?? null,
      LETTR_SUBJECT: header.lettr_subject ?? null,
      SIGNATORY_NAME: header.signatory_name ?? null,
      SIGNATORY_POSITION: header.signatory_position ?? null,
      REMARKS_1: header.remarks_1 ?? null,
      REMARKS_2: header.remarks_2 ?? null,
      USER_ID: user_id
    };

    // ================= DETAILS =================
    const detailRows = details.map((d: any) => ({
      EMPLOYEE_CODE: d.employee_code ?? null,
      SYS_GEN: d.sys_gen ?? "N",
      RECOVER_FROM_DT: d.recover_from_dt ? new Date(d.recover_from_dt) : null,
      PAY_UNIT: d.pay_unit ?? null,
      AMOUNT: d.amount ?? 0,
      ALLOCATED_AMT: d.allocated_amt ?? 0,
      BALANCE_AMT: d.balance_amt ?? 0,
      DEDUCT_FROM_LEAVE: d.deduct_from_leave ?? "N",
      DEDUCT_NOOF_LEAVEDAYS: d.deduct_noof_leavedays ?? 0,
      REF_LEAVE_DOC_NO: d.ref_leave_doc_no ?? null,
      CANCEL_STATUS: d.cancel_status ?? null
    }));

    // ================= EXECUTE =================
    const result = await connection.execute<{ p_doc_no: number }>(
      `BEGIN
         WMSTST.PROC_INS_UPD_ABSENT_MEMO(:p_header, :p_details, :p_doc_no);
       END;`,
      {
        p_header: { type: "ABSENT_MEMO_HDR_TAB", val: [headerRow] },
        p_details: { type: "ABSENT_MEMO_DET_TAB", val: detailRows },
        p_doc_no: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
      },
      { autoCommit: false }
    );

    await connection.commit();

    const docNo = (result.outBinds as { p_doc_no: number }).p_doc_no;

    res.json({
      success: true,
      message: `Document ${docNo} saved successfully`,
      doc_no: docNo
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