import { Request, Response, RequestHandler } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

// ---------- helpers ----------
const toDate = (v: any) => (v ? new Date(v) : null);
const toNumber = (v: any) => (v !== undefined && v !== null && v !== "" ? Number(v) : null);

// ---------- FULL OBJECT ----------
// Keys MUST match WMSTST.HR_MAN_REQ_OBJ attribute names exactly (case-insensitive,
// but keep uppercase for consistency with the type definition).
const buildManReqObject = (e: any) => ({
  COMPANY_CODE:   e.company_code   ?? null,
  DOC_TYPE:       e.doc_type       ?? null,
  DOC_NO:         toNumber(e.doc_no),          // null -> trigger generates it
  DOC_REF_NO:     e.doc_ref_no     ?? null,
  POS_TITLE:      e.pos_title      ?? null,
  NO_OF_POS:      toNumber(e.no_of_pos),
  REPORTS_TO:     e.reports_to     ?? null,
  DEPT:           e.dept           ?? null,
  REQ_DATE:       toDate(e.req_date),
  DEPT_MGR:       e.dept_mgr       ?? null,
  TOTAL_EXP:      toNumber(e.total_exp),
  REV_EXP:        toNumber(e.rev_exp),
  QUAL:           e.qual           ?? null,
  SAL_RANGE_FRM:  toNumber(e.sal_range_frm),
  SAL_RANGE_TO:   toNumber(e.sal_range_to),
  REQ_SKILLS:     e.req_skills     ?? null,
  SEC_SKILLS:     e.sec_skills     ?? null,
  ROLE_DESC:      e.role_desc      ?? null,
  REQ_REASON:     e.req_reason     ?? null,
  DISQUAL:        e.disqual        ?? null,
  TGT_COMPANY:    e.tgt_company    ?? null,
  OTHER_INFO:     e.other_info     ?? null,
  SIGN_1:         e.sign_1         ?? null,
  SIGN_2:         e.sign_2         ?? null,
  SIGN_3:         e.sign_3         ?? null,
  SIGN_4:         e.sign_4         ?? null,
  COMMENTS:       e.comments       ?? null,
  USER_ID:        e.user_id        ?? null,
  USER_DT:        toDate(e.user_dt),
  DOC_DATE:       toDate(e.doc_date),
});

// ---------- CONTROLLER ----------
export const insUpdHrManReq: RequestHandler = async (req: Request, res: Response) => {
  let connection: oracledb.Connection | null = null;

  try {
    const { requisition } = req.body;

    if (!requisition) {
      res.status(400).json({
        success: false,
        message: "Requisition object required",
      });
      return;
    }

    // Optional: reject a non-numeric DOC_NO early instead of letting Oracle throw ORA-01722
    if (
      requisition.doc_no !== undefined &&
      requisition.doc_no !== null &&
      requisition.doc_no !== "" &&
      isNaN(Number(requisition.doc_no))
    ) {
      res.status(400).json({
        success: false,
        message: "doc_no must be numeric",
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

    // ---------------- CONNECTION ----------------
    connection = await TenantManager.getConnection(tenantId);

    const reqObj = buildManReqObject(requisition);

    await connection.execute(
      `BEGIN
         PROC_INS_UPD_HR_MAN_REQ(:p_req);
       END;`,
      {
        p_req: {
          type: "HR_MAN_REQ_OBJ",
          val: reqObj,
        },
      },
      { autoCommit: false }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Requisition saved successfully",
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
      message: err.message,
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