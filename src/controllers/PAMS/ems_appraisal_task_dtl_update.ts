export type TAppraisalTaskDtl = {
COMPANY_CODE: string;
  APPRAISAL_DOC_NO: string;
  ITEM_TYPE: string;
  EMPLOYEE_CODE: string;
  APPRAISAL_DOC_DATE?: string | Date;
  KPI_CODE?: string;
  WEIGHTAGE?: number;
  RATING?: number;
  SCORE?: number;
  KPI_TYPE_CODE?: string;
  KPI_DESC?: string;
  STANDARD_WEIGHTAGE?: number;
  KPI_TYPE_DESC?: string;
  TOTAL?: string;
};


import oracledb from "oracledb";
import { Request, Response } from "express";
//import { TAppraisalTaskDtl } from "./models";

export async function updateAppraisalRatings(
  req: Request,
  res: Response
) {
  const connection = await oracledb.getConnection();

  try {
    const rows = req.body.rows.map((r: TAppraisalTaskDtl) => ({
      COMPANY_CODE: r.COMPANY_CODE,
      APPRAISAL_DOC_NO: r.APPRAISAL_DOC_NO,
      ITEM_TYPE: r.ITEM_TYPE,
      EMPLOYEE_CODE: r.EMPLOYEE_CODE,
      KPI_CODE: r.KPI_CODE ?? null,
      RATING: r.RATING
    }));

    await connection.execute(
      `
      BEGIN
        PROC_UPD_APPRAISAL_TASK_RATING(:p_rows);
      END;
      `,
      {
        p_rows: {
          type: "APPRAISAL_TASK_DTL_TAB",
          val: rows
        }
      }
    );

    res.json({ message: "Ratings updated successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Update failed" });

  } finally {
    await connection.close();
  }
}
