export type TAppraisalTaskDtl = {
company_code: string;
  item_type: string;
  employee_code: string;
  appraisal_doc_no?: string | Date;
  kpi_code?: string;
  rating?: number;
  score?: number;
  KPI_TYPE_CODE?: string;
  KPI_DESC?: string;
  standard_weightage?: number;
  KPI_TYPE_DESC?: string;
  total?: number;
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
    console.log("UPDATE API HIT");
    console.log("Incoming body:", req.body);
    
    const rows = req.body.rows.map((r: TAppraisalTaskDtl) => ({
      COMPANY_CODE: r.company_code,
      APPRAISAL_DOC_NO: r.appraisal_doc_no,
      ITEM_TYPE: r.item_type,
      EMPLOYEE_CODE: r.employee_code,
      KPI_CODE: r.kpi_code ?? null,
      RATING: r.rating ?? null,
      TOTAL: r.total ?? null,
      STANDARD_WEIGHTAGE: r.standard_weightage ?? null
    }));
     
    console.log("Mapped rows:", rows);
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
