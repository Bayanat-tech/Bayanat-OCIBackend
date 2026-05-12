import { Request, Response } from "express";
import oracledb from "oracledb";

import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

const toNumber = (val: any): number | null => {
  if (val === undefined || val === null || val === "") return null;

  const n = Number(val);

  return isNaN(n) ? null : n;
};

// DATE CONVERTER
const toDate = (val: any): Date | null => {
  if (!val) return null;

  const d = new Date(val);

  return isNaN(d.getTime()) ? null : d;
};

export const upsertHrIntEvalForm = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {

    const data = req.body;

    if (!data?.company_code || !data?.doc_type) {

      res.status(400).json({
        success: false,
        message: "company_code and doc_type are required"
      });

      return;
    }

    // TENANT
    let tenantId: string | undefined;

    try {
      tenantId = getCurrentTenantId();
    } catch {}

    if (!tenantId && data?.loginid) {
      tenantId = await TenantManager.getTenantForUser(data.loginid);
    }

    if (!tenantId) {

      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });

      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    // OBJECT CLASS
    const HrEvalObjClass = await connection.getDbObjectClass(
      "HR_INT_EVAL_FORM_OBJ"
    );

    // OBJECT
    const obj: any = new HrEvalObjClass({

      COMPANY_CODE: data.company_code,
      DOC_TYPE: data.doc_type,
      DOC_NO: toNumber(data.doc_no),

      DOC_REF_NO: data.doc_ref_no,
      CAND_NO: data.cand_no,
      CAND_NAME: data.cand_name,
      POS_APPL_FOR: data.pos_appl_for,
      DEPT: data.dept,
      INTVR_NAME: data.intvr_name,

      INTRVW_DATE: toDate(data.intrvw_date),

      HIRE_FLAG: data.hire_flag,
      SPEC_JOB_SKILL: data.spec_job_skill,
      REL_JOB_EXP: data.rel_job_exp,
      REL_EDU_TRAINING: data.rel_edu_training,
      INITIATIVE: data.initiative,
      COMM_SKILLS: data.comm_skills,
      ATTITUDE: data.attitude,
      INTEREST_COMP_POS: data.interest_comp_pos,

      POS_POINTS: data.pos_points,
      NEG_POINTS: data.neg_points,
      OBS_COMMENT: data.obs_comment,

      SIGN_4: data.sign_4,
      USER_ID: data.user_id,

      USER_DT: toDate(data.user_dt),
      DOC_DATE: toDate(data.doc_date)

    });

    // PROCEDURE CALL
    await connection.execute(
      `BEGIN
          PROC_UPSERT_HR_INT_EVAL_FORM(:p_data);
       END;`,
      {
        p_data: obj
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Record saved successfully"
    });

  } catch (err: any) {

    console.error("Oracle Error:", err);

    res.status(500).json({
      success: false,
      message: "Upsert failed",
      details: err.message
    });

  } finally {

    if (connection) {
      await connection.close().catch(() => {});
    }
  }
};