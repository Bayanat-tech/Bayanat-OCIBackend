import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";

// import TenantManager from "../../../../database/TenantManager";
// import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

const toNumber = (val: any): number | null => {
  if (val === undefined || val === null || val === "") return null;

  const n = Number(val);

  return isNaN(n) ? null : n;
};

const toDate = (val: any): Date | null => {
  if (!val) return null;

  const d = new Date(val);

  return isNaN(d.getTime()) ? null : d;
};

export const upsertHrEmpEducation = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {

    const data = req.body;

    if (
      !data?.company_code ||
      !Array.isArray(data?.education_details)
    ) {
      res.status(400).json({
        success: false,
        message: "company_code and education_details are required"
      });
      return;
    }

    // 🔹 Resolve tenant
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

    // 🔹 Oracle Object Class
    const EducationObjClass = await connection.getDbObjectClass(
      "TR_HR_EMP_EDUCATION_OBJ"
    );

    const EducationTabClass = await connection.getDbObjectClass(
      "TR_HR_EMP_EDUCATION_TAB"
    );

    // 🔹 Create object array
    const educationRows = data.education_details.map((row: any) => {

      return new EducationObjClass({

        EMPLOYEE_ID: row.employee_id,
        EDU_DESC_CODE: row.edu_desc_code,
        EDU_LEVEL_CODE: row.edu_level_code,

        START_DATE: toDate(row.start_date),
        END_DATE: toDate(row.end_date),

        YEAR_OF_PASSING: toNumber(row.year_of_passing),

        STUDIED_AT: row.studied_at,

        COURSE_DESCRIPTION: row.course_description,

        REMARKS: row.remarks,

        USER_ID: row.user_id,

        USER_DT: toDate(row.user_dt),

        STATUS_FLAG: row.status_flag,

        COMPANY_CODE: data.company_code,

        EDU_DISTINCTION: row.edu_distinction

      });

    });

    const educationCollection = new EducationTabClass(
      educationRows
    );

    // 🔹 Execute Procedure
    await connection.execute(
      `
      BEGIN
          PROC_UPSERT_HR_EMP_EDUCATION(:p_data);
      END;
      `,
      {
        p_data: educationCollection
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Education details saved successfully"
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