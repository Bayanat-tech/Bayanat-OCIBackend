export type TAppraisalTaskDtl = {
 COMPANY_CODE: string;
  ITEM_TYPE: string;
  EMPLOYEE_CODE: string;
  APPRAISAL_DOC_NO?: string | Date;
  KPI_CODE?: string;
  RATING?: number;
  SCORE?: number;
  KPI_TYPE_CODE?: string;
  KPI_DESC?: string;
  STANDARD_WEIGHTAGE?: number;
  KPI_TYPE_DESC?: string;
  TOTAL?: number;
};


import { Response } from "express";
import { QueryExecutor } from "../../database/QueryExecutor";
import { RequestWithUser } from "../../interfaces/common.interface";
import { getPamsTenantSchema } from "./pamsTenantSafety";

export async function updateAppraisalRatings(
  req: RequestWithUser,
  res: Response
) {
  try {
    if (!Array.isArray(req.body?.rows) || req.body.rows.length === 0) {
      res.status(400).json({ success: false, message: "At least one appraisal rating row is required" });
      return;
    }

    const inputRows = req.body.rows as TAppraisalTaskDtl[];
    if (inputRows.some((row) => !row || typeof row !== "object")) {
      res.status(400).json({ success: false, message: "Appraisal rating rows must be objects" });
      return;
    }

    const authenticatedCompanyCode = String(req.user?.company_code || "").trim();
    if (!authenticatedCompanyCode) {
      res.status(403).json({ success: false, message: "Authenticated company is unavailable" });
      return;
    }

    if (inputRows.some((row) =>
      row.COMPANY_CODE &&
      String(row.COMPANY_CODE).trim().toUpperCase() !== authenticatedCompanyCode.toUpperCase()
    )) {
      res.status(403).json({
        success: false,
        message: "An appraisal rating row belongs to a different company"
      });
      return;
    }

    const rows = inputRows.map((r) => ({
      COMPANY_CODE: authenticatedCompanyCode,
      APPRAISAL_DOC_NO: r.APPRAISAL_DOC_NO,
      ITEM_TYPE: r.ITEM_TYPE,
      EMPLOYEE_CODE: r.EMPLOYEE_CODE,
      KPI_CODE: r.KPI_CODE ?? null,
      RATING: r.RATING ?? null,
      TOTAL: r.TOTAL ?? null,
      STANDARD_WEIGHTAGE: r.STANDARD_WEIGHTAGE ?? null
    }));

    const tenantSchema = await getPamsTenantSchema();

    await QueryExecutor.executeRawQuery(
      `
      BEGIN
        ${tenantSchema}.PROC_UPD_APPRAISAL_TASK_RATING(:p_rows);
      END;
      `,
      {
        p_rows: {
          type: `${tenantSchema}.APPRAISAL_TASK_DTL_TAB`,
          val: rows
        }
      }
    );

    res.json({ success: true, message: "Ratings updated successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Update failed" });
  }
}
